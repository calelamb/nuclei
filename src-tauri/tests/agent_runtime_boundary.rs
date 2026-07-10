use app_lib::agent_runtime::macos::{
    active_identity_hashers_for_test, build_seatbelt_profile, cirq_rlimit_probe_source,
    qualification_cache_key, qualification_cache_key_async, qualification_cache_key_with_deadline,
    resource_limit_probe_script, worker_environment, LockedRuntimeIdentity, MacBackend,
    OfflineProvisioningContainment, QualificationContext, SystemPaths,
};
use app_lib::agent_runtime::process::{ProcessSpec, ResourceLimits};
#[cfg(any(target_os = "linux", target_os = "macos"))]
use app_lib::agent_runtime::qualify_current_host_with_context;
use app_lib::agent_runtime::resources::RunnerContainment;
use app_lib::agent_runtime::resources::{
    validate_requirements_lock, AgentEnvironment, ResourcePaths,
};
use app_lib::agent_runtime::{qualify_current_host, QualificationMode};
#[cfg(target_os = "macos")]
use std::collections::BTreeMap;
use std::collections::BTreeSet;
use std::fs;
use std::fs::OpenOptions;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tempfile::TempDir;

const REQUIREMENTS: &str = include_str!("../../kernel/agent-requirements.txt");
const REQUIREMENTS_LOCK: &str = include_str!("../../kernel/agent-requirements.lock");

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

    let runtime = root.path().join("generations/sha256-fixture");
    fs::create_dir_all(runtime.parent().unwrap()).unwrap();
    fs::write(runtime.parent().unwrap().join(".provision.lock"), "").unwrap();
    let python = runtime.join("bin/python3");
    let site_packages = runtime.join("lib/python3.12/site-packages");
    fs::create_dir_all(python.parent().unwrap()).unwrap();
    fs::create_dir_all(&site_packages).unwrap();
    fs::write(&python, b"fixed agent python").unwrap();
    fs::create_dir_all(runtime.join("stdlib")).unwrap();
    fs::write(runtime.join("stdlib/os.py"), "# fixed stdlib\n").unwrap();
    fs::write(runtime.join("libpython.dylib"), b"fixed native library").unwrap();
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
    let system = root.path().join("system");
    let system_library = system.join("System/Library");
    let usr_lib = system.join("usr/lib");
    let devices = system.join("dev");
    fs::create_dir_all(&system_library).unwrap();
    fs::create_dir_all(&usr_lib).unwrap();
    fs::create_dir_all(&devices).unwrap();
    for device in ["null", "urandom"] {
        fs::write(devices.join(device), "").unwrap();
    }
    let sandbox_exec = system.join("usr/bin/sandbox-exec");
    fs::create_dir_all(sandbox_exec.parent().unwrap()).unwrap();
    fs::write(&sandbox_exec, "sandbox").unwrap();
    let system_paths = SystemPaths::for_tests(
        vec![canonical(system_library), canonical(usr_lib)],
        vec![
            canonical(devices.join("null")),
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
        &project,
        &home,
        BTreeSet::from([
            "ANTHROPIC_API_KEY".into(),
            "IBM_QUANTUM_TOKEN".into(),
            "AWS_SECRET_ACCESS_KEY".into(),
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

#[test]
fn agent_test_lock_is_hash_locked_and_matches_the_direct_allowlist() {
    validate_requirements_lock(REQUIREMENTS, REQUIREMENTS_LOCK).unwrap();
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
    for secret in &fixture.context.parent_secret_names {
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
fn shared_runtime_lease_blocks_an_exclusive_update_lock() {
    use fs2::FileExt;

    let fixture = fixture();
    let lease = MacBackend::runtime_lease(&fixture.context).unwrap();
    let update = OpenOptions::new()
        .read(true)
        .write(true)
        .open(
            fixture
                .context
                .environment
                .root
                .parent()
                .unwrap()
                .join(".provision.lock"),
        )
        .unwrap();
    assert!(update.try_lock_exclusive().is_err());
    drop(lease);
    update.try_lock_exclusive().unwrap();
}

#[tokio::test]
async fn locked_identity_blocks_updates_until_commit_and_detects_the_new_generation() {
    use fs2::FileExt;

    let fixture = fixture();
    let context = fixture.context.clone();
    let qualified = LockedRuntimeIdentity::acquire(context.clone())
        .await
        .unwrap();
    let original_key = qualified.cache_key().to_string();
    let lock_path = context.runtime_lock.clone();
    let changed_file = context.environment.root.join("stdlib/os.py");
    let (acquired_tx, mut acquired_rx) = tokio::sync::oneshot::channel();
    let update = tokio::task::spawn_blocking(move || {
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .open(lock_path)
            .unwrap();
        lock.lock_exclusive().unwrap();
        let _ = acquired_tx.send(());
        fs::write(changed_file, "# provisioned next generation\n").unwrap();
    });

    tokio::time::sleep(Duration::from_millis(25)).await;
    assert!(matches!(
        acquired_rx.try_recv(),
        Err(tokio::sync::oneshot::error::TryRecvError::Empty)
    ));

    // Represents atomic report/resolver commit under the same qualification
    // lease.
    drop(qualified);
    acquired_rx.await.unwrap();
    update.await.unwrap();

    let refreshed = LockedRuntimeIdentity::acquire(context).await.unwrap();
    assert_ne!(original_key, refreshed.cache_key());
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

#[test]
fn qualification_context_accepts_canonical_roots_without_precreated_evidence() {
    let fixture = fixture();
    assert!(fixture.context.project_root.is_dir());
    assert!(fixture.context.home_root.is_dir());
    assert_eq!(
        fs::read_dir(&fixture.context.project_root).unwrap().count(),
        0
    );
    assert_eq!(fs::read_dir(&fixture.context.home_root).unwrap().count(), 0);
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
        &fixture.context.project_root,
        &fixture.context.home_root,
        fixture.context.parent_secret_names.clone(),
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
    assert!(SystemPaths::for_tests(
        vec![alias, fixture.context.system_paths.read_roots[1].clone()],
        fixture.context.system_paths.devices.clone(),
        fixture.context.system_paths.sandbox_exec.clone(),
    )
    .is_err());
    assert!(SystemPaths::for_tests(
        vec![
            PathBuf::from("/"),
            fixture.context.system_paths.read_roots[1].clone(),
        ],
        fixture.context.system_paths.devices.clone(),
        fixture.context.system_paths.sandbox_exec.clone(),
    )
    .is_err());
    assert!(fixture.context.system_paths.verify_production().is_err());

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
    fs::write(&fixture.context.resources.requirements, REQUIREMENTS).unwrap();

    fs::write(
        fixture.context.environment.root.join("stdlib/os.py"),
        "# changed stdlib\n",
    )
    .unwrap();
    assert_ne!(original, qualification_cache_key(&fixture.context).unwrap());
    fs::write(
        fixture.context.environment.root.join("stdlib/os.py"),
        "# fixed stdlib\n",
    )
    .unwrap();

    fs::write(
        fixture.context.environment.root.join("libpython.dylib"),
        b"changed native library",
    )
    .unwrap();
    assert_ne!(original, qualification_cache_key(&fixture.context).unwrap());
    fs::write(
        fixture.context.environment.root.join("libpython.dylib"),
        b"fixed native library",
    )
    .unwrap();

    fs::write(
        fixture
            .context
            .environment
            .root
            .join("unexpected-runtime-file"),
        b"unexpected",
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

    fs::remove_file(
        fixture
            .context
            .resources
            .kernel_root
            .join("adapters/escape.py"),
    )
    .unwrap();
    let fifo = fixture
        .context
        .resources
        .kernel_root
        .join("adapters/special");
    let fifo_path = std::ffi::CString::new(fifo.as_os_str().as_encoded_bytes()).unwrap();
    assert_eq!(unsafe { libc::mkfifo(fifo_path.as_ptr(), 0o600) }, 0);
    assert!(qualification_cache_key(&fixture.context).is_err());
}

#[cfg(unix)]
#[test]
fn cache_identity_rejects_symlinks_anywhere_in_environment_root() {
    use std::os::unix::fs::symlink;

    let fixture = fixture();
    let outside = fixture.context.request_temp_root.join("outside-library");
    fs::write(&outside, "outside").unwrap();
    symlink(
        &outside,
        fixture.context.environment.root.join("escaped-library"),
    )
    .unwrap();
    assert!(qualification_cache_key(&fixture.context).is_err());
}

#[cfg(unix)]
#[test]
fn cache_identity_rejects_group_or_world_writable_runtime_paths() {
    use std::os::unix::fs::PermissionsExt;

    let fixture = fixture();
    let path = fixture.context.environment.root.join("stdlib/os.py");
    fs::set_permissions(&path, fs::Permissions::from_mode(0o666)).unwrap();
    assert!(qualification_cache_key(&fixture.context)
        .unwrap_err()
        .contains("group/world writable"));
}

#[tokio::test]
async fn async_identity_hash_deadline_fails_closed() {
    let fixture = fixture();
    let error = qualification_cache_key_with_deadline(fixture.context, Duration::ZERO)
        .await
        .unwrap_err();
    assert!(error.contains("deadline"));
}

#[tokio::test]
async fn complete_identity_hash_does_not_block_the_async_runtime() {
    let fixture = fixture();
    fs::write(
        fixture
            .context
            .environment
            .root
            .join("large-native-library"),
        vec![0x5a; 32 * 1024 * 1024],
    )
    .unwrap();
    let hash = tokio::spawn(qualification_cache_key_async(fixture.context));
    tokio::time::timeout(
        Duration::from_millis(50),
        tokio::time::sleep(Duration::from_millis(1)),
    )
    .await
    .expect("event loop was blocked by identity hashing");
    assert!(hash.await.unwrap().is_ok());
}

#[tokio::test]
async fn cancelled_identity_hash_stops_cooperatively_without_detached_work() {
    let fixture = fixture();
    let large =
        fs::File::create(fixture.context.environment.root.join("slow-native-library")).unwrap();
    large.set_len(512 * 1024 * 1024).unwrap();
    let hash = tokio::spawn(qualification_cache_key_async(fixture.context));
    tokio::time::timeout(Duration::from_secs(1), async {
        while active_identity_hashers_for_test() == 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("identity hasher did not start");
    hash.abort();
    tokio::time::timeout(Duration::from_secs(1), async {
        while active_identity_hashers_for_test() != 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("cancelled identity hasher remained detached");
}

#[cfg(target_os = "macos")]
#[tokio::test]
async fn macos_required_qualification_passes() {
    static ENVIRONMENT: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _serial = ENVIRONMENT.lock().await;
    let parent_secrets = [
        "ANTHROPIC_API_KEY",
        "IBM_QUANTUM_TOKEN",
        "AWS_SECRET_ACCESS_KEY",
    ];
    for name in parent_secrets {
        std::env::set_var(name, format!("qualification-fake-{name}"));
    }
    struct EnvironmentCleanup([&'static str; 3]);
    impl Drop for EnvironmentCleanup {
        fn drop(&mut self) {
            for name in self.0 {
                std::env::remove_var(name);
            }
        }
    }
    let _environment_cleanup = EnvironmentCleanup(parent_secrets);
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
