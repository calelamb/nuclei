//! Hardware submission port (Stage R4).
//!
//! [`SubmitPort`] is the ONLY channel through which a job can reach real, paid
//! quantum hardware. Port of `src/services/agent/submitPort.ts`. The policy
//! gate + budget ledger in [`crate::dirac::tool_exec`] are what actually decide
//! whether a submission is allowed; this port is the plumbing they gate.
//!
//! Two implementations:
//! - [`UnavailableSubmitPort`] — the default production impl for now: reports
//!   itself unavailable, since live kernel↔hardware wiring is a later stage.
//! - [`MockSubmitPort`] — records every submission so tests can assert the
//!   core safety invariant (zero real submissions under the safe policy).

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// One hardware submission request (port of `SubmitRequest`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SubmitRequest {
    pub provider: String,
    pub backend: String,
    pub shots: u32,
    pub code: String,
    pub language: String,
}

/// Result of a submission attempt (port of `SubmitResult`).
#[derive(Debug, Clone, PartialEq)]
pub enum SubmitOutcome {
    Ok { job_id: String },
    Err { message: String },
}

/// A job's current status (port of `JobStatus`).
#[derive(Debug, Clone, PartialEq)]
pub struct JobStatus {
    pub job_id: String,
    pub status: String,
    pub queue_position: Option<i64>,
}

/// Read-back of a completed job's measured distribution (port of
/// `JobResultsOutcome`).
#[derive(Debug, Clone, PartialEq)]
pub enum JobResultsOutcome {
    Ok {
        job_id: String,
        probabilities: HashMap<String, f64>,
    },
    Err {
        message: String,
    },
}

/// The submission channel. `available()` lets the default production port
/// signal "no live hardware wiring yet" without pretending a job failed — the
/// tool executor maps a non-available port to an `unavailable` evidence result,
/// exactly as the TS orchestrator did when `submitPort` was omitted.
pub trait SubmitPort: Send + Sync {
    /// Whether this port can actually reach hardware. Defaults to true; the
    /// stub [`UnavailableSubmitPort`] overrides it to false.
    fn available(&self) -> bool {
        true
    }
    fn submit(&self, req: &SubmitRequest) -> SubmitOutcome;
    fn status(&self, job_id: &str) -> JobStatus;
    fn results(&self, job_id: &str) -> JobResultsOutcome;
    fn cancel(&self, job_id: &str) -> bool;
}

/// Default production port: hardware wiring is deferred, so every method
/// reports unavailability rather than reaching a provider. Never submits.
#[derive(Debug, Default)]
pub struct UnavailableSubmitPort;

impl SubmitPort for UnavailableSubmitPort {
    fn available(&self) -> bool {
        false
    }

    fn submit(&self, _req: &SubmitRequest) -> SubmitOutcome {
        SubmitOutcome::Err {
            message: "No hardware submission channel configured.".to_string(),
        }
    }

    fn status(&self, job_id: &str) -> JobStatus {
        JobStatus {
            job_id: job_id.to_string(),
            status: "unavailable".to_string(),
            queue_position: None,
        }
    }

    fn results(&self, _job_id: &str) -> JobResultsOutcome {
        JobResultsOutcome::Err {
            message: "No hardware submission channel configured.".to_string(),
        }
    }

    fn cancel(&self, _job_id: &str) -> bool {
        false
    }
}

#[derive(Debug, Clone)]
struct FakeJob {
    status: String,
    queue_position: Option<i64>,
}

/// In-memory, deterministic [`SubmitPort`] for tests (port of
/// `FakeSubmitPort`). Records every submission so a test can assert exactly how
/// many real submissions happened — the core safety invariant this stage
/// exists to prove.
pub struct MockSubmitPort {
    inner: Mutex<MockState>,
}

struct MockState {
    submissions: Vec<SubmitRequest>,
    jobs: HashMap<String, FakeJob>,
    scripted_results: HashMap<String, JobResultsOutcome>,
    counter: u64,
}

impl Default for MockSubmitPort {
    fn default() -> Self {
        Self {
            inner: Mutex::new(MockState {
                submissions: Vec::new(),
                jobs: HashMap::new(),
                scripted_results: HashMap::new(),
                counter: 0,
            }),
        }
    }
}

impl MockSubmitPort {
    pub fn new() -> Self {
        Self::default()
    }

    /// How many submissions have been recorded. The safety test asserts this
    /// stays 0 for a policy-denied real-QPU submission.
    pub fn submission_count(&self) -> usize {
        self.inner.lock().map(|s| s.submissions.len()).unwrap_or(0)
    }

    /// A clone of every recorded submission, in order.
    pub fn submissions(&self) -> Vec<SubmitRequest> {
        self.inner
            .lock()
            .map(|s| s.submissions.clone())
            .unwrap_or_default()
    }

    /// Test helper: script a job's status ahead of a poll.
    pub fn set_status(&self, job_id: &str, status: &str, queue_position: Option<i64>) {
        if let Ok(mut state) = self.inner.lock() {
            if let Some(job) = state.jobs.get_mut(job_id) {
                job.status = status.to_string();
                job.queue_position = queue_position;
            }
        }
    }

    /// Test helper: script a job's results ahead of an analyze call.
    pub fn set_result(&self, job_id: &str, result: JobResultsOutcome) {
        if let Ok(mut state) = self.inner.lock() {
            state.scripted_results.insert(job_id.to_string(), result);
        }
    }
}

impl SubmitPort for MockSubmitPort {
    fn submit(&self, req: &SubmitRequest) -> SubmitOutcome {
        let Ok(mut state) = self.inner.lock() else {
            return SubmitOutcome::Err {
                message: "submit port lock poisoned".to_string(),
            };
        };
        state.submissions.push(req.clone());
        state.counter += 1;
        let job_id = format!("job_{}", state.counter);
        state.jobs.insert(
            job_id.clone(),
            FakeJob {
                status: "queued".to_string(),
                queue_position: Some(0),
            },
        );
        SubmitOutcome::Ok { job_id }
    }

    fn status(&self, job_id: &str) -> JobStatus {
        let Ok(state) = self.inner.lock() else {
            return JobStatus {
                job_id: job_id.to_string(),
                status: "unknown".to_string(),
                queue_position: None,
            };
        };
        match state.jobs.get(job_id) {
            Some(job) => JobStatus {
                job_id: job_id.to_string(),
                status: job.status.clone(),
                queue_position: job.queue_position,
            },
            None => JobStatus {
                job_id: job_id.to_string(),
                status: "unknown".to_string(),
                queue_position: None,
            },
        }
    }

    fn results(&self, job_id: &str) -> JobResultsOutcome {
        let Ok(state) = self.inner.lock() else {
            return JobResultsOutcome::Err {
                message: "submit port lock poisoned".to_string(),
            };
        };
        if let Some(scripted) = state.scripted_results.get(job_id) {
            return scripted.clone();
        }
        match state.jobs.get(job_id) {
            None => JobResultsOutcome::Err {
                message: format!("Unknown job: {job_id}"),
            },
            Some(job) if job.status != "complete" => JobResultsOutcome::Err {
                message: format!("Job {job_id} is not complete (status: {}).", job.status),
            },
            Some(_) => JobResultsOutcome::Ok {
                job_id: job_id.to_string(),
                probabilities: HashMap::new(),
            },
        }
    }

    fn cancel(&self, job_id: &str) -> bool {
        let Ok(mut state) = self.inner.lock() else {
            return false;
        };
        match state.jobs.get_mut(job_id) {
            Some(job) => {
                job.status = "cancelled".to_string();
                true
            }
            None => false,
        }
    }
}
