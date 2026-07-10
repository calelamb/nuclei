use crate::agent_runtime::process::ProcessSpec;
use crate::agent_runtime::resources::{AgentEnvironment, ResourcePaths, RunnerContainment};
#[cfg(target_os = "macos")]
use crate::agent_runtime::{CapabilityReport, ControlResult};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
#[cfg(target_os = "macos")]
use std::time::Duration;

const SANDBOX_EXEC: &str = "/usr/bin/sandbox-exec";
const PROFILE_VERSION: &str = "nuclei-seatbelt-v1";
#[cfg(target_os = "macos")]
const PROBE_TIMEOUT: Duration = Duration::from_secs(4);
#[cfg(target_os = "macos")]
const PROBE_OUTPUT_LIMIT: usize = 65_536;

/// All path and parent-environment inputs used to qualify one immutable backend.
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
    pub project_sentinel: PathBuf,
    pub home_sentinel: PathBuf,
    pub parent_environment: BTreeMap<String, String>,
}

impl QualificationContext {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        app_version: impl Into<String>,
        resources: ResourcePaths,
        environment: AgentEnvironment,
        request_temp_root: &Path,
        project_sentinel: &Path,
        home_sentinel: &Path,
        parent_environment: BTreeMap<String, String>,
    ) -> Result<Self, String> {
        environment.verify()?;
        require_canonical(&resources.kernel_root, "Agent kernel root", true)?;
        require_canonical(&resources.worker, "Agent worker", false)?;
        require_canonical(&resources.requirements, "Agent requirements", false)?;
        require_canonical(&environment.root, "Agent environment root", true)?;
        require_canonical(&environment.python, "Agent Python", false)?;
        require_canonical(&environment.site_packages, "Agent site-packages", true)?;
        let request_temp_root =
            require_canonical(request_temp_root, "Agent request temp root", true)?;
        let project_sentinel =
            require_canonical(project_sentinel, "Project qualification sentinel", false)?;
        let home_sentinel = require_canonical(home_sentinel, "Home qualification sentinel", false)?;
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
        if project_sentinel.starts_with(&request_temp_root)
            || home_sentinel.starts_with(&request_temp_root)
            || project_sentinel.starts_with(&environment.root)
            || home_sentinel.starts_with(&environment.root)
            || project_sentinel.starts_with(&resources.kernel_root)
            || home_sentinel.starts_with(&resources.kernel_root)
        {
            return Err("Qualification sentinels must be outside sandbox-readable roots".into());
        }
        if parent_environment
            .keys()
            .any(|name| name.is_empty() || name.contains('=') || name.contains('\0'))
        {
            return Err("Parent qualification environment contains an invalid name".into());
        }
        Ok(Self {
            app_version: app_version.into(),
            resources,
            environment,
            request_temp_root,
            project_sentinel,
            home_sentinel,
            parent_environment,
        })
    }

    pub fn from_explicit_environment(app_version: &str) -> Result<Self, String> {
        let required = |name: &str| {
            std::env::var_os(name)
                .map(PathBuf::from)
                .ok_or_else(|| format!("{name} is required for explicit macOS qualification"))
        };
        let kernel_root = required("NUCLEI_AGENT_KERNEL_ROOT")?;
        let resources = ResourcePaths {
            worker: kernel_root
                .join("agent_worker.py")
                .canonicalize()
                .map_err(|error| format!("Explicit agent worker is unavailable: {error}"))?,
            requirements: kernel_root
                .join("agent-requirements.txt")
                .canonicalize()
                .map_err(|error| format!("Explicit agent requirements are unavailable: {error}"))?,
            kernel_root: kernel_root
                .canonicalize()
                .map_err(|error| format!("Explicit agent kernel root is unavailable: {error}"))?,
        };
        let environment_root = required("NUCLEI_AGENT_ENVIRONMENT_ROOT")?
            .canonicalize()
            .map_err(|error| format!("Explicit agent environment is unavailable: {error}"))?;
        let environment = AgentEnvironment {
            python: required("NUCLEI_AGENT_PYTHON")?
                .canonicalize()
                .map_err(|error| format!("Explicit agent Python is unavailable: {error}"))?,
            site_packages: required("NUCLEI_AGENT_SITE_PACKAGES")?
                .canonicalize()
                .map_err(|error| format!("Explicit agent site-packages is unavailable: {error}"))?,
            root: environment_root,
        };
        let parent_environment = [
            "ANTHROPIC_API_KEY",
            "IBM_QUANTUM_TOKEN",
            "AWS_SECRET_ACCESS_KEY",
        ]
        .into_iter()
        .map(|name| (name.into(), format!("qualification-fake-{name}")))
        .collect();
        Self::new(
            app_version,
            resources,
            environment,
            &required("NUCLEI_AGENT_REQUEST_TEMP_ROOT")?,
            &required("NUCLEI_AGENT_PROJECT_SENTINEL")?,
            &required("NUCLEI_AGENT_HOME_SENTINEL")?,
            parent_environment,
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
            executable: PathBuf::from(SANDBOX_EXEC),
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
        })
    }
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
    for root in [
        &context.environment.root,
        &context.resources.kernel_root,
        Path::new("/System/Library"),
        Path::new("/usr/lib"),
    ] {
        push_filter(&mut profile, "subpath", root, "  ")?;
    }
    for device in [
        Path::new("/dev/null"),
        Path::new("/dev/random"),
        Path::new("/dev/urandom"),
    ] {
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
    let mut digest = Sha256::new();
    digest.update(PROFILE_VERSION.as_bytes());
    digest.update(context.app_version.as_bytes());
    digest.update(
        build_profile_for_canonical_paths(
            context,
            &context.request_temp_root.join("CACHE_REQUEST"),
        )?
        .as_bytes(),
    );
    for path in [
        &context.resources.kernel_root,
        &context.environment.root,
        &context.request_temp_root,
    ] {
        digest.update(
            path.to_str()
                .ok_or("Qualification cache path is not valid UTF-8")?
                .as_bytes(),
        );
    }
    for (description, path) in [
        ("Agent worker", &context.resources.worker),
        ("Agent Python", &context.environment.python),
    ] {
        let bytes = fs::read(path)
            .map_err(|error| format!("{description} could not be hashed: {error}"))?;
        digest.update((bytes.len() as u64).to_le_bytes());
        digest.update(&bytes);
    }
    Ok(hex::encode(digest.finalize()))
}

#[cfg(target_os = "macos")]
pub(crate) async fn qualify(context: &QualificationContext) -> CapabilityReport {
    qualify_macos(context).await
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
async fn qualify_macos(context: &QualificationContext) -> CapabilityReport {
    match qualify_macos_inner(context).await {
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
async fn qualify_macos_inner(context: &QualificationContext) -> Result<(), String> {
    context.environment.verify()?;
    let canonical_sandbox = Path::new(SANDBOX_EXEC)
        .canonicalize()
        .map_err(|error| format!("sandbox-exec is unavailable: {error}"))?;
    if canonical_sandbox != Path::new(SANDBOX_EXEC) || !canonical_sandbox.is_file() {
        return Err("sandbox-exec does not have the required canonical identity".into());
    }
    let _cache_key = qualification_cache_key(context)?;

    denied_probe(
        context,
        &format!("open({:?}).read()", context.project_sentinel),
        "project sentinel read",
    )
    .await?;
    denied_probe(
        context,
        &format!("open({:?}).read()", context.home_sentinel),
        "home sentinel read",
    )
    .await?;

    let clean = run_probe(
        context,
        "import json,os;print(json.dumps(dict(sorted(os.environ.items())),separators=(',',':')))",
    )
    .await?;
    require_success(&clean, "clean environment probe")?;
    let actual: BTreeMap<String, String> = serde_json::from_slice(trim_ascii(&clean.stdout))
        .map_err(|_| "Clean environment probe returned malformed JSON")?;
    let probe_temp = clean
        .request_temp
        .as_ref()
        .ok_or("Clean environment probe lost its request directory")?;
    let expected = worker_environment(&context.environment, probe_temp)?;
    if actual != expected {
        return Err("Worker environment did not exactly match the allowlist".into());
    }
    if context
        .parent_environment
        .keys()
        .any(|name| actual.contains_key(name))
    {
        return Err("A parent credential reached the worker environment".into());
    }
    clean.cleanup()?;

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

    let write_target = context
        .project_sentinel
        .parent()
        .ok_or("Project sentinel has no parent")?
        .join(format!("nuclei-write-probe-{}", uuid::Uuid::new_v4()));
    denied_probe(
        context,
        &format!("open({write_target:?},'w').write('escaped')"),
        "write outside request temp",
    )
    .await?;
    if write_target.exists() {
        return Err("Write-outside-temp probe unexpectedly created a file".into());
    }

    symlink_probe(context).await?;
    same_interpreter_exec_probe(context).await?;
    stdout_flood_probe(context).await?;
    rlimit_probe(context).await?;
    cirq_probe(context).await?;
    Ok(())
}

#[cfg(target_os = "macos")]
struct ProbeResult {
    success: bool,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    request_temp: Option<PathBuf>,
}

#[cfg(target_os = "macos")]
impl ProbeResult {
    fn cleanup(mut self) -> Result<(), String> {
        if let Some(path) = self.request_temp.take() {
            fs::remove_dir_all(&path)
                .map_err(|error| format!("Qualification cleanup failed: {error}"))?;
            if path.exists() {
                return Err("Qualification cleanup left a request directory".into());
            }
        }
        Ok(())
    }
}

#[cfg(target_os = "macos")]
impl Drop for ProbeResult {
    fn drop(&mut self) {
        if let Some(path) = self.request_temp.take() {
            let _ = fs::remove_dir_all(path);
        }
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

    let request_temp = context
        .request_temp_root
        .join(format!("qualification-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&request_temp)
        .map_err(|error| format!("Failed to create qualification request temp: {error}"))?;
    let request_temp = request_temp
        .canonicalize()
        .map_err(|error| format!("Qualification request temp is unavailable: {error}"))?;
    let mut spec = match MacBackend::worker_spec(context, &request_temp) {
        Ok(spec) => spec,
        Err(error) => {
            let _ = fs::remove_dir_all(&request_temp);
            return Err(error);
        }
    };
    spec.args.truncate(3);
    spec.args.extend(["-I".into(), "-c".into(), body.into()]);
    let mut command = tokio::process::Command::new(&spec.executable);
    command
        .args(&spec.args)
        .current_dir(&spec.cwd)
        .envs(&context.parent_environment)
        .env_clear()
        .envs(&spec.env)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = command.spawn().map_err(|error| {
        let _ = fs::remove_dir_all(&request_temp);
        format!("Qualification probe could not start: {error}")
    })?;
    let mut stdout = child.stdout.take().ok_or("Probe stdout was not piped")?;
    let mut stderr = child.stderr.take().ok_or("Probe stderr was not piped")?;
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
            let _ = child.start_kill();
            let _ = fs::remove_dir_all(&request_temp);
            return Err(format!("Qualification probe wait failed: {error}"));
        }
        Err(_) => {
            let _ = child.start_kill();
            let _ = child.wait().await;
            let _ = fs::remove_dir_all(&request_temp);
            return Err("Qualification probe exceeded its deadline".into());
        }
    };
    let stdout = read_stdout
        .await
        .map_err(|_| "Qualification stdout reader failed")?
        .map_err(|_| "Qualification stdout could not be read")?;
    let stderr = read_stderr
        .await
        .map_err(|_| "Qualification stderr reader failed")?
        .map_err(|_| "Qualification stderr could not be read")?;
    Ok(ProbeResult {
        success: status.success(),
        stdout,
        stderr,
        request_temp: Some(request_temp),
    })
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
        let _ = result.cleanup();
        return Err(format!(
            "{description} was not denied for a sandbox permission reason: {diagnostic}"
        ));
    }
    result.cleanup()
}

#[cfg(target_os = "macos")]
async fn symlink_probe(context: &QualificationContext) -> Result<(), String> {
    use std::os::unix::fs::symlink;

    let request_temp = context
        .request_temp_root
        .join(format!("qualification-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&request_temp)
        .map_err(|error| format!("Failed to create symlink probe temp: {error}"))?;
    let request_temp = request_temp
        .canonicalize()
        .map_err(|error| format!("Symlink probe temp is unavailable: {error}"))?;
    let escape = request_temp.join("escape");
    let outside = context
        .project_sentinel
        .parent()
        .ok_or("Project sentinel has no parent")?;
    symlink(outside, &escape)
        .map_err(|error| format!("Failed to create escape symlink: {error}"))?;
    let target = escape.join(format!("escaped-{}", uuid::Uuid::new_v4()));
    let script = format!(
        "import errno\ntry:\n open({target:?},'w').write('escaped')\nexcept OSError as error:\n print('DENIED',error.errno)\n raise SystemExit(0)\nprint('UNEXPECTED_SUCCESS')"
    );
    let result = run_existing_probe(context, &request_temp, &script).await?;
    let output = String::from_utf8_lossy(&result.stdout);
    let denied = output
        .strip_prefix("DENIED ")
        .and_then(|value| value.trim().parse::<i32>().ok())
        .is_some_and(|errno| matches!(errno, libc::EACCES | libc::EPERM));
    if !result.success || !denied || target.exists() {
        let _ = result.cleanup();
        return Err("Symlink escape was not denied by Seatbelt".into());
    }
    result.cleanup()
}

#[cfg(target_os = "macos")]
async fn run_existing_probe(
    context: &QualificationContext,
    request_temp: &Path,
    body: &str,
) -> Result<ProbeResult, String> {
    use std::process::Stdio;

    let mut spec = MacBackend::worker_spec(context, request_temp)?;
    spec.args.truncate(3);
    spec.args.extend(["-I".into(), "-c".into(), body.into()]);
    let output = tokio::time::timeout(
        PROBE_TIMEOUT,
        tokio::process::Command::new(&spec.executable)
            .args(&spec.args)
            .current_dir(&spec.cwd)
            .envs(&context.parent_environment)
            .env_clear()
            .envs(&spec.env)
            .stdin(Stdio::null())
            .output(),
    )
    .await
    .map_err(|_| "Qualification probe exceeded its deadline")?
    .map_err(|error| format!("Qualification probe failed to run: {error}"))?;
    if output.stdout.len() > PROBE_OUTPUT_LIMIT || output.stderr.len() > PROBE_OUTPUT_LIMIT {
        let _ = fs::remove_dir_all(request_temp);
        return Err("Qualification probe output exceeded its cap".into());
    }
    Ok(ProbeResult {
        success: output.status.success(),
        stdout: output.stdout,
        stderr: output.stderr,
        request_temp: Some(request_temp.to_path_buf()),
    })
}

#[cfg(target_os = "macos")]
async fn same_interpreter_exec_probe(context: &QualificationContext) -> Result<(), String> {
    let child = format!(
        "import errno\ntry:\n open({:?}).read()\nexcept OSError as error:\n print('SAME_EXEC_DENIED',error.errno)\n raise SystemExit(0)\nprint('UNEXPECTED_SUCCESS')",
        context.project_sentinel
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
        let _ = result.cleanup();
        return Err(
            "Same-interpreter exec did not remain inside the qualified Seatbelt policy".into(),
        );
    }
    result.cleanup()
}

#[cfg(target_os = "macos")]
async fn stdout_flood_probe(context: &QualificationContext) -> Result<(), String> {
    let result = run_probe_with_limit(
        context,
        "import os\nwhile True: os.write(1,b'x'*8192)",
        1_024,
        Duration::from_secs(1),
    )
    .await;
    match result {
        Ok(result) if !result.success && result.stdout.len() > 1_024 => result.cleanup(),
        Ok(result) => {
            let _ = result.cleanup();
            Err("Stdout flood probe did not reach the authoritative byte cap".into())
        }
        Err(error) => Err(error),
    }
}

#[cfg(target_os = "macos")]
async fn rlimit_probe(context: &QualificationContext) -> Result<(), String> {
    let script = r#"import os,resource,tempfile
limits=((resource.RLIMIT_AS,268435456),(resource.RLIMIT_FSIZE,1048576),(resource.RLIMIT_NOFILE,32),(resource.RLIMIT_NPROC,1),(resource.RLIMIT_CORE,0))
for item,value in limits: resource.setrlimit(item,(value,value))
assert all(resource.getrlimit(item)==(value,value) for item,value in limits)
memory=False
try: bytearray(536870912)
except (MemoryError,OSError): memory=True
fds=[]
fd_limited=False
try:
 while True: fds.append(open('/dev/null'))
except OSError as error:
 fd_limited=error.errno in (23,24)
print('RLIMITS_OK' if memory and fd_limited else 'RLIMITS_BAD')"#;
    let result = run_probe(context, script).await?;
    require_success(&result, "memory/fd rlimit probe")?;
    if trim_ascii(&result.stdout) != b"RLIMITS_OK" {
        let _ = result.cleanup();
        return Err("Memory/fd rlimit probe returned malformed evidence".into());
    }
    result.cleanup()?;

    let cpu = run_probe_with_limit(
        context,
        "import resource;resource.setrlimit(resource.RLIMIT_CPU,(1,1))\nwhile True: pass",
        1_024,
        Duration::from_secs(3),
    )
    .await?;
    if cpu.success {
        let _ = cpu.cleanup();
        return Err("CPU rlimit probe unexpectedly succeeded".into());
    }
    cpu.cleanup()
}

#[cfg(target_os = "macos")]
async fn cirq_probe(context: &QualificationContext) -> Result<(), String> {
    use std::process::Stdio;
    use tokio::io::AsyncWriteExt;

    let request_temp = context
        .request_temp_root
        .join(format!("qualification-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&request_temp)
        .map_err(|error| format!("Failed to create Cirq probe temp: {error}"))?;
    let request_temp = request_temp
        .canonicalize()
        .map_err(|error| format!("Cirq probe temp is unavailable: {error}"))?;
    let spec = MacBackend::worker_spec(context, &request_temp)?;
    let mut request = serde_json::to_vec(&serde_json::json!({
        "protocol_version": 1,
        "request_id": "qualification_cirq",
        "action": "parse",
        "framework": "cirq",
        "language": "python",
        "code": "import cirq\nq=cirq.LineQubit(0)\ncircuit=cirq.Circuit(cirq.H(q))"
    }))
    .map_err(|_| "Cirq probe request could not be encoded")?;
    request.push(b'\n');
    let mut child = tokio::process::Command::new(&spec.executable)
        .args(&spec.args)
        .current_dir(&spec.cwd)
        .envs(&context.parent_environment)
        .env_clear()
        .envs(&spec.env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| format!("Cirq probe could not start: {error}"))?;
    child
        .stdin
        .as_mut()
        .ok_or("Cirq probe stdin was unavailable")?
        .write_all(&request)
        .await
        .map_err(|error| format!("Cirq probe request failed: {error}"))?;
    drop(child.stdin.take());
    let output = tokio::time::timeout(PROBE_TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| "Cirq probe exceeded its deadline")?
        .map_err(|error| format!("Cirq probe wait failed: {error}"))?;
    if output.stdout.len() > PROBE_OUTPUT_LIMIT || output.stderr.len() > PROBE_OUTPUT_LIMIT {
        let _ = fs::remove_dir_all(&request_temp);
        return Err("Cirq probe output exceeded its cap".into());
    }
    if !output.status.success() {
        let _ = fs::remove_dir_all(&request_temp);
        return Err("Cirq parse probe failed".into());
    }
    let response: serde_json::Value = serde_json::from_slice(trim_ascii(&output.stdout))
        .map_err(|_| "Cirq parse probe returned malformed JSON")?;
    let valid = response.get("protocol_version") == Some(&serde_json::json!(1))
        && response.get("request_id") == Some(&serde_json::json!("qualification_cirq"))
        && response.get("status") == Some(&serde_json::json!("ok"))
        && response
            .pointer("/snapshot/framework")
            .is_some_and(|framework| framework == "cirq");
    if !valid {
        let _ = fs::remove_dir_all(&request_temp);
        return Err("Cirq parse probe returned invalid evidence".into());
    }
    fs::remove_dir_all(&request_temp).map_err(|error| format!("Cirq probe cleanup failed: {error}"))
}

#[cfg(target_os = "macos")]
fn require_success(result: &ProbeResult, description: &str) -> Result<(), String> {
    if result.success {
        Ok(())
    } else {
        Err(format!("{description} exited unsuccessfully"))
    }
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
