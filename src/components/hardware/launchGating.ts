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
  if (isWeb) return { kind: 'desktop-only', label: 'Desktop app' };
  if (provider === 'simulator') return { kind: 'ready', label: 'Ready' };
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
