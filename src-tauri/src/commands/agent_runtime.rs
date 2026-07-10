use crate::agent_runtime::process::ProcessSupervisor;
use crate::agent_runtime::protocol::{FrontendRequestV1, WorkerRequestV1, WorkerResponseV1};
use crate::agent_runtime::{AgentRuntimeCommands, AgentRuntimeState, CapabilityReport};

#[tauri::command]
pub async fn agent_sandbox_execute(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentRuntimeState>,
    request: FrontendRequestV1,
) -> Result<WorkerResponseV1, String> {
    let request = WorkerRequestV1::try_from(request)?;
    state.execute(&app, request).await
}

#[tauri::command]
pub async fn agent_sandbox_cancel(
    state: tauri::State<'_, AgentRuntimeState>,
    request_id: String,
) -> Result<(), String> {
    state
        .supervisor
        .cancel(&request_id)
        .await
        .map_err(|error| error.message)
}

#[tauri::command]
pub async fn agent_sandbox_capability(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentRuntimeState>,
) -> Result<CapabilityReport, String> {
    Ok(state.capability(&app).await)
}
