use std::io::{BufRead, BufReader};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::thread;
use tauri::{Manager, State};

// Canonical kernel port. The frontend connects here by hardcoded URL
// (see src/config/kernel.ts), so we must make sure our freshly-spawned
// kernel actually owns it. If a zombie from a prior release is squatting
// on the port, the new kernel would silently fall back to 9743+ — and
// the frontend would unknowingly talk to the zombie, which would reply
// with "Unknown message type" errors for any handlers added after that
// stale kernel was built.
const KERNEL_PORT: u16 = 9742;

pub struct KernelState {
    process: Mutex<Option<Child>>,
}

impl KernelState {
    pub fn new() -> Self {
        Self {
            process: Mutex::new(None),
        }
    }

    pub fn stop(&self) {
        if let Ok(mut guard) = self.process.lock() {
            if let Some(ref mut child) = *guard {
                let _ = child.kill();
                let _ = child.wait();
            }
            *guard = None;
        }
    }
}

impl Drop for KernelState {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Kill whatever process is currently listening on the kernel's port.
/// Best-effort: if the port is already free, or the OS tooling isn't
/// available, this is a no-op. Run this before spawning the new kernel
/// so stale zombies from prior releases can't hijack the frontend's
/// hardcoded WebSocket URL.
fn kill_port_squatters(port: u16) {
    #[cfg(not(target_os = "windows"))]
    {
        // `lsof -ti :PORT` prints only PIDs (one per line) for any
        // process listening on the given TCP port. `kill -9` is
        // heavy-handed but appropriate here — a previous-version kernel
        // process has no signal handler we care about preserving, and
        // we need the port back immediately.
        let cmd = format!(
            "lsof -ti :{} 2>/dev/null | xargs kill -9 2>/dev/null || true",
            port
        );
        let _ = Command::new("sh").arg("-c").arg(&cmd).status();
    }
    #[cfg(target_os = "windows")]
    {
        // netstat -ano: PID is in the last column. The inner for-loop
        // shells out taskkill /F /PID <pid> for each match. `findstr
        // LISTENING` filters TIME_WAIT etc. so we only kill the actual
        // holder of the port.
        let cmd = format!(
            "for /f \"tokens=5\" %a in ('netstat -ano ^| findstr :{} ^| findstr LISTENING') do taskkill /F /PID %a",
            port
        );
        let _ = Command::new("cmd").args(["/C", &cmd]).status();
    }
}

#[tauri::command]
pub fn start_kernel(
    state: State<'_, KernelState>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let mut guard = state.process.lock().map_err(|e| e.to_string())?;

    // Kill existing in-process handle if any — relevant during reconnect
    // flows where the user triggered a kernel restart from the UI.
    if let Some(ref mut child) = *guard {
        let _ = child.kill();
        let _ = child.wait();
    }

    // Also kill any OUT-of-process zombie that's still holding the port.
    // This is the big one: without it, a pre-v0.4.14 kernel left running
    // from a prior install will sit on port 9742 forever and the new
    // frontend will talk to it. The new kernel, binding to 9743, never
    // sees any requests.
    kill_port_squatters(KERNEL_PORT);

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
                log::warn!(
                    "Managed venv unavailable ({e}); falling back to system python3"
                );
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
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start kernel: {} (cwd: {})", e, kernel_cwd.display()))?;

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
    *guard = Some(child);

    Ok(format!("Kernel started with PID {} (cwd: {})", pid, kernel_cwd.display()))
}

#[tauri::command]
pub fn stop_kernel(state: State<'_, KernelState>) -> Result<String, String> {
    state.stop();
    Ok("Kernel stopped".to_string())
}
