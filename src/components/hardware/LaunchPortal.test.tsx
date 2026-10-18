// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { LaunchPortal } from './LaunchPortal';
import { useEditorStore } from '../../stores/editorStore';

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

    it('marks non-Azure providers unavailable, with the Q# reason on a shared tooltip', () => {
      const { container } = render(<LaunchPortal />);
      for (const label of ['IBM Quantum', 'IonQ', 'Quantinuum', 'AWS Braket', 'NVIDIA CUDA-Q']) {
        const button = providerButton(container, label);
        expect(button.getAttribute('aria-disabled')).toBe('true');
        expect(button.title).toBe('');
      }
    });

    it('keeps Azure Quantum and the Local Simulator enabled', () => {
      const { container } = render(<LaunchPortal />);
      for (const label of ['Azure Quantum', 'Local Simulator']) {
        const button = providerButton(container, label);
        expect(button.getAttribute('aria-disabled')).toBeNull();
      }
    });
  });

  it('leaves Python-framework gating untouched', () => {
    useEditorStore.setState({ framework: 'qiskit' });
    const { container } = render(<LaunchPortal />);
    const ibm = providerButton(container, 'IBM Quantum');
    expect(ibm.getAttribute('aria-disabled')).toBeNull();
    // 'Coming soon' style providers stay disabled for their own reason.
    const google = providerButton(container, 'Google Quantum AI');
    expect(google.getAttribute('aria-disabled')).toBe('true');
  });

  it('leads with the Local Simulator and drops native titles that repeat the card text (rq-r3-08, rq-r3-14)', () => {
    const { container } = render(<LaunchPortal />);
    const cards = Array.from(container.querySelectorAll('.launch-grid > button'));
    expect(cards[0].textContent).toContain('Local Simulator');
    expect(container.querySelectorAll('.launch-grid > button[title]').length).toBe(0);
  });

  it('sets provider names a step above their 11px description', () => {
    const { container } = render(<LaunchPortal />);
    const name = container.querySelector('.launch-grid__name') as HTMLElement;
    expect(name.style.fontSize).toBe('12px');
  });
});
