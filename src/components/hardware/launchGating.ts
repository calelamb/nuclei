import { kernelLanguageFor } from '../../types/quantum';
import type { Framework, KernelLanguage } from '../../types/quantum';

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
