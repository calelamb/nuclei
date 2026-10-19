use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{Manager, State};

pub mod health;

use super::kernel_legacy;
use super::kernel_ownership as ownership;
use super::qec_data::redact;

// Canonical kernel port. The frontend connects here by hardcoded URL
// (see src/config/kernel.ts), so our freshly-spawned kernel must own it.
// A leftover kernel that Nuclei itself recorded is reaped; anything else
// holding the port is left alone and reported as an error, so the
// per-launch auth token is never handed to a process we did not start.
const KERNEL_PORT: u16 = 9742;

const TOKEN_ENV: &str = "NUCLEI_KERNEL_TOKEN";
// Carries no secret: tells the kernel to read the token from stdin. The token
// is kept out of the environment because a process's initial environment block
// stays readable by same-user processes (sysctl KERN_PROCARGS2, /proc).
const TOKEN_STDIN_ENV: &str = "NUCLEI_KERNEL_TOKEN_STDIN";
const RUNTIME_DIR_ENV: &str = "NUCLEI_RUNTIME_DIR";
const STRICT_PORT_ENV: &str = "NUCLEI_KERNEL_STRICT_PORT";
const DEV_ENV: &str = "NUCLEI_KERNEL_DEV";
// Extra loopback dev-server origins the kernel accepts in dev mode only.
const DEV_ORIGINS_ENV: &str = "NUCLEI_KERNEL_DEV_ORIGINS";
// Figures are captured by the kernel, never shown: no GUI backend, ever.
const MPLBACKEND_ENV: &str = "MPLBACKEND";
const INSECURE_ENV: &str = "NUCLEI_KERNEL_INSECURE_DEV";

pub struct KernelState {
    process: Mutex<Option<Child>>,
    token: Mutex<Option<String>>,
    /// True from a successful start until an intentional stop: the health
    /// supervisor only restarts a kernel the user still wants running.
    supervised: AtomicBool,
}

impl KernelState {
    pub fn new() -> Self {
        Self {
            process: Mutex::new(None),
            token: Mutex::new(None),
            supervised: AtomicBool::new(false),
        }
    }

    fn is_supervised(&self) -> bool {
        self.supervised.load(Ordering::SeqCst)
    }

    fn set_supervised(&self, supervised: bool) {
        self.supervised.store(supervised, Ordering::SeqCst);
    }

    pub fn stop(&self) {
        // First, so the supervisor never restarts what we are deliberately stopping.
        self.set_supervised(false);
        if let Ok(mut guard) = self.process.lock() {
            if let Some(ref mut child) = *guard {
                stop_child_gracefully(child, KERNEL_STOP_GRACE);
            }
            *guard = None;
        }
        if let Ok(mut token) = self.token.lock() {
            *token = None;
        }
        if let Some(dir) = ownership::runtime_dir() {
            ownership::remove_owner_record(&dir);
        }
    }
}

/// Environment for the kernel child: stdin token mode, strict port, a headless
/// matplotlib backend, and no dev/test overrides in release builds (a stray
/// `NUCLEI_KERNEL_DEV` or `NUCLEI_KERNEL_DEV_ORIGINS` would widen the allowed
/// Origins and `NUCLEI_RUNTIME_DIR` would redirect the runtime file).
fn configure_kernel_env(command: &mut Command, debug_build: bool) {
    command
        .env_remove(TOKEN_ENV)
        .env(TOKEN_STDIN_ENV, "1")
        .env(STRICT_PORT_ENV, "1")
        .env(MPLBACKEND_ENV, "Agg")
        .env_remove(INSECURE_ENV);
    if debug_build {
        command.env(DEV_ENV, "1");
    } else {
        command
            .env_remove(DEV_ENV)
            .env_remove(DEV_ORIGINS_ENV)
            .env_remove(RUNTIME_DIR_ENV);
    }
}

/// Write `token\n` to the kernel's stdin and close it.
fn deliver_token(stdin: Option<std::process::ChildStdin>, token: &str) -> std::io::Result<()> {
    let mut stdin = stdin.ok_or_else(|| std::io::Error::other("kernel stdin is unavailable"))?;
    write_token_line(&mut stdin, token)
}

fn write_token_line(writer: &mut impl Write, token: &str) -> std::io::Result<()> {
    writer.write_all(token.as_bytes())?;
    writer.write_all(b"\n")?;
    writer.flush()
}

/// How long a freshly spawned kernel has to print its ready line (Python and
/// numpy imports are slow on a cold disk). Only after that line is the token
/// stored and handed to the webview.
const KERNEL_READY_TIMEOUT: Duration = Duration::from_secs(20);

/// True for exactly `Nuclei kernel ready on ws://localhost:<port>`.
fn is_ready_line(line: &str, port: u16) -> bool {
    line.trim() == format!("Nuclei kernel ready on ws://localhost:{port}")
}

#[derive(Debug, Eq, PartialEq)]
enum StartupSignal {
    Ready,
    /// The kernel's stdout closed before it reported ready (it exited).
    Ended,
}

/// Block until the drain thread reports the ready line, the stream ends, or
/// the timeout expires.
fn wait_for_ready(
    signals: &mpsc::Receiver<StartupSignal>,
    timeout: Duration,
) -> Result<(), String> {
    match signals.recv_timeout(timeout) {
        Ok(StartupSignal::Ready) => Ok(()),
        Ok(StartupSignal::Ended) | Err(mpsc::RecvTimeoutError::Disconnected) => Err(
            "The kernel exited before it was ready (is port 9742 held by another \
             application, or is Python missing a dependency?)."
                .to_string(),
        ),
        Err(mpsc::RecvTimeoutError::Timeout) => Err(format!(
            "The kernel did not report ready within {} seconds.",
            timeout.as_secs()
        )),
    }
}

/// How long the kernel gets to handle SIGTERM (it deletes its runtime file
/// on the way out) before it is killed outright.
const KERNEL_STOP_GRACE: std::time::Duration = std::time::Duration::from_millis(1500);
const KERNEL_STOP_POLL: std::time::Duration = std::time::Duration::from_millis(25);

/// SIGTERM, wait up to `grace` for a clean exit, then SIGKILL. A bare
/// `kill()` is SIGKILL on unix, which left `~/.nuclei/runtime/kernel.json`
/// (with a dead token and port) behind after every quit.
fn stop_child_gracefully(child: &mut Child, grace: std::time::Duration) {
    #[cfg(unix)]
    {
        let _ = Command::new("kill")
            .args(["-TERM", &child.id().to_string()])
            .status();
        let exited = ownership::wait_until(grace, KERNEL_STOP_POLL, || {
            matches!(child.try_wait(), Ok(Some(_)))
        });
        if exited {
            return;
        }
    }
    #[cfg(not(unix))]
    let _ = grace;
    let _ = child.kill();
    let _ = child.wait();
}

impl Default for KernelState {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for KernelState {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Why a kernel start was requested.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StartMode {
    /// The frontend asked (first launch, reconnect, "restart kernel"): always
    /// replace whatever is running.
    Always,
    /// The health supervisor asked: do nothing if, once the process lock is
    /// held, the kernel turns out to be fine (or no longer wanted) after all.
    IfUnhealthy,
}

enum StartOutcome {
    Started { pid: u32, message: String },
    Skipped,
}

/// True when the recorded child is alive and its port has a listener.
fn kernel_is_healthy(child: &mut Option<Child>) -> bool {
    match child.as_mut() {
        Some(child) => {
            matches!(child.try_wait(), Ok(None)) && health::port_is_listening(KERNEL_PORT)
        }
        None => false,
    }
}

#[derive(Debug, PartialEq, Eq)]
enum StartDecision {
    Proceed,
    Skip,
}

/// Decide, with the process lock held, whether a start request should run.
/// A supervisor restart is dropped if the kernel recovered meanwhile or is no
/// longer wanted. An explicit start stops supervision until it succeeds, so a
/// failed manual start (say, the port is held by another app) is reported to the
/// user instead of being retried behind their back.
fn begin_start(state: &KernelState, child: &mut Option<Child>, mode: StartMode) -> StartDecision {
    match mode {
        StartMode::IfUnhealthy if !state.is_supervised() || kernel_is_healthy(child) => {
            StartDecision::Skip
        }
        StartMode::IfUnhealthy => StartDecision::Proceed,
        StartMode::Always => {
            state.set_supervised(false);
            StartDecision::Proceed
        }
    }
}

#[tauri::command(async)]
pub fn start_kernel(
    state: State<'_, KernelState>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    match start_kernel_inner(&state, &app_handle, StartMode::Always)? {
        StartOutcome::Started { message, .. } => Ok(message),
        StartOutcome::Skipped => Err("Kernel start was skipped".to_string()),
    }
}

fn start_kernel_inner(
    state: &KernelState,
    app_handle: &tauri::AppHandle,
    mode: StartMode,
) -> Result<StartOutcome, String> {
    let mut guard = state.process.lock().map_err(|e| e.to_string())?;
    if begin_start(state, &mut guard, mode) == StartDecision::Skip {
        return Ok(StartOutcome::Skipped);
    }
    *state.token.lock().map_err(|e| e.to_string())? = None;

    // Kill existing in-process handle if any — relevant during reconnect
    // flows where the user triggered a kernel restart from the UI.
    if let Some(ref mut child) = *guard {
        stop_child_gracefully(child, KERNEL_STOP_GRACE);
    }
    *guard = None;

    // Reap a kernel that a previous Nuclei run recorded and left behind
    // (verified by pid + command line). Never kill an arbitrary listener.
    let runtime_dir = ownership::runtime_dir();
    ownership::reap_recorded_kernel(runtime_dir.as_deref(), KERNEL_PORT);
    // Kernels from Nuclei <= 0.14.0 outlive the app and left no owner record;
    // reap such an orphan (same user + Nuclei kernel command line) so an
    // upgrade never leaves an unauthenticated kernel on the port.
    kernel_legacy::reap_legacy_listener(KERNEL_PORT);
    if ownership::port_in_use(KERNEL_PORT) {
        return Err(format!(
            "Port {KERNEL_PORT} is already in use by another application. \
             Quit it (or an older Nuclei kernel) and restart Nuclei."
        ));
    }

    let token = super::qec_data::generate_token().map_err(|e| e.message)?;

    // Resolve the kernel script path. Two cases:
    //
    //   dev  — `CARGO_MANIFEST_DIR` is src-tauri/, so the repo root is
    //          its parent and the kernel lives at <repo>/kernel/server.py.
    //   prod — the kernel/ directory is bundled via the `resources` map in
    //          tauri.conf.json (`"../kernel": "kernel"`), placing it at
    //          resource_dir/kernel/. Prior releases (v0.4.13 and earlier)
    //          did NOT bundle the kernel, which is why the packaged app
    //          quietly relied on whatever stale kernel happened to be
    //          running on the user's machine.
    let (kernel_script, kernel_cwd) = if cfg!(debug_assertions) {
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR")
            .map(std::path::PathBuf::from)
            .ok()
            .ok_or_else(|| "CARGO_MANIFEST_DIR not set in dev build".to_string())?;
        let repo_root = manifest_dir
            .parent()
            .ok_or_else(|| format!("No parent for manifest dir {}", manifest_dir.display()))?
            .to_path_buf();
        (repo_root.join("kernel").join("server.py"), repo_root)
    } else {
        let resource_dir = app_handle
            .path()
            .resource_dir()
            .map_err(|e| e.to_string())?;
        let kernel_dir = resource_dir.join("kernel");
        (kernel_dir.join("server.py"), resource_dir)
    };

    let kernel_script = kernel_script.canonicalize().map_err(|_| {
        format!(
            "Kernel script not found at: {}. cwd: {}",
            kernel_script.display(),
            kernel_cwd.display()
        )
    })?;

    // Defense-in-depth: make sure the resolved script is actually inside
    // the cwd we're about to hand to Python. Guards against a rogue
    // symlink in the source tree redirecting the kernel elsewhere.
    if !kernel_script.starts_with(&kernel_cwd) {
        return Err("Kernel script resolved outside expected directory".to_string());
    }

    // Prefer the Nuclei-managed venv's Python. `ensure_kernel_runtime`
    // creates the venv if missing AND installs the kernel's core
    // import-time deps (websockets / numpy / keyring) when they're not
    // already there — skipping this is what caused v0.4.14's "loading
    // kernel forever" bug: the freshly-bundled kernel launched OK but
    // immediately died on `import websockets` because nobody had ever
    // installed it into the managed venv. The check is a cheap no-op
    // when deps are already present.
    //
    // Falls back to system `python3` if the managed venv can't be
    // bootstrapped (no Python installed at all). Those users get
    // whatever's globally available — not great, but better than no
    // kernel at all.
    let python_path: std::path::PathBuf =
        match crate::commands::frameworks::ensure_kernel_runtime(app_handle) {
            Ok(p) => p,
            Err(e) => {
                log::warn!("Managed venv unavailable ({e}); falling back to system python3");
                std::path::PathBuf::from("python3")
            }
        };

    log::info!(
        "Starting kernel: {} {} (cwd: {})",
        python_path.display(),
        kernel_script.display(),
        kernel_cwd.display()
    );

    let mut command = Command::new(&python_path);
    command
        .arg(kernel_script.to_str().unwrap())
        .current_dir(&kernel_cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_kernel_env(&mut command, cfg!(debug_assertions));
    let mut child = command.spawn().map_err(|e| {
        format!(
            "Failed to start kernel: {} (cwd: {})",
            e,
            kernel_cwd.display()
        )
    })?;

    // Hand the token over stdin and close it; it never enters the environment.
    if let Err(e) = deliver_token(child.stdin.take(), &token) {
        stop_child_gracefully(&mut child, KERNEL_STOP_GRACE);
        return Err(format!(
            "Could not pass the session token to the kernel: {e}"
        ));
    }

    // Drain kernel stdout + stderr into the Rust logger. Prior releases
    // piped both streams but never read them — so when Python crashed
    // with an ImportError (see the v0.4.14 websockets-missing bug) we
    // got a defunct PID and the frontend just retried a dead WebSocket
    // forever, with no trace of the actual error. Reading the streams
    // drains the pipes AND emits the Python output into nuclei.log so
    // the next diagnostic round has something to work with.
    let (signal_tx, signal_rx) = mpsc::channel();
    if let Some(stdout) = child.stdout.take() {
        let log_token = token.clone();
        thread::spawn(move || {
            let mut announced = false;
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                log::info!("[kernel stdout] {}", redact(&line, &log_token));
                if !announced && is_ready_line(&line, KERNEL_PORT) {
                    announced = true;
                    let _ = signal_tx.send(StartupSignal::Ready);
                }
            }
            let _ = signal_tx.send(StartupSignal::Ended);
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let log_token = token.clone();
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                log::warn!("[kernel stderr] {}", redact(&line, &log_token));
            }
        });
    }

    let pid = child.id();
    if let Some(dir) = runtime_dir.as_deref() {
        let record = ownership::OwnerRecord {
            pid,
            port: KERNEL_PORT,
        };
        if let Err(e) = ownership::write_owner_record(dir, &record) {
            log::warn!("Could not record kernel ownership: {e}");
        }
    }

    // Do not hand out the token (or report success) until our own child has
    // bound the port and said so: a process that grabbed 9742 first makes the
    // strict-port kernel exit, which lands here as an error instead of the
    // webview sending credentials to the squatter.
    if let Err(message) = wait_for_ready(&signal_rx, KERNEL_READY_TIMEOUT) {
        stop_child_gracefully(&mut child, KERNEL_STOP_GRACE);
        if let Some(dir) = runtime_dir.as_deref() {
            ownership::remove_owner_record(dir);
        }
        return Err(message);
    }
    *guard = Some(child);
    *state.token.lock().map_err(|e| e.to_string())? = Some(token);
    state.set_supervised(true);

    Ok(StartOutcome::Started {
        pid,
        message: format!(
            "Kernel started with PID {} (cwd: {})",
            pid,
            kernel_cwd.display()
        ),
    })
}

#[tauri::command(async)]
pub fn stop_kernel(state: State<'_, KernelState>) -> Result<String, String> {
    state.stop();
    Ok("Kernel stopped".to_string())
}

/// Per-launch token the frontend presents in its first WebSocket frame.
/// Only the Tauri webview can invoke this; it is never placed in a URL.
///
/// `async` + `spawn_blocking`: a restart holds the process lock for as long as
/// the kernel takes to become ready, and the main thread must never wait on it.
#[tauri::command]
pub async fn kernel_auth_token(app: tauri::AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || read_auth_token(&app.state::<KernelState>()))
        .await
        .map_err(|e| e.to_string())?
}

/// The token exists only once `start_kernel` saw the child print its ready
/// line, and is withheld again if that child has since died (e.g. a strict-port
/// bind failure), so it can never be sent to a listener Nuclei did not start.
pub(crate) fn read_auth_token(state: &KernelState) -> Result<String, String> {
    let alive = match state.process.lock().map_err(|e| e.to_string())?.as_mut() {
        Some(child) => matches!(child.try_wait(), Ok(None)),
        None => false,
    };
    if !alive {
        return Err("Kernel is not running".to_string());
    }
    state
        .token
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "Kernel is not ready yet".to_string())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn stop_sends_sigterm_first_so_the_kernel_can_clean_up() {
        let dir = tempfile::tempdir().unwrap();
        let marker = dir.path().join("got-term");
        let script = format!(
            "trap 'touch \"{}\"; exit 0' TERM; while :; do sleep 0.05; done",
            marker.display()
        );
        let mut child = Command::new("sh").args(["-c", &script]).spawn().unwrap();
        std::thread::sleep(Duration::from_millis(200));
        stop_child_gracefully(&mut child, Duration::from_secs(2));
        assert!(marker.exists(), "child never saw SIGTERM");
        assert!(child.try_wait().unwrap().is_some());
    }

    #[test]
    fn stop_falls_back_to_kill_when_the_child_ignores_sigterm() {
        let mut child = Command::new("sh")
            .args(["-c", "trap '' TERM; while :; do sleep 0.05; done"])
            .spawn()
            .unwrap();
        std::thread::sleep(Duration::from_millis(200));
        stop_child_gracefully(&mut child, Duration::from_millis(300));
        assert!(child.try_wait().unwrap().is_some());
    }

    #[test]
    fn ready_line_must_match_exactly_for_our_port() {
        assert!(is_ready_line(
            "Nuclei kernel ready on ws://localhost:9742",
            9742
        ));
        assert!(is_ready_line(
            "Nuclei kernel ready on ws://localhost:9742\n",
            9742
        ));
        assert!(!is_ready_line(
            "Nuclei kernel ready on ws://localhost:9743",
            9742
        ));
        assert!(!is_ready_line(
            "Nuclei kernel ready on ws://localhost:97420",
            9742
        ));
        assert!(!is_ready_line(
            "WARNING Nuclei kernel ready on ws://localhost:9742",
            9742
        ));
        assert!(!is_ready_line("", 9742));
    }

    #[test]
    fn wait_for_ready_succeeds_only_on_the_ready_signal() {
        let (tx, rx) = mpsc::channel();
        tx.send(StartupSignal::Ready).unwrap();
        assert!(wait_for_ready(&rx, Duration::from_secs(1)).is_ok());
    }

    #[test]
    fn wait_for_ready_errors_when_the_kernel_exits_first() {
        let (tx, rx) = mpsc::channel();
        tx.send(StartupSignal::Ended).unwrap();
        assert!(wait_for_ready(&rx, Duration::from_secs(1)).is_err());
        let (tx, rx) = mpsc::channel::<StartupSignal>();
        drop(tx);
        assert!(wait_for_ready(&rx, Duration::from_secs(1)).is_err());
    }

    #[test]
    fn wait_for_ready_times_out_when_nothing_arrives() {
        let (_tx, rx) = mpsc::channel::<StartupSignal>();
        let err = wait_for_ready(&rx, Duration::from_millis(50)).unwrap_err();
        assert!(err.contains("did not report ready"));
    }

    fn state_with(child: Option<Child>, token: Option<&str>) -> KernelState {
        let state = KernelState::new();
        *state.process.lock().unwrap() = child;
        *state.token.lock().unwrap() = token.map(str::to_string);
        state
    }

    #[test]
    fn token_is_withheld_until_ready_and_while_the_child_is_dead() {
        // Not started / not ready yet: no token.
        assert!(read_auth_token(&state_with(None, None)).is_err());
        let live = Command::new("sleep").arg("30").spawn().unwrap();
        let state = state_with(Some(live), None);
        assert_eq!(
            read_auth_token(&state),
            Err("Kernel is not ready yet".to_string())
        );
        // Ready and alive: token handed out.
        *state.token.lock().unwrap() = Some("tok".to_string());
        assert_eq!(read_auth_token(&state), Ok("tok".to_string()));
        // Child died (e.g. strict-port bind failure): withheld again.
        {
            let mut guard = state.process.lock().unwrap();
            let child = guard.as_mut().unwrap();
            child.kill().unwrap();
            child.wait().unwrap();
        }
        assert!(read_auth_token(&state).is_err());
    }

    fn env_of(command: &Command, key: &str) -> Option<Option<String>> {
        command
            .get_envs()
            .find(|(k, _)| *k == std::ffi::OsStr::new(key))
            .map(|(_, v)| v.map(|v| v.to_string_lossy().into_owned()))
    }

    #[test]
    fn token_is_passed_over_stdin_never_in_the_environment() {
        for debug in [true, false] {
            let mut command = Command::new("true");
            configure_kernel_env(&mut command, debug);
            assert_eq!(env_of(&command, TOKEN_STDIN_ENV), Some(Some("1".into())));
            // Explicitly removed so an inherited token cannot reach procargs.
            assert_eq!(env_of(&command, TOKEN_ENV), Some(None));
            assert_eq!(env_of(&command, STRICT_PORT_ENV), Some(Some("1".into())));
            assert_eq!(env_of(&command, INSECURE_ENV), Some(None));
        }
    }

    #[test]
    fn release_builds_strip_dev_overrides_and_debug_builds_keep_dev_mode() {
        let mut release = Command::new("true");
        configure_kernel_env(&mut release, false);
        assert_eq!(env_of(&release, DEV_ENV), Some(None));
        assert_eq!(env_of(&release, RUNTIME_DIR_ENV), Some(None));

        let mut debug = Command::new("true");
        configure_kernel_env(&mut debug, true);
        assert_eq!(env_of(&debug, DEV_ENV), Some(Some("1".into())));
        assert_eq!(env_of(&debug, RUNTIME_DIR_ENV), None);
    }

    #[test]
    fn release_builds_strip_the_dev_origins_override() {
        // The kernel honours NUCLEI_KERNEL_DEV_ORIGINS only in dev mode, but a stray
        // value in a user's shell must never reach a release kernel at all.
        let mut release = Command::new("true");
        configure_kernel_env(&mut release, false);
        assert_eq!(env_of(&release, DEV_ORIGINS_ENV), Some(None));

        let mut debug = Command::new("true");
        configure_kernel_env(&mut debug, true);
        assert_eq!(env_of(&debug, DEV_ORIGINS_ENV), None);
    }

    #[test]
    fn kernel_runs_with_a_headless_matplotlib_backend() {
        // R-12: a GUI backend inherited from the user's shell would try to open a
        // window from the kernel; figures are captured, never shown.
        for debug in [true, false] {
            let mut command = Command::new("true");
            configure_kernel_env(&mut command, debug);
            assert_eq!(env_of(&command, MPLBACKEND_ENV), Some(Some("Agg".into())));
        }
    }

    #[test]
    fn a_supervisor_restart_is_dropped_when_unwanted_and_an_explicit_start_pauses_supervision() {
        let state = KernelState::new();
        let mut none: Option<Child> = None;

        // Not wanted (never started, or deliberately stopped): leave it alone.
        assert_eq!(
            begin_start(&state, &mut none, StartMode::IfUnhealthy),
            StartDecision::Skip
        );

        // Wanted and the child is gone: restart, and stay supervised.
        state.set_supervised(true);
        assert_eq!(
            begin_start(&state, &mut none, StartMode::IfUnhealthy),
            StartDecision::Proceed
        );
        assert!(state.is_supervised());

        // An exited child is unhealthy whatever the port says. (A live child with no
        // listener is covered by the supervisor tests; port 9742 itself may be held
        // by a real Nuclei on a dev box, so it is not probed here.)
        let mut exited = Some(Command::new("true").spawn().unwrap());
        exited.as_mut().unwrap().wait().unwrap();
        assert_eq!(
            begin_start(&state, &mut exited, StartMode::IfUnhealthy),
            StartDecision::Proceed
        );

        // An explicit start always runs and pauses supervision until it succeeds.
        assert_eq!(
            begin_start(&state, &mut none, StartMode::Always),
            StartDecision::Proceed
        );
        assert!(!state.is_supervised());
    }

    #[test]
    fn token_line_is_newline_terminated() {
        let mut out = Vec::new();
        write_token_line(&mut out, "abc").unwrap();
        assert_eq!(out, b"abc\n");
    }

    #[test]
    fn deliver_token_feeds_a_real_child_over_stdin_and_closes_it() {
        let mut child = Command::new("cat")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        deliver_token(child.stdin.take(), "s3cret-token").unwrap();
        let out = child.wait_with_output().unwrap();
        assert_eq!(String::from_utf8_lossy(&out.stdout), "s3cret-token\n");
    }

    #[test]
    fn deliver_token_fails_without_a_stdin_handle() {
        assert!(deliver_token(None, "t").is_err());
    }

    #[test]
    fn kernel_logs_never_contain_the_token() {
        assert_eq!(redact("auth=tok123 ok", "tok123"), "auth=[REDACTED] ok");
    }
}
