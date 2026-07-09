use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use app_lib::agent_runtime::protocol::{
    Action, Framework, FrontendRequestV1, ResponseStatus, WorkerRequestV1, WorkerResponseV1,
};
use app_lib::agent_runtime::resources::{
    validate_requirements, AgentEnvironment, CommandOutput, CommandRunner, CommandSpec,
    EnvironmentFilesystem, ResourcePaths,
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
        response(&[("request_id", json!(""))]),
        response(&[("request_id", json!("x".repeat(65)))]),
    ] {
        assert!(serde_json::from_value::<WorkerResponseV1>(changed).is_err());
    }

    let parsed: WorkerResponseV1 =
        serde_json::from_value(response(&[("request_id", json!("other"))])).unwrap();
    assert!(parsed.validate("request_1").is_err());
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
        ("snapshot", json!({"qubit_count": 2})),
        ("result", json!({"measurements": {"00": 5}})),
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
    serde_json::from_value::<WorkerResponseV1>(response(&[("error", valid)])).unwrap();

    for invalid in [
        json!({"message": "missing code"}),
        json!({"code": "missing_message"}),
        json!({"code": "bad", "message": "bad", "unknown": true}),
        json!({"code": 1, "message": "bad"}),
        json!({"code": "bad", "message": "bad", "traceback": 1}),
    ] {
        assert!(
            serde_json::from_value::<WorkerResponseV1>(response(&[("error", invalid)])).is_err()
        );
    }
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
    fail_staging_probe: bool,
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
            fs::create_dir_all(venv_python(&root).parent().unwrap()).unwrap();
            fs::create_dir_all(root.join("lib/site-packages")).unwrap();
            fs::write(venv_python(&root), "# python\n").unwrap();
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

fn venv_python(root: &Path) -> PathBuf {
    if cfg!(windows) {
        root.join("Scripts/python.exe")
    } else {
        root.join("bin/python3")
    }
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
