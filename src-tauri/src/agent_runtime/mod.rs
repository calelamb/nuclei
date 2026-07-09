pub mod protocol;
pub mod resources;
pub mod unsupported;

#[derive(Clone, Debug, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ControlResult {
    pub name: String,
    pub self_test_passed: bool,
}

#[derive(Clone, Debug, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityReport {
    pub available: bool,
    pub reason: Option<String>,
    pub qualified_frameworks: Vec<String>,
    pub controls: Vec<ControlResult>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum QualificationMode {
    AllowUnavailable,
    RequireAvailable,
}
