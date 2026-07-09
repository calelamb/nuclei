pub mod process;
pub mod protocol;
pub mod resources;
pub mod unsupported;

use process::{ProcessSpec, Supervisor, SupervisorLimits};
use protocol::{Framework, WorkerRequestV1, WorkerResponseV1};
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

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
    resolver: Arc<dyn AgentProcessResolver>,
}

pub trait AgentProcessResolver: Send + Sync {
    fn resolve<'a>(
        &'a self,
        request: &'a WorkerRequestV1,
    ) -> Pin<Box<dyn Future<Output = Result<ProcessSpec, String>> + Send + 'a>>;
}

struct UnavailableResolver;

impl AgentProcessResolver for UnavailableResolver {
    fn resolve<'a>(
        &'a self,
        _request: &'a WorkerRequestV1,
    ) -> Pin<Box<dyn Future<Output = Result<ProcessSpec, String>> + Send + 'a>> {
        Box::pin(async { Err(unsupported::UNAVAILABLE_MESSAGE.into()) })
    }
}

impl AgentRuntimeState {
    pub fn new() -> Self {
        Self::with_resolver(
            Supervisor::new(SupervisorLimits::production()),
            CapabilityReport {
                available: false,
                reason: Some(unsupported::UNAVAILABLE_MESSAGE.into()),
                qualified_frameworks: Vec::new(),
                controls: Vec::new(),
            },
            Arc::new(UnavailableResolver),
        )
    }

    pub fn with_resolver(
        supervisor: Supervisor,
        capability: CapabilityReport,
        resolver: Arc<dyn AgentProcessResolver>,
    ) -> Self {
        Self {
            supervisor,
            capability: tokio::sync::RwLock::new(capability),
            resolver,
        }
    }

    pub fn execute_request(
        &self,
        request: WorkerRequestV1,
    ) -> impl Future<Output = Result<WorkerResponseV1, String>> + Send + '_ {
        let reservation = self.supervisor.reserve(&request.request_id);
        async move {
            let reservation = reservation.map_err(|error| error.message)?;
            if reservation.is_cancelled() {
                return Err("Worker request was cancelled".into());
            }
            let deadline = reservation.deadline();

            let report = tokio::select! {
                _ = reservation.cancelled() => {
                    return Err("Worker request was cancelled".into());
                }
                _ = tokio::time::sleep_until(deadline) => {
                    return Err("Worker exceeded the wall-clock limit".into());
                }
                report = self.capability.read() => report.clone(),
            };
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

            let spec = tokio::select! {
                _ = reservation.cancelled() => {
                    return Err("Worker request was cancelled".into());
                }
                _ = tokio::time::sleep_until(deadline) => {
                    return Err("Worker exceeded the wall-clock limit".into());
                }
                result = self.resolver.resolve(&request) => result?,
            };
            if reservation.is_cancelled() {
                return Err("Worker request was cancelled".into());
            }
            let mut stdin = serde_json::to_vec(&request).map_err(|error| error.to_string())?;
            stdin.push(b'\n');
            self.supervisor
                .run_reserved(&request, spec, &stdin, reservation)
                .await
                .map_err(|error| error.message)
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
    fn execute<'a>(
        &'a self,
        _app: &'a tauri::AppHandle,
        request: WorkerRequestV1,
    ) -> impl Future<Output = Result<WorkerResponseV1, String>> + Send + 'a {
        self.execute_request(request)
    }

    async fn capability<'a>(&'a self, _app: &'a tauri::AppHandle) -> CapabilityReport {
        self.capability.read().await.clone()
    }
}
