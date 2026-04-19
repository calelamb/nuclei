//! Framework installer commands.
//!
//! Nuclei maintains an application-local Python virtual environment in
//! `<appDataDir>/venv`. On first launch the UI offers the student a
//! checklist of quantum frameworks (Qiskit, Cirq, CUDA-Q) and any
//! hardware providers they plan to use. These commands handle the
//! detection + install side of that flow. The kernel (see kernel.rs)
//! prefers this venv over system Python when it exists.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

/// Static catalog of installable frameworks. Kept Rust-side as the
/// single source of truth; the frontend calls `framework_catalog()` to
/// render the checklist. Split into core (quantum frameworks) and
/// provider (hardware SDKs) so the UI can section them.
#[derive(Debug, Clone, Serialize)]
pub struct FrameworkInfo {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub pip_name: &'static str,
    pub import_name: &'static str,
    pub group: &'static str,
    pub approximate_size_mb: u32,
    pub recommended: bool,
}

const CATALOG: &[FrameworkInfo] = &[
    FrameworkInfo {
        id: "qiskit",
        label: "Qiskit",
        description: "IBM's quantum computing SDK — most widely used in coursework.",
        pip_name: "qiskit qiskit-aer",
        import_name: "qiskit",
        group: "core",
        approximate_size_mb: 220,
        recommended: true,
    },
    FrameworkInfo {
        id: "cirq",
        label: "Cirq",
        description: "Google's quantum framework — clean circuit model, great for learning.",
        pip_name: "cirq",
        import_name: "cirq",
        group: "core",
        approximate_size_mb: 60,
        recommended: true,
    },
    FrameworkInfo {
        id: "cuda-q",
        label: "CUDA-Q",
        description:
            "NVIDIA's quantum framework. CPU simulator works everywhere; GPU acceleration on Linux + CUDA.",
        pip_name: "cuda-quantum",
        import_name: "cudaq",
        group: "core",
        approximate_size_mb: 500,
        recommended: false,
    },
    FrameworkInfo {
        id: "ibm-runtime",
        label: "IBM Quantum Runtime",
        description: "Run circuits on real IBM quantum hardware.",
        pip_name: "qiskit-ibm-runtime",
        import_name: "qiskit_ibm_runtime",
        group: "provider",
        approximate_size_mb: 20,
        recommended: false,
    },
    FrameworkInfo {
        id: "ionq",
        label: "IonQ",
        description: "Run circuits on IonQ trapped-ion hardware via Qiskit.",
        pip_name: "qiskit-ionq",
        import_name: "qiskit_ionq",
        group: "provider",
        approximate_size_mb: 15,
        recommended: false,
    },
    FrameworkInfo {
        id: "braket",
        label: "AWS Braket",
        description: "Amazon's hosted quantum hardware access.",
        pip_name: "amazon-braket-sdk",
        import_name: "braket",
        group: "provider",
        approximate_size_mb: 45,
        recommended: false,
    },
    FrameworkInfo {
        id: "azure",
        label: "Azure Quantum",
        description: "Microsoft's hosted quantum hardware access.",
        pip_name: "azure-quantum",
        import_name: "azure.quantum",
        group: "provider",
        approximate_size_mb: 30,
        recommended: false,
    },
    FrameworkInfo {
        id: "quantinuum",
        label: "Quantinuum (pytket)",
        description: "Quantinuum trapped-ion hardware via pytket.",
        pip_name: "pytket-quantinuum",
        import_name: "pytket.extensions.quantinuum",
        group: "provider",
        approximate_size_mb: 35,
        recommended: false,
    },
];

#[derive(Debug, Serialize)]
pub struct FrameworkStatus {
    pub venv_path: Option<String>,
    pub venv_exists: bool,
    pub python_version: Option<String>,
    pub system_python_path: Option<String>,
    pub installed: Vec<String>,
    pub catalog: Vec<FrameworkInfo>,
}

#[derive(Debug, Serialize, Clone)]
pub struct InstallEvent {
    pub stage: String,
    pub framework: Option<String>,
    pub line: Option<String>,
}

fn venv_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?;
    Ok(dir.join("venv"))
}

fn venv_python(venv: &Path) -> PathBuf {
    if cfg!(target_os = "windows") {
        venv.join("Scripts").join("python.exe")
    } else {
        venv.join("bin").join("python3")
    }
}

fn venv_pip(venv: &Path) -> PathBuf {
    if cfg!(target_os = "windows") {
        venv.join("Scripts").join("pip.exe")
    } else {
        venv.join("bin").join("pip")
    }
}

/// Finds the first usable system Python (>= 3.9). Returns its absolute
/// path if found. We check `python3` first since that's the canonical
/// name on macOS/Linux; Windows uses `python`.
fn find_system_python() -> Option<(String, String)> {
    let candidates = if cfg!(target_os = "windows") {
        vec!["python", "python3"]
    } else {
        vec!["python3", "python"]
    };
    for name in candidates {
        if let Ok(out) = Command::new(name).arg("--version").output() {
            if out.status.success() {
                let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
                let version = if version.is_empty() {
                    String::from_utf8_lossy(&out.stderr).trim().to_string()
                } else {
                    version
                };
                // `which` equivalent — cross-platform: ask python for its own path.
                if let Ok(which) = Command::new(name)
                    .args(["-c", "import sys; print(sys.executable)"])
                    .output()
                {
                    if which.status.success() {
                        let path = String::from_utf8_lossy(&which.stdout).trim().to_string();
                        return Some((path, version));
                    }
                }
            }
        }
    }
    None
}

/// Check which frameworks are already importable inside the venv.
/// Runs one subprocess per framework — cheap, and it's only invoked on
/// status refresh, not every render.
fn installed_frameworks(venv_py: &Path) -> Vec<String> {
    let mut out = Vec::new();
    if !venv_py.exists() {
        return out;
    }
    for fw in CATALOG {
        let status = Command::new(venv_py)
            .args(["-c", &format!("import {}", fw.import_name)])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
        if let Ok(s) = status {
            if s.success() {
                out.push(fw.id.to_string());
            }
        }
    }
    out
}

/// The venv's python, or `None` if the venv doesn't yet exist. Called
/// by the kernel spawn path so the kernel loads whatever the user
/// installed via the framework wizard.
pub fn resolve_kernel_python(app: &AppHandle) -> Option<PathBuf> {
    let venv = venv_path(app).ok()?;
    let py = venv_python(&venv);
    if py.exists() {
        Some(py)
    } else {
        None
    }
}

#[tauri::command]
pub fn framework_status(app: AppHandle) -> Result<FrameworkStatus, String> {
    let venv = venv_path(&app)?;
    let venv_py = venv_python(&venv);
    let exists = venv_py.exists();
    let (sys_path, sys_version) = match find_system_python() {
        Some((p, v)) => (Some(p), Some(v)),
        None => (None, None),
    };
    Ok(FrameworkStatus {
        venv_path: Some(venv.to_string_lossy().to_string()),
        venv_exists: exists,
        python_version: sys_version,
        system_python_path: sys_path,
        installed: if exists {
            installed_frameworks(&venv_py)
        } else {
            Vec::new()
        },
        catalog: CATALOG.to_vec(),
    })
}

fn emit(app: &AppHandle, stage: &str, framework: Option<&str>, line: Option<&str>) {
    let _ = app.emit(
        "framework-install",
        InstallEvent {
            stage: stage.to_string(),
            framework: framework.map(|s| s.to_string()),
            line: line.map(|s| s.to_string()),
        },
    );
}

fn ensure_venv(app: &AppHandle, venv: &Path) -> Result<(), String> {
    if venv_python(venv).exists() {
        return Ok(());
    }
    let (sys_py, _) = find_system_python()
        .ok_or_else(|| "No Python 3 found on PATH. Install Python 3.10+ from python.org.".to_string())?;

    // Ensure parent dir exists.
    if let Some(parent) = venv.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create app data dir: {e}"))?;
    }

    emit(app, "creating-venv", None, Some(&sys_py));

    let out = Command::new(&sys_py)
        .args(["-m", "venv", venv.to_string_lossy().as_ref()])
        .output()
        .map_err(|e| format!("venv creation failed to start: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "venv creation failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }

    // Upgrade pip inside the new venv so framework wheels resolve cleanly.
    let pip = venv_pip(venv);
    let _ = Command::new(&pip)
        .args(["install", "--upgrade", "pip", "wheel"])
        .output();
    Ok(())
}

/// Install a set of frameworks. Runs synchronously to completion; the
/// frontend shows a spinner while we're in here. Emits `framework-install`
/// events for progress. Failures on one framework don't abort the rest —
/// the caller gets a summary so partial installs are recoverable.
#[tauri::command]
pub fn framework_install(
    app: AppHandle,
    frameworks: Vec<String>,
) -> Result<Vec<String>, String> {
    let venv = venv_path(&app)?;
    ensure_venv(&app, &venv)?;
    let pip = venv_pip(&venv);

    let mut failed: Vec<String> = Vec::new();

    for id in &frameworks {
        let fw = match CATALOG.iter().find(|f| f.id == id) {
            Some(f) => f,
            None => {
                failed.push(format!("{id}: unknown framework"));
                continue;
            }
        };

        emit(&app, "installing", Some(fw.id), Some(fw.pip_name));

        let mut args: Vec<&str> = vec!["install", "--upgrade"];
        args.extend(fw.pip_name.split_whitespace());
        let out = Command::new(&pip)
            .args(&args)
            .output()
            .map_err(|e| format!("pip failed to start for {id}: {e}"))?;

        if out.status.success() {
            emit(&app, "installed", Some(fw.id), None);
        } else {
            let tail: String = String::from_utf8_lossy(&out.stderr)
                .lines()
                .rev()
                .take(8)
                .collect::<Vec<&str>>()
                .into_iter()
                .rev()
                .collect::<Vec<&str>>()
                .join("\n");
            emit(&app, "failed", Some(fw.id), Some(&tail));
            failed.push(format!("{id}: {tail}"));
        }
    }

    emit(&app, "done", None, None);
    Ok(failed)
}
