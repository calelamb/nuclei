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
        id: "qsharp",
        label: "Microsoft QDK (Q#)",
        description: "Microsoft's quantum language. Compiles to QIR for Azure Quantum hardware.",
        pip_name: "qdk",
        import_name: "qdk",
        group: "core",
        approximate_size_mb: 25,
        recommended: true,
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
        // Pinned <0.26: newer pytket-quantinuum dropped the direct
        // API-token auth the kernel provider uses (see
        // kernel/hardware/quantinuum_provider.py). The pin is a single
        // whitespace-free token, so the split_whitespace install path
        // passes it to pip as one requirement-spec argument (no shell).
        pip_name: "pytket-quantinuum<0.26",
        import_name: "pytket.extensions.quantinuum",
        group: "provider",
        approximate_size_mb: 35,
        recommended: false,
    },
    // QEC Studio research toolchain (PRD 10). All optional: the kernel
    // degrades to missing_dependency prompts without them. Pins mirror
    // kernel-tests.yml; each pip_name is a single whitespace-free
    // requirement spec (same rule as the pytket pin above).
    FrameworkInfo {
        id: "stim",
        label: "Stim",
        description: "Stabilizer circuit simulator — the core of QEC Studio's circuits, sampling, and detector error models.",
        pip_name: "stim>=1.14,<2",
        import_name: "stim",
        group: "research",
        approximate_size_mb: 6,
        recommended: false,
    },
    FrameworkInfo {
        id: "sinter",
        label: "Sinter",
        description: "Multiprocess Monte Carlo campaign runner for QEC (pulls scipy + matplotlib).",
        pip_name: "sinter>=1.14,<2",
        import_name: "sinter",
        group: "research",
        approximate_size_mb: 90,
        recommended: false,
    },
    FrameworkInfo {
        id: "pymatching",
        label: "PyMatching",
        description: "Minimum-weight perfect matching decoder (sparse blossom).",
        pip_name: "pymatching>=2.1,<3",
        import_name: "pymatching",
        group: "research",
        approximate_size_mb: 3,
        recommended: false,
    },
    FrameworkInfo {
        id: "fusion-blossom",
        label: "Fusion Blossom",
        description: "Alternative MWPM decoder for decoder comparisons.",
        pip_name: "fusion-blossom>=0.2.10,<0.3",
        import_name: "fusion_blossom",
        group: "research",
        approximate_size_mb: 2,
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
    if path.is_empty() {
        None
    } else {
        Some(path)
    }
}

/// Find the newest usable system Python (>= MIN_PYTHON_MINOR). We probe
/// candidates in descending version order so a box with both 3.9 and
/// 3.12 installed picks 3.12 — critical, because 3.9 was Xcode's default
/// for years and silently wrecked v0.4.14/v0.4.15 venvs built from it.
/// Returns `(absolute path, version string)`.
fn find_best_python() -> Option<(String, String)> {
    // Ordered newest-first. `python3` and `python` come last so that a
    // specific-version binary always wins over a generic symlink.
    // The windows/unix arms are intentionally kept separate so the candidate
    // list can diverge per-platform later; today they happen to match.
    #[allow(clippy::if_same_then_else)]
    let candidates: Vec<&str> = if cfg!(target_os = "windows") {
        vec![
            "python3.13",
            "python3.12",
            "python3.11",
            "python3.10",
            "python3",
            "python",
        ]
    } else {
        vec![
            "python3.13",
            "python3.12",
            "python3.11",
            "python3.10",
            "python3",
            "python",
        ]
    };
    for name in candidates {
        let Some(minor) = python_minor_version(name) else {
            continue;
        };
        if minor < MIN_PYTHON_MINOR {
            continue;
        }
        let Some(path) = python_executable_path(name) else {
            continue;
        };
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
const KERNEL_CORE_DEPS: &[&str] = &["websockets>=12.0,<14.0", "numpy>=1.26,<3.0", "keyring>=24"];

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
    emit(
        app,
        "installing-core-deps",
        None,
        Some("websockets, numpy, keyring"),
    );
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
        std::fs::rename(venv, &backup).map_err(|e| format!("failed to back up old venv: {e}"))?;
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
        let Some(fw) = CATALOG.iter().find(|f| f.id == id.as_str()) else {
            continue;
        };
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
pub fn framework_install(app: AppHandle, frameworks: Vec<String>) -> Result<Vec<String>, String> {
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
            let tail = tail_lines(&String::from_utf8_lossy(&out.stderr), 8);
            emit(&app, "failed", Some(fw.id), Some(&tail));
            failed.push(format!("{id}: {tail}"));
        }
    }

    emit(&app, "done", None, None);
    Ok(failed)
}

/// Last `n` lines of a (possibly multi-line) string, order preserved. Used to
/// surface the meaningful tail of a pip/venv failure without the full log.
fn tail_lines(s: &str, n: usize) -> String {
    let lines: Vec<&str> = s.lines().collect();
    let start = lines.len().saturating_sub(n);
    lines[start..].join("\n")
}

// ───────────────────────── Missing-dependency resolution ─────────────────────────

/// Resolve a name from a kernel `missing_dependency` error — an import name
/// (`qiskit`), a submodule (`qiskit.qasm3`), a pip/import id (`qdk`), or a
/// catalog id — to its installable catalog entry, so the UI can offer a
/// one-click install for exactly what's missing instead of a dead end.
fn resolve_framework(name: &str) -> Option<&'static FrameworkInfo> {
    let needle = name.trim().to_ascii_lowercase();
    if needle.is_empty() {
        return None;
    }
    // Pass 1 — exact id / import name / label wins over a loose module match.
    if let Some(fw) = CATALOG.iter().find(|f| {
        f.id.eq_ignore_ascii_case(&needle)
            || f.import_name.eq_ignore_ascii_case(&needle)
            || f.label.eq_ignore_ascii_case(&needle)
    }) {
        return Some(fw);
    }
    // Pass 2 — top-level module of a dotted name: `qiskit.qasm3` -> `qiskit`.
    let top = needle.split(['.', '/']).next().unwrap_or(&needle);
    CATALOG.iter().find(|f| {
        f.import_name
            .split('.')
            .next()
            .map(|module| module.eq_ignore_ascii_case(top))
            .unwrap_or(false)
    })
}

/// Map a missing-dependency name to its catalog entry (or `None` if it isn't
/// something Nuclei knows how to install).
#[tauri::command]
pub fn framework_resolve(name: String) -> Option<FrameworkInfo> {
    resolve_framework(&name).cloned()
}

// ───────────────────────── Python bootstrap + guidance ─────────────────────────

/// OS family as a stable lowercase string the UI switches on.
fn current_os() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

fn python_download_url() -> &'static str {
    "https://www.python.org/downloads/"
}

/// Extract the minor version from a `python --version` style string such as
/// `Python 3.12.1` or a bare `3.11`. Returns `None` for anything that isn't a
/// Python 3.x version. Pure — unit tested.
fn parse_minor_from_version(version: &str) -> Option<u32> {
    let digits = version.trim_start_matches(|c: char| !c.is_ascii_digit());
    let mut parts = digits.split('.');
    let major: u32 = parts.next()?.parse().ok()?;
    if major != 3 {
        return None;
    }
    let minor: String = parts
        .next()?
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    minor.parse().ok()
}

/// Whether a command is runnable — used to detect package managers.
fn command_exists(cmd: &str, version_flag: &str) -> bool {
    Command::new(cmd)
        .arg(version_flag)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// The system package manager Nuclei can drive to install Python, if any.
fn detect_package_manager() -> Option<&'static str> {
    let candidates: &[(&str, &str)] = if cfg!(target_os = "macos") {
        &[("brew", "--version")]
    } else if cfg!(target_os = "windows") {
        &[("winget", "--version")]
    } else {
        &[
            ("apt-get", "--version"),
            ("dnf", "--version"),
            ("pacman", "--version"),
        ]
    };
    candidates
        .iter()
        .find(|(cmd, flag)| command_exists(cmd, flag))
        .map(|(cmd, _)| *cmd)
}

/// The shell command that installs a modern Python via `pm`, for display.
/// Pure — unit tested. (Auto-install runs the argv form directly, no shell.)
fn package_manager_install_command(pm: &str) -> Option<String> {
    let cmd = match pm {
        "brew" => "brew install python",
        "winget" => "winget install -e --id Python.Python.3.12",
        "apt-get" => "sudo apt-get install -y python3 python3-venv python3-pip",
        "dnf" => "sudo dnf install -y python3 python3-pip",
        "pacman" => "sudo pacman -S --noconfirm python python-pip",
        _ => return None,
    };
    Some(cmd.to_string())
}

#[derive(Debug, Serialize)]
pub struct PythonSetup {
    pub found: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub supported: bool,
    pub too_old: bool,
    pub min_version: String,
    pub os: String,
    pub package_manager: Option<String>,
    pub install_command: Option<String>,
    pub download_url: String,
}

/// Report the Python situation and how to fix it — the backend half of the
/// "no Python / too-old Python" onboarding. You can't `pip install python`,
/// so when it's missing this tells the UI which package manager (if any) can
/// install it and the exact command, plus the python.org fallback.
#[tauri::command]
pub fn python_setup() -> PythonSetup {
    let (found, version, path, minor) = match find_system_python() {
        Some((p, v)) => {
            let minor = parse_minor_from_version(&v);
            (true, Some(v), Some(p), minor)
        }
        None => (false, None, None, None),
    };
    let supported = minor.map(|m| m >= MIN_PYTHON_MINOR).unwrap_or(false);
    let pm = detect_package_manager();
    PythonSetup {
        found,
        version,
        path,
        supported,
        too_old: found && !supported,
        min_version: format!("3.{MIN_PYTHON_MINOR}"),
        os: current_os().to_string(),
        package_manager: pm.map(|s| s.to_string()),
        install_command: pm.and_then(package_manager_install_command),
        download_url: python_download_url().to_string(),
    }
}

/// Install a modern Python via the detected package manager (brew on macOS,
/// winget on Windows). Linux managers need root, which a GUI subprocess can't
/// answer, so those return the exact command to run instead. Emits
/// `framework-install` progress events; returns the resulting version.
#[tauri::command]
pub fn python_install(app: AppHandle) -> Result<String, String> {
    // Already have a supported interpreter — nothing to do.
    if let Some((_, v)) = find_best_python() {
        return Ok(v);
    }
    let pm = detect_package_manager().ok_or_else(|| {
        format!(
            "No supported package manager found. Install Python 3.{}+ from {}, \
             then relaunch Nuclei.",
            MIN_PYTHON_MINOR,
            python_download_url()
        )
    })?;
    emit(&app, "installing-python", None, Some(pm));

    let (cmd, args): (&str, Vec<&str>) = match pm {
        "brew" => ("brew", vec!["install", "python"]),
        "winget" => (
            "winget",
            vec![
                "install",
                "-e",
                "--id",
                "Python.Python.3.12",
                "--accept-package-agreements",
                "--accept-source-agreements",
            ],
        ),
        other => {
            let guidance = package_manager_install_command(other).unwrap_or_default();
            return Err(format!(
                "Installing Python here needs elevated permissions. Run:\n{guidance}"
            ));
        }
    };

    let out = Command::new(cmd)
        .args(&args)
        .output()
        .map_err(|e| format!("{pm} failed to start: {e}"))?;
    if !out.status.success() {
        let tail = tail_lines(&String::from_utf8_lossy(&out.stderr), 8);
        emit(&app, "python-install-failed", None, Some(&tail));
        return Err(format!("{pm} could not install Python:\n{tail}"));
    }

    match find_best_python() {
        Some((_, v)) => {
            emit(&app, "python-installed", None, Some(&v));
            Ok(v)
        }
        None => Err(
            "Python installed, but a 3.10+ interpreter still isn't on PATH. \
             Open a new terminal or relaunch Nuclei."
                .to_string(),
        ),
    }
}

// ───────────────────────── Environment diagnostics ─────────────────────────

#[derive(Debug, Serialize)]
pub struct EnvironmentReport {
    pub os: String,
    pub system_python_version: Option<String>,
    pub system_python_path: Option<String>,
    pub python_supported: bool,
    pub venv_path: String,
    pub venv_exists: bool,
    pub venv_python_version: Option<String>,
    pub kernel_core_deps_ok: bool,
    pub installed_frameworks: Vec<String>,
    pub healthy: bool,
}

/// One-call environment doctor: system Python, the managed venv, kernel core
/// deps, and installed frameworks, with an overall health verdict. Backs a
/// diagnostics view and support ("paste your environment report").
#[tauri::command]
pub fn environment_report(app: AppHandle) -> Result<EnvironmentReport, String> {
    let venv = venv_path(&app)?;
    let venv_py = venv_python(&venv);
    let venv_exists = venv_py.exists();

    let (sys_path, sys_version) = match find_system_python() {
        Some((p, v)) => (Some(p), Some(v)),
        None => (None, None),
    };
    let python_supported = find_best_python().is_some();

    let venv_python_version = if venv_exists {
        python_minor_version(&venv_py.to_string_lossy()).map(|m| format!("Python 3.{m}"))
    } else {
        None
    };
    let core_ok = venv_exists && kernel_core_deps_present(&venv_py);
    let installed = if venv_exists {
        installed_frameworks(&venv_py)
    } else {
        Vec::new()
    };

    Ok(EnvironmentReport {
        os: current_os().to_string(),
        system_python_version: sys_version,
        system_python_path: sys_path,
        python_supported,
        venv_path: venv.to_string_lossy().to_string(),
        venv_exists,
        venv_python_version,
        kernel_core_deps_ok: core_ok,
        installed_frameworks: installed,
        healthy: venv_exists && core_ok && python_supported,
    })
}

// ───────────────────────── Uninstall + repair ─────────────────────────

/// Base package names from a pip requirement spec, for uninstall. `qiskit
/// qiskit-aer` -> `[qiskit, qiskit-aer]`; `stim>=1.14,<2` -> `[stim]`. Pure.
fn base_pkg_names(pip_name: &str) -> Vec<String> {
    pip_name
        .split_whitespace()
        .map(|spec| {
            spec.split(['<', '>', '=', '!', '~', '['])
                .next()
                .unwrap_or(spec)
                .to_string()
        })
        .filter(|s| !s.is_empty())
        .collect()
}

/// Remove frameworks from the managed venv (the symmetric counterpart of
/// `framework_install`) so users can reclaim space. Failures on one don't
/// abort the rest; the caller gets a summary.
#[tauri::command]
pub fn framework_uninstall(app: AppHandle, frameworks: Vec<String>) -> Result<Vec<String>, String> {
    let venv = venv_path(&app)?;
    let pip = venv_pip(&venv);
    if !pip.exists() {
        return Err("No managed environment yet — nothing to uninstall.".to_string());
    }

    let mut failed: Vec<String> = Vec::new();
    for id in &frameworks {
        let Some(fw) = CATALOG.iter().find(|f| f.id == id) else {
            failed.push(format!("{id}: unknown framework"));
            continue;
        };
        emit(&app, "uninstalling", Some(fw.id), None);
        let names = base_pkg_names(fw.pip_name);
        let mut args: Vec<&str> = vec!["uninstall", "-y"];
        args.extend(names.iter().map(String::as_str));
        let out = Command::new(&pip)
            .args(&args)
            .output()
            .map_err(|e| format!("pip failed to start for {id}: {e}"))?;
        if out.status.success() {
            emit(&app, "uninstalled", Some(fw.id), None);
        } else {
            let tail = tail_lines(&String::from_utf8_lossy(&out.stderr), 8);
            emit(&app, "failed", Some(fw.id), Some(&tail));
            failed.push(format!("{id}: {tail}"));
        }
    }
    emit(&app, "done", None, None);
    Ok(failed)
}

/// Rebuild the managed venv from scratch, preserving installed frameworks —
/// the escape hatch for a wedged environment (corrupt venv, half-finished
/// install, or a venv built from a since-removed Python). Returns the new
/// interpreter version.
#[tauri::command]
pub fn venv_repair(app: AppHandle) -> Result<String, String> {
    let venv = venv_path(&app)?;
    rebuild_venv_with_supported_python(&app, &venv)?;
    let py = venv_python(&venv);
    Ok(python_minor_version(&py.to_string_lossy())
        .map(|m| format!("Python 3.{m}"))
        .unwrap_or_else(|| "unknown".to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_by_id_import_and_top_level_module() {
        assert_eq!(resolve_framework("qiskit").map(|f| f.id), Some("qiskit"));
        assert_eq!(resolve_framework("QISKIT").map(|f| f.id), Some("qiskit"));
        // by import_name
        assert_eq!(resolve_framework("cudaq").map(|f| f.id), Some("cuda-q"));
        assert_eq!(resolve_framework("qdk").map(|f| f.id), Some("qsharp"));
        // dotted submodule -> top-level module
        assert_eq!(
            resolve_framework("qiskit.qasm3").map(|f| f.id),
            Some("qiskit")
        );
        assert_eq!(
            resolve_framework("qiskit_ibm_runtime").map(|f| f.id),
            Some("ibm-runtime")
        );
        assert_eq!(resolve_framework("stim").map(|f| f.id), Some("stim"));
        assert!(resolve_framework("nonsense-pkg").is_none());
        assert!(resolve_framework("   ").is_none());
    }

    #[test]
    fn parses_python_minor_version() {
        assert_eq!(parse_minor_from_version("Python 3.12.1"), Some(12));
        assert_eq!(parse_minor_from_version("3.11"), Some(11));
        assert_eq!(parse_minor_from_version("Python 3.9.6"), Some(9));
        assert_eq!(parse_minor_from_version("Python 2.7.18"), None);
        assert_eq!(parse_minor_from_version("garbage"), None);
    }

    #[test]
    fn base_pkg_names_strips_version_specs() {
        assert_eq!(
            base_pkg_names("qiskit qiskit-aer"),
            vec!["qiskit", "qiskit-aer"]
        );
        assert_eq!(base_pkg_names("stim>=1.14,<2"), vec!["stim"]);
        assert_eq!(
            base_pkg_names("pytket-quantinuum<0.26"),
            vec!["pytket-quantinuum"]
        );
    }

    #[test]
    fn install_commands_cover_known_managers() {
        for pm in ["brew", "winget", "apt-get", "dnf", "pacman"] {
            assert!(
                package_manager_install_command(pm).is_some(),
                "missing: {pm}"
            );
        }
        assert!(package_manager_install_command("nope").is_none());
    }

    #[test]
    fn current_os_is_known() {
        assert!(matches!(current_os(), "macos" | "windows" | "linux"));
    }

    #[test]
    fn every_catalog_entry_resolves_by_its_own_import_name() {
        for fw in CATALOG {
            let top = fw.import_name.split('.').next().unwrap_or(fw.import_name);
            assert!(
                resolve_framework(top).is_some(),
                "catalog import {} did not resolve",
                fw.import_name
            );
        }
    }
}
