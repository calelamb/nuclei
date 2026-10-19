//! End-to-end check against a REAL kernel process (ignored by default).
//!
//! Run with:
//! `NUCLEI_E2E_PYTHON=<python> NUCLEI_E2E_ROOT=<repo root> cargo test e2e -- --ignored --nocapture`
//!
//! The token goes over the kernel's stdin (`NUCLEI_KERNEL_TOKEN_STDIN=1`),
//! exactly as the desktop shell does, never through the environment.

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::time::Duration;

use super::super::submit::{SubmitOutcome, SubmitPort, SubmitRequest};
use super::KernelSubmitPort;

struct KernelProcess {
    child: Child,
    url: String,
    token: String,
}

impl Drop for KernelProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn start_kernel() -> KernelProcess {
    let python = std::env::var("NUCLEI_E2E_PYTHON").expect("NUCLEI_E2E_PYTHON");
    let root = std::env::var("NUCLEI_E2E_ROOT").expect("NUCLEI_E2E_ROOT");
    let runtime = tempfile::tempdir().unwrap();
    let token = crate::commands::qec_data::generate_token().unwrap();
    let mut child = Command::new(python)
        .arg(format!("{root}/kernel/server.py"))
        .current_dir(&root)
        .env("PYTHONPATH", &root)
        .env("NUCLEI_KERNEL_TOKEN_STDIN", "1")
        .env("NUCLEI_RUNTIME_DIR", runtime.path())
        .env_remove("NUCLEI_KERNEL_TOKEN")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    writeln!(stdin, "{token}").unwrap();
    drop(stdin);
    let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
    let port = loop {
        let line = lines.next().expect("kernel exited early").unwrap();
        if let Some(rest) = line
            .trim()
            .strip_prefix("Nuclei kernel ready on ws://localhost:")
        {
            break rest.parse::<u16>().unwrap();
        }
    };
    // Keep draining stdout so the kernel never blocks on a full pipe.
    std::thread::spawn(move || for _ in lines {});
    KernelProcess {
        child,
        url: format!("ws://localhost:{port}"),
        token,
    }
}

fn port_with(kernel: &KernelProcess, token: String) -> KernelSubmitPort {
    KernelSubmitPort::new(kernel.url.clone(), Duration::from_secs(60))
        .with_token_provider(Arc::new(move || Ok(token.clone())))
}

#[test]
#[ignore = "needs a real Python kernel; see module docs"]
fn e2e_authenticated_submit_against_real_kernel() {
    let kernel = start_kernel();

    let good = port_with(&kernel, kernel.token.clone());
    let backends = good.list_backends();
    println!("backends via authenticated port: {}", backends.len());
    assert!(
        !backends.is_empty(),
        "authenticated list_backends must work"
    );

    let outcome = good.submit(&SubmitRequest {
        provider: "simulator".to_string(),
        backend: backends[0].name.clone(),
        code: "from qiskit import QuantumCircuit\nqc = QuantumCircuit(2, 2)\nqc.h(0)\nqc.cx(0, 1)\nqc.measure([0, 1], [0, 1])\n".to_string(),
        shots: 16,
        language: "qiskit".to_string(),
    });
    println!("submit outcome: {outcome:?}");
    assert!(matches!(outcome, SubmitOutcome::Ok { .. }), "{outcome:?}");

    // A wrong token must be refused by the real kernel with a clear error.
    let bad = port_with(&kernel, "wrong-token-".repeat(4));
    let rejected = bad.list_backends();
    assert!(rejected.is_empty());
    let message = match bad.submit(&SubmitRequest {
        provider: "simulator".to_string(),
        backend: "x".to_string(),
        code: String::new(),
        shots: 1,
        language: "qiskit".to_string(),
    }) {
        SubmitOutcome::Err { message } => message,
        other => panic!("{other:?}"),
    };
    println!("wrong-token error: {message}");
    assert!(message.contains("rejected the session token"), "{message}");

    // The unauthenticated behaviour this fixes: no provider -> no connection.
    let none = KernelSubmitPort::new(kernel.url.clone(), Duration::from_secs(5));
    assert!(matches!(
        none.submit(&SubmitRequest {
            provider: "simulator".to_string(),
            backend: "x".to_string(),
            code: String::new(),
            shots: 1,
            language: "qiskit".to_string(),
        }),
        SubmitOutcome::Err { .. }
    ));
}
