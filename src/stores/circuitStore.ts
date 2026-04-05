import { create } from 'zustand';
import type { CircuitSnapshot } from '../types/quantum';

interface CircuitState {
  snapshot: CircuitSnapshot | null;
  isLoading: boolean;
  error: string | null;
  setSnapshot: (snapshot: CircuitSnapshot) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clear: () => void;
}

export const useCircuitStore = create<CircuitState>((set) => ({
  snapshot: null,
  isLoading: false,
  error: null,
  setSnapshot: (snapshot) => set({ snapshot, isLoading: false, error: null }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error, isLoading: false }),
  clear: () => set({ snapshot: null, error: null }),
}));
