//! Makes the actual Anthropic Messages API call.
//!
//! [`HttpTransport`] is the real implementation (blocking HTTPS over
//! rustls); [`MockTransport`] is a canned-response stand-in for tests that
//! never touches the network.

use std::sync::RwLock;
use std::time::Duration;

use serde_json::Value;

use super::GatewayError;

/// Anthropic Messages API version header. See <https://docs.anthropic.com>.
const ANTHROPIC_VERSION: &str = "2023-06-01";
/// Default Messages API endpoint.
const DEFAULT_ENDPOINT: &str = "https://api.anthropic.com/v1/messages";
/// Wall-clock budget for one Messages API call. Generous because Claude turns
/// with large tool results can legitimately take a while.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

/// Makes the actual Anthropic Messages API call. The real implementation
/// ([`HttpTransport`]) posts over HTTPS; [`MockTransport`] is for tests.
pub trait ModelTransport: Send + Sync {
    fn post_messages(&self, api_key: &str, body: &Value) -> Result<Value, GatewayError>;
}

/// Blocking HTTPS transport to the Anthropic Messages API, over rustls (no
/// system OpenSSL dependency).
pub struct HttpTransport {
    endpoint: String,
}

impl HttpTransport {
    pub fn new(endpoint: impl Into<String>) -> Self {
        Self {
            endpoint: endpoint.into(),
        }
    }
}

impl Default for HttpTransport {
    fn default() -> Self {
        Self::new(DEFAULT_ENDPOINT)
    }
}

impl ModelTransport for HttpTransport {
    fn post_messages(&self, api_key: &str, body: &Value) -> Result<Value, GatewayError> {
        let client = reqwest::blocking::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .build()
            .map_err(|e| GatewayError::Transport(format!("failed to build HTTP client: {e}")))?;

        let response = client
            .post(&self.endpoint)
            .header("x-api-key", api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .header("content-type", "application/json")
            .json(body)
            .send()
            .map_err(|e| GatewayError::Transport(format!("request failed: {e}")))?;

        let status = response.status();
        if !status.is_success() {
            // A short, truncated excerpt only — never the api_key, which lives
            // solely in the outbound request header and is never echoed back.
            let text = response.text().unwrap_or_default();
            let excerpt: String = text.chars().take(200).collect();
            return Err(GatewayError::Transport(format!(
                "Anthropic API returned {status}: {excerpt}"
            )));
        }

        response
            .json::<Value>()
            .map_err(|e| GatewayError::Transport(format!("failed to parse response JSON: {e}")))
    }
}

/// Canned-response transport for tests. Records the last request body it was
/// given so a test can assert the request shape without a real network call.
pub struct MockTransport {
    pub reply: Value,
    last_body: RwLock<Option<Value>>,
}

impl MockTransport {
    pub fn new(reply: Value) -> Self {
        Self {
            reply,
            last_body: RwLock::new(None),
        }
    }

    /// The body of the most recent `post_messages` call, if any.
    pub fn last_body(&self) -> Option<Value> {
        self.last_body.read().ok().and_then(|guard| guard.clone())
    }
}

impl ModelTransport for MockTransport {
    fn post_messages(&self, _api_key: &str, body: &Value) -> Result<Value, GatewayError> {
        if let Ok(mut guard) = self.last_body.write() {
            *guard = Some(body.clone());
        }
        Ok(self.reply.clone())
    }
}
