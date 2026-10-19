// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { KernelBanner } from './KernelBanner';
import { useEditorStore } from '../../stores/editorStore';
import { registerKernelRetry } from '../../lib/kernelControl';

function Shell() {
  const ready = useEditorStore((s) => s.kernelReady);
  const status = useEditorStore((s) => s.kernelStatus);
  return (
    <div>
      <KernelBanner />
      <button data-run-button="" disabled={!ready && status === 'failed'}>Run</button>
    </div>
  );
}

beforeEach(() => {
  useEditorStore.setState({ kernelStatus: 'failed', kernelReady: false, kernelError: 'Python did not start' });
  registerKernelRetry(() => useEditorStore.setState({ kernelStatus: 'connecting', kernelError: null }));
});
afterEach(() => { cleanup(); registerKernelRetry(null); });

describe('KernelBanner Retry', () => {
  it('lands focus on the Run button when the banner goes away, never on <body>', async () => {
    render(<Shell />);
    const retry = screen.getByRole('button', { name: 'Retry' });
    act(() => { retry.focus(); });
    fireEvent.click(retry);
    await act(async () => { await new Promise((r) => setTimeout(r, 120)); });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Run' }));
  });
});
