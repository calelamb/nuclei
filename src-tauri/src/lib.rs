pub mod agent_runtime;
mod commands;

use agent_runtime::process::ProcessSupervisor;
use agent_runtime::AgentRuntimeState;
use commands::kernel::KernelState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let kernel_state = KernelState::new();
    let agent_runtime_state = AgentRuntimeState::new();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(kernel_state)
        .manage(agent_runtime_state)
        .invoke_handler(tauri::generate_handler![
            commands::kernel::start_kernel,
            commands::kernel::stop_kernel,
            commands::frameworks::framework_status,
            commands::frameworks::framework_install,
            commands::agent_runtime::agent_sandbox_execute,
            commands::agent_runtime::agent_sandbox_cancel,
            commands::agent_runtime::agent_sandbox_capability,
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
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(|app_handle, event| {
        if matches!(
            event,
            tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
        ) {
            let state = app_handle.state::<AgentRuntimeState>();
            tauri::async_runtime::block_on(state.supervisor.cancel_all());
        }
    });
}
