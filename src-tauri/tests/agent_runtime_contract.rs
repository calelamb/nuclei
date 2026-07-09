use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use app_lib::agent_runtime::protocol::{
    Action, Framework, FrontendRequestV1, ResponseStatus, WorkerRequestV1, WorkerResponseV1,
};
use app_lib::agent_runtime::resources::{
    validate_requirements, AgentEnvironment, CommandOutput, CommandRunner, CommandSpec,
    ResourcePaths,
};
use serde_json::{json, Value};
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

#[test]
fn worker_response_is_strict_and_validates_identity() {
    let raw = response(&[]);
    let parsed: WorkerResponseV1 = serde_json::from_value(raw).unwrap();
    assert_eq!(parsed.status, ResponseStatus::Ok);
    parsed.validate("request_1").unwrap();

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
    ] {
        let parsed: WorkerResponseV1 = serde_json::from_value(changed).unwrap();
        assert!(parsed.validate("request_1").is_err());
    }

    let parsed: WorkerResponseV1 =
        serde_json::from_value(response(&[("request_id", json!("other"))])).unwrap();
    assert!(parsed.validate("request_1").is_err());
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

    // Package names are parsed, so harmless version/comments do not trigger substring checks.
    validate_requirements(&REQUIREMENTS.replace("numpy>=1.26,<3", "numpy>=1.26,<3 # no cuda"))
        .unwrap();
}

fn write_resource_tree(root: &Path) -> PathBuf {
    let kernel = root.join("kernel");
    fs::create_dir_all(&kernel).unwrap();
    fs::write(kernel.join("agent_worker.py"), "# worker\n").unwrap();
    fs::write(kernel.join("agent-requirements.txt"), REQUIREMENTS).unwrap();
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
}

impl CommandRunner for FakeRunner {
    fn run(&self, spec: &CommandSpec) -> Result<CommandOutput, String> {
        self.commands.lock().unwrap().push(spec.clone());
        let args: Vec<String> = spec
            .args
            .iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();

        if args.iter().any(|arg| arg == "venv") {
            let root = PathBuf::from(args.last().unwrap());
            fs::create_dir_all(root.join("bin")).unwrap();
            fs::create_dir_all(root.join("lib/site-packages")).unwrap();
            fs::write(root.join("bin/python3"), "# python\n").unwrap();
        }
        if args.iter().any(|arg| arg == "pip") && self.fail_install {
            return Ok(CommandOutput {
                success: false,
                stdout: vec![],
                stderr: b"install failed".to_vec(),
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

    assert_eq!(environment.root, app_data.path().join("agent-runtime/v1"));
    environment.verify().unwrap();
    let commands = runner.commands.lock().unwrap();
    assert!(commands.iter().all(|command| command.clear_environment));
    assert!(commands.iter().all(|command| command
        .environment
        .iter()
        .any(|(name, value)| name == "PATH" && value == "/usr/bin:/bin")));
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
fn environment_verification_rejects_paths_outside_dedicated_root() {
    let app_data = TempDir::new().unwrap();
    let root = app_data.path().join("agent-runtime/v1");
    fs::create_dir_all(root.join("bin")).unwrap();
    fs::write(root.join("bin/python3"), "").unwrap();
    let outside = TempDir::new().unwrap();

    let environment = AgentEnvironment {
        root,
        python: app_data.path().join("agent-runtime/v1/bin/python3"),
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
