// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PluginMarketplace } from './PluginMarketplace';
import { usePluginStore } from '../../plugins/pluginManager';

afterEach(() => { cleanup(); usePluginStore.setState({ plugins: [] }); });

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

  it('Load and Create are the shared small Buttons', () => {
    render(<PluginMarketplace />);
    for (const name of [/Load plugin/, /Create plugin/]) {
      const btn = screen.getByRole('button', { name });
      expect(btn.className).toContain('nuclei-btn--sm');
    }
  });

  it('shows the shared empty state when nothing is installed', () => {
    const { container } = render(<PluginMarketplace />);
    expect(container.querySelector('.nuclei-empty')).toBeTruthy();
    expect(screen.getByText('No plugins installed').className).toContain('nuclei-empty__title');
  });
});
