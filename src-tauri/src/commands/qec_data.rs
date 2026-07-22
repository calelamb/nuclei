use std::fmt;
use std::fs;
use std::io::{self, BufRead, BufReader};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdout, Command, Stdio};
use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{Manager, State, WebviewWindow};
use tauri_plugin_fs::FsExt;

pub const QEC_DATA_PORT: u16 = 9743;
const QEC_DATA_HOST: &str = "127.0.0.1";
const TOKEN_ENV: &str = "NUCLEI_QEC_DATA_TOKEN";
const PROJECT_ENV: &str = "NUCLEI_QEC_DATA_PROJECT_ROOT";
const DEFAULT_MODULE: &str = "kernel.qec_data.server";
const READINESS_PREFIX: &str = "NUCLEI_QEC_DATA_READY ";
const ERROR_PREFIX: &str = "NUCLEI_QEC_DATA_ERROR ";
const MAX_CHILD_LINE_BYTES: usize = 8 * 1024;
const DEFAULT_READINESS_TIMEOUT: Duration = Duration::from_secs(8);
const DEFAULT_DEPENDENCY_TIMEOUT: Duration = Duration::from_secs(5);
const REQUIRED_DEPENDENCIES: &[&str] = &["websockets", "pyarrow", "duckdb", "jsonschema"];

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QecDataEndpoint {
    pub url: String,
    pub token: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum QecDataLifecycle {
    Stopped,
    Starting,
    Running,
    Failed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QecDataStatus {
    pub lifecycle: QecDataLifecycle,
    pub url: Option<String>,
    pub error_code: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QecDataError {
    pub code: String,
    pub message: String,
    pub missing_dependencies: Vec<String>,
}

impl QecDataError {
    fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.to_string(),
            message: message.to_string(),
            missing_dependencies: Vec::new(),
        }
    }

    fn missing(dependencies: Vec<String>) -> Self {
        Self {
            code: "missing_dependency".to_string(),
            message: "Install the QEC Data Engine dependencies before starting.".to_string(),
            missing_dependencies: dependencies,
        }
    }
}

impl fmt::Display for QecDataError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

#[derive(Clone, Debug)]
pub struct QecDataLaunchConfig {
    python: PathBuf,
    module_root: PathBuf,
    project_root: PathBuf,
    port: u16,
    module: String,
    dependencies: Vec<String>,
    dependency_timeout: Duration,
    readiness_timeout: Duration,
    authorized_project: Option<AuthorizedProjectRoot>,
}

#[derive(Clone, Debug)]
pub struct AuthorizedProjectRoot {
    path: PathBuf,
    identity: ProjectFileIdentity,
}

#[cfg(unix)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ProjectFileIdentity {
    device: u64,
    inode: u64,
}

#[cfg(windows)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ProjectFileIdentity {
    volume: Option<u32>,
    index: Option<u64>,
}

#[cfg(not(any(unix, windows)))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ProjectFileIdentity {
    length: u64,
}

impl QecDataLaunchConfig {
    pub fn new(
        python: impl Into<PathBuf>,
        module_root: impl Into<PathBuf>,
        project_root: impl Into<PathBuf>,
        port: u16,
    ) -> Self {
        Self {
            python: python.into(),
            module_root: module_root.into(),
            project_root: project_root.into(),
            port,
            module: DEFAULT_MODULE.to_string(),
            dependencies: REQUIRED_DEPENDENCIES
                .iter()
                .map(|dependency| (*dependency).to_string())
                .collect(),
            dependency_timeout: DEFAULT_DEPENDENCY_TIMEOUT,
            readiness_timeout: DEFAULT_READINESS_TIMEOUT,
            authorized_project: None,
        }
    }

    pub fn new_authorized(
        python: impl Into<PathBuf>,
        module_root: impl Into<PathBuf>,
        project: AuthorizedProjectRoot,
        port: u16,
    ) -> Self {
        let project_root = project.path.clone();
        Self {
            authorized_project: Some(project),
            ..Self::new(python, module_root, project_root, port)
        }
    }

    pub fn with_module(mut self, module: impl Into<String>) -> Self {
        self.module = module.into();
        self
    }

    pub fn with_dependencies(mut self, dependencies: Vec<String>) -> Self {
        self.dependencies = dependencies;
        self
    }

    pub fn with_readiness_timeout(mut self, timeout: Duration) -> Self {
        self.readiness_timeout = timeout;
        self
    }

    pub fn with_dependency_timeout(mut self, timeout: Duration) -> Self {
        self.dependency_timeout = timeout;
        self
    }
}

enum EngineState {
    Stopped,
    Starting,
    Running {
        child: Child,
        endpoint: QecDataEndpoint,
        project_root: PathBuf,
    },
    Failed(QecDataError),
}

pub struct QecDataManager {
    state: Mutex<EngineState>,
}

impl QecDataManager {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(EngineState::Stopped),
        }
    }

    pub fn start(&self, config: QecDataLaunchConfig) -> Result<QecDataEndpoint, QecDataError> {
        let project_root = match &config.authorized_project {
            Some(project) => verify_authorized_project(project)?,
            None => canonical_directory(&config.project_root, "invalid_project_root")?,
        };
        let mut state = self.lock_state()?;
        if let Some(endpoint) = running_endpoint(&mut state, &project_root)? {
            return Ok(endpoint);
        }
        *state = EngineState::Starting;
        match start_owned_child(config, project_root.clone()) {
            Ok((child, endpoint)) => {
                *state = EngineState::Running {
                    child,
                    endpoint: endpoint.clone(),
                    project_root,
                };
                Ok(endpoint)
            }
            Err(error) => {
                *state = EngineState::Failed(error.clone());
                Err(error)
            }
        }
    }

    pub fn stop(&self) -> Result<(), QecDataError> {
        let mut state = self.lock_state()?;
        let prior = std::mem::replace(&mut *state, EngineState::Stopped);
        if let EngineState::Running { mut child, .. } = prior {
            terminate_child(&mut child);
        }
        Ok(())
    }

    pub fn status(&self) -> QecDataStatus {
        let Ok(mut state) = self.state.lock() else {
            return failed_status("state_unavailable");
        };
        if let EngineState::Running { child, .. } = &mut *state {
            match child.try_wait() {
                Ok(None) => {}
                Ok(Some(_)) | Err(_) => {
                    *state = EngineState::Failed(QecDataError::new(
                        "child_exited",
                        "QEC Data Engine exited unexpectedly.",
                    ));
                }
            }
        }
        status_for(&state)
    }

    fn lock_state(&self) -> Result<std::sync::MutexGuard<'_, EngineState>, QecDataError> {
        self.state.lock().map_err(|_| {
            QecDataError::new("state_unavailable", "QEC Data Engine state is unavailable.")
        })
    }
}

impl Default for QecDataManager {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for QecDataManager {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

fn running_endpoint(
    state: &mut EngineState,
    requested_project: &Path,
) -> Result<Option<QecDataEndpoint>, QecDataError> {
    let EngineState::Running {
        child,
        endpoint,
        project_root,
    } = state
    else {
        return Ok(None);
    };
    match child.try_wait() {
        Ok(None) if project_root == requested_project => Ok(Some(endpoint.clone())),
        Ok(None) => Err(QecDataError::new(
            "project_mismatch",
            "QEC Data Engine is already running for another project.",
        )),
        Ok(Some(_)) => Ok(None),
        Err(_) => Err(QecDataError::new(
            "child_status_failed",
            "Could not inspect the QEC Data Engine child.",
        )),
    }
}

fn start_owned_child(
    config: QecDataLaunchConfig,
    project_root: PathBuf,
) -> Result<(Child, QecDataEndpoint), QecDataError> {
    validate_config(&config)?;
    let module_root = canonical_directory(&config.module_root, "invalid_module_root")?;
    ensure_dependencies(
        &config.python,
        &config.dependencies,
        config.dependency_timeout,
    )?;
    ensure_port_available(config.port)?;
    let token = generate_token()?;
    let endpoint = QecDataEndpoint {
        url: format!("ws://{QEC_DATA_HOST}:{}", config.port),
        token: token.clone(),
    };
    let mut child = spawn_child(&config, &module_root, &project_root, &token)?;
    if let Err(error) = await_readiness(&mut child, &config, &token) {
        terminate_child(&mut child);
        return Err(error);
    }
    Ok((child, endpoint))
}

fn validate_config(config: &QecDataLaunchConfig) -> Result<(), QecDataError> {
    let valid_module = !config.module.is_empty()
        && config
            .module
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.'));
    if !valid_module
        || config.port == 0
        || config.readiness_timeout.is_zero()
        || config.dependency_timeout.is_zero()
    {
        return Err(QecDataError::new(
            "invalid_launch_config",
            "QEC Data Engine launch configuration is invalid.",
        ));
    }
    if config.dependencies.iter().any(|name| {
        name.is_empty()
            || !name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
    }) {
        return Err(QecDataError::new(
            "invalid_launch_config",
            "QEC Data Engine dependency list is invalid.",
        ));
    }
    Ok(())
}

fn canonical_directory(path: &Path, code: &str) -> Result<PathBuf, QecDataError> {
    let canonical = path.canonicalize().map_err(|_| {
        QecDataError::new(code, "Required QEC Data Engine directory is unavailable.")
    })?;
    if !canonical.is_dir() {
        return Err(QecDataError::new(
            code,
            "Required QEC Data Engine path is not a directory.",
        ));
    }
    Ok(canonical)
}

fn ensure_port_available(port: u16) -> Result<(), QecDataError> {
    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
    TcpListener::bind(address)
        .map(drop)
        .map_err(|_| QecDataError::new("port_in_use", "QEC Data Engine port is in use."))
}

fn ensure_dependencies(
    python: &Path,
    dependencies: &[String],
    timeout: Duration,
) -> Result<(), QecDataError> {
    if dependencies.is_empty() {
        return Ok(());
    }
    let probe = "import importlib.util,sys; missing=[name for name in sys.argv[1:] if importlib.util.find_spec(name) is None]; print('\\n'.join(missing)); sys.exit(bool(missing))";
    let mut child = Command::new(python)
        .arg("-c")
        .arg(probe)
        .args(dependencies)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| {
            QecDataError::new(
                "python_unavailable",
                "Python could not start the QEC Data Engine dependency probe.",
            )
        })?;
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(10)),
            Ok(None) => {
                terminate_child(&mut child);
                return Err(QecDataError::new(
                    "dependency_timeout",
                    "QEC Data Engine dependency probe timed out.",
                ));
            }
            Err(_) => {
                terminate_child(&mut child);
                return Err(QecDataError::new(
                    "dependency_probe_failed",
                    "Could not inspect the QEC Data Engine dependency probe.",
                ));
            }
        }
    };
    let output = child.wait_with_output().map_err(|_| {
        QecDataError::new(
            "dependency_probe_failed",
            "Could not collect the QEC Data Engine dependency probe.",
        )
    })?;
    if status.success() {
        return Ok(());
    }
    let missing = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|name| dependencies.iter().any(|expected| expected == name))
        .map(str::to_string)
        .collect();
    Err(QecDataError::missing(missing))
}

fn spawn_child(
    config: &QecDataLaunchConfig,
    module_root: &Path,
    project_root: &Path,
    token: &str,
) -> Result<Child, QecDataError> {
    Command::new(&config.python)
        .args(["-m", &config.module, "--port", &config.port.to_string()])
        .current_dir(module_root)
        .env(TOKEN_ENV, token)
        .env(PROJECT_ENV, project_root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| {
            QecDataError::new(
                "spawn_failed",
                "Could not start the QEC Data Engine child process.",
            )
        })
}

enum StartupLine {
    Line(String),
    Ended,
    TooLong,
}

fn await_readiness(
    child: &mut Child,
    config: &QecDataLaunchConfig,
    token: &str,
) -> Result<(), QecDataError> {
    let stdout = child.stdout.take().ok_or_else(|| {
        QecDataError::new("startup_failed", "QEC Data Engine stdout is unavailable.")
    })?;
    let (sender, receiver) = mpsc::sync_channel(1);
    spawn_stdout_drain(stdout, token.to_string(), sender);
    if let Some(stderr) = child.stderr.take() {
        spawn_log_drain(stderr, token.to_string(), "stderr");
    }
    match receiver.recv_timeout(config.readiness_timeout) {
        Ok(StartupLine::Line(line)) => parse_readiness(&line, config.port),
        Ok(StartupLine::Ended) => Err(QecDataError::new(
            "startup_failed",
            "QEC Data Engine exited before readiness.",
        )),
        Ok(StartupLine::TooLong) => Err(QecDataError::new(
            "startup_failed",
            "QEC Data Engine emitted an invalid readiness line.",
        )),
        Err(mpsc::RecvTimeoutError::Timeout) => Err(QecDataError::new(
            "readiness_timeout",
            "QEC Data Engine readiness timed out.",
        )),
        Err(mpsc::RecvTimeoutError::Disconnected) => Err(QecDataError::new(
            "startup_failed",
            "QEC Data Engine readiness channel closed.",
        )),
    }
}

fn parse_readiness(line: &str, port: u16) -> Result<(), QecDataError> {
    if line == format!("{READINESS_PREFIX}{QEC_DATA_HOST}:{port}") {
        return Ok(());
    }
    if line == format!("{ERROR_PREFIX}port_in_use") {
        return Err(QecDataError::new(
            "port_in_use",
            "QEC Data Engine port is in use.",
        ));
    }
    Err(QecDataError::new(
        "startup_failed",
        "QEC Data Engine reported a startup failure.",
    ))
}

fn spawn_stdout_drain(stdout: ChildStdout, token: String, sender: mpsc::SyncSender<StartupLine>) {
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let first = match read_bounded_line(&mut reader, MAX_CHILD_LINE_BYTES) {
            Ok(Some(line)) => StartupLine::Line(line),
            Ok(None) => StartupLine::Ended,
            Err(_) => StartupLine::TooLong,
        };
        let _ = sender.send(first);
        drain_reader(&mut reader, &token, "stdout");
    });
}

fn spawn_log_drain<R>(reader: R, token: String, stream: &'static str)
where
    R: io::Read + Send + 'static,
{
    thread::spawn(move || {
        let mut buffered = BufReader::new(reader);
        drain_reader(&mut buffered, &token, stream);
    });
}

fn drain_reader<R: BufRead>(reader: &mut R, token: &str, stream: &str) {
    loop {
        match read_bounded_line(reader, MAX_CHILD_LINE_BYTES) {
            Ok(Some(line)) => log::info!("[qec-data {stream}] {}", redact(&line, token)),
            Ok(None) => break,
            Err(_) => log::warn!("[qec-data {stream}] oversized child log line discarded"),
        }
    }
}

fn read_bounded_line<R: BufRead>(reader: &mut R, limit: usize) -> io::Result<Option<String>> {
    let mut bytes = Vec::new();
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return if bytes.is_empty() {
                Ok(None)
            } else {
                String::from_utf8(bytes)
                    .map(Some)
                    .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid UTF-8"))
            };
        }
        let take = available
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(available.len(), |index| index + 1);
        if bytes.len() + take > limit {
            reader.consume(take);
            return Err(io::Error::new(io::ErrorKind::InvalidData, "line too long"));
        }
        bytes.extend_from_slice(&available[..take]);
        reader.consume(take);
        if bytes.last() == Some(&b'\n') {
            bytes.pop();
            if bytes.last() == Some(&b'\r') {
                bytes.pop();
            }
            return String::from_utf8(bytes)
                .map(Some)
                .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid UTF-8"));
        }
    }
}

fn redact(line: &str, token: &str) -> String {
    if token.is_empty() {
        line.to_string()
    } else {
        line.replace(token, "[REDACTED]")
    }
}

fn terminate_child(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn status_for(state: &EngineState) -> QecDataStatus {
    match state {
        EngineState::Stopped => QecDataStatus {
            lifecycle: QecDataLifecycle::Stopped,
            url: None,
            error_code: None,
        },
        EngineState::Starting => QecDataStatus {
            lifecycle: QecDataLifecycle::Starting,
            url: None,
            error_code: None,
        },
        EngineState::Running { endpoint, .. } => QecDataStatus {
            lifecycle: QecDataLifecycle::Running,
            url: Some(endpoint.url.clone()),
            error_code: None,
        },
        EngineState::Failed(error) => QecDataStatus {
            lifecycle: QecDataLifecycle::Failed,
            url: None,
            error_code: Some(error.code.clone()),
        },
    }
}

fn failed_status(code: &str) -> QecDataStatus {
    QecDataStatus {
        lifecycle: QecDataLifecycle::Failed,
        url: None,
        error_code: Some(code.to_string()),
    }
}

pub fn authorize_project_access(
    project_root: &Path,
    is_allowed: impl Fn(&Path) -> bool,
) -> Result<AuthorizedProjectRoot, QecDataError> {
    let project_root = canonical_directory(project_root, "invalid_project_root")?;
    let qec_data = project_root.join("qec-data");
    let authorized = [
        project_root.to_path_buf(),
        qec_data.clone(),
        qec_data.join("sessions"),
        qec_data.join("sources"),
    ]
    .iter()
    .all(|path| is_allowed(path));
    if authorized {
        let metadata = fs::metadata(&project_root).map_err(|_| {
            QecDataError::new(
                "invalid_project_root",
                "Authorized project identity is unavailable.",
            )
        })?;
        Ok(AuthorizedProjectRoot {
            path: project_root,
            identity: project_file_identity(&metadata),
        })
    } else {
        Err(QecDataError::new(
            "project_not_authorized",
            "The selected project is not authorized for QEC Data Engine access.",
        ))
    }
}

fn verify_authorized_project(project: &AuthorizedProjectRoot) -> Result<PathBuf, QecDataError> {
    let metadata = fs::metadata(&project.path).map_err(|_| project_identity_changed())?;
    if !metadata.is_dir() || project_file_identity(&metadata) != project.identity {
        return Err(project_identity_changed());
    }
    Ok(project.path.clone())
}

fn project_identity_changed() -> QecDataError {
    QecDataError::new(
        "project_identity_changed",
        "Authorized project identity changed before the QEC Data Engine started.",
    )
}

#[cfg(unix)]
fn project_file_identity(metadata: &fs::Metadata) -> ProjectFileIdentity {
    use std::os::unix::fs::MetadataExt;

    ProjectFileIdentity {
        device: metadata.dev(),
        inode: metadata.ino(),
    }
}

#[cfg(windows)]
fn project_file_identity(metadata: &fs::Metadata) -> ProjectFileIdentity {
    use std::os::windows::fs::MetadataExt;

    ProjectFileIdentity {
        volume: metadata.volume_serial_number(),
        index: metadata.file_index(),
    }
}

#[cfg(not(any(unix, windows)))]
fn project_file_identity(metadata: &fs::Metadata) -> ProjectFileIdentity {
    ProjectFileIdentity {
        length: metadata.len(),
    }
}

pub fn generate_token() -> Result<String, QecDataError> {
    let mut bytes = [0_u8; 32];
    getrandom::getrandom(&mut bytes).map_err(|_| {
        QecDataError::new(
            "random_unavailable",
            "OS randomness is unavailable for QEC Data Engine authentication.",
        )
    })?;
    Ok(hex::encode(bytes))
}

fn production_config(
    app_handle: &tauri::AppHandle,
    project: AuthorizedProjectRoot,
) -> Result<QecDataLaunchConfig, QecDataError> {
    let python = crate::commands::frameworks::ensure_kernel_runtime(app_handle)
        .map_err(|_| QecDataError::new("python_unavailable", "Managed Python is unavailable."))?;
    let module_root = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| {
                QecDataError::new("invalid_module_root", "Repository root is unavailable.")
            })?
    } else {
        app_handle.path().resource_dir().map_err(|_| {
            QecDataError::new(
                "invalid_module_root",
                "Application resources are unavailable.",
            )
        })?
    };
    Ok(QecDataLaunchConfig::new_authorized(
        python,
        module_root,
        project,
        QEC_DATA_PORT,
    ))
}

#[tauri::command]
pub fn qec_data_start(
    state: State<'_, QecDataManager>,
    app_handle: tauri::AppHandle,
    window: WebviewWindow,
    project_root: PathBuf,
) -> Result<QecDataEndpoint, QecDataError> {
    let scope = window.fs_scope();
    let project = authorize_project_access(&project_root, |path| scope.is_allowed(path))?;
    let config = production_config(&app_handle, project)?;
    state.start(config)
}

#[tauri::command]
pub fn qec_data_stop(state: State<'_, QecDataManager>) -> Result<(), QecDataError> {
    state.stop()
}

#[tauri::command]
pub fn qec_data_status(state: State<'_, QecDataManager>) -> QecDataStatus {
    state.status()
}
