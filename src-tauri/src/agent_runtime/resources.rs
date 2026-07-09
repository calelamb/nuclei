use fs2::FileExt;
use sha2::{Digest, Sha256};
use std::ffi::OsString;
use std::fs;
use std::fs::OpenOptions;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

const APPROVED_REQUIREMENTS: &str =
    "numpy>=1.26,<3\nqiskit>=1.2,<2\nqiskit-aer>=0.15,<1\ncirq-core>=1.4,<2\nqdk>=1.29,<2\n";
const EXPECTED_IMPORTS: [&str; 5] = ["numpy", "qiskit", "qiskit_aer", "cirq", "qdk"];
const DENIED_IMPORTS: [&str; 7] = [
    "keyring",
    "qiskit_ibm_runtime",
    "braket",
    "azure",
    "qiskit_ionq",
    "quantinuum",
    "cudaq",
];

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResourcePaths {
    pub kernel_root: PathBuf,
    pub worker: PathBuf,
    pub requirements: PathBuf,
}

impl ResourcePaths {
    pub fn development(repository: &Path) -> Result<Self, String> {
        Self::from_root(repository.join("kernel"), repository)
    }

    pub fn bundled(resources: &Path) -> Result<Self, String> {
        Self::from_root(resources.join("agent-runtime").join("kernel"), resources)
    }

    fn from_root(root: PathBuf, allowed_parent: &Path) -> Result<Self, String> {
        let allowed_parent = canonical_file(allowed_parent, "Agent resource parent")?;
        let kernel_root = canonical_file(&root, "Agent kernel resource root")?;
        if !kernel_root.is_dir() {
            return Err("Agent kernel resource root is not a directory".into());
        }
        if !kernel_root.starts_with(&allowed_parent) {
            return Err("Agent kernel resource root escaped its expected parent".into());
        }

        let worker = canonical_file(&kernel_root.join("agent_worker.py"), "Agent worker")?;
        let requirements = canonical_file(
            &kernel_root.join("agent-requirements.txt"),
            "Agent requirements",
        )?;
        if !worker.is_file() || !requirements.is_file() {
            return Err("Agent runtime resources are incomplete".into());
        }
        if !worker.starts_with(&kernel_root) || !requirements.starts_with(&kernel_root) {
            return Err("Agent resource escaped the dedicated kernel root".into());
        }

        Ok(Self {
            kernel_root,
            worker,
            requirements,
        })
    }
}

fn canonical_file(path: &Path, description: &str) -> Result<PathBuf, String> {
    path.canonicalize()
        .map_err(|error| format!("{description} is unavailable: {error}"))
}

pub fn validate_requirements(text: &str) -> Result<(), String> {
    if text != APPROVED_REQUIREMENTS {
        return Err(
            "Agent requirements must exactly match the approved package constraints".into(),
        );
    }
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommandSpec {
    pub program: PathBuf,
    pub args: Vec<OsString>,
    pub environment: Vec<(OsString, OsString)>,
    pub clear_environment: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommandOutput {
    pub success: bool,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

pub trait CommandRunner {
    fn run(&self, spec: &CommandSpec) -> Result<CommandOutput, String>;
}

pub trait EnvironmentFilesystem {
    fn read(&self, path: &Path) -> Result<Vec<u8>, String>;
    fn read_to_string(&self, path: &Path) -> Result<String, String>;
    fn create_dir_all(&self, path: &Path) -> Result<(), String>;
    fn write(&self, path: &Path, contents: &[u8]) -> Result<(), String>;
    fn set_readonly(&self, path: &Path) -> Result<(), String>;
    fn remove_dir_all(&self, path: &Path) -> Result<(), String>;
    fn rename(&self, from: &Path, to: &Path) -> Result<(), String>;
    fn canonicalize(&self, path: &Path) -> Result<PathBuf, String>;
    fn exists(&self, path: &Path) -> bool;
}

#[derive(Clone, Copy, Debug, Default)]
pub struct SystemEnvironmentFilesystem;

impl EnvironmentFilesystem for SystemEnvironmentFilesystem {
    fn read(&self, path: &Path) -> Result<Vec<u8>, String> {
        fs::read(path).map_err(|error| error.to_string())
    }

    fn read_to_string(&self, path: &Path) -> Result<String, String> {
        fs::read_to_string(path).map_err(|error| error.to_string())
    }

    fn create_dir_all(&self, path: &Path) -> Result<(), String> {
        fs::create_dir_all(path).map_err(|error| error.to_string())
    }

    fn write(&self, path: &Path, contents: &[u8]) -> Result<(), String> {
        fs::write(path, contents).map_err(|error| error.to_string())
    }

    fn set_readonly(&self, path: &Path) -> Result<(), String> {
        let mut permissions = fs::metadata(path)
            .map_err(|error| error.to_string())?
            .permissions();
        permissions.set_readonly(true);
        fs::set_permissions(path, permissions).map_err(|error| error.to_string())
    }

    fn remove_dir_all(&self, path: &Path) -> Result<(), String> {
        #[cfg(windows)]
        make_tree_writable(path)?;
        fs::remove_dir_all(path).map_err(|error| error.to_string())
    }

    fn rename(&self, from: &Path, to: &Path) -> Result<(), String> {
        fs::rename(from, to).map_err(|error| error.to_string())
    }

    fn canonicalize(&self, path: &Path) -> Result<PathBuf, String> {
        path.canonicalize().map_err(|error| error.to_string())
    }

    fn exists(&self, path: &Path) -> bool {
        path.exists()
    }
}

#[cfg(windows)]
fn make_tree_writable(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() {
        return Ok(());
    }
    if metadata.is_dir() {
        for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
            make_tree_writable(&entry.map_err(|error| error.to_string())?.path())?;
        }
    }
    let mut permissions = metadata.permissions();
    if permissions.readonly() {
        permissions.set_readonly(false);
        fs::set_permissions(path, permissions).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, Default)]
pub struct SystemCommandRunner;

impl CommandRunner for SystemCommandRunner {
    fn run(&self, spec: &CommandSpec) -> Result<CommandOutput, String> {
        Self::run_with_limits(spec, Duration::from_secs(600), 1024 * 1024)
    }
}

impl SystemCommandRunner {
    pub fn run_with_limits(
        spec: &CommandSpec,
        timeout: Duration,
        output_limit: usize,
    ) -> Result<CommandOutput, String> {
        let mut command = Command::new(&spec.program);
        command.args(&spec.args);
        if spec.clear_environment {
            command.env_clear();
        }
        command.envs(spec.environment.iter().cloned());
        command.stdout(Stdio::piped()).stderr(Stdio::piped());
        configure_process_group(&mut command);
        let mut child = command.spawn().map_err(|error| error.to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or("Failed to capture command stdout")?;
        let stderr = child
            .stderr
            .take()
            .ok_or("Failed to capture command stderr")?;
        let overflowed = Arc::new(AtomicBool::new(false));
        let stdout_thread = capture_bounded(stdout, output_limit, Arc::clone(&overflowed));
        let stderr_thread = capture_bounded(stderr, output_limit, Arc::clone(&overflowed));
        let started = Instant::now();
        let status = loop {
            if overflowed.load(Ordering::Acquire) {
                terminate_process_tree(&mut child)?;
                let _ = stdout_thread.join();
                let _ = stderr_thread.join();
                return Err("Provisioning command output exceeded the safety limit".into());
            }
            if started.elapsed() >= timeout {
                terminate_process_tree(&mut child)?;
                let _ = stdout_thread.join();
                let _ = stderr_thread.join();
                return Err("Provisioning command timed out".into());
            }
            if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
                break status;
            }
            thread::sleep(Duration::from_millis(10));
        };
        let stdout = stdout_thread
            .join()
            .map_err(|_| "Command stdout reader panicked")??;
        let stderr = stderr_thread
            .join()
            .map_err(|_| "Command stderr reader panicked")??;
        if overflowed.load(Ordering::Acquire) {
            return Err("Provisioning command output exceeded the safety limit".into());
        }
        Ok(CommandOutput {
            success: status.success(),
            stdout,
            stderr,
        })
    }
}

fn capture_bounded(
    mut reader: impl Read + Send + 'static,
    limit: usize,
    overflowed: Arc<AtomicBool>,
) -> thread::JoinHandle<Result<Vec<u8>, String>> {
    thread::spawn(move || {
        let mut captured = Vec::new();
        let mut buffer = [0_u8; 8192];
        loop {
            let count = reader
                .read(&mut buffer)
                .map_err(|error| error.to_string())?;
            if count == 0 {
                return Ok(captured);
            }
            let remaining = limit.saturating_sub(captured.len());
            captured.extend_from_slice(&buffer[..count.min(remaining)]);
            if count > remaining {
                overflowed.store(true, Ordering::Release);
            }
        }
    })
}

#[cfg(unix)]
fn configure_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
}

#[cfg(windows)]
fn configure_process_group(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    command.creation_flags(CREATE_NEW_PROCESS_GROUP);
}

#[cfg(unix)]
fn terminate_process_tree(child: &mut std::process::Child) -> Result<(), String> {
    let process_group = -(child.id() as i32);
    unsafe {
        libc::kill(process_group, libc::SIGKILL);
    }
    child.wait().map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(windows)]
fn terminate_process_tree(child: &mut std::process::Child) -> Result<(), String> {
    let status = Command::new("taskkill")
        .args(["/PID", &child.id().to_string(), "/T", "/F"])
        .status()
        .map_err(|error| format!("Failed to terminate provisioning process tree: {error}"))?;
    let _ = child.kill();
    child.wait().map_err(|error| error.to_string())?;
    if !status.success() {
        return Err("Failed to guarantee provisioning descendant termination".into());
    }
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentEnvironment {
    pub root: PathBuf,
    pub python: PathBuf,
    pub site_packages: PathBuf,
}

impl AgentEnvironment {
    pub fn provision(
        app_data: &Path,
        system_python: &Path,
        resources: &ResourcePaths,
    ) -> Result<Self, String> {
        Self::provision_with_filesystem(
            app_data,
            system_python,
            resources,
            &SystemCommandRunner,
            &SystemEnvironmentFilesystem,
        )
    }

    pub fn provision_with_runner(
        app_data: &Path,
        system_python: &Path,
        resources: &ResourcePaths,
        runner: &dyn CommandRunner,
    ) -> Result<Self, String> {
        Self::provision_with_filesystem(
            app_data,
            system_python,
            resources,
            runner,
            &SystemEnvironmentFilesystem,
        )
    }

    pub fn provision_with_filesystem(
        app_data: &Path,
        system_python: &Path,
        resources: &ResourcePaths,
        runner: &dyn CommandRunner,
        filesystem: &dyn EnvironmentFilesystem,
    ) -> Result<Self, String> {
        let parent = app_data.join("agent-runtime");
        let root = parent.join("v1");
        let staging = parent.join("v1.staging");
        let backup = parent.join("v1.previous");
        filesystem.create_dir_all(&parent)?;
        let lock_path = parent.join(".provision.lock");
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .open(&lock_path)
            .map_err(|error| format!("Agent provisioning lock is unavailable: {error}"))?;
        lock.lock_exclusive()
            .map_err(|error| format!("Agent provisioning lock failed: {error}"))?;

        let canonical_parent = filesystem
            .canonicalize(&parent)
            .map_err(|error| format!("Agent runtime parent is unavailable: {error}"))?;
        let canonical_lock = filesystem
            .canonicalize(&lock_path)
            .map_err(|error| format!("Agent provisioning lock is invalid: {error}"))?;
        if !canonical_lock.starts_with(&canonical_parent) {
            return Err("Agent provisioning lock escaped app-data agent-runtime".into());
        }
        reject_root_escape(filesystem, &root, &canonical_parent)?;
        remove_dir_if_present(filesystem, &staging)
            .map_err(|error| format!("Failed to remove stale staging environment: {error}"))?;
        remove_dir_if_present(filesystem, &backup)
            .map_err(|error| format!("Failed to remove stale previous environment: {error}"))?;

        let requirements_bytes = filesystem.read(&resources.requirements)?;
        let requirements_text =
            std::str::from_utf8(&requirements_bytes).map_err(|_| "Requirements are not UTF-8")?;
        validate_requirements(requirements_text)?;

        let digest = hex::encode(Sha256::digest(&requirements_bytes));
        let marker_matches = filesystem
            .read_to_string(&root.join(".requirements-sha256"))
            .ok()
            .as_deref()
            == Some(digest.as_str());

        if !marker_matches {
            let create = clean_command(
                system_python,
                [
                    OsString::from("-I"),
                    OsString::from("-m"),
                    OsString::from("venv"),
                    OsString::from("--copies"),
                    staging.as_os_str().to_owned(),
                ],
                Vec::new(),
            );
            let create_result = runner.run(&create).and_then(|output| {
                require_success(output, "Failed to create dedicated agent environment")
            });
            if let Err(error) = create_result {
                return Err(cleanup_staging(filesystem, &staging, error));
            }

            let staging_python = python_path(&staging);
            let empty_pip_config = staging.join("pip-empty.conf");
            let staged_requirements = staging.join(".agent-requirements.txt");
            if let Err(error) = filesystem.write(&empty_pip_config, &[]) {
                return Err(cleanup_staging(
                    filesystem,
                    &staging,
                    format!("Failed to write isolated pip configuration: {error}"),
                ));
            }
            if let Err(error) = filesystem.write(&staged_requirements, &requirements_bytes) {
                return Err(cleanup_staging(
                    filesystem,
                    &staging,
                    format!("Failed to stage agent requirements: {error}"),
                ));
            }
            if let Err(error) = filesystem.set_readonly(&staged_requirements) {
                return Err(cleanup_staging(
                    filesystem,
                    &staging,
                    format!("Failed to protect staged agent requirements: {error}"),
                ));
            }
            let install = clean_command(
                &staging_python,
                [
                    OsString::from("-I"),
                    OsString::from("-m"),
                    OsString::from("pip"),
                    OsString::from("install"),
                    OsString::from("--disable-pip-version-check"),
                    OsString::from("--no-input"),
                    OsString::from("-r"),
                    staged_requirements.as_os_str().to_owned(),
                ],
                vec![
                    (
                        OsString::from("PIP_CONFIG_FILE"),
                        empty_pip_config.as_os_str().to_owned(),
                    ),
                    (OsString::from("PIP_NO_INPUT"), OsString::from("1")),
                    (
                        OsString::from("PIP_DISABLE_PIP_VERSION_CHECK"),
                        OsString::from("1"),
                    ),
                ],
            );
            let install_result = runner
                .run(&install)
                .and_then(|output| require_success(output, "Agent dependency installation failed"));
            if let Err(error) = install_result {
                return Err(cleanup_staging(filesystem, &staging, error));
            }

            if let Err(error) =
                filesystem.write(&staging.join(".requirements-sha256"), digest.as_bytes())
            {
                return Err(cleanup_staging(
                    filesystem,
                    &staging,
                    format!("Failed to write agent requirements marker: {error}"),
                ));
            }
            if let Err(error) = probe_environment(&staging, &staging_python, runner) {
                return Err(cleanup_staging(filesystem, &staging, error));
            }

            let had_previous = replace_with_staging(filesystem, &root, &staging, &backup)?;

            let promoted_python = python_path(&root);
            if let Err(error) = probe_environment(&root, &promoted_python, runner) {
                return Err(rollback_promoted(
                    filesystem,
                    &root,
                    &backup,
                    had_previous,
                    error,
                ));
            }
            remove_dir_if_present(filesystem, &backup)
                .map_err(|error| format!("Failed to remove previous agent environment: {error}"))?;
        }

        let python = python_path(&root);
        let site_packages = probe_environment(&root, &python, runner)?;
        canonical_environment(
            filesystem,
            &canonical_parent,
            &root,
            &python,
            &site_packages,
        )
    }

    pub fn verify(&self) -> Result<(), String> {
        let canonical_root = self
            .root
            .canonicalize()
            .map_err(|error| format!("Dedicated agent root is unavailable: {error}"))?;
        for (description, path) in [
            ("Agent Python", &self.python),
            ("Agent site-packages", &self.site_packages),
        ] {
            let canonical = path
                .canonicalize()
                .map_err(|error| format!("{description} is unavailable: {error}"))?;
            if !canonical.starts_with(&canonical_root) {
                return Err(format!("{description} escaped the dedicated agent root"));
            }
        }
        Ok(())
    }
}

fn reject_root_escape(
    filesystem: &dyn EnvironmentFilesystem,
    root: &Path,
    canonical_parent: &Path,
) -> Result<(), String> {
    if filesystem.exists(root) {
        let canonical_root = filesystem
            .canonicalize(root)
            .map_err(|error| format!("Existing agent environment is invalid: {error}"))?;
        if !canonical_root.starts_with(canonical_parent) {
            return Err("Existing agent environment escaped app-data agent-runtime".into());
        }
    }
    Ok(())
}

fn canonical_environment(
    filesystem: &dyn EnvironmentFilesystem,
    canonical_parent: &Path,
    root: &Path,
    python: &Path,
    site_packages: &Path,
) -> Result<AgentEnvironment, String> {
    let canonical_root = filesystem
        .canonicalize(root)
        .map_err(|error| format!("Dedicated agent root is unavailable: {error}"))?;
    if !canonical_root.starts_with(canonical_parent) {
        return Err("Dedicated agent root escaped app-data agent-runtime".into());
    }
    let canonical_python = canonical_child(filesystem, &canonical_root, python, "Agent Python")?;
    let canonical_site_packages = canonical_child(
        filesystem,
        &canonical_root,
        site_packages,
        "Agent site-packages",
    )?;
    Ok(AgentEnvironment {
        root: canonical_root,
        python: canonical_python,
        site_packages: canonical_site_packages,
    })
}

fn canonical_child(
    filesystem: &dyn EnvironmentFilesystem,
    canonical_root: &Path,
    path: &Path,
    description: &str,
) -> Result<PathBuf, String> {
    let canonical = filesystem
        .canonicalize(path)
        .map_err(|error| format!("{description} is unavailable: {error}"))?;
    if !canonical.starts_with(canonical_root) {
        return Err(format!("{description} escaped the dedicated agent root"));
    }
    Ok(canonical)
}

fn replace_with_staging(
    filesystem: &dyn EnvironmentFilesystem,
    root: &Path,
    staging: &Path,
    backup: &Path,
) -> Result<bool, String> {
    if let Err(error) = remove_dir_if_present(filesystem, backup) {
        return Err(cleanup_staging(
            filesystem,
            staging,
            format!("Failed to remove stale previous agent environment: {error}"),
        ));
    }

    let had_previous = filesystem.exists(root);
    if had_previous {
        if let Err(error) = filesystem.rename(root, backup) {
            return Err(cleanup_staging(
                filesystem,
                staging,
                format!("Failed to move previous agent environment: {error}"),
            ));
        }
    }

    if let Err(promotion_error) = filesystem.rename(staging, root) {
        let mut error = format!("Agent environment promotion failed: {promotion_error}");
        if had_previous {
            if let Err(restore_error) = filesystem.rename(backup, root) {
                error.push_str(&format!(
                    "; failed to restore previous agent environment: {restore_error}"
                ));
            }
        }
        return Err(cleanup_staging(filesystem, staging, error));
    }
    Ok(had_previous)
}

fn rollback_promoted(
    filesystem: &dyn EnvironmentFilesystem,
    root: &Path,
    backup: &Path,
    had_previous: bool,
    primary_error: String,
) -> String {
    let mut error = primary_error;
    if let Err(remove_error) = remove_dir_if_present(filesystem, root) {
        error.push_str(&format!(
            "; remove failed promoted agent environment: {remove_error}"
        ));
        return error;
    }
    if had_previous {
        if let Err(restore_error) = filesystem.rename(backup, root) {
            error.push_str(&format!(
                "; failed to restore previous agent environment: {restore_error}"
            ));
        }
    }
    error
}

fn cleanup_staging(
    filesystem: &dyn EnvironmentFilesystem,
    staging: &Path,
    primary_error: String,
) -> String {
    match remove_dir_if_present(filesystem, staging) {
        Ok(()) => primary_error,
        Err(cleanup_error) => {
            format!("{primary_error}; failed to clean staging environment: {cleanup_error}")
        }
    }
}

fn clean_command<I>(
    program: &Path,
    args: I,
    mut environment: Vec<(OsString, OsString)>,
) -> CommandSpec
where
    I: IntoIterator<Item = OsString>,
{
    environment.push((OsString::from("PATH"), OsString::from(installer_path())));
    CommandSpec {
        program: program.to_path_buf(),
        args: args.into_iter().collect(),
        environment,
        clear_environment: true,
    }
}

#[cfg(unix)]
fn installer_path() -> &'static str {
    "/usr/bin:/bin"
}

#[cfg(windows)]
fn installer_path() -> &'static str {
    r"C:\Windows\System32"
}

fn python_path(root: &Path) -> PathBuf {
    if cfg!(windows) {
        root.join("Scripts").join("python.exe")
    } else {
        root.join("bin").join("python3")
    }
}

fn probe_environment(
    root: &Path,
    python: &Path,
    runner: &dyn CommandRunner,
) -> Result<PathBuf, String> {
    let expected = EXPECTED_IMPORTS
        .iter()
        .map(|name| format!("{name:?}"))
        .collect::<Vec<_>>()
        .join(",");
    let denied = DENIED_IMPORTS
        .iter()
        .map(|name| format!("{name:?}"))
        .collect::<Vec<_>>()
        .join(",");
    let probe = format!(
        r#"import importlib.util, pathlib, site, sys
root = pathlib.Path(sys.argv[1]).resolve()
def inside(path):
    try:
        pathlib.Path(path).resolve().relative_to(root)
        return True
    except ValueError:
        return False
for name in ({expected},):
    spec = importlib.util.find_spec(name)
    assert spec is not None
    locations = list(spec.submodule_search_locations or ())
    origins = locations or ([spec.origin] if spec.origin else [])
    assert origins and all(inside(origin) for origin in origins)
for name in ({denied},):
    assert importlib.util.find_spec(name) is None
paths = [pathlib.Path(path).resolve() for path in site.getsitepackages()]
assert len(paths) == 1 and inside(paths[0])
assert inside(pathlib.Path(sys.executable).resolve())
print(paths[0])
"#
    );
    let spec = clean_command(
        python,
        [
            OsString::from("-I"),
            OsString::from("-c"),
            OsString::from(probe),
            root.as_os_str().to_owned(),
        ],
        vec![(OsString::from("PYTHONNOUSERSITE"), OsString::from("1"))],
    );
    let output = runner.run(&spec)?;
    require_success(output.clone(), "Agent environment verification failed")?;
    let stdout = String::from_utf8(output.stdout)
        .map_err(|_| "Agent environment verification returned non-UTF-8 output")?;
    let site_packages = PathBuf::from(stdout.trim());
    if site_packages.as_os_str().is_empty() {
        return Err("Agent environment verification returned no site-packages path".into());
    }
    Ok(site_packages)
}

fn require_success(output: CommandOutput, message: &str) -> Result<(), String> {
    if output.success {
        Ok(())
    } else {
        let diagnostic = safe_stderr_diagnostic(&output.stderr);
        if diagnostic.is_empty() {
            Err(message.into())
        } else {
            Err(format!("{message}: {diagnostic}"))
        }
    }
}

fn safe_stderr_diagnostic(stderr: &[u8]) -> String {
    const DIAGNOSTIC_LIMIT: usize = 2_048;
    let text = String::from_utf8_lossy(stderr);
    let mut result = String::new();
    for line in text.lines() {
        let lowercase = line.to_ascii_lowercase();
        let sensitive = [
            "authorization",
            "bearer",
            "credential",
            "password",
            "passwd",
            "secret",
            "token",
            "api_key",
        ]
        .iter()
        .any(|word| lowercase.contains(word))
            || (lowercase.contains("://") && lowercase.contains('@'));
        let safe_line = if sensitive { "[redacted]" } else { line };
        if !result.is_empty() {
            result.push('\n');
        }
        let remaining = DIAGNOSTIC_LIMIT.saturating_sub(result.len());
        if remaining == 0 {
            break;
        }
        for character in safe_line.chars() {
            if character.len_utf8() > DIAGNOSTIC_LIMIT.saturating_sub(result.len()) {
                break;
            }
            result.push(character);
        }
    }
    if result.len() == DIAGNOSTIC_LIMIT && stderr.len() > DIAGNOSTIC_LIMIT {
        result.truncate(DIAGNOSTIC_LIMIT.saturating_sub(3));
        result.push_str("...");
    }
    result
}

fn remove_dir_if_present(
    filesystem: &dyn EnvironmentFilesystem,
    path: &Path,
) -> Result<(), String> {
    if filesystem.exists(path) {
        filesystem.remove_dir_all(path)
    } else {
        Ok(())
    }
}
