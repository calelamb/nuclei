// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PluginMarketplace } from './PluginMarketplace';
import { usePluginStore } from '../../plugins/pluginManager';

const platform = vi.hoisted(() => ({ web: false }));
vi.mock('../../platform/buildTarget', () => ({ isWebBuild: () => platform.web }));
const openDirectory = vi.hoisted(() => vi.fn());
vi.mock('../../platform/PlatformProvider', () => ({ loadBridge: async () => ({ openDirectory }) }));

afterEach(() => { platform.web = false; openDirectory.mockClear(); cleanup(); usePluginStore.setState({ plugins: [] }); });

describe('PluginMarketplace', () => {
  it('uses the shared Tabs primitive in sentence case (no hand-rolled uppercase strip)', () => {
    render(<PluginMarketplace />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Installed (0)', 'Panels']);
    expect(tabs[0].className).toContain('nuclei-tabs__tab');
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.click(tabs[1]);
    expect(screen.getAllByRole('tab')[1].getAttribute('aria-selected')).toBe('true');
  });

  it('Load and Create are stacked, equal-width medium Buttons (rq-r3-10)', () => {
    render(<PluginMarketplace />);
    for (const name of [/Load plugin/, /Create plugin/]) {
      const btn = screen.getByRole('button', { name });
      expect(btn.className).toContain('nuclei-btn--md');
      expect(btn.style.width).toBe('100%');
    }
  });

  it('shows the shared empty state when nothing is installed', () => {
    const { container } = render(<PluginMarketplace />);
    expect(container.querySelector('.nuclei-empty')).toBeTruthy();
    expect(screen.getByText('No plugins installed').className).toContain('nuclei-empty__title');
  });

  it('web: shows the desktop-only state, no Load/Create actions, and never opens a picker (shell-r6-02)', () => {
    platform.web = true;
    render(<PluginMarketplace />);
    expect(screen.getByText('Plugins run in the desktop app')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Load plugin/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Create plugin/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: /Download Nuclei/ })).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/Load one from a folder/);
    expect(openDirectory).not.toHaveBeenCalled();
  });
});
