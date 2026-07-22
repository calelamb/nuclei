use std::fs;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Barrier};
use std::thread;
use std::time::Duration;

use app_lib::commands::qec_data::{
    generate_token, QecDataLaunchConfig, QecDataLifecycle, QecDataManager,
};
use tempfile::TempDir;

const FAKE_ENGINE: &str = r#"
import json
import os
import socket
import sys
import time

root = os.environ['NUCLEI_QEC_DATA_PROJECT_ROOT']
token = os.environ['NUCLEI_QEC_DATA_TOKEN']
port = int(sys.argv[sys.argv.index('--port') + 1])
with open(os.path.join(root, 'starts'), 'a', encoding='utf-8') as stream:
    stream.write('started\n')
with open(os.path.join(root, 'token'), 'w', encoding='utf-8') as stream:
    stream.write(token)
with open(os.path.join(root, 'argv'), 'w', encoding='utf-8') as stream:
    json.dump(sys.argv, stream)
listener = socket.socket()
listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
listener.bind(('127.0.0.1', port))
listener.listen()
print(f'NUCLEI_QEC_DATA_READY 127.0.0.1:{port}', flush=True)
while True:
    time.sleep(0.1)
"#;

const SILENT_ENGINE: &str = "import time\ntime.sleep(5)\n";
const EXITING_ENGINE: &str = "import sys\nsys.exit(7)\n";

fn python() -> PathBuf {
    std::env::var_os("PYTHON")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("python3"))
}

fn free_port() -> u16 {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind test port");
    listener.local_addr().expect("test address").port()
}

fn write_module(root: &Path, name: &str, source: &str) {
    fs::write(root.join(format!("{name}.py")), source).expect("write fake module");
}

fn fake_config(temp: &TempDir, module: &str, port: u16) -> QecDataLaunchConfig {
    QecDataLaunchConfig::new(python(), temp.path(), temp.path(), port)
        .with_module(module)
        .with_dependencies(Vec::new())
        .with_readiness_timeout(Duration::from_secs(2))
}

#[test]
fn qec_data_token_is_256_bit_lowercase_hex() {
    let token = generate_token().expect("OS random token");
    assert_eq!(token.len(), 64);
    assert!(token.bytes().all(|byte| byte.is_ascii_hexdigit()));
    assert_eq!(token, token.to_ascii_lowercase());
    assert_ne!(token, generate_token().expect("second token"));
}

#[test]
fn qec_data_token_is_environment_only_and_status_tracks_running() {
    let temp = TempDir::new().expect("temp project");
    write_module(temp.path(), "fake_engine", FAKE_ENGINE);
    let port = free_port();
    let manager = QecDataManager::new();

    let endpoint = manager
        .start(fake_config(&temp, "fake_engine", port))
        .expect("start fake engine");
    let argv = fs::read_to_string(temp.path().join("argv")).expect("recorded argv");
    let child_token = fs::read_to_string(temp.path().join("token")).expect("recorded token");

    assert_eq!(endpoint.url, format!("ws://127.0.0.1:{port}"));
    assert_eq!(child_token, endpoint.token);
    assert!(!argv.contains(&endpoint.token));
    let status = manager.status();
    assert_eq!(status.lifecycle, QecDataLifecycle::Running);
    assert_eq!(status.url, Some(endpoint.url.clone()));
    assert!(!serde_json::to_string(&status)
        .expect("serialize status")
        .contains(&endpoint.token));
    manager.stop().expect("stop fake engine");
    assert_eq!(manager.status().lifecycle, QecDataLifecycle::Stopped);
}

#[test]
fn concurrent_starts_share_one_owned_child() {
    let temp = TempDir::new().expect("temp project");
    write_module(temp.path(), "fake_engine", FAKE_ENGINE);
    let config = fake_config(&temp, "fake_engine", free_port());
    let manager = Arc::new(QecDataManager::new());
    let barrier = Arc::new(Barrier::new(3));
    let handles: Vec<_> = (0..2)
        .map(|_| {
            let shared = Arc::clone(&manager);
            let gate = Arc::clone(&barrier);
            let launch = config.clone();
            thread::spawn(move || {
                gate.wait();
                shared.start(launch)
            })
        })
        .collect();

    barrier.wait();
    let endpoints: Vec<_> = handles
        .into_iter()
        .map(|handle| handle.join().expect("start thread").expect("start result"))
        .collect();
    let starts = fs::read_to_string(temp.path().join("starts")).expect("start count");

    assert_eq!(endpoints[0], endpoints[1]);
    assert_eq!(starts.lines().count(), 1);
    manager.stop().expect("stop fake engine");
}

#[test]
fn missing_dependencies_return_stable_metadata_without_spawning() {
    let temp = TempDir::new().expect("temp project");
    write_module(temp.path(), "fake_engine", FAKE_ENGINE);
    let config = fake_config(&temp, "fake_engine", free_port())
        .with_dependencies(vec!["nuclei_dependency_that_does_not_exist".to_string()]);
    let manager = QecDataManager::new();

    let error = manager.start(config).expect_err("dependency must fail");

    assert_eq!(error.code, "missing_dependency");
    assert_eq!(
        error.missing_dependencies,
        vec!["nuclei_dependency_that_does_not_exist"]
    );
    assert!(!temp.path().join("starts").exists());
    assert_eq!(manager.status().lifecycle, QecDataLifecycle::Failed);
}

#[test]
fn port_squatter_is_reported_and_never_killed() {
    let temp = TempDir::new().expect("temp project");
    write_module(temp.path(), "fake_engine", FAKE_ENGINE);
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind squatter");
    let port = listener.local_addr().expect("squatter address").port();
    let manager = QecDataManager::new();

    let error = manager
        .start(fake_config(&temp, "fake_engine", port))
        .expect_err("occupied port must fail");

    assert_eq!(error.code, "port_in_use");
    assert_eq!(
        listener.local_addr().expect("squatter remains").port(),
        port
    );
    assert!(!temp.path().join("starts").exists());
}

#[test]
fn readiness_timeout_and_early_exit_reap_only_the_started_child() {
    let temp = TempDir::new().expect("temp project");
    write_module(temp.path(), "silent_engine", SILENT_ENGINE);
    write_module(temp.path(), "exiting_engine", EXITING_ENGINE);
    let manager = QecDataManager::new();

    let timeout = manager
        .start(
            fake_config(&temp, "silent_engine", free_port())
                .with_readiness_timeout(Duration::from_millis(100)),
        )
        .expect_err("silent child must time out");
    assert_eq!(timeout.code, "readiness_timeout");

    let exit = manager
        .start(fake_config(&temp, "exiting_engine", free_port()))
        .expect_err("early child exit must fail");
    assert_eq!(exit.code, "startup_failed");
    assert_eq!(manager.status().lifecycle, QecDataLifecycle::Failed);
}

#[test]
fn stop_restart_rotates_token_and_drop_releases_owned_port() {
    let temp = TempDir::new().expect("temp project");
    write_module(temp.path(), "fake_engine", FAKE_ENGINE);
    let port = free_port();
    let config = fake_config(&temp, "fake_engine", port);

    let first_token = {
        let manager = QecDataManager::new();
        let first = manager.start(config.clone()).expect("first start");
        manager.stop().expect("first stop");
        let second = manager.start(config).expect("restart");
        assert_ne!(first.token, second.token);
        second.token
    };

    assert_eq!(first_token.len(), 64);
    let rebound = TcpListener::bind(("127.0.0.1", port)).expect("drop released port");
    assert_eq!(rebound.local_addr().expect("rebound address").port(), port);
}

#[test]
fn project_root_must_exist_and_be_a_directory() {
    let temp = TempDir::new().expect("temp project");
    write_module(temp.path(), "fake_engine", FAKE_ENGINE);
    let missing = temp.path().join("missing");
    let config = QecDataLaunchConfig::new(python(), temp.path(), &missing, free_port())
        .with_module("fake_engine")
        .with_dependencies(Vec::new());

    let error = QecDataManager::new()
        .start(config)
        .expect_err("missing project root must fail");
    assert_eq!(error.code, "invalid_project_root");
}
