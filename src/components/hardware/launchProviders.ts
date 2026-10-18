import type { HardwareProviderType } from '../../types/hardware';

export interface ProviderMeta {
  name: HardwareProviderType;
  label: string;
  tagline: string;
  pricing: 'Free' | 'Credits' | 'Paid' | 'Local';
  tech: string;
  comingSoon?: boolean;
}

export const PROVIDERS: ProviderMeta[] = [
  {
    name: 'ibm',
    label: 'IBM Quantum',
    tagline: 'Superconducting qubits · up to 127 qubits',
    pricing: 'Free',
    tech: 'Superconducting',
  },
  {
    name: 'ionq',
    label: 'IonQ',
    tagline: 'Trapped-ion · all-to-all connectivity',
    pricing: 'Paid',
    tech: 'Trapped ion',
  },
  {
    name: 'quantinuum',
    label: 'Quantinuum',
    tagline: 'Trapped-ion · highest fidelity · H1/H2 family',
    pricing: 'Paid',
    tech: 'Trapped ion',
  },
  {
    name: 'braket',
    label: 'AWS Braket',
    tagline: 'Aggregator · IonQ, Rigetti, QuEra, IQM, OQC, Pasqal',
    pricing: 'Paid',
    tech: 'Aggregator',
  },
  {
    name: 'azure',
    label: 'Azure Quantum',
    tagline: 'Aggregator · Quantinuum, IonQ, Rigetti, Pasqal, IQM',
    pricing: 'Credits',
    tech: 'Aggregator',
  },
  {
    name: 'nvidia',
    label: 'NVIDIA CUDA-Q',
    tagline: 'GPU-accelerated simulation · up to 34 qubits',
    pricing: 'Local',
    tech: 'GPU simulator',
  },
  {
    name: 'google',
    label: 'Google Quantum AI',
    tagline: 'Sycamore family · research access only',
    pricing: 'Credits',
    tech: 'Superconducting',
    comingSoon: true,
  },
  {
    name: 'xanadu',
    label: 'Xanadu',
    tagline: 'Photonic · boson sampling · different circuit model',
    pricing: 'Credits',
    tech: 'Photonic',
    comingSoon: true,
  },
  {
    name: 'dwave',
    label: 'D-Wave',
    tagline: 'Quantum annealer · QUBO / Ising · not gate-model',
    pricing: 'Credits',
    tech: 'Annealer',
    comingSoon: true,
  },
  {
    name: 'simulator',
    label: 'Local Simulator',
    tagline: 'Instant · runs in Nuclei · no account needed',
    pricing: 'Local',
    tech: 'Pyodide / Qiskit Aer',
  },
];

// Single-field BYOK config per provider. Deliberately minimal — the full
// multi-field credential form still lives in CredentialSetup.tsx for
// aggregators that need multiple values (AWS keys, Azure workspace IDs).
// Here we collect just the primary token inline to keep the flow fast.
// Providers not in this map need no credentials (simulator, nvidia) or
// require the richer CredentialSetup flow.
export const INLINE_KEY_FIELD: Partial<Record<HardwareProviderType, { label: string; placeholder: string; helpText?: string; helpUrl?: string }>> = {
  ibm: {
    label: 'IBM Quantum API token',
    placeholder: 'Paste your IBM Quantum token',
    helpText: 'Get a free token at quantum.ibm.com',
    helpUrl: 'https://quantum.ibm.com',
  },
  ionq: {
    label: 'IonQ API key',
    placeholder: 'Paste your IonQ API key',
    helpText: 'Get an API key at cloud.ionq.com',
    helpUrl: 'https://cloud.ionq.com',
  },
  quantinuum: {
    label: 'Quantinuum Nexus token',
    placeholder: 'Paste your Nexus token',
    helpText: 'Request access at nexus.quantinuum.com',
    helpUrl: 'https://nexus.quantinuum.com',
  },
};

// For aggregators, show a small sub-provider chip row at the top of Act 2
// so students understand "this one bundle includes X, Y, Z." Clicking a
// chip filters the backend list to that sub-provider only. 'All' resets.
export const AGGREGATOR_SUB_PROVIDERS: Partial<Record<HardwareProviderType, string[]>> = {
  braket: ['All', 'IonQ', 'Rigetti', 'QuEra', 'IQM', 'OQC', 'Simulator'],
  azure: ['All', 'Quantinuum', 'IonQ', 'Rigetti', 'Pasqal', 'IQM'],
};
