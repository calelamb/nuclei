export type Framework = 'qiskit' | 'cirq' | 'cuda-q' | 'qsharp';

/** Source language the kernel should use when parsing/executing a buffer. */
export type KernelLanguage = 'python' | 'qsharp';

/**
 * Map a framework to the source language the kernel must interpret the
 * buffer as. Q# is its own language; everything else is Python.
 */
export function kernelLanguageFor(framework: Framework): KernelLanguage {
  return framework === 'qsharp' ? 'qsharp' : 'python';
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
}

export type KernelMessage =
  | { type: 'parse'; code: string; language?: KernelLanguage }
  | { type: 'execute'; code: string; shots: number; language?: KernelLanguage }
  | { type: 'run_python'; code: string }
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
  | { type: 'hardware_dismiss'; job_id: string };

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
  | { type: 'hardware_connected'; provider: string; success: boolean }
  | { type: 'hardware_connected_providers'; providers: string[] }
  | { type: 'hardware_jobs'; jobs: HardwareJobDTO[] }
  | { type: 'hardware_backends'; backends: Array<Record<string, unknown>> }
  | { type: 'hardware_job_submitted'; job: HardwareJobDTO }
  | { type: 'hardware_job_update'; job: HardwareJobDTO }
  | { type: 'hardware_result'; job_id: string; data: { measurements?: Record<string, number>; error?: string; status?: string } }
  | { type: 'hardware_job_cancelled'; job_id: string; success: boolean }
  | { type: 'hardware_job_dismissed'; job_id: string; success: boolean };
