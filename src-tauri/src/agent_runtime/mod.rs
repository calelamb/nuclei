pub mod process;
pub mod protocol;
pub mod resources;
pub mod unsupported;

use process::{Supervisor, SupervisorLimits};
use protocol::{Framework, WorkerRequestV1, WorkerResponseV1};
use std::future::Future;

#[derive(Clone, Debug, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ControlResult {
    pub name: String,
    pub self_test_passed: bool,
}

#[derive(Clone, Debug, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityReport {
    pub available: bool,
    pub reason: Option<String>,
    pub qualified_frameworks: Vec<String>,
    pub controls: Vec<ControlResult>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum QualificationMode {
    AllowUnavailable,
    RequireAvailable,
}

pub struct AgentRuntimeState {
    pub supervisor: Supervisor,
    pub capability: tokio::sync::RwLock<CapabilityReport>,
}

impl AgentRuntimeState {
    pub fn new() -> Self {
        Self {
            supervisor: Supervisor::new(SupervisorLimits::production()),
            capability: tokio::sync::RwLock::new(CapabilityReport {
                available: false,
                reason: Some(unsupported::UNAVAILABLE_MESSAGE.into()),
                qualified_frameworks: Vec::new(),
                controls: Vec::new(),
            }),
        }
    }
}

impl Default for AgentRuntimeState {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for AgentRuntimeState {
    fn drop(&mut self) {
        self.supervisor.cancel_all_now();
    }
}

pub trait AgentRuntimeCommands {
    fn execute<'a>(
        &'a self,
        app: &'a tauri::AppHandle,
        request: WorkerRequestV1,
    ) -> impl Future<Output = Result<WorkerResponseV1, String>> + Send + 'a;

    fn capability<'a>(
        &'a self,
        app: &'a tauri::AppHandle,
    ) -> impl Future<Output = CapabilityReport> + Send + 'a;
}

impl AgentRuntimeCommands for AgentRuntimeState {
    async fn execute<'a>(
        &'a self,
        _app: &'a tauri::AppHandle,
        request: WorkerRequestV1,
    ) -> Result<WorkerResponseV1, String> {
        let report = self.capability.read().await.clone();
        if !report.available {
            return Err(report
                .reason
                .unwrap_or_else(|| unsupported::UNAVAILABLE_MESSAGE.into()));
        }

        let framework = match request.framework {
            Framework::Qiskit => "qiskit",
            Framework::Cirq => "cirq",
            Framework::Qsharp => "qsharp",
        };
        if !report
            .qualified_frameworks
            .iter()
            .any(|qualified| qualified == framework)
        {
            return Err("Agent framework is not qualified for isolated execution".into());
        }

        // Platform tasks install the only authoritative spec resolvers. Until
        // then, even a manually altered capability report cannot spawn a worker.
        Err(unsupported::UNAVAILABLE_MESSAGE.into())
    }

    async fn capability<'a>(&'a self, _app: &'a tauri::AppHandle) -> CapabilityReport {
        self.capability.read().await.clone()
    }
}
