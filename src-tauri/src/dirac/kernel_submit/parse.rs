//! Pure message-construction inputs and response parsing for the R7 kernel
//! transport. Every function here is a deterministic transform over
//! `serde_json::Value` with NO socket, NO I/O — so the protocol mapping is
//! unit-tested against canned kernel JSON (see `tests.rs`).

use std::collections::HashMap;

use serde_json::Value;

use super::super::analysis::BackendInfo;
use super::super::submit::{JobResultsOutcome, JobStatus, SubmitOutcome};

/// Whether a frame's `type` equals `expected`.
pub(super) fn type_is(value: &Value, expected: &str) -> bool {
    value.get("type").and_then(Value::as_str) == Some(expected)
}

/// Whether a frame's top-level `job_id` equals `expected`.
pub(super) fn job_id_matches(value: &Value, expected: &str) -> bool {
    value.get("job_id").and_then(Value::as_str) == Some(expected)
}

/// Split `ws://host:port/...` into `(host, port)`. Defaults to port 80 when the
/// authority omits it (the kernel always specifies one).
pub(super) fn parse_authority(url: &str) -> Option<(String, u16)> {
    let rest = url
        .strip_prefix("ws://")
        .or_else(|| url.strip_prefix("wss://"))?;
    let authority = rest.split('/').next()?;
    match authority.rsplit_once(':') {
        Some((host, port)) if !host.is_empty() => Some((host.to_string(), port.parse().ok()?)),
        Some(_) => None,
        None => Some((authority.to_string(), 80)),
    }
}

/// Parse a `hardware_submit` response into a [`SubmitOutcome`].
pub(super) fn parse_submit_response(resp: &Value) -> SubmitOutcome {
    if type_is(resp, "error") {
        return SubmitOutcome::Err {
            message: error_message(resp),
        };
    }
    match resp
        .get("job")
        .and_then(|j| j.get("id"))
        .and_then(Value::as_str)
    {
        Some(id) if !id.is_empty() => SubmitOutcome::Ok {
            job_id: id.to_string(),
        },
        _ => SubmitOutcome::Err {
            message: "kernel submit response missing job id".to_string(),
        },
    }
}

/// Parse a `hardware_job_update` response into a [`JobStatus`], falling back to
/// the requested `job_id` when the frame omits its own.
pub(super) fn parse_status_response(resp: &Value, requested: &str) -> JobStatus {
    if type_is(resp, "error") {
        return JobStatus {
            job_id: requested.to_string(),
            status: "unavailable".to_string(),
            queue_position: None,
        };
    }
    let job = resp.get("job");
    let job_id = job
        .and_then(|j| j.get("id"))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .unwrap_or(requested)
        .to_string();
    let status = job
        .and_then(|j| j.get("status"))
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    let queue_position = job
        .and_then(|j| j.get("queue_position"))
        .and_then(Value::as_i64);
    JobStatus {
        job_id,
        status,
        queue_position,
    }
}

/// Parse a `hardware_result` response into a [`JobResultsOutcome`], converting
/// the kernel's raw counts into normalized probabilities (mirrors
/// `useKernel.ts`). A `data.error` is surfaced as an error outcome.
pub(super) fn parse_results_response(resp: &Value, requested: &str) -> JobResultsOutcome {
    if type_is(resp, "error") {
        return JobResultsOutcome::Err {
            message: error_message(resp),
        };
    }
    let job_id = resp
        .get("job_id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .unwrap_or(requested)
        .to_string();
    let Some(data) = resp.get("data") else {
        return JobResultsOutcome::Err {
            message: "kernel result missing data".to_string(),
        };
    };
    if let Some(err) = data.get("error").and_then(Value::as_str) {
        return JobResultsOutcome::Err {
            message: err.to_string(),
        };
    }
    JobResultsOutcome::Ok {
        job_id,
        probabilities: counts_to_probabilities(data),
    }
}

/// Convert a result `data` object's `measurements` counts into total-normalized
/// probabilities. Guards divide-by-zero (empty/zero totals → empty map), and
/// ignores non-numeric counts.
pub(super) fn counts_to_probabilities(data: &Value) -> HashMap<String, f64> {
    let mut probs = HashMap::new();
    let Some(counts) = data.get("measurements").and_then(Value::as_object) else {
        return probs;
    };
    let total: f64 = counts.values().filter_map(Value::as_f64).sum();
    if total <= 0.0 {
        return probs;
    }
    for (state, count) in counts {
        if let Some(n) = count.as_f64() {
            probs.insert(state.clone(), n / total);
        }
    }
    probs
}

/// Parse a `hardware_job_cancelled` response's `success` flag (default false).
pub(super) fn parse_cancel_response(resp: &Value) -> bool {
    if type_is(resp, "error") {
        return false;
    }
    resp.get("success")
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

/// Map a `hardware_backends` response's `backends` array into [`BackendInfo`]s,
/// skipping any entry missing a name/provider. `[]` when the array is absent.
pub(super) fn parse_backends(resp: &Value) -> Vec<BackendInfo> {
    resp.get("backends")
        .and_then(Value::as_array)
        .map(|arr| arr.iter().filter_map(parse_backend).collect())
        .unwrap_or_default()
}

fn parse_backend(value: &Value) -> Option<BackendInfo> {
    let name = value.get("name").and_then(Value::as_str)?.to_string();
    let provider = value.get("provider").and_then(Value::as_str)?.to_string();
    Some(BackendInfo {
        name,
        provider,
        qubit_count: value
            .get("qubit_count")
            .and_then(Value::as_u64)
            .unwrap_or(0) as u32,
        connectivity: parse_connectivity(value.get("connectivity")),
        queue_length: value
            .get("queue_length")
            .and_then(Value::as_u64)
            .unwrap_or(0) as u32,
        average_error_rate: value
            .get("average_error_rate")
            .and_then(Value::as_f64)
            .unwrap_or(0.0),
        gate_set: parse_string_list(value.get("gate_set")),
        status: value
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string(),
    })
}

/// Parse `[[a, b], ...]` connectivity pairs, dropping malformed entries.
pub(super) fn parse_connectivity(value: Option<&Value>) -> Vec<(u32, u32)> {
    let Some(arr) = value.and_then(Value::as_array) else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(|pair| {
            let p = pair.as_array()?;
            let a = p.first()?.as_u64()? as u32;
            let b = p.get(1)?.as_u64()? as u32;
            Some((a, b))
        })
        .collect()
}

/// Parse a JSON array of strings, dropping non-string entries.
fn parse_string_list(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// Extract a kernel `error` frame's `message` (with a generic fallback).
fn error_message(resp: &Value) -> String {
    resp.get("message")
        .and_then(Value::as_str)
        .unwrap_or("kernel reported an error")
        .to_string()
}
