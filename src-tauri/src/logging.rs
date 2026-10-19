//! Application logging (PRD 15 R-17).
//!
//! Release builds used to log at Warn, so `nuclei.log` stayed empty through
//! venv creation, pip installs and the kernel start: failures at those stages
//! were invisible until they reached Warn. The file now records Info and above
//! (rotating); the console keeps Warn and above in release builds so a
//! terminal launch stays quiet. A startup report of the Python environment is
//! logged on every launch, and `open_logs` lets the UI reveal the folder.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;

use log::{Level, LevelFilter};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};

/// Lowest level written to the log file, in debug and release alike.
pub const FILE_LEVEL: LevelFilter = LevelFilter::Info;
/// One log file rotates once it passes this size.
pub const MAX_LOG_FILE_BYTES: u128 = 2 * 1024 * 1024;
/// Rotated files kept next to the live one.
pub const LOG_FILES_KEPT: usize = 5;

// A rotating log must be bounded in both size and count.
const _: () = assert!(MAX_LOG_FILE_BYTES >= 1024 * 1024 && LOG_FILES_KEPT >= 2);

/// Whether a record at `level` is echoed to the console. Debug builds show
/// everything the file gets; release builds only warnings and errors.
pub fn console_accepts(debug_build: bool, level: Level) -> bool {
    debug_build || level <= Level::Warn
}

/// The logging plugin: Info to a rotating file in the OS log directory, and
/// the console filtered by [`console_accepts`].
pub fn plugin<R: Runtime>(debug_build: bool) -> tauri::plugin::TauriPlugin<R> {
    tauri_plugin_log::Builder::default()
        .level(FILE_LEVEL)
        .rotation_strategy(RotationStrategy::KeepSome(LOG_FILES_KEPT))
        .max_file_size(MAX_LOG_FILE_BYTES)
        .clear_targets()
        .target(Target::new(TargetKind::LogDir { file_name: None }))
        .target(
            Target::new(TargetKind::Stderr)
                .filter(move |meta| console_accepts(debug_build, meta.level())),
        )
        .build()
}

/// The program and arguments that reveal `dir` in the OS file manager.
fn opener_command(os: &str, dir: &Path) -> (&'static str, Vec<OsString>) {
    let program = match os {
        "macos" => "open",
        "windows" => "explorer",
        _ => "xdg-open",
    };
    (program, vec![dir.as_os_str().to_os_string()])
}

fn log_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_log_dir()
        .map_err(|e| format!("Could not resolve the log folder: {e}"))
}

/// Open the folder holding `nuclei.log` in the OS file manager. Returns its path
/// so the UI can show it when no file manager is available.
#[tauri::command(async)]
pub fn open_logs(app: AppHandle) -> Result<String, String> {
    let dir = log_dir(&app)?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Could not create the log folder {}: {e}", dir.display()))?;
    let (program, args) = opener_command(std::env::consts::OS, &dir);
    let mut child = Command::new(program)
        .args(&args)
        .spawn()
        .map_err(|e| format!("Could not open {} with {program}: {e}", dir.display()))?;
    // Reap the opener (explorer.exe exits non-zero even on success).
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(dir.display().to_string())
}

/// Log who is running and, off the main thread, the Python environment report
/// (the probes spawn interpreters, which must not delay the window).
pub fn log_startup_report(app: &AppHandle) {
    log::info!(
        "Nuclei {} starting on {} ({})",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        std::env::consts::ARCH
    );
    match log_dir(app) {
        Ok(dir) => log::info!("Log folder: {}", dir.display()),
        Err(e) => log::warn!("{e}"),
    }
    let app = app.clone();
    let spawned = std::thread::Builder::new()
        .name("env-report".to_string())
        .spawn(move || {
            match crate::commands::frameworks::collect_environment_report(&app)
                .and_then(|report| serde_json::to_string(&report).map_err(|e| e.to_string()))
            {
                Ok(json) => log::info!("Environment report: {json}"),
                Err(e) => log::warn!("Could not build the environment report: {e}"),
            }
        });
    if let Err(e) = spawned {
        log::warn!("Could not start the environment report: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_file_records_info_so_provisioning_and_startup_are_visible() {
        assert_eq!(FILE_LEVEL, LevelFilter::Info);
        assert!(Level::Info <= FILE_LEVEL);
        assert!(Level::Debug > FILE_LEVEL);
    }

    #[test]
    fn release_consoles_stay_at_warn_and_debug_consoles_show_everything_logged() {
        assert!(console_accepts(false, Level::Error));
        assert!(console_accepts(false, Level::Warn));
        assert!(!console_accepts(false, Level::Info));
        assert!(!console_accepts(false, Level::Debug));
        assert!(console_accepts(true, Level::Info));
    }

    #[test]
    fn each_os_has_a_file_manager_opener() {
        let dir = Path::new("/logs");
        assert_eq!(opener_command("macos", dir).0, "open");
        assert_eq!(opener_command("windows", dir).0, "explorer");
        assert_eq!(opener_command("linux", dir).0, "xdg-open");
        assert_eq!(opener_command("freebsd", dir).0, "xdg-open");
        let (_, args) = opener_command("linux", dir);
        assert_eq!(args, vec![OsString::from("/logs")]);
    }
}
