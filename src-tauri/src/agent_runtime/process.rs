use crate::agent_runtime::protocol::{WorkerRequestV1, WorkerResponseV1};
#[cfg(unix)]
use serde::Deserialize;
use std::collections::{BTreeMap, HashMap};
use std::future::Future;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
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

struct Active {
    #[cfg(unix)]
    pid: u32,
    #[cfg(unix)]
    process_group: i32,
    killable: AtomicBool,
    cancelled: AtomicBool,
    cancellation: tokio::sync::Notify,
}

pub struct Supervisor {
    #[cfg(unix)]
    limits: SupervisorLimits,
    active: Mutex<HashMap<String, Arc<Active>>>,
}

impl Supervisor {
    pub fn new(limits: SupervisorLimits) -> Self {
        #[cfg(not(unix))]
        let _ = limits;
        Self {
            #[cfg(unix)]
            limits,
            active: Mutex::new(HashMap::new()),
        }
    }

    fn active(&self) -> std::sync::MutexGuard<'_, HashMap<String, Arc<Active>>> {
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

    #[cfg(unix)]
    fn remove_active(&self, request_id: &str, active: &Arc<Active>) {
        let mut entries = self.active();
        if entries
            .get(request_id)
            .is_some_and(|registered| Arc::ptr_eq(registered, active))
        {
            entries.remove(request_id);
        }
    }

    #[cfg(unix)]
    fn mark_reaped(&self, request_id: &str, active: &Arc<Active>) -> bool {
        let entries = self.active();
        if entries
            .get(request_id)
            .is_some_and(|registered| Arc::ptr_eq(registered, active))
        {
            // cancel() takes this same mutex, preventing any later signal from
            // targeting a process-group ID after its leader has been reaped.
            active.killable.store(false, Ordering::Release);
        }
        active.cancelled.load(Ordering::Acquire)
    }

    pub(crate) fn cancel_all_now(&self) {
        let active = self.active();
        for process in active.values() {
            if process.killable.load(Ordering::Acquire) {
                process.cancelled.store(true, Ordering::Release);
                process.cancellation.notify_one();
            }
        }
    }

    #[cfg(unix)]
    async fn run_unix(
        &self,
        request: &WorkerRequestV1,
        spec: ProcessSpec,
        stdin: &[u8],
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

        let (mut child, active) = {
            let mut entries = self.active();
            if entries.contains_key(&request.request_id) {
                return Err(RuntimeError::new(
                    "duplicate_request",
                    "Worker request ID is already active",
                ));
            }

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

            let child = command.spawn().map_err(|_| {
                RuntimeError::new("worker_start_failed", "Worker process could not be started")
            })?;
            let pid = child.id().ok_or_else(|| {
                RuntimeError::new("worker_start_failed", "Worker process could not be started")
            })?;
            let active = Arc::new(Active {
                pid,
                process_group: pid as i32,
                killable: AtomicBool::new(true),
                cancelled: AtomicBool::new(false),
                cancellation: tokio::sync::Notify::new(),
            });
            entries.insert(request.request_id.clone(), Arc::clone(&active));
            (child, active)
        };

        let child_stdin = child.stdin.take().expect("piped worker stdin");
        let stdout = child.stdout.take().expect("piped worker stdout");
        let stderr = child.stderr.take().expect("piped worker stderr");
        let input = stdin.to_vec();
        let stdin_task = tokio::spawn(async move {
            let mut child_stdin = child_stdin;
            child_stdin.write_all(&input).await?;
            child_stdin.shutdown().await
        });
        let stdout_task = tokio::spawn(read_capped(stdout, self.limits.stdout_bytes));
        let stderr_task = tokio::spawn(read_capped(stderr, self.limits.stderr_bytes));

        let deadline = tokio::time::Instant::now() + self.limits.wall;
        enum Termination {
            Exited(std::process::ExitStatus),
            Cancelled,
            TimedOut,
            WaitFailed,
        }

        let mut termination = if active.cancelled.load(Ordering::Acquire) {
            kill_process_group(&active);
            match child.wait().await {
                Ok(_) => Termination::Cancelled,
                Err(_) => {
                    let _ = child.wait().await;
                    Termination::WaitFailed
                }
            }
        } else {
            tokio::select! {
                result = child.wait() => match result {
                    Ok(status) => Termination::Exited(status),
                    Err(_) => {
                        kill_process_group(&active);
                        let _ = child.wait().await;
                        Termination::WaitFailed
                    },
                },
                _ = active.cancellation.notified() => {
                    kill_process_group(&active);
                    match child.wait().await {
                        Ok(_) => Termination::Cancelled,
                        Err(_) => {
                            let _ = child.wait().await;
                            Termination::WaitFailed
                        },
                    }
                },
                _ = tokio::time::sleep_until(deadline) => {
                    kill_process_group(&active);
                    match child.wait().await {
                        Ok(_) => Termination::TimedOut,
                        Err(_) => {
                            let _ = child.wait().await;
                            Termination::WaitFailed
                        },
                    }
                }
            }
        };

        let cancelled_before_reap = self.mark_reaped(&request.request_id, &active);
        let io = async move { tokio::join!(stdin_task, stdout_task, stderr_task) };
        tokio::pin!(io);
        let io_results = if matches!(
            termination,
            Termination::Cancelled | Termination::TimedOut | Termination::WaitFailed
        ) {
            io.await
        } else {
            tokio::select! {
                results = &mut io => results,
                _ = tokio::time::sleep_until(deadline) => {
                    // If I/O remains open after the leader exits, a descendant
                    // still owns a pipe and therefore still owns this pgid.
                    kill_process_group(&active);
                    termination = Termination::TimedOut;
                    io.await
                }
            }
        };

        self.remove_active(&request.request_id, &active);

        let (stdin_result, stdout_result, stderr_result) = io_results;
        let stdout_capture = stdout_result.map_err(|_| {
            RuntimeError::new("worker_io_failed", "Worker output could not be read")
        })??;
        let stderr_capture = stderr_result.map_err(|_| {
            RuntimeError::new("worker_io_failed", "Worker output could not be read")
        })??;

        if cancelled_before_reap || matches!(termination, Termination::Cancelled) {
            return Err(RuntimeError::new(
                "cancelled",
                "Worker request was cancelled",
            ));
        }
        if matches!(termination, Termination::TimedOut) {
            return Err(RuntimeError::new(
                "wall_timeout",
                "Worker exceeded the wall-clock limit",
            ));
        }
        if matches!(termination, Termination::WaitFailed) {
            return Err(RuntimeError::new(
                "worker_wait_failed",
                "Worker process could not be reaped",
            ));
        }
        if stdout_capture.overflow {
            return Err(RuntimeError::new(
                "response_too_large",
                "Worker response exceeded the byte limit",
            ));
        }
        let Termination::Exited(status) = termination else {
            unreachable!()
        };
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
    ) -> Result<WorkerResponseV1, RuntimeError> {
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
    async fn run<'a>(
        &'a self,
        request: &'a WorkerRequestV1,
        spec: ProcessSpec,
        stdin: &'a [u8],
    ) -> Result<WorkerResponseV1, RuntimeError> {
        #[cfg(unix)]
        {
            self.run_unix(request, spec, stdin).await
        }
        #[cfg(not(unix))]
        {
            self.run_unsupported(request, spec, stdin).await
        }
    }

    async fn cancel<'a>(&'a self, id: &'a str) -> Result<(), RuntimeError> {
        let active = self.active();
        if let Some(active) = active.get(id) {
            if active.killable.load(Ordering::Acquire) {
                active.cancelled.store(true, Ordering::Release);
                active.cancellation.notify_one();
            }
        }
        Ok(())
    }

    async fn cancel_all(&self) {
        self.cancel_all_now();
    }
}

#[cfg(unix)]
fn kill_process_group(active: &Active) {
    // This group is a lifecycle handle only. Platform sandboxes/cgroups are
    // authoritative for descendant containment.
    debug_assert_eq!(active.pid as i32, active.process_group);
    unsafe {
        libc::kill(-active.process_group, libc::SIGKILL);
    }
}

#[cfg(unix)]
struct Capture {
    bytes: Vec<u8>,
    overflow: bool,
}

#[cfg(unix)]
async fn read_capped(
    mut reader: impl tokio::io::AsyncRead + Unpin,
    limit: usize,
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
