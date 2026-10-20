import { describe, it, expect, beforeEach } from 'vitest';
import { useDiracPanelStore } from './diracPanelStore';

describe('diracPanelStore.ask', () => {
  beforeEach(() => useDiracPanelStore.setState({ isOpen: false, pendingPrompt: null }));

  it('opens the panel and queues the prompt', () => {
    useDiracPanelStore.getState().ask('Explain superposition');
    const s = useDiracPanelStore.getState();
    expect(s.isOpen).toBe(true);
    expect(s.pendingPrompt).toBe('Explain superposition');
  });

  it('clears the prompt once consumed', () => {
    useDiracPanelStore.getState().ask('x');
    useDiracPanelStore.getState().clearPendingPrompt();
    expect(useDiracPanelStore.getState().pendingPrompt).toBeNull();
  });
});
