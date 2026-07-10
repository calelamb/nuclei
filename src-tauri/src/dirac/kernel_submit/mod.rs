//! Live hardware-submission transport (Stage R7).
//!
//! [`KernelSubmitPort`] is the real [`SubmitPort`] implementation: it reaches
//! the running Python kernel over its WebSocket (`ws://localhost:9742`) and
//! drives the hardware protocol documented in `kernel/server.py`. It reaches
//! parity with the TS `SocketSubmitPort` — starting with the free, always-on
//! `simulator` provider — so the Rust agent can actually submit jobs.
//!
//! This port is ONLY the plumbing. The policy gate + budget ledger in
//! [`crate::dirac::tool_exec`] decide whether a submission is allowed; a real
//! QPU still needs the off-by-default real-money flag. This module does not
//! (and must not) weaken that.
//!
//! Every call opens a short-lived blocking connection, sends one request, and
//! reads text frames until the correlated response arrives (ignoring unrelated
//! frames). The underlying `TcpStream` carries hard connect/read/write
//! timeouts, so a stalled or missing kernel surfaces as an error outcome — it
//! can NEVER hang the run thread and NEVER panics. The pure protocol mapping
//! lives in [`parse`] and is unit-tested with no live socket.

mod parse;
#[cfg(test)]
mod tests;

use std::net::{TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tungstenite::{Message, WebSocket};

use super::analysis::BackendInfo;
use super::submit::{JobResultsOutcome, JobStatus, SubmitOutcome, SubmitPort, SubmitRequest};
use parse::{
    job_id_matches, parse_backends, parse_cancel_response, parse_results_response,
    parse_status_response, parse_submit_response, type_is,
};

/// Canonical kernel endpoint. The app kills port squatters so the kernel owns
/// this port; the `simulator` provider is auto-connected.
const DEFAULT_URL: &str = "ws://localhost:9742";

/// Per-call ceiling for connect + handshake + response read. Generous enough
/// for a simulator round-trip, small enough that a dead kernel fails fast.
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);

/// Live [`SubmitPort`] backed by the local kernel WebSocket.
#[derive(Debug, Clone)]
pub struct KernelSubmitPort {
    url: String,
    timeout: Duration,
}

impl Default for KernelSubmitPort {
    fn default() -> Self {
        Self {
            url: DEFAULT_URL.to_string(),
            timeout: DEFAULT_TIMEOUT,
        }
    }
}

impl KernelSubmitPort {
    /// Construct with an explicit endpoint/timeout (used by tests and any
    /// non-default deployment).
    pub fn new(url: impl Into<String>, timeout: Duration) -> Self {
        Self {
            url: url.into(),
            timeout,
        }
    }

    /// List the backends the kernel currently knows about (simulator provider).
    /// Returns `[]` on any transport failure — a missing kernel must not break
    /// backend resolution, only leave it empty. Used to wire `get_backends` so
    /// the submit tool can resolve a backend's provider / `is_simulator`.
    pub fn list_backends(&self) -> Vec<BackendInfo> {
        let request = json!({ "type": "hardware_list_backends", "provider": "simulator" });
        match self.roundtrip(&request, |v| type_is(v, "hardware_backends")) {
            Ok(resp) => parse_backends(&resp),
            Err(_) => Vec::new(),
        }
    }

    /// Open a fresh, hard-bounded blocking connection to the kernel.
    ///
    /// The TCP connect is bounded by [`TcpStream::connect_timeout`]; read and
    /// write timeouts are set BEFORE the WS handshake, so even the handshake
    /// cannot block indefinitely. Plain `ws://` (no TLS) — the kernel is
    /// localhost.
    fn open(&self) -> Result<WebSocket<TcpStream>, String> {
        let (host, port) = parse::parse_authority(&self.url)
            .ok_or_else(|| format!("invalid kernel ws url: {}", self.url))?;
        let addr = (host.as_str(), port)
            .to_socket_addrs()
            .map_err(|e| format!("kernel address resolution failed: {e}"))?
            .next()
            .ok_or_else(|| format!("kernel address did not resolve: {host}:{port}"))?;
        let stream = TcpStream::connect_timeout(&addr, self.timeout)
            .map_err(|e| format!("kernel connect failed: {e}"))?;
        stream
            .set_read_timeout(Some(self.timeout))
            .map_err(|e| format!("set read timeout failed: {e}"))?;
        stream
            .set_write_timeout(Some(self.timeout))
            .map_err(|e| format!("set write timeout failed: {e}"))?;
        let (ws, _resp) = tungstenite::client(self.url.as_str(), stream)
            .map_err(|e| format!("kernel handshake failed: {e}"))?;
        Ok(ws)
    }

    /// Send one request and read text frames until `matcher` accepts one, the
    /// deadline lapses, or the socket closes. Unrelated frames are ignored. The
    /// dropped `WebSocket` closes the TCP stream (no close handshake, so this
    /// cannot block).
    fn roundtrip<F>(&self, request: &Value, mut matcher: F) -> Result<Value, String>
    where
        F: FnMut(&Value) -> bool,
    {
        let deadline = Instant::now() + self.timeout;
        let mut ws = self.open()?;
        let payload = serde_json::to_string(request).map_err(|e| e.to_string())?;
        ws.send(Message::Text(payload))
            .map_err(|e| format!("kernel send failed: {e}"))?;

        // Cap the number of ignored frames so a chatty peer can never keep us
        // looping; the per-read OS timeout and the wall deadline are the hard
        // stops that guarantee this returns.
        for _ in 0..256 {
            if Instant::now() >= deadline {
                return Err("timed out waiting for kernel response".to_string());
            }
            let msg = ws.read().map_err(|e| format!("kernel read failed: {e}"))?;
            match msg {
                Message::Text(text) => {
                    if let Ok(value) = serde_json::from_str::<Value>(text.as_str()) {
                        if matcher(&value) {
                            return Ok(value);
                        }
                    }
                }
                Message::Close(_) => {
                    return Err("kernel closed the connection before responding".to_string());
                }
                // Binary/Ping/Pong/Frame carry no protocol response for us.
                _ => {}
            }
        }
        Err("kernel sent too many unrelated frames".to_string())
    }
}

impl SubmitPort for KernelSubmitPort {
    fn available(&self) -> bool {
        true
    }

    fn submit(&self, req: &SubmitRequest) -> SubmitOutcome {
        let request = json!({
            "type": "hardware_submit",
            "provider": req.provider,
            "backend": req.backend,
            "code": req.code,
            "shots": req.shots,
            "language": req.language,
        });
        match self.roundtrip(&request, |v| {
            type_is(v, "hardware_job_submitted") || type_is(v, "error")
        }) {
            Ok(resp) => parse_submit_response(&resp),
            Err(message) => SubmitOutcome::Err { message },
        }
    }

    fn status(&self, job_id: &str) -> JobStatus {
        let request = json!({ "type": "hardware_status", "job_id": job_id });
        match self.roundtrip(&request, |v| {
            type_is(v, "hardware_job_update") || type_is(v, "error")
        }) {
            Ok(resp) => parse_status_response(&resp, job_id),
            // A transport failure is reported as `unavailable`, mirroring the
            // stub port, rather than a fabricated job state.
            Err(_) => JobStatus {
                job_id: job_id.to_string(),
                status: "unavailable".to_string(),
                queue_position: None,
            },
        }
    }

    fn results(&self, job_id: &str) -> JobResultsOutcome {
        let request = json!({ "type": "hardware_results", "job_id": job_id });
        match self.roundtrip(&request, |v| {
            (type_is(v, "hardware_result") && job_id_matches(v, job_id)) || type_is(v, "error")
        }) {
            Ok(resp) => parse_results_response(&resp, job_id),
            Err(message) => JobResultsOutcome::Err { message },
        }
    }

    fn cancel(&self, job_id: &str) -> bool {
        let request = json!({ "type": "hardware_cancel", "job_id": job_id });
        match self.roundtrip(&request, |v| {
            (type_is(v, "hardware_job_cancelled") && job_id_matches(v, job_id))
                || type_is(v, "error")
        }) {
            Ok(resp) => parse_cancel_response(&resp),
            Err(_) => false,
        }
    }
}
