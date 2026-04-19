export type HardwareProviderType =
  | 'ibm'
  | 'google'
  | 'ionq'
  | 'nvidia'
  | 'braket'
  | 'azure'
  | 'quantinuum'
  | 'xanadu'
  | 'dwave'
  | 'simulator';

export interface BackendInfo {
  name: string;
  provider: HardwareProviderType;
  qubitCount: number;
  connectivity: Array<[number, number]>;
  queueLength: number;
  averageErrorRate: number;
  gateSet: string[];
  status: 'online' | 'offline' | 'maintenance';
}

export interface JobHandle {
  id: string;
  provider: string;
  backend: string;
  submittedAt: string;
  // 'unknown' when the provider's status probe failed transiently (next
  // poll may recover). 'stale' when the kernel no longer tracks the job
  // (typically after a kernel restart before job-persistence is wired).
  status: 'queued' | 'running' | 'complete' | 'failed' | 'unknown' | 'stale';
  queuePosition: number | null;
  shots: number;
  error?: string | null;
}

export interface HardwareResult {
  jobId: string;
  measurements: Record<string, number>;
  probabilities: Record<string, number>;
  executionTimeMs: number;
  backend: string;
}
