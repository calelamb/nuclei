// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `--version` / `--help` answer here, before any window or kernel exists.
    app_lib::cli::handle_process_args();
    app_lib::run();
}
