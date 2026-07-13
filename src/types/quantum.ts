import type {
  QecCampaignProgress,
  QecCampaignResult,
  QecCampaignTask,
  QecDecodeSampleResult,
  QecGeneratedCode,
  QecGenerateNoise,
  QecSnapshot,
} from './qec';

export type Framework = 'qiskit' | 'cirq' | 'cuda-q' | 'qsharp' | 'stim';

/** Source language the kernel should use when parsing/executing a buffer. */
export type KernelLanguage = 'python' | 'qsharp' | 'stim';

/**
 * Map a framework to the source language the kernel must interpret the
 * buffer as. Q# is its own language; everything else is Python.
 *
 * Stim is Python-family here deliberately: `framework: 'stim'` normally
 * means Python code building `stim.Circuit` objects. Raw `.stim` text is
 * language-driven, not framework-driven — the editor sets the language
 * from the file extension (see useActiveTabSync/useFileOps), and only a
 * `.stim` buffer sends `language: "stim"`.
 */
export function kernelLanguageFor(framework: Framework, filePath?: string | null): KernelLanguage {
  if (framework === 'qsharp') return 'qsharp';
  if (filePath && filePath.toLowerCase().endsWith('.stim')) return 'stim';
  return 'python';
}

export interface Gate {
  type: string;          // 'H', 'CNOT', 'RZ', etc.
  targets: number[];     // qubit indices
  controls: number[];    // control qubit indices
  params: number[];      // rotation angles, etc.
  layer: number;         // depth position (column in circuit diagram)
}

export interface CircuitSnapshot {
  framework: Framework;
  qubit_count: number;
  classical_bit_count: number;
  depth: number;
  gates: Gate[];
}

export interface Complex {
  re: number;
  im: number;
}

export interface BlochCoord {
  x: number;
  y: number;
  z: number;
}

export interface SimulationResult {
  state_vector: Complex[];
  probabilities: Record<string, number>;
  measurements: Record<string, number>;
  bloch_coords: BlochCoord[];
  execution_time_ms: number;
  shot_count: number;
  // Protocol v1.1 (PRD 09 Phase B) — additive. Accumulated
  // `record_metric(name, value)` calls from the run; always present,
  // empty when the user's code recorded nothing.
  metrics: Record<string, number>;
  // Present only when the request carried a `seed`: whether the backend
  // actually honored it. Omitted (not just false) when no seed was
  // requested — see kernel/models/snapshot.py SimulationResult.to_dict.
  seed_honored?: boolean;
}

/** `kernel/server.py`'s `environment` response payload — installed
 * interpreter/platform/framework versions. Package keys are present only
 * when that framework's distribution could be resolved on the kernel host;
 * absent keys mean "not installed", never a placeholder value. */
export interface KernelEnvironment {
  python: string;
  platform: string;
  packages: Partial<Record<'qiskit' | 'qiskit_aer' | 'cirq' | 'cudaq' | 'qsharp', string>>;
}

export type KernelMessage =
  | { type: 'parse'; code: string; language?: KernelLanguage }
  | {
      type: 'execute';
      code: string;
      shots: number;
      language?: KernelLanguage;
      // Protocol v1.1 (PRD 09 Phase B) — both optional/additive. `params`
      // binds into the exec namespace (Python) or the Q# entry operation's
      // arguments by name (Q#, Double/Int only in v1). `seed` requests
      // reproducible sampling — see `result.seed_honored` on the response.
      params?: Record<string, number>;
      seed?: number;
    }
  | { type: 'run_python'; code: string }
  // Protocol v1.1 (PRD 09 Phase B) — new message type. No request fields;
  // the kernel reports its own interpreter/platform/package versions.
  | { type: 'environment' }
  | { type: 'hardware_connect'; provider: string; credentials: Record<string, string> }
  | { type: 'hardware_set_credentials'; provider: string; credentials: Record<string, string> }
  | { type: 'hardware_clear_credentials'; provider: string }
  | { type: 'hardware_connected_providers' }
  | { type: 'hardware_list_jobs' }
  | { type: 'hardware_list_backends'; provider: string }
  | { type: 'hardware_submit'; provider: string; backend: string; code: string; shots: number; language?: KernelLanguage }
  | { type: 'hardware_status'; job_id: string }
  | { type: 'hardware_results'; job_id: string }
  | { type: 'hardware_cancel'; job_id: string }
  | { type: 'hardware_dismiss'; job_id: string }
  // Protocol v1.2 (PRD 10 Phase A) — QEC Studio. `qec_generate` returns a
  // built-in QEC circuit's text; `qec_snapshot` (re)computes the detector
  // graph sidecar, statelessly with `code` or from the connection's last
  // Stim circuit without it ("render anyway" uses a raised max_edges).
  | { type: 'qec_generate'; code: QecGeneratedCode; distance: number; rounds: number; noise?: QecGenerateNoise }
  | { type: 'qec_snapshot'; code?: string; language?: KernelLanguage; max_edges?: number }
  // Protocol v1.2 (PRD 10 Phase B) — sinter campaigns as managed kernel
  // jobs. One campaign at a time per kernel; at least one collect bound
  // required; NO seed field (sinter has no seeding API — campaigns are
  // not shot-reproducible and the protocol refuses to imply otherwise).
  | {
      type: 'qec_campaign_start';
      campaign_id: string;
      tasks: QecCampaignTask[];
      collect: { max_shots?: number; max_errors?: number };
      workers?: number | 'auto';
      progress_interval_s?: number;
      /** Previous run's result `csv` — resume without re-sampling. */
      existing_stats_csv?: string;
    }
  | { type: 'qec_campaign_cancel'; campaign_id: string }
  | { type: 'qec_decode_sample'; circuit_text: string; decoder: 'pymatching'; seed?: number };

interface HardwareJobDTO {
  id: string;
  provider: string;
  backend: string;
  status: 'queued' | 'running' | 'complete' | 'failed' | 'unknown' | 'stale';
  queue_position: number | null;
  shots: number;
  submitted_at: string;
  error?: string | null;
}

export type KernelResponse =
  | { type: 'snapshot'; data: CircuitSnapshot | null }
  | { type: 'result'; data: SimulationResult | null }
  | { type: 'python_result'; success: boolean }
  | {
      type: 'error';
      message: string;
      traceback?: string;
      code?: string;
      phase?: 'parse' | 'execute' | 'python';
      framework?: Framework;
      dependency?: string;
    }
  | { type: 'output'; text: string }
  | { type: 'stderr'; text: string }
  // Protocol v1.1 (PRD 09 Phase B) — reply to the `environment` request.
  | ({ type: 'environment' } & KernelEnvironment)
  | { type: 'hardware_connected'; provider: string; success: boolean }
  | { type: 'hardware_connected_providers'; providers: string[] }
  | { type: 'hardware_jobs'; jobs: HardwareJobDTO[] }
  | { type: 'hardware_backends'; backends: Array<Record<string, unknown>> }
  | { type: 'hardware_job_submitted'; job: HardwareJobDTO }
  | { type: 'hardware_job_update'; job: HardwareJobDTO }
  | { type: 'hardware_result'; job_id: string; data: { measurements?: Record<string, number>; error?: string; status?: string } }
  | { type: 'hardware_job_cancelled'; job_id: string; success: boolean }
  | { type: 'hardware_job_dismissed'; job_id: string; success: boolean }
  // Protocol v1.2 (PRD 10 Phase A). `qec_snapshot` also arrives unsolicited
  // as a sidecar between `snapshot` and `result` for Stim circuits.
  | { type: 'qec_snapshot'; data: QecSnapshot }
  | { type: 'qec_generated'; code: QecGeneratedCode; distance: number; rounds: number; circuit_text: string }
  // Protocol v1.2 (PRD 10 Phase B).
  | { type: 'qec_campaign_started'; campaign_id: string; tasks_total: number; workers: number }
  | ({ type: 'qec_campaign_progress' } & QecCampaignProgress)
  | ({ type: 'qec_campaign_result' } & QecCampaignResult)
  | { type: 'qec_campaign_cancelled'; campaign_id: string; accepted: boolean }
  | ({ type: 'qec_decode_sample' } & QecDecodeSampleResult);
