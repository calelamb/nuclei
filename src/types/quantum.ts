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
}

export type KernelMessage =
  | { type: 'parse'; code: string }
  | { type: 'execute'; code: string; shots: number };

export type KernelResponse =
  | { type: 'snapshot'; data: CircuitSnapshot }
  | { type: 'result'; data: SimulationResult }
  | { type: 'error'; message: string; traceback?: string }
  | { type: 'output'; text: string };
