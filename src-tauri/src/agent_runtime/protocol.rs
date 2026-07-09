use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::BTreeMap;

pub const PROTOCOL_VERSION: u8 = 1;
pub const MAX_CODE_BYTES: usize = 262_144;
pub const MAX_SHOTS: u32 = 10_000;
const MAX_RESULT_KEY_BITS: usize = 4_096;

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

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct GateV1 {
    #[serde(rename = "type")]
    pub gate_type: String,
    pub targets: Vec<u32>,
    pub controls: Vec<u32>,
    pub params: Vec<f64>,
    pub layer: u32,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct CircuitSnapshotV1 {
    pub framework: Framework,
    pub qubit_count: u32,
    pub classical_bit_count: u32,
    pub depth: u32,
    pub gates: Vec<GateV1>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ComplexAmplitudeV1 {
    pub re: f64,
    pub im: f64,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct BlochCoordinatesV1 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SimulationResultV1 {
    pub state_vector: Vec<ComplexAmplitudeV1>,
    pub probabilities: BTreeMap<String, f64>,
    pub measurements: BTreeMap<String, u64>,
    pub bloch_coords: Vec<BlochCoordinatesV1>,
    pub execution_time_ms: f64,
    pub shot_count: u32,
}

#[derive(Debug)]
pub struct WorkerResponseV1 {
    pub protocol_version: u8,
    pub request_id: String,
    pub status: ResponseStatus,
    pub snapshot: Option<CircuitSnapshotV1>,
    pub result: Option<SimulationResultV1>,
    pub stdout: String,
    pub stderr: String,
    pub error: Option<WorkerErrorV1>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawWorkerResponseV1 {
    #[serde(deserialize_with = "deserialize_protocol_version")]
    protocol_version: u8,
    #[serde(deserialize_with = "deserialize_request_id")]
    request_id: String,
    status: ResponseStatus,
    #[serde(deserialize_with = "deserialize_nullable_snapshot")]
    snapshot: Option<CircuitSnapshotV1>,
    #[serde(deserialize_with = "deserialize_nullable_result")]
    result: Option<SimulationResultV1>,
    stdout: String,
    stderr: String,
    #[serde(deserialize_with = "deserialize_nullable_error")]
    error: Option<WorkerErrorV1>,
}

impl<'de> Deserialize<'de> for WorkerResponseV1 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = RawWorkerResponseV1::deserialize(deserializer)?;
        let response = Self {
            protocol_version: raw.protocol_version,
            request_id: raw.request_id,
            status: raw.status,
            snapshot: raw.snapshot,
            result: raw.result,
            stdout: raw.stdout,
            stderr: raw.stderr,
            error: raw.error,
        };
        response.validate_payloads().map_err(D::Error::custom)?;
        Ok(response)
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct WorkerErrorV1 {
    pub code: String,
    pub message: String,
    pub traceback: Option<String>,
    pub framework: Option<Framework>,
    pub dependency: Option<String>,
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

    fn validate_payloads(&self) -> Result<(), String> {
        match (self.status, self.error.is_some()) {
            (ResponseStatus::Ok, true) => {
                return Err("Successful worker response contained an error".into())
            }
            (ResponseStatus::Error, false) => {
                return Err("Failed worker response omitted its error".into())
            }
            _ => {}
        }

        if let Some(snapshot) = &self.snapshot {
            if snapshot.qubit_count > 63
                || snapshot.classical_bit_count > 1_000_000
                || snapshot.depth > 1_000_000
                || snapshot.gates.len() > 1_000_000
            {
                return Err("Worker snapshot exceeds supported bounds".into());
            }
            for gate in &snapshot.gates {
                if gate.gate_type.is_empty()
                    || gate.gate_type.len() > 128
                    || gate.layer >= snapshot.depth.max(1)
                    || gate
                        .targets
                        .iter()
                        .chain(&gate.controls)
                        .any(|&qubit| qubit >= snapshot.qubit_count)
                    || gate.params.iter().any(|value| !value.is_finite())
                {
                    return Err("Worker snapshot contains an invalid gate".into());
                }
            }
        }

        if let Some(result) = &self.result {
            if result.shot_count > MAX_SHOTS
                || result.state_vector.len() > 1_000_000
                || result.probabilities.len() > 1_000_000
                || result.measurements.len() > 1_000_000
                || result.bloch_coords.len() > 1_000_000
            {
                return Err("Worker simulation result exceeds supported bounds".into());
            }
            if !result.execution_time_ms.is_finite() || result.execution_time_ms < 0.0 {
                return Err("Worker execution time is invalid".into());
            }
            if result
                .state_vector
                .iter()
                .any(|value| !value.re.is_finite() || !value.im.is_finite())
                || result.bloch_coords.iter().any(|value| {
                    !value.x.is_finite()
                        || !value.y.is_finite()
                        || !value.z.is_finite()
                        || value.x.abs() > 1.000_001
                        || value.y.abs() > 1.000_001
                        || value.z.abs() > 1.000_001
                })
                || result.probabilities.iter().any(|(key, &value)| {
                    key.is_empty()
                        || key.len() > MAX_RESULT_KEY_BITS
                        || !key.bytes().all(|byte| matches!(byte, b'0' | b'1'))
                        || !value.is_finite()
                        || value < 0.0
                })
            {
                return Err("Worker simulation result contains invalid numeric data".into());
            }
            if result.measurements.iter().any(|(key, &count)| {
                key.is_empty()
                    || key.len() > MAX_RESULT_KEY_BITS
                    || !key.bytes().all(|byte| matches!(byte, b'0' | b'1'))
                    || count > u64::from(result.shot_count)
            }) {
                return Err("Worker measurements contain invalid keys or counts".into());
            }
            if let Some(snapshot) = &self.snapshot {
                let expected_state_len = 1_usize.checked_shl(snapshot.qubit_count);
                if !result.state_vector.is_empty()
                    && Some(result.state_vector.len()) != expected_state_len
                {
                    return Err("Worker state vector size does not match qubit_count".into());
                }
                if !result.bloch_coords.is_empty()
                    && result.bloch_coords.len() != snapshot.qubit_count as usize
                {
                    return Err("Worker Bloch coordinates do not match qubit_count".into());
                }
                if result
                    .probabilities
                    .keys()
                    .any(|key| key.len() != snapshot.qubit_count as usize)
                {
                    return Err("Worker probability width does not match qubit_count".into());
                }
            }
        }
        Ok(())
    }
}

fn deserialize_protocol_version<'de, D>(deserializer: D) -> Result<u8, D::Error>
where
    D: Deserializer<'de>,
{
    let version = u8::deserialize(deserializer)?;
    if version != PROTOCOL_VERSION {
        return Err(D::Error::custom("unsupported worker protocol version"));
    }
    Ok(version)
}

fn deserialize_request_id<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    let request_id = String::deserialize(deserializer)?;
    validate_request_id(&request_id).map_err(D::Error::custom)?;
    Ok(request_id)
}

fn deserialize_nullable_snapshot<'de, D>(
    deserializer: D,
) -> Result<Option<CircuitSnapshotV1>, D::Error>
where
    D: Deserializer<'de>,
{
    Option::<CircuitSnapshotV1>::deserialize(deserializer)
}

fn deserialize_nullable_result<'de, D>(
    deserializer: D,
) -> Result<Option<SimulationResultV1>, D::Error>
where
    D: Deserializer<'de>,
{
    Option::<SimulationResultV1>::deserialize(deserializer)
}

fn deserialize_nullable_error<'de, D>(deserializer: D) -> Result<Option<WorkerErrorV1>, D::Error>
where
    D: Deserializer<'de>,
{
    Option::<WorkerErrorV1>::deserialize(deserializer)
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
