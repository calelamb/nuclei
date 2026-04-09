use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::{Manager, State};

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

#[tauri::command]
pub fn start_kernel(
    state: State<'_, KernelState>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let mut guard = state.process.lock().map_err(|e| e.to_string())?;

    // Kill existing process if any
    if let Some(ref mut child) = *guard {
        let _ = child.kill();
        let _ = child.wait();
    }

    // In dev mode, resolve the project root from the current exe location
    // Tauri 2 resource_dir in dev points to src-tauri/, parent is project root
    let project_root = if cfg!(debug_assertions) {
        // In dev, use env CARGO_MANIFEST_DIR or fall back to resource_dir
        let manifest = std::env::var("CARGO_MANIFEST_DIR")
            .map(std::path::PathBuf::from)
            .ok();
        if let Some(ref dir) = manifest {
            dir.parent().unwrap_or(dir).to_path_buf()
        } else {
            let resource_dir = app_handle
                .path()
                .resource_dir()
                .map_err(|e| e.to_string())?;
            resource_dir.parent().unwrap_or(&resource_dir).to_path_buf()
        }
    } else {
        let resource_dir = app_handle
            .path()
            .resource_dir()
            .map_err(|e| e.to_string())?;
        resource_dir.parent().unwrap_or(&resource_dir).to_path_buf()
    };

    let kernel_script = project_root.join("kernel").join("server.py");
    let kernel_script = kernel_script.canonicalize().map_err(|_| {
        format!(
            "Kernel script not found at: {}. Project root: {}",
            kernel_script.display(),
            project_root.display()
        )
    })?;

    // Verify the kernel script is within the expected project directory
    if !kernel_script.starts_with(&project_root) {
        return Err("Kernel script path resolved outside project directory".to_string());
    }

    log::info!("Starting kernel: python3 {} (cwd: {})", kernel_script.display(), project_root.display());

    let child = Command::new("python3")
        .arg(kernel_script.to_str().unwrap())
        .current_dir(&project_root)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start kernel: {} (cwd: {})", e, project_root.display()))?;

    let pid = child.id();
    *guard = Some(child);

    Ok(format!("Kernel started with PID {} (cwd: {})", pid, project_root.display()))
}

#[tauri::command]
pub fn stop_kernel(state: State<'_, KernelState>) -> Result<String, String> {
    state.stop();
    Ok("Kernel stopped".to_string())
}
