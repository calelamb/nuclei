export type Framework = 'qiskit' | 'cirq' | 'cuda-q';

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
  | { type: 'parse'; code: string }
  | { type: 'execute'; code: string; shots: number }
  | { type: 'run_python'; code: string }
  | { type: 'hardware_connect'; provider: string; credentials: Record<string, string> }
  | { type: 'hardware_list_backends'; provider: string }
  | { type: 'hardware_submit'; provider: string; backend: string; code: string; shots: number }
  | { type: 'hardware_status'; job_id: string }
  | { type: 'hardware_results'; job_id: string }
  | { type: 'hardware_cancel'; job_id: string };

interface HardwareJobDTO {
  id: string;
  provider: string;
  backend: string;
  status: 'queued' | 'running' | 'complete' | 'failed';
  queue_position: number | null;
  shots: number;
  submitted_at: string;
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
  | { type: 'hardware_backends'; backends: Array<Record<string, unknown>> }
  | { type: 'hardware_job_submitted'; job: HardwareJobDTO }
  | { type: 'hardware_job_update'; job: HardwareJobDTO }
  | { type: 'hardware_result'; job_id: string; data: { measurements?: Record<string, number>; error?: string; status?: string } }
  | { type: 'hardware_job_cancelled'; job_id: string; success: boolean };
