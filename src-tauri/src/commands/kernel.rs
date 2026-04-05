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

    // Determine the kernel directory — in dev mode, it's the project root
    let resource_dir = app_handle
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?;

    // In dev mode, the resource dir is src-tauri, so go up one level
    let project_root = resource_dir.parent().unwrap_or(&resource_dir);

    let child = Command::new("python3")
        .arg("kernel/server.py")
        .current_dir(project_root)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start kernel: {}", e))?;

    let pid = child.id();
    *guard = Some(child);

    Ok(format!("Kernel started with PID {}", pid))
}

#[tauri::command]
pub fn stop_kernel(state: State<'_, KernelState>) -> Result<String, String> {
    state.stop();
    Ok("Kernel stopped".to_string())
}
