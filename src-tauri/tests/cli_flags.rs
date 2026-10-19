//! `nuclei --version` / `--help` must answer and exit before any Tauri setup
//! (PRD 15 R-18): no window, no display, no kernel, no files under the user's
//! home. Runs the real built binary with a scrubbed environment.

use std::process::{Command, Output};

fn run(args: &[&str]) -> Output {
    let home = tempfile::tempdir().expect("tempdir");
    Command::new(env!("CARGO_BIN_EXE_nuclei"))
        .args(args)
        .env_remove("DISPLAY")
        .env_remove("WAYLAND_DISPLAY")
        .env("HOME", home.path())
        .env("XDG_DATA_HOME", home.path().join("data"))
        .env("XDG_CONFIG_HOME", home.path().join("config"))
        .env("NUCLEI_RUNTIME_DIR", home.path().join("runtime"))
        .output()
        .expect("nuclei binary runs")
}

#[test]
fn version_flag_prints_the_version_and_exits_zero_without_a_display() {
    for flag in ["--version", "-V"] {
        let out = run(&[flag]);
        assert!(out.status.success(), "{flag}: {:?}", out.status);
        assert_eq!(
            String::from_utf8_lossy(&out.stdout),
            format!("nuclei {}\n", env!("CARGO_PKG_VERSION"))
        );
    }
}

#[test]
fn help_flag_prints_usage_and_exits_zero() {
    for flag in ["--help", "-h"] {
        let out = run(&[flag]);
        assert!(out.status.success(), "{flag}: {:?}", out.status);
        let text = String::from_utf8_lossy(&out.stdout);
        assert!(text.contains("USAGE"), "{text}");
        assert!(text.contains("--version"), "{text}");
    }
}
