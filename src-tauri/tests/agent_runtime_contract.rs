use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Barrier, Mutex};
use std::thread;
use std::time::Duration;

#[cfg(unix)]
use std::future::Future;
#[cfg(unix)]
use std::pin::Pin;

#[cfg(unix)]
use app_lib::agent_runtime::process::{
    ProcessSpec, ProcessSupervisor, ResourceLimits, Supervisor, SupervisorLimits,
};
use app_lib::agent_runtime::protocol::{
    Action, Framework, FrontendRequestV1, ResponseStatus, WorkerRequestV1, WorkerResponseV1,
};
use app_lib::agent_runtime::resources::SystemCommandRunner;
use app_lib::agent_runtime::resources::{
    validate_requirements, AgentEnvironment, CommandOutput, CommandRunner, CommandSpec,
    EnvironmentFilesystem, ResourcePaths, RunnerContainment, AGENT_KERNEL_FILES,
};
#[cfg(unix)]
use app_lib::agent_runtime::{AgentProcessResolver, CapabilityReport};
use app_lib::agent_runtime::{AgentRuntimeCommands, AgentRuntimeState};
use serde_json::{json, Value};
use sha2::Digest;
use tempfile::TempDir;

const REQUIREMENTS: &str = include_str!("../../kernel/agent-requirements.txt");

fn frontend(action: &str, extra: &str) -> String {
    format!(
        r#"{{"protocolVersion":1,"requestId":"request_1","action":"{action}","framework":"cirq","language":"python","code":"import cirq"{extra}}}"#
    )
}

#[test]
fn frontend_request_uses_strict_camel_case_json() {
    let valid: FrontendRequestV1 =
        serde_json::from_str(&frontend("parse", "")).expect("valid frontend request");
    assert_eq!(valid.action, Action::Parse);

    for raw in [
        frontend("parse", r#","extra":true"#),
        r#"{"protocol_version":1,"requestId":"r","action":"parse","framework":"cirq","language":"python","code":""}"#.into(),
    ] {
        assert!(serde_json::from_str::<FrontendRequestV1>(&raw).is_err());
    }
}

#[test]
fn cuda_q_is_not_representable_or_accepted() {
    assert!(serde_json::from_str::<Framework>(r#""cuda-q""#).is_err());
    assert!(serde_json::from_str::<FrontendRequestV1>(
        r#"{"protocolVersion":1,"requestId":"r","action":"parse","framework":"cuda-q","language":"python","code":""}"#
    )
    .is_err());
}

#[test]
fn frontend_to_worker_enforces_python_contract_bounds() {
    let valid_ids = ["a", "A_0-9", &"z".repeat(64)];
    for request_id in valid_ids {
        let raw = frontend("parse", "").replace("request_1", request_id);
        WorkerRequestV1::try_from(serde_json::from_str::<FrontendRequestV1>(&raw).unwrap())
            .unwrap();
    }

    let invalid = [
        frontend("parse", "").replace(r#""protocolVersion":1"#, r#""protocolVersion":2"#),
        frontend("parse", "").replace("request_1", ""),
        frontend("parse", "").replace("request_1", &"x".repeat(65)),
        frontend("parse", "").replace("request_1", "bad.id"),
        frontend("parse", "").replace(r#""language":"python""#, r#""language":"qsharp""#),
        frontend("simulate", ""),
        frontend("simulate", r#","shots":0"#),
        frontend("simulate", r#","shots":10001"#),
        frontend("parse", r#","shots":1"#),
        frontend("parse", r#","shots":null"#),
    ];
    for raw in invalid {
        let parsed: FrontendRequestV1 = serde_json::from_str(&raw).unwrap();
        assert!(WorkerRequestV1::try_from(parsed).is_err(), "{raw}");
    }

    for shots in [1, 10_000] {
        let raw = frontend("simulate", &format!(r#","shots":{shots}"#));
        WorkerRequestV1::try_from(serde_json::from_str::<FrontendRequestV1>(&raw).unwrap())
            .unwrap();
    }
}

#[test]
fn frontend_to_worker_caps_utf8_code_bytes() {
    let mut value: Value = serde_json::from_str(&frontend("parse", "")).unwrap();
    value["code"] = Value::String("é".repeat(262_144 / 2));
    let valid: FrontendRequestV1 = serde_json::from_value(value.clone()).unwrap();
    WorkerRequestV1::try_from(valid).unwrap();

    value["code"] = Value::String("é".repeat(262_144 / 2 + 1));
    let oversized: FrontendRequestV1 = serde_json::from_value(value).unwrap();
    assert!(WorkerRequestV1::try_from(oversized).is_err());
}

#[test]
fn qsharp_requires_qsharp_and_python_frameworks_require_python() {
    for (framework, language) in [
        ("qiskit", "python"),
        ("cirq", "python"),
        ("qsharp", "qsharp"),
    ] {
        let raw = frontend("parse", "")
            .replace(
                r#""framework":"cirq""#,
                &format!(r#""framework":"{framework}""#),
            )
            .replace(
                r#""language":"python""#,
                &format!(r#""language":"{language}""#),
            );
        WorkerRequestV1::try_from(serde_json::from_str::<FrontendRequestV1>(&raw).unwrap())
            .unwrap();
    }
}

#[test]
fn worker_request_serializes_snake_case() {
    let frontend: FrontendRequestV1 = serde_json::from_str(&frontend("parse", "")).unwrap();
    let worker = WorkerRequestV1::try_from(frontend).unwrap();
    let value = serde_json::to_value(worker).unwrap();

    assert_eq!(value["protocol_version"], 1);
    assert_eq!(value["request_id"], "request_1");
    assert!(value.get("protocolVersion").is_none());
    assert!(value.get("shots").is_none());
}

fn response(changes: &[(&str, Value)]) -> Value {
    let mut value = json!({
        "protocol_version": 1,
        "request_id": "request_1",
        "status": "ok",
        "snapshot": null,
        "result": null,
        "stdout": "",
        "stderr": "",
        "error": null
    });
    for (key, replacement) in changes {
        value[*key] = replacement.clone();
    }
    value
}

fn worker_request(action: Action, framework: Framework, shots: Option<u32>) -> WorkerRequestV1 {
    WorkerRequestV1 {
        protocol_version: 1,
        request_id: "request_1".into(),
        action,
        framework,
        language: if framework == Framework::Qsharp {
            "qsharp"
        } else {
            "python"
        }
        .into(),
        code: String::new(),
        shots,
    }
}

fn valid_snapshot() -> Value {
    json!({
        "framework": "cirq",
        "qubit_count": 2,
        "classical_bit_count": 2,
        "depth": 1,
        "gates": [{"type":"H","targets":[0],"controls":[],"params":[],"layer":0}]
    })
}

fn valid_result() -> Value {
    json!({
        "state_vector": [
            {"re":1.0,"im":0.0},{"re":0.0,"im":0.0},
            {"re":0.0,"im":0.0},{"re":0.0,"im":0.0}
        ],
        "probabilities": {"00": 1.0},
        "measurements": {"00": 5},
        "bloch_coords": [{"x":0.0,"y":0.0,"z":1.0},{"x":0.0,"y":0.0,"z":1.0}],
        "execution_time_ms": 1.0,
        "shot_count": 5
    })
}

#[test]
fn worker_response_is_strict_and_validates_identity() {
    let raw = response(&[]);
    let parsed: WorkerResponseV1 = serde_json::from_value(raw).unwrap();
    assert_eq!(parsed.status, ResponseStatus::Ok);
    parsed
        .validate(&worker_request(Action::Parse, Framework::Cirq, None))
        .unwrap();

    let mut unknown = response(&[]);
    unknown["extra"] = json!(true);
    assert!(serde_json::from_value::<WorkerResponseV1>(unknown).is_err());

    assert!(
        serde_json::from_value::<WorkerResponseV1>(response(&[("status", json!("success"))]))
            .is_err()
    );

    for changed in [
        response(&[("protocol_version", json!(2))]),
        response(&[("request_id", json!("bad.id"))]),
        response(&[("request_id", json!(""))]),
        response(&[("request_id", json!("x".repeat(65)))]),
    ] {
        assert!(serde_json::from_value::<WorkerResponseV1>(changed).is_err());
    }

    let parsed: WorkerResponseV1 =
        serde_json::from_value(response(&[("request_id", json!("other"))])).unwrap();
    assert!(parsed
        .validate(&worker_request(Action::Parse, Framework::Cirq, None))
        .is_err());
}

#[test]
fn validated_worker_response_serializes_with_worker_snake_case_schema() {
    let parsed: WorkerResponseV1 = serde_json::from_value(response(&[])).unwrap();
    let value = serde_json::to_value(parsed).unwrap();

    assert_eq!(value["protocol_version"], 1);
    assert_eq!(value["request_id"], "request_1");
    assert_eq!(value["status"], "ok");
    assert!(value.get("protocolVersion").is_none());
    assert!(value.get("requestId").is_none());
}

#[test]
fn worker_response_requires_every_top_level_field_even_when_nullable() {
    for field in [
        "protocol_version",
        "request_id",
        "status",
        "snapshot",
        "result",
        "stdout",
        "stderr",
        "error",
    ] {
        let mut value = response(&[]);
        value.as_object_mut().unwrap().remove(field);
        assert!(
            serde_json::from_value::<WorkerResponseV1>(value).is_err(),
            "missing {field} was accepted"
        );
    }
}

#[test]
fn worker_response_nullable_payloads_are_object_or_null_only() {
    for field in ["snapshot", "result", "error"] {
        for invalid in [json!(false), json!(1), json!("bad"), json!([])] {
            assert!(
                serde_json::from_value::<WorkerResponseV1>(response(&[(field, invalid.clone())]))
                    .is_err(),
                "{field} accepted {invalid}"
            );
        }
        serde_json::from_value::<WorkerResponseV1>(response(&[(field, Value::Null)])).unwrap();
    }
    serde_json::from_value::<WorkerResponseV1>(response(&[
        ("snapshot", valid_snapshot()),
        ("result", valid_result()),
    ]))
    .unwrap();
}

#[test]
fn worker_response_rejects_malformed_and_duplicate_json() {
    assert!(serde_json::from_str::<WorkerResponseV1>("{").is_err());
    assert!(serde_json::from_str::<WorkerResponseV1>(
        r#"{"protocol_version":1,"protocol_version":1,"request_id":"r","status":"ok","snapshot":null,"result":null,"stdout":"","stderr":"","error":null}"#
    )
    .is_err());
}

#[test]
fn worker_error_matches_strict_python_kernel_error_shape() {
    let valid = json!({
        "code": "execution_error",
        "message": "Circuit failed",
        "traceback": null,
        "framework": "cirq",
        "dependency": null
    });
    serde_json::from_value::<WorkerResponseV1>(response(&[
        ("status", json!("error")),
        ("error", valid),
    ]))
    .unwrap();

    for invalid in [
        json!({"message": "missing code"}),
        json!({"code": "missing_message"}),
        json!({"code": "bad", "message": "bad", "unknown": true}),
        json!({"code": 1, "message": "bad"}),
        json!({"code": "bad", "message": "bad", "traceback": 1}),
    ] {
        assert!(serde_json::from_value::<WorkerResponseV1>(response(&[
            ("status", json!("error")),
            ("error", invalid),
        ]))
        .is_err());
    }
}

#[test]
fn worker_response_rejects_payload_shape_semantics_and_status_contradictions() {
    for changed in [
        vec![("status", json!("error"))],
        vec![("error", json!({"code":"bad","message":"bad"}))],
        vec![("snapshot", json!({"framework":"cirq"}))],
        vec![("snapshot", {
            let mut value = valid_snapshot();
            value["gates"][0]["targets"] = json!([99]);
            value
        })],
        vec![("result", {
            let mut value = valid_result();
            value["shot_count"] = json!(4);
            value
        })],
        vec![("result", {
            let mut value = valid_result();
            value["bloch_coords"][0]["extra"] = json!(true);
            value
        })],
        vec![("result", {
            let mut value = valid_result();
            value["probabilities"]["00"] = json!(-0.1);
            value
        })],
        vec![("result", {
            let mut value = valid_result();
            value["probabilities"] = json!({"00": 0.7, "11": 0.7});
            value
        })],
        vec![("result", {
            let mut value = valid_result();
            value["probabilities"] = json!({"00": 0.0});
            value
        })],
        vec![("result", {
            let mut value = valid_result();
            value["measurements"] = json!({"00": 4, "11": 4});
            value
        })],
    ] {
        assert!(serde_json::from_value::<WorkerResponseV1>(response(&changed)).is_err());
    }
}

#[test]
fn worker_response_accepts_actual_qiskit_cirq_and_qsharp_result_shapes() {
    let qiskit_snapshot = json!({
        "framework": "qiskit",
        "qubit_count": 2,
        "classical_bit_count": 1,
        "depth": 1,
        "gates": [{"type":"H","targets":[0],"controls":[],"params":[],"layer":0}]
    });
    let qiskit_result = json!({
        "state_vector": [
            {"re":0.707106,"im":0.0},{"re":0.0,"im":0.0},
            {"re":0.707106,"im":0.0},{"re":0.0,"im":0.0}
        ],
        "probabilities": {"00": 0.5, "10": 0.5},
        "measurements": {"0": 51, "1": 49},
        "bloch_coords": [{"x":1.0,"y":0.0,"z":0.0},{"x":0.0,"y":0.0,"z":1.0}],
        "execution_time_ms": 1.2,
        "shot_count": 100
    });
    serde_json::from_value::<WorkerResponseV1>(response(&[
        ("snapshot", qiskit_snapshot),
        ("result", qiskit_result),
    ]))
    .unwrap();

    let cirq_result = json!({
        "state_vector": [],
        "probabilities": {"00": 0.25, "01": 0.25, "10": 0.25, "11": 0.25},
        "measurements": {"00": 1, "01": 3, "10": 2, "11": 2},
        "bloch_coords": [],
        "execution_time_ms": 0.5,
        "shot_count": 8
    });
    serde_json::from_value::<WorkerResponseV1>(response(&[
        ("snapshot", valid_snapshot()),
        ("result", cirq_result),
    ]))
    .unwrap();

    let qsharp_snapshot = json!({
        "framework": "qsharp",
        "qubit_count": 2,
        "classical_bit_count": 0,
        "depth": 1,
        "gates": [{"type":"H","targets":[0],"controls":[],"params":[],"layer":0}]
    });
    let qsharp_result = json!({
        "state_vector": [],
        "probabilities": {"00": 0.5, "11": 0.5},
        "measurements": {},
        "bloch_coords": [{"x":0.0,"y":0.0,"z":0.0},{"x":0.0,"y":0.0,"z":0.0}],
        "execution_time_ms": 2.0,
        "shot_count": 100
    });
    serde_json::from_value::<WorkerResponseV1>(response(&[
        ("snapshot", qsharp_snapshot),
        ("result", qsharp_result),
    ]))
    .unwrap();

    let qsharp_subset_snapshot = json!({
        "framework": "qsharp",
        "qubit_count": 3,
        "classical_bit_count": 0,
        "depth": 1,
        "gates": [{"type":"H","targets":[0],"controls":[],"params":[],"layer":0}]
    });
    let qsharp_subset_result = json!({
        "state_vector": [],
        "probabilities": {"0": 0.5, "1": 0.5},
        "measurements": {},
        "bloch_coords": [],
        "execution_time_ms": 2.0,
        "shot_count": 100
    });
    serde_json::from_value::<WorkerResponseV1>(response(&[
        ("snapshot", qsharp_subset_snapshot),
        ("result", qsharp_subset_result),
    ]))
    .unwrap();

    let qsharp_repeated_snapshot = json!({
        "framework": "qsharp",
        "qubit_count": 2,
        "classical_bit_count": 0,
        "depth": 1,
        "gates": [{"type":"H","targets":[0],"controls":[],"params":[],"layer":0}]
    });
    let qsharp_repeated_result = json!({
        "state_vector": [],
        "probabilities": {"0101": 0.5, "1010": 0.5},
        "measurements": {},
        "bloch_coords": [],
        "execution_time_ms": 2.0,
        "shot_count": 100
    });
    serde_json::from_value::<WorkerResponseV1>(response(&[
        ("snapshot", qsharp_repeated_snapshot),
        ("result", qsharp_repeated_result),
    ]))
    .unwrap();

    let sparse_snapshot = json!({
        "framework": "qiskit",
        "qubit_count": 12,
        "classical_bit_count": 12,
        "depth": 1,
        "gates": [{"type":"H","targets":[0],"controls":[],"params":[],"layer":0}]
    });
    let sparse_result = json!({
        "state_vector": [],
        "probabilities": {"000000000000": 0.625},
        "measurements": {"000000000000": 5},
        "bloch_coords": [],
        "execution_time_ms": 1.0,
        "shot_count": 5
    });
    let sparse: WorkerResponseV1 = serde_json::from_value(response(&[
        ("snapshot", sparse_snapshot),
        ("result", sparse_result),
    ]))
    .unwrap();
    sparse
        .validate(&worker_request(
            Action::Simulate,
            Framework::Qiskit,
            Some(5),
        ))
        .unwrap();

    let qsharp_empty_result = json!({
        "state_vector": [],
        "probabilities": {},
        "measurements": {},
        "bloch_coords": [],
        "execution_time_ms": 1.0,
        "shot_count": 5
    });
    let mut qsharp_empty_snapshot = valid_snapshot();
    qsharp_empty_snapshot["framework"] = json!("qsharp");
    let empty: WorkerResponseV1 = serde_json::from_value(response(&[
        ("snapshot", qsharp_empty_snapshot),
        ("result", qsharp_empty_result),
    ]))
    .unwrap();
    empty
        .validate(&worker_request(
            Action::Simulate,
            Framework::Qsharp,
            Some(5),
        ))
        .unwrap();
}

#[test]
fn worker_response_bounds_binary_result_keys() {
    for field in ["probabilities", "measurements"] {
        let mut result = valid_result();
        let mut oversized = serde_json::Map::new();
        oversized.insert(
            "0".repeat(4097),
            if field == "probabilities" {
                json!(1.0)
            } else {
                json!(5)
            },
        );
        result[field] = Value::Object(oversized);
        assert!(
            serde_json::from_value::<WorkerResponseV1>(response(&[("result", result),])).is_err()
        );
    }

    for malformed in ["", "012", "0 1"] {
        let mut result = valid_result();
        let mut probabilities = serde_json::Map::new();
        probabilities.insert(malformed.to_owned(), json!(1.0));
        result["probabilities"] = Value::Object(probabilities);
        assert!(
            serde_json::from_value::<WorkerResponseV1>(response(&[("result", result)])).is_err()
        );
    }
}

#[test]
fn worker_response_correlates_action_framework_and_shots() {
    let request = worker_request(Action::Simulate, Framework::Qiskit, Some(5));
    let mut result = valid_result();
    result["measurements"] = json!({"00 11": 5});
    let mut snapshot = valid_snapshot();
    snapshot["framework"] = json!("qiskit");
    let parsed: WorkerResponseV1 = serde_json::from_value(response(&[
        ("snapshot", snapshot.clone()),
        ("result", result.clone()),
    ]))
    .unwrap();
    parsed.validate(&request).unwrap();

    let mismatches = [
        worker_request(Action::Simulate, Framework::Cirq, Some(5)),
        worker_request(Action::Simulate, Framework::Qiskit, Some(4)),
    ];
    for mismatch in mismatches {
        assert!(parsed.validate(&mismatch).is_err());
    }

    let parse = worker_request(Action::Parse, Framework::Qiskit, None);
    assert!(parsed.validate(&parse).is_err());

    let missing_payload: WorkerResponseV1 = serde_json::from_value(response(&[])).unwrap();
    assert!(missing_payload.validate(&request).is_err());

    let mut empty_probabilities = valid_result();
    empty_probabilities["probabilities"] = json!({});
    let empty: WorkerResponseV1 = serde_json::from_value(response(&[
        ("snapshot", snapshot),
        ("result", empty_probabilities),
    ]))
    .unwrap();
    assert!(empty.validate(&request).is_err());
}

#[test]
fn worker_error_framework_must_match_the_request() {
    let parsed: WorkerResponseV1 = serde_json::from_value(response(&[
        ("status", json!("error")),
        (
            "error",
            json!({
                "code": "execution_error",
                "message": "failed",
                "traceback": null,
                "framework": "cirq",
                "dependency": null
            }),
        ),
    ]))
    .unwrap();

    assert!(parsed
        .validate(&worker_request(Action::Parse, Framework::Qiskit, None))
        .is_err());
}

#[test]
fn measurement_keys_are_framework_aware_and_register_safe() {
    for valid in ["00 11", "00  \t 11"] {
        let mut result = valid_result();
        let mut measurements = serde_json::Map::new();
        measurements.insert(valid.into(), json!(5));
        result["measurements"] = Value::Object(measurements);
        let mut snapshot = valid_snapshot();
        snapshot["framework"] = json!("qiskit");
        let parsed: WorkerResponseV1 =
            serde_json::from_value(response(&[("snapshot", snapshot), ("result", result)]))
                .unwrap();
        parsed
            .validate(&worker_request(
                Action::Simulate,
                Framework::Qiskit,
                Some(5),
            ))
            .unwrap();
    }

    for malformed in [" 00", "00 ", "00 x1", "00  "] {
        let mut result = valid_result();
        let mut measurements = serde_json::Map::new();
        measurements.insert(malformed.into(), json!(5));
        result["measurements"] = Value::Object(measurements);
        assert!(
            serde_json::from_value::<WorkerResponseV1>(response(&[("result", result)])).is_err()
        );
    }

    let mut result = valid_result();
    result["measurements"] = json!({"00 11": 5});
    let parsed: WorkerResponseV1 = serde_json::from_value(response(&[
        ("snapshot", valid_snapshot()),
        ("result", result),
    ]))
    .unwrap();
    assert!(parsed
        .validate(&worker_request(Action::Simulate, Framework::Cirq, Some(5),))
        .is_err());
}

#[test]
fn parse_snapshot_supports_large_bounded_circuits_without_simulation_dimension() {
    let snapshot = json!({
        "framework": "qsharp",
        "qubit_count": 4096,
        "classical_bit_count": 4096,
        "depth": 0,
        "gates": []
    });
    let parsed: WorkerResponseV1 =
        serde_json::from_value(response(&[("snapshot", snapshot)])).unwrap();
    parsed
        .validate(&worker_request(Action::Parse, Framework::Qsharp, None))
        .unwrap();

    let oversized = json!({
        "framework": "qsharp",
        "qubit_count": 4097,
        "classical_bit_count": 0,
        "depth": 0,
        "gates": []
    });
    assert!(
        serde_json::from_value::<WorkerResponseV1>(response(&[("snapshot", oversized)])).is_err()
    );
}

#[cfg(windows)]
#[test]
fn windows_production_fails_closed_but_contained_injection_remains_testable() {
    use app_lib::agent_runtime::unsupported::UNAVAILABLE_MESSAGE;

    let spec = CommandSpec {
        program: PathBuf::from(r"Z:\definitely-does-not-exist.exe"),
        args: vec![],
        environment: vec![],
        clear_environment: true,
    };
    assert_eq!(
        SystemCommandRunner::run_with_limits(&spec, Duration::from_secs(1), 256).unwrap_err(),
        UNAVAILABLE_MESSAGE
    );

    let repository = TempDir::new().unwrap();
    write_resource_tree(repository.path());
    let resources = ResourcePaths::development(repository.path()).unwrap();
    let app_data = TempDir::new().unwrap();
    assert_eq!(
        AgentEnvironment::provision(app_data.path(), Path::new(r"Z:\python.exe"), &resources,)
            .unwrap_err(),
        UNAVAILABLE_MESSAGE
    );
    assert!(!app_data.path().join("agent-runtime").exists());

    let runner = FakeRunner::default();
    let environment = AgentEnvironment::provision_with_runner(
        app_data.path(),
        Path::new(r"Z:\python.exe"),
        &resources,
        &runner,
    )
    .unwrap();
    assert_same_canonical_path(&environment.root, &app_data.path().join("agent-runtime/v1"));
    assert!(runner
        .commands
        .lock()
        .unwrap()
        .iter()
        .any(|command| command.args.iter().any(|argument| argument == "venv")));
}

#[test]
fn dedicated_requirements_are_exact_and_safe() {
    assert_eq!(
        REQUIREMENTS,
        "numpy>=1.26,<3\nqiskit>=1.2,<2\nqiskit-aer>=0.15,<1\ncirq-core>=1.4,<2\nqdk>=1.29,<2\n"
    );
    validate_requirements(REQUIREMENTS).unwrap();

    for denied in [
        "keyring>=25",
        "qiskit-ibm-runtime>=0.1",
        "amazon-braket-sdk>=1",
        "azure-quantum>=1",
        "qiskit-ionq>=1",
        "pytket-quantinuum>=1",
        "cudaq>=0.1",
        "numpy[extra]>=1.26,<3",
        "unknown-package>=1",
    ] {
        assert!(validate_requirements(&format!("{REQUIREMENTS}{denied}\n")).is_err());
    }

    for changed in [
        REQUIREMENTS.replace(">=1.26,<3", ">=1.25,<3"),
        REQUIREMENTS.replace("numpy>=1.26,<3", "numpy>=1.26,<3 # changed"),
        REQUIREMENTS.replace("qdk>=1.29,<2", "qdk"),
        format!("--index-url https://example.invalid\n{REQUIREMENTS}"),
    ] {
        assert!(validate_requirements(&changed).is_err());
    }
}

fn write_resource_tree(root: &Path) -> PathBuf {
    let kernel = root.join("kernel");
    for relative in AGENT_KERNEL_FILES {
        let path = kernel.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let contents = if relative == "agent-requirements.txt" {
            REQUIREMENTS
        } else if relative == "agent_worker.py" {
            "# worker\n"
        } else {
            "# allowlisted agent kernel file\n"
        };
        fs::write(path, contents).unwrap();
    }
    fs::write(kernel.join("server.py"), "# must not enter agent runtime\n").unwrap();
    kernel
}

#[test]
fn development_and_bundled_resources_are_canonical_and_complete() {
    let development = TempDir::new().unwrap();
    let expected = write_resource_tree(development.path())
        .canonicalize()
        .unwrap();
    let paths = ResourcePaths::development(development.path()).unwrap();
    assert_eq!(paths.kernel_root, expected);
    assert_eq!(paths.worker, expected.join("agent_worker.py"));
    assert_eq!(paths.requirements, expected.join("agent-requirements.txt"));

    let bundled = TempDir::new().unwrap();
    let resources = bundled.path().join("agent-runtime");
    let expected = write_resource_tree(&resources).canonicalize().unwrap();
    let paths = ResourcePaths::bundled(bundled.path()).unwrap();
    assert_eq!(paths.kernel_root, expected);
}

#[test]
fn provisioning_copies_only_agent_kernel_allowlist_into_generation() {
    let repository = TempDir::new().unwrap();
    write_resource_tree(repository.path());
    let source = ResourcePaths::development(repository.path()).unwrap();
    let app_data = TempDir::new().unwrap();
    let environment = AgentEnvironment::provision_with_runner(
        app_data.path(),
        Path::new("/fixed/python3"),
        &source,
        &FakeRunner::default(),
    )
    .unwrap();

    let generated = ResourcePaths::generation(&environment).unwrap();
    assert_eq!(generated.kernel_root, environment.root.join("kernel"));
    assert_eq!(fs::read_to_string(&generated.worker).unwrap(), "# worker\n");
    assert!(!generated.kernel_root.join("server.py").exists());
    fs::write(
        generated.kernel_root.join("unexpected.py"),
        "# unexpected\n",
    )
    .unwrap();
    assert!(ResourcePaths::generation(&environment).is_err());
}

#[cfg(unix)]
#[test]
fn resources_reject_symlinks_escaping_kernel_root() {
    use std::os::unix::fs::symlink;

    let repository = TempDir::new().unwrap();
    let kernel = write_resource_tree(repository.path());
    let outside = repository.path().join("outside.py");
    fs::write(&outside, "# outside\n").unwrap();
    fs::remove_file(kernel.join("agent_worker.py")).unwrap();
    symlink(outside, kernel.join("agent_worker.py")).unwrap();

    assert!(ResourcePaths::development(repository.path()).is_err());
}

#[cfg(unix)]
#[test]
fn resources_reject_kernel_root_symlink_escaping_repository() {
    use std::os::unix::fs::symlink;

    let repository = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    let outside_kernel = write_resource_tree(outside.path());
    symlink(outside_kernel, repository.path().join("kernel")).unwrap();

    assert!(ResourcePaths::development(repository.path()).is_err());
}

#[derive(Default)]
struct FakeRunner {
    commands: Mutex<Vec<CommandSpec>>,
    fail_install: bool,
    error_install: bool,
    fail_promoted_probe: bool,
    fail_staging_probe: bool,
    failure_stderr: Option<Vec<u8>>,
}

impl CommandRunner for FakeRunner {
    fn containment(&self) -> RunnerContainment {
        RunnerContainment::Contained
    }

    fn run(&self, spec: &CommandSpec) -> Result<CommandOutput, String> {
        self.commands.lock().unwrap().push(spec.clone());
        let args: Vec<String> = spec
            .args
            .iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();

        if args.iter().any(|arg| arg == "venv") {
            let root = PathBuf::from(args.last().unwrap());
            fs::create_dir_all(venv_python(&root).parent().unwrap()).unwrap();
            fs::create_dir_all(root.join("lib/site-packages")).unwrap();
            fs::write(venv_python(&root), "# python\n").unwrap();
        }
        if args.iter().any(|arg| arg == "pip") && self.fail_install {
            return Ok(CommandOutput {
                success: false,
                stdout: vec![],
                stderr: self
                    .failure_stderr
                    .clone()
                    .unwrap_or_else(|| b"install failed".to_vec()),
            });
        }
        if args.iter().any(|arg| arg == "pip") && self.error_install {
            return Err("installer could not start".into());
        }
        if args.iter().any(|arg| arg == "-c") {
            let root = PathBuf::from(args.last().unwrap());
            if self.fail_promoted_probe && root.ends_with("v1") {
                return Ok(CommandOutput {
                    success: false,
                    stdout: vec![],
                    stderr: b"probe failed".to_vec(),
                });
            }
            if self.fail_staging_probe && root.ends_with("v1.staging") {
                return Ok(CommandOutput {
                    success: false,
                    stdout: vec![],
                    stderr: b"staging probe failed".to_vec(),
                });
            }
            let site_packages = root.join("lib/site-packages");
            return Ok(CommandOutput {
                success: true,
                stdout: format!("{}\n", site_packages.display()).into_bytes(),
                stderr: vec![],
            });
        }

        Ok(CommandOutput {
            success: true,
            stdout: vec![],
            stderr: vec![],
        })
    }
}

#[test]
fn failed_commands_report_capped_redacted_stderr() {
    let repository = TempDir::new().unwrap();
    write_resource_tree(repository.path());
    let resources = ResourcePaths::development(repository.path()).unwrap();
    let app_data = TempDir::new().unwrap();
    let runner = FakeRunner {
        fail_install: true,
        failure_stderr: Some(
            format!(
                "useful\u{0}\u{1b} diagnostic https://user:pass@example.test/path?session=abc\nAuthorization: Bearer secret-token\n{}",
                "x".repeat(5000)
            )
            .into_bytes(),
        ),
        ..Default::default()
    };
    let error = AgentEnvironment::provision_with_runner(
        app_data.path(),
        Path::new("/fixed/python3"),
        &resources,
        &runner,
    )
    .unwrap_err();
    assert!(error.contains("useful"));
    assert!(error.contains("diagnostic"));
    assert!(error.contains("[redacted]"));
    assert!(error.contains("[redacted-url]"));
    assert!(!error.contains("secret-token"));
    assert!(!error.contains("example.test"));
    assert!(!error.contains("session=abc"));
    assert!(error.contains("\\u{0}\\u{1b}"));
    assert!(error
        .chars()
        .all(|character| character == '\n' || !character.is_control()));
    assert!(error.len() < 2_200);
}

fn venv_python(root: &Path) -> PathBuf {
    if cfg!(windows) {
        root.join("Scripts/python.exe")
    } else {
        root.join("bin/python3")
    }
}

fn assert_same_canonical_path(actual: &Path, expected: &Path) {
    assert_eq!(
        actual.canonicalize().unwrap(),
        expected.canonicalize().unwrap()
    );
}

#[test]
fn canonical_path_comparison_normalizes_lexical_aliases() {
    let temporary = TempDir::new().unwrap();
    let nested = temporary.path().join("nested");
    fs::create_dir_all(&nested).unwrap();

    assert_same_canonical_path(&nested, &temporary.path().join(".").join("nested"));
}

#[derive(Clone)]
struct FailureRule {
    operation: &'static str,
    target: FailureTarget,
    skip: usize,
}

#[derive(Clone)]
enum FailureTarget {
    FileName(&'static str),
    Rename {
        from: &'static str,
        to: &'static str,
    },
}

struct FakeFilesystem {
    failures: Mutex<Vec<FailureRule>>,
}

impl FakeFilesystem {
    fn new(failures: Vec<FailureRule>) -> Self {
        Self {
            failures: Mutex::new(failures),
        }
    }

    fn should_fail(
        &self,
        operation: &'static str,
        matches_target: impl Fn(&FailureTarget) -> bool,
    ) -> bool {
        let mut failures = self.failures.lock().unwrap();
        if let Some(index) = failures
            .iter()
            .position(|failure| failure.operation == operation && matches_target(&failure.target))
        {
            if failures[index].skip > 0 {
                failures[index].skip -= 1;
            } else {
                failures.remove(index);
                return true;
            }
        }
        false
    }

    fn maybe_fail_path(&self, operation: &'static str, path: &Path) -> Result<(), String> {
        if self.should_fail(operation, |target| match target {
            FailureTarget::FileName(name) => path.file_name() == Some(OsStr::new(name)),
            FailureTarget::Rename { .. } => false,
        }) {
            return Err(format!(
                "injected {operation} failure for {}",
                path.display()
            ));
        }
        Ok(())
    }

    fn maybe_fail_rename(&self, from: &Path, to: &Path) -> Result<(), String> {
        if self.should_fail("rename", |target| match target {
            FailureTarget::Rename {
                from: expected_from,
                to: expected_to,
            } => {
                from.file_name() == Some(OsStr::new(expected_from))
                    && to.file_name() == Some(OsStr::new(expected_to))
            }
            FailureTarget::FileName(_) => false,
        }) {
            return Err(format!(
                "injected rename failure for {} -> {}",
                from.display(),
                to.display()
            ));
        }
        Ok(())
    }
}

impl EnvironmentFilesystem for FakeFilesystem {
    fn read(&self, path: &Path) -> Result<Vec<u8>, String> {
        self.maybe_fail_path("read", path)?;
        fs::read(path).map_err(|error| error.to_string())
    }

    fn read_to_string(&self, path: &Path) -> Result<String, String> {
        self.maybe_fail_path("read_to_string", path)?;
        fs::read_to_string(path).map_err(|error| error.to_string())
    }

    fn create_dir_all(&self, path: &Path) -> Result<(), String> {
        self.maybe_fail_path("create_dir_all", path)?;
        fs::create_dir_all(path).map_err(|error| error.to_string())
    }

    fn write(&self, path: &Path, contents: &[u8]) -> Result<(), String> {
        self.maybe_fail_path("write", path)?;
        fs::write(path, contents).map_err(|error| error.to_string())
    }

    fn set_readonly(&self, path: &Path) -> Result<(), String> {
        self.maybe_fail_path("set_readonly", path)?;
        let mut permissions = fs::metadata(path)
            .map_err(|error| error.to_string())?
            .permissions();
        permissions.set_readonly(true);
        fs::set_permissions(path, permissions).map_err(|error| error.to_string())
    }

    fn remove_dir_all(&self, path: &Path) -> Result<(), String> {
        self.maybe_fail_path("remove_dir_all", path)?;
        fs::remove_dir_all(path).map_err(|error| error.to_string())
    }

    fn rename(&self, from: &Path, to: &Path) -> Result<(), String> {
        self.maybe_fail_rename(from, to)?;
        fs::rename(from, to).map_err(|error| error.to_string())
    }

    fn canonicalize(&self, path: &Path) -> Result<PathBuf, String> {
        self.maybe_fail_path("canonicalize", path)?;
        path.canonicalize().map_err(|error| error.to_string())
    }

    fn exists(&self, path: &Path) -> bool {
        path.exists()
    }
}

fn path_failure(operation: &'static str, file_name: &'static str, skip: usize) -> FailureRule {
    FailureRule {
        operation,
        target: FailureTarget::FileName(file_name),
        skip,
    }
}

fn rename_failure(from: &'static str, to: &'static str, skip: usize) -> FailureRule {
    FailureRule {
        operation: "rename",
        target: FailureTarget::Rename { from, to },
        skip,
    }
}

#[test]
fn failure_injection_matches_file_names_not_rendered_path_substrings() {
    let temporary = TempDir::new().unwrap();
    let parent = temporary.path().join("parent-containing-v1");
    let unrelated = parent.join("unrelated");
    let exact = parent.join("v1");
    fs::create_dir_all(&unrelated).unwrap();
    fs::create_dir_all(&exact).unwrap();
    let filesystem = FakeFilesystem::new(vec![path_failure("remove_dir_all", "v1", 0)]);

    filesystem.remove_dir_all(&unrelated).unwrap();
    assert!(filesystem.remove_dir_all(&exact).is_err());
}

#[test]
fn marker_matched_root_is_not_accepted_until_stale_state_cleanup_succeeds() {
    let repository = TempDir::new().unwrap();
    write_resource_tree(repository.path());
    let resources = ResourcePaths::development(repository.path()).unwrap();
    let app_data = TempDir::new().unwrap();
    let runner = FakeRunner::default();
    AgentEnvironment::provision_with_runner(
        app_data.path(),
        Path::new("/fixed/python3"),
        &resources,
        &runner,
    )
    .unwrap();

    let stale = app_data.path().join("agent-runtime/v1.staging");
    fs::create_dir_all(&stale).unwrap();
    let filesystem = FakeFilesystem::new(vec![
        path_failure("remove_dir_all", "v1.staging", 0),
        path_failure("remove_dir_all", "v1.previous", 0),
    ]);
    assert!(AgentEnvironment::provision_with_filesystem(
        app_data.path(),
        Path::new("/fixed/python3"),
        &resources,
        &runner,
        &filesystem,
    )
    .is_err());
    assert!(stale.exists());

    AgentEnvironment::provision_with_filesystem(
        app_data.path(),
        Path::new("/fixed/python3"),
        &resources,
        &runner,
        &filesystem,
    )
    .unwrap();
    assert!(!stale.exists());

    let stale_backup = app_data.path().join("agent-runtime/v1.previous");
    fs::create_dir_all(&stale_backup).unwrap();
    assert!(AgentEnvironment::provision_with_filesystem(
        app_data.path(),
        Path::new("/fixed/python3"),
        &resources,
        &runner,
        &filesystem,
    )
    .is_err());
    assert!(stale_backup.exists());
    AgentEnvironment::provision_with_filesystem(
        app_data.path(),
        Path::new("/fixed/python3"),
        &resources,
        &runner,
        &filesystem,
    )
    .unwrap();
    assert!(!stale_backup.exists());

    let installations = runner
        .commands
        .lock()
        .unwrap()
        .iter()
        .filter(|command| command.args.iter().any(|arg| arg == "venv"))
        .count();
    assert_eq!(installations, 1);
}

#[test]
fn concurrent_provisioning_serializes_installation_and_reuses_verified_root() {
    let repository = TempDir::new().unwrap();
    write_resource_tree(repository.path());
    let resources = Arc::new(ResourcePaths::development(repository.path()).unwrap());
    let app_data = Arc::new(TempDir::new().unwrap());
    let runner = Arc::new(FakeRunner::default());
    let start = Arc::new(Barrier::new(3));

    let handles = (0..2)
        .map(|_| {
            let resources = Arc::clone(&resources);
            let app_data = Arc::clone(&app_data);
            let runner = Arc::clone(&runner);
            let start = Arc::clone(&start);
            thread::spawn(move || {
                start.wait();
                AgentEnvironment::provision_with_runner(
                    app_data.path(),
                    Path::new("/fixed/python3"),
                    &resources,
                    runner.as_ref(),
                )
                .unwrap()
            })
        })
        .collect::<Vec<_>>();
    start.wait();
    let environments = handles
        .into_iter()
        .map(|handle| handle.join().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(environments[0], environments[1]);
    let installations = runner
        .commands
        .lock()
        .unwrap()
        .iter()
        .filter(|command| command.args.iter().any(|arg| arg == "venv"))
        .count();
    assert_eq!(installations, 1);
}

struct MutatingRequirementsRunner {
    inner: FakeRunner,
    source: PathBuf,
    installed_bytes: Mutex<Option<Vec<u8>>>,
    staged_readonly: Mutex<Option<bool>>,
}

impl CommandRunner for MutatingRequirementsRunner {
    fn containment(&self) -> RunnerContainment {
        RunnerContainment::Contained
    }

    fn run(&self, spec: &CommandSpec) -> Result<CommandOutput, String> {
        if spec.args.iter().any(|arg| arg == "venv") {
            fs::write(&self.source, "keyring>=25\n").unwrap();
        }
        if spec.args.iter().any(|arg| arg == "pip") {
            let requirements = spec.args.last().unwrap();
            *self.installed_bytes.lock().unwrap() = Some(fs::read(requirements).unwrap());
            *self.staged_readonly.lock().unwrap() =
                Some(fs::metadata(requirements).unwrap().permissions().readonly());
        }
        self.inner.run(spec)
    }
}

#[test]
fn provisioning_installs_immutable_bytes_read_before_resource_mutation() {
    let repository = TempDir::new().unwrap();
    write_resource_tree(repository.path());
    let resources = ResourcePaths::development(repository.path()).unwrap();
    let runner = MutatingRequirementsRunner {
        inner: FakeRunner::default(),
        source: resources.requirements.clone(),
        installed_bytes: Mutex::new(None),
        staged_readonly: Mutex::new(None),
    };
    let app_data = TempDir::new().unwrap();
    AgentEnvironment::provision_with_runner(
        app_data.path(),
        Path::new("/fixed/python3"),
        &resources,
        &runner,
    )
    .unwrap();

    assert_eq!(
        runner.installed_bytes.lock().unwrap().as_deref(),
        Some(REQUIREMENTS.as_bytes())
    );
    assert_eq!(*runner.staged_readonly.lock().unwrap(), Some(true));
    let expected_hash = hex::encode(sha2::Sha256::digest(REQUIREMENTS.as_bytes()));
    assert_eq!(
        fs::read_to_string(
            app_data
                .path()
                .join("agent-runtime/v1/.requirements-sha256")
        )
        .unwrap(),
        expected_hash
    );
}

#[test]
fn production_runner_and_provisioning_fail_before_spawn_or_mutation() {
    use app_lib::agent_runtime::unsupported::UNAVAILABLE_MESSAGE;

    let temporary = TempDir::new().unwrap();
    let marker = temporary.path().join("must-not-exist");
    let spec = CommandSpec {
        program: PathBuf::from("definitely-not-a-contained-runner"),
        args: vec![marker.as_os_str().to_owned()],
        environment: vec![],
        clear_environment: false,
    };
    assert_eq!(
        SystemCommandRunner::run_with_limits(&spec, Duration::from_secs(1), 256).unwrap_err(),
        UNAVAILABLE_MESSAGE
    );
    assert!(!marker.exists());

    let repository = TempDir::new().unwrap();
    write_resource_tree(repository.path());
    let resources = ResourcePaths::development(repository.path()).unwrap();
    let app_data = TempDir::new().unwrap();
    assert_eq!(
        AgentEnvironment::provision(
            app_data.path(),
            Path::new("/unqualified/python"),
            &resources,
        )
        .unwrap_err(),
        UNAVAILABLE_MESSAGE
    );
    assert!(!app_data.path().join("agent-runtime").exists());
}

#[test]
fn provisioning_uses_only_a_dedicated_versioned_environment_and_clean_commands() {
    let repository = TempDir::new().unwrap();
    write_resource_tree(repository.path());
    let resources = ResourcePaths::development(repository.path()).unwrap();
    let app_data = TempDir::new().unwrap();
    let runner = FakeRunner::default();

    let environment = AgentEnvironment::provision_with_runner(
        app_data.path(),
        Path::new("/fixed/python3"),
        &resources,
        &runner,
    )
    .unwrap();

    assert_same_canonical_path(&environment.root, &app_data.path().join("agent-runtime/v1"));
    environment.verify().unwrap();
    let commands = runner.commands.lock().unwrap();
    assert!(commands.iter().all(|command| command.clear_environment));
    #[cfg(unix)]
    assert!(commands.iter().all(|command| command
        .environment
        .iter()
        .any(|(name, value)| name == "PATH" && value == "/usr/bin:/bin")));
    #[cfg(windows)]
    assert!(commands.iter().all(|command| command
        .environment
        .iter()
        .any(|(name, value)| name == "PATH" && value == r"C:\Windows\System32")));
    let install = commands
        .iter()
        .find(|command| command.args.iter().any(|arg| arg == "pip"))
        .unwrap();
    assert!(install
        .environment
        .iter()
        .any(|(name, value)| name == "PIP_CONFIG_FILE"
            && value.to_string_lossy().ends_with("pip-empty.conf")));
    let probe = commands
        .iter()
        .find(|command| command.args.iter().any(|arg| arg == "-c"))
        .unwrap();
    let probe_source = probe
        .args
        .iter()
        .find(|arg| arg.to_string_lossy().contains("importlib.util"))
        .unwrap()
        .to_string_lossy();
    for import in ["qiskit_aer", "cirq", "qdk", "keyring", "cudaq"] {
        assert!(probe_source.contains(import));
    }
}

#[test]
fn failed_install_removes_staging_without_replacing_existing_environment() {
    let repository = TempDir::new().unwrap();
    write_resource_tree(repository.path());
    let resources = ResourcePaths::development(repository.path()).unwrap();
    let app_data = TempDir::new().unwrap();
    let existing = app_data.path().join("agent-runtime/v1");
    fs::create_dir_all(&existing).unwrap();
    fs::write(existing.join("sentinel"), "keep").unwrap();
    let runner = FakeRunner {
        fail_install: true,
        ..Default::default()
    };

    assert!(AgentEnvironment::provision_with_runner(
        app_data.path(),
        Path::new("/fixed/python3"),
        &resources,
        &runner,
    )
    .is_err());
    assert_eq!(
        fs::read_to_string(existing.join("sentinel")).unwrap(),
        "keep"
    );
    assert!(!app_data.path().join("agent-runtime/v1.staging").exists());
}

#[test]
fn installer_runner_error_also_removes_staging() {
    let repository = TempDir::new().unwrap();
    write_resource_tree(repository.path());
    let resources = ResourcePaths::development(repository.path()).unwrap();
    let app_data = TempDir::new().unwrap();
    let runner = FakeRunner {
        error_install: true,
        ..Default::default()
    };

    assert!(AgentEnvironment::provision_with_runner(
        app_data.path(),
        Path::new("/fixed/python3"),
        &resources,
        &runner,
    )
    .is_err());
    assert!(!app_data.path().join("agent-runtime/v1.staging").exists());
}

#[test]
fn failed_promoted_verification_rolls_back_previous_environment() {
    let repository = TempDir::new().unwrap();
    write_resource_tree(repository.path());
    let resources = ResourcePaths::development(repository.path()).unwrap();
    let app_data = TempDir::new().unwrap();
    let existing = app_data.path().join("agent-runtime/v1");
    fs::create_dir_all(&existing).unwrap();
    fs::write(existing.join("sentinel"), "previous").unwrap();
    let runner = FakeRunner {
        fail_promoted_probe: true,
        ..Default::default()
    };

    assert!(AgentEnvironment::provision_with_runner(
        app_data.path(),
        Path::new("/fixed/python3"),
        &resources,
        &runner,
    )
    .is_err());
    assert_eq!(
        fs::read_to_string(existing.join("sentinel")).unwrap(),
        "previous"
    );
}

#[test]
fn staging_write_and_probe_failures_clean_staging() {
    for (filesystem, runner) in [
        (
            FakeFilesystem::new(vec![path_failure("write", "pip-empty.conf", 0)]),
            FakeRunner::default(),
        ),
        (
            FakeFilesystem::new(vec![path_failure("write", ".requirements-sha256", 0)]),
            FakeRunner::default(),
        ),
        (
            FakeFilesystem::new(vec![]),
            FakeRunner {
                fail_staging_probe: true,
                ..Default::default()
            },
        ),
    ] {
        let repository = TempDir::new().unwrap();
        write_resource_tree(repository.path());
        let resources = ResourcePaths::development(repository.path()).unwrap();
        let app_data = TempDir::new().unwrap();
        assert!(AgentEnvironment::provision_with_filesystem(
            app_data.path(),
            Path::new("/fixed/python3"),
            &resources,
            &runner,
            &filesystem,
        )
        .is_err());
        assert!(!app_data.path().join("agent-runtime/v1.staging").exists());
    }
}

#[test]
fn cleanup_failure_is_combined_with_primary_staging_error() {
    let repository = TempDir::new().unwrap();
    write_resource_tree(repository.path());
    let resources = ResourcePaths::development(repository.path()).unwrap();
    let app_data = TempDir::new().unwrap();
    let runner = FakeRunner {
        fail_install: true,
        ..Default::default()
    };
    let filesystem = FakeFilesystem::new(vec![path_failure("remove_dir_all", "v1.staging", 0)]);

    let error = AgentEnvironment::provision_with_filesystem(
        app_data.path(),
        Path::new("/fixed/python3"),
        &resources,
        &runner,
        &filesystem,
    )
    .unwrap_err();
    assert!(error.contains("dependency installation"));
    assert!(error.contains("clean staging"));
    assert!(app_data.path().join("agent-runtime/v1.staging").exists());
}

#[test]
fn root_move_or_promotion_failure_cleans_staging_and_restores_previous_root() {
    for rule in [
        rename_failure("v1", "v1.previous", 0),
        rename_failure("v1.staging", "v1", 0),
    ] {
        let repository = TempDir::new().unwrap();
        write_resource_tree(repository.path());
        let resources = ResourcePaths::development(repository.path()).unwrap();
        let app_data = TempDir::new().unwrap();
        let root = app_data.path().join("agent-runtime/v1");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("sentinel"), "previous").unwrap();
        let filesystem = FakeFilesystem::new(vec![rule]);

        assert!(AgentEnvironment::provision_with_filesystem(
            app_data.path(),
            Path::new("/fixed/python3"),
            &resources,
            &FakeRunner::default(),
            &filesystem,
        )
        .is_err());
        assert_eq!(
            fs::read_to_string(root.join("sentinel")).unwrap(),
            "previous"
        );
        assert!(!app_data.path().join("agent-runtime/v1.staging").exists());
    }
}

#[test]
fn promotion_and_restore_failure_reports_both_errors() {
    let repository = TempDir::new().unwrap();
    write_resource_tree(repository.path());
    let resources = ResourcePaths::development(repository.path()).unwrap();
    let app_data = TempDir::new().unwrap();
    let root = app_data.path().join("agent-runtime/v1");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("sentinel"), "previous").unwrap();
    let filesystem = FakeFilesystem::new(vec![
        rename_failure("v1.staging", "v1", 0),
        rename_failure("v1.previous", "v1", 0),
    ]);

    let error = AgentEnvironment::provision_with_filesystem(
        app_data.path(),
        Path::new("/fixed/python3"),
        &resources,
        &FakeRunner::default(),
        &filesystem,
    )
    .unwrap_err();
    assert!(error.contains("promotion"));
    assert!(error.contains("restore"));
    assert!(app_data.path().join("agent-runtime/v1.previous").exists());
}

#[test]
fn stale_backup_removal_failure_cleans_staging_and_is_reported() {
    let repository = TempDir::new().unwrap();
    write_resource_tree(repository.path());
    let resources = ResourcePaths::development(repository.path()).unwrap();
    let app_data = TempDir::new().unwrap();
    let backup = app_data.path().join("agent-runtime/v1.previous");
    fs::create_dir_all(&backup).unwrap();
    let filesystem = FakeFilesystem::new(vec![path_failure("remove_dir_all", "v1.previous", 0)]);

    let error = AgentEnvironment::provision_with_filesystem(
        app_data.path(),
        Path::new("/fixed/python3"),
        &resources,
        &FakeRunner::default(),
        &filesystem,
    )
    .unwrap_err();
    assert!(error.contains("stale previous"), "{error}");
    assert!(!app_data.path().join("agent-runtime/v1.staging").exists());
}

#[test]
fn promoted_probe_restore_failure_is_explicit() {
    let repository = TempDir::new().unwrap();
    write_resource_tree(repository.path());
    let resources = ResourcePaths::development(repository.path()).unwrap();
    let app_data = TempDir::new().unwrap();
    let root = app_data.path().join("agent-runtime/v1");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("sentinel"), "previous").unwrap();
    let filesystem = FakeFilesystem::new(vec![rename_failure("v1.previous", "v1", 0)]);
    let runner = FakeRunner {
        fail_promoted_probe: true,
        ..Default::default()
    };

    let error = AgentEnvironment::provision_with_filesystem(
        app_data.path(),
        Path::new("/fixed/python3"),
        &resources,
        &runner,
        &filesystem,
    )
    .unwrap_err();
    assert!(error.contains("restore previous"), "{error}");
    assert!(app_data.path().join("agent-runtime/v1.previous").exists());
}

#[test]
fn promoted_probe_cleanup_and_backup_removal_failures_are_reported() {
    for (runner, filesystem, expected) in [
        (
            FakeRunner {
                fail_promoted_probe: true,
                ..Default::default()
            },
            FakeFilesystem::new(vec![path_failure("remove_dir_all", "v1", 0)]),
            "remove failed promoted",
        ),
        (
            FakeRunner::default(),
            FakeFilesystem::new(vec![path_failure("remove_dir_all", "v1.previous", 0)]),
            "remove previous",
        ),
    ] {
        let repository = TempDir::new().unwrap();
        write_resource_tree(repository.path());
        let resources = ResourcePaths::development(repository.path()).unwrap();
        let app_data = TempDir::new().unwrap();
        let root = app_data.path().join("agent-runtime/v1");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("sentinel"), "previous").unwrap();

        let error = AgentEnvironment::provision_with_filesystem(
            app_data.path(),
            Path::new("/fixed/python3"),
            &resources,
            &runner,
            &filesystem,
        )
        .unwrap_err();
        assert!(error.contains(expected), "{error}");
    }
}

#[cfg(unix)]
#[test]
fn existing_environment_symlink_escaping_app_data_is_rejected() {
    use std::os::unix::fs::symlink;

    let repository = TempDir::new().unwrap();
    write_resource_tree(repository.path());
    let resources = ResourcePaths::development(repository.path()).unwrap();
    let app_data = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    fs::create_dir_all(app_data.path().join("agent-runtime")).unwrap();
    symlink(outside.path(), app_data.path().join("agent-runtime/v1")).unwrap();

    assert!(AgentEnvironment::provision_with_runner(
        app_data.path(),
        Path::new("/fixed/python3"),
        &resources,
        &FakeRunner::default(),
    )
    .is_err());
}

#[cfg(unix)]
#[test]
fn returned_environment_paths_are_canonical_under_canonical_app_data() {
    use std::os::unix::fs::symlink;

    let repository = TempDir::new().unwrap();
    write_resource_tree(repository.path());
    let resources = ResourcePaths::development(repository.path()).unwrap();
    let actual_app_data = TempDir::new().unwrap();
    let alias_parent = TempDir::new().unwrap();
    let alias = alias_parent.path().join("app-data-link");
    symlink(actual_app_data.path(), &alias).unwrap();

    let environment = AgentEnvironment::provision_with_runner(
        &alias,
        Path::new("/fixed/python3"),
        &resources,
        &FakeRunner::default(),
    )
    .unwrap();
    let canonical_parent = actual_app_data.path().canonicalize().unwrap();
    for path in [
        &environment.root,
        &environment.python,
        &environment.site_packages,
    ] {
        assert_eq!(path, &path.canonicalize().unwrap());
        assert!(path.starts_with(&canonical_parent));
    }
}

#[test]
fn environment_verification_rejects_paths_outside_dedicated_root() {
    let app_data = TempDir::new().unwrap();
    let root = app_data.path().join("agent-runtime/v1");
    fs::create_dir_all(venv_python(&root).parent().unwrap()).unwrap();
    fs::write(venv_python(&root), "").unwrap();
    let outside = TempDir::new().unwrap();

    let environment = AgentEnvironment {
        root: root.clone(),
        python: venv_python(&root),
        site_packages: outside.path().to_path_buf(),
    };
    assert!(environment.verify().is_err());
}

#[test]
fn unsupported_platform_message_is_stable() {
    assert_eq!(
        app_lib::agent_runtime::unsupported::unavailable_message(),
        "Agent isolation is unavailable on this platform"
    );
}

#[tokio::test]
async fn agent_runtime_state_starts_unavailable_and_is_command_capable() {
    fn assert_command_state<T: AgentRuntimeCommands>() {}
    assert_command_state::<AgentRuntimeState>();

    let state = AgentRuntimeState::new();
    let report = state.cached_capability().await;
    assert!(!report.available);
    assert_eq!(
        report.reason.as_deref(),
        Some("Agent isolation is unavailable on this platform")
    );
    assert!(report.qualified_frameworks.is_empty());
    assert!(report.controls.is_empty());
}

#[cfg(unix)]
fn python_spec(script: &str) -> ProcessSpec {
    let executable = ["/usr/bin/python3", "/usr/local/bin/python3"]
        .into_iter()
        .map(PathBuf::from)
        .find(|path| path.is_file())
        .expect("fixed Python test harness");
    ProcessSpec {
        executable,
        args: vec!["-c".into(), script.into()],
        cwd: std::env::temp_dir(),
        env: std::collections::BTreeMap::new(),
        cleanup_root: None,
        resource_limits: ResourceLimits::testing(),
        runtime_guard: None,
        #[cfg(target_os = "linux")]
        linux: None,
    }
}

#[cfg(unix)]
fn agent_request(id: &str) -> WorkerRequestV1 {
    WorkerRequestV1 {
        protocol_version: 1,
        request_id: id.into(),
        action: Action::Parse,
        framework: Framework::Cirq,
        language: "python".into(),
        code: String::new(),
        shots: None,
    }
}

#[cfg(unix)]
fn valid_worker_script(id: &str) -> String {
    let response = json!({
        "protocol_version": 1,
        "request_id": id,
        "status": "ok",
        "snapshot": null,
        "result": null,
        "stdout": "",
        "stderr": "",
        "error": null
    })
    .to_string();
    format!("import sys;sys.stdout.write({response:?}+'\\n')")
}

#[cfg(unix)]
#[tokio::test]
async fn supervisor_holds_runtime_generation_lease_until_worker_reaped() {
    use fs2::FileExt;
    use std::fs::OpenOptions;

    let root = TempDir::new().unwrap();
    let lock_path = root.path().join(".provision.lock");
    fs::write(&lock_path, "").unwrap();
    let lease = OpenOptions::new().read(true).open(&lock_path).unwrap();
    lease.lock_shared().unwrap();
    let response_script = valid_worker_script("lease-held");
    let mut spec = python_spec(&format!("import time;time.sleep(0.05);{response_script}"));
    spec.runtime_guard = Some(Arc::new(lease));
    let request = agent_request("lease-held");
    let run = tokio::spawn(async move {
        Supervisor::new(SupervisorLimits::testing())
            .run(&request, spec, b"")
            .await
    });

    tokio::time::sleep(Duration::from_millis(10)).await;
    let update = OpenOptions::new()
        .read(true)
        .write(true)
        .open(&lock_path)
        .unwrap();
    assert!(update.try_lock_exclusive().is_err());
    run.await.unwrap().unwrap();
    update.try_lock_exclusive().unwrap();
}

#[cfg(unix)]
async fn assert_fresh_worker(supervisor: &Supervisor, id: &str) {
    let response = supervisor
        .run(
            &agent_request(id),
            python_spec(&valid_worker_script(id)),
            b"",
        )
        .await
        .expect("fresh worker succeeds after terminal path");
    assert_eq!(response.request_id, id);
}

#[cfg(unix)]
#[tokio::test]
async fn supervisor_removes_the_unique_request_directory_after_execution() {
    let parent = TempDir::new().unwrap();
    let request_root = parent.path().join("request");
    fs::create_dir(&request_root).unwrap();
    let mut spec = python_spec(&valid_worker_script("cleanup"));
    spec.cwd = request_root.clone();
    spec.cleanup_root = Some(request_root.clone());
    let supervisor = Supervisor::new(SupervisorLimits::testing());

    supervisor
        .run(&agent_request("cleanup"), spec, b"")
        .await
        .unwrap();
    assert!(!request_root.exists());
}

#[cfg(unix)]
#[tokio::test]
async fn parent_applies_every_resource_limit_before_python_starts() {
    let limits = ResourceLimits::production();
    let payload = json!({
        "protocol_version": 1,
        "request_id": "parent_limits",
        "status": "ok",
        "snapshot": null,
        "result": null,
        "stdout": "",
        "stderr": "",
        "error": null
    })
    .to_string();
    let script = format!(
        "import json,resource\npairs=[resource.getrlimit(item) for item in [resource.RLIMIT_CPU,resource.RLIMIT_AS,resource.RLIMIT_FSIZE,resource.RLIMIT_NOFILE,resource.RLIMIT_NPROC,resource.RLIMIT_CORE]]\nvalue=json.loads({payload:?});value['stdout']=json.dumps(pairs,separators=(',',':'));print(json.dumps(value,separators=(',',':')))"
    );
    let mut spec = python_spec(&script);
    spec.resource_limits = limits;

    let response = Supervisor::new(SupervisorLimits::production())
        .run(&agent_request("parent_limits"), spec, b"")
        .await
        .unwrap();
    let expected = vec![
        vec![limits.cpu_seconds, limits.cpu_seconds],
        vec![limits.address_space_bytes, limits.address_space_bytes],
        vec![limits.file_bytes, limits.file_bytes],
        vec![limits.open_files, limits.open_files],
        vec![limits.processes, limits.processes],
        vec![0, 0],
    ];
    assert_eq!(
        serde_json::from_str::<Vec<Vec<u64>>>(&response.stdout).unwrap(),
        expected
    );
}

#[cfg(unix)]
#[tokio::test]
async fn parent_resource_limit_failure_aborts_before_exec() {
    let temporary = TempDir::new().unwrap();
    let marker = temporary.path().join("must-not-exec");
    let mut spec = python_spec(&format!(
        "open({:?},'w').write('executed')",
        marker.to_string_lossy()
    ));
    spec.resource_limits.open_files = u64::MAX - 1;

    let error = Supervisor::new(SupervisorLimits::testing())
        .run(&agent_request("invalid_parent_limit"), spec, b"")
        .await
        .unwrap_err();
    assert_eq!(error.code, "worker_start_failed");
    assert!(!marker.exists());
}

#[cfg(unix)]
struct BlockingResolver {
    blocked_id: String,
    entered: Arc<tokio::sync::Notify>,
    release: Arc<tokio::sync::Notify>,
    spawn_marker: PathBuf,
}

#[cfg(unix)]
struct FailingResolver;

#[cfg(unix)]
struct CleanupFailingResolver(PathBuf);

#[cfg(unix)]
impl AgentProcessResolver for FailingResolver {
    fn resolve<'a>(
        &'a self,
        _request: &'a WorkerRequestV1,
    ) -> Pin<Box<dyn Future<Output = Result<ProcessSpec, String>> + Send + 'a>> {
        Box::pin(async { Err("qualified backend identity changed".into()) })
    }
}

#[cfg(unix)]
impl AgentProcessResolver for CleanupFailingResolver {
    fn resolve<'a>(
        &'a self,
        request: &'a WorkerRequestV1,
    ) -> Pin<Box<dyn Future<Output = Result<ProcessSpec, String>> + Send + 'a>> {
        Box::pin(async move {
            let mut spec = python_spec(&valid_worker_script(&request.request_id));
            spec.cleanup_root = Some(self.0.clone());
            Ok(spec)
        })
    }
}

#[cfg(unix)]
impl AgentProcessResolver for BlockingResolver {
    fn resolve<'a>(
        &'a self,
        request: &'a WorkerRequestV1,
    ) -> Pin<Box<dyn Future<Output = Result<ProcessSpec, String>> + Send + 'a>> {
        Box::pin(async move {
            if self.blocked_id == "*" || request.request_id == self.blocked_id {
                self.entered.notify_one();
                self.release.notified().await;
            }
            let script = if request.request_id == "other" {
                format!(
                    "import pathlib,time;pathlib.Path({:?}).write_text('spawned');time.sleep(5)",
                    self.spawn_marker.to_string_lossy()
                )
            } else {
                format!(
                    "import pathlib;pathlib.Path({:?}).write_text('spawned');{}",
                    self.spawn_marker.to_string_lossy(),
                    valid_worker_script(&request.request_id)
                )
            };
            Ok(python_spec(&script))
        })
    }
}

#[cfg(unix)]
fn available_cirq_capability() -> CapabilityReport {
    CapabilityReport {
        available: true,
        reason: None,
        qualified_frameworks: vec!["cirq".into()],
        controls: Vec::new(),
    }
}

#[cfg(unix)]
#[tokio::test]
async fn resolver_identity_failure_atomically_clears_capability() {
    let state = AgentRuntimeState::with_resolver(
        Supervisor::new(SupervisorLimits::testing()),
        available_cirq_capability(),
        Arc::new(FailingResolver),
    );

    assert_eq!(
        state
            .execute_request(agent_request("stale_backend"))
            .await
            .unwrap_err(),
        "qualified backend identity changed"
    );
    let report = state.cached_capability().await;
    assert!(!report.available);
    assert!(report.qualified_frameworks.is_empty());
    assert!(report.controls.is_empty());
}

#[cfg(unix)]
#[tokio::test]
async fn supervisor_cleanup_failure_atomically_revokes_matching_capability() {
    let temporary = TempDir::new().unwrap();
    let not_a_directory = temporary.path().join("cleanup-root");
    fs::write(&not_a_directory, "file").unwrap();
    let state = AgentRuntimeState::with_resolver(
        Supervisor::new(SupervisorLimits::testing()),
        available_cirq_capability(),
        Arc::new(CleanupFailingResolver(not_a_directory)),
    );

    assert_eq!(
        state
            .execute_request(agent_request("cleanup_revokes"))
            .await
            .unwrap_err(),
        "Worker request directory could not be removed"
    );
    assert!(!state.cached_capability().await.available);
}

#[cfg(unix)]
#[test]
fn supervisor_limits_and_errors_are_stable() {
    let production = SupervisorLimits::production();
    assert_eq!(production.wall, Duration::from_secs(15));
    assert_eq!(production.stdout_bytes, 1_048_576);
    assert_eq!(production.stderr_bytes, 65_536);

    let testing = SupervisorLimits::testing();
    assert!(testing.wall < production.wall);
    assert!(testing.stdout_bytes < production.stdout_bytes);
    assert!(testing.stderr_bytes < production.stderr_bytes);
}

#[cfg(unix)]
#[tokio::test]
async fn cancellation_reserved_before_blocked_resolution_prevents_spawn() {
    let temporary = TempDir::new().unwrap();
    let marker = temporary.path().join("must-not-spawn");
    let entered = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let state = AgentRuntimeState::with_resolver(
        Supervisor::new(SupervisorLimits {
            wall: Duration::from_secs(1),
            stdout_bytes: 1_024,
            stderr_bytes: 1_024,
        }),
        available_cirq_capability(),
        Arc::new(BlockingResolver {
            blocked_id: "pending".into(),
            entered: Arc::clone(&entered),
            release: Arc::clone(&release),
            spawn_marker: marker.clone(),
        }),
    );
    let execute = state.execute_request(agent_request("pending"));
    assert_eq!(state.supervisor.active_count(), 1);

    let controller = async {
        entered.notified().await;
        let cancel = state.supervisor.cancel("pending");
        assert!(state.supervisor.is_cancelled("pending"));
        release.notify_one();
        cancel.await.unwrap();
    };
    let (result, ()) = tokio::join!(execute, controller);

    assert_eq!(result.unwrap_err(), "Worker request was cancelled");
    assert!(!marker.exists());
    assert_eq!(state.supervisor.active_count(), 0);
}

#[cfg(unix)]
#[tokio::test]
async fn blocked_resolution_does_not_block_cancelling_another_worker() {
    let temporary = TempDir::new().unwrap();
    let marker = temporary.path().join("other-spawned");
    let entered = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let state = Arc::new(AgentRuntimeState::with_resolver(
        Supervisor::new(SupervisorLimits {
            wall: Duration::from_secs(1),
            stdout_bytes: 1_024,
            stderr_bytes: 1_024,
        }),
        available_cirq_capability(),
        Arc::new(BlockingResolver {
            blocked_id: "slow".into(),
            entered: Arc::clone(&entered),
            release: Arc::clone(&release),
            spawn_marker: marker.clone(),
        }),
    ));
    let slow = {
        let state = Arc::clone(&state);
        tokio::spawn(async move { state.execute_request(agent_request("slow")).await })
    };
    entered.notified().await;
    let other = {
        let state = Arc::clone(&state);
        tokio::spawn(async move { state.execute_request(agent_request("other")).await })
    };
    tokio::time::timeout(Duration::from_millis(300), async {
        while !marker.exists() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("other worker spawns while slow resolution is pending");

    tokio::time::timeout(Duration::from_millis(300), state.supervisor.cancel("other"))
        .await
        .expect("slow resolution must not hold the active registry lock")
        .unwrap();
    assert_eq!(
        other.await.unwrap().unwrap_err(),
        "Worker request was cancelled"
    );
    tokio::time::timeout(Duration::from_millis(300), state.supervisor.cancel("slow"))
        .await
        .expect("pending resolution cancellation completes")
        .unwrap();
    release.notify_one();
    assert_eq!(
        slow.await.unwrap().unwrap_err(),
        "Worker request was cancelled"
    );
    assert_eq!(state.supervisor.active_count(), 0);
}

#[cfg(unix)]
#[tokio::test]
async fn unavailable_execute_and_cancel_all_preserve_pending_cancellation_order() {
    let unavailable = AgentRuntimeState::new();
    let execute = unavailable.execute_request(agent_request("unavailable_pending"));
    let cancel = unavailable.supervisor.cancel("unavailable_pending");
    let (result, cancel_result) = tokio::join!(execute, cancel);
    cancel_result.unwrap();
    assert_eq!(result.unwrap_err(), "Worker request was cancelled");

    let temporary = TempDir::new().unwrap();
    let state = AgentRuntimeState::with_resolver(
        Supervisor::new(SupervisorLimits {
            wall: Duration::from_secs(1),
            stdout_bytes: 1_024,
            stderr_bytes: 1_024,
        }),
        available_cirq_capability(),
        Arc::new(BlockingResolver {
            blocked_id: "*".into(),
            entered: Arc::new(tokio::sync::Notify::new()),
            release: Arc::new(tokio::sync::Notify::new()),
            spawn_marker: temporary.path().join("must-not-spawn"),
        }),
    );
    let first = state.execute_request(agent_request("pending_all_1"));
    let second = state.execute_request(agent_request("pending_all_2"));
    assert_eq!(state.supervisor.active_count(), 2);
    let cancel_all = state.supervisor.cancel_all();
    let (first, second, ()) = tokio::join!(first, second, cancel_all);
    assert_eq!(first.unwrap_err(), "Worker request was cancelled");
    assert_eq!(second.unwrap_err(), "Worker request was cancelled");
    assert_eq!(state.supervisor.active_count(), 0);
}

#[cfg(unix)]
#[tokio::test]
async fn direct_run_reserves_request_id_before_the_future_is_polled() {
    let supervisor = Supervisor::new(SupervisorLimits::testing());
    let request = agent_request("reserved_direct");
    let run = supervisor.run(
        &request,
        python_spec(&valid_worker_script("reserved_direct")),
        b"",
    );

    assert_eq!(supervisor.active_count(), 1);
    drop(run);
    assert_eq!(supervisor.active_count(), 0);
}

#[cfg(unix)]
#[tokio::test]
async fn raw_stdout_is_capped_before_utf8_and_json_validation() {
    let supervisor = Supervisor::new(SupervisorLimits::testing());

    let error = supervisor
        .run(
            &agent_request("flood"),
            python_spec("import os;os.write(1,b'\\xff'*5000)"),
            b"",
        )
        .await
        .unwrap_err();
    assert_eq!(error.code, "response_too_large");
    assert_eq!(error.message, "Worker response exceeded the byte limit");
    assert_fresh_worker(&supervisor, "fresh_flood").await;

    let error = supervisor
        .run(
            &agent_request("utf8"),
            python_spec("import os;os.write(1,b'\\xff\\n')"),
            b"",
        )
        .await
        .unwrap_err();
    assert_eq!(error.code, "malformed_response");
    assert_eq!(error.message, "Worker returned a malformed response");
    assert_fresh_worker(&supervisor, "fresh_utf8").await;

    let error = supervisor
        .run(
            &agent_request("multi"),
            python_spec("print('{}');print('{}')"),
            b"",
        )
        .await
        .unwrap_err();
    assert_eq!(error.code, "malformed_response");
    assert_fresh_worker(&supervisor, "fresh_multi").await;
}

#[cfg(unix)]
#[tokio::test]
async fn endless_raw_floods_are_killed_as_soon_as_the_cap_is_observed() {
    for (id, fd, expected) in [
        ("endless_stdout", 1, "response_too_large"),
        ("endless_stderr", 2, "stderr_too_large"),
    ] {
        let supervisor = Supervisor::new(SupervisorLimits {
            wall: Duration::from_secs(1),
            stdout_bytes: 1_024,
            stderr_bytes: 1_024,
        });
        let started = tokio::time::Instant::now();
        let script = format!("import os\nwhile True: os.write({fd},b'x'*8192)");
        let error = supervisor
            .run(&agent_request(id), python_spec(&script), b"")
            .await
            .unwrap_err();

        assert_eq!(error.code, expected);
        assert!(
            started.elapsed() < Duration::from_millis(300),
            "overflow waited for the wall deadline: {:?}",
            started.elapsed()
        );
        assert_fresh_worker(&supervisor, &format!("fresh_{id}")).await;
    }
}

#[cfg(unix)]
#[tokio::test]
async fn timeout_crash_stderr_overflow_and_bad_framing_reap_workers() {
    let supervisor = Supervisor::new(SupervisorLimits::testing());
    for (id, script, code) in [
        ("timeout", "import time;time.sleep(5)", "wall_timeout"),
        ("crash", "raise SystemExit(2)", "worker_failed"),
        (
            "stderr",
            "import os;os.write(2,b'x'*5000)",
            "stderr_too_large",
        ),
        (
            "spacing",
            "print('{ \"protocol_version\": 1 }')",
            "malformed_response",
        ),
        (
            "nonewline",
            "import sys;sys.stdout.write('{}')",
            "malformed_response",
        ),
    ] {
        let error = supervisor
            .run(&agent_request(id), python_spec(script), b"")
            .await
            .unwrap_err();
        assert_eq!(error.code, code, "{id}: {}", error.message);
        assert_fresh_worker(&supervisor, &format!("fresh_{id}")).await;
    }
}

#[cfg(unix)]
#[tokio::test]
async fn wall_timeout_covers_descendants_holding_worker_pipes() {
    let supervisor = Supervisor::new(SupervisorLimits::testing());
    let request = agent_request("pipe_holder");
    let run = supervisor.run(
        &request,
        python_spec("import os,time\nif os.fork()==0:\n time.sleep(5)\nelse:\n os._exit(0)"),
        b"",
    );
    let error = tokio::time::timeout(Duration::from_millis(500), run)
        .await
        .expect("supervisor itself must not hang")
        .unwrap_err();
    assert_eq!(error.code, "wall_timeout");
    assert_fresh_worker(&supervisor, "fresh_pipe_holder").await;
}

#[cfg(unix)]
#[tokio::test]
async fn successful_leader_cleanup_kills_same_group_descendants_before_reap() {
    let supervisor = Supervisor::new(SupervisorLimits::testing());
    let temporary = TempDir::new().unwrap();
    let marker = temporary.path().join("same-group-descendant-survived");
    let valid = json!({
        "protocol_version": 1,
        "request_id": "same_group",
        "status": "ok",
        "snapshot": null,
        "result": null,
        "stdout": "",
        "stderr": "",
        "error": null
    })
    .to_string();
    let script = format!(
        "import os,time,sys\npid=os.fork()\nif pid==0:\n os.close(0);os.close(1);os.close(2);time.sleep(.3);open({:?},'w').write('survived');os._exit(0)\nsys.stdout.write({valid:?}+'\\n');sys.stdout.flush();os._exit(0)",
        marker.to_string_lossy()
    );

    let response = supervisor
        .run(&agent_request("same_group"), python_spec(&script), b"")
        .await
        .unwrap();
    assert_eq!(response.request_id, "same_group");
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert!(
        !marker.exists(),
        "same-process-group descendant escaped cleanup"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn escaped_process_group_pipe_holder_cannot_extend_the_wall_deadline() {
    let supervisor = Supervisor::new(SupervisorLimits::testing());
    let request = agent_request("escaped_pipe_holder");
    let started = tokio::time::Instant::now();
    let run = supervisor.run(
        &request,
        python_spec(
            "import os,time\nif os.fork()==0:\n os.setsid();time.sleep(.25);os._exit(0)\nos._exit(0)",
        ),
        b"",
    );
    let error = tokio::time::timeout(Duration::from_millis(500), run)
        .await
        .expect("supervisor must abort readers at its own deadline")
        .unwrap_err();
    assert_eq!(error.code, "wall_timeout");
    assert!(started.elapsed() < Duration::from_millis(200));
    assert!(
        !error.message.to_ascii_lowercase().contains("contain"),
        "process-group cleanup must not claim descendant containment"
    );
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_fresh_worker(&supervisor, "fresh_escaped_pipe_holder").await;
}

#[cfg(unix)]
#[tokio::test]
async fn aborted_run_drops_guard_clears_registry_and_allows_id_reuse() {
    let supervisor = Arc::new(Supervisor::new(SupervisorLimits::testing()));
    let temporary = TempDir::new().unwrap();
    let pid_file = temporary.path().join("aborted-leader-pid");
    let script = format!(
        "import os,pathlib,time;pathlib.Path({:?}).write_text(str(os.getpid()));time.sleep(5)",
        pid_file.to_string_lossy()
    );
    let task = {
        let supervisor = Arc::clone(&supervisor);
        tokio::spawn(async move {
            supervisor
                .run(&agent_request("aborted"), python_spec(&script), b"")
                .await
        })
    };

    tokio::time::timeout(Duration::from_millis(200), async {
        while supervisor.active_count() != 1
            || !fs::read_to_string(&pid_file)
                .map(|contents| !contents.is_empty())
                .unwrap_or(false)
        {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("worker registers before abort");
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    tokio::time::timeout(Duration::from_millis(200), async {
        while supervisor.active_count() != 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("run guard synchronously clears active state");
    tokio::time::timeout(Duration::from_millis(500), async {
        while supervisor.background_reap_count() != 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("background leader reap is observable and bounded");
    let pid: i32 = fs::read_to_string(&pid_file).unwrap().parse().unwrap();
    assert_eq!(unsafe { libc::kill(pid, 0) }, -1);
    assert_eq!(
        std::io::Error::last_os_error().raw_os_error(),
        Some(libc::ESRCH)
    );

    assert_fresh_worker(&supervisor, "aborted").await;
}

#[cfg(unix)]
#[tokio::test]
async fn aborted_run_retains_generation_lease_until_background_reap_and_cleanup() {
    use fs2::FileExt;
    use std::fs::OpenOptions;

    let supervisor = Arc::new(Supervisor::new(SupervisorLimits::testing()));
    let reap_gate = Arc::new(tokio::sync::Notify::new());
    supervisor.install_background_reap_gate_for_test(Arc::clone(&reap_gate));
    let temporary = TempDir::new().unwrap();
    let lock_path = temporary.path().join(".provision.lock");
    fs::write(&lock_path, "").unwrap();
    let lease = OpenOptions::new().read(true).open(&lock_path).unwrap();
    lease.lock_shared().unwrap();
    let request_root = temporary.path().join("request");
    fs::create_dir(&request_root).unwrap();
    let pid_file = temporary.path().join("lease-leader-pid");
    let script = format!(
        "import os,pathlib,time;pathlib.Path({:?}).write_text(str(os.getpid()));time.sleep(5)",
        pid_file.to_string_lossy()
    );
    let mut spec = python_spec(&script);
    spec.cleanup_root = Some(request_root.clone());
    spec.runtime_guard = Some(Arc::new(lease));
    let task = {
        let supervisor = Arc::clone(&supervisor);
        tokio::spawn(async move {
            supervisor
                .run(&agent_request("lease-abort"), spec, b"")
                .await
        })
    };
    tokio::time::timeout(Duration::from_millis(200), async {
        while !pid_file.exists() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("worker starts before abort");

    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    tokio::time::timeout(Duration::from_millis(200), async {
        while supervisor.background_reap_count() != 1 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("background reap takes ownership");
    let update = OpenOptions::new()
        .read(true)
        .write(true)
        .open(&lock_path)
        .unwrap();
    assert!(update.try_lock_exclusive().is_err());
    assert!(request_root.exists());

    reap_gate.notify_one();
    tokio::time::timeout(Duration::from_millis(500), async {
        while supervisor.background_reap_count() != 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("background reap and cleanup complete");
    assert!(!request_root.exists());
    tokio::time::timeout(Duration::from_millis(200), async {
        while update.try_lock_exclusive().is_err() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("exclusive generation lock becomes available after reap");
}

#[cfg(unix)]
#[tokio::test]
async fn cancellation_and_cancel_all_are_idempotent_and_reap_workers() {
    let supervisor = Arc::new(Supervisor::new(SupervisorLimits::testing()));
    let task = {
        let supervisor = Arc::clone(&supervisor);
        tokio::spawn(async move {
            supervisor
                .run(
                    &agent_request("cancel"),
                    python_spec("import time;time.sleep(5)"),
                    b"",
                )
                .await
        })
    };
    tokio::time::sleep(Duration::from_millis(20)).await;
    supervisor.cancel("cancel").await.unwrap();
    assert_eq!(supervisor.active_count(), 0);
    supervisor.cancel("cancel").await.unwrap();
    let error = task.await.unwrap().unwrap_err();
    assert_eq!(error.code, "cancelled");
    assert_eq!(error.message, "Worker request was cancelled");
    assert_fresh_worker(&supervisor, "fresh_cancel").await;

    let task = {
        let supervisor = Arc::clone(&supervisor);
        tokio::spawn(async move {
            supervisor
                .run(
                    &agent_request("cancel_all"),
                    python_spec("import time;time.sleep(5)"),
                    b"",
                )
                .await
        })
    };
    tokio::time::sleep(Duration::from_millis(20)).await;
    supervisor.cancel_all().await;
    assert_eq!(supervisor.active_count(), 0);
    supervisor.cancel_all().await;
    assert_eq!(task.await.unwrap().unwrap_err().code, "cancelled");
    assert_fresh_worker(&supervisor, "fresh_cancel_all").await;
}

#[cfg(unix)]
#[tokio::test]
async fn duplicate_id_invalid_spec_and_oversized_stdin_fail_closed() {
    let supervisor = Arc::new(Supervisor::new(SupervisorLimits::testing()));
    let active = {
        let supervisor = Arc::clone(&supervisor);
        tokio::spawn(async move {
            supervisor
                .run(
                    &agent_request("duplicate"),
                    python_spec("import time;time.sleep(5)"),
                    b"",
                )
                .await
        })
    };
    tokio::time::sleep(Duration::from_millis(20)).await;
    let duplicate = supervisor
        .run(
            &agent_request("duplicate"),
            python_spec(&valid_worker_script("duplicate")),
            b"",
        )
        .await
        .unwrap_err();
    assert_eq!(duplicate.code, "duplicate_request");
    assert_eq!(duplicate.message, "Worker request ID is already active");
    supervisor.cancel("duplicate").await.unwrap();
    assert_eq!(active.await.unwrap().unwrap_err().code, "cancelled");
    assert_fresh_worker(&supervisor, "fresh_duplicate").await;

    let mut relative = python_spec(&valid_worker_script("relative"));
    relative.executable = PathBuf::from("python3");
    let error = supervisor
        .run(&agent_request("relative"), relative, b"")
        .await
        .unwrap_err();
    assert_eq!(error.code, "invalid_process_spec");

    let error = supervisor
        .run(
            &agent_request("oversized_stdin"),
            python_spec("pass"),
            &vec![b'x'; 270_001],
        )
        .await
        .unwrap_err();
    assert_eq!(error.code, "request_too_large");
    assert_fresh_worker(&supervisor, "fresh_stdin").await;

    let valid = json!({
        "protocol_version": 1,
        "request_id": "closed_stdin",
        "status": "ok",
        "snapshot": null,
        "result": null,
        "stdout": "",
        "stderr": "",
        "error": null
    })
    .to_string();
    let script = format!(
        "import os,time,sys\nos.close(0)\ntime.sleep(.02)\nsys.stdout.write({valid:?}+'\\n')"
    );
    let error = supervisor
        .run(
            &agent_request("closed_stdin"),
            python_spec(&script),
            &vec![b'x'; 200_000],
        )
        .await
        .unwrap_err();
    assert_eq!(error.code, "stdin_failed");
    assert_fresh_worker(&supervisor, "fresh_closed_stdin").await;
}
