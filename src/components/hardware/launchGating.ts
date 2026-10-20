import { kernelLanguageFor } from '../../types/quantum';
import type { Framework, KernelLanguage } from '../../types/quantum';
import type { HardwareProviderType } from '../../types/hardware';
import type { KernelStatus } from '../../stores/editorStore';
import { kernelStartFailureTitle } from '../../lib/kernelErrors';
import { PROVIDERS } from './launchProviders';

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

export type ProviderStatusKind = 'ready' | 'starting' | 'needs-setup' | 'unavailable' | 'desktop-only' | 'coming-soon';

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
  /** The local kernel's state; the Local Simulator is only Ready while it is up. Defaults to ready. */
  readonly kernelStatus?: KernelStatus;
}

/**
 * The one provider-status model shared by the Hardware panel, the Launch
 * dialog and the strip, so the three surfaces can never disagree.
 */
export function providerStatus({ provider, connected, isWeb, cudaqInstalled, kernelStatus = 'ready' }: ProviderStatusInput): ProviderStatus {
  if (COMING_SOON.has(provider)) return { kind: 'coming-soon', label: 'Coming soon' };
  // The browser build simulates circuits in the page, so the simulator is the one provider that works there.
  if (provider === 'simulator') {
    if (isWeb) return { kind: 'ready', label: 'Run here' };
    if (kernelStatus === 'connecting') return { kind: 'starting', label: 'Starting…' };
    if (kernelStatus === 'failed') return { kind: 'unavailable', label: kernelStartFailureTitle(false) };
    return { kind: 'ready', label: 'Ready' };
  }
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
  starting: 1,
  'needs-setup': 2,
  unavailable: 3,
  'desktop-only': 4,
  'coming-soon': 5,
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

/**
 * The one provider order, for the Hardware panel and the Launch grid alike: the catalog's own order
 * (launchProviders.ts) first, so a store that lists providers differently cannot reorder them, then
 * the Local Simulator pinned first and hardware providers ranked by status (see sortProvidersByStatus).
 */
export function sortProvidersForDisplay<T extends { readonly name: HardwareProviderType }>(
  providers: readonly T[],
  statusKind: (provider: T) => ProviderStatusKind,
): T[] {
  const position = (name: HardwareProviderType): number => {
    const index = PROVIDERS.findIndex((meta) => meta.name === name);
    return index === -1 ? PROVIDERS.length : index;
  };
  const inCatalogOrder = [...providers].sort((a, b) => position(a.name) - position(b.name));
  const sorted = sortProvidersByStatus(inCatalogOrder, statusKind);
  // The simulator is the anchor row: it stays first whatever the kernel is doing, so a failed or
  // starting kernel shows as its own badge instead of moving the row.
  return [...sorted.filter((p) => p.name === 'simulator'), ...sorted.filter((p) => p.name !== 'simulator')];
}
