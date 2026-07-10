//! Execution supervisor: run one agent request inside the disposable Python
//! worker (`kernel/agent_worker.py`), isolated in its own process group, with a
//! hard wall-clock timeout that kills the whole group.
//!
//! This is a synchronous std port of `run_agent_worker` in `kernel/server.py`:
//! spawn the worker in a new session/process group, feed it the request on
//! stdin, read a bounded response from stdout, and on timeout SIGKILL the whole
//! group (reaping any children a runaway request spawned). Quantum work stays
//! in Python; Rust only supervises the boundary.

use std::io::{Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use crate::dirac::types::{AgentExecuteRequest, AgentExecuteResponse};

/// Maximum bytes read from the worker's stdout. Matches the worker's own
/// `MAX_RESPONSE_BYTES` (`kernel/agent_worker.py`); the reader stops here.
pub const MAX_WORKER_OUTPUT: usize = 1_048_576;

/// Wall-clock budget for one worker run. Larger than the worker's in-process
/// CPU limit so this catches genuine wall hangs (mirrors
/// `_AGENT_WORKER_WALL_SECONDS` in `kernel/server.py`).
pub const DEFAULT_WALL: Duration = Duration::from_secs(25);

/// Failure modes of a supervised worker run. Every IO error is mapped here so
/// the supervisor never panics.
#[derive(Debug)]
pub enum WorkerError {
    /// The worker process could not be spawned.
    Spawn(String),
    /// The worker exceeded its wall-clock budget and was killed.
    Timeout,
    /// An IO error occurred while supervising the worker.
    Io(String),
}

impl std::fmt::Display for WorkerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WorkerError::Spawn(msg) => write!(f, "failed to spawn worker: {msg}"),
            WorkerError::Timeout => write!(f, "worker exceeded its time budget"),
            WorkerError::Io(msg) => write!(f, "worker io error: {msg}"),
        }
    }
}

impl std::error::Error for WorkerError {}

/// Put the child in a new session/process group so a timeout can reap its whole
/// subtree (the worker no longer sets `RLIMIT_NPROC`, so fork-bomb containment
/// relies on group kill — see `kernel/agent_limits.py`).
#[cfg(unix)]
fn configure_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    // SAFETY: `pre_exec` runs in the forked child before `exec`. `setsid` is
    // async-signal-safe, allocates nothing, and touches no shared state. It
    // only moves the child into a new session/process group; on failure we
    // surface the OS error so the spawn fails cleanly.
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
}

#[cfg(windows)]
fn configure_process_group(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    // CREATE_NEW_PROCESS_GROUP: the child becomes the root of a new process
    // group so `taskkill /T` can reap the whole tree on timeout.
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    command.creation_flags(CREATE_NEW_PROCESS_GROUP);
}

/// SIGKILL the worker's whole process group. The child is the group leader
/// (via `setsid`), so its pgid equals its pid.
#[cfg(unix)]
fn kill_process_group(child_id: u32) {
    // SAFETY: `killpg` sends a signal to a process group by id and dereferences
    // no memory. `child_id` is the pid of a group leader, so it is also the
    // pgid. A stale/absent group simply yields ESRCH, which we ignore.
    unsafe {
        libc::killpg(child_id as libc::pid_t, libc::SIGKILL);
    }
}

/// Best-effort tree kill on Windows.
#[cfg(windows)]
fn kill_process_group(child_id: u32) {
    let _ = Command::new("taskkill")
        .args(["/T", "/F", "/PID", &child_id.to_string()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

/// Supervise one fully-configured worker `command` (program/args/cwd already
/// set). This function owns stdin/stdout wiring, the reader/writer threads, and
/// the wall-clock timeout with process-group kill. Injectable for tests via a
/// fake worker command. Never panics.
pub fn run_worker_command(
    mut command: Command,
    request_json: &[u8],
    wall: Duration,
    max_output: usize,
) -> Result<Vec<u8>, WorkerError> {
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    configure_process_group(&mut command);

    let mut child = command
        .spawn()
        .map_err(|e| WorkerError::Spawn(e.to_string()))?;

    // The child is a group leader, so its pid is also its pgid. Capture it now,
    // before `child` is moved into the wait thread.
    let child_id = child.id();

    // Writer thread: feed the request, then drop stdin to signal EOF.
    let stdin = child.stdin.take();
    let payload = request_json.to_vec();
    let writer = thread::spawn(move || {
        if let Some(mut stdin) = stdin {
            let _ = stdin.write_all(&payload);
            let _ = stdin.flush();
            // `stdin` is dropped here -> the worker sees EOF on its input.
        }
    });

    // Reader thread: read stdout up to `max_output` bytes, then stop.
    let stdout = child.stdout.take();
    let reader = thread::spawn(move || -> Vec<u8> {
        let mut buf: Vec<u8> = Vec::new();
        if let Some(mut stdout) = stdout {
            let mut chunk = [0u8; 8192];
            loop {
                match stdout.read(&mut chunk) {
                    Ok(0) => break,
                    Ok(n) => {
                        let remaining = max_output.saturating_sub(buf.len());
                        if remaining == 0 {
                            break;
                        }
                        let take = n.min(remaining);
                        buf.extend_from_slice(&chunk[..take]);
                        if buf.len() >= max_output {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        }
        buf
    });

    // Wait thread + `recv_timeout` implements the wall-clock budget.
    let (tx, rx) = mpsc::channel();
    let waiter = thread::spawn(move || {
        let _ = child.wait();
        let _ = tx.send(());
        // `child` is dropped here, after it has been reaped.
    });

    let timed_out = match rx.recv_timeout(wall) {
        Ok(()) => false,
        Err(mpsc::RecvTimeoutError::Timeout) => {
            // Kill the whole group, then wait for the waiter to reap the child
            // (unblocks the reader as the stdout pipe closes).
            kill_process_group(child_id);
            let _ = rx.recv();
            true
        }
        // Waiter ended without signaling (should not happen: `wait` doesn't
        // panic). Treat as a normal completion rather than a hang.
        Err(mpsc::RecvTimeoutError::Disconnected) => false,
    };

    let _ = waiter.join();
    let _ = writer.join();
    let output = reader
        .join()
        .map_err(|_| WorkerError::Io("reader thread panicked".to_string()))?;

    if timed_out {
        return Err(WorkerError::Timeout);
    }
    Ok(output)
}

/// Run one agent request against `python -I <worker_script>` in `cwd`,
/// returning a structured response. Maps every supervisor failure to a
/// synthesized error response — this function never returns `Err`.
pub fn run_agent_request(
    python: &Path,
    worker_script: &Path,
    cwd: &Path,
    request: &AgentExecuteRequest,
    wall: Duration,
) -> AgentExecuteResponse {
    let request_id = request.request_id.clone();

    let request_json = match serde_json::to_vec(request) {
        Ok(bytes) => bytes,
        Err(e) => {
            return AgentExecuteResponse::error(
                request_id,
                "worker_bad_request",
                &format!("Failed to serialize request: {e}"),
            );
        }
    };

    // `-I` isolates the interpreter (no site, no env, ignore PYTHON*).
    let mut command = Command::new(python);
    command.arg("-I").arg(worker_script).current_dir(cwd);

    let output = match run_worker_command(command, &request_json, wall, MAX_WORKER_OUTPUT) {
        Ok(bytes) => bytes,
        Err(WorkerError::Spawn(msg)) => {
            return AgentExecuteResponse::error(request_id, "worker_spawn_failed", &msg);
        }
        Err(WorkerError::Timeout) => {
            return AgentExecuteResponse::error(
                request_id,
                "worker_timeout",
                "Agent worker exceeded its time budget.",
            );
        }
        Err(WorkerError::Io(msg)) => {
            return AgentExecuteResponse::error(request_id, "worker_io_failed", &msg);
        }
    };

    if output.is_empty() {
        return AgentExecuteResponse::error(
            request_id,
            "worker_no_output",
            "Agent worker produced no response.",
        );
    }

    let value: serde_json::Value = match serde_json::from_slice(&output) {
        Ok(v) => v,
        Err(_) => {
            return AgentExecuteResponse::error(
                request_id,
                "worker_bad_output",
                "Agent worker response was not valid JSON.",
            );
        }
    };
    if !value.is_object() {
        return AgentExecuteResponse::error(
            request_id,
            "worker_bad_output",
            "Agent worker response was not an object.",
        );
    }

    match serde_json::from_value::<AgentExecuteResponse>(value) {
        Ok(response) => response,
        Err(e) => AgentExecuteResponse::error(
            request_id,
            "worker_bad_output",
            &format!("Agent worker response did not match the protocol schema: {e}"),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    fn sample_request() -> AgentExecuteRequest {
        AgentExecuteRequest {
            protocol_version: 1,
            request_id: "req-1".to_string(),
            action: "parse".to_string(),
            framework: "qiskit".to_string(),
            language: "python".to_string(),
            code: "from qiskit import QuantumCircuit".to_string(),
            shots: None,
            basis_gates: None,
            coupling_map: None,
            optimization_level: None,
        }
    }

    #[test]
    fn parse_request_serializes_without_optional_fields() {
        let json = serde_json::to_value(sample_request()).expect("serialize");
        let obj = json.as_object().expect("object");

        // Transpile/simulate-only fields must not appear on a parse request.
        assert!(!obj.contains_key("shots"));
        assert!(!obj.contains_key("basis_gates"));
        assert!(!obj.contains_key("coupling_map"));
        assert!(!obj.contains_key("optimization_level"));

        // Required fields are still present.
        assert!(obj.contains_key("protocol_version"));
        assert!(obj.contains_key("request_id"));
        assert!(obj.contains_key("action"));
        assert!(obj.contains_key("framework"));
        assert!(obj.contains_key("language"));
        assert!(obj.contains_key("code"));
    }

    #[cfg(unix)]
    #[test]
    fn worker_echoes_canned_response() {
        // Fake worker: drain stdin, then print a valid protocol response.
        let mut command = Command::new("sh");
        command.arg("-c").arg(
            r#"cat >/dev/null; printf '%s' '{"protocol_version":1,"request_id":"x","status":"ok","snapshot":null,"result":null,"stdout":"","stderr":"","error":null}'"#,
        );

        let bytes = run_worker_command(command, b"{}", DEFAULT_WALL, MAX_WORKER_OUTPUT)
            .expect("worker should succeed");
        let response: AgentExecuteResponse =
            serde_json::from_slice(&bytes).expect("response parses");
        assert_eq!(response.status, "ok");
        assert_eq!(response.request_id, "x");
    }

    #[cfg(unix)]
    #[test]
    fn worker_times_out_and_group_is_killed() {
        // A worker that hangs far past the wall budget.
        let mut command = Command::new("sh");
        command.arg("-c").arg("sleep 30");

        let start = Instant::now();
        let result = run_worker_command(
            command,
            b"{}",
            Duration::from_millis(400),
            MAX_WORKER_OUTPUT,
        );
        let elapsed = start.elapsed();

        assert!(
            matches!(result, Err(WorkerError::Timeout)),
            "expected Timeout, got {result:?}"
        );
        // The whole group was killed, not merely abandoned: we returned in well
        // under the 30s sleep.
        assert!(
            elapsed < Duration::from_secs(5),
            "supervisor did not kill promptly: {elapsed:?}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn worker_output_capped_at_max() {
        // Print 4000 bytes (well within a pipe buffer, so the child exits) but
        // cap the reader at 100 bytes.
        let mut command = Command::new("sh");
        command
            .arg("-c")
            .arg("cat >/dev/null; printf 'a%.0s' $(seq 1 4000)");

        let cap = 100;
        let bytes = run_worker_command(command, b"{}", DEFAULT_WALL, cap).expect("worker ok");
        assert!(bytes.len() <= cap, "reader exceeded cap: {}", bytes.len());
    }

    #[cfg(unix)]
    #[test]
    fn run_agent_request_rejects_non_json_output() {
        // Fake interpreter that ignores its args and prints non-JSON.
        let python = write_fake_interpreter("#!/bin/sh\nprintf 'not json at all'\n");
        let cwd = std::env::temp_dir();
        let response = run_agent_request(&python, &python, &cwd, &sample_request(), DEFAULT_WALL);
        let _ = std::fs::remove_file(&python);

        assert_eq!(response.status, "error");
        assert_eq!(response.error["code"], "worker_bad_output");
    }

    #[cfg(unix)]
    fn write_fake_interpreter(body: &str) -> std::path::PathBuf {
        use std::os::unix::fs::PermissionsExt;
        use std::sync::atomic::{AtomicU32, Ordering};

        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let unique = format!(
            "dirac_fake_py_{}_{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        );
        let path = std::env::temp_dir().join(unique);
        std::fs::write(&path, body).expect("write fake interpreter");
        let mut perms = std::fs::metadata(&path)
            .expect("stat fake interpreter")
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&path, perms).expect("chmod fake interpreter");
        path
    }
}
