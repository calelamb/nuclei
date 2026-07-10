//! Secure model gateway (Stage R2).
//!
//! Rust holds the Anthropic API key in the OS keychain and makes the
//! Anthropic Messages API call itself. The key never reaches the frontend and
//! is never placed in the model's own context — only [`ModelGateway::complete`]
//! ever reads it, and only to attach it to the outbound request header.
//!
//! The module is split by concern, each independently unit-tested:
//! - [`store`] — where the API key is persisted ([`SecretStore`] trait,
//!   [`KeyringStore`] for the OS keychain, `store::MemoryStore` for tests).
//! - [`transport`] — how the Messages API is called ([`ModelTransport`]
//!   trait, [`HttpTransport`] over rustls, `transport::MockTransport` for
//!   tests).
//! - [`protocol`] — pure request/response shaping (`build_request_body`,
//!   `parse_reply`), no IO.
//! - This file — [`GatewayError`] and [`ModelGateway`] itself, which wires the
//!   above together.
//!
//! Only the API-key commands (`dirac_set_api_key`/`dirac_has_api_key`/
//! `dirac_clear_api_key` in `mod.rs`) have a live caller at this stage —
//! `ModelGateway::complete` and its supporting types (plus the `MemoryStore`/
//! `MockTransport` test doubles, re-exported here for the same reason) are
//! the gateway's public surface for Stage R4's orchestrator, which is the
//! loop that will actually call the model. The allow below silences the
//! interim "never used"/"unused import" warnings for that surface; every
//! path it covers already has a unit test in this module or its submodules.
#![allow(dead_code, unused_imports)]

pub mod protocol;
pub mod store;
pub mod transport;

pub use protocol::{build_request_body, parse_reply, ModelReply, ModelRequest, ToolUse};
pub use store::{KeyringStore, MemoryStore, SecretStore};
pub use transport::{HttpTransport, MockTransport, ModelTransport};

/// Guard against a runaway request body; real Anthropic payloads are KB-sized,
/// so anything past 1 MiB indicates a bug upstream (e.g. an unbounded tool
/// result loop), not a legitimate request.
const MAX_BODY_BYTES: usize = 1_048_576;

/// Gateway failures. Every variant is a plain, pre-formatted `String` (or no
/// payload at all) — none of them ever carry the API key, so this type is
/// always safe to `Display`, log, or return across the Tauri command
/// boundary.
#[derive(Debug)]
pub enum GatewayError {
    /// No API key is stored (or none has ever been set).
    NoApiKey,
    /// The secret store failed (keychain locked, entry invalid, etc.).
    Store(String),
    /// The HTTP transport failed, or the API returned a non-2xx status.
    Transport(String),
    /// The model response could not be parsed into a [`ModelReply`].
    Parse(String),
    /// The assembled request body exceeded [`MAX_BODY_BYTES`].
    TooLarge,
}

impl std::fmt::Display for GatewayError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GatewayError::NoApiKey => write!(f, "no Anthropic API key is stored"),
            GatewayError::Store(msg) => write!(f, "secret store error: {msg}"),
            GatewayError::Transport(msg) => write!(f, "model transport error: {msg}"),
            GatewayError::Parse(msg) => write!(f, "failed to parse model response: {msg}"),
            GatewayError::TooLarge => write!(f, "request body exceeds the size limit"),
        }
    }
}

impl std::error::Error for GatewayError {}

/// The secure model gateway: owns the API key's lifecycle and the one path
/// that ever attaches it to an outbound request.
pub struct ModelGateway {
    store: Box<dyn SecretStore>,
    transport: Box<dyn ModelTransport>,
}

impl ModelGateway {
    pub fn new(store: Box<dyn SecretStore>, transport: Box<dyn ModelTransport>) -> Self {
        Self { store, transport }
    }

    /// Store the Anthropic API key. Rejects an empty (or whitespace-only) key.
    pub fn set_api_key(&self, key: &str) -> Result<(), GatewayError> {
        if key.trim().is_empty() {
            return Err(GatewayError::Store("API key must not be empty".to_string()));
        }
        self.store.store(key)
    }

    /// Whether a key is currently stored. Store errors are treated as "no
    /// key" here — the caller should use `set_api_key`/`clear_api_key` to
    /// diagnose store failures explicitly.
    pub fn has_api_key(&self) -> bool {
        matches!(self.store.load(), Ok(Some(_)))
    }

    pub fn clear_api_key(&self) -> Result<(), GatewayError> {
        self.store.clear()
    }

    /// Make one Messages API turn: load the key, assemble the body, post it,
    /// and parse the reply. Never logs or returns the key.
    pub fn complete(&self, req: &ModelRequest) -> Result<ModelReply, GatewayError> {
        let key = self.store.load()?.ok_or(GatewayError::NoApiKey)?;

        let body = build_request_body(req);
        let body_len = serde_json::to_vec(&body)
            .map(|bytes| bytes.len())
            .unwrap_or(usize::MAX);
        if body_len > MAX_BODY_BYTES {
            return Err(GatewayError::TooLarge);
        }

        let resp = self.transport.post_messages(&key, &body)?;
        parse_reply(&resp)
    }
}

impl Default for ModelGateway {
    fn default() -> Self {
        Self::new(
            Box::new(KeyringStore::default()),
            Box::new(HttpTransport::default()),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn sample_request(tools: Vec<Value>) -> ModelRequest {
        ModelRequest {
            model: "claude-sonnet-4-5".to_string(),
            max_tokens: 1024,
            system: "You are Dirac, a quantum computing tutor.".to_string(),
            messages: vec![serde_json::json!({"role": "user", "content": "hello"})],
            tools,
        }
    }

    #[test]
    fn empty_api_key_is_rejected() {
        let gateway = ModelGateway::new(
            Box::new(MemoryStore::default()),
            Box::new(MockTransport::new(Value::Null)),
        );

        let err = gateway.set_api_key("   ").expect_err("empty key must fail");
        assert!(matches!(err, GatewayError::Store(_)));
        assert!(!gateway.has_api_key());
    }

    #[test]
    fn complete_returns_no_api_key_when_unset() {
        let gateway = ModelGateway::new(
            Box::new(MemoryStore::default()),
            Box::new(MockTransport::new(Value::Null)),
        );

        let err = gateway
            .complete(&sample_request(Vec::new()))
            .expect_err("no key stored");
        assert!(matches!(err, GatewayError::NoApiKey));
    }

    #[test]
    fn complete_builds_request_loads_key_and_parses_reply() {
        let store = MemoryStore::default();
        store.store("sk-ant-test-key").expect("store");

        let canned_reply = serde_json::json!({
            "content": [{"type": "text", "text": "Bell state confirmed."}],
            "stop_reason": "end_turn"
        });
        let transport = MockTransport::new(canned_reply);

        let gateway = ModelGateway::new(Box::new(store), Box::new(transport));
        let reply = gateway
            .complete(&sample_request(Vec::new()))
            .expect("complete should succeed");

        assert_eq!(reply.text, "Bell state confirmed.");
        assert_eq!(reply.stop_reason, "end_turn");
    }

    #[test]
    fn complete_sends_a_body_with_model_and_messages() {
        let store = MemoryStore::default();
        store.store("sk-ant-test-key").expect("store");

        // Wrap the transport in an `Arc` so the test can keep its own handle
        // to inspect `last_body()` after `ModelGateway` (which boxes its
        // transport by value) has consumed a clone of it.
        let transport = std::sync::Arc::new(MockTransport::new(serde_json::json!({
            "content": [],
            "stop_reason": "end_turn"
        })));
        let gateway = ModelGateway::new(Box::new(store), Box::new(ArcTransport(transport.clone())));

        gateway
            .complete(&sample_request(Vec::new()))
            .expect("complete should succeed");

        let sent = transport.last_body().expect("transport recorded a body");
        assert_eq!(sent["model"], "claude-sonnet-4-5");
        assert!(sent["messages"].is_array());
    }

    /// Thin adapter so a `MockTransport` behind an `Arc` can still satisfy
    /// `ModelTransport` (which the gateway boxes by value), letting the test
    /// keep its own handle to assert on afterwards.
    struct ArcTransport(std::sync::Arc<MockTransport>);

    impl ModelTransport for ArcTransport {
        fn post_messages(&self, api_key: &str, body: &Value) -> Result<Value, GatewayError> {
            self.0.post_messages(api_key, body)
        }
    }
}
