use crate::agent_runtime::process::ProcessSupervisor;
use crate::agent_runtime::protocol::{
    Framework, FrontendRequestV1, ResponseStatus, WorkerRequestV1, WorkerResponseV1,
};
use crate::agent_runtime::{AgentRuntimeCommands, AgentRuntimeState, CapabilityReport};

#[tauri::command]
pub async fn agent_sandbox_execute(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentRuntimeState>,
    request: FrontendRequestV1,
) -> Result<serde_json::Value, String> {
    let request = WorkerRequestV1::try_from(request)?;
    state.execute(&app, request).await.map(response_json)
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

fn response_json(response: WorkerResponseV1) -> serde_json::Value {
    let snapshot = response.snapshot.map(|snapshot| {
        serde_json::json!({
            "framework": framework_name(snapshot.framework),
            "qubit_count": snapshot.qubit_count,
            "classical_bit_count": snapshot.classical_bit_count,
            "depth": snapshot.depth,
            "gates": snapshot.gates.into_iter().map(|gate| serde_json::json!({
                "type": gate.gate_type,
                "targets": gate.targets,
                "controls": gate.controls,
                "params": gate.params,
                "layer": gate.layer,
            })).collect::<Vec<_>>(),
        })
    });
    let result = response.result.map(|result| {
        serde_json::json!({
            "state_vector": result.state_vector.into_iter().map(|value| serde_json::json!({
                "re": value.re,
                "im": value.im,
            })).collect::<Vec<_>>(),
            "probabilities": result.probabilities,
            "measurements": result.measurements,
            "bloch_coords": result.bloch_coords.into_iter().map(|value| serde_json::json!({
                "x": value.x,
                "y": value.y,
                "z": value.z,
            })).collect::<Vec<_>>(),
            "execution_time_ms": result.execution_time_ms,
            "shot_count": result.shot_count,
        })
    });
    let error = response.error.map(|error| {
        serde_json::json!({
            "code": error.code,
            "message": error.message,
            "traceback": error.traceback,
            "framework": error.framework.map(framework_name),
            "dependency": error.dependency,
        })
    });

    serde_json::json!({
        "protocol_version": response.protocol_version,
        "request_id": response.request_id,
        "status": match response.status {
            ResponseStatus::Ok => "ok",
            ResponseStatus::Error => "error",
        },
        "snapshot": snapshot,
        "result": result,
        "stdout": response.stdout,
        "stderr": response.stderr,
        "error": error,
    })
}

fn framework_name(framework: Framework) -> &'static str {
    match framework {
        Framework::Qiskit => "qiskit",
        Framework::Cirq => "cirq",
        Framework::Qsharp => "qsharp",
    }
}
