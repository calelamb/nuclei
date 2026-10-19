//! Command-line flags answered before the desktop app is built (PRD 15 R-18).
//!
//! `nuclei --version` used to start the full GUI and a kernel, so a packaged-app
//! smoke test or a script probing the version spawned a window. These flags are
//! handled in `main` before any Tauri setup, so they work without a display.

/// Result of looking at the command line before starting the app.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EarlyExit {
    /// Text for stdout (already newline-terminated).
    pub stdout: String,
    pub code: i32,
}

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

fn version_text() -> String {
    format!("nuclei {VERSION}\n")
}

fn help_text() -> String {
    format!(
        "nuclei {VERSION}\n\
         A purpose-built desktop IDE for quantum computing.\n\
         \n\
         USAGE:\n    nuclei [OPTIONS]\n\
         \n\
         OPTIONS:\n    -V, --version    Print the version and exit\n    -h, --help       Print this help and exit\n"
    )
}

/// `Some` when the arguments (without `argv[0]`) ask for information instead
/// of the app. Scanning stops at a bare `--`. Unknown arguments are left to
/// the app (the OS passes file paths and URLs this way).
pub fn early_exit<I, S>(args: I) -> Option<EarlyExit>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    for arg in args {
        match arg.as_ref() {
            "--" => return None,
            "-V" | "--version" => {
                return Some(EarlyExit {
                    stdout: version_text(),
                    code: 0,
                })
            }
            "-h" | "--help" => {
                return Some(EarlyExit {
                    stdout: help_text(),
                    code: 0,
                })
            }
            _ => {}
        }
    }
    None
}

/// Entry point for `main`: print and exit when a flag asks for it, otherwise
/// return so the app starts.
pub fn handle_process_args() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Some(exit) = early_exit(&args) {
        use std::io::Write;
        let _ = std::io::stdout().write_all(exit.stdout.as_bytes());
        let _ = std::io::stdout().flush();
        std::process::exit(exit.code);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_flags_answer_with_the_crate_version() {
        for flag in ["--version", "-V"] {
            let exit = early_exit([flag]).expect(flag);
            assert_eq!(exit.code, 0);
            assert_eq!(
                exit.stdout,
                format!("nuclei {}\n", env!("CARGO_PKG_VERSION"))
            );
        }
    }

    #[test]
    fn help_flags_describe_usage() {
        for flag in ["--help", "-h"] {
            let exit = early_exit([flag]).expect(flag);
            assert_eq!(exit.code, 0);
            assert!(exit.stdout.contains("USAGE"));
            assert!(exit.stdout.contains("--version"));
            assert!(exit.stdout.ends_with('\n'));
        }
    }

    #[test]
    fn the_flag_is_found_anywhere_before_a_double_dash() {
        assert!(early_exit(["--foo", "--version"]).is_some());
        assert!(early_exit(["--", "--version"]).is_none());
    }

    #[test]
    fn ordinary_launches_are_left_to_the_app() {
        assert_eq!(early_exit(Vec::<String>::new()), None);
        assert_eq!(early_exit(["/home/me/bell.py"]), None);
        assert_eq!(early_exit(["nuclei://open?file=a.py", "--versions"]), None);
    }
}
