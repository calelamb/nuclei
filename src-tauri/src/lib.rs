mod commands;

use commands::kernel::KernelState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let kernel_state = KernelState::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(kernel_state)
        .invoke_handler(tauri::generate_handler![
            commands::kernel::start_kernel,
            commands::kernel::stop_kernel,
            commands::frameworks::framework_status,
            commands::frameworks::framework_install,
        ])
        .setup(|app| {
            let log_level = if cfg!(debug_assertions) {
                log::LevelFilter::Info
            } else {
                log::LevelFilter::Warn
            };
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log_level)
                    .build(),
            )?;
            Ok(())
        })
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // Kernel cleanup happens via KernelState Drop
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
