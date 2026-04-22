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
  selectedSubProvider: string | null; // e.g. 'IonQ' / 'Rigetti' when provider is 'braket'
  stagedSubmission: { fileName: string; content: string } | null;
  // Credentials are NEVER stored on the frontend. The kernel persists them in
  // the OS keyring and re-hydrates on startup. The store only tracks the
  // connected boolean per provider for UI rendering.
  connectingProvider: HardwareProviderType | null;
  connectionErrors: Partial<Record<HardwareProviderType, string | null>>;

  setBackends: (backends: BackendInfo[]) => void;
  selectBackend: (name: string | null) => void;
  selectProvider: (p: HardwareProviderType | null) => void;
  selectSubProvider: (s: string | null) => void;
  setStagedSubmission: (s: { fileName: string; content: string } | null) => void;
  setConnecting: (p: HardwareProviderType | null) => void;
  setConnectionError: (p: HardwareProviderType, error: string | null) => void;
  clearJob: (id: string) => void;
  addJob: (job: JobHandle) => void;
  setJobs: (jobs: JobHandle[]) => void;
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
    { name: 'braket', connected: false },
    { name: 'azure', connected: false },
    { name: 'quantinuum', connected: false },
    { name: 'google', connected: false },
    { name: 'xanadu', connected: false },
    { name: 'dwave', connected: false },
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
  selectedSubProvider: null,
  stagedSubmission: null,
  connectingProvider: null,
  connectionErrors: {},

  setBackends: (backends) => set({ backends }),
  selectBackend: (name) => set({ selectedBackend: name }),
  selectProvider: (selectedProvider) => set({ selectedProvider, selectedSubProvider: null }),
  selectSubProvider: (selectedSubProvider) => set({ selectedSubProvider }),
  setStagedSubmission: (stagedSubmission) => set({ stagedSubmission }),
  setConnecting: (connectingProvider) => set({ connectingProvider }),
  setConnectionError: (p, error) =>
    set((s) => ({ connectionErrors: { ...s.connectionErrors, [p]: error } })),
  clearJob: (id) =>
    set((s) => {
      const rest = { ...s.results };
      delete rest[id];
      return {
        jobs: s.jobs.filter((j) => j.id !== id),
        results: rest,
      };
    }),
  addJob: (job) => set((s) => ({ jobs: [job, ...s.jobs] })),
  // Kernel-authoritative job list — used on WS connect to rehydrate the
  // tracker from persisted state so users see their history instead of
  // an empty list after a page reload or kernel restart.
  setJobs: (jobs) => set({ jobs }),
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
  closeLaunch: () =>
    set({ launchOpen: false, selectedProvider: null, selectedSubProvider: null }),
  clearJobs: () => set({ jobs: [], results: {} }),
}));
