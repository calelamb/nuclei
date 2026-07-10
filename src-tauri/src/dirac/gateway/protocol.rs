//! Pure Anthropic Messages API request/response shaping. No IO — everything
//! here is a plain data transform, exercised directly by unit tests.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::GatewayError;

/// One turn's worth of request to send to the model. `messages` and `tools`
/// stay opaque `Value`s — the orchestrator (Stage R4) owns their shape.
#[derive(Debug, Clone)]
pub struct ModelRequest {
    pub model: String,
    pub max_tokens: u32,
    pub system: String,
    pub messages: Vec<Value>,
    pub tools: Vec<Value>,
}

/// One `tool_use` content block from a model response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolUse {
    pub id: String,
    pub name: String,
    pub input: Value,
}

/// A parsed model turn: concatenated assistant text, any tool calls, and why
/// the model stopped.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelReply {
    pub text: String,
    pub tool_uses: Vec<ToolUse>,
    pub stop_reason: String,
}

/// Assemble the Anthropic Messages API request body. Pure — no IO. `tools` is
/// omitted entirely when empty rather than sent as `[]`, matching how the
/// existing TS orchestrator calls the API.
pub fn build_request_body(req: &ModelRequest) -> Value {
    let mut body = serde_json::json!({
        "model": req.model,
        "max_tokens": req.max_tokens,
        "system": req.system,
        "messages": req.messages,
    });

    if !req.tools.is_empty() {
        if let Some(obj) = body.as_object_mut() {
            obj.insert("tools".to_string(), Value::Array(req.tools.clone()));
        }
    }

    body
}

/// Parse an Anthropic Messages API response into a [`ModelReply`]. Pure — no
/// IO. Walks `resp["content"]`: `text` blocks are concatenated, `tool_use`
/// blocks are collected. Missing or malformed `content` is a
/// [`GatewayError::Parse`].
pub fn parse_reply(resp: &Value) -> Result<ModelReply, GatewayError> {
    let content = resp
        .get("content")
        .and_then(Value::as_array)
        .ok_or_else(|| GatewayError::Parse("response is missing a `content` array".to_string()))?;

    let mut text = String::new();
    let mut tool_uses = Vec::new();

    for block in content {
        match block.get("type").and_then(Value::as_str) {
            Some("text") => {
                if let Some(chunk) = block.get("text").and_then(Value::as_str) {
                    text.push_str(chunk);
                }
            }
            Some("tool_use") => {
                let id = block
                    .get("id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        GatewayError::Parse("tool_use block is missing `id`".to_string())
                    })?
                    .to_string();
                let name = block
                    .get("name")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        GatewayError::Parse("tool_use block is missing `name`".to_string())
                    })?
                    .to_string();
                let input = block.get("input").cloned().unwrap_or(Value::Null);
                tool_uses.push(ToolUse { id, name, input });
            }
            // Other block types (e.g. `thinking`) are ignored by this stage;
            // the orchestrator can extend this once it needs them.
            _ => {}
        }
    }

    let stop_reason = resp
        .get("stop_reason")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    Ok(ModelReply {
        text,
        tool_uses,
        stop_reason,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn build_request_body_includes_core_fields_and_omits_empty_tools() {
        let body = build_request_body(&sample_request(Vec::new()));
        let obj = body.as_object().expect("object");

        assert_eq!(obj["model"], "claude-sonnet-4-5");
        assert_eq!(obj["max_tokens"], 1024);
        assert_eq!(obj["system"], "You are Dirac, a quantum computing tutor.");
        assert!(obj["messages"].is_array());
        assert!(
            !obj.contains_key("tools"),
            "tools must be omitted when empty"
        );
    }

    #[test]
    fn build_request_body_includes_tools_when_present() {
        let tools = vec![serde_json::json!({"name": "run_simulation"})];
        let body = build_request_body(&sample_request(tools));
        let obj = body.as_object().expect("object");

        assert!(obj.contains_key("tools"));
        assert_eq!(obj["tools"][0]["name"], "run_simulation");
    }

    #[test]
    fn parse_reply_extracts_text_tool_use_and_stop_reason() {
        let resp = serde_json::json!({
            "content": [
                {"type": "text", "text": "Let's check "},
                {"type": "text", "text": "the circuit."},
                {
                    "type": "tool_use",
                    "id": "toolu_01",
                    "name": "run_simulation",
                    "input": {"shots": 1024}
                }
            ],
            "stop_reason": "tool_use"
        });

        let reply = parse_reply(&resp).expect("parse");

        assert_eq!(reply.text, "Let's check the circuit.");
        assert_eq!(reply.tool_uses.len(), 1);
        assert_eq!(reply.tool_uses[0].id, "toolu_01");
        assert_eq!(reply.tool_uses[0].name, "run_simulation");
        assert_eq!(reply.tool_uses[0].input, serde_json::json!({"shots": 1024}));
        assert_eq!(reply.stop_reason, "tool_use");
    }

    #[test]
    fn parse_reply_rejects_malformed_content() {
        let missing = serde_json::json!({"stop_reason": "end_turn"});
        assert!(matches!(parse_reply(&missing), Err(GatewayError::Parse(_))));

        let not_an_array = serde_json::json!({"content": "oops", "stop_reason": "end_turn"});
        assert!(matches!(
            parse_reply(&not_an_array),
            Err(GatewayError::Parse(_))
        ));

        let bad_tool_use = serde_json::json!({
            "content": [{"type": "tool_use", "name": "x", "input": {}}],
            "stop_reason": "tool_use"
        });
        assert!(matches!(
            parse_reply(&bad_tool_use),
            Err(GatewayError::Parse(_))
        ));
    }
}
