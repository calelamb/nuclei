#[cfg(target_os = "linux")]
use app_lib::agent_runtime::linux::{
    cgroup_construction_cleanup_failure_for_test, cgroup_construction_failure_for_test,
    compile_seccomp_bpf, qualification_cgroup_policy_for_test,
    qualification_owned_cgroups_absent_for_test, qualification_owned_request_dirs_absent_for_test,
    verify_cgroup_event_delta_for_test, verify_production_cgroup_for_test,
    verify_worker_cgroup_placement_for_test, CgroupProbeKind, LinuxBackend,
    LinuxQualificationContext, LinuxSystemPaths, OfflineLinuxProvisioningContainment,
};
use app_lib::agent_runtime::macos::{
    active_identity_hashers_for_test, build_seatbelt_profile, cirq_rlimit_probe_source,
    probe_request_guard_failure_for_test, qualification_cache_key, qualification_cache_key_async,
    qualification_cache_key_with_deadline, resource_limit_probe_script, worker_environment,
    LockedRuntimeIdentity, MacBackend, OfflineProvisioningContainment, QualificationContext,
    SystemPaths,
};
use app_lib::agent_runtime::process::{
    CleanupFailureReporter, CleanupFailureSink, ProcessCleanupResource, ProcessSpec, ResourceLimits,
};
#[cfg(target_os = "macos")]
use app_lib::agent_runtime::qualify_current_host_with_context;
use app_lib::agent_runtime::resources::RunnerContainment;
use app_lib::agent_runtime::resources::{
    validate_requirements_lock, AgentEnvironment, ResourcePaths, AGENT_KERNEL_FILES,
};
use app_lib::agent_runtime::{qualify_current_host, QualificationMode};
#[cfg(target_os = "macos")]
use std::collections::BTreeMap;
use std::collections::BTreeSet;
use std::fs;
use std::fs::OpenOptions;
use std::path::{Path, PathBuf};
#[cfg(target_os = "linux")]
use std::sync::{Arc, Barrier, Mutex};
#[cfg(target_os = "linux")]
use std::thread;
use std::time::Duration;
use tempfile::TempDir;

#[cfg(target_os = "linux")]
#[derive(Default)]
struct RecordingCleanupReporter(Mutex<Vec<String>>);

#[cfg(target_os = "linux")]
impl CleanupFailureReporter for RecordingCleanupReporter {
    fn report_cleanup_failure(&self, diagnostic: &str) {
        self.0.lock().unwrap().push(diagnostic.into());
    }
}

const REQUIREMENTS: &str = include_str!("../../kernel/agent-requirements.txt");
const REQUIREMENTS_LOCK: &str = include_str!("../../kernel/agent-requirements.lock");

struct Fixture {
    _root: TempDir,
    source_kernel: PathBuf,
    context: QualificationContext,
}

fn canonical(path: impl AsRef<Path>) -> PathBuf {
    path.as_ref().canonicalize().unwrap()
}

fn fixture() -> Fixture {
    let root = TempDir::new().unwrap();
    let repository = root.path().join("repo \"quoted\"");
    let kernel = repository.join("kernel");
    for relative in AGENT_KERNEL_FILES {
        let path = kernel.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let contents = if relative == "agent-requirements.txt" {
            REQUIREMENTS
        } else {
            "# fixed agent kernel file\n"
        };
        fs::write(path, contents).unwrap();
    }
    let source_kernel = canonical(&kernel);

    let runtime = root.path().join("generations \"quoted\"/generation-v1");
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
    for relative in AGENT_KERNEL_FILES {
        let destination = environment.root.join("kernel").join(relative);
        fs::create_dir_all(destination.parent().unwrap()).unwrap();
        fs::copy(source_kernel.join(relative), destination).unwrap();
    }
    let resources = ResourcePaths::generation(&environment).unwrap();

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
        source_kernel,
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
    #[cfg(target_os = "linux")]
    assert_eq!(
        OfflineLinuxProvisioningContainment.containment(),
        RunnerContainment::Unavailable
    );
}

#[test]
fn agent_test_lock_is_hash_locked_and_matches_the_direct_allowlist() {
    validate_requirements_lock(REQUIREMENTS, REQUIREMENTS_LOCK).unwrap();
}

#[cfg(target_os = "linux")]
#[test]
fn linux_seccomp_filter_is_nonempty_and_architecture_checked() {
    let bpf = compile_seccomp_bpf().expect("supported CI architecture");
    assert!(!bpf.is_empty());
    assert_eq!(bpf.len() % 8, 0, "classic BPF instructions are 8 bytes");
}

#[cfg(target_os = "linux")]
#[test]
fn production_cgroup_discovery_rejects_a_normal_directory_fixture() {
    let root = TempDir::new().unwrap();
    for (name, value) in [
        ("cgroup.type", "domain\n"),
        ("cgroup.controllers", "cpu memory pids\n"),
        ("cgroup.subtree_control", "cpu memory pids\n"),
        ("cgroup.procs", ""),
    ] {
        fs::write(root.path().join(name), value).unwrap();
    }

    let error = verify_production_cgroup_for_test(root.path()).unwrap_err();

    assert!(error.contains("cgroup v2 filesystem"), "{error}");
}

#[cfg(target_os = "linux")]
#[test]
fn trusted_parent_placement_requires_exact_pid_and_populated_evidence() {
    let root = TempDir::new().unwrap();
    fs::write(root.path().join("cgroup.procs"), "111\n4242\n").unwrap();
    fs::write(root.path().join("cgroup.events"), "populated 1\nfrozen 0\n").unwrap();

    verify_worker_cgroup_placement_for_test(root.path(), 4242).unwrap();
    let wrong_pid = verify_worker_cgroup_placement_for_test(root.path(), 424).unwrap_err();
    assert!(wrong_pid.contains("exact worker PID"), "{wrong_pid}");
    fs::write(root.path().join("cgroup.events"), "populated 0\n").unwrap();
    let empty = verify_worker_cgroup_placement_for_test(root.path(), 4242).unwrap_err();
    assert!(empty.contains("populated"), "{empty}");
}

#[cfg(target_os = "linux")]
#[test]
fn qualification_controller_policies_are_independent_of_parent_rlimits() {
    let memory = qualification_cgroup_policy_for_test(CgroupProbeKind::Memory);
    assert!(memory.memory_max < memory.resource_limits.address_space_bytes);
    let pids = qualification_cgroup_policy_for_test(CgroupProbeKind::Pids);
    assert!(pids.pids_max < pids.resource_limits.processes);
    let cpu = qualification_cgroup_policy_for_test(CgroupProbeKind::Cpu);
    assert!(cpu.cpu_quota < cpu.cpu_period);
    assert!(cpu.resource_limits.cpu_seconds >= 10);

    verify_cgroup_event_delta_for_test(
        CgroupProbeKind::Memory,
        "oom 0\noom_kill 0\n",
        "oom 1\noom_kill 1\n",
    )
    .unwrap();
    verify_cgroup_event_delta_for_test(CgroupProbeKind::Pids, "max 0\n", "max 1\n").unwrap();
    verify_cgroup_event_delta_for_test(
        CgroupProbeKind::Cpu,
        "nr_throttled 0\nthrottled_usec 0\n",
        "nr_throttled 2\nthrottled_usec 5000\n",
    )
    .unwrap();
    assert!(verify_cgroup_event_delta_for_test(
        CgroupProbeKind::Memory,
        "oom 0\noom_kill 0\n",
        "oom 0\noom_kill 0\n",
    )
    .is_err());
}

#[cfg(target_os = "linux")]
#[test]
fn qualification_ignores_concurrent_cgroups_it_did_not_create() {
    let root = TempDir::new().unwrap();
    let concurrent = root.path().join("request-concurrent");
    let barrier = Arc::new(Barrier::new(2));
    let concurrent_task = {
        let concurrent = concurrent.clone();
        let barrier = Arc::clone(&barrier);
        thread::spawn(move || {
            fs::create_dir(&concurrent).unwrap();
            barrier.wait();
            thread::sleep(Duration::from_millis(50));
        })
    };
    barrier.wait();
    let owned = root.path().join("request-owned");

    qualification_owned_cgroups_absent_for_test(&[owned.clone()]).unwrap();
    qualification_owned_request_dirs_absent_for_test(&[root
        .path()
        .join("qualification-request-owned")])
    .unwrap();
    assert!(concurrent.exists());
    concurrent_task.join().unwrap();
    fs::create_dir(&owned).unwrap();
    assert!(qualification_owned_cgroups_absent_for_test(&[owned]).is_err());
    assert!(concurrent.exists());
}

#[cfg(target_os = "linux")]
#[test]
fn linux_ci_caches_every_artifact_before_hostile_parent_environment() {
    let workflow = include_str!("../../.github/workflows/build.yml");
    let linux_job = workflow
        .split("  linux-agent-isolation:")
        .nth(1)
        .expect("Linux isolation job");
    let qualification = linux_job
        .find("- name: Require runtime-proven Linux isolation")
        .expect("qualification step");
    let before = &linux_job[..qualification];
    let after = &linux_job[qualification..];

    assert!(before.contains("uv pip sync"));
    assert!(before.contains("libwebkit2gtk-4.1-dev"));
    assert!(before.contains("libayatana-appindicator3-dev"));
    assert!(before.contains("cargo fetch --locked --target x86_64-unknown-linux-gnu"));
    assert!(before.contains("cargo test --locked --no-run"));
    assert!(after.contains("cargo test --locked --offline"));
    assert!(after.contains("HTTP_PROXY: qualification-fake-http-proxy"));
    assert!(!after.contains("\n      - name:"));
}

#[cfg(target_os = "linux")]
#[test]
fn linux_worker_spec_uses_fixed_bwrap_boundary_and_cgroup_limits() {
    let fixture = fixture();
    let cgroup = fixture.context.request_temp_root.join("delegated-cgroup");
    fs::create_dir(&cgroup).unwrap();
    fs::write(cgroup.join("cgroup.controllers"), "cpu memory pids\n").unwrap();
    fs::write(cgroup.join("cgroup.subtree_control"), "cpu memory pids\n").unwrap();
    fs::write(cgroup.join("cgroup.procs"), "").unwrap();
    fs::write(cgroup.join("cgroup.kill"), "").unwrap();
    fs::write(cgroup.join("cgroup.events"), "populated 0\n").unwrap();
    let bwrap = fixture.context.request_temp_root.join("bwrap");
    fs::write(&bwrap, "#!/bin/sh\n").unwrap();
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(&bwrap, fs::Permissions::from_mode(0o755)).unwrap();
    let system_paths = LinuxSystemPaths::for_tests(
        vec![fixture.context.system_paths.read_roots[1].clone()],
        fixture.context.system_paths.devices.clone(),
        canonical(bwrap),
        canonical(cgroup),
    )
    .unwrap();
    let context = LinuxQualificationContext::new(
        fixture.context.app_version.clone(),
        fixture.context.resources.clone(),
        fixture.context.environment.clone(),
        &fixture.context.request_temp_root,
        &fixture.context.project_root,
        &fixture.context.home_root,
        fixture.context.parent_secret_names.clone(),
        system_paths,
    )
    .unwrap();
    let request = context.request_temp_root.join("linux-request");
    fs::create_dir(&request).unwrap();
    assert!(LinuxBackend::discover(&context)
        .unwrap_err()
        .contains("Injected Linux system paths cannot qualify production"));
    let spec = LinuxBackend::worker_spec(&context, &canonical(request)).unwrap();

    assert_eq!(spec.executable, context.system_paths.bwrap);
    for required in [
        "--die-with-parent",
        "--new-session",
        "--unshare-all",
        "--unshare-net",
        "--clearenv",
        "--tmpfs",
        "/tmp",
        "--proc",
        "/proc",
        "--dev",
        "/dev",
        "--seccomp",
    ] {
        assert!(spec.args.iter().any(|arg| arg == required), "{required}");
    }
    assert!(!spec.args.iter().any(|arg| {
        arg == fixture.context.project_root.to_str().unwrap()
            || arg == fixture.context.home_root.to_str().unwrap()
    }));
    assert_eq!(spec.env["HOME"], "/home/agent");
    assert_eq!(spec.env["TMPDIR"], "/tmp");
    assert_eq!(spec.resource_limits, ResourceLimits::production());
    assert!(spec.launch_verifier.is_some());
    let child = spec
        .linux
        .as_ref()
        .expect("Linux containment")
        .cgroup_path();
    assert_eq!(
        fs::read_to_string(child.join("memory.max")).unwrap(),
        "1073741824"
    );
    assert_eq!(
        fs::read_to_string(child.join("memory.swap.max")).unwrap(),
        "0"
    );
    assert_eq!(fs::read_to_string(child.join("pids.max")).unwrap(), "4");
    assert_eq!(
        fs::read_to_string(child.join("cpu.max")).unwrap(),
        "100000 100000"
    );
    ProcessCleanupResource::finish(spec.linux.as_ref().unwrap()).unwrap();
    assert!(!child.exists());
}

#[cfg(target_os = "linux")]
#[test]
fn partial_cgroup_construction_cleans_every_setup_failure_stage() {
    for stage in [
        "cgroup.type",
        "memory.max",
        "memory.swap.max",
        "pids.max",
        "cpu.max",
        "cgroup.procs",
        "cgroup.kill",
        "cgroup.events",
        "memory.events",
        "pids.events",
        "cpu.stat",
    ] {
        let root = TempDir::new().unwrap();
        let reporter = Arc::new(RecordingCleanupReporter::default());
        let sink = CleanupFailureSink::new(reporter.clone());
        let error =
            cgroup_construction_failure_for_test(root.path(), stage, false, sink).unwrap_err();
        assert!(error.contains(stage), "{stage}: {error}");
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 0, "{stage}");
        assert!(reporter.0.lock().unwrap().is_empty(), "{stage}");
    }
}

#[cfg(target_os = "linux")]
#[test]
fn partial_cgroup_cleanup_failure_is_combined_and_reported() {
    for cleanup_stage in ["cgroup.kill", "cgroup.events", "populated", "remove"] {
        let root = TempDir::new().unwrap();
        let reporter = Arc::new(RecordingCleanupReporter::default());
        let sink = CleanupFailureSink::new(reporter.clone());

        let error = cgroup_construction_cleanup_failure_for_test(
            root.path(),
            "pids.max",
            cleanup_stage,
            sink,
        )
        .unwrap_err();

        assert!(error.contains("pids.max"));
        assert!(error.contains(cleanup_stage), "{cleanup_stage}: {error}");
        let diagnostics = reporter.0.lock().unwrap();
        assert_eq!(diagnostics.len(), 1, "{cleanup_stage}");
        assert!(
            diagnostics[0].contains(cleanup_stage),
            "{cleanup_stage}: {diagnostics:?}"
        );
    }
}

#[cfg(target_os = "linux")]
#[tokio::test]
async fn linux_required_qualification_passes_when_explicitly_required() {
    if std::env::var_os("NUCLEI_REQUIRE_LINUX_AGENT_ISOLATION").as_deref()
        != Some(std::ffi::OsStr::new("1"))
    {
        return;
    }
    let report = qualify_current_host(QualificationMode::RequireAvailable).await;
    assert!(report.available, "{:?}", report.reason);
    assert_eq!(report.qualified_frameworks, vec!["cirq"]);
    for required in [
        "bwrap",
        "user_namespace",
        "mount_namespace",
        "pid_namespace",
        "network_namespace",
        "cgroup_v2",
        "seccomp",
        "rlimits",
        "clean_environment",
        "filesystem",
        "subprocess",
        "output_caps",
        "cleanup",
        "cirq",
    ] {
        assert!(
            report
                .controls
                .iter()
                .any(|control| control.name == required && control.self_test_passed),
            "{required}"
        );
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
    assert!(profile.contains(r#"generations \"quoted\""#));
    assert!(profile.contains(r#"request\\one"#));
    assert!(!profile.contains("(allow network"));
    assert!(!profile.contains("(allow process-fork"));
    assert!(!profile.contains(r#"(subpath "/Users")"#));
    assert!(!profile.contains(r#"(subpath "/Applications")"#));
    assert!(!profile.contains(r#"(literal "/bin/sh")"#));
    assert!(!profile.contains(r#"(literal "/usr/bin/env")"#));
    let escaped_python = fixture
        .context
        .environment
        .python
        .to_string_lossy()
        .replace('\\', "\\\\")
        .replace('"', "\\\"");
    assert!(profile.contains(&format!(r#"(literal "{escaped_python}")"#)));
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
    let changed_file = context
        .resources
        .kernel_root
        .join("adapters/cirq_adapter.py");
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

#[test]
fn qualified_kernel_is_the_generation_copy_not_mutable_source() {
    let fixture = fixture();
    assert_eq!(
        fixture.context.resources.kernel_root,
        fixture.context.environment.root.join("kernel")
    );
    let original = qualification_cache_key(&fixture.context).unwrap();
    fs::write(
        fixture.source_kernel.join("adapters/cirq_adapter.py"),
        "# changed mutable source\n",
    )
    .unwrap();
    assert_eq!(original, qualification_cache_key(&fixture.context).unwrap());
}

#[test]
fn qualification_rejects_kernel_source_outside_locked_generation() {
    let fixture = fixture();
    let source_repository = fixture.source_kernel.parent().unwrap();
    let source = ResourcePaths::development(source_repository).unwrap();
    let context = &fixture.context;
    assert!(QualificationContext::new(
        context.app_version.clone(),
        source,
        context.environment.clone(),
        &context.request_temp_root,
        &context.project_root,
        &context.home_root,
        context.parent_secret_names.clone(),
        context.system_paths.clone(),
    )
    .is_err());
}

#[test]
fn every_pre_result_probe_failure_checks_request_directory_cleanup() {
    for stage in [
        "canonicalize",
        "spec",
        "symlink",
        "spawn",
        "wait",
        "stdout-reader",
        "stderr-reader",
        "timeout",
    ] {
        let root = TempDir::new().unwrap();
        let error = probe_request_guard_failure_for_test(root.path(), stage, false).unwrap_err();
        assert!(error.contains(stage));
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 0, "{stage}");
    }

    let root = TempDir::new().unwrap();
    let error = probe_request_guard_failure_for_test(root.path(), "spec", true).unwrap_err();
    assert!(error.contains("qualification cleanup failed"));
    assert_eq!(fs::read_dir(root.path()).unwrap().count(), 0);
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
