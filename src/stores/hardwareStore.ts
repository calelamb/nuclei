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
  launchOpen: boolean;
  selectedProvider: HardwareProviderType | null;

  setBackends: (backends: BackendInfo[]) => void;
  selectBackend: (name: string | null) => void;
  selectProvider: (p: HardwareProviderType | null) => void;
  addJob: (job: JobHandle) => void;
  updateJob: (id: string, updates: Partial<JobHandle>) => void;
  setResult: (jobId: string, result: HardwareResult) => void;
  setProviderConnected: (provider: HardwareProviderType, connected: boolean) => void;
  setShowCredentialSetup: (provider: HardwareProviderType | null) => void;
  openLaunch: () => void;
  closeLaunch: () => void;
  clearJobs: () => void;
}

export const useHardwareStore = create<HardwareState>((set) => ({
  providers: [
    { name: 'ibm', connected: false },
    { name: 'ionq', connected: false },
    { name: 'nvidia', connected: false },
    { name: 'google', connected: false },
    { name: 'simulator', connected: true },
  ],
  backends: [],
  selectedBackend: null,
  jobs: [],
  results: {},
  credentialsConfigured: { simulator: true },
  showCredentialSetup: null,
  launchOpen: false,
  selectedProvider: null,

  setBackends: (backends) => set({ backends }),
  selectBackend: (name) => set({ selectedBackend: name }),
  selectProvider: (selectedProvider) => set({ selectedProvider }),
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
        p.name === provider ? { ...p, connected } : p,
      ),
      credentialsConfigured: { ...s.credentialsConfigured, [provider]: connected },
    })),
  setShowCredentialSetup: (provider) => set({ showCredentialSetup: provider }),
  openLaunch: () => set({ launchOpen: true }),
  closeLaunch: () => set({ launchOpen: false, selectedProvider: null }),
  clearJobs: () => set({ jobs: [], results: {} }),
}));
