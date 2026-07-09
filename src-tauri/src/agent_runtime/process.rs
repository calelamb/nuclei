use crate::agent_runtime::protocol::{WorkerRequestV1, WorkerResponseV1};
#[cfg(unix)]
use serde::Deserialize;
use std::collections::{BTreeMap, HashMap};
use std::future::Future;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[cfg(unix)]
const MAX_STDIN_BYTES: usize = 270_000;
#[cfg(unix)]
const ALLOWED_ENVIRONMENT: &[&str] = &[
    "HOME",
    "LANG",
    "LC_ALL",
    "PATH",
    "PYTHONHASHSEED",
    "PYTHONNOUSERSITE",
    "PYTHONDONTWRITEBYTECODE",
    "QDK_PYTHON_TELEMETRY",
    "OPENBLAS_NUM_THREADS",
    "OMP_NUM_THREADS",
    "MKL_NUM_THREADS",
    "NUMEXPR_NUM_THREADS",
];

#[derive(Clone, Debug)]
pub struct ProcessSpec {
    pub executable: PathBuf,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub env: BTreeMap<String, String>,
}

#[derive(Clone, Debug)]
pub struct SupervisorLimits {
    pub wall: Duration,
    pub stdout_bytes: usize,
    pub stderr_bytes: usize,
}

impl SupervisorLimits {
    pub fn production() -> Self {
        Self {
            wall: Duration::from_secs(15),
            stdout_bytes: 1_048_576,
            stderr_bytes: 65_536,
        }
    }

    pub fn testing() -> Self {
        Self {
            wall: Duration::from_millis(100),
            stdout_bytes: 1_024,
            stderr_bytes: 1_024,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RuntimeError {
    pub code: String,
    pub message: String,
}

impl RuntimeError {
    fn new(code: &'static str, message: &'static str) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

struct RunToken {
    deadline: tokio::time::Instant,
    state: Mutex<TokenState>,
    cancellation: tokio::sync::Notify,
    completion: tokio::sync::Notify,
}

#[derive(Default)]
struct TokenState {
    cancel_requested: bool,
    completed: bool,
    launch_started: bool,
}

impl RunToken {
    fn state(&self) -> std::sync::MutexGuard<'_, TokenState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn request_cancel(&self) -> bool {
        let mut state = self.state();
        if state.completed {
            return false;
        }
        state.cancel_requested = true;
        drop(state);
        self.cancellation.notify_one();
        true
    }

    fn is_cancelled(&self) -> bool {
        self.state().cancel_requested
    }

    fn is_completed(&self) -> bool {
        self.state().completed
    }

    fn begin_launch(&self) -> bool {
        let mut state = self.state();
        if state.cancel_requested || state.completed {
            return false;
        }
        state.launch_started = true;
        true
    }
}

pub struct RunReservation {
    request_id: String,
    registry: Arc<Mutex<HashMap<String, Arc<RunToken>>>>,
    token: Arc<RunToken>,
}

impl RunReservation {
    pub fn request_id(&self) -> &str {
        &self.request_id
    }

    pub fn is_cancelled(&self) -> bool {
        self.token.is_cancelled()
    }

    pub async fn cancelled(&self) {
        loop {
            if self.is_cancelled() {
                return;
            }
            let notified = self.token.cancellation.notified();
            if self.is_cancelled() {
                return;
            }
            notified.await;
        }
    }

    pub fn begin_launch(&self) -> bool {
        self.token.begin_launch()
    }

    pub fn deadline(&self) -> tokio::time::Instant {
        self.token.deadline
    }

    #[cfg(unix)]
    fn token(&self) -> &Arc<RunToken> {
        &self.token
    }

    fn complete(&self) -> bool {
        let mut registry = self
            .registry
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut state = self.token.state();
        if state.completed {
            return state.cancel_requested;
        }
        state.completed = true;
        let cancelled = state.cancel_requested;
        if registry
            .get(&self.request_id)
            .is_some_and(|registered| Arc::ptr_eq(registered, &self.token))
        {
            registry.remove(&self.request_id);
        }
        drop(state);
        drop(registry);
        self.token.completion.notify_waiters();
        cancelled
    }
}

impl Drop for RunReservation {
    fn drop(&mut self) {
        let _ = self.complete();
    }
}

pub struct Supervisor {
    limits: SupervisorLimits,
    active: Arc<Mutex<HashMap<String, Arc<RunToken>>>>,
    background_reaps: Arc<AtomicUsize>,
}

impl Supervisor {
    pub fn new(limits: SupervisorLimits) -> Self {
        Self {
            limits,
            active: Arc::new(Mutex::new(HashMap::new())),
            background_reaps: Arc::new(AtomicUsize::new(0)),
        }
    }

    fn active(&self) -> std::sync::MutexGuard<'_, HashMap<String, Arc<RunToken>>> {
        self.active
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    #[cfg(unix)]
    fn validate_spec(spec: &ProcessSpec) -> Result<(), RuntimeError> {
        if !spec.executable.is_absolute()
            || !spec.cwd.is_absolute()
            || !spec.cwd.is_dir()
            || spec
                .env
                .keys()
                .any(|name| !ALLOWED_ENVIRONMENT.contains(&name.as_str()))
        {
            return Err(RuntimeError::new(
                "invalid_process_spec",
                "Worker process specification is invalid",
            ));
        }
        Ok(())
    }

    pub fn active_count(&self) -> usize {
        self.active().len()
    }

    pub fn background_reap_count(&self) -> usize {
        self.background_reaps.load(Ordering::Acquire)
    }

    pub fn reserve(&self, request_id: &str) -> Result<RunReservation, RuntimeError> {
        let mut entries = self.active();
        if entries.contains_key(request_id) {
            return Err(RuntimeError::new(
                "duplicate_request",
                "Worker request ID is already active",
            ));
        }
        let token = Arc::new(RunToken {
            deadline: tokio::time::Instant::now() + self.limits.wall,
            state: Mutex::new(TokenState::default()),
            cancellation: tokio::sync::Notify::new(),
            completion: tokio::sync::Notify::new(),
        });
        entries.insert(request_id.into(), Arc::clone(&token));
        Ok(RunReservation {
            request_id: request_id.into(),
            registry: Arc::clone(&self.active),
            token,
        })
    }

    pub fn is_cancelled(&self, request_id: &str) -> bool {
        self.active()
            .get(request_id)
            .is_some_and(|token| token.is_cancelled())
    }

    pub fn run_reserved<'a>(
        &'a self,
        request: &'a WorkerRequestV1,
        spec: ProcessSpec,
        stdin: &'a [u8],
        reservation: RunReservation,
    ) -> impl Future<Output = Result<WorkerResponseV1, RuntimeError>> + Send + 'a {
        async move {
            #[cfg(unix)]
            {
                self.run_unix(request, spec, stdin, reservation).await
            }
            #[cfg(not(unix))]
            {
                self.run_unsupported(request, spec, stdin, reservation)
                    .await
            }
        }
    }

    pub(crate) fn cancel_all_now(&self) {
        let active = self.active();
        for token in active.values() {
            token.request_cancel();
        }
    }

    #[cfg(unix)]
    async fn run_unix(
        &self,
        request: &WorkerRequestV1,
        spec: ProcessSpec,
        stdin: &[u8],
        reservation: RunReservation,
    ) -> Result<WorkerResponseV1, RuntimeError> {
        use std::process::Stdio;
        use tokio::io::AsyncWriteExt;

        Self::validate_spec(&spec)?;
        if stdin.len() > MAX_STDIN_BYTES {
            return Err(RuntimeError::new(
                "request_too_large",
                "Worker request exceeded the byte limit",
            ));
        }

        if reservation.request_id() != request.request_id {
            return Err(RuntimeError::new(
                "invalid_reservation",
                "Worker reservation does not match the request",
            ));
        }
        if reservation.is_cancelled() {
            return Err(RuntimeError::new(
                "cancelled",
                "Worker request was cancelled",
            ));
        }
        let deadline = reservation.deadline();
        if tokio::time::Instant::now() >= deadline {
            return Err(RuntimeError::new(
                "wall_timeout",
                "Worker exceeded the wall-clock limit",
            ));
        }
        let token = Arc::clone(reservation.token());

        let mut command = tokio::process::Command::new(&spec.executable);
        command
            .args(&spec.args)
            .current_dir(&spec.cwd)
            .env_clear()
            .envs(&spec.env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        unsafe {
            command.pre_exec(|| {
                if libc::setsid() == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        if !reservation.begin_launch() {
            return Err(RuntimeError::new(
                "cancelled",
                "Worker request was cancelled",
            ));
        }
        // No registry lock is held while the platform performs spawn.
        let child = command.spawn().map_err(|_| {
            RuntimeError::new("worker_start_failed", "Worker process could not be started")
        })?;

        let mut guard = RunGuard::new(reservation, child, Arc::clone(&self.background_reaps));
        let child_stdin = guard.child_mut().stdin.take().expect("piped worker stdin");
        let stdout = guard
            .child_mut()
            .stdout
            .take()
            .expect("piped worker stdout");
        let stderr = guard
            .child_mut()
            .stderr
            .take()
            .expect("piped worker stderr");
        let input = stdin.to_vec();
        let stdin_task = tokio::spawn(async move {
            let mut child_stdin = child_stdin;
            child_stdin.write_all(&input).await?;
            child_stdin.shutdown().await
        });
        let (overflow_tx, mut overflow_rx) = tokio::sync::mpsc::unbounded_channel();
        let stdout_task = tokio::spawn(read_capped(
            stdout,
            self.limits.stdout_bytes,
            overflow_tx.clone(),
            StreamOverflow::Stdout,
        ));
        let stderr_task = tokio::spawn(read_capped(
            stderr,
            self.limits.stderr_bytes,
            overflow_tx.clone(),
            StreamOverflow::Stderr,
        ));
        drop(overflow_tx);
        guard.track(&stdin_task);
        guard.track(&stdout_task);
        guard.track(&stderr_task);

        let io = async move { tokio::join!(stdin_task, stdout_task, stderr_task) };
        tokio::pin!(io);
        let mut overflow = None;
        let io_results = if token.is_cancelled() {
            guard.kill_group();
            tokio::time::timeout_at(deadline, &mut io).await
        } else {
            tokio::select! {
                results = &mut io => Ok(results),
                _ = token.cancellation.notified() => {
                    guard.kill_group();
                    tokio::time::timeout_at(deadline, &mut io).await
                },
                Some(stream) = overflow_rx.recv() => {
                    overflow = Some(stream);
                    guard.kill_group();
                    tokio::time::timeout_at(deadline, &mut io).await
                },
                _ = tokio::time::sleep_until(deadline) => {
                    guard.kill_group();
                    guard.abort_tasks();
                    return Err(RuntimeError::new(
                        "wall_timeout",
                        "Worker exceeded the wall-clock limit",
                    ));
                }
            }
        };

        let io_results = match io_results {
            Ok(results) => results,
            Err(_) => {
                guard.kill_group();
                guard.abort_tasks();
                return Err(RuntimeError::new(
                    "wall_timeout",
                    "Worker exceeded the wall-clock limit",
                ));
            }
        };

        // EOF is consumed before wait(), so an exited leader remains unreaped
        // and its process-group ID cannot be reused. Killing now also clears
        // same-group descendants that closed inherited stdio. This is lifecycle
        // cleanup only; platform sandboxes/cgroups provide containment.
        guard.kill_group();
        let status = match tokio::time::timeout_at(deadline, guard.child_mut().wait()).await {
            Ok(Ok(status)) => {
                guard.mark_reaped();
                status
            }
            Ok(Err(_)) => {
                return Err(RuntimeError::new(
                    "worker_wait_failed",
                    "Worker process could not be reaped",
                ));
            }
            Err(_) => {
                guard.abort_tasks();
                return Err(RuntimeError::new(
                    "cleanup_timeout",
                    "Worker cleanup exceeded the wall-clock limit",
                ));
            }
        };
        let cancelled = guard.complete();

        let (stdin_result, stdout_result, stderr_result) = io_results;
        let stdout_capture = stdout_result.map_err(|_| {
            RuntimeError::new("worker_io_failed", "Worker output could not be read")
        })??;
        let stderr_capture = stderr_result.map_err(|_| {
            RuntimeError::new("worker_io_failed", "Worker output could not be read")
        })??;

        if cancelled {
            return Err(RuntimeError::new(
                "cancelled",
                "Worker request was cancelled",
            ));
        }
        if matches!(overflow, Some(StreamOverflow::Stdout)) {
            return Err(RuntimeError::new(
                "response_too_large",
                "Worker response exceeded the byte limit",
            ));
        }
        if matches!(overflow, Some(StreamOverflow::Stderr)) {
            return Err(RuntimeError::new(
                "stderr_too_large",
                "Worker diagnostics exceeded the byte limit",
            ));
        }
        if stdout_capture.overflow {
            return Err(RuntimeError::new(
                "response_too_large",
                "Worker response exceeded the byte limit",
            ));
        }
        if !status.success() {
            return Err(RuntimeError::new(
                "worker_failed",
                "Worker process exited unsuccessfully",
            ));
        }
        if stderr_capture.overflow {
            return Err(RuntimeError::new(
                "stderr_too_large",
                "Worker diagnostics exceeded the byte limit",
            ));
        }
        if !matches!(stdin_result, Ok(Ok(()))) {
            return Err(RuntimeError::new(
                "stdin_failed",
                "Worker request could not be written",
            ));
        }

        parse_response(&stdout_capture.bytes, request)
    }

    #[cfg(not(unix))]
    async fn run_unsupported(
        &self,
        _request: &WorkerRequestV1,
        _spec: ProcessSpec,
        _stdin: &[u8],
        reservation: RunReservation,
    ) -> Result<WorkerResponseV1, RuntimeError> {
        if reservation.is_cancelled() {
            return Err(RuntimeError::new(
                "cancelled",
                "Worker request was cancelled",
            ));
        }
        Err(RuntimeError::new(
            "isolation_unavailable",
            crate::agent_runtime::unsupported::UNAVAILABLE_MESSAGE,
        ))
    }
}

pub trait ProcessSupervisor {
    fn run<'a>(
        &'a self,
        request: &'a WorkerRequestV1,
        spec: ProcessSpec,
        stdin: &'a [u8],
    ) -> impl Future<Output = Result<WorkerResponseV1, RuntimeError>> + Send + 'a;

    fn cancel<'a>(
        &'a self,
        id: &'a str,
    ) -> impl Future<Output = Result<(), RuntimeError>> + Send + 'a;

    fn cancel_all(&self) -> impl Future<Output = ()> + Send + '_;
}

impl ProcessSupervisor for Supervisor {
    fn run<'a>(
        &'a self,
        request: &'a WorkerRequestV1,
        spec: ProcessSpec,
        stdin: &'a [u8],
    ) -> impl Future<Output = Result<WorkerResponseV1, RuntimeError>> + Send + 'a {
        let reservation = self.reserve(&request.request_id);
        async move {
            let reservation = reservation?;
            self.run_reserved(request, spec, stdin, reservation).await
        }
    }

    fn cancel<'a>(
        &'a self,
        id: &'a str,
    ) -> impl Future<Output = Result<(), RuntimeError>> + Send + 'a {
        let token = self.active().get(id).cloned();
        let should_wait = token.as_ref().is_some_and(|token| token.request_cancel());
        async move {
            let Some(token) = token else {
                return Ok(());
            };
            if !should_wait || wait_for_completion(&token).await {
                Ok(())
            } else {
                Err(RuntimeError::new(
                    "cleanup_timeout",
                    "Worker cleanup exceeded the wall-clock limit",
                ))
            }
        }
    }

    async fn cancel_all(&self) {
        let tokens = {
            let active = self.active();
            active.values().cloned().collect::<Vec<_>>()
        };
        for token in &tokens {
            token.request_cancel();
        }
        for token in tokens {
            let _ = wait_for_completion(&token).await;
        }
    }
}

#[cfg(unix)]
struct RunGuard {
    reservation: RunReservation,
    child: Option<tokio::process::Child>,
    process_group: i32,
    leader_reaped: bool,
    tasks: Vec<tokio::task::AbortHandle>,
    background_reaps: Arc<AtomicUsize>,
}

#[cfg(unix)]
impl RunGuard {
    fn new(
        reservation: RunReservation,
        child: tokio::process::Child,
        background_reaps: Arc<AtomicUsize>,
    ) -> Self {
        let process_group = child.id().expect("spawned child has an ID") as i32;
        Self {
            reservation,
            child: Some(child),
            process_group,
            leader_reaped: false,
            tasks: Vec::new(),
            background_reaps,
        }
    }

    fn child_mut(&mut self) -> &mut tokio::process::Child {
        self.child.as_mut().expect("run guard owns child")
    }

    fn track<T>(&mut self, task: &tokio::task::JoinHandle<T>) {
        self.tasks.push(task.abort_handle());
    }

    fn abort_tasks(&self) {
        for task in &self.tasks {
            task.abort();
        }
    }

    fn kill_group(&self) {
        if !self.leader_reaped {
            // Lifecycle handle only. Platform sandboxes/cgroups are
            // authoritative for descendant containment.
            unsafe {
                libc::kill(-self.process_group, libc::SIGKILL);
            }
        }
    }

    fn mark_reaped(&mut self) {
        self.leader_reaped = true;
    }

    fn complete(&self) -> bool {
        self.reservation.complete()
    }
}

#[cfg(unix)]
impl Drop for RunGuard {
    fn drop(&mut self) {
        self.abort_tasks();
        if !self.leader_reaped {
            self.kill_group();
            if let Some(child) = self.child.as_mut() {
                let _ = child.start_kill();
            }
            if let Some(mut child) = self.child.take() {
                if let Ok(runtime) = tokio::runtime::Handle::try_current() {
                    self.background_reaps.fetch_add(1, Ordering::AcqRel);
                    let background_reaps = Arc::clone(&self.background_reaps);
                    runtime.spawn(async move {
                        let _ =
                            tokio::time::timeout(Duration::from_millis(250), child.wait()).await;
                        background_reaps.fetch_sub(1, Ordering::AcqRel);
                    });
                }
            }
        }
        let _ = self.complete();
    }
}

async fn wait_for_completion(token: &RunToken) -> bool {
    loop {
        if token.is_completed() {
            return true;
        }
        let notified = token.completion.notified();
        if token.is_completed() {
            return true;
        }
        if tokio::time::timeout_at(token.deadline, notified)
            .await
            .is_err()
        {
            return token.is_completed();
        }
    }
}

#[cfg(unix)]
struct Capture {
    bytes: Vec<u8>,
    overflow: bool,
}

#[cfg(unix)]
#[derive(Clone, Copy)]
enum StreamOverflow {
    Stdout,
    Stderr,
}

#[cfg(unix)]
async fn read_capped(
    mut reader: impl tokio::io::AsyncRead + Unpin,
    limit: usize,
    overflow_tx: tokio::sync::mpsc::UnboundedSender<StreamOverflow>,
    stream: StreamOverflow,
) -> Result<Capture, RuntimeError> {
    use tokio::io::AsyncReadExt;

    let mut bytes = Vec::with_capacity(limit.min(8_192));
    let mut overflow = false;
    let mut buffer = [0_u8; 8_192];
    loop {
        let read = reader.read(&mut buffer).await.map_err(|_| {
            RuntimeError::new("worker_io_failed", "Worker output could not be read")
        })?;
        if read == 0 {
            break;
        }
        let remaining = limit.saturating_add(1).saturating_sub(bytes.len());
        let retained = remaining.min(read);
        bytes.extend_from_slice(&buffer[..retained]);
        overflow |= read > retained || bytes.len() > limit;
        if overflow {
            let _ = overflow_tx.send(stream);
            break;
        }
    }
    Ok(Capture { bytes, overflow })
}

#[cfg(unix)]
fn parse_response(raw: &[u8], request: &WorkerRequestV1) -> Result<WorkerResponseV1, RuntimeError> {
    if raw.last() != Some(&b'\n') || raw.len() < 3 {
        return Err(malformed_response());
    }
    let body = &raw[..raw.len() - 1];
    if body.first() != Some(&b'{')
        || body.last() != Some(&b'}')
        || has_unquoted_whitespace(body)
        || std::str::from_utf8(body).is_err()
    {
        return Err(malformed_response());
    }

    let mut deserializer = serde_json::Deserializer::from_slice(body);
    let response =
        WorkerResponseV1::deserialize(&mut deserializer).map_err(|_| malformed_response())?;
    deserializer.end().map_err(|_| malformed_response())?;
    response
        .validate(request)
        .map_err(|_| malformed_response())?;
    Ok(response)
}

#[cfg(unix)]
fn has_unquoted_whitespace(bytes: &[u8]) -> bool {
    let mut quoted = false;
    let mut escaped = false;
    for byte in bytes {
        if quoted {
            if escaped {
                escaped = false;
            } else if *byte == b'\\' {
                escaped = true;
            } else if *byte == b'"' {
                quoted = false;
            }
        } else if *byte == b'"' {
            quoted = true;
        } else if byte.is_ascii_whitespace() {
            return true;
        }
    }
    false
}

#[cfg(unix)]
fn malformed_response() -> RuntimeError {
    RuntimeError::new("malformed_response", "Worker returned a malformed response")
}
