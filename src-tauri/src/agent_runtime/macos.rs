#[cfg(target_os = "macos")]
use crate::agent_runtime::process::unix_command;
use crate::agent_runtime::process::{ProcessSpec, ResourceLimits};
#[cfg(target_os = "macos")]
use crate::agent_runtime::process::{ProcessSupervisor, Supervisor, SupervisorLimits};
#[cfg(target_os = "macos")]
use crate::agent_runtime::protocol::{Action, Framework, WorkerRequestV1};
use crate::agent_runtime::resources::{AgentEnvironment, ResourcePaths, RunnerContainment};
#[cfg(target_os = "macos")]
use crate::agent_runtime::{CapabilityReport, ControlResult};
use fs2::FileExt;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

const SANDBOX_EXEC: &str = "/usr/bin/sandbox-exec";
const PROFILE_VERSION: &str = "nuclei-seatbelt-v1";
const MAX_IDENTITY_ENTRIES: usize = 50_000;
const MAX_IDENTITY_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const IDENTITY_TIMEOUT: Duration = Duration::from_secs(10);
static ACTIVE_IDENTITY_HASHERS: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);
#[cfg(target_os = "macos")]
const PROBE_TIMEOUT: Duration = Duration::from_secs(4);
#[cfg(target_os = "macos")]
const PROBE_OUTPUT_LIMIT: usize = 65_536;

/// Canonical paths and credential names used to qualify one immutable backend.
///
/// Construction canonicalizes every filesystem object up front. Qualification
/// never consults the process cwd or ambient home directory, and a context
/// containing a symlink alias is rejected rather than silently followed.
#[derive(Clone, Debug)]
pub struct QualificationContext {
    pub app_version: String,
    pub resources: ResourcePaths,
    pub environment: AgentEnvironment,
    pub request_temp_root: PathBuf,
    pub runtime_lock: PathBuf,
    pub project_root: PathBuf,
    pub home_root: PathBuf,
    pub parent_secret_names: BTreeSet<String>,
    pub system_paths: SystemPaths,
}

#[derive(Clone, Debug)]
pub struct SystemPaths {
    pub read_roots: Vec<PathBuf>,
    pub devices: Vec<PathBuf>,
    pub sandbox_exec: PathBuf,
    production: bool,
}

impl SystemPaths {
    pub fn for_tests(
        read_roots: Vec<PathBuf>,
        devices: Vec<PathBuf>,
        sandbox_exec: PathBuf,
    ) -> Result<Self, String> {
        let paths = Self {
            read_roots,
            devices,
            sandbox_exec,
            production: false,
        };
        paths.verify_shape_and_canonical_types(false)?;
        Ok(paths)
    }

    pub fn production() -> Result<Self, String> {
        let paths = Self {
            read_roots: vec![PathBuf::from("/System/Library"), PathBuf::from("/usr/lib")],
            devices: vec![PathBuf::from("/dev/null"), PathBuf::from("/dev/urandom")],
            sandbox_exec: PathBuf::from(SANDBOX_EXEC),
            production: true,
        };
        paths.verify_shape_and_canonical_types(true)?;
        Ok(paths)
    }

    fn verify_shape_and_canonical_types(&self, production: bool) -> Result<(), String> {
        if self.read_roots.len() != 2 || self.devices.len() != 2 {
            return Err("macOS system path set has an unexpected shape".into());
        }
        for root in &self.read_roots {
            if root == Path::new("/") {
                return Err("Broad macOS system read roots are forbidden".into());
            }
            require_canonical(root, "macOS system read root", true)?;
        }
        for device in &self.devices {
            require_canonical(device, "macOS system device", false)?;
            if production {
                require_character_device(device)?;
            }
        }
        require_canonical(&self.sandbox_exec, "sandbox-exec", false)?;
        require_regular_file(&self.sandbox_exec, "sandbox-exec")?;
        let mut identities = self
            .read_roots
            .iter()
            .chain(self.devices.iter())
            .chain(std::iter::once(&self.sandbox_exec))
            .collect::<Vec<_>>();
        identities.sort();
        if identities.windows(2).any(|pair| pair[0] == pair[1]) {
            return Err("macOS system path identities overlap".into());
        }
        if production
            && (self.read_roots != [PathBuf::from("/System/Library"), PathBuf::from("/usr/lib")]
                || self.devices != [PathBuf::from("/dev/null"), PathBuf::from("/dev/urandom")]
                || self.sandbox_exec != Path::new(SANDBOX_EXEC))
        {
            return Err("macOS production system paths do not have fixed identities".into());
        }
        Ok(())
    }

    pub fn verify_production(&self) -> Result<(), String> {
        if !self.production {
            return Err("Injected system paths cannot qualify a production backend".into());
        }
        self.verify_shape_and_canonical_types(true)
    }

    fn verify(&self) -> Result<(), String> {
        self.verify_shape_and_canonical_types(self.production)
    }
}

fn require_regular_file(path: &Path, description: &str) -> Result<(), String> {
    let kind = fs::symlink_metadata(path)
        .map_err(|error| format!("{description} metadata is unavailable: {error}"))?
        .file_type();
    if !kind.is_file() {
        return Err(format!("{description} is not a regular file"));
    }
    Ok(())
}

#[cfg(unix)]
fn require_character_device(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::FileTypeExt;

    let kind = fs::symlink_metadata(path)
        .map_err(|error| format!("macOS system device metadata is unavailable: {error}"))?
        .file_type();
    if !kind.is_char_device() {
        return Err(format!(
            "macOS system device is not a character device: {}",
            path.display()
        ));
    }
    Ok(())
}

#[cfg(not(unix))]
fn require_character_device(_path: &Path) -> Result<(), String> {
    Err("macOS production system devices require Unix identity checks".into())
}

impl QualificationContext {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        app_version: impl Into<String>,
        resources: ResourcePaths,
        environment: AgentEnvironment,
        request_temp_root: &Path,
        project_root: &Path,
        home_root: &Path,
        parent_secret_names: BTreeSet<String>,
        system_paths: SystemPaths,
    ) -> Result<Self, String> {
        environment.verify()?;
        require_canonical(&resources.kernel_root, "Agent kernel root", true)?;
        require_canonical(&resources.worker, "Agent worker", false)?;
        require_canonical(&resources.requirements, "Agent requirements", false)?;
        require_canonical(&environment.root, "Agent environment root", true)?;
        require_canonical(&environment.python, "Agent Python", false)?;
        require_canonical(&environment.site_packages, "Agent site-packages", true)?;
        if resources != ResourcePaths::generation(&environment)? {
            return Err(
                "Agent kernel must be the allowlisted copy inside the locked runtime generation"
                    .into(),
            );
        }
        let request_temp_root =
            require_canonical(request_temp_root, "Agent request temp root", true)?;
        let runtime_lock = require_canonical(
            &environment
                .root
                .parent()
                .ok_or("Agent environment root has no generation parent")?
                .join(".provision.lock"),
            "Agent runtime generation lock",
            false,
        )?;
        require_regular_file(&runtime_lock, "Agent runtime generation lock")?;
        let project_root = require_canonical(project_root, "Project qualification root", true)?;
        let home_root = require_canonical(home_root, "Home qualification root", true)?;
        if !resources.worker.starts_with(&resources.kernel_root)
            || !resources.requirements.starts_with(&resources.kernel_root)
        {
            return Err("Agent resources escaped the canonical kernel root".into());
        }
        if request_temp_root.starts_with(&environment.root)
            || request_temp_root.starts_with(&resources.kernel_root)
            || environment.root.starts_with(&request_temp_root)
            || resources.kernel_root.starts_with(&request_temp_root)
        {
            return Err("Agent request temp overlaps a read-only runtime root".into());
        }
        if project_root.starts_with(&request_temp_root)
            || home_root.starts_with(&request_temp_root)
            || project_root.starts_with(&environment.root)
            || home_root.starts_with(&environment.root)
            || project_root.starts_with(&resources.kernel_root)
            || home_root.starts_with(&resources.kernel_root)
        {
            return Err("Qualification sentinels must be outside sandbox-readable roots".into());
        }
        if parent_secret_names
            .iter()
            .any(|name| name.is_empty() || name.contains('=') || name.contains('\0'))
        {
            return Err("Parent qualification environment contains an invalid name".into());
        }
        Ok(Self {
            app_version: app_version.into(),
            resources,
            environment,
            request_temp_root,
            runtime_lock,
            project_root,
            home_root,
            parent_secret_names,
            system_paths,
        })
    }

    pub fn from_explicit_environment(app_version: &str) -> Result<Self, String> {
        let required = |name: &str| {
            std::env::var_os(name)
                .map(PathBuf::from)
                .ok_or_else(|| format!("{name} is required for explicit macOS qualification"))
        };
        let supplied_kernel_root = require_canonical(
            &required("NUCLEI_AGENT_KERNEL_ROOT")?,
            "Agent kernel root",
            true,
        )?;
        let environment_root = require_canonical(
            &required("NUCLEI_AGENT_ENVIRONMENT_ROOT")?,
            "Agent environment root",
            true,
        )?;
        let environment = AgentEnvironment {
            python: require_canonical(&required("NUCLEI_AGENT_PYTHON")?, "Agent Python", false)?,
            site_packages: require_canonical(
                &required("NUCLEI_AGENT_SITE_PACKAGES")?,
                "Agent site-packages",
                true,
            )?,
            root: environment_root,
        };
        let resources = ResourcePaths::generation(&environment)?;
        if resources.kernel_root != supplied_kernel_root {
            return Err("Explicit agent kernel is not the locked generation copy".into());
        }
        let parent_secret_names = [
            "ANTHROPIC_API_KEY",
            "IBM_QUANTUM_TOKEN",
            "AWS_SECRET_ACCESS_KEY",
        ]
        .into_iter()
        .map(str::to_string)
        .collect();
        Self::new(
            app_version,
            resources,
            environment,
            &required("NUCLEI_AGENT_REQUEST_TEMP_ROOT")?,
            &required("NUCLEI_AGENT_PROJECT_ROOT")?,
            &required("NUCLEI_AGENT_HOME_ROOT")?,
            parent_secret_names,
            SystemPaths::production()?,
        )
    }
}

fn require_canonical(path: &Path, description: &str, directory: bool) -> Result<PathBuf, String> {
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("{description} is unavailable: {error}"))?;
    if canonical != path {
        return Err(format!(
            "{description} must be supplied as a canonical path"
        ));
    }
    let metadata = fs::metadata(&canonical)
        .map_err(|error| format!("{description} is unavailable: {error}"))?;
    if directory != metadata.is_dir() {
        return Err(format!("{description} has the wrong filesystem type"));
    }
    Ok(canonical)
}

/// Offline provisioning is deliberately unavailable until a bundled,
/// hash-verified wheelhouse and its own Seatbelt self-test are shipped.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OfflineProvisioningContainment;

impl OfflineProvisioningContainment {
    pub fn containment(self) -> RunnerContainment {
        RunnerContainment::Unavailable
    }
}

pub struct MacBackend;

impl MacBackend {
    fn runtime_lease_path(path: &Path) -> Result<Arc<fs::File>, String> {
        require_canonical(path, "Agent runtime generation lock", false)?;
        require_regular_file(path, "Agent runtime generation lock")?;
        let metadata = fs::symlink_metadata(path)
            .map_err(|error| format!("Agent runtime lock metadata is unavailable: {error}"))?;
        require_owned_nonwritable(&metadata)?;
        let file = fs::OpenOptions::new()
            .read(true)
            .open(path)
            .map_err(|error| format!("Agent runtime generation lock is unavailable: {error}"))?;
        file.lock_shared()
            .map_err(|error| format!("Agent runtime shared lock failed: {error}"))?;
        Ok(Arc::new(file))
    }

    pub fn runtime_lease(context: &QualificationContext) -> Result<Arc<fs::File>, String> {
        Self::runtime_lease_path(&context.runtime_lock)
    }

    pub fn worker_spec(
        context: &QualificationContext,
        request_temp: &Path,
    ) -> Result<ProcessSpec, String> {
        let request_temp = validate_request_temp(context, request_temp)?;
        let home = request_temp.join("home");
        let temp = request_temp.join("tmp");
        fs::create_dir(&home).map_err(|error| format!("Failed to create worker HOME: {error}"))?;
        fs::create_dir(&temp)
            .map_err(|error| format!("Failed to create worker TMPDIR: {error}"))?;
        let profile = build_seatbelt_profile(context, &request_temp)?;
        Ok(ProcessSpec {
            executable: context.system_paths.sandbox_exec.clone(),
            args: vec![
                "-p".into(),
                profile,
                context.environment.python.to_string_lossy().into_owned(),
                "-I".into(),
                context.resources.worker.to_string_lossy().into_owned(),
            ],
            cwd: request_temp.clone(),
            env: worker_environment(&context.environment, &request_temp)?,
            cleanup_root: Some(request_temp),
            resource_limits: ResourceLimits::production(),
            runtime_guard: None,
            #[cfg(target_os = "linux")]
            linux: None,
        })
    }

    pub fn probe_spec(
        context: &QualificationContext,
        request_temp: &Path,
        script: &str,
    ) -> Result<ProcessSpec, String> {
        let mut spec = Self::worker_spec(context, request_temp)?;
        spec.args.truncate(3);
        spec.args.extend(["-I".into(), "-c".into(), script.into()]);
        Ok(spec)
    }
}

pub struct LockedRuntimeIdentity {
    context: QualificationContext,
    cache_key: String,
    _lease: Arc<fs::File>,
}

impl LockedRuntimeIdentity {
    pub async fn acquire(context: QualificationContext) -> Result<Self, String> {
        let lease = MacBackend::runtime_lease(&context)?;
        context.environment.verify()?;
        let cache_key = qualification_cache_key_async(context.clone()).await?;
        Ok(Self {
            context,
            cache_key,
            _lease: lease,
        })
    }

    pub async fn from_explicit_environment(app_version: &str) -> Result<Self, String> {
        let environment_root = std::env::var_os("NUCLEI_AGENT_ENVIRONMENT_ROOT")
            .map(PathBuf::from)
            .ok_or_else(|| {
                "NUCLEI_AGENT_ENVIRONMENT_ROOT is required for explicit macOS qualification"
                    .to_string()
            })?;
        let lock_path = environment_root
            .parent()
            .ok_or("Explicit agent environment root has no generation parent")?
            .join(".provision.lock");
        let lease = MacBackend::runtime_lease_path(&lock_path)?;
        let context = QualificationContext::from_explicit_environment(app_version)?;
        if context.runtime_lock != lock_path {
            return Err("Explicit runtime lock identity changed during validation".into());
        }
        context.environment.verify()?;
        let cache_key = qualification_cache_key_async(context.clone()).await?;
        Ok(Self {
            context,
            cache_key,
            _lease: lease,
        })
    }

    pub fn context(&self) -> &QualificationContext {
        &self.context
    }

    pub fn cache_key(&self) -> &str {
        &self.cache_key
    }
}

pub fn resource_limit_probe_script(limits: ResourceLimits) -> String {
    format!(
        r#"import errno,os,resource,signal,tempfile
expected=[({cpu},{cpu}),({address_space},{address_space}),({file_size},{file_size}),({open_files},{open_files}),({processes},{processes}),(0,0)]
actual=[resource.getrlimit(item) for item in [resource.RLIMIT_CPU,resource.RLIMIT_AS,resource.RLIMIT_FSIZE,resource.RLIMIT_NOFILE,resource.RLIMIT_NPROC,resource.RLIMIT_CORE]]
assert actual == expected, (actual,expected)
memory=False
try: bytearray({memory_attack})
except (MemoryError,OSError): memory=True
fds=[]
fd_limited=False
try:
 while True: fds.append(open('/dev/null'))
except OSError as error:
 fd_limited=error.errno in (errno.EMFILE,errno.ENFILE)
signal.signal(signal.SIGXFSZ,signal.SIG_IGN)
file_limited=False
try:
 with tempfile.NamedTemporaryFile() as target:
  target.write(b'x'*{file_attack});target.flush()
except OSError as error:
 file_limited=error.errno in (errno.EFBIG,errno.ENOSPC)
print('PARENT_RLIMITS_OK' if memory and fd_limited and file_limited else 'PARENT_RLIMITS_BAD')"#,
        cpu = limits.cpu_seconds,
        address_space = limits.address_space_bytes,
        file_size = limits.file_bytes,
        open_files = limits.open_files,
        processes = limits.processes,
        memory_attack = limits.address_space_bytes.saturating_add(268_435_456),
        file_attack = limits.file_bytes.saturating_add(1),
    )
}

pub fn cirq_rlimit_probe_source(limits: ResourceLimits) -> String {
    format!(
        r#"import cirq
import resource
expected=[({cpu},{cpu}),({address_space},{address_space}),({file_size},{file_size}),({open_files},{open_files}),({processes},{processes}),(0,0)]
actual=[resource.getrlimit(item) for item in [resource.RLIMIT_CPU,resource.RLIMIT_AS,resource.RLIMIT_FSIZE,resource.RLIMIT_NOFILE,resource.RLIMIT_NPROC,resource.RLIMIT_CORE]]
assert actual == expected, (actual,expected)
q=cirq.LineQubit(0)
circuit=cirq.Circuit(cirq.H(q))"#,
        cpu = limits.cpu_seconds,
        address_space = limits.address_space_bytes,
        file_size = limits.file_bytes,
        open_files = limits.open_files,
        processes = limits.processes,
    )
}

fn validate_request_temp(
    context: &QualificationContext,
    request_temp: &Path,
) -> Result<PathBuf, String> {
    let request_temp = require_canonical(request_temp, "Agent request directory", true)?;
    if request_temp.parent() != Some(context.request_temp_root.as_path()) {
        return Err("Agent request directory escaped its canonical temp root".into());
    }
    Ok(request_temp)
}

pub fn worker_environment(
    environment: &AgentEnvironment,
    request_temp: &Path,
) -> Result<BTreeMap<String, String>, String> {
    let bin = environment
        .python
        .parent()
        .ok_or("Agent Python has no dedicated binary directory")?;
    let string = |path: &Path, description: &str| {
        path.to_str()
            .map(ToOwned::to_owned)
            .ok_or_else(|| format!("{description} is not valid UTF-8"))
    };
    let home = string(&request_temp.join("home"), "Worker HOME")?;
    let temp = string(&request_temp.join("tmp"), "Worker TMPDIR")?;
    let path = string(bin, "Worker PATH")?;
    Ok(BTreeMap::from([
        ("CUDA_VISIBLE_DEVICES".into(), String::new()),
        ("HOME".into(), home),
        ("LANG".into(), "C.UTF-8".into()),
        ("LC_ALL".into(), "C.UTF-8".into()),
        ("MKL_NUM_THREADS".into(), "1".into()),
        ("NUMEXPR_NUM_THREADS".into(), "1".into()),
        ("OMP_NUM_THREADS".into(), "1".into()),
        ("OPENBLAS_NUM_THREADS".into(), "1".into()),
        ("PATH".into(), path),
        ("PYTHONHASHSEED".into(), "0".into()),
        ("PYTHONNOUSERSITE".into(), "1".into()),
        ("PYTHONSAFEPATH".into(), "1".into()),
        ("PYTHONDONTWRITEBYTECODE".into(), "1".into()),
        ("QDK_PYTHON_TELEMETRY".into(), "none".into()),
        ("TMPDIR".into(), temp),
    ]))
}

/// Builds a pure deny-default Seatbelt policy.
///
/// The only permitted executable is the canonical dedicated Python. Seatbelt
/// policy remains attached across an exec of that same interpreter; shell and
/// system executables are never allowed.
pub fn build_seatbelt_profile(
    context: &QualificationContext,
    request_temp: &Path,
) -> Result<String, String> {
    context.system_paths.verify()?;
    let request_temp = validate_request_temp(context, request_temp)?;
    build_profile_for_canonical_paths(context, &request_temp)
}

fn build_profile_for_canonical_paths(
    context: &QualificationContext,
    request_temp: &Path,
) -> Result<String, String> {
    let mut profile = String::from(
        "(version 1)\n(deny default)\n\
         (deny network*)\n\
         (deny process-fork)\n\
         (allow process-exec\n",
    );
    push_filter(&mut profile, "literal", &context.environment.python, "  ")?;
    profile.push_str(")\n(allow file-read*\n");
    for root in [&context.environment.root, &context.resources.kernel_root]
        .into_iter()
        .chain(context.system_paths.read_roots.iter())
    {
        push_filter(&mut profile, "subpath", root, "  ")?;
    }
    for device in &context.system_paths.devices {
        push_filter(&mut profile, "literal", device, "  ")?;
    }
    profile.push_str(")\n(allow file-read-metadata\n");
    for parent in traversal_parents(context) {
        push_filter(&mut profile, "literal", &parent, "  ")?;
    }
    profile.push_str(")\n(allow file-write*\n");
    push_filter(&mut profile, "subpath", &request_temp, "  ")?;
    profile.push_str(")\n");
    Ok(profile)
}

fn traversal_parents(context: &QualificationContext) -> Vec<PathBuf> {
    let mut parents = Vec::new();
    for path in [
        &context.environment.root,
        &context.resources.kernel_root,
        &context.request_temp_root,
    ] {
        let mut current = path.parent();
        while let Some(parent) = current {
            if !parents.iter().any(|existing| existing == parent) {
                parents.push(parent.to_path_buf());
            }
            current = parent.parent();
        }
    }
    parents
}

fn push_filter(
    profile: &mut String,
    filter: &str,
    path: &Path,
    indent: &str,
) -> Result<(), String> {
    let literal = path
        .to_str()
        .ok_or("Seatbelt path literal is not valid UTF-8")?;
    profile.push_str(indent);
    profile.push('(');
    profile.push_str(filter);
    profile.push_str(" \"");
    profile.push_str(&escape_seatbelt_literal(literal)?);
    profile.push_str("\")\n");
    Ok(())
}

fn escape_seatbelt_literal(literal: &str) -> Result<String, String> {
    let mut escaped = String::with_capacity(literal.len());
    for character in literal.chars() {
        match character {
            '"' => escaped.push_str("\\\""),
            '\\' => escaped.push_str("\\\\"),
            character if character.is_control() => {
                return Err("Seatbelt path literal contains a control character".into())
            }
            character => escaped.push(character),
        }
    }
    Ok(escaped)
}

pub fn qualification_cache_key(context: &QualificationContext) -> Result<String, String> {
    let control = HashControl::new(IDENTITY_TIMEOUT);
    let first = compute_qualification_cache_key(context, &control)?;
    let second = compute_qualification_cache_key(context, &control)?;
    if first != second {
        return Err("Runtime identity changed during hashing".into());
    }
    Ok(first)
}

pub async fn qualification_cache_key_async(
    context: QualificationContext,
) -> Result<String, String> {
    qualification_cache_key_with_deadline(context, IDENTITY_TIMEOUT).await
}

pub async fn qualification_cache_key_with_deadline(
    context: QualificationContext,
    timeout: Duration,
) -> Result<String, String> {
    let cancelled = Arc::new(AtomicBool::new(false));
    let mut cancellation = HashCancellation {
        cancelled: Arc::clone(&cancelled),
        armed: true,
    };
    let mut work = tokio::task::spawn_blocking(move || {
        let _active = ActiveHasher::new();
        let control = HashControl {
            cancelled,
            deadline: std::time::Instant::now() + timeout,
        };
        let first = compute_qualification_cache_key(&context, &control)?;
        let second = compute_qualification_cache_key(&context, &control)?;
        if first != second {
            return Err("Runtime identity changed during hashing".into());
        }
        Ok(first)
    });
    let result = tokio::select! {
        joined = &mut work => {
            joined.map_err(|_| "Runtime identity hashing task failed".to_string())?
        }
        _ = tokio::time::sleep(timeout) => {
            cancellation.cancelled.store(true, Ordering::Release);
            let _ = work.await;
            return Err("Runtime identity hashing exceeded its deadline".into());
        }
    };
    cancellation.disarm();
    result
}

#[doc(hidden)]
pub fn active_identity_hashers_for_test() -> usize {
    ACTIVE_IDENTITY_HASHERS.load(Ordering::Acquire)
}

struct ActiveHasher;

impl ActiveHasher {
    fn new() -> Self {
        ACTIVE_IDENTITY_HASHERS.fetch_add(1, Ordering::AcqRel);
        Self
    }
}

impl Drop for ActiveHasher {
    fn drop(&mut self) {
        ACTIVE_IDENTITY_HASHERS.fetch_sub(1, Ordering::AcqRel);
    }
}

struct HashCancellation {
    cancelled: Arc<AtomicBool>,
    armed: bool,
}

impl HashCancellation {
    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for HashCancellation {
    fn drop(&mut self) {
        if self.armed {
            self.cancelled.store(true, Ordering::Release);
        }
    }
}

struct HashControl {
    cancelled: Arc<AtomicBool>,
    deadline: std::time::Instant,
}

impl HashControl {
    fn new(timeout: Duration) -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
            deadline: std::time::Instant::now() + timeout,
        }
    }

    fn checkpoint(&self) -> Result<(), String> {
        if self.cancelled.load(Ordering::Acquire) {
            return Err("Runtime identity hashing was cancelled".into());
        }
        if std::time::Instant::now() >= self.deadline {
            return Err("Runtime identity hashing exceeded its deadline".into());
        }
        Ok(())
    }
}

fn compute_qualification_cache_key(
    context: &QualificationContext,
    control: &HashControl,
) -> Result<String, String> {
    control.checkpoint()?;
    context.system_paths.verify()?;
    let mut digest = Sha256::new();
    hash_field(&mut digest, b"format", b"nuclei-runtime-identity-v3");
    hash_field(&mut digest, b"app-version", context.app_version.as_bytes());
    let profile = build_profile_for_canonical_paths(
        context,
        &context.request_temp_root.join("CACHE_REQUEST"),
    )?;
    hash_field(&mut digest, b"profile-version", PROFILE_VERSION.as_bytes());
    hash_field(&mut digest, b"profile", profile.as_bytes());
    for path in [
        &context.resources.kernel_root,
        &context.environment.root,
        &context.request_temp_root,
    ] {
        hash_field(
            &mut digest,
            b"canonical-path",
            path.to_str()
                .ok_or("Qualification cache path is not valid UTF-8")?
                .as_bytes(),
        );
    }
    let mut budget = IdentityBudget::default();
    hash_regular_file(
        &mut digest,
        b"requirements",
        &context.resources.requirements,
        &mut budget,
        control,
    )?;
    hash_tree(
        &mut digest,
        b"kernel-tree",
        &context.resources.kernel_root,
        &mut budget,
        control,
    )?;
    hash_tree(
        &mut digest,
        b"environment-tree",
        &context.environment.root,
        &mut budget,
        control,
    )?;
    hash_regular_file(
        &mut digest,
        b"sandbox-exec",
        &context.system_paths.sandbox_exec,
        &mut budget,
        control,
    )?;
    Ok(hex::encode(digest.finalize()))
}

#[derive(Default)]
struct IdentityBudget {
    entries: usize,
    bytes: u64,
}

fn hash_field(digest: &mut Sha256, tag: &[u8], value: &[u8]) {
    digest.update((tag.len() as u64).to_le_bytes());
    digest.update(tag);
    digest.update((value.len() as u64).to_le_bytes());
    digest.update(value);
}

fn hash_tree(
    digest: &mut Sha256,
    tag: &[u8],
    root: &Path,
    budget: &mut IdentityBudget,
    control: &HashControl,
) -> Result<(), String> {
    control.checkpoint()?;
    let canonical = require_canonical(root, "Runtime identity tree", true)?;
    require_owned_nonwritable(
        &fs::symlink_metadata(&canonical)
            .map_err(|error| format!("Runtime identity root metadata failed: {error}"))?,
    )?;
    hash_field(
        digest,
        tag,
        canonical
            .to_str()
            .ok_or("Runtime identity tree path is not valid UTF-8")?
            .as_bytes(),
    );
    let mut pending = vec![canonical.clone()];
    while let Some(directory) = pending.pop() {
        let mut entries = fs::read_dir(&directory)
            .map_err(|error| format!("Runtime identity tree could not be read: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Runtime identity entry could not be read: {error}"))?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries.into_iter().rev() {
            control.checkpoint()?;
            budget.entries = budget
                .entries
                .checked_add(1)
                .ok_or("Runtime identity entry count overflowed")?;
            if budget.entries > MAX_IDENTITY_ENTRIES {
                return Err("Runtime identity tree exceeded the entry limit".into());
            }
            let path = entry.path();
            let relative = path
                .strip_prefix(&canonical)
                .map_err(|_| "Runtime identity entry escaped its root")?;
            let relative = relative
                .to_str()
                .ok_or("Runtime identity entry path is not valid UTF-8")?;
            let metadata = fs::symlink_metadata(&path)
                .map_err(|error| format!("Runtime identity metadata failed: {error}"))?;
            require_owned_nonwritable(&metadata)?;
            if metadata.file_type().is_symlink() {
                return Err("Runtime identity tree contains a symlink".into());
            }
            if metadata.is_dir() {
                hash_field(digest, b"directory", relative.as_bytes());
                pending.push(path);
            } else if metadata.is_file() {
                hash_field(digest, b"file-path", relative.as_bytes());
                hash_regular_file(digest, b"file-content", &path, budget, control)?;
            } else {
                return Err("Runtime identity tree contains a nonregular entry".into());
            }
        }
    }
    Ok(())
}

#[cfg(unix)]
fn require_owned_nonwritable(metadata: &fs::Metadata) -> Result<(), String> {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    if metadata.uid() != unsafe { libc::geteuid() } {
        return Err("Runtime identity tree entry is not owned by the current uid".into());
    }
    if metadata.permissions().mode() & 0o022 != 0 {
        return Err("Runtime identity tree entry is group/world writable".into());
    }
    Ok(())
}

#[cfg(not(unix))]
fn require_owned_nonwritable(_metadata: &fs::Metadata) -> Result<(), String> {
    Ok(())
}

fn hash_regular_file(
    digest: &mut Sha256,
    tag: &[u8],
    path: &Path,
    budget: &mut IdentityBudget,
    control: &HashControl,
) -> Result<(), String> {
    control.checkpoint()?;
    let metadata_before = fs::symlink_metadata(path)
        .map_err(|error| format!("Runtime identity file metadata failed: {error}"))?;
    if !metadata_before.is_file() || metadata_before.file_type().is_symlink() {
        return Err("Runtime identity input is not a regular file".into());
    }
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("Runtime identity file is unavailable: {error}"))?;
    if canonical != path {
        return Err("Runtime identity file must be canonical".into());
    }
    budget.bytes = budget
        .bytes
        .checked_add(metadata_before.len())
        .ok_or("Runtime identity byte count overflowed")?;
    if budget.bytes > MAX_IDENTITY_BYTES {
        return Err("Runtime identity inputs exceeded the byte limit".into());
    }
    hash_field(
        digest,
        b"file-identity",
        canonical
            .to_str()
            .ok_or("Runtime identity file path is not valid UTF-8")?
            .as_bytes(),
    );
    digest.update((tag.len() as u64).to_le_bytes());
    digest.update(tag);
    digest.update(metadata_before.len().to_le_bytes());
    let mut file = fs::File::open(&canonical)
        .map_err(|error| format!("Runtime identity file could not be opened: {error}"))?;
    let mut remaining = metadata_before.len();
    let mut buffer = [0_u8; 64 * 1024];
    while remaining > 0 {
        control.checkpoint()?;
        let requested = usize::try_from(remaining.min(buffer.len() as u64))
            .map_err(|_| "Runtime identity read size overflowed")?;
        let read = file
            .read(&mut buffer[..requested])
            .map_err(|error| format!("Runtime identity file could not be read: {error}"))?;
        if read == 0 {
            return Err("Runtime identity file was truncated while hashing".into());
        }
        digest.update(&buffer[..read]);
        remaining -= read as u64;
    }
    let mut extra = [0_u8; 1];
    if file
        .read(&mut extra)
        .map_err(|error| format!("Runtime identity file could not be completed: {error}"))?
        != 0
    {
        return Err("Runtime identity file grew while hashing".into());
    }
    let metadata_after = file
        .metadata()
        .map_err(|error| format!("Runtime identity file could not be rechecked: {error}"))?;
    if metadata_after.len() != metadata_before.len()
        || metadata_after.modified().ok() != metadata_before.modified().ok()
    {
        return Err("Runtime identity file changed while hashing".into());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
pub(crate) async fn qualify(context: &QualificationContext) -> CapabilityReport {
    match LockedRuntimeIdentity::acquire(context.clone()).await {
        Ok(locked) => qualify_locked(&locked).await,
        Err(error) => unavailable(error),
    }
}

#[cfg(target_os = "macos")]
pub(crate) async fn qualify_locked(locked: &LockedRuntimeIdentity) -> CapabilityReport {
    qualify_macos(locked.context(), locked.cache_key()).await
}

#[cfg(target_os = "macos")]
fn unavailable(reason: impl Into<String>) -> CapabilityReport {
    CapabilityReport {
        available: false,
        reason: Some(reason.into()),
        qualified_frameworks: Vec::new(),
        controls: Vec::new(),
    }
}

#[cfg(target_os = "macos")]
async fn qualify_macos(context: &QualificationContext, expected_key: &str) -> CapabilityReport {
    match qualify_macos_inner(context, expected_key).await {
        Ok(()) => CapabilityReport {
            available: true,
            reason: None,
            qualified_frameworks: vec!["cirq".into()],
            controls: [
                "seatbelt",
                "filesystem_read",
                "filesystem_write",
                "network",
                "fork",
                "exec",
                "clean_environment",
                "stdout_limit",
                "rlimits",
                "cirq",
                "cleanup",
            ]
            .into_iter()
            .map(|name| ControlResult {
                name: name.into(),
                self_test_passed: true,
            })
            .collect(),
        },
        Err(error) => unavailable(error),
    }
}

#[cfg(target_os = "macos")]
async fn qualify_macos_inner(
    context: &QualificationContext,
    expected_key: &str,
) -> Result<(), String> {
    context.environment.verify()?;
    context.system_paths.verify_production()?;
    let baseline = ParentBaseline::create(context)?;
    let qualification = async {

    denied_probe(
        context,
        &format!("open({:?}).read()", baseline.project_sentinel),
        "project sentinel read",
    )
    .await?;
    denied_probe(
        context,
        &format!("open({:?}).read()", baseline.home_sentinel),
        "home sentinel read",
    )
    .await?;

    let clean = run_probe(
        context,
        "import json,os;print(json.dumps(dict(sorted(os.environ.items())),separators=(',',':')))",
    )
    .await?;
    let clean_validation = (|| {
        if !clean.success {
            return Err("clean environment probe failed".to_string());
        }
        let actual: BTreeMap<String, String> = serde_json::from_slice(trim_ascii(&clean.stdout))
            .map_err(|_| "Clean environment probe returned malformed JSON".to_string())?;
        let probe_temp = clean
            .request_temp
            .as_ref()
            .map(ProbeRequestDirectory::path)
            .ok_or("Clean environment probe lost its request directory")?;
        let expected = worker_environment(&context.environment, probe_temp)?;
        if actual != expected {
            return Err("Worker environment did not exactly match the allowlist".into());
        }
        if context
            .parent_secret_names
            .iter()
            .any(|name| actual.contains_key(name))
        {
            return Err("A parent credential reached the worker environment".into());
        }
        Ok(())
    })();
    match (clean_validation, clean.cleanup()) {
        (Ok(()), Ok(())) => {}
        (Err(error), Ok(())) => return Err(error),
        (Ok(()), Err(cleanup)) => return Err(cleanup),
        (Err(error), Err(cleanup)) => return Err(format!("{error}; {cleanup}")),
    }

    for (name, script) in [
        (
            "IPv4 socket",
            "import socket;socket.create_connection(('1.1.1.1',53),1)",
        ),
        (
            "IPv6 socket",
            "import socket;s=socket.socket(socket.AF_INET6);s.connect(('::1',9))",
        ),
        (
            "Unix socket",
            "import socket;s=socket.socket(socket.AF_UNIX);s.connect('/tmp/nuclei-agent-test.sock')",
        ),
        (
            "system executable",
            "import subprocess;subprocess.run(['/usr/bin/id'],check=True)",
        ),
        ("fork", "import os;os.fork()"),
    ] {
        denied_probe(context, script, name).await?;
    }

    denied_probe(
        context,
        &format!("open({:?},'w').write('escaped')", baseline.write_target),
        "write outside request temp",
    )
    .await?;
    if baseline.write_target.exists() {
        return Err("Write-outside-temp probe unexpectedly created a file".into());
    }

    symlink_probe(context, &baseline.project_sentinel).await?;
    same_interpreter_exec_probe(context, &baseline.project_sentinel).await?;
    stdout_flood_probe(context).await?;
    rlimit_probe(context).await?;
    cirq_probe(context).await?;
        let final_key = qualification_cache_key_async(context.clone()).await?;
        if final_key != expected_key {
            return Err("Runtime identity changed during macOS qualification".into());
        }
    Ok(())
    }
    .await;
    let cleanup = baseline.cleanup();
    match (qualification, cleanup) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(error), Ok(())) => Err(error),
        (Ok(()), Err(cleanup)) => Err(cleanup),
        (Err(error), Err(cleanup)) => Err(format!("{error}; {cleanup}")),
    }
}

#[cfg(target_os = "macos")]
struct ParentBaseline {
    project_sentinel: PathBuf,
    home_sentinel: PathBuf,
    write_target: PathBuf,
}

#[cfg(target_os = "macos")]
impl ParentBaseline {
    fn create(context: &QualificationContext) -> Result<Self, String> {
        use std::io::Write;

        let nonce = uuid::Uuid::new_v4();
        let baseline = Self {
            project_sentinel: context
                .project_root
                .join(format!(".nuclei-seatbelt-read-{nonce}")),
            home_sentinel: context
                .home_root
                .join(format!(".nuclei-seatbelt-read-{nonce}")),
            write_target: context
                .project_root
                .join(format!(".nuclei-seatbelt-write-{nonce}")),
        };
        let evidence = format!("nuclei-parent-baseline-{nonce}");
        for path in [&baseline.project_sentinel, &baseline.home_sentinel] {
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(path)
                .map_err(|error| format!("Trusted parent could not create sentinel: {error}"))?;
            file.write_all(evidence.as_bytes())
                .map_err(|error| format!("Trusted parent could not write sentinel: {error}"))?;
            if fs::read_to_string(path)
                .map_err(|error| format!("Trusted parent could not read sentinel: {error}"))?
                != evidence
            {
                return Err("Trusted parent sentinel evidence was inconsistent".into());
            }
        }
        let mut target = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&baseline.write_target)
            .map_err(|error| {
                format!("Trusted parent could not create outside-write target: {error}")
            })?;
        target.write_all(evidence.as_bytes()).map_err(|error| {
            format!("Trusted parent could not write outside-write target: {error}")
        })?;
        drop(target);
        if fs::read_to_string(&baseline.write_target).map_err(|error| {
            format!("Trusted parent could not read outside-write target: {error}")
        })? != evidence
        {
            return Err("Trusted parent outside-write evidence was inconsistent".into());
        }
        fs::remove_file(&baseline.write_target).map_err(|error| {
            format!("Trusted parent could not remove outside-write target: {error}")
        })?;
        Ok(baseline)
    }

    fn cleanup(mut self) -> Result<(), String> {
        let mut failure = None;
        for path in [
            &self.project_sentinel,
            &self.home_sentinel,
            &self.write_target,
        ] {
            if path.exists() {
                if let Err(error) = fs::remove_file(path) {
                    failure.get_or_insert_with(|| {
                        format!("Trusted parent qualification cleanup failed: {error}")
                    });
                }
            }
        }
        self.project_sentinel.clear();
        self.home_sentinel.clear();
        self.write_target.clear();
        failure.map_or(Ok(()), Err)
    }
}

#[cfg(target_os = "macos")]
impl Drop for ParentBaseline {
    fn drop(&mut self) {
        for path in [
            &self.project_sentinel,
            &self.home_sentinel,
            &self.write_target,
        ] {
            if !path.as_os_str().is_empty() {
                let _ = fs::remove_file(path);
            }
        }
    }
}

#[cfg(target_os = "macos")]
struct ProbeResult {
    success: bool,
    signal: Option<i32>,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    request_temp: Option<ProbeRequestDirectory>,
}

struct ProbeRequestDirectory {
    path: Option<PathBuf>,
    inject_cleanup_failure: bool,
}

impl ProbeRequestDirectory {
    fn create(root: &Path, description: &str) -> Result<Self, String> {
        let path = root.join(format!("qualification-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&path)
            .map_err(|error| format!("Failed to create {description} temp: {error}"))?;
        // Ownership starts immediately after create_dir succeeds. No fallible
        // probe setup is allowed before this guard exists.
        let mut guard = Self {
            path: Some(path),
            inject_cleanup_failure: false,
        };
        match guard.path().canonicalize() {
            Ok(canonical) => {
                guard.path = Some(canonical);
                Ok(guard)
            }
            Err(error) => {
                guard.finalize(Err(format!("{description} temp is unavailable: {error}")))
            }
        }
    }

    fn path(&self) -> &Path {
        self.path
            .as_deref()
            .expect("probe request directory was already finalized")
    }

    fn finalize<T>(mut self, result: Result<T, String>) -> Result<T, String> {
        let path = self
            .path
            .take()
            .ok_or("Qualification request directory was already finalized")?;
        let cleanup = match fs::remove_dir_all(&path) {
            Ok(()) if !path.exists() => Ok(()),
            Ok(()) => Err("qualification cleanup left a request directory".to_string()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("qualification cleanup failed: {error}")),
        }
        .and_then(|()| {
            if self.inject_cleanup_failure {
                Err("qualification cleanup failed: injected failure".into())
            } else {
                Ok(())
            }
        });
        match (result, cleanup) {
            (Ok(value), Ok(())) => Ok(value),
            (Err(error), Ok(())) => Err(error),
            (Ok(_), Err(cleanup)) => Err(cleanup),
            (Err(error), Err(cleanup)) => Err(format!("{error}; {cleanup}")),
        }
    }
}

impl Drop for ProbeRequestDirectory {
    fn drop(&mut self) {
        if let Some(path) = self.path.take() {
            let _ = fs::remove_dir_all(path);
        }
    }
}

#[doc(hidden)]
pub fn probe_request_guard_failure_for_test(
    root: &Path,
    stage: &str,
    cleanup_failure: bool,
) -> Result<(), String> {
    let mut guard = ProbeRequestDirectory::create(root, "qualification request")?;
    guard.inject_cleanup_failure = cleanup_failure;
    guard.finalize(Err(format!("injected {stage} failure")))
}

#[cfg(target_os = "macos")]
impl ProbeResult {
    fn cleanup(mut self) -> Result<(), String> {
        if let Some(request_temp) = self.request_temp.take() {
            request_temp.finalize(Ok(()))?;
        }
        Ok(())
    }
}

#[cfg(target_os = "macos")]
fn probe_failure(result: ProbeResult, reason: String) -> String {
    match result.cleanup() {
        Ok(()) => reason,
        Err(cleanup) => format!("{reason}; {cleanup}"),
    }
}

#[cfg(target_os = "macos")]
async fn run_probe(context: &QualificationContext, body: &str) -> Result<ProbeResult, String> {
    run_probe_with_limit(context, body, PROBE_OUTPUT_LIMIT, PROBE_TIMEOUT).await
}

#[cfg(target_os = "macos")]
async fn run_probe_with_limit(
    context: &QualificationContext,
    body: &str,
    output_limit: usize,
    timeout: Duration,
) -> Result<ProbeResult, String> {
    use std::process::Stdio;
    use tokio::io::AsyncReadExt;

    let request_temp =
        ProbeRequestDirectory::create(&context.request_temp_root, "qualification request")?;
    let outcome = async {
        let spec = MacBackend::probe_spec(context, request_temp.path(), body)?;
        let mut command = unix_command(&spec);
        command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut child = command
            .spawn()
            .map_err(|error| format!("Qualification probe could not start: {error}"))?;
        let stdout = child.stdout.take().ok_or("Probe stdout was not piped")?;
        let stderr = child.stderr.take().ok_or("Probe stderr was not piped")?;
        let read_stdout = tokio::spawn(async move {
            let mut bytes = Vec::new();
            stdout
                .take((output_limit + 1) as u64)
                .read_to_end(&mut bytes)
                .await
                .map(|_| bytes)
        });
        let read_stderr = tokio::spawn(async move {
            let mut bytes = Vec::new();
            stderr
                .take((PROBE_OUTPUT_LIMIT + 1) as u64)
                .read_to_end(&mut bytes)
                .await
                .map(|_| bytes)
        });
        let status = match tokio::time::timeout(timeout, child.wait()).await {
            Ok(Ok(status)) => status,
            Ok(Err(error)) => {
                let kill = child.start_kill();
                let reap = child.wait().await;
                return Err(format!(
                    "Qualification probe wait failed: {error}; kill={kill:?}; reap={reap:?}"
                ));
            }
            Err(_) => {
                let kill = child.start_kill();
                let reap = child.wait().await;
                return Err(format!(
                    "Qualification probe exceeded its deadline; kill={kill:?}; reap={reap:?}"
                ));
            }
        };
        use std::os::unix::process::ExitStatusExt;
        let signal = status.signal();
        let stdout = read_stdout
            .await
            .map_err(|_| "Qualification stdout reader failed")?
            .map_err(|_| "Qualification stdout could not be read")?;
        let stderr = read_stderr
            .await
            .map_err(|_| "Qualification stderr reader failed")?
            .map_err(|_| "Qualification stderr could not be read")?;
        Ok((status.success(), signal, stdout, stderr))
    }
    .await;
    match outcome {
        Ok((success, signal, stdout, stderr)) => Ok(ProbeResult {
            success,
            signal,
            stdout,
            stderr,
            request_temp: Some(request_temp),
        }),
        Err(error) => request_temp.finalize(Err(error)),
    }
}

#[cfg(target_os = "macos")]
async fn denied_probe(
    context: &QualificationContext,
    attack: &str,
    description: &str,
) -> Result<(), String> {
    let script = format!(
        "import errno\ntry:\n exec({attack:?})\nexcept OSError as error:\n print('DENIED',error.errno)\n raise SystemExit(0)\nprint('UNEXPECTED_SUCCESS')"
    );
    let result = run_probe(context, &script).await?;
    let output = String::from_utf8_lossy(&result.stdout);
    let denied_errno = output
        .strip_prefix("DENIED ")
        .and_then(|value| value.trim().parse::<i32>().ok())
        .is_some_and(|errno| matches!(errno, libc::EACCES | libc::EPERM));
    if !result.success || !denied_errno || output.contains("UNEXPECTED_SUCCESS") {
        let diagnostic = String::from_utf8_lossy(&result.stderr).into_owned();
        return Err(probe_failure(
            result,
            format!("{description} was not denied for a sandbox permission reason: {diagnostic}"),
        ));
    }
    result.cleanup()
}

#[cfg(target_os = "macos")]
async fn symlink_probe(
    context: &QualificationContext,
    outside_sentinel: &Path,
) -> Result<(), String> {
    use std::os::unix::fs::symlink;

    let request_temp = ProbeRequestDirectory::create(&context.request_temp_root, "symlink probe")?;
    let setup = (|| {
        let escape = request_temp.path().join("escape");
        let outside = outside_sentinel
            .parent()
            .ok_or("Project sentinel has no parent")?;
        symlink(outside, &escape)
            .map_err(|error| format!("Failed to create escape symlink: {error}"))?;
        Ok(escape.join(format!("escaped-{}", uuid::Uuid::new_v4())))
    })();
    let target = match setup {
        Ok(target) => target,
        Err(error) => return request_temp.finalize(Err(error)),
    };
    let script = format!(
        "import errno\ntry:\n open({target:?},'w').write('escaped')\nexcept OSError as error:\n print('DENIED',error.errno)\n raise SystemExit(0)\nprint('UNEXPECTED_SUCCESS')"
    );
    let result = run_existing_probe(context, request_temp, &script).await?;
    let output = String::from_utf8_lossy(&result.stdout);
    let denied = output
        .strip_prefix("DENIED ")
        .and_then(|value| value.trim().parse::<i32>().ok())
        .is_some_and(|errno| matches!(errno, libc::EACCES | libc::EPERM));
    if !result.success || !denied || target.exists() {
        return Err(probe_failure(
            result,
            "Symlink escape was not denied by Seatbelt".into(),
        ));
    }
    result.cleanup()
}

#[cfg(target_os = "macos")]
async fn run_existing_probe(
    context: &QualificationContext,
    request_temp: ProbeRequestDirectory,
    body: &str,
) -> Result<ProbeResult, String> {
    use std::process::Stdio;

    let outcome = async {
        let spec = MacBackend::probe_spec(context, request_temp.path(), body)?;
        let mut command = unix_command(&spec);
        command.stdin(Stdio::null()).kill_on_drop(true);
        let output = match tokio::time::timeout(PROBE_TIMEOUT, command.output()).await {
            Ok(Ok(output)) => output,
            Ok(Err(error)) => return Err(format!("Qualification probe failed to run: {error}")),
            Err(_) => return Err("Qualification probe exceeded its deadline".into()),
        };
        if output.stdout.len() > PROBE_OUTPUT_LIMIT || output.stderr.len() > PROBE_OUTPUT_LIMIT {
            return Err("Qualification probe output exceeded its cap".into());
        }
        Ok(output)
    }
    .await;
    match outcome {
        Ok(output) => Ok(ProbeResult {
            success: output.status.success(),
            signal: {
                use std::os::unix::process::ExitStatusExt;
                output.status.signal()
            },
            stdout: output.stdout,
            stderr: output.stderr,
            request_temp: Some(request_temp),
        }),
        Err(error) => request_temp.finalize(Err(error)),
    }
}

#[cfg(target_os = "macos")]
async fn same_interpreter_exec_probe(
    context: &QualificationContext,
    project_sentinel: &Path,
) -> Result<(), String> {
    let child = format!(
        "import errno\ntry:\n open({:?}).read()\nexcept OSError as error:\n print('SAME_EXEC_DENIED',error.errno)\n raise SystemExit(0)\nprint('UNEXPECTED_SUCCESS')",
        project_sentinel
    );
    let script = format!(
        "import os,sys;os.execve(sys.executable,[sys.executable,'-I','-c',{child:?}],dict(os.environ))"
    );
    let result = run_probe(context, &script).await?;
    let output = String::from_utf8_lossy(&result.stdout);
    let denied = output
        .strip_prefix("SAME_EXEC_DENIED ")
        .and_then(|value| value.trim().parse::<i32>().ok())
        .is_some_and(|errno| matches!(errno, libc::EACCES | libc::EPERM));
    if !result.success || !denied {
        return Err(probe_failure(
            result,
            "Same-interpreter exec did not remain inside the qualified Seatbelt policy".into(),
        ));
    }
    result.cleanup()
}

#[cfg(target_os = "macos")]
async fn stdout_flood_probe(context: &QualificationContext) -> Result<(), String> {
    let request_temp = ProbeRequestDirectory::create(&context.request_temp_root, "stdout probe")?;
    let spec = match MacBackend::probe_spec(
        context,
        request_temp.path(),
        "import os\nwhile True: os.write(1,b'x'*8192)",
    ) {
        Ok(spec) => spec,
        Err(error) => return request_temp.finalize(Err(error)),
    };
    let request = WorkerRequestV1 {
        protocol_version: 1,
        request_id: format!("qualification_stdout_{}", uuid::Uuid::new_v4()),
        action: Action::Parse,
        framework: Framework::Cirq,
        language: "python".into(),
        code: String::new(),
        shots: None,
    };
    let outcome = match Supervisor::new(SupervisorLimits::production())
        .run(&request, spec, b"")
        .await
    {
        Ok(_) => Err("Stdout flood unexpectedly produced a worker response".into()),
        Err(error) if error.code == "response_too_large" => Ok(()),
        Err(error) => Err(format!(
            "Stdout flood did not traverse the production capped reader: {}",
            error.message
        )),
    };
    request_temp.finalize(outcome)
}

#[cfg(target_os = "macos")]
async fn rlimit_probe(context: &QualificationContext) -> Result<(), String> {
    let result = run_probe(
        context,
        &resource_limit_probe_script(ResourceLimits::production()),
    )
    .await?;
    if !result.success {
        return Err(probe_failure(
            result,
            "memory/fd rlimit probe failed".into(),
        ));
    }
    if trim_ascii(&result.stdout) != b"PARENT_RLIMITS_OK" {
        return Err(probe_failure(
            result,
            "Parent rlimit probe returned malformed evidence".into(),
        ));
    }
    result.cleanup()?;

    let cpu = run_probe_with_limit(
        context,
        "while True: pass",
        1_024,
        Duration::from_secs(ResourceLimits::production().cpu_seconds + 3),
    )
    .await?;
    if cpu.success || !matches!(cpu.signal, Some(libc::SIGXCPU) | Some(libc::SIGKILL)) {
        return Err(probe_failure(
            cpu,
            "CPU rlimit probe did not terminate for the expected signal".into(),
        ));
    }
    cpu.cleanup()
}

#[cfg(target_os = "macos")]
async fn cirq_probe(context: &QualificationContext) -> Result<(), String> {
    let request_temp = ProbeRequestDirectory::create(&context.request_temp_root, "Cirq probe")?;
    let spec = match MacBackend::worker_spec(context, request_temp.path()) {
        Ok(spec) => spec,
        Err(error) => return request_temp.finalize(Err(error)),
    };
    let request = WorkerRequestV1 {
        protocol_version: 1,
        request_id: "qualification_cirq".into(),
        action: Action::Parse,
        framework: Framework::Cirq,
        language: "python".into(),
        code: cirq_rlimit_probe_source(ResourceLimits::production()),
        shots: None,
    };
    let mut input = match serde_json::to_vec(&request) {
        Ok(input) => input,
        Err(_) => {
            return request_temp.finalize(Err("Cirq probe request could not be encoded".into()))
        }
    };
    input.push(b'\n');
    let outcome = Supervisor::new(SupervisorLimits::production())
        .run(&request, spec, &input)
        .await
        .map(|_| ())
        .map_err(|error| format!("Cirq parse probe failed: {}", error.message));
    request_temp.finalize(outcome)
}

#[cfg(target_os = "macos")]
fn trim_ascii(bytes: &[u8]) -> &[u8] {
    let start = bytes
        .iter()
        .position(|byte| !byte.is_ascii_whitespace())
        .unwrap_or(bytes.len());
    let end = bytes
        .iter()
        .rposition(|byte| !byte.is_ascii_whitespace())
        .map_or(start, |position| position + 1);
    &bytes[start..end]
}
