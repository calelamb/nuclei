import { create } from 'zustand';
import type {
  HardwareProviderType,
  BackendInfo,
  JobHandle,
  HardwareResult,
} from '../types/hardware';

interface HardwareState {
  providers: Array<{ name: HardwareProviderType; connected: boolean }>;
  backends: BackendInfo[];
  selectedBackend: string | null;
  jobs: JobHandle[];
  results: Record<string, HardwareResult>;
  credentialsConfigured: Record<string, boolean>;
  showCredentialSetup: HardwareProviderType | null;

  setBackends: (backends: BackendInfo[]) => void;
  selectBackend: (name: string | null) => void;
  addJob: (job: JobHandle) => void;
  updateJob: (id: string, updates: Partial<JobHandle>) => void;
  setResult: (jobId: string, result: HardwareResult) => void;
  setProviderConnected: (provider: HardwareProviderType, connected: boolean) => void;
  setShowCredentialSetup: (provider: HardwareProviderType | null) => void;
  clearJobs: () => void;
}

export const useHardwareStore = create<HardwareState>((set) => ({
  providers: [
    { name: 'ibm', connected: false },
    { name: 'google', connected: false },
    { name: 'ionq', connected: false },
    { name: 'simulator', connected: true },
  ],
  backends: [],
  selectedBackend: null,
  jobs: [],
  results: {},
  credentialsConfigured: { simulator: true },
  showCredentialSetup: null,

  setBackends: (backends) => set({ backends }),
  selectBackend: (name) => set({ selectedBackend: name }),
  addJob: (job) => set((s) => ({ jobs: [job, ...s.jobs] })),
  updateJob: (id, updates) =>
    set((s) => ({
      jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...updates } : j)),
    })),
  setResult: (jobId, result) =>
    set((s) => ({ results: { ...s.results, [jobId]: result } })),
  setProviderConnected: (provider, connected) =>
    set((s) => ({
      providers: s.providers.map((p) =>
        p.name === provider ? { ...p, connected } : p
      ),
      credentialsConfigured: { ...s.credentialsConfigured, [provider]: connected },
    })),
  setShowCredentialSetup: (provider) => set({ showCredentialSetup: provider }),
  clearJobs: () => set({ jobs: [], results: {} }),
}));
