use serde::{Deserialize, Deserializer, Serialize};

pub const PROTOCOL_VERSION: u8 = 1;
pub const MAX_CODE_BYTES: usize = 262_144;
pub const MAX_SHOTS: u32 = 10_000;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Parse,
    Simulate,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Framework {
    Qiskit,
    Cirq,
    Qsharp,
}

#[derive(Clone, Debug)]
pub struct FrontendRequestV1 {
    pub protocol_version: u8,
    pub request_id: String,
    pub action: Action,
    pub framework: Framework,
    pub language: String,
    pub code: String,
    pub shots: Option<u32>,
    shots_present: bool,
}

#[derive(Default)]
enum OptionalShots {
    #[default]
    Missing,
    Present(Option<u32>),
}

fn deserialize_optional_shots<'de, D>(deserializer: D) -> Result<OptionalShots, D::Error>
where
    D: Deserializer<'de>,
{
    Option::<u32>::deserialize(deserializer).map(OptionalShots::Present)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawFrontendRequestV1 {
    protocol_version: u8,
    request_id: String,
    action: Action,
    framework: Framework,
    language: String,
    code: String,
    #[serde(default, deserialize_with = "deserialize_optional_shots")]
    shots: OptionalShots,
}

impl<'de> Deserialize<'de> for FrontendRequestV1 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = RawFrontendRequestV1::deserialize(deserializer)?;
        let (shots, shots_present) = match raw.shots {
            OptionalShots::Missing => (None, false),
            OptionalShots::Present(shots) => (shots, true),
        };
        Ok(Self {
            protocol_version: raw.protocol_version,
            request_id: raw.request_id,
            action: raw.action,
            framework: raw.framework,
            language: raw.language,
            code: raw.code,
            shots,
            shots_present,
        })
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct WorkerRequestV1 {
    pub protocol_version: u8,
    pub request_id: String,
    pub action: Action,
    pub framework: Framework,
    pub language: String,
    pub code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shots: Option<u32>,
}

impl TryFrom<FrontendRequestV1> for WorkerRequestV1 {
    type Error = String;

    fn try_from(value: FrontendRequestV1) -> Result<Self, Self::Error> {
        if value.protocol_version != PROTOCOL_VERSION {
            return Err("Unsupported agent protocol version".into());
        }
        validate_request_id(&value.request_id)?;
        if value.code.as_bytes().len() > MAX_CODE_BYTES {
            return Err("Agent source exceeds 262144 UTF-8 bytes".into());
        }

        let expected_language = match value.framework {
            Framework::Qsharp => "qsharp",
            Framework::Qiskit | Framework::Cirq => "python",
        };
        if value.language != expected_language {
            return Err("Agent framework and language do not match".into());
        }

        match value.action {
            Action::Parse if value.shots_present => {
                return Err("Parse requests must omit shots".into());
            }
            Action::Simulate if !matches!(value.shots, Some(1..=MAX_SHOTS)) => {
                return Err("Simulation shots must be between 1 and 10000".into());
            }
            _ => {}
        }

        Ok(Self {
            protocol_version: PROTOCOL_VERSION,
            request_id: value.request_id,
            action: value.action,
            framework: value.framework,
            language: value.language,
            code: value.code,
            shots: value.shots,
        })
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ResponseStatus {
    Ok,
    Error,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkerResponseV1 {
    pub protocol_version: u8,
    pub request_id: String,
    pub status: ResponseStatus,
    pub snapshot: Option<serde_json::Value>,
    pub result: Option<serde_json::Value>,
    pub stdout: String,
    pub stderr: String,
    pub error: Option<serde_json::Value>,
}

impl WorkerResponseV1 {
    pub fn validate(&self, expected_request_id: &str) -> Result<(), String> {
        if self.protocol_version != PROTOCOL_VERSION {
            return Err("Unsupported worker protocol version".into());
        }
        validate_request_id(&self.request_id)?;
        if self.request_id != expected_request_id {
            return Err("Worker response request ID mismatch".into());
        }
        Ok(())
    }
}

fn validate_request_id(request_id: &str) -> Result<(), String> {
    if request_id.is_empty()
        || request_id.len() > 64
        || !request_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    {
        return Err("Invalid agent request ID".into());
    }
    Ok(())
}
