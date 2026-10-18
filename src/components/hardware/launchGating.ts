import { kernelLanguageFor } from '../../types/quantum';
import type { Framework, KernelLanguage } from '../../types/quantum';
import type { HardwareProviderType } from '../../types/hardware';

/** Tooltip shown wherever a provider is disabled because the submission is Q#. */
export const QSHARP_GATE_TOOLTIP = 'Q# submits to Azure Quantum targets';

/**
 * Providers whose submit path can take a Q# program: the local simulator
 * re-runs raw source through the executor, Azure Quantum accepts QIR
 * compiled by the kernel. This gating is cosmetic — the kernel enforces
 * the same allowlist in `_prepare_hardware_payload` and is the source of
 * truth (kernel/server.py).
 */
export function providerAllowsQsharp(provider: string): boolean {
  return provider === 'azure' || provider === 'simulator';
}

/**
 * Language a hardware submission should be tagged with. A staged file
 * (drag-and-drop) wins over the editor's framework because its content is
 * what actually gets submitted; otherwise fall back to the active editor
 * framework.
 */
export function submissionLanguage(
  stagedFileName: string | null,
  framework: Framework,
): KernelLanguage {
  if (stagedFileName) {
    return stagedFileName.toLowerCase().endsWith('.qs') ? 'qsharp' : 'python';
  }
  return kernelLanguageFor(framework);
}

export type ProviderStatusKind = 'ready' | 'needs-setup' | 'desktop-only' | 'coming-soon';

export interface ProviderStatus {
  readonly kind: ProviderStatusKind;
  readonly label: string;
}

/** Providers whose kernel adapters are stubs; they cannot be launched to yet. */
const COMING_SOON: ReadonlySet<HardwareProviderType> = new Set(['google', 'xanadu', 'dwave']);

/** Providers that need no account: the local simulator and the GPU simulator. */
const CREDENTIAL_FREE: ReadonlySet<HardwareProviderType> = new Set(['simulator', 'nvidia']);

export function providerNeedsToken(provider: HardwareProviderType): boolean {
  return !CREDENTIAL_FREE.has(provider);
}

export interface ProviderStatusInput {
  readonly provider: HardwareProviderType;
  /** Kernel-confirmed connection (credentialed providers only). */
  readonly connected: boolean;
  readonly isWeb: boolean;
  /** `cuda-q` is among the kernel environment's installed frameworks. */
  readonly cudaqInstalled: boolean;
}

/**
 * The one provider-status model shared by the Hardware panel, the Launch
 * dialog and the strip, so the three surfaces can never disagree.
 */
export function providerStatus({ provider, connected, isWeb, cudaqInstalled }: ProviderStatusInput): ProviderStatus {
  if (COMING_SOON.has(provider)) return { kind: 'coming-soon', label: 'Coming soon' };
  // The browser build simulates circuits in the page, so the simulator is the one provider that works there.
  if (provider === 'simulator') return { kind: 'ready', label: isWeb ? 'Run here' : 'Ready' };
  if (isWeb) return { kind: 'desktop-only', label: 'Desktop app' };
  if (provider === 'nvidia') {
    return cudaqInstalled
      ? { kind: 'ready', label: 'Ready' }
      : { kind: 'needs-setup', label: 'Install CUDA-Q' };
  }
  return connected
    ? { kind: 'ready', label: 'Connected' }
    : { kind: 'needs-setup', label: 'Connect to enable' };
}

/** Backend error chip text; never a bare plus-minus. */
export function formatErrorRate(rate: number): string {
  return rate === 0 ? 'Ideal' : `err ${(rate * 100).toFixed(2)}%`;
}

const STATUS_RANK: Readonly<Record<ProviderStatusKind, number>> = {
  ready: 0,
  'needs-setup': 1,
  'desktop-only': 2,
  'coming-soon': 3,
};

/**
 * What works leads: the Local Simulator, then everything else that is ready, then providers
 * that need setup, desktop-only ones and coming-soon last. Stable within a tier; never mutates.
 */
export function sortProvidersByStatus<T extends { readonly name: HardwareProviderType }>(
  providers: readonly T[],
  statusKind: (provider: T) => ProviderStatusKind,
): T[] {
  const rank = (p: T): number => STATUS_RANK[statusKind(p)] * 2 + (p.name === 'simulator' ? 0 : 1);
  return providers
    .map((provider, index) => ({ provider, index }))
    .sort((a, b) => rank(a.provider) - rank(b.provider) || a.index - b.index)
    .map((entry) => entry.provider);
}
