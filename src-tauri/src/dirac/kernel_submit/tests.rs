//! Unit tests for the R7 kernel-transport protocol mapping. These exercise the
//! pure parse/convert helpers in [`super::parse`] against canned kernel JSON —
//! no live socket, so they are deterministic and offline.

use serde_json::json;

use super::super::submit::{JobResultsOutcome, JobStatus, SubmitOutcome};
use super::parse::{
    counts_to_probabilities, job_id_matches, parse_authority, parse_backends,
    parse_cancel_response, parse_connectivity, parse_results_response, parse_status_response,
    parse_submit_response, type_is,
};

#[test]
fn parse_authority_extracts_host_and_port() {
    assert_eq!(
        parse_authority("ws://localhost:9742"),
        Some(("localhost".to_string(), 9742))
    );
    assert_eq!(
        parse_authority("ws://127.0.0.1:9742/agent"),
        Some(("127.0.0.1".to_string(), 9742))
    );
    assert_eq!(
        parse_authority("wss://host:1"),
        Some(("host".to_string(), 1))
    );
}

#[test]
fn parse_authority_defaults_and_rejects() {
    assert_eq!(
        parse_authority("ws://localhost"),
        Some(("localhost".to_string(), 80))
    );
    assert_eq!(parse_authority("http://localhost:9742"), None);
    assert_eq!(parse_authority("ws://:9742"), None);
    assert_eq!(parse_authority("ws://host:notaport"), None);
}

#[test]
fn submit_response_ok_extracts_job_id() {
    let resp = json!({
        "type": "hardware_job_submitted",
        "job": { "id": "job_abc", "provider": "simulator", "status": "queued" }
    });
    assert_eq!(
        parse_submit_response(&resp),
        SubmitOutcome::Ok {
            job_id: "job_abc".to_string()
        }
    );
}

#[test]
fn submit_response_error_frame_becomes_err() {
    let resp = json!({ "type": "error", "message": "Hardware submit failed: boom" });
    assert_eq!(
        parse_submit_response(&resp),
        SubmitOutcome::Err {
            message: "Hardware submit failed: boom".to_string()
        }
    );
}

#[test]
fn submit_response_missing_id_is_err() {
    let resp = json!({ "type": "hardware_job_submitted", "job": { "status": "queued" } });
    assert!(matches!(
        parse_submit_response(&resp),
        SubmitOutcome::Err { .. }
    ));
}

#[test]
fn status_response_reads_status_and_queue() {
    let resp = json!({
        "type": "hardware_job_update",
        "job": { "id": "job_1", "status": "running", "queue_position": 3 }
    });
    assert_eq!(
        parse_status_response(&resp, "job_1"),
        JobStatus {
            job_id: "job_1".to_string(),
            status: "running".to_string(),
            queue_position: Some(3),
        }
    );
}

#[test]
fn status_response_error_frame_is_unavailable() {
    let resp = json!({ "type": "error", "message": "lookup failed" });
    let status = parse_status_response(&resp, "job_x");
    assert_eq!(status.job_id, "job_x");
    assert_eq!(status.status, "unavailable");
    assert_eq!(status.queue_position, None);
}

#[test]
fn status_response_stale_job_falls_back_to_requested_id() {
    // Defensive parse: an empty id resolves back to the requested one.
    let resp = json!({
        "type": "hardware_job_update",
        "job": { "id": "", "status": "stale", "queue_position": null }
    });
    let status = parse_status_response(&resp, "job_missing");
    assert_eq!(status.job_id, "job_missing");
    assert_eq!(status.status, "stale");
    assert_eq!(status.queue_position, None);
}

#[test]
fn counts_normalize_to_probabilities() {
    let data = json!({ "measurements": { "00": 750, "11": 250 } });
    let probs = counts_to_probabilities(&data);
    assert_eq!(probs.len(), 2);
    assert!((probs["00"] - 0.75).abs() < 1e-9);
    assert!((probs["11"] - 0.25).abs() < 1e-9);
}

#[test]
fn counts_guard_divide_by_zero() {
    assert!(counts_to_probabilities(&json!({ "measurements": {} })).is_empty());
    assert!(counts_to_probabilities(&json!({ "measurements": { "00": 0 } })).is_empty());
    assert!(counts_to_probabilities(&json!({})).is_empty());
}

#[test]
fn results_response_ok_normalizes() {
    let resp = json!({
        "type": "hardware_result",
        "job_id": "job_9",
        "data": { "measurements": { "0": 512, "1": 512 } }
    });
    match parse_results_response(&resp, "job_9") {
        JobResultsOutcome::Ok {
            job_id,
            probabilities,
        } => {
            assert_eq!(job_id, "job_9");
            assert!((probabilities["0"] - 0.5).abs() < 1e-9);
            assert!((probabilities["1"] - 0.5).abs() < 1e-9);
        }
        other => panic!("expected Ok, got {other:?}"),
    }
}

#[test]
fn results_response_data_error_is_err() {
    let resp = json!({
        "type": "hardware_result",
        "job_id": "job_stale",
        "data": { "error": "Results no longer available", "status": "stale" }
    });
    assert_eq!(
        parse_results_response(&resp, "job_stale"),
        JobResultsOutcome::Err {
            message: "Results no longer available".to_string()
        }
    );
}

#[test]
fn results_response_error_frame_is_err() {
    let resp = json!({ "type": "error", "message": "Failed to get results: x" });
    assert!(matches!(
        parse_results_response(&resp, "job_1"),
        JobResultsOutcome::Err { .. }
    ));
}

#[test]
fn cancel_response_reads_success_flag() {
    assert!(parse_cancel_response(&json!({
        "type": "hardware_job_cancelled", "job_id": "j", "success": true
    })));
    assert!(!parse_cancel_response(&json!({
        "type": "hardware_job_cancelled", "job_id": "j", "success": false
    })));
    assert!(!parse_cancel_response(
        &json!({ "type": "error", "message": "no" })
    ));
}

#[test]
fn backends_parse_maps_all_fields() {
    let resp = json!({
        "type": "hardware_backends",
        "backends": [{
            "name": "sim_qasm",
            "provider": "simulator",
            "qubit_count": 32,
            "connectivity": [[0, 1], [1, 2]],
            "queue_length": 0,
            "average_error_rate": 0.0,
            "gate_set": ["H", "CNOT", "RZ"],
            "status": "online"
        }]
    });
    let backends = parse_backends(&resp);
    assert_eq!(backends.len(), 1);
    let b = &backends[0];
    assert_eq!(b.name, "sim_qasm");
    assert_eq!(b.provider, "simulator");
    assert_eq!(b.qubit_count, 32);
    assert_eq!(b.connectivity, vec![(0, 1), (1, 2)]);
    assert_eq!(b.gate_set, vec!["H", "CNOT", "RZ"]);
    assert_eq!(b.status, "online");
}

#[test]
fn backends_skip_entries_missing_required_fields() {
    let resp = json!({
        "type": "hardware_backends",
        "backends": [
            { "provider": "simulator" },
            { "name": "ok", "provider": "simulator" }
        ]
    });
    let backends = parse_backends(&resp);
    assert_eq!(backends.len(), 1);
    assert_eq!(backends[0].name, "ok");
    // Missing optional fields default rather than panicking.
    assert_eq!(backends[0].qubit_count, 0);
    assert!(backends[0].connectivity.is_empty());
}

#[test]
fn backends_absent_array_is_empty() {
    assert!(parse_backends(&json!({ "type": "hardware_backends" })).is_empty());
}

#[test]
fn connectivity_drops_malformed_pairs() {
    let value = json!([[0, 1], [2], "nope", [3, 4]]);
    assert_eq!(parse_connectivity(Some(&value)), vec![(0, 1), (3, 4)]);
}

#[test]
fn type_and_job_id_matchers() {
    let v = json!({ "type": "hardware_result", "job_id": "j1" });
    assert!(type_is(&v, "hardware_result"));
    assert!(!type_is(&v, "error"));
    assert!(job_id_matches(&v, "j1"));
    assert!(!job_id_matches(&v, "j2"));
}
