// @vitest-environment jsdom
import { shortcutLabel } from '../../config/keybindings';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { PlatformProvider } from '../../platform/PlatformProvider';
import type { PlatformBridge } from '../../platform/bridge';
import { useHardwareStore } from '../../stores/hardwareStore';
import { PROVIDERS } from './launchProviders';
import { LaunchPortal } from './LaunchPortal';
import { useEditorStore } from '../../stores/editorStore';

const desktopBridge = { getPlatform: () => 'desktop' } as unknown as PlatformBridge;
const renderDesktop = () => render(<PlatformProvider bridge={desktopBridge}><LaunchPortal /></PlatformProvider>);

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
      const { container } = renderDesktop();
      for (const label of ['IBM Quantum', 'IonQ', 'Quantinuum', 'AWS Braket', 'NVIDIA CUDA-Q']) {
        const button = providerButton(container, label);
        expect(button.getAttribute('aria-disabled')).toBe('true');
        expect(button.title).toBe('');
      }
    });

    it('keeps Azure Quantum and the Local Simulator enabled', () => {
      const { container } = renderDesktop();
      for (const label of ['Azure Quantum', 'Local Simulator']) {
        const button = providerButton(container, label);
        expect(button.getAttribute('aria-disabled')).toBeNull();
      }
    });
  });

  it('leaves Python-framework gating untouched', () => {
    useEditorStore.setState({ framework: 'qiskit' });
    const { container } = renderDesktop();
    const ibm = providerButton(container, 'IBM Quantum');
    expect(ibm.getAttribute('aria-disabled')).toBeNull();
    // 'Coming soon' style providers stay disabled for their own reason.
    const google = providerButton(container, 'Google Quantum AI');
    expect(google.getAttribute('aria-disabled')).toBe('true');
  });

  it('leads with the Local Simulator and drops native titles that repeat the card text (rq-r3-08, rq-r3-14)', () => {
    const { container } = renderDesktop();
    const cards = Array.from(container.querySelectorAll('.launch-grid > button'));
    expect(cards[0].textContent).toContain('Local Simulator');
    expect(container.querySelectorAll('.launch-grid > button[title]').length).toBe(0);
  });

  it('shows the real launch shortcut for the platform, not a hard-coded Mac glyph (shell-r9-04b)', () => {
    const { container } = renderDesktop();
    const kbd = container.querySelector('button kbd');
    expect(kbd?.textContent).toBe(shortcutLabel('launch'));
  });

  it('sets provider names a step above their 11px description', () => {
    const { container } = renderDesktop();
    const name = container.querySelector('.launch-grid__name') as HTMLElement;
    expect(name.style.fontSize).toBe('12px');
  });
});

const webBridge = { getPlatform: () => 'web' } as unknown as PlatformBridge;
const renderWeb = () => render(<PlatformProvider bridge={webBridge}><LaunchPortal /></PlatformProvider>);

describe('LaunchPortal on the web build (interaction-r-04)', () => {
  afterEach(() => {
    cleanup();
    useHardwareStore.setState({ launchOpen: false, selectedProvider: null });
  });

  it('badges real providers "Desktop app"; they activate, so they are not aria-disabled or not-allowed (design-r9-01)', () => {
    const { container } = renderWeb();
    for (const label of ['IBM Quantum', 'IonQ', 'Quantinuum', 'AWS Braket', 'Azure Quantum', 'NVIDIA CUDA-Q']) {
      const card = providerButton(container, label);
      expect(card.getAttribute('aria-disabled')).toBeNull();
      expect(card.style.cursor).toBe('pointer');
      expect(card.disabled).toBe(false);
      expect(card.textContent).toContain('Desktop app');
      const badge = container.querySelector(`#${card.getAttribute('aria-describedby')}`);
      expect(badge?.textContent).toContain('Desktop app');
      // name and tagline keep full opacity so they stay AA-legible
      expect((card.querySelector('.launch-grid__name') as HTMLElement).style.opacity).toBe('');
    }
    expect(providerButton(container, 'Google Quantum AI').getAttribute('aria-disabled')).toBe('true');
    const sim = providerButton(container, 'Local Simulator');
    expect(sim.getAttribute('aria-disabled')).toBeNull();
    expect(sim.textContent).not.toContain('Desktop app');
  });

  it('the Desktop app badge is a compact chip at full opacity, not a stretched, dimmed bar', () => {
    const { container } = renderWeb();
    const card = providerButton(container, 'IBM Quantum');
    expect(card.style.opacity).toBe('');
    const cell = card.querySelector('[data-testid="portal-badge-cell"]') as HTMLElement;
    expect(cell.style.alignSelf).toBe('flex-start');
    expect(cell.textContent).toContain('Desktop app');
  });

  it('clicking a desktop-only provider opens the launcher at the provider step, not a dead-end provider page', () => {
    const { container } = renderWeb();
    fireEvent.click(providerButton(container, 'IBM Quantum'));
    const state = useHardwareStore.getState();
    expect(state.launchOpen).toBe(true);
    expect(state.selectedProvider).toBeNull();
  });

  it('uses the catalog description for each provider, the one string shared with the launcher', () => {
    const { container } = renderDesktop();
    for (const meta of PROVIDERS) {
      expect(providerButton(container, meta.label).textContent).toContain(meta.tagline);
    }
  });
});
