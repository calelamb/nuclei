use std::io::{BufRead, BufReader};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::thread;
use tauri::{Manager, State};

use super::kernel_ownership as ownership;

// Canonical kernel port. The frontend connects here by hardcoded URL
// (see src/config/kernel.ts), so our freshly-spawned kernel must own it.
// A leftover kernel that Nuclei itself recorded is reaped; anything else
// holding the port is left alone and reported as an error, so the
// per-launch auth token is never handed to a process we did not start.
const KERNEL_PORT: u16 = 9742;

const TOKEN_ENV: &str = "NUCLEI_KERNEL_TOKEN";
const STRICT_PORT_ENV: &str = "NUCLEI_KERNEL_STRICT_PORT";
const DEV_ENV: &str = "NUCLEI_KERNEL_DEV";
const INSECURE_ENV: &str = "NUCLEI_KERNEL_INSECURE_DEV";

pub struct KernelState {
    process: Mutex<Option<Child>>,
    token: Mutex<Option<String>>,
}

impl KernelState {
    pub fn new() -> Self {
        Self {
            process: Mutex::new(None),
            token: Mutex::new(None),
        }
    }

    pub fn stop(&self) {
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

#[tauri::command(async)]
pub fn start_kernel(
    state: State<'_, KernelState>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let mut guard = state.process.lock().map_err(|e| e.to_string())?;

    // Kill existing in-process handle if any — relevant during reconnect
    // flows where the user triggered a kernel restart from the UI.
    if let Some(ref mut child) = *guard {
        stop_child_gracefully(child, KERNEL_STOP_GRACE);
    }

    // Reap a kernel that a previous Nuclei run recorded and left behind
    // (verified by pid + command line). Never kill an arbitrary listener.
    let runtime_dir = ownership::runtime_dir();
    ownership::reap_recorded_kernel(runtime_dir.as_deref(), KERNEL_PORT);
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
        match crate::commands::frameworks::ensure_kernel_runtime(&app_handle) {
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

    let mut child = Command::new(&python_path)
        .arg(kernel_script.to_str().unwrap())
        .current_dir(&kernel_cwd)
        .env(TOKEN_ENV, &token)
        .env(STRICT_PORT_ENV, "1")
        .env_remove(INSECURE_ENV)
        .envs(cfg!(debug_assertions).then_some((DEV_ENV, "1")))
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| {
            format!(
                "Failed to start kernel: {} (cwd: {})",
                e,
                kernel_cwd.display()
            )
        })?;

    // Drain kernel stdout + stderr into the Rust logger. Prior releases
    // piped both streams but never read them — so when Python crashed
    // with an ImportError (see the v0.4.14 websockets-missing bug) we
    // got a defunct PID and the frontend just retried a dead WebSocket
    // forever, with no trace of the actual error. Reading the streams
    // drains the pipes AND emits the Python output into nuclei.log so
    // the next diagnostic round has something to work with.
    if let Some(stdout) = child.stdout.take() {
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                log::info!("[kernel stdout] {}", line);
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                log::warn!("[kernel stderr] {}", line);
            }
        });
    }

    let pid = child.id();
    if let Some(dir) = runtime_dir.as_deref() {
        let record = ownership::OwnerRecord { pid, port: KERNEL_PORT };
        if let Err(e) = ownership::write_owner_record(dir, &record) {
            log::warn!("Could not record kernel ownership: {e}");
        }
    }
    *guard = Some(child);
    *state.token.lock().map_err(|e| e.to_string())? = Some(token);

    Ok(format!(
        "Kernel started with PID {} (cwd: {})",
        pid,
        kernel_cwd.display()
    ))
}

#[tauri::command(async)]
pub fn stop_kernel(state: State<'_, KernelState>) -> Result<String, String> {
    state.stop();
    Ok("Kernel stopped".to_string())
}

/// Per-launch token the frontend presents in its first WebSocket frame.
/// Only the Tauri webview can invoke this; it is never placed in a URL.
#[tauri::command]
pub fn kernel_auth_token(state: State<'_, KernelState>) -> Result<String, String> {
    // Only hand the token out while the kernel we spawned is alive. If it
    // exited (e.g. strict-port bind failure because a foreign process holds
    // the port) the token is withheld, so it can never be sent to a listener
    // Nuclei did not start.
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
        .ok_or_else(|| "Kernel has not been started".to_string())
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
}
