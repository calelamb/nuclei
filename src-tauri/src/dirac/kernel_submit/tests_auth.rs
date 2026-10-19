//! Authentication tests against a tiny in-process mock kernel (a blocking
//! tungstenite server on a loopback port). Covers proof OK / wrong / missing,
//! a rejected token, and that nothing is sent before the proof verifies.

use std::net::TcpListener;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::Sha256;
use tungstenite::protocol::frame::coding::CloseCode;
use tungstenite::protocol::CloseFrame;
use tungstenite::Message;

use super::super::submit::{SubmitOutcome, SubmitPort, SubmitRequest};
use super::auth::verify_proof;
use super::KernelSubmitPort;

const TOKEN: &str = "mock-kernel-token-0123456789abcdef0123456789abcdef";

#[derive(Clone, Copy)]
enum Mode {
    ProofOk,
    ProofWrong,
    ProofMissing,
    RejectToken,
}

fn proof(token: &str, nonce: &str) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(token.as_bytes()).unwrap();
    mac.update(nonce.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

/// Spawns a one-connection mock kernel. The returned receiver yields every
/// text frame the client sent after its authenticate frame.
fn mock_kernel(mode: Mode) -> (String, mpsc::Receiver<Value>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("ws://127.0.0.1:{}", listener.local_addr().unwrap().port());
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_millis(800)))
            .unwrap();
        let mut ws = tungstenite::accept(stream).unwrap();
        let first = ws.read().unwrap();
        let frame: Value = serde_json::from_str(first.to_text().unwrap()).unwrap();
        assert_eq!(frame["type"], "authenticate");
        assert_eq!(frame["token"], TOKEN);
        let nonce = frame["nonce"].as_str().unwrap().to_string();
        assert_eq!(nonce.len(), 64, "nonce is 32 random bytes, hex encoded");
        let ack = match mode {
            Mode::ProofOk => json!({"type":"authenticated","proof":proof(TOKEN, &nonce)}),
            Mode::ProofWrong => {
                json!({"type":"authenticated","proof":proof("other-token", &nonce)})
            }
            Mode::ProofMissing => json!({"type":"authenticated"}),
            Mode::RejectToken => {
                let _ = ws.close(Some(CloseFrame {
                    code: CloseCode::from(4401),
                    reason: "authentication failed".into(),
                }));
                return;
            }
        };
        ws.send(Message::Text(ack.to_string())).unwrap();
        // Collect whatever the client sends next (until timeout or close).
        while let Ok(Message::Text(text)) = ws.read() {
            let value: Value = serde_json::from_str(&text).unwrap();
            let is_submit = value["type"] == "hardware_submit";
            let _ = tx.send(value);
            if is_submit {
                let reply = json!({"type":"hardware_job_submitted","job":{"id":"job_mock"}});
                let _ = ws.send(Message::Text(reply.to_string()));
            }
        }
    });
    (url, rx)
}

fn port_for(url: &str) -> KernelSubmitPort {
    KernelSubmitPort::new(url, Duration::from_secs(5))
        .with_token_provider(std::sync::Arc::new(|| Ok(TOKEN.to_string())))
}

fn request() -> SubmitRequest {
    SubmitRequest {
        provider: "simulator".to_string(),
        backend: "aer".to_string(),
        code: "OPENQASM 2.0;".to_string(),
        shots: 10,
        language: "qasm".to_string(),
    }
}

fn expect_err(outcome: SubmitOutcome) -> String {
    match outcome {
        SubmitOutcome::Err { message } => message,
        other => panic!("expected an error outcome, got {other:?}"),
    }
}

#[test]
fn proof_ok_authenticates_then_submit_proceeds() {
    let (url, rx) = mock_kernel(Mode::ProofOk);
    let outcome = port_for(&url).submit(&request());
    assert_eq!(
        outcome,
        SubmitOutcome::Ok {
            job_id: "job_mock".to_string()
        }
    );
    assert_eq!(rx.recv().unwrap()["type"], "hardware_submit");
}

#[test]
fn wrong_proof_fails_and_sends_nothing_else() {
    let (url, rx) = mock_kernel(Mode::ProofWrong);
    let message = expect_err(port_for(&url).submit(&request()));
    assert!(message.contains("proof is wrong"), "{message}");
    assert!(rx.recv_timeout(Duration::from_millis(1200)).is_err());
}

#[test]
fn missing_proof_fails_and_sends_nothing_else() {
    let (url, rx) = mock_kernel(Mode::ProofMissing);
    let message = expect_err(port_for(&url).submit(&request()));
    assert!(message.contains("no proof"), "{message}");
    assert!(rx.recv_timeout(Duration::from_millis(1200)).is_err());
}

#[test]
fn rejected_token_reports_a_clear_error() {
    let (url, _rx) = mock_kernel(Mode::RejectToken);
    let message = expect_err(port_for(&url).submit(&request()));
    assert!(message.contains("rejected the session token"), "{message}");
}

#[test]
fn without_a_token_provider_no_connection_is_attempted() {
    // Nothing listens here; the error must be about the token, not the socket.
    let port = KernelSubmitPort::new("ws://127.0.0.1:1", Duration::from_secs(1));
    let message = expect_err(port.submit(&request()));
    assert!(message.contains("token is not available"), "{message}");
}

#[test]
fn unavailable_token_surfaces_the_reason() {
    let port = KernelSubmitPort::new("ws://127.0.0.1:1", Duration::from_secs(1))
        .with_token_provider(std::sync::Arc::new(|| {
            Err("Kernel is not running".to_string())
        }));
    let message = expect_err(port.submit(&request()));
    assert!(message.contains("Kernel is not running"), "{message}");
}

#[test]
fn verify_proof_rejects_malformed_and_mismatched_values() {
    let good = proof(TOKEN, "abcd");
    assert!(verify_proof(TOKEN, "abcd", &good));
    assert!(!verify_proof(TOKEN, "abce", &good));
    assert!(!verify_proof("x", "abcd", &good));
    assert!(!verify_proof(TOKEN, "abcd", "not-hex"));
    assert!(!verify_proof(TOKEN, "abcd", ""));
}
