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

/// Minimum Python version supported by the kernel. The kernel code uses
/// PEP 604 union syntax (`str | None`) in class bodies, which requires
/// Python 3.10+. Lower versions crash at module import with
/// `TypeError: unsupported operand type(s) for |: 'type' and 'NoneType'`.
const MIN_PYTHON_MINOR: u32 = 10;

/// Probe a Python interpreter for its minor version. Returns None on any
/// failure (interpreter missing, timeout, unparseable output). Runs with
/// output piped to /dev/null so we don't pollute logs during discovery.
fn python_minor_version(py: &str) -> Option<u32> {
    let out = Command::new(py)
        .args(["-c", "import sys; print(sys.version_info.minor)"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8_lossy(&out.stdout).trim().parse().ok()
}

fn python_executable_path(py: &str) -> Option<String> {
    let out = Command::new(py)
        .args(["-c", "import sys; print(sys.executable)"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if path.is_empty() { None } else { Some(path) }
}

/// Find the newest usable system Python (>= MIN_PYTHON_MINOR). We probe
/// candidates in descending version order so a box with both 3.9 and
/// 3.12 installed picks 3.12 — critical, because 3.9 was Xcode's default
/// for years and silently wrecked v0.4.14/v0.4.15 venvs built from it.
/// Returns `(absolute path, version string)`.
fn find_best_python() -> Option<(String, String)> {
    // Ordered newest-first. `python3` and `python` come last so that a
    // specific-version binary always wins over a generic symlink.
    let candidates: Vec<&str> = if cfg!(target_os = "windows") {
        vec![
            "python3.13", "python3.12", "python3.11", "python3.10",
            "python3", "python",
        ]
    } else {
        vec![
            "python3.13", "python3.12", "python3.11", "python3.10",
            "python3", "python",
        ]
    };
    for name in candidates {
        let Some(minor) = python_minor_version(name) else { continue };
        if minor < MIN_PYTHON_MINOR {
            continue;
        }
        let Some(path) = python_executable_path(name) else { continue };
        return Some((path, format!("Python 3.{minor}")));
    }
    None
}

/// Back-compat for `framework_status` which reports whatever Python the
/// system exposes — used only for UI display, so it includes too-old
/// versions (we surface them so the UI can tell the user what's wrong).
fn find_system_python() -> Option<(String, String)> {
    // First preference: a 3.10+ interpreter (what the kernel actually
    // needs). If none, fall back to reporting whatever `python3`
    // responds with so the framework wizard can show a clear error.
    if let Some(found) = find_best_python() {
        return Some(found);
    }
    let candidates = if cfg!(target_os = "windows") {
        vec!["python", "python3"]
    } else {
        vec!["python3", "python"]
    };
    for name in candidates {
        if let Ok(out) = Command::new(name).arg("--version").output() {
            if out.status.success() {
                let mut version = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if version.is_empty() {
                    version = String::from_utf8_lossy(&out.stderr).trim().to_string();
                }
                if let Some(path) = python_executable_path(name) {
                    return Some((path, version));
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

/// Kernel-side runtime dependencies. Separate from the framework catalog
/// because these aren't optional — without them the kernel process
/// crashes on module import the moment it's spawned, leaving the user
/// staring at a "loading kernel..." spinner forever (see v0.4.14 field
/// report). `ensure_venv` only bootstraps pip; these are the deps the
/// kernel itself imports at module load.
const KERNEL_CORE_DEPS: &[&str] = &[
    "websockets>=12.0,<14.0",
    "numpy>=1.26,<3.0",
    "keyring>=24",
];

/// Fast-check whether the venv already has the kernel's core runtime
/// deps. A `-c import ...` takes ~50ms when Python can find everything,
/// which is cheap to run on every kernel launch. Returns false on any
/// ImportError so the caller knows to pip-install.
fn kernel_core_deps_present(python: &Path) -> bool {
    Command::new(python)
        .args(["-c", "import websockets, numpy, keyring"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Install the kernel's core runtime deps into the given venv. Idempotent
/// when the deps are already present (pip no-ops on satisfied
/// requirements). Caller should gate this behind `kernel_core_deps_present`
/// to skip pip entirely on the common hot path.
pub fn install_kernel_core_deps(app: &AppHandle, venv: &Path) -> Result<(), String> {
    let pip = venv_pip(venv);
    if !pip.exists() {
        return Err(format!(
            "pip not found in venv at {} — venv may be corrupt",
            venv.display()
        ));
    }
    emit(app, "installing-core-deps", None, Some("websockets, numpy, keyring"));
    let mut args: Vec<&str> = vec!["install", "--upgrade"];
    args.extend(KERNEL_CORE_DEPS.iter().copied());
    let out = Command::new(&pip)
        .args(&args)
        .output()
        .map_err(|e| format!("pip core-deps install failed to start: {e}"))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(format!("pip core-deps install failed: {stderr}"));
    }
    emit(app, "installed-core-deps", None, None);
    Ok(())
}

/// Guarantee the venv has everything the kernel needs to boot. Creates
/// the venv if missing, rebuilds it (preserving installed frameworks)
/// if the existing one was built from Python < 3.10, then installs
/// core deps if they're not already there. Called by the kernel spawn
/// path every launch — cheap no-op when everything is already healthy.
pub fn ensure_kernel_runtime(app: &AppHandle) -> Result<PathBuf, String> {
    let venv = venv_path(app)?;
    let py = venv_python(&venv);

    // Existing venv: check its Python is new enough. Rebuild if not.
    if py.exists() {
        let minor = python_minor_version(&py.to_string_lossy());
        if minor.map(|m| m < MIN_PYTHON_MINOR).unwrap_or(true) {
            log::warn!(
                "Managed venv uses unsupported Python (minor={minor:?} < {}). Rebuilding.",
                MIN_PYTHON_MINOR
            );
            rebuild_venv_with_supported_python(app, &venv)?;
        }
    } else {
        ensure_venv(app, &venv)?;
    }

    let py = venv_python(&venv);
    if !kernel_core_deps_present(&py) {
        install_kernel_core_deps(app, &venv)?;
    }
    Ok(py)
}

/// Rebuild a broken venv from a newer Python, preserving whichever
/// frameworks the user had installed so they don't have to re-run the
/// setup wizard. Strategy:
///
///   1. Snapshot the catalog IDs already importable in the old venv.
///   2. Rename the old venv to `.broken` as a safety net — we can roll
///      back if the new build fails mid-way.
///   3. Create fresh venv from the newest system Python (>= 3.10).
///   4. Install kernel core deps + re-install the snapshotted frameworks.
///   5. On success, delete the `.broken` backup. On failure, keep it so
///      a future invocation can investigate.
fn rebuild_venv_with_supported_python(app: &AppHandle, venv: &Path) -> Result<(), String> {
    let old_py = venv_python(venv);
    let previously_installed: Vec<String> = if old_py.exists() {
        installed_frameworks(&old_py)
    } else {
        Vec::new()
    };

    let (new_py, new_version) = find_best_python().ok_or_else(|| {
        format!(
            "Managed Python environment uses an unsupported version, and no Python {}+ \
             was found on PATH. Install Python 3.10+ from python.org and relaunch Nuclei.",
            MIN_PYTHON_MINOR
        )
    })?;

    emit(app, "rebuilding-venv", None, Some(&new_version));
    log::info!("Rebuilding venv with {new_version} at {new_py}");

    // Back up the old venv to `.broken` so an aborted rebuild doesn't
    // leave the user without a venv at all. `remove_dir_all` on the
    // target first handles a previous failed rebuild attempt.
    let backup = venv.with_extension("broken");
    let _ = std::fs::remove_dir_all(&backup);
    if venv.exists() {
        std::fs::rename(venv, &backup)
            .map_err(|e| format!("failed to back up old venv: {e}"))?;
    }

    let out = Command::new(&new_py)
        .args(["-m", "venv", venv.to_string_lossy().as_ref()])
        .output()
        .map_err(|e| format!("venv rebuild failed to start: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "venv rebuild failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }

    let pip = venv_pip(venv);
    let _ = Command::new(&pip)
        .args(["install", "--upgrade", "pip", "wheel"])
        .output();

    install_kernel_core_deps(app, venv)?;

    // Re-install whatever was in the old venv. Best-effort — a failing
    // framework install here doesn't fail the whole rebuild, we just
    // log it. The user can re-run the wizard to retry individuals.
    for id in &previously_installed {
        let Some(fw) = CATALOG.iter().find(|f| f.id == id.as_str()) else { continue };
        emit(app, "restoring-framework", Some(fw.id), Some(fw.pip_name));
        let mut args: Vec<&str> = vec!["install", "--upgrade"];
        args.extend(fw.pip_name.split_whitespace());
        let res = Command::new(&pip).args(&args).output();
        match res {
            Ok(o) if o.status.success() => {
                emit(app, "restored-framework", Some(fw.id), None);
            }
            Ok(o) => {
                log::warn!(
                    "Could not restore {}: {}",
                    fw.id,
                    String::from_utf8_lossy(&o.stderr)
                );
            }
            Err(e) => log::warn!("pip failed for {}: {e}", fw.id),
        }
    }

    // Clean up the backup now that the new venv is healthy.
    let _ = std::fs::remove_dir_all(&backup);
    emit(app, "rebuilt-venv", None, Some(&new_version));
    Ok(())
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
    // Require Python 3.10+ for fresh venv creation — kernel code uses
    // PEP 604 union syntax at module-import time. `find_best_python`
    // returns the newest available 3.10+; `find_system_python` would
    // accept an older Python and leave the user with a venv that
    // silently breaks at kernel spawn (see v0.4.14 / v0.4.15 regress).
    let (sys_py, _) = find_best_python().ok_or_else(|| {
        format!(
            "No Python {}+ found on PATH. Install Python 3.10 or newer from python.org, \
             then relaunch Nuclei.",
            MIN_PYTHON_MINOR
        )
    })?;

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
