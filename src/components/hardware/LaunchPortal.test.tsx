// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { LaunchPortal } from './LaunchPortal';
import { useEditorStore } from '../../stores/editorStore';
import { QSHARP_GATE_TOOLTIP } from './launchGating';

function providerButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((b) =>
    b.textContent?.includes(label),
  );
  if (!button) throw new Error(`No provider button labelled "${label}"`);
  return button;
}

describe('LaunchPortal — Q# provider gating', () => {
  afterEach(() => {
    cleanup();
    useEditorStore.setState({ framework: 'qiskit' });
  });

  describe('when the active framework is qsharp', () => {
    beforeEach(() => {
      useEditorStore.setState({ framework: 'qsharp' });
    });

    it('disables non-Azure providers with the Q# tooltip', () => {
      const { container } = render(<LaunchPortal />);
      for (const label of ['IBM Quantum', 'IonQ', 'Quantinuum', 'AWS Braket', 'NVIDIA CUDA-Q']) {
        const button = providerButton(container, label);
        expect(button.disabled).toBe(true);
        expect(button.title).toBe(QSHARP_GATE_TOOLTIP);
      }
    });

    it('keeps Azure Quantum and the Local Simulator enabled', () => {
      const { container } = render(<LaunchPortal />);
      for (const label of ['Azure Quantum', 'Local Simulator']) {
        const button = providerButton(container, label);
        expect(button.disabled).toBe(false);
        expect(button.title).not.toBe(QSHARP_GATE_TOOLTIP);
      }
    });
  });

  it('leaves Python-framework gating untouched', () => {
    useEditorStore.setState({ framework: 'qiskit' });
    const { container } = render(<LaunchPortal />);
    const ibm = providerButton(container, 'IBM Quantum');
    expect(ibm.disabled).toBe(false);
    // 'Coming soon' style providers stay disabled for their own reason.
    const google = providerButton(container, 'Google Quantum AI');
    expect(google.disabled).toBe(true);
    expect(google.title).not.toBe(QSHARP_GATE_TOOLTIP);
  });
});
