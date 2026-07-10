pub mod macos;
pub mod process;
pub mod protocol;
pub mod resources;
pub mod unsupported;

use process::{ProcessSpec, Supervisor, SupervisorLimits};
use protocol::{Framework, WorkerRequestV1, WorkerResponseV1};
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
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
    backend: tokio::sync::RwLock<InstalledBackend>,
    refresh_generation: AtomicU64,
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

#[derive(Clone)]
struct InstalledBackend {
    report: CapabilityReport,
    resolver: Arc<dyn AgentProcessResolver>,
    cache_key: Option<String>,
}

struct MacContextResolver {
    context: macos::QualificationContext,
    cache_key: String,
}

impl AgentProcessResolver for MacContextResolver {
    fn resolve<'a>(
        &'a self,
        _request: &'a WorkerRequestV1,
    ) -> Pin<Box<dyn Future<Output = Result<ProcessSpec, String>> + Send + 'a>> {
        Box::pin(async move {
            if macos::qualification_cache_key(&self.context)? != self.cache_key {
                return Err(
                    "Qualified macOS backend identity changed; requalification required".into(),
                );
            }
            let request_temp = self
                .context
                .request_temp_root
                .join(format!("request-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir(&request_temp)
                .map_err(|error| format!("Failed to create request temp: {error}"))?;
            let request_temp = request_temp
                .canonicalize()
                .map_err(|error| format!("Request temp is unavailable: {error}"))?;
            match macos::MacBackend::worker_spec(&self.context, &request_temp) {
                Ok(spec) => Ok(spec),
                Err(error) => {
                    let cleanup = std::fs::remove_dir_all(&request_temp);
                    match cleanup {
                        Ok(()) => Err(error),
                        Err(cleanup_error) => Err(format!(
                            "{error}; failed to clean request temp: {cleanup_error}"
                        )),
                    }
                }
            }
        })
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
            backend: tokio::sync::RwLock::new(InstalledBackend {
                report: capability,
                resolver,
                cache_key: None,
            }),
            refresh_generation: AtomicU64::new(0),
        }
    }

    pub async fn cached_capability(&self) -> CapabilityReport {
        self.backend.read().await.report.clone()
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

            let backend = tokio::select! {
                _ = reservation.cancelled() => {
                    return Err("Worker request was cancelled".into());
                }
                _ = tokio::time::sleep_until(deadline) => {
                    return Err("Worker exceeded the wall-clock limit".into());
                }
                backend = self.backend.read() => backend.clone(),
            };
            let report = backend.report;
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

            let spec_result = tokio::select! {
                _ = reservation.cancelled() => {
                    return Err("Worker request was cancelled".into());
                }
                _ = tokio::time::sleep_until(deadline) => {
                    return Err("Worker exceeded the wall-clock limit".into());
                }
                result = backend.resolver.resolve(&request) => result,
            };
            let spec = match spec_result {
                Ok(spec) => spec,
                Err(error) => {
                    self.clear_backend(error.clone()).await;
                    return Err(error);
                }
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

    async fn capability<'a>(&'a self, app: &'a tauri::AppHandle) -> CapabilityReport {
        let generation = self.refresh_generation.fetch_add(1, Ordering::AcqRel) + 1;
        let context = macos::QualificationContext::from_explicit_environment(
            &app.package_info().version.to_string(),
        );
        let context = match context {
            Ok(context) => context,
            Err(error) => {
                let report = required_mode(
                    CapabilityReport {
                        available: false,
                        reason: Some(error),
                        qualified_frameworks: Vec::new(),
                        controls: Vec::new(),
                    },
                    QualificationMode::AllowUnavailable,
                );
                self.install_if_current(
                    generation,
                    InstalledBackend {
                        report: report.clone(),
                        resolver: Arc::new(UnavailableResolver),
                        cache_key: None,
                    },
                )
                .await;
                return self.cached_capability().await;
            }
        };
        let cache_key = match macos::qualification_cache_key(&context) {
            Ok(key) => key,
            Err(error) => {
                let report = unavailable_report(error);
                self.install_if_current(
                    generation,
                    InstalledBackend {
                        report,
                        resolver: Arc::new(UnavailableResolver),
                        cache_key: None,
                    },
                )
                .await;
                return self.cached_capability().await;
            }
        };
        {
            let backend = self.backend.read().await;
            if backend.report.available && backend.cache_key.as_deref() == Some(&cache_key) {
                return backend.report.clone();
            }
        }

        // No state lock is held while the platform launches long-running probes.
        let report =
            qualify_current_host_with_context(QualificationMode::AllowUnavailable, context.clone())
                .await;
        let resolver: Arc<dyn AgentProcessResolver> = if report.available {
            Arc::new(MacContextResolver {
                context,
                cache_key: cache_key.clone(),
            })
        } else {
            Arc::new(UnavailableResolver)
        };
        self.install_if_current(
            generation,
            InstalledBackend {
                cache_key: report.available.then_some(cache_key),
                report,
                resolver,
            },
        )
        .await;
        self.cached_capability().await
    }
}

impl AgentRuntimeState {
    async fn install_if_current(&self, generation: u64, backend: InstalledBackend) {
        if self.refresh_generation.load(Ordering::Acquire) != generation {
            return;
        }
        let mut installed = self.backend.write().await;
        if self.refresh_generation.load(Ordering::Acquire) == generation {
            *installed = backend;
        }
    }

    async fn clear_backend(&self, reason: String) {
        self.refresh_generation.fetch_add(1, Ordering::AcqRel);
        let mut installed = self.backend.write().await;
        *installed = InstalledBackend {
            report: unavailable_report(reason),
            resolver: Arc::new(UnavailableResolver),
            cache_key: None,
        };
    }
}

pub async fn qualify_current_host(mode: QualificationMode) -> CapabilityReport {
    #[cfg(target_os = "macos")]
    {
        let context =
            match macos::QualificationContext::from_explicit_environment(env!("CARGO_PKG_VERSION"))
            {
                Ok(context) => context,
                Err(error) => return required_mode(unavailable_report(error), mode),
            };
        qualify_current_host_with_context(mode, context).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        required_mode(unavailable_report(unsupported::UNAVAILABLE_MESSAGE), mode)
    }
}

pub async fn qualify_current_host_with_context(
    mode: QualificationMode,
    context: macos::QualificationContext,
) -> CapabilityReport {
    #[cfg(target_os = "macos")]
    let report = macos::qualify(&context).await;
    #[cfg(not(target_os = "macos"))]
    let report = {
        let _ = context;
        unavailable_report(unsupported::UNAVAILABLE_MESSAGE)
    };
    required_mode(report, mode)
}

fn unavailable_report(reason: impl Into<String>) -> CapabilityReport {
    CapabilityReport {
        available: false,
        reason: Some(reason.into()),
        qualified_frameworks: Vec::new(),
        controls: Vec::new(),
    }
}

fn required_mode(mut report: CapabilityReport, mode: QualificationMode) -> CapabilityReport {
    if matches!(mode, QualificationMode::RequireAvailable) && !report.available {
        report.reason = Some(format!(
            "Required agent isolation unavailable: {}",
            report.reason.as_deref().unwrap_or("qualification failed")
        ));
    }
    if !report.available {
        report.qualified_frameworks.clear();
        report.controls.clear();
    }
    report
}
