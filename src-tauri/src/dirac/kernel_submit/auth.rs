//! Kernel authentication handshake for the R7 transport.
//!
//! The kernel requires `{"type":"authenticate","token":...,"nonce":<64 hex>}`
//! as the first frame and answers with `{"type":"authenticated","proof":hex}`
//! where `proof = HMAC-SHA256(key = token, msg = nonce)`. The proof is checked
//! before anything else is sent, so a process squatting the kernel port never
//! receives a request.

use std::io::{Read, Write};

use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::Sha256;
use tungstenite::protocol::frame::coding::CloseCode;
use tungstenite::{Message, WebSocket};

/// Close code the kernel uses for a missing or wrong token.
const CLOSE_UNAUTHENTICATED: u16 = 4401;
/// Close code the kernel uses when too many connections are unauthenticated.
const CLOSE_BUSY: u16 = 4429;
const NONCE_BYTES: usize = 32;

type HmacSha256 = Hmac<Sha256>;

/// A fresh 32-byte random nonce, hex encoded (64 chars).
pub(super) fn generate_nonce() -> Result<String, String> {
    let mut bytes = [0_u8; NONCE_BYTES];
    getrandom::getrandom(&mut bytes)
        .map_err(|e| format!("OS randomness unavailable for kernel authentication: {e}"))?;
    Ok(hex::encode(bytes))
}

/// True when `proof_hex` is HMAC-SHA256(token, nonce); compared in constant time.
pub(super) fn verify_proof(token: &str, nonce: &str, proof_hex: &str) -> bool {
    let Ok(signature) = hex::decode(proof_hex) else {
        return false;
    };
    let Ok(mut mac) = HmacSha256::new_from_slice(token.as_bytes()) else {
        return false;
    };
    mac.update(nonce.as_bytes());
    mac.verify_slice(&signature).is_ok()
}

/// Run the handshake on a freshly upgraded socket. Returns once the kernel's
/// proof verified; on any failure the caller must drop the socket.
pub(super) fn authenticate<S: Read + Write>(
    ws: &mut WebSocket<S>,
    token: &str,
) -> Result<(), String> {
    let nonce = generate_nonce()?;
    let frame = json!({ "type": "authenticate", "token": token, "nonce": nonce });
    ws.send(Message::Text(frame.to_string()))
        .map_err(|e| format!("kernel authenticate send failed: {e}"))?;

    // The ack must be the very next frame; anything else means the peer is not
    // a kernel that accepted our session.
    loop {
        match ws
            .read()
            .map_err(|e| format!("kernel authentication read failed: {e}"))?
        {
            Message::Text(text) => return check_ack(token, &nonce, text.as_str()),
            Message::Close(frame) => return Err(close_error(frame.map(|f| f.code))),
            Message::Ping(_) | Message::Pong(_) => {}
            _ => return Err("kernel sent an unexpected frame during authentication".to_string()),
        }
    }
}

fn check_ack(token: &str, nonce: &str, text: &str) -> Result<(), String> {
    let value: Value = serde_json::from_str(text)
        .map_err(|_| "kernel sent a malformed authentication reply".to_string())?;
    if value.get("type").and_then(Value::as_str) != Some("authenticated") {
        return Err("kernel did not acknowledge authentication".to_string());
    }
    match value.get("proof").and_then(Value::as_str) {
        None => Err(
            "kernel authentication reply carried no proof; the listener on the kernel \
             port is not a verified Nuclei kernel"
                .to_string(),
        ),
        Some(proof) if verify_proof(token, nonce, proof) => Ok(()),
        Some(_) => Err(
            "kernel authentication proof is wrong; the listener on the kernel port is \
             not the Nuclei kernel that was started with this session token"
                .to_string(),
        ),
    }
}

fn close_error(code: Option<CloseCode>) -> String {
    match code.map(u16::from) {
        Some(CLOSE_UNAUTHENTICATED) => {
            "kernel rejected the session token; restart Nuclei".to_string()
        }
        Some(CLOSE_BUSY) => {
            "kernel is busy with other unauthenticated connections; retry shortly".to_string()
        }
        _ => "kernel closed the connection during authentication".to_string(),
    }
}
