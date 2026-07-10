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
    fn installed_identity(&self) -> Option<(u64, &str)> {
        None
    }

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
    refresh_key: String,
    generation: u64,
}

struct MacContextResolver {
    context: macos::QualificationContext,
    installed_generation: u64,
    installed_key: String,
}

impl AgentProcessResolver for MacContextResolver {
    fn installed_identity(&self) -> Option<(u64, &str)> {
        Some((self.installed_generation, &self.installed_key))
    }

    fn resolve<'a>(
        &'a self,
        _request: &'a WorkerRequestV1,
    ) -> Pin<Box<dyn Future<Output = Result<ProcessSpec, String>> + Send + 'a>> {
        Box::pin(async move {
            if macos::qualification_cache_key(&self.context)? != self.installed_key {
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
                refresh_key: "initial".into(),
                generation: 0,
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
            let backend_generation = backend.generation;
            let backend_key = backend.cache_key.clone();
            if let Some((resolver_generation, resolver_key)) = backend.resolver.installed_identity()
            {
                if resolver_generation != backend_generation
                    || Some(resolver_key) != backend_key.as_deref()
                {
                    return Err("Installed agent report/resolver identity mismatch".into());
                }
            }
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
                    self.clear_backend_if_current(
                        backend_generation,
                        backend_key.as_deref(),
                        error.clone(),
                    )
                    .await;
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
        let generation = self.begin_refresh();
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
                    "context-unavailable",
                    InstalledBackend {
                        report: report.clone(),
                        resolver: Arc::new(UnavailableResolver),
                        cache_key: None,
                        refresh_key: "context-unavailable".into(),
                        generation,
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
                    "identity-unavailable",
                    InstalledBackend {
                        report,
                        resolver: Arc::new(UnavailableResolver),
                        cache_key: None,
                        refresh_key: "identity-unavailable".into(),
                        generation,
                    },
                )
                .await;
                return self.cached_capability().await;
            }
        };
        if let Some(report) = self.reuse_if_identity_matches(generation, &cache_key).await {
            return report;
        }

        // No state lock is held while the platform launches long-running probes.
        let report =
            qualify_current_host_with_context(QualificationMode::AllowUnavailable, context.clone())
                .await;
        let resolver: Arc<dyn AgentProcessResolver> = if report.available {
            Arc::new(MacContextResolver {
                context,
                installed_generation: generation,
                installed_key: cache_key.clone(),
            })
        } else {
            Arc::new(UnavailableResolver)
        };
        self.install_if_current(
            generation,
            &cache_key,
            InstalledBackend {
                cache_key: report.available.then_some(cache_key.clone()),
                report,
                resolver,
                refresh_key: cache_key.clone(),
                generation,
            },
        )
        .await;
        self.cached_capability().await
    }
}

impl AgentRuntimeState {
    fn begin_refresh(&self) -> u64 {
        self.refresh_generation
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |generation| {
                generation.checked_add(1)
            })
            .expect("agent runtime refresh generation exhausted")
            + 1
    }

    async fn commit_refresh(&self, generation: u64, key: &str, backend: InstalledBackend) -> bool {
        if backend.generation != generation
            || backend.refresh_key != key
            || self.refresh_generation.load(Ordering::Acquire) != generation
        {
            return false;
        }
        let mut installed = self.backend.write().await;
        if self.refresh_generation.load(Ordering::Acquire) != generation
            || generation <= installed.generation
        {
            return false;
        }
        *installed = backend;
        true
    }

    async fn reuse_if_identity_matches(
        &self,
        generation: u64,
        key: &str,
    ) -> Option<CapabilityReport> {
        let mut refreshed = {
            let installed = self.backend.read().await;
            if !installed.report.available || installed.cache_key.as_deref() != Some(key) {
                return None;
            }
            installed.clone()
        };
        refreshed.generation = generation;
        refreshed.refresh_key = key.into();
        if self.commit_refresh(generation, key, refreshed).await {
            Some(self.cached_capability().await)
        } else {
            None
        }
    }

    async fn install_if_current(&self, generation: u64, key: &str, backend: InstalledBackend) {
        let _ = self.commit_refresh(generation, key, backend).await;
    }

    async fn clear_backend_if_current(
        &self,
        failed_generation: u64,
        failed_key: Option<&str>,
        reason: String,
    ) {
        let refresh_key = format!(
            "resolver-failure:{failed_generation}:{}",
            failed_key.unwrap_or("unkeyed")
        );
        let mut installed = self.backend.write().await;
        if self.refresh_generation.load(Ordering::Acquire) != failed_generation
            || installed.generation != failed_generation
            || installed.cache_key.as_deref() != failed_key
        {
            return;
        }
        *installed = InstalledBackend {
            report: unavailable_report(reason),
            resolver: Arc::new(UnavailableResolver),
            cache_key: None,
            refresh_key,
            generation: failed_generation,
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

#[cfg(test)]
mod refresh_tests {
    use super::*;

    struct TaggedResolver(&'static str);

    impl AgentProcessResolver for TaggedResolver {
        fn resolve<'a>(
            &'a self,
            _request: &'a WorkerRequestV1,
        ) -> Pin<Box<dyn Future<Output = Result<ProcessSpec, String>> + Send + 'a>> {
            Box::pin(async move { Err(self.0.into()) })
        }
    }

    fn candidate(
        available: bool,
        tag: &'static str,
        key: &str,
        generation: u64,
    ) -> InstalledBackend {
        InstalledBackend {
            report: CapabilityReport {
                available,
                reason: (!available).then(|| tag.into()),
                qualified_frameworks: available.then(|| vec!["cirq".into()]).unwrap_or_default(),
                controls: Vec::new(),
            },
            resolver: Arc::new(TaggedResolver(tag)),
            cache_key: available.then(|| key.into()),
            refresh_key: key.into(),
            generation,
        }
    }

    #[tokio::test]
    async fn older_failure_cannot_erase_newer_success() {
        let state = Arc::new(AgentRuntimeState::new());
        let old = state.begin_refresh();
        let old_entered = Arc::new(tokio::sync::Notify::new());
        let release_old = Arc::new(tokio::sync::Notify::new());
        let old_completion = {
            let state = Arc::clone(&state);
            let entered = Arc::clone(&old_entered);
            let release = Arc::clone(&release_old);
            tokio::spawn(async move {
                entered.notify_one();
                release.notified().await;
                state
                    .commit_refresh(old, "old-key", candidate(false, "old", "old-key", old))
                    .await
            })
        };
        old_entered.notified().await;
        let new = state.begin_refresh();

        assert!(
            state
                .commit_refresh(new, "new-key", candidate(true, "new", "new-key", new))
                .await
        );
        release_old.notify_one();
        assert!(!old_completion.await.unwrap());
        let installed = state.backend.read().await;
        assert!(installed.report.available);
        assert_eq!(installed.cache_key.as_deref(), Some("new-key"));
        assert_eq!(installed.generation, new);
    }

    #[tokio::test]
    async fn older_success_cannot_overwrite_newer_failure() {
        let state = Arc::new(AgentRuntimeState::new());
        let old = state.begin_refresh();
        let old_entered = Arc::new(tokio::sync::Notify::new());
        let release_old = Arc::new(tokio::sync::Notify::new());
        let old_completion = {
            let state = Arc::clone(&state);
            let entered = Arc::clone(&old_entered);
            let release = Arc::clone(&release_old);
            tokio::spawn(async move {
                entered.notify_one();
                release.notified().await;
                state
                    .commit_refresh(
                        old,
                        "old-key",
                        candidate(true, "old-success", "old-key", old),
                    )
                    .await
            })
        };
        old_entered.notified().await;
        let new = state.begin_refresh();

        assert!(
            state
                .commit_refresh(
                    new,
                    "new-key",
                    candidate(false, "new-failure", "new-key", new)
                )
                .await
        );
        release_old.notify_one();
        assert!(!old_completion.await.unwrap());
        let installed = state.backend.read().await;
        assert!(!installed.report.available);
        assert_eq!(installed.reason(), Some("new-failure"));
        assert_eq!(installed.generation, new);
    }

    #[tokio::test]
    async fn execute_observes_report_and_resolver_from_one_generation() {
        let state = AgentRuntimeState::new();
        let generation = state.begin_refresh();
        state
            .commit_refresh(
                generation,
                "atomic-key",
                candidate(true, "atomic-resolver", "atomic-key", generation),
            )
            .await;
        let request = WorkerRequestV1 {
            protocol_version: 1,
            request_id: "atomic_snapshot".into(),
            action: protocol::Action::Parse,
            framework: Framework::Cirq,
            language: "python".into(),
            code: String::new(),
            shots: None,
        };

        assert_eq!(
            state.execute_request(request).await.unwrap_err(),
            "atomic-resolver"
        );
    }

    #[tokio::test]
    async fn changed_identity_cannot_reuse_the_cached_backend() {
        let state = AgentRuntimeState::new();
        let initial = state.begin_refresh();
        assert!(
            state
                .commit_refresh(
                    initial,
                    "original-tree",
                    candidate(true, "original", "original-tree", initial),
                )
                .await
        );
        let refresh = state.begin_refresh();

        assert!(state
            .reuse_if_identity_matches(refresh, "mutated-adapter")
            .await
            .is_none());
        assert_eq!(state.backend.read().await.generation, initial);
        assert!(
            state
                .commit_refresh(
                    refresh,
                    "mutated-adapter",
                    candidate(true, "requalified", "mutated-adapter", refresh),
                )
                .await
        );
        assert_eq!(
            state.backend.read().await.cache_key.as_deref(),
            Some("mutated-adapter")
        );
    }

    #[tokio::test]
    async fn stale_resolver_failure_cannot_clear_while_newer_refresh_is_pending() {
        let state = AgentRuntimeState::new();
        let installed = state.begin_refresh();
        assert!(
            state
                .commit_refresh(
                    installed,
                    "old-key",
                    candidate(true, "old-resolver", "old-key", installed),
                )
                .await
        );
        let newer = state.begin_refresh();

        state
            .clear_backend_if_current(installed, Some("old-key"), "stale resolver failure".into())
            .await;
        {
            let snapshot = state.backend.read().await.clone();
            assert!(snapshot.report.available);
            assert_eq!(snapshot.generation, installed);
            assert_eq!(
                snapshot
                    .resolver
                    .resolve(&test_request("pending-refresh"))
                    .await
                    .unwrap_err(),
                "old-resolver"
            );
        }

        assert!(
            state
                .commit_refresh(
                    newer,
                    "new-key",
                    candidate(true, "new-resolver", "new-key", newer),
                )
                .await
        );
        let snapshot = state.backend.read().await.clone();
        assert!(snapshot.report.available);
        assert_eq!(snapshot.generation, newer);
        assert_eq!(
            snapshot
                .resolver
                .resolve(&test_request("new-success"))
                .await
                .unwrap_err(),
            "new-resolver"
        );
    }

    #[tokio::test]
    async fn stale_resolver_failure_cannot_modify_newer_failure_pair() {
        let state = AgentRuntimeState::new();
        let installed = state.begin_refresh();
        assert!(
            state
                .commit_refresh(
                    installed,
                    "old-key",
                    candidate(true, "old-resolver", "old-key", installed),
                )
                .await
        );
        let newer = state.begin_refresh();
        assert!(
            state
                .commit_refresh(
                    newer,
                    "new-failure-key",
                    candidate(false, "new-refresh-failure", "new-failure-key", newer),
                )
                .await
        );

        state
            .clear_backend_if_current(installed, Some("old-key"), "stale resolver failure".into())
            .await;

        let snapshot = state.backend.read().await.clone();
        assert!(!snapshot.report.available);
        assert_eq!(snapshot.reason(), Some("new-refresh-failure"));
        assert_eq!(snapshot.generation, newer);
        assert_eq!(state.refresh_generation.load(Ordering::Acquire), newer);
        assert_eq!(
            snapshot
                .resolver
                .resolve(&test_request("new-failure"))
                .await
                .unwrap_err(),
            "new-refresh-failure"
        );
    }

    fn test_request(id: &str) -> WorkerRequestV1 {
        WorkerRequestV1 {
            protocol_version: 1,
            request_id: id.into(),
            action: protocol::Action::Parse,
            framework: Framework::Cirq,
            language: "python".into(),
            code: String::new(),
            shots: None,
        }
    }

    trait InstalledReason {
        fn reason(&self) -> Option<&str>;
    }

    impl InstalledReason for InstalledBackend {
        fn reason(&self) -> Option<&str> {
            self.report.reason.as_deref()
        }
    }
}
