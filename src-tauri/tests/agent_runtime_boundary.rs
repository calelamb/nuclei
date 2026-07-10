use app_lib::agent_runtime::macos::{
    build_seatbelt_profile, cirq_rlimit_probe_source, qualification_cache_key,
    resource_limit_probe_script, worker_environment, MacBackend, OfflineProvisioningContainment,
    QualificationContext, SystemPaths,
};
use app_lib::agent_runtime::process::{ProcessSpec, ResourceLimits};
#[cfg(any(target_os = "linux", target_os = "macos"))]
use app_lib::agent_runtime::qualify_current_host_with_context;
use app_lib::agent_runtime::resources::RunnerContainment;
use app_lib::agent_runtime::resources::{AgentEnvironment, ResourcePaths};
use app_lib::agent_runtime::{qualify_current_host, QualificationMode};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use tempfile::TempDir;

const REQUIREMENTS: &str = include_str!("../../kernel/agent-requirements.txt");

struct Fixture {
    _root: TempDir,
    context: QualificationContext,
}

fn canonical(path: impl AsRef<Path>) -> PathBuf {
    path.as_ref().canonicalize().unwrap()
}

fn fixture() -> Fixture {
    let root = TempDir::new().unwrap();
    let repository = root.path().join("repo \"quoted\"");
    let kernel = repository.join("kernel");
    fs::create_dir_all(&kernel).unwrap();
    fs::write(kernel.join("agent_worker.py"), "# fixed worker\n").unwrap();
    fs::write(kernel.join("agent-requirements.txt"), REQUIREMENTS).unwrap();
    fs::create_dir_all(kernel.join("adapters")).unwrap();
    fs::write(kernel.join("adapters/cirq_adapter.py"), "# fixed adapter\n").unwrap();
    fs::write(kernel.join("executor.py"), "# fixed executor\n").unwrap();
    let resources = ResourcePaths::development(&repository).unwrap();

    let runtime = root.path().join("runtime");
    let python = runtime.join("bin/python3");
    let site_packages = runtime.join("lib/python3.12/site-packages");
    fs::create_dir_all(python.parent().unwrap()).unwrap();
    fs::create_dir_all(&site_packages).unwrap();
    fs::write(&python, b"fixed agent python").unwrap();
    fs::create_dir_all(site_packages.join("cirq")).unwrap();
    fs::write(
        site_packages.join("cirq/__init__.py"),
        "# fixed dependency\n",
    )
    .unwrap();
    let environment = AgentEnvironment {
        root: canonical(&runtime),
        python: canonical(&python),
        site_packages: canonical(&site_packages),
    };

    let request_temp_root = root.path().join("requests");
    let project = root.path().join("project");
    let home = root.path().join("home");
    fs::create_dir_all(&request_temp_root).unwrap();
    fs::create_dir_all(&project).unwrap();
    fs::create_dir_all(&home).unwrap();
    let project_sentinel = project.join("sentinel");
    let home_sentinel = home.join("sentinel");
    fs::write(&project_sentinel, "project secret").unwrap();
    fs::write(&home_sentinel, "home secret").unwrap();
    let system = root.path().join("system");
    let system_library = system.join("System/Library");
    let usr_lib = system.join("usr/lib");
    let devices = system.join("dev");
    fs::create_dir_all(&system_library).unwrap();
    fs::create_dir_all(&usr_lib).unwrap();
    fs::create_dir_all(&devices).unwrap();
    for device in ["null", "random", "urandom"] {
        fs::write(devices.join(device), "").unwrap();
    }
    let sandbox_exec = system.join("usr/bin/sandbox-exec");
    fs::create_dir_all(sandbox_exec.parent().unwrap()).unwrap();
    fs::write(&sandbox_exec, "sandbox").unwrap();
    let system_paths = SystemPaths::new(
        vec![canonical(system_library), canonical(usr_lib)],
        vec![
            canonical(devices.join("null")),
            canonical(devices.join("random")),
            canonical(devices.join("urandom")),
        ],
        canonical(sandbox_exec),
    )
    .unwrap();

    let context = QualificationContext::new(
        "0.5.1",
        resources,
        environment,
        &request_temp_root,
        &project_sentinel,
        &home_sentinel,
        BTreeMap::from([
            ("ANTHROPIC_API_KEY".into(), "fake-anthropic-secret".into()),
            ("IBM_QUANTUM_TOKEN".into(), "fake-ibm-secret".into()),
            ("AWS_SECRET_ACCESS_KEY".into(), "fake-aws-secret".into()),
        ]),
        system_paths,
    )
    .unwrap();
    Fixture {
        _root: root,
        context,
    }
}

#[tokio::test]
async fn current_host_is_qualified_or_truthfully_unavailable() {
    let report = qualify_current_host(QualificationMode::AllowUnavailable).await;
    if report.available {
        assert!(report
            .controls
            .iter()
            .all(|control| control.self_test_passed));
        assert!(!report.qualified_frameworks.contains(&"cuda-q".into()));
    } else {
        assert!(report.qualified_frameworks.is_empty());
        assert!(report.controls.is_empty());
        assert!(report.reason.is_some());
    }
}

#[test]
fn offline_provisioning_remains_unavailable_without_a_bundled_verified_wheelhouse() {
    assert_eq!(
        OfflineProvisioningContainment.containment(),
        RunnerContainment::Unavailable
    );
}

#[cfg(target_os = "linux")]
#[tokio::test]
async fn linux_remains_unavailable_until_the_linux_backend_exists() {
    let fixture = fixture();
    for mode in [
        QualificationMode::AllowUnavailable,
        QualificationMode::RequireAvailable,
    ] {
        let report = qualify_current_host_with_context(mode, fixture.context.clone()).await;
        assert!(!report.available);
        assert!(report.qualified_frameworks.is_empty());
        assert!(report.controls.is_empty());
    }
}

#[test]
fn profile_is_deny_by_default_and_escapes_every_path_literal() {
    let fixture = fixture();
    let request = fixture.context.request_temp_root.join("request\\one");
    fs::create_dir(&request).unwrap();
    let request = canonical(request);
    let profile = build_seatbelt_profile(&fixture.context, &request).unwrap();

    assert!(profile.starts_with("(version 1)\n(deny default)\n"));
    for denial in ["(deny network*)", "(deny process-fork)"] {
        assert!(profile.contains(denial), "{denial}");
    }
    assert!(profile.contains(r#"repo \"quoted\""#));
    assert!(profile.contains(r#"request\\one"#));
    assert!(!profile.contains("(allow network"));
    assert!(!profile.contains("(allow process-fork"));
    assert!(!profile.contains(r#"(subpath "/Users")"#));
    assert!(!profile.contains(r#"(subpath "/Applications")"#));
    assert!(!profile.contains(r#"(literal "/bin/sh")"#));
    assert!(!profile.contains(r#"(literal "/usr/bin/env")"#));
    assert!(profile.contains(&format!(
        r#"(literal "{}")"#,
        fixture.context.environment.python.display()
    )));
}

#[test]
fn profile_rejects_control_characters_in_canonical_literals() {
    let fixture = fixture();
    let bad = fixture.context.request_temp_root.join("bad\nrequest");
    fs::create_dir(&bad).unwrap();
    assert!(build_seatbelt_profile(&fixture.context, &canonical(bad)).is_err());
}

#[test]
fn worker_command_has_only_the_fixed_environment_and_seatbelt_entrypoint() {
    let fixture = fixture();
    let request = fixture.context.request_temp_root.join("request");
    fs::create_dir(&request).unwrap();
    let request = canonical(request);
    let spec: ProcessSpec = MacBackend::worker_spec(&fixture.context, &request).unwrap();

    assert_eq!(spec.executable, fixture.context.system_paths.sandbox_exec);
    assert_eq!(spec.cwd, request);
    assert_eq!(spec.args[0], "-p");
    assert!(spec.args[1].starts_with("(version 1)\n(deny default)"));
    assert_eq!(
        spec.args[2],
        fixture.context.environment.python.to_string_lossy()
    );
    assert_eq!(spec.args[3], "-I");
    assert_eq!(
        spec.args[4],
        fixture.context.resources.worker.to_string_lossy()
    );
    assert_eq!(spec.cleanup_root.as_deref(), Some(request.as_path()));
    assert_eq!(spec.resource_limits, ResourceLimits::production());

    let expected = BTreeSet::from([
        "CUDA_VISIBLE_DEVICES",
        "HOME",
        "LANG",
        "LC_ALL",
        "MKL_NUM_THREADS",
        "NUMEXPR_NUM_THREADS",
        "OMP_NUM_THREADS",
        "OPENBLAS_NUM_THREADS",
        "PATH",
        "PYTHONHASHSEED",
        "PYTHONNOUSERSITE",
        "PYTHONSAFEPATH",
        "PYTHONDONTWRITEBYTECODE",
        "QDK_PYTHON_TELEMETRY",
        "TMPDIR",
    ]);
    assert_eq!(
        spec.env.keys().map(String::as_str).collect::<BTreeSet<_>>(),
        expected
    );
    assert_eq!(spec.env["HOME"], request.join("home").to_string_lossy());
    assert_eq!(spec.env["TMPDIR"], request.join("tmp").to_string_lossy());
    assert_eq!(
        spec.env["PATH"],
        fixture
            .context
            .environment
            .python
            .parent()
            .unwrap()
            .to_string_lossy()
    );
    for secret in fixture.context.parent_environment.keys() {
        assert!(!spec.env.contains_key(secret));
    }
}

#[test]
fn qualification_harness_uses_the_production_spec_and_parent_limits() {
    let fixture = fixture();
    let worker_request = fixture.context.request_temp_root.join("worker-spec");
    let probe_request = fixture.context.request_temp_root.join("probe-spec");
    fs::create_dir(&worker_request).unwrap();
    fs::create_dir(&probe_request).unwrap();
    let worker = MacBackend::worker_spec(&fixture.context, &canonical(worker_request)).unwrap();
    let probe = MacBackend::probe_spec(
        &fixture.context,
        &canonical(probe_request),
        "print('probe')",
    )
    .unwrap();

    assert_eq!(probe.executable, worker.executable);
    assert_eq!(probe.args[0], worker.args[0]);
    assert_eq!(probe.args[2], worker.args[2]);
    assert_eq!(
        probe.args[1].replace(probe.cwd.to_str().unwrap(), "<request-temp>"),
        worker.args[1].replace(worker.cwd.to_str().unwrap(), "<request-temp>")
    );
    assert_eq!(
        probe.env.keys().collect::<Vec<_>>(),
        worker.env.keys().collect::<Vec<_>>()
    );
    assert_eq!(probe.resource_limits, ResourceLimits::production());
    let script = resource_limit_probe_script(ResourceLimits::production());
    assert!(!script.contains("setrlimit"));
    for value in ["10", "1073741824", "1048576", "64", "4", "(0,0)"] {
        assert!(script.contains(value), "missing parent limit {value}");
    }
    let worker_source = cirq_rlimit_probe_source(ResourceLimits::production());
    assert!(!worker_source.contains("setrlimit"));
    assert!(worker_source.contains("resource.getrlimit"));
    assert!(worker_source.contains("1073741824"));
}

#[test]
fn standalone_environment_builder_is_exact_and_does_not_inherit_parent_values() {
    let fixture = fixture();
    let request = fixture.context.request_temp_root.join("env-request");
    fs::create_dir(&request).unwrap();
    let request = canonical(request);
    let environment = worker_environment(&fixture.context.environment, &request).unwrap();
    assert_eq!(environment["LANG"], "C.UTF-8");
    assert_eq!(environment["LC_ALL"], "C.UTF-8");
    assert_eq!(environment["CUDA_VISIBLE_DEVICES"], "");
    assert_eq!(environment["PYTHONNOUSERSITE"], "1");
    assert_eq!(environment["PYTHONSAFEPATH"], "1");
    assert_eq!(environment["QDK_PYTHON_TELEMETRY"], "none");
    for name in [
        "ANTHROPIC_API_KEY",
        "HTTP_PROXY",
        "DYLD_INSERT_LIBRARIES",
        "LD_PRELOAD",
    ] {
        assert!(!environment.contains_key(name));
    }
}

#[cfg(unix)]
#[test]
fn qualification_context_rejects_symlink_escapes_and_noncanonical_inputs() {
    use std::os::unix::fs::symlink;

    let fixture = fixture();
    let outside = TempDir::new().unwrap();
    let alias = fixture.context.request_temp_root.join("escape");
    symlink(outside.path(), &alias).unwrap();
    let result = QualificationContext::new(
        &fixture.context.app_version,
        fixture.context.resources.clone(),
        fixture.context.environment.clone(),
        &alias,
        &fixture.context.project_sentinel,
        &fixture.context.home_sentinel,
        fixture.context.parent_environment.clone(),
        fixture.context.system_paths.clone(),
    );
    assert!(result.is_err());
}

#[cfg(unix)]
#[test]
fn system_roots_reject_symlink_and_noncanonical_substitutions() {
    use std::os::unix::fs::symlink;

    let fixture = fixture();
    let alias = fixture.context.request_temp_root.join("system-alias");
    symlink(&fixture.context.system_paths.read_roots[0], &alias).unwrap();
    assert!(SystemPaths::new(
        vec![alias],
        fixture.context.system_paths.devices.clone(),
        fixture.context.system_paths.sandbox_exec.clone(),
    )
    .is_err());

    let replaced = fixture.context.system_paths.read_roots[0].clone();
    fs::remove_dir(&replaced).unwrap();
    symlink(&fixture.context.system_paths.read_roots[1], &replaced).unwrap();
    let request = fixture.context.request_temp_root.join("system-swap");
    fs::create_dir(&request).unwrap();
    assert!(build_seatbelt_profile(&fixture.context, &canonical(request)).is_err());
}

#[test]
fn cache_key_covers_every_executable_runtime_input() {
    let fixture = fixture();
    let original = qualification_cache_key(&fixture.context).unwrap();

    let mut changed_version = fixture.context.clone();
    changed_version.app_version.push_str("-changed");
    assert_ne!(original, qualification_cache_key(&changed_version).unwrap());

    fs::write(
        &fixture.context.resources.worker,
        "# fixed worker\n# changed\n",
    )
    .unwrap();
    assert_ne!(original, qualification_cache_key(&fixture.context).unwrap());

    fs::write(&fixture.context.resources.worker, "# fixed worker\n").unwrap();
    fs::write(&fixture.context.environment.python, b"changed python").unwrap();
    assert_ne!(original, qualification_cache_key(&fixture.context).unwrap());
    fs::write(&fixture.context.environment.python, b"fixed agent python").unwrap();

    fs::write(
        fixture
            .context
            .resources
            .kernel_root
            .join("adapters/cirq_adapter.py"),
        "# changed adapter\n",
    )
    .unwrap();
    assert_ne!(original, qualification_cache_key(&fixture.context).unwrap());
    fs::write(
        fixture
            .context
            .resources
            .kernel_root
            .join("adapters/cirq_adapter.py"),
        "# fixed adapter\n",
    )
    .unwrap();

    fs::write(
        fixture
            .context
            .environment
            .site_packages
            .join("cirq/__init__.py"),
        "# changed dependency\n",
    )
    .unwrap();
    assert_ne!(original, qualification_cache_key(&fixture.context).unwrap());
    fs::write(
        fixture
            .context
            .environment
            .site_packages
            .join("cirq/__init__.py"),
        "# fixed dependency\n",
    )
    .unwrap();

    fs::write(
        &fixture.context.resources.requirements,
        b"changed requirements\n",
    )
    .unwrap();
    assert_ne!(original, qualification_cache_key(&fixture.context).unwrap());
}

#[cfg(unix)]
#[test]
fn cache_identity_rejects_symlinks_and_nonregular_tree_entries() {
    use std::os::unix::fs::symlink;

    let fixture = fixture();
    let outside = fixture.context.request_temp_root.join("outside.py");
    fs::write(&outside, "outside").unwrap();
    symlink(
        &outside,
        fixture
            .context
            .resources
            .kernel_root
            .join("adapters/escape.py"),
    )
    .unwrap();
    assert!(qualification_cache_key(&fixture.context).is_err());
}

#[cfg(target_os = "macos")]
#[tokio::test]
async fn macos_required_qualification_passes() {
    let report = qualify_current_host(QualificationMode::RequireAvailable).await;
    assert!(report.available, "{:?}", report.reason);
    assert_eq!(report.qualified_frameworks, vec!["cirq"]);
    assert!(!report.qualified_frameworks.contains(&"cuda-q".into()));
    assert_eq!(
        report
            .controls
            .iter()
            .map(|control| {
                assert!(control.self_test_passed);
                control.name.as_str()
            })
            .collect::<BTreeSet<_>>(),
        BTreeSet::from([
            "seatbelt",
            "filesystem_read",
            "filesystem_write",
            "network",
            "fork",
            "exec",
            "clean_environment",
            "stdout_limit",
            "rlimits",
            "cirq",
            "cleanup",
        ])
    );
}
