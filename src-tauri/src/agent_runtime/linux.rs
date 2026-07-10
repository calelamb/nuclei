use crate::agent_runtime::macos::worker_environment;
use crate::agent_runtime::process::{
    CleanupFailureSink, CleanupResource, LaunchVerifier, ParentLaunchVerifier,
    ProcessCleanupResource, ProcessSpec, ResourceLimits,
};
use crate::agent_runtime::protocol::WorkerRequestV1;
use crate::agent_runtime::resources::{AgentEnvironment, ResourcePaths, RunnerContainment};
use crate::agent_runtime::{AgentProcessResolver, CapabilityReport, ControlResult};
use fs2::FileExt;
use seccompiler::{
    BpfProgram, SeccompAction, SeccompCmpArgLen, SeccompCmpOp, SeccompCondition, SeccompFilter,
    SeccompRule, TargetArch,
};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::convert::TryInto;
use std::ffi::CString;
use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const BWRAP: &str = "/usr/bin/bwrap";
const IDENTITY_VERSION: &str = "nuclei-linux-runtime-v1";
const IDENTITY_TIMEOUT: Duration = Duration::from_secs(120);
const CGROUP_CLEANUP_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_IDENTITY_ENTRIES: usize = 50_000;
const MAX_IDENTITY_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const CGROUP2_SUPER_MAGIC: libc::c_long = 0x6367_7270;

#[doc(hidden)]
pub const fn production_identity_timeout_for_test() -> Duration {
    IDENTITY_TIMEOUT
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CgroupBackend {
    Production,
    InjectedTest,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RuntimeBind {
    pub source: PathBuf,
    pub destination: PathBuf,
}

#[derive(Clone, Debug)]
pub struct LinuxSystemPaths {
    pub runtime_binds: Vec<RuntimeBind>,
    pub devices: Vec<PathBuf>,
    pub bwrap: PathBuf,
    pub cgroup_root: PathBuf,
    production: bool,
}

impl LinuxSystemPaths {
    #[doc(hidden)]
    pub fn for_tests(
        read_roots: Vec<PathBuf>,
        devices: Vec<PathBuf>,
        bwrap: PathBuf,
        cgroup_root: PathBuf,
    ) -> Result<Self, String> {
        let paths = Self {
            runtime_binds: read_roots
                .into_iter()
                .map(|path| RuntimeBind {
                    source: path.clone(),
                    destination: path,
                })
                .collect(),
            devices,
            bwrap,
            cgroup_root,
            production: false,
        };
        paths.verify(false)?;
        Ok(paths)
    }

    pub fn production() -> Result<Self, String> {
        let mut runtime_binds = Vec::new();
        for (source, destination) in [
            ("/usr/lib", "/usr/lib"),
            ("/usr/lib", "/lib"),
            ("/usr/lib64", "/usr/lib64"),
            ("/usr/lib64", "/lib64"),
            ("/etc/ld.so.cache", "/etc/ld.so.cache"),
        ] {
            let source = PathBuf::from(source);
            if source.exists() {
                runtime_binds.push(RuntimeBind {
                    source: source
                        .canonicalize()
                        .map_err(|error| format!("Linux runtime root is unavailable: {error}"))?,
                    destination: PathBuf::from(destination),
                });
            }
        }
        let cgroup_root = std::env::var_os("NUCLEI_AGENT_CGROUP_ROOT")
            .map(PathBuf::from)
            .ok_or("NUCLEI_AGENT_CGROUP_ROOT is required for explicit Linux qualification")?;
        let bwrap = std::env::var_os("NUCLEI_AGENT_BWRAP")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(BWRAP));
        let paths = Self {
            runtime_binds,
            devices: Vec::new(),
            bwrap,
            cgroup_root,
            production: true,
        };
        paths.verify(true)?;
        Ok(paths)
    }

    fn verify(&self, production: bool) -> Result<(), String> {
        require_canonical(&self.bwrap, "bubblewrap executable", false)?;
        require_regular_file(&self.bwrap, "bubblewrap executable")?;
        require_trusted_executable(&self.bwrap)?;
        require_canonical(&self.cgroup_root, "delegated cgroup v2 root", true)?;
        for bind in &self.runtime_binds {
            require_canonical(
                &bind.source,
                "Linux host runtime bind source",
                bind.source.is_dir(),
            )?;
            if !bind.destination.is_absolute() || bind.destination == Path::new("/") {
                return Err("Linux host runtime bind destination is too broad".into());
            }
        }
        for device in &self.devices {
            require_canonical(device, "Linux host device", false)?;
        }
        if production && !self.production {
            return Err("Injected Linux system paths cannot qualify production".into());
        }
        Ok(())
    }

    pub fn verify_production(&self) -> Result<(), String> {
        self.verify(true)
    }

    fn cgroup_backend(&self) -> CgroupBackend {
        if self.production {
            CgroupBackend::Production
        } else {
            CgroupBackend::InjectedTest
        }
    }
}

#[derive(Clone, Debug)]
pub struct LinuxQualificationContext {
    pub app_version: String,
    pub resources: ResourcePaths,
    pub environment: AgentEnvironment,
    pub request_temp_root: PathBuf,
    pub runtime_lock: PathBuf,
    pub project_root: PathBuf,
    pub home_root: PathBuf,
    pub parent_secret_names: BTreeSet<String>,
    pub system_paths: LinuxSystemPaths,
}

impl LinuxQualificationContext {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        app_version: impl Into<String>,
        resources: ResourcePaths,
        environment: AgentEnvironment,
        request_temp_root: &Path,
        project_root: &Path,
        home_root: &Path,
        parent_secret_names: BTreeSet<String>,
        system_paths: LinuxSystemPaths,
    ) -> Result<Self, String> {
        environment.verify()?;
        let environment_root =
            require_canonical(&environment.root, "Agent environment root", true)?;
        let python = require_canonical(&environment.python, "Agent Python", false)?;
        let site_packages =
            require_canonical(&environment.site_packages, "Agent site-packages", true)?;
        let environment = AgentEnvironment {
            root: environment_root,
            python,
            site_packages,
        };
        if resources != ResourcePaths::generation(&environment)? {
            return Err(
                "Agent kernel must be the allowlisted copy inside the locked runtime generation"
                    .into(),
            );
        }
        let request_temp_root =
            require_canonical(request_temp_root, "Agent request temp root", true)?;
        let project_root = require_canonical(project_root, "Project qualification root", true)?;
        let home_root = require_canonical(home_root, "Home qualification root", true)?;
        let runtime_lock = require_canonical(
            &environment
                .root
                .parent()
                .ok_or("Agent environment has no generation parent")?
                .join(".provision.lock"),
            "Agent runtime generation lock",
            false,
        )?;
        require_regular_file(&runtime_lock, "Agent runtime generation lock")?;
        for outside in [&request_temp_root, &project_root, &home_root] {
            if outside.starts_with(&environment.root) || environment.root.starts_with(outside) {
                return Err("Linux qualification roots overlap the locked generation".into());
            }
        }
        if parent_secret_names
            .iter()
            .any(|name| name.is_empty() || name.contains(['=', '\0']))
        {
            return Err("Parent qualification environment contains an invalid name".into());
        }
        system_paths.verify(system_paths.production)?;
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
                .ok_or_else(|| format!("{name} is required for explicit Linux qualification"))
        };
        let environment = AgentEnvironment {
            root: require_canonical(
                &required("NUCLEI_AGENT_ENVIRONMENT_ROOT")?,
                "Agent environment root",
                true,
            )?,
            python: require_canonical(&required("NUCLEI_AGENT_PYTHON")?, "Agent Python", false)?,
            site_packages: require_canonical(
                &required("NUCLEI_AGENT_SITE_PACKAGES")?,
                "Agent site-packages",
                true,
            )?,
        };
        let resources = ResourcePaths::generation(&environment)?;
        let supplied_kernel = require_canonical(
            &required("NUCLEI_AGENT_KERNEL_ROOT")?,
            "Agent kernel root",
            true,
        )?;
        if supplied_kernel != resources.kernel_root {
            return Err("Explicit agent kernel is not the locked generation copy".into());
        }
        Self::new(
            app_version,
            resources,
            environment,
            &required("NUCLEI_AGENT_REQUEST_TEMP_ROOT")?,
            &required("NUCLEI_AGENT_PROJECT_ROOT")?,
            &required("NUCLEI_AGENT_HOME_ROOT")?,
            [
                "ANTHROPIC_API_KEY",
                "IBM_QUANTUM_TOKEN",
                "AWS_SECRET_ACCESS_KEY",
            ]
            .into_iter()
            .map(str::to_owned)
            .collect(),
            LinuxSystemPaths::production()?,
        )
    }
}

pub struct LockedLinuxRuntimeIdentity {
    context: LinuxQualificationContext,
    cache_key: String,
    _lease: Arc<fs::File>,
}

impl LockedLinuxRuntimeIdentity {
    pub async fn acquire(context: LinuxQualificationContext) -> Result<Self, String> {
        let lease = LinuxBackend::runtime_lease(&context)?;
        let cache_key = qualification_cache_key_async(context.clone()).await?;
        Ok(Self {
            context,
            cache_key,
            _lease: lease,
        })
    }

    pub async fn from_explicit_environment(app_version: &str) -> Result<Self, String> {
        let root = std::env::var_os("NUCLEI_AGENT_ENVIRONMENT_ROOT")
            .map(PathBuf::from)
            .ok_or("NUCLEI_AGENT_ENVIRONMENT_ROOT is required for explicit Linux qualification")?;
        let lock = root
            .parent()
            .ok_or("Explicit Linux environment has no generation parent")?
            .join(".provision.lock");
        let lease = runtime_lease_path(&lock)?;
        let context = LinuxQualificationContext::from_explicit_environment(app_version)?;
        if context.runtime_lock != lock {
            return Err("Explicit Linux runtime lock changed during validation".into());
        }
        let cache_key = qualification_cache_key_async(context.clone()).await?;
        Ok(Self {
            context,
            cache_key,
            _lease: lease,
        })
    }

    pub fn context(&self) -> &LinuxQualificationContext {
        &self.context
    }

    pub fn cache_key(&self) -> &str {
        &self.cache_key
    }
}

#[derive(Clone, Debug)]
pub struct LinuxLaunchSpec {
    inner: Arc<LinuxContainment>,
}

impl LinuxLaunchSpec {
    pub fn cgroup_path(&self) -> &Path {
        &self.inner.cgroup_path
    }

    pub(crate) fn prepare_pre_exec(&self) -> std::io::Result<()> {
        let fd = self.inner.seccomp.as_raw_fd();
        if unsafe { libc::fcntl(fd, libc::F_SETFD, 0) } == -1 {
            return Err(std::io::Error::last_os_error());
        }
        let cgroup_fd = unsafe {
            libc::open(
                self.inner.cgroup_procs.as_ptr(),
                libc::O_WRONLY | libc::O_CLOEXEC,
            )
        };
        if cgroup_fd == -1 {
            return Err(std::io::Error::last_os_error());
        }
        let joined = unsafe { libc::write(cgroup_fd, b"0".as_ptr().cast(), 1) };
        let write_error = (joined != 1).then(std::io::Error::last_os_error);
        let close_result = unsafe { libc::close(cgroup_fd) };
        if let Some(error) = write_error {
            return Err(error);
        }
        if close_result == -1 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(())
    }

    pub(crate) fn kill(&self) -> Result<(), String> {
        self.inner.kill()
    }

    pub(crate) fn finish(&self) -> Result<(), String> {
        self.inner.finish()
    }

    pub(crate) fn validates_command(&self, executable: &Path, args: &[String]) -> bool {
        if executable != self.inner.bwrap {
            return false;
        }
        let fd = self.inner.seccomp.as_raw_fd().to_string();
        args.windows(2)
            .any(|pair| pair[0] == "--seccomp" && pair[1] == fd)
    }
}

#[derive(Debug)]
struct LinuxContainment {
    bwrap: PathBuf,
    cgroup_path: PathBuf,
    cgroup_procs: CString,
    seccomp: fs::File,
    reporter: CleanupFailureSink,
    backend: CgroupBackend,
    evidence_expectation: Option<CgroupEvidenceExpectation>,
    cleaned: AtomicBool,
    cleanup_lock: Mutex<()>,
}

impl LinuxContainment {
    fn report<T>(&self, result: Result<T, String>) -> Result<T, String> {
        if let Err(error) = &result {
            self.reporter.report(error);
        }
        result
    }

    fn kill(&self) -> Result<(), String> {
        if self.cleaned.load(Ordering::Acquire) {
            return Ok(());
        }
        self.report(
            fs::write(self.cgroup_path.join("cgroup.kill"), b"1")
                .map_err(|error| format!("Failed to kill Linux worker cgroup: {error}")),
        )
    }

    fn verify_expected_evidence(&self) -> Result<(), String> {
        let Some(expectation) = &self.evidence_expectation else {
            return Ok(());
        };
        let current = fs::read_to_string(self.cgroup_path.join(evidence_file(expectation.kind)))
            .map_err(|error| {
                format!(
                    "Failed to read Linux {} evidence: {error}",
                    evidence_file(expectation.kind)
                )
            })?;
        verify_cgroup_event_delta(expectation.kind, &expectation.baseline, &current)
    }

    fn finish(&self) -> Result<(), String> {
        let _serial = self
            .cleanup_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if self.cleaned.load(Ordering::Acquire) {
            return Ok(());
        }
        let evidence = self.verify_expected_evidence();
        let cleanup = (|| {
            self.kill()?;
            let deadline = Instant::now() + CGROUP_CLEANUP_TIMEOUT;
            loop {
                let events = fs::read_to_string(self.cgroup_path.join("cgroup.events"))
                    .map_err(|error| format!("Failed to read Linux cgroup events: {error}"))?;
                if events
                    .lines()
                    .any(|line| line.split_whitespace().eq(["populated", "0"]))
                {
                    break;
                }
                if Instant::now() >= deadline {
                    return Err(
                        "Linux worker cgroup remained populated past cleanup deadline".into(),
                    );
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            if self.backend == CgroupBackend::InjectedTest {
                fs::remove_dir_all(&self.cgroup_path)
            } else {
                fs::remove_dir(&self.cgroup_path)
            }
            .map_err(|error| format!("Failed to remove Linux worker cgroup: {error}"))?;
            self.cleaned.store(true, Ordering::Release);
            Ok(())
        })();
        let result = match (evidence, cleanup) {
            (Ok(()), Ok(())) => Ok(()),
            (Err(error), Ok(())) | (Ok(()), Err(error)) => Err(error),
            (Err(evidence), Err(cleanup)) => Err(format!("{evidence}; {cleanup}")),
        };
        self.report(result)
    }
}

impl Drop for LinuxContainment {
    fn drop(&mut self) {
        if !self.cleaned.load(Ordering::Acquire) {
            if let Err(error) = self.finish() {
                self.reporter.report(&error);
            }
        }
    }
}

impl ProcessCleanupResource for LinuxLaunchSpec {
    fn name(&self) -> &'static str {
        "linux-cgroup"
    }

    fn terminate(&self) -> Result<(), String> {
        LinuxLaunchSpec::kill(self)
    }

    fn finish(&self) -> Result<(), String> {
        LinuxLaunchSpec::finish(self)
    }
}

impl ParentLaunchVerifier for LinuxLaunchSpec {
    fn verify_child(&self, pid: u32) -> Result<(), String> {
        let result = verify_worker_cgroup_placement(&self.inner.cgroup_path, pid);
        if let Err(error) = &result {
            self.inner.reporter.report(error);
        }
        result
    }
}

fn verify_worker_cgroup_placement(path: &Path, pid: u32) -> Result<(), String> {
    let membership = fs::read_to_string(path.join("cgroup.procs"))
        .map_err(|error| format!("Trusted parent could not read worker cgroup.procs: {error}"))?;
    let expected = pid.to_string();
    if !membership.lines().any(|line| line.trim() == expected) {
        return Err(format!(
            "Trusted parent did not find the exact worker PID {pid} in its unique cgroup"
        ));
    }
    let events = fs::read_to_string(path.join("cgroup.events"))
        .map_err(|error| format!("Trusted parent could not read worker cgroup.events: {error}"))?;
    if counter_value(&events, "populated")? == 0 {
        return Err("Trusted parent observed an unpopulated worker cgroup after spawn".into());
    }
    Ok(())
}

#[doc(hidden)]
pub fn verify_worker_cgroup_placement_for_test(path: &Path, pid: u32) -> Result<(), String> {
    verify_worker_cgroup_placement(path, pid)
}

pub struct LinuxBackend;

impl LinuxBackend {
    pub fn runtime_lease(context: &LinuxQualificationContext) -> Result<Arc<fs::File>, String> {
        runtime_lease_path(&context.runtime_lock)
    }

    pub fn discover(context: &LinuxQualificationContext) -> Result<(), String> {
        context.system_paths.verify_production()?;
        verify_user_namespaces()?;
        verify_cgroup_delegation(
            &context.system_paths.cgroup_root,
            true,
            CgroupBackend::Production,
        )?;
        compile_seccomp_bpf()?;
        bwrap_namespace_self_test(&context.system_paths)?;
        Ok(())
    }

    pub fn worker_spec(
        context: &LinuxQualificationContext,
        request_temp: &Path,
    ) -> Result<ProcessSpec, String> {
        Self::worker_spec_with_reporter(context, request_temp, CleanupFailureSink::noop())
    }

    fn worker_spec_with_reporter(
        context: &LinuxQualificationContext,
        request_temp: &Path,
        reporter: CleanupFailureSink,
    ) -> Result<ProcessSpec, String> {
        Self::worker_spec_config(
            context,
            request_temp,
            reporter,
            CgroupLimits::production(),
            linux_resource_limits(),
            None,
        )
    }

    fn worker_spec_config(
        context: &LinuxQualificationContext,
        request_temp: &Path,
        reporter: CleanupFailureSink,
        cgroup_limits: CgroupLimits,
        resource_limits: ResourceLimits,
        evidence_kind: Option<CgroupProbeKind>,
    ) -> Result<ProcessSpec, String> {
        let request_temp = validate_request_temp(context, request_temp)?;
        let seccomp = sealed_seccomp_file()?;
        let seccomp_fd = seccomp.as_raw_fd();
        let cgroup_guard = create_worker_cgroup(
            &context.system_paths.cgroup_root,
            reporter.clone(),
            CgroupConstructionFault::default(),
            context.system_paths.cgroup_backend(),
            cgroup_limits,
        )?;
        let evidence_expectation = match evidence_kind {
            Some(kind) => match fs::read_to_string(cgroup_guard.path().join(evidence_file(kind))) {
                Ok(baseline) => Some(CgroupEvidenceExpectation { kind, baseline }),
                Err(error) => {
                    return cgroup_guard.fail(format!(
                        "Failed to read baseline Linux {}: {error}",
                        evidence_file(kind)
                    ))
                }
            },
            None => None,
        };
        let cgroup_path = cgroup_guard.path().to_path_buf();
        let cgroup_procs = CString::new(
            cgroup_path
                .join("cgroup.procs")
                .as_os_str()
                .as_encoded_bytes(),
        )
        .map_err(|_| "Linux cgroup path contains NUL")?;
        let environment = sandbox_environment(&context.environment)?;
        let mut args = vec![
            "--die-with-parent".into(),
            "--new-session".into(),
            "--unshare-all".into(),
            "--unshare-net".into(),
            "--clearenv".into(),
            "--tmpfs".into(),
            "/tmp".into(),
            "--proc".into(),
            "/proc".into(),
            "--dev".into(),
            "/dev".into(),
            "--dir".into(),
            "/home".into(),
            "--dir".into(),
            "/home/agent".into(),
            "--ro-bind".into(),
            context.environment.root.to_string_lossy().into_owned(),
            context.environment.root.to_string_lossy().into_owned(),
        ];
        for bind in &context.system_paths.runtime_binds {
            args.extend([
                "--ro-bind".into(),
                bind.source.to_string_lossy().into_owned(),
                bind.destination.to_string_lossy().into_owned(),
            ]);
        }
        for (name, value) in &environment {
            args.extend(["--setenv".into(), name.clone(), value.clone()]);
        }
        args.extend([
            "--chdir".into(),
            "/tmp".into(),
            "--seccomp".into(),
            seccomp_fd.to_string(),
            "--".into(),
            sandbox_path(&context.environment.root, &context.environment.python)?,
            "-I".into(),
            sandbox_path(&context.environment.root, &context.resources.worker)?,
        ]);
        let linux = LinuxLaunchSpec {
            inner: Arc::new(LinuxContainment {
                bwrap: context.system_paths.bwrap.clone(),
                cgroup_path: cgroup_path.clone(),
                cgroup_procs,
                seccomp,
                reporter: reporter.clone(),
                backend: context.system_paths.cgroup_backend(),
                evidence_expectation,
                cleaned: AtomicBool::new(false),
                cleanup_lock: Mutex::new(()),
            }),
        };
        let committed = cgroup_guard.commit();
        debug_assert_eq!(committed, cgroup_path);
        let spec = ProcessSpec {
            executable: context.system_paths.bwrap.clone(),
            args,
            cwd: request_temp.clone(),
            env: environment,
            cleanup_root: Some(request_temp),
            resource_limits,
            runtime_guard: None,
            cleanup_resources: vec![CleanupResource::new(Arc::new(linux.clone()))],
            cleanup_reporter: Some(reporter),
            launch_verifier: Some(LaunchVerifier::new(Arc::new(linux.clone()))),
            linux: Some(linux),
        };
        Ok(spec)
    }

    pub fn probe_spec(
        context: &LinuxQualificationContext,
        request_temp: &Path,
        script: &str,
    ) -> Result<ProcessSpec, String> {
        let mut spec = Self::worker_spec(context, request_temp)?;
        Self::replace_worker_with_probe(context, &mut spec, script)?;
        Ok(spec)
    }

    fn replace_worker_with_probe(
        context: &LinuxQualificationContext,
        spec: &mut ProcessSpec,
        script: &str,
    ) -> Result<(), String> {
        let worker = sandbox_path(&context.environment.root, &context.resources.worker)?;
        let position = spec
            .args
            .iter()
            .rposition(|arg| arg == &worker)
            .ok_or("Linux worker argument was not found")?;
        spec.args.truncate(position);
        spec.args.extend(["-I".into(), "-c".into(), script.into()]);
        Ok(())
    }
}

pub struct LinuxResolver {
    context: LinuxQualificationContext,
    installed_generation: u64,
    installed_key: String,
    cleanup_reporter: Mutex<CleanupFailureSink>,
    created_cgroups: Mutex<BTreeSet<PathBuf>>,
    created_request_dirs: Mutex<BTreeSet<PathBuf>>,
}

impl LinuxResolver {
    pub fn new(
        context: LinuxQualificationContext,
        installed_generation: u64,
        installed_key: String,
    ) -> Self {
        Self {
            context,
            installed_generation,
            installed_key,
            cleanup_reporter: Mutex::new(CleanupFailureSink::noop()),
            created_cgroups: Mutex::new(BTreeSet::new()),
            created_request_dirs: Mutex::new(BTreeSet::new()),
        }
    }

    async fn resolve_spec(
        &self,
        probe: Option<&str>,
        policy: Option<CgroupProbeKind>,
    ) -> Result<ProcessSpec, String> {
        let runtime_guard = LinuxBackend::runtime_lease(&self.context)?;
        if qualification_cache_key_async(self.context.clone()).await? != self.installed_key {
            return Err(
                "Qualified Linux backend identity changed; requalification required".into(),
            );
        }
        let request_temp = self
            .context
            .request_temp_root
            .join(format!("request-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&request_temp)
            .map_err(|error| format!("Failed to create Linux request temp: {error}"))?;
        let request_temp = request_temp
            .canonicalize()
            .map_err(|error| format!("Linux request temp is unavailable: {error}"))?;
        self.created_request_dirs
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(request_temp.clone());
        let reporter = self
            .cleanup_reporter
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        let result = match (probe, policy) {
            (Some(_), Some(_)) => {
                return Err("Linux cgroup policy probes must use the worker protocol".into())
            }
            (Some(script), None) => LinuxBackend::probe_spec(&self.context, &request_temp, script),
            (None, Some(kind)) => {
                let policy = qualification_cgroup_policy(kind);
                LinuxBackend::worker_spec_config(
                    &self.context,
                    &request_temp,
                    reporter,
                    CgroupLimits::from_policy(policy),
                    policy.resource_limits,
                    Some(kind),
                )
            }
            (None, None) => {
                LinuxBackend::worker_spec_with_reporter(&self.context, &request_temp, reporter)
            }
        };
        match result {
            Ok(mut spec) => {
                if let Some(path) = spec.linux.as_ref().map(LinuxLaunchSpec::cgroup_path) {
                    self.created_cgroups
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner())
                        .insert(path.to_path_buf());
                }
                spec.runtime_guard = Some(runtime_guard);
                Ok(spec)
            }
            Err(error) => match fs::remove_dir_all(&request_temp) {
                Ok(()) => Err(error),
                Err(cleanup) => Err(format!(
                    "{error}; failed to clean Linux request temp: {cleanup}"
                )),
            },
        }
    }

    async fn resolve_probe(&self, script: &str) -> Result<ProcessSpec, String> {
        self.resolve_spec(Some(script), None).await
    }

    async fn resolve_worker_with_policy(
        &self,
        kind: CgroupProbeKind,
    ) -> Result<ProcessSpec, String> {
        self.resolve_spec(None, Some(kind)).await
    }

    fn created_cgroups(&self) -> Vec<PathBuf> {
        self.created_cgroups
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .iter()
            .cloned()
            .collect()
    }

    fn created_request_dirs(&self) -> Vec<PathBuf> {
        self.created_request_dirs
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .iter()
            .cloned()
            .collect()
    }
}

impl AgentProcessResolver for LinuxResolver {
    fn set_cleanup_failure_reporter(&self, reporter: CleanupFailureSink) {
        *self
            .cleanup_reporter
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = reporter;
    }

    fn installed_identity(&self) -> Option<(u64, &str)> {
        Some((self.installed_generation, &self.installed_key))
    }

    fn rebind_installed_identity(
        &self,
        generation: u64,
        key: &str,
    ) -> Option<Arc<dyn AgentProcessResolver>> {
        Some(Arc::new(Self::new(
            self.context.clone(),
            generation,
            key.into(),
        )))
    }

    fn resolve<'a>(
        &'a self,
        _request: &'a WorkerRequestV1,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<ProcessSpec, String>> + Send + 'a>>
    {
        Box::pin(self.resolve_spec(None, None))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OfflineLinuxProvisioningContainment;

impl OfflineLinuxProvisioningContainment {
    pub fn containment(self) -> RunnerContainment {
        RunnerContainment::Unavailable
    }
}

pub fn compile_seccomp_bpf() -> Result<Vec<u8>, String> {
    let arch: TargetArch = std::env::consts::ARCH
        .try_into()
        .map_err(|_| "Linux seccomp architecture is unsupported")?;
    let mut rules = BTreeMap::new();
    for syscall in [
        libc::SYS_socket,
        libc::SYS_socketpair,
        libc::SYS_connect,
        libc::SYS_bind,
        libc::SYS_listen,
        libc::SYS_accept,
        libc::SYS_accept4,
        libc::SYS_fork,
        libc::SYS_vfork,
        libc::SYS_clone3,
        libc::SYS_execveat,
    ] {
        rules.insert(syscall, Vec::new());
    }
    let clone_without_thread = SeccompCondition::new(
        0,
        SeccompCmpArgLen::Qword,
        SeccompCmpOp::MaskedEq(libc::CLONE_THREAD as u64),
        0,
    )
    .map_err(|error| format!("Linux clone seccomp condition failed: {error}"))?;
    rules.insert(
        libc::SYS_clone,
        vec![SeccompRule::new(vec![clone_without_thread])
            .map_err(|error| format!("Linux clone seccomp rule failed: {error}"))?],
    );
    let program: BpfProgram = SeccompFilter::new(
        rules,
        SeccompAction::Allow,
        SeccompAction::Errno(libc::EPERM as u32),
        arch,
    )
    .map_err(|error| format!("Linux seccomp filter is invalid: {error}"))?
    .try_into()
    .map_err(|error| format!("Linux seccomp filter compilation failed: {error}"))?;
    let mut bytes = Vec::with_capacity(program.len() * 8);
    for instruction in program {
        bytes.extend_from_slice(&instruction.code.to_ne_bytes());
        bytes.push(instruction.jt);
        bytes.push(instruction.jf);
        bytes.extend_from_slice(&instruction.k.to_ne_bytes());
    }
    if bytes.is_empty() {
        return Err("Linux seccomp compiler returned an empty filter".into());
    }
    Ok(bytes)
}

fn sealed_seccomp_file() -> Result<fs::File, String> {
    let name = CString::new("nuclei-seccomp").expect("constant has no NUL");
    let fd =
        unsafe { libc::memfd_create(name.as_ptr(), libc::MFD_CLOEXEC | libc::MFD_ALLOW_SEALING) };
    if fd == -1 {
        return Err(format!(
            "Linux seccomp memfd is unavailable: {}",
            std::io::Error::last_os_error()
        ));
    }
    let mut file = unsafe { fs::File::from_raw_fd(fd) };
    file.write_all(&compile_seccomp_bpf()?)
        .map_err(|error| format!("Linux seccomp filter write failed: {error}"))?;
    file.seek(SeekFrom::Start(0))
        .map_err(|error| format!("Linux seccomp filter rewind failed: {error}"))?;
    let seals = libc::F_SEAL_SEAL | libc::F_SEAL_SHRINK | libc::F_SEAL_GROW | libc::F_SEAL_WRITE;
    if unsafe { libc::fcntl(file.as_raw_fd(), libc::F_ADD_SEALS, seals) } == -1 {
        return Err(format!(
            "Linux seccomp filter sealing failed: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(file)
}

#[derive(Clone, Debug, Default)]
struct CgroupConstructionFault {
    setup_stage: Option<String>,
    cleanup_stage: Option<String>,
}

#[derive(Clone, Copy, Debug)]
struct CgroupLimits {
    memory_max: u64,
    pids_max: u64,
    cpu_quota: u64,
    cpu_period: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CgroupProbeKind {
    Memory,
    Pids,
    Cpu,
}

#[derive(Clone, Copy, Debug)]
pub struct QualificationCgroupPolicy {
    pub memory_max: u64,
    pub pids_max: u64,
    pub cpu_quota: u64,
    pub cpu_period: u64,
    pub resource_limits: ResourceLimits,
}

fn qualification_cgroup_policy(kind: CgroupProbeKind) -> QualificationCgroupPolicy {
    let mut resource_limits = linux_resource_limits();
    match kind {
        CgroupProbeKind::Memory => {
            resource_limits.address_space_bytes = 2_147_483_648;
            QualificationCgroupPolicy {
                memory_max: 402_653_184,
                pids_max: 64,
                cpu_quota: 100_000,
                cpu_period: 100_000,
                resource_limits,
            }
        }
        CgroupProbeKind::Pids => QualificationCgroupPolicy {
            memory_max: 1_073_741_824,
            pids_max: 12,
            cpu_quota: 100_000,
            cpu_period: 100_000,
            resource_limits,
        },
        CgroupProbeKind::Cpu => QualificationCgroupPolicy {
            memory_max: 1_073_741_824,
            pids_max: 64,
            cpu_quota: 25_000,
            cpu_period: 100_000,
            resource_limits,
        },
    }
}

fn linux_resource_limits() -> ResourceLimits {
    let mut limits = ResourceLimits::production();
    // RLIMIT_NPROC is uid-wide, so a tiny value can block bwrap namespace
    // setup based on unrelated parent processes. The request cgroup's
    // pids.max remains the authoritative per-worker process limit.
    limits.processes = 1_024;
    limits
}

#[doc(hidden)]
pub fn qualification_cgroup_policy_for_test(kind: CgroupProbeKind) -> QualificationCgroupPolicy {
    qualification_cgroup_policy(kind)
}

#[derive(Debug)]
struct CgroupEvidenceExpectation {
    kind: CgroupProbeKind,
    baseline: String,
}

fn evidence_file(kind: CgroupProbeKind) -> &'static str {
    match kind {
        CgroupProbeKind::Memory => "memory.events",
        CgroupProbeKind::Pids => "pids.events",
        CgroupProbeKind::Cpu => "cpu.stat",
    }
}

fn counter_value(contents: &str, name: &str) -> Result<u64, String> {
    let mut matching = contents.lines().filter_map(|line| {
        let mut fields = line.split_whitespace();
        let key = fields.next()?;
        let value = fields.next()?;
        (key == name && fields.next().is_none()).then_some(value)
    });
    let value = matching
        .next()
        .ok_or_else(|| format!("cgroup evidence lacks {name}"))?;
    if matching.next().is_some() {
        return Err(format!("cgroup evidence duplicates {name}"));
    }
    value
        .parse()
        .map_err(|_| format!("cgroup evidence has invalid {name}"))
}

fn verify_cgroup_event_delta(
    kind: CgroupProbeKind,
    before: &str,
    after: &str,
) -> Result<(), String> {
    let increased = |name| -> Result<bool, String> {
        Ok(counter_value(after, name)? > counter_value(before, name)?)
    };
    let passed = match kind {
        CgroupProbeKind::Memory => increased("oom")? && increased("oom_kill")?,
        CgroupProbeKind::Pids => increased("max")?,
        CgroupProbeKind::Cpu => increased("nr_throttled")? && increased("throttled_usec")?,
    };
    if !passed {
        return Err(format!(
            "Linux {kind:?} cgroup controller produced no required counter delta"
        ));
    }
    Ok(())
}

#[doc(hidden)]
pub fn verify_cgroup_event_delta_for_test(
    kind: CgroupProbeKind,
    before: &str,
    after: &str,
) -> Result<(), String> {
    verify_cgroup_event_delta(kind, before, after)
}

impl CgroupLimits {
    const fn production() -> Self {
        Self {
            memory_max: 1_073_741_824,
            pids_max: 4,
            cpu_quota: 100_000,
            cpu_period: 100_000,
        }
    }

    const fn from_policy(policy: QualificationCgroupPolicy) -> Self {
        Self {
            memory_max: policy.memory_max,
            pids_max: policy.pids_max,
            cpu_quota: policy.cpu_quota,
            cpu_period: policy.cpu_period,
        }
    }
}

struct CgroupConstructionGuard {
    path: Option<PathBuf>,
    reporter: CleanupFailureSink,
    backend: CgroupBackend,
    cleanup_stage: Option<String>,
}

impl CgroupConstructionGuard {
    fn path(&self) -> &Path {
        self.path
            .as_deref()
            .expect("cgroup construction guard already finalized")
    }

    fn cleanup(&mut self) -> Result<(), String> {
        let Some(path) = self.path.as_ref() else {
            return Ok(());
        };
        if self.cleanup_stage.as_deref() == Some("cgroup.kill") {
            return Err("injected cgroup construction cleanup failure at cgroup.kill".into());
        }
        fs::write(path.join("cgroup.kill"), "1")
            .map_err(|error| format!("cgroup construction kill cleanup failed: {error}"))?;
        if self.cleanup_stage.as_deref() == Some("cgroup.events") {
            return Err("injected cgroup construction cleanup failure at cgroup.events".into());
        }
        if self.cleanup_stage.as_deref() == Some("populated") {
            return Err("injected cgroup construction cleanup failure at populated".into());
        }
        let deadline = Instant::now() + CGROUP_CLEANUP_TIMEOUT;
        loop {
            let events = fs::read_to_string(path.join("cgroup.events"))
                .map_err(|error| format!("cgroup construction events cleanup failed: {error}"))?;
            if events
                .lines()
                .any(|line| line.split_whitespace().eq(["populated", "0"]))
            {
                break;
            }
            if Instant::now() >= deadline {
                return Err("cgroup construction cleanup exceeded populated deadline".into());
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        if self.cleanup_stage.as_deref() == Some("remove") {
            return Err("injected cgroup construction cleanup failure at remove".into());
        }
        if self.backend == CgroupBackend::InjectedTest {
            fs::remove_dir_all(path)
        } else {
            fs::remove_dir(path)
        }
        .map_err(|error| format!("cgroup construction removal cleanup failed: {error}"))?;
        self.path.take();
        Ok(())
    }

    fn fail<T>(mut self, setup_error: String) -> Result<T, String> {
        match self.cleanup() {
            Ok(()) => Err(setup_error),
            Err(cleanup_error) => {
                self.reporter.report(&cleanup_error);
                Err(format!("{setup_error}; {cleanup_error}"))
            }
        }
    }

    fn commit(mut self) -> PathBuf {
        self.path
            .take()
            .expect("cgroup construction guard commits exactly once")
    }
}

impl Drop for CgroupConstructionGuard {
    fn drop(&mut self) {
        if self.path.is_some() {
            if let Err(error) = self.cleanup() {
                self.reporter.report(&error);
            }
        }
    }
}

fn create_worker_cgroup(
    root: &Path,
    reporter: CleanupFailureSink,
    fault: CgroupConstructionFault,
    backend: CgroupBackend,
    limits: CgroupLimits,
) -> Result<CgroupConstructionGuard, String> {
    let child = root.join(format!("request-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&child)
        .map_err(|error| format!("Failed to create Linux worker cgroup: {error}"))?;
    let guard = CgroupConstructionGuard {
        path: Some(child),
        reporter,
        backend,
        cleanup_stage: fault.cleanup_stage,
    };
    if backend == CgroupBackend::InjectedTest {
        for (name, value) in [
            ("cgroup.type", "domain\n"),
            ("memory.max", ""),
            ("memory.swap.max", ""),
            ("pids.max", ""),
            ("cpu.max", ""),
            ("cgroup.procs", ""),
            ("cgroup.kill", ""),
            ("cgroup.events", "populated 0\n"),
            ("memory.events", "oom 0\noom_kill 0\n"),
            ("pids.events", "max 0\n"),
            ("cpu.stat", "nr_throttled 0\nthrottled_usec 0\n"),
        ] {
            if let Err(error) = fs::write(guard.path().join(name), value) {
                return guard.fail(format!(
                    "Failed to create test Linux cgroup control {name}: {error}"
                ));
            }
        }
    }
    let memory_max = limits.memory_max.to_string();
    let pids_max = limits.pids_max.to_string();
    let cpu_max = format!("{} {}", limits.cpu_quota, limits.cpu_period);
    for (name, value) in [
        ("memory.max", memory_max.as_str()),
        ("memory.swap.max", "0"),
        ("pids.max", pids_max.as_str()),
        ("cpu.max", cpu_max.as_str()),
    ] {
        if fault.setup_stage.as_deref() == Some(name) {
            return guard.fail(format!("injected cgroup setup failure at {name}"));
        }
        if let Err(error) = fs::write(guard.path().join(name), value) {
            return guard.fail(format!("Failed to set Linux cgroup {name}: {error}"));
        }
    }
    for name in [
        "cgroup.type",
        "cgroup.procs",
        "cgroup.kill",
        "cgroup.events",
        "memory.events",
        "pids.events",
        "cpu.stat",
    ] {
        if fault.setup_stage.as_deref() == Some(name) {
            return guard.fail(format!("injected cgroup setup failure at {name}"));
        }
        if !guard.path().join(name).exists() {
            return guard.fail(format!("Linux worker cgroup lacks {name}"));
        }
    }
    let cgroup_type = fs::read_to_string(guard.path().join("cgroup.type"))
        .map_err(|error| format!("Linux worker cgroup type is unavailable: {error}"));
    match cgroup_type {
        Ok(value) if value.trim() == "domain" => {}
        Ok(value) => {
            return guard.fail(format!(
                "Linux worker cgroup has invalid type {}",
                value.trim()
            ))
        }
        Err(error) => return guard.fail(error),
    }
    Ok(guard)
}

#[doc(hidden)]
pub fn cgroup_construction_failure_for_test(
    root: &Path,
    stage: &str,
    cleanup_failure: bool,
    reporter: CleanupFailureSink,
) -> Result<(), String> {
    let fault = CgroupConstructionFault {
        setup_stage: Some(stage.into()),
        cleanup_stage: cleanup_failure.then(|| "remove".into()),
    };
    match create_worker_cgroup(
        root,
        reporter,
        fault,
        CgroupBackend::InjectedTest,
        CgroupLimits::production(),
    ) {
        Ok(guard) => guard.fail("injected setup stage did not fire".into()),
        Err(error) => Err(error),
    }
}

#[doc(hidden)]
pub fn cgroup_construction_cleanup_failure_for_test(
    root: &Path,
    setup_stage: &str,
    cleanup_stage: &str,
    reporter: CleanupFailureSink,
) -> Result<(), String> {
    let fault = CgroupConstructionFault {
        setup_stage: Some(setup_stage.into()),
        cleanup_stage: Some(cleanup_stage.into()),
    };
    match create_worker_cgroup(
        root,
        reporter,
        fault,
        CgroupBackend::InjectedTest,
        CgroupLimits::production(),
    ) {
        Ok(guard) => guard.fail("injected setup stage did not fire".into()),
        Err(error) => Err(error),
    }
}

fn verify_cgroup_delegation(
    root: &Path,
    probe: bool,
    backend: CgroupBackend,
) -> Result<(), String> {
    if backend == CgroupBackend::Production {
        verify_production_cgroup_filesystem(root)?;
    }
    let root_metadata = fs::metadata(root)
        .map_err(|error| format!("Delegated cgroup metadata is unavailable: {error}"))?;
    if root_metadata.uid() != unsafe { libc::geteuid() } {
        return Err("Delegated cgroup root is not owned by the application uid".into());
    }
    if root_metadata.permissions().mode() & 0o022 != 0 {
        return Err("Delegated cgroup root is group/world writable".into());
    }
    require_delegated_writable(root, "delegated cgroup root")?;
    require_delegated_writable(
        &root.join("cgroup.subtree_control"),
        "delegated cgroup subtree control",
    )?;
    require_delegated_writable(
        &root.join("cgroup.procs"),
        "delegated cgroup process membership",
    )?;
    let root_type = fs::read_to_string(root.join("cgroup.type"))
        .map_err(|error| format!("Delegated cgroup type is unavailable: {error}"))?;
    if root_type.trim() != "domain" {
        return Err(format!(
            "Delegated cgroup has invalid cgroup.type {}; memory/pids policy requires a domain",
            root_type.trim()
        ));
    }
    let controller_text = fs::read_to_string(root.join("cgroup.controllers"))
        .map_err(|error| format!("cgroup v2 controllers are unavailable: {error}"))?;
    let enabled_text = fs::read_to_string(root.join("cgroup.subtree_control"))
        .map_err(|error| format!("cgroup v2 subtree controls are unavailable: {error}"))?;
    let controllers = words(&controller_text);
    let enabled = words(&enabled_text);
    for required in ["cpu", "memory", "pids"] {
        if !controllers.contains(required) || !enabled.contains(required) {
            return Err(format!(
                "Delegated cgroup v2 subtree has not enabled {required}"
            ));
        }
    }
    if probe {
        let mut guard = create_worker_cgroup(
            root,
            CleanupFailureSink::noop(),
            CgroupConstructionFault::default(),
            backend,
            CgroupLimits::production(),
        )?;
        let probe_result = (|| {
            fs::write(guard.path().join("cgroup.kill"), "1")
                .map_err(|error| format!("cgroup.kill probe failed: {error}"))?;
            let events = fs::read_to_string(guard.path().join("cgroup.events"))
                .map_err(|error| format!("cgroup.events probe failed: {error}"))?;
            if !events.contains("populated 0") {
                return Err("Fresh cgroup probe unexpectedly reported processes".into());
            }
            Ok(())
        })();
        let cleanup = guard.cleanup();
        match (probe_result, cleanup) {
            (Ok(()), Ok(())) => {}
            (Err(error), Ok(())) => return Err(error),
            (Ok(()), Err(cleanup)) => return Err(cleanup),
            (Err(error), Err(cleanup)) => return Err(format!("{error}; {cleanup}")),
        }
    }
    Ok(())
}

fn verify_production_cgroup_filesystem(root: &Path) -> Result<(), String> {
    let canonical = root
        .canonicalize()
        .map_err(|error| format!("Delegated cgroup canonicalization failed: {error}"))?;
    if canonical != root {
        return Err("Delegated cgroup root is not canonical".into());
    }
    if filesystem_magic(root)? != CGROUP2_SUPER_MAGIC {
        return Err("Delegated cgroup root is not on an actual cgroup v2 filesystem".into());
    }
    let mount = cgroup2_mount_for(root)?;
    if mount == root || !root.starts_with(&mount) {
        return Err(
            "Delegated cgroup root is not a strict descendant of its canonical cgroup v2 mount"
                .into(),
        );
    }
    Ok(())
}

fn filesystem_magic(path: &Path) -> Result<libc::c_long, String> {
    let encoded = CString::new(path.as_os_str().as_encoded_bytes())
        .map_err(|_| "Filesystem path contains NUL")?;
    let mut stat = std::mem::MaybeUninit::<libc::statfs>::uninit();
    if unsafe { libc::statfs(encoded.as_ptr(), stat.as_mut_ptr()) } != 0 {
        return Err(format!(
            "Could not stat delegated cgroup filesystem: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(unsafe { stat.assume_init() }.f_type as libc::c_long)
}

fn cgroup2_mount_for(root: &Path) -> Result<PathBuf, String> {
    let mountinfo = fs::read_to_string("/proc/self/mountinfo")
        .map_err(|error| format!("Linux mount table is unavailable: {error}"))?;
    let mut matches = mountinfo
        .lines()
        .filter_map(|line| {
            let (left, right) = line.split_once(" - ")?;
            if right.split_whitespace().next()? != "cgroup2" {
                return None;
            }
            let encoded_mount = left.split_whitespace().nth(4)?;
            let mount = PathBuf::from(unescape_mountinfo(encoded_mount));
            let canonical = mount.canonicalize().ok()?;
            root.starts_with(&canonical).then_some(canonical)
        })
        .collect::<Vec<_>>();
    matches.sort_by_key(|path| path.components().count());
    matches
        .pop()
        .ok_or_else(|| "Delegated cgroup root has no canonical cgroup v2 mount parent".into())
}

fn unescape_mountinfo(value: &str) -> String {
    value
        .replace("\\040", " ")
        .replace("\\011", "\t")
        .replace("\\012", "\n")
        .replace("\\134", "\\")
}

fn require_delegated_writable(path: &Path, description: &str) -> Result<(), String> {
    let metadata =
        fs::metadata(path).map_err(|error| format!("{description} metadata failed: {error}"))?;
    if metadata.uid() != unsafe { libc::geteuid() } {
        return Err(format!("{description} is not owned by the application uid"));
    }
    if metadata.permissions().mode() & 0o022 != 0 {
        return Err(format!("{description} is group/world writable"));
    }
    let encoded =
        CString::new(path.as_os_str().as_encoded_bytes()).map_err(|_| "Path contains NUL")?;
    if unsafe { libc::access(encoded.as_ptr(), libc::W_OK) } != 0 {
        return Err(format!(
            "{description} is not writable: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
}

#[doc(hidden)]
pub fn verify_production_cgroup_for_test(root: &Path) -> Result<(), String> {
    verify_cgroup_delegation(root, false, CgroupBackend::Production)
}

fn words(value: &str) -> BTreeSet<&str> {
    value
        .split_whitespace()
        .map(|word| word.trim_start_matches('+'))
        .collect()
}

fn verify_user_namespaces() -> Result<(), String> {
    if let Ok(value) = fs::read_to_string("/proc/sys/kernel/unprivileged_userns_clone") {
        if value.trim() != "1" {
            return Err("Unprivileged Linux user namespaces are disabled".into());
        }
    }
    Ok(())
}

fn bwrap_namespace_self_test(paths: &LinuxSystemPaths) -> Result<(), String> {
    let true_path = require_canonical(Path::new("/usr/bin/true"), "namespace probe", false)?;
    let mut command = std::process::Command::new(&paths.bwrap);
    command
        .env_clear()
        .args([
            "--die-with-parent",
            "--new-session",
            "--unshare-all",
            "--unshare-net",
            "--clearenv",
            "--proc",
            "/proc",
            "--dev",
            "/dev",
            "--ro-bind",
        ])
        .arg(&true_path)
        .arg("/probe");
    for bind in &paths.runtime_binds {
        command
            .arg("--ro-bind")
            .arg(&bind.source)
            .arg(&bind.destination);
    }
    let output = command
        .args(["--", "/probe"])
        .output()
        .map_err(|error| format!("bubblewrap namespace self-test could not start: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "bubblewrap user/mount/PID/network namespace self-test failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(())
}

fn sandbox_environment(
    agent_environment: &AgentEnvironment,
) -> Result<BTreeMap<String, String>, String> {
    let mut environment = worker_environment(agent_environment, Path::new(""))?;
    environment.insert("HOME".into(), "/home/agent".into());
    environment.insert("TMPDIR".into(), "/tmp".into());
    Ok(environment)
}

fn sandbox_path(root: &Path, child: &Path) -> Result<String, String> {
    child
        .strip_prefix(root)
        .map_err(|_| "Linux sandbox path escaped the locked generation")?;
    child
        .to_str()
        .map(str::to_owned)
        .ok_or("Linux sandbox path is not UTF-8".into())
}

fn validate_request_temp(
    context: &LinuxQualificationContext,
    request_temp: &Path,
) -> Result<PathBuf, String> {
    let request_temp = require_canonical(request_temp, "Agent request directory", true)?;
    if request_temp.parent() != Some(context.request_temp_root.as_path()) {
        return Err("Agent request directory escaped its canonical temp root".into());
    }
    Ok(request_temp)
}

fn runtime_lease_path(path: &Path) -> Result<Arc<fs::File>, String> {
    require_canonical(path, "Agent runtime generation lock", false)?;
    require_regular_file(path, "Agent runtime generation lock")?;
    require_owned_nonwritable(
        &fs::symlink_metadata(path)
            .map_err(|error| format!("Agent runtime generation lock metadata failed: {error}"))?,
    )?;
    let file = fs::OpenOptions::new()
        .read(true)
        .open(path)
        .map_err(|error| format!("Agent runtime generation lock is unavailable: {error}"))?;
    file.lock_shared()
        .map_err(|error| format!("Agent runtime shared lock failed: {error}"))?;
    Ok(Arc::new(file))
}

pub async fn qualification_cache_key_async(
    context: LinuxQualificationContext,
) -> Result<String, String> {
    let cancelled = Arc::new(AtomicBool::new(false));
    let mut cancellation = IdentityCancellation {
        cancelled: Arc::clone(&cancelled),
        armed: true,
    };
    let worker_cancelled = Arc::clone(&cancelled);
    let mut worker = tokio::task::spawn_blocking(move || {
        let first = compute_identity(
            &context,
            &worker_cancelled,
            Instant::now() + IDENTITY_TIMEOUT,
        )?;
        let second = compute_identity(
            &context,
            &worker_cancelled,
            Instant::now() + IDENTITY_TIMEOUT,
        )?;
        if first != second {
            return Err("Linux runtime identity changed while hashing".into());
        }
        Ok(first)
    });
    let result = tokio::select! {
        joined = &mut worker => joined.map_err(|_| "Linux runtime identity task failed".to_string())?,
        _ = tokio::time::sleep(IDENTITY_TIMEOUT) => {
            cancelled.store(true, Ordering::Release);
            let _ = worker.await;
            Err("Linux runtime identity exceeded its deadline".into())
        }
    };
    cancellation.armed = false;
    result
}

struct IdentityCancellation {
    cancelled: Arc<AtomicBool>,
    armed: bool,
}

impl Drop for IdentityCancellation {
    fn drop(&mut self) {
        if self.armed {
            self.cancelled.store(true, Ordering::Release);
        }
    }
}

fn compute_identity(
    context: &LinuxQualificationContext,
    cancelled: &AtomicBool,
    deadline: Instant,
) -> Result<String, String> {
    context
        .system_paths
        .verify(context.system_paths.production)?;
    let mut digest = Sha256::new();
    digest.update(IDENTITY_VERSION.as_bytes());
    digest.update(context.app_version.as_bytes());
    digest.update(context.environment.root.as_os_str().as_encoded_bytes());
    digest.update(context.system_paths.bwrap.as_os_str().as_encoded_bytes());
    for bind in &context.system_paths.runtime_binds {
        digest.update(bind.source.as_os_str().as_encoded_bytes());
        digest.update(bind.destination.as_os_str().as_encoded_bytes());
        let metadata = fs::symlink_metadata(&bind.source)
            .map_err(|error| format!("Linux runtime bind identity failed: {error}"))?;
        require_trusted_nonwritable(&metadata, "Linux runtime bind")?;
        digest.update(metadata.dev().to_le_bytes());
        digest.update(metadata.ino().to_le_bytes());
        digest.update(metadata.len().to_le_bytes());
        digest.update(metadata.permissions().mode().to_le_bytes());
        if let Ok(modified) = metadata.modified() {
            if let Ok(elapsed) = modified.duration_since(std::time::UNIX_EPOCH) {
                digest.update(elapsed.as_nanos().to_le_bytes());
            }
        }
    }
    let bpf = compile_seccomp_bpf()?;
    digest.update((bpf.len() as u64).to_le_bytes());
    digest.update(bpf);
    let mut entries = 0_usize;
    let mut bytes = 0_u64;
    hash_tree(
        &mut digest,
        &context.environment.root,
        &mut entries,
        &mut bytes,
        cancelled,
        deadline,
    )?;
    hash_file(
        &mut digest,
        &context.system_paths.bwrap,
        &mut bytes,
        cancelled,
        deadline,
        false,
    )?;
    Ok(hex::encode(digest.finalize()))
}

fn checkpoint(cancelled: &AtomicBool, deadline: Instant) -> Result<(), String> {
    if cancelled.load(Ordering::Acquire) {
        return Err("Linux runtime identity was cancelled".into());
    }
    if Instant::now() >= deadline {
        return Err("Linux runtime identity exceeded its deadline".into());
    }
    Ok(())
}

fn hash_tree(
    digest: &mut Sha256,
    root: &Path,
    entries: &mut usize,
    bytes: &mut u64,
    cancelled: &AtomicBool,
    deadline: Instant,
) -> Result<(), String> {
    require_owned_nonwritable(&fs::symlink_metadata(root).map_err(|error| error.to_string())?)?;
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        checkpoint(cancelled, deadline)?;
        let mut children = fs::read_dir(&directory)
            .map_err(|error| format!("Linux runtime identity could not be read: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Linux runtime identity entry failed: {error}"))?;
        children.sort_by_key(|entry| entry.file_name());
        for child in children {
            checkpoint(cancelled, deadline)?;
            *entries += 1;
            if *entries > MAX_IDENTITY_ENTRIES {
                return Err("Linux runtime identity exceeded its entry limit".into());
            }
            let path = child.path();
            let relative = path
                .strip_prefix(root)
                .map_err(|_| "Linux runtime identity escaped its root")?;
            digest.update(relative.as_os_str().as_encoded_bytes());
            let metadata = fs::symlink_metadata(&path)
                .map_err(|error| format!("Linux runtime identity metadata failed: {error}"))?;
            require_owned_nonwritable(&metadata)?;
            if metadata.file_type().is_symlink() {
                return Err("Linux runtime identity contains a symlink".into());
            }
            if metadata.is_dir() {
                digest.update(b"d");
                pending.push(path);
            } else if metadata.is_file() {
                digest.update(b"f");
                hash_file(digest, &path, bytes, cancelled, deadline, true)?;
            } else {
                return Err("Linux runtime identity contains a nonregular entry".into());
            }
        }
    }
    Ok(())
}

fn hash_file(
    digest: &mut Sha256,
    path: &Path,
    bytes: &mut u64,
    cancelled: &AtomicBool,
    deadline: Instant,
    require_current_owner: bool,
) -> Result<(), String> {
    let before = fs::symlink_metadata(path)
        .map_err(|error| format!("Linux runtime identity file failed: {error}"))?;
    if require_current_owner {
        require_owned_nonwritable(&before)?;
    } else {
        require_trusted_executable(path)?;
    }
    if !before.is_file() || before.file_type().is_symlink() {
        return Err("Linux runtime identity input is not a regular file".into());
    }
    *bytes = bytes
        .checked_add(before.len())
        .ok_or("Linux runtime identity byte count overflowed")?;
    if *bytes > MAX_IDENTITY_BYTES {
        return Err("Linux runtime identity exceeded its byte limit".into());
    }
    digest.update(before.len().to_le_bytes());
    let mut file = fs::File::open(path)
        .map_err(|error| format!("Linux runtime identity file open failed: {error}"))?;
    let mut remaining = before.len();
    let mut buffer = [0_u8; 64 * 1024];
    while remaining > 0 {
        checkpoint(cancelled, deadline)?;
        let requested = remaining.min(buffer.len() as u64) as usize;
        let read = file
            .read(&mut buffer[..requested])
            .map_err(|error| format!("Linux runtime identity read failed: {error}"))?;
        if read == 0 {
            return Err("Linux runtime identity file was truncated".into());
        }
        digest.update(&buffer[..read]);
        remaining -= read as u64;
    }
    let after = file
        .metadata()
        .map_err(|error| format!("Linux runtime identity recheck failed: {error}"))?;
    if before.len() != after.len()
        || before.modified().ok() != after.modified().ok()
        || before.dev() != after.dev()
        || before.ino() != after.ino()
        || before.uid() != after.uid()
        || before.permissions().mode() != after.permissions().mode()
    {
        return Err("Linux runtime identity changed while hashing".into());
    }
    Ok(())
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
    if fs::metadata(&canonical)
        .map_err(|error| format!("{description} metadata failed: {error}"))?
        .is_dir()
        != directory
    {
        return Err(format!("{description} has the wrong filesystem type"));
    }
    Ok(canonical)
}

fn require_regular_file(path: &Path, description: &str) -> Result<(), String> {
    let metadata =
        fs::symlink_metadata(path).map_err(|error| format!("{description} failed: {error}"))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(format!("{description} is not a regular file"));
    }
    Ok(())
}

fn require_owned_nonwritable(metadata: &fs::Metadata) -> Result<(), String> {
    if metadata.uid() != unsafe { libc::geteuid() } {
        return Err("Linux runtime identity is not owned by the application uid".into());
    }
    if metadata.permissions().mode() & 0o022 != 0 {
        return Err("Linux runtime identity is group/world writable".into());
    }
    Ok(())
}

fn require_trusted_executable(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("bubblewrap metadata is unavailable: {error}"))?;
    require_trusted_nonwritable(&metadata, "bubblewrap")?;
    if metadata.permissions().mode() & 0o111 == 0 {
        return Err("bubblewrap permissions are not trusted executable permissions".into());
    }
    Ok(())
}

fn require_trusted_nonwritable(metadata: &fs::Metadata, description: &str) -> Result<(), String> {
    let uid = metadata.uid();
    if uid != 0 && uid != unsafe { libc::geteuid() } {
        return Err(format!(
            "{description} is not owned by root or the application uid"
        ));
    }
    if metadata.permissions().mode() & 0o022 != 0 {
        return Err(format!("{description} is group/world writable"));
    }
    Ok(())
}

pub(crate) async fn qualify_locked(locked: &LockedLinuxRuntimeIdentity) -> CapabilityReport {
    match qualify_inner(locked.context(), locked.cache_key()).await {
        Ok(()) => CapabilityReport {
            available: true,
            reason: None,
            qualified_frameworks: vec!["cirq".into()],
            controls: [
                "bwrap",
                "user_namespace",
                "mount_namespace",
                "pid_namespace",
                "network_namespace",
                "cgroup_v2",
                "seccomp",
                "rlimits",
                "clean_environment",
                "filesystem",
                "subprocess",
                "output_caps",
                "cleanup",
                "cirq",
            ]
            .into_iter()
            .map(|name| ControlResult {
                name: name.into(),
                self_test_passed: true,
            })
            .collect(),
        },
        Err(error) => CapabilityReport {
            available: false,
            reason: Some(error),
            qualified_frameworks: Vec::new(),
            controls: Vec::new(),
        },
    }
}

async fn qualify_inner(
    context: &LinuxQualificationContext,
    expected_key: &str,
) -> Result<(), String> {
    LinuxBackend::discover(context)?;
    // Full adversarial qualification is deliberately routed through the same
    // ProcessSpec/Supervisor path below; no discovery result is reported alone.
    qualification_probes(context).await?;
    let final_key = qualification_cache_key_async(context.clone()).await?;
    if final_key != expected_key {
        return Err("Linux runtime identity changed during qualification".into());
    }
    Ok(())
}

async fn qualification_probes(context: &LinuxQualificationContext) -> Result<(), String> {
    use crate::agent_runtime::process::{ProcessSupervisor, Supervisor, SupervisorLimits};
    use crate::agent_runtime::protocol::{Action, Framework};
    let baseline = LinuxParentBaseline::create(context)?;
    let resolver = LinuxResolver::new(
        context.clone(),
        0,
        qualification_cache_key_async(context.clone()).await?,
    );

    let cirq_tail = "\nq=cirq.LineQubit(0)\ncircuit=cirq.Circuit(cirq.H(q))\n";
    for (description, body) in [
        (
            "project read",
            format!(
                "import cirq,errno\ntry: open({:?}).read()\nexcept OSError as e: assert e.errno in (errno.ENOENT,errno.EACCES,errno.EPERM),e\nelse: raise AssertionError('project read escaped')",
                baseline.project_sentinel
            ),
        ),
        (
            "home read",
            format!(
                "import cirq,errno\ntry: open({:?}).read()\nexcept OSError as e: assert e.errno in (errno.ENOENT,errno.EACCES,errno.EPERM),e\nelse: raise AssertionError('home read escaped')",
                baseline.home_sentinel
            ),
        ),
        (
            "symlink read",
            format!(
                "import cirq,errno,os\nos.symlink({:?},'/tmp/escape')\ntry: open('/tmp/escape').read()\nexcept OSError as e: assert e.errno in (errno.ENOENT,errno.EACCES,errno.EPERM),e\nelse: raise AssertionError('symlink read escaped')",
                baseline.project_sentinel
            ),
        ),
        (
            "IPv4 socket",
            "import cirq,errno,socket\ntry: socket.socket(socket.AF_INET,socket.SOCK_STREAM)\nexcept OSError as e: assert e.errno==errno.EPERM,e\nelse: raise AssertionError('IPv4 socket escaped')".into(),
        ),
        (
            "IPv6 socket",
            "import cirq,errno,socket\ntry: socket.socket(socket.AF_INET6,socket.SOCK_STREAM)\nexcept OSError as e: assert e.errno==errno.EPERM,e\nelse: raise AssertionError('IPv6 socket escaped')".into(),
        ),
        (
            "Unix socket",
            "import cirq,errno,socket\ntry: socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)\nexcept OSError as e: assert e.errno==errno.EPERM,e\nelse: raise AssertionError('Unix socket escaped')".into(),
        ),
        (
            "subprocess id",
            "import cirq,errno,subprocess\ntry: subprocess.run(['/usr/bin/id'],check=True)\nexcept OSError as e: assert e.errno==errno.EPERM,e\nelse: raise AssertionError('subprocess escaped')".into(),
        ),
        (
            "fork setsid",
            "import cirq,errno,os\ntry:\n p=os.fork()\n if p==0: os.setsid();os._exit(0)\nexcept OSError as e: assert e.errno==errno.EPERM,e\nelse: raise AssertionError('fork escaped')".into(),
        ),
        (
            "clone",
            "import cirq,ctypes,errno,os,platform,signal\nnumber={'x86_64':56,'aarch64':220,'riscv64':220}[platform.machine()]\nctypes.set_errno(0)\nr=ctypes.CDLL(None,use_errno=True).syscall(number,signal.SIGCHLD,0,0,0,0)\nassert r==-1 and ctypes.get_errno()==errno.EPERM,(r,ctypes.get_errno())".into(),
        ),
        (
            "execveat",
            "import cirq,ctypes,errno,platform\nnumber={'x86_64':322,'aarch64':281,'riscv64':281}[platform.machine()]\nctypes.set_errno(0)\nr=ctypes.CDLL(None,use_errno=True).syscall(number,-1,0,0,0,0)\nassert r==-1 and ctypes.get_errno()==errno.EPERM,(r,ctypes.get_errno())".into(),
        ),
        (
            "fd rlimit",
            "import cirq,errno\nfds=[]\ntry:\n while True: fds.append(open('/dev/null'))\nexcept OSError as e: assert e.errno in (errno.EMFILE,errno.ENFILE),e".into(),
        ),
        (
            "cgroup escape",
            "import cirq,errno\ntry: open('/sys/fs/cgroup/cgroup.procs','w').write('0')\nexcept OSError as e: assert e.errno in (errno.ENOENT,errno.EACCES,errno.EPERM,errno.EROFS),e\nelse: raise AssertionError('cgroup escape succeeded')".into(),
        ),
        (
            "PID namespace",
            "import cirq,os\nassert os.getpid() <= 2,os.getpid()".into(),
        ),
        (
            "sealed descriptor",
            "import cirq,os\nopen_fds=[]\nfor fd in range(3,64):\n try: os.fstat(fd);open_fds.append(fd)\n except OSError: pass\nassert not open_fds,open_fds".into(),
        ),
    ] {
        run_valid_worker(
            &resolver,
            &format!("{body}{cirq_tail}"),
            &format!("Linux {description} probe"),
        )
        .await?;
    }

    let expected_environment = sandbox_environment(&context.environment)?;
    let environment_json = serde_json::to_string(&expected_environment)
        .map_err(|error| format!("Linux environment evidence encode failed: {error}"))?;
    let secrets_json = serde_json::to_string(&context.parent_secret_names)
        .map_err(|error| format!("Linux secret evidence encode failed: {error}"))?;
    run_valid_worker(
        &resolver,
        &format!(
            "import cirq,json,os\nexpected=json.loads({environment_json:?})\nassert dict(os.environ)==expected,(dict(os.environ),expected)\nfor name in json.loads({secrets_json:?}): assert name not in os.environ{cirq_tail}"
        ),
        "Linux exact clean environment probe",
    )
    .await?;

    run_expected_worker_failure_with_policy(
        &resolver,
        "import cirq\nchunks=[]\nwhile True:\n chunk=bytearray(64*1024*1024)\n chunk[::4096]=b'x'*(len(chunk)//4096)\n chunks.append(chunk)",
        CgroupProbeKind::Memory,
        &["worker_failed"],
        "memory cgroup OOM",
    )
    .await?;
    run_valid_worker_with_policy(
        &resolver,
        &format!(
            "import cirq,threading\nrelease=threading.Event()\nthreads=[]\ntry:\n for _ in range(64):\n  thread=threading.Thread(target=release.wait)\n  thread.start()\n  threads.append(thread)\nexcept RuntimeError: pass\nelse: raise AssertionError('pids.max did not reject threads')\nrelease.set()\nfor thread in threads: thread.join(){cirq_tail}"
        ),
        CgroupProbeKind::Pids,
        "pids cgroup thread limit",
    )
    .await?;
    run_valid_worker_with_policy(
        &resolver,
        &format!(
            "import cirq,time\nend=time.monotonic()+1.2\nwhile time.monotonic()<end: pass{cirq_tail}"
        ),
        CgroupProbeKind::Cpu,
        "CPU cgroup throttling",
    )
    .await?;
    run_expected_supervisor_failure(
        &resolver,
        "import os\nwhile True: os.write(1,b'x'*8192)",
        &["response_too_large"],
        "stdout flood",
    )
    .await?;
    run_expected_supervisor_failure(
        &resolver,
        "import os\nwhile True: os.write(2,b'x'*8192)",
        &["stderr_too_large"],
        "stderr flood",
    )
    .await?;
    run_expected_supervisor_failure(
        &resolver,
        "print('not-json')",
        &["malformed_response"],
        "malformed protocol",
    )
    .await?;

    let cancellation_request = WorkerRequestV1 {
        protocol_version: 1,
        request_id: format!("linux-cancel-{}", uuid::Uuid::new_v4()),
        action: Action::Parse,
        framework: Framework::Cirq,
        language: "python".into(),
        code: "while True: pass".into(),
        shots: None,
    };
    let cancellation_spec = resolver.resolve(&cancellation_request).await?;
    let mut cancellation_input = serde_json::to_vec(&cancellation_request)
        .map_err(|error| format!("Linux cancellation request encode failed: {error}"))?;
    cancellation_input.push(b'\n');
    let cancellation_supervisor = Arc::new(Supervisor::new(SupervisorLimits::production()));
    let run_supervisor = Arc::clone(&cancellation_supervisor);
    let cancellation_id = cancellation_request.request_id.clone();
    let cancellation_run = tokio::spawn(async move {
        run_supervisor
            .run(
                &cancellation_request,
                cancellation_spec,
                &cancellation_input,
            )
            .await
    });
    tokio::time::sleep(Duration::from_millis(100)).await;
    cancellation_supervisor
        .cancel(&cancellation_id)
        .await
        .map_err(|error| format!("Linux cancellation cleanup failed: {}", error.message))?;
    let cancellation_error = cancellation_run
        .await
        .map_err(|_| "Linux cancellation probe task failed")?
        .expect_err("Linux cancellation probe unexpectedly succeeded");
    if cancellation_error.code != "cancelled" {
        return Err(format!(
            "Linux cancellation returned unexpected evidence: {}",
            cancellation_error.code
        ));
    }

    qualification_owned_cgroups_absent(&resolver.created_cgroups())?;
    qualification_owned_request_dirs_absent(&resolver.created_request_dirs())?;
    drop(baseline);
    Ok(())
}

async fn run_valid_worker(
    resolver: &LinuxResolver,
    code: &str,
    description: &str,
) -> Result<(), String> {
    use crate::agent_runtime::process::{ProcessSupervisor, Supervisor, SupervisorLimits};
    use crate::agent_runtime::protocol::{Action, Framework};

    let request = WorkerRequestV1 {
        protocol_version: 1,
        request_id: format!("linux-probe-{}", uuid::Uuid::new_v4()),
        action: Action::Parse,
        framework: Framework::Cirq,
        language: "python".into(),
        code: code.into(),
        shots: None,
    };
    let spec = resolver.resolve(&request).await?;
    let mut input = serde_json::to_vec(&request)
        .map_err(|error| format!("{description} request encode failed: {error}"))?;
    input.push(b'\n');
    Supervisor::new(SupervisorLimits::production())
        .run(&request, spec, &input)
        .await
        .map(|_| ())
        .map_err(|error| format!("{description} failed: {}", error.message))
}

async fn run_valid_worker_with_policy(
    resolver: &LinuxResolver,
    code: &str,
    kind: CgroupProbeKind,
    description: &str,
) -> Result<(), String> {
    use crate::agent_runtime::process::{ProcessSupervisor, Supervisor, SupervisorLimits};
    use crate::agent_runtime::protocol::{Action, Framework};

    let request = WorkerRequestV1 {
        protocol_version: 1,
        request_id: format!("linux-cgroup-probe-{}", uuid::Uuid::new_v4()),
        action: Action::Parse,
        framework: Framework::Cirq,
        language: "python".into(),
        code: code.into(),
        shots: None,
    };
    let spec = resolver.resolve_worker_with_policy(kind).await?;
    let mut input = serde_json::to_vec(&request)
        .map_err(|error| format!("{description} request encode failed: {error}"))?;
    input.push(b'\n');
    Supervisor::new(SupervisorLimits::production())
        .run(&request, spec, &input)
        .await
        .map(|_| ())
        .map_err(|error| format!("{description} failed: {}", error.message))
}

async fn run_expected_worker_failure_with_policy(
    resolver: &LinuxResolver,
    code: &str,
    kind: CgroupProbeKind,
    expected_codes: &[&str],
    description: &str,
) -> Result<(), String> {
    use crate::agent_runtime::process::{ProcessSupervisor, Supervisor, SupervisorLimits};
    use crate::agent_runtime::protocol::{Action, Framework};

    let request = WorkerRequestV1 {
        protocol_version: 1,
        request_id: format!("linux-cgroup-failure-{}", uuid::Uuid::new_v4()),
        action: Action::Parse,
        framework: Framework::Cirq,
        language: "python".into(),
        code: code.into(),
        shots: None,
    };
    let spec = resolver.resolve_worker_with_policy(kind).await?;
    let mut input = serde_json::to_vec(&request)
        .map_err(|error| format!("{description} request encode failed: {error}"))?;
    input.push(b'\n');
    let error = Supervisor::new(SupervisorLimits::production())
        .run(&request, spec, &input)
        .await
        .expect_err("Linux cgroup negative probe unexpectedly returned a response");
    if !expected_codes.contains(&error.code.as_str()) {
        return Err(format!(
            "{description} returned {}, expected one of {expected_codes:?}: {}",
            error.code, error.message
        ));
    }
    Ok(())
}

async fn run_expected_supervisor_failure(
    resolver: &LinuxResolver,
    script: &str,
    expected_codes: &[&str],
    description: &str,
) -> Result<(), String> {
    use crate::agent_runtime::process::{ProcessSupervisor, Supervisor, SupervisorLimits};
    use crate::agent_runtime::protocol::{Action, Framework};

    let spec = resolver.resolve_probe(script).await?;
    let request = WorkerRequestV1 {
        protocol_version: 1,
        request_id: format!("linux-failure-{}", uuid::Uuid::new_v4()),
        action: Action::Parse,
        framework: Framework::Cirq,
        language: "python".into(),
        code: String::new(),
        shots: None,
    };
    let error = Supervisor::new(SupervisorLimits::production())
        .run(&request, spec, b"")
        .await
        .expect_err("Linux negative probe unexpectedly returned a response");
    if !expected_codes.contains(&error.code.as_str()) {
        return Err(format!(
            "{description} returned {}, expected one of {expected_codes:?}",
            error.code
        ));
    }
    Ok(())
}

fn qualification_owned_cgroups_absent(paths: &[PathBuf]) -> Result<(), String> {
    if let Some(path) = paths.iter().find(|path| path.exists()) {
        return Err(format!(
            "Linux qualification leaked its own worker cgroup {}",
            path.display()
        ));
    }
    Ok(())
}

fn qualification_owned_request_dirs_absent(paths: &[PathBuf]) -> Result<(), String> {
    if let Some(path) = paths.iter().find(|path| path.exists()) {
        return Err(format!(
            "Linux qualification leaked its own request directory {}",
            path.display()
        ));
    }
    Ok(())
}

#[doc(hidden)]
pub fn qualification_owned_request_dirs_absent_for_test(paths: &[PathBuf]) -> Result<(), String> {
    qualification_owned_request_dirs_absent(paths)
}

#[doc(hidden)]
pub fn qualification_owned_cgroups_absent_for_test(paths: &[PathBuf]) -> Result<(), String> {
    qualification_owned_cgroups_absent(paths)
}

struct LinuxParentBaseline {
    project_sentinel: PathBuf,
    home_sentinel: PathBuf,
}

impl LinuxParentBaseline {
    fn create(context: &LinuxQualificationContext) -> Result<Self, String> {
        let nonce = uuid::Uuid::new_v4();
        let baseline = Self {
            project_sentinel: context
                .project_root
                .join(format!(".nuclei-linux-project-{nonce}")),
            home_sentinel: context
                .home_root
                .join(format!(".nuclei-linux-home-{nonce}")),
        };
        let evidence = format!("trusted-parent-{nonce}");
        for path in [&baseline.project_sentinel, &baseline.home_sentinel] {
            fs::write(path, &evidence)
                .map_err(|error| format!("Trusted parent sentinel write failed: {error}"))?;
            if fs::read_to_string(path)
                .map_err(|error| format!("Trusted parent sentinel read failed: {error}"))?
                != evidence
            {
                return Err("Trusted parent sentinel evidence was inconsistent".into());
            }
        }
        Ok(baseline)
    }
}

impl Drop for LinuxParentBaseline {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.project_sentinel);
        let _ = fs::remove_file(&self.home_sentinel);
    }
}
