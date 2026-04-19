export type HardwareProviderType = 'ibm' | 'google' | 'ionq' | 'nvidia' | 'simulator';

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
  status: 'queued' | 'running' | 'complete' | 'failed';
  queuePosition: number | null;
  shots: number;
}

export interface HardwareResult {
  jobId: string;
  measurements: Record<string, number>;
  probabilities: Record<string, number>;
  executionTimeMs: number;
  backend: string;
}
