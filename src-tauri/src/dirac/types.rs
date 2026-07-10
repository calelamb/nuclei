//! Wire types for the Dirac execution supervisor (agent protocol v1).
//!
//! `AgentExecuteRequest` is the request the Rust harness serializes onto the
//! disposable worker's stdin; `AgentExecuteResponse` is the single JSON line
//! the worker writes back. Both mirror `kernel/agent_protocol.py`.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Agent protocol version understood by this harness and `kernel/agent_worker.py`.
pub const PROTOCOL_VERSION: u8 = 1;

fn default_protocol_version() -> u8 {
    PROTOCOL_VERSION
}

/// One quantum request (parse/simulate/transpile) for the disposable worker.
///
/// Optional fields are `skip_serializing_if = "Option::is_none"` so a parse or
/// simulate request never emits the transpile-only fields — the protocol
/// rejects unexpected keys (`kernel/agent_protocol.py::parse_request`).
///
/// `Deserialize` is derived in addition to the spec's `Serialize` because this
/// type is also the argument of the `dirac_execute` Tauri command, and Tauri
/// deserializes command arguments from the frontend payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentExecuteRequest {
    #[serde(default = "default_protocol_version")]
    pub protocol_version: u8,
    pub request_id: String,
    pub action: String,
    pub framework: String,
    pub language: String,
    pub code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shots: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub basis_gates: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub coupling_map: Option<Vec<Vec<i64>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub optimization_level: Option<u8>,
}

/// The worker's response. `snapshot`, `result`, and `error` are kept opaque as
/// `serde_json::Value` (nullable) — the frontend already understands them.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentExecuteResponse {
    pub protocol_version: u8,
    pub request_id: String,
    pub status: String,
    pub snapshot: Value,
    pub result: Value,
    pub stdout: String,
    pub stderr: String,
    pub error: Value,
}

impl AgentExecuteResponse {
    /// Build a synthesized error response, mirroring `_agent_error` in
    /// `kernel/server.py`. Used when the worker fails to spawn, times out,
    /// or emits output the harness cannot trust.
    pub fn error(request_id: impl Into<String>, code: &str, message: &str) -> Self {
        Self {
            protocol_version: PROTOCOL_VERSION,
            request_id: request_id.into(),
            status: "error".to_string(),
            snapshot: Value::Null,
            result: Value::Null,
            stdout: String::new(),
            stderr: String::new(),
            error: serde_json::json!({ "code": code, "message": message }),
        }
    }
}
