// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { LaunchStrip } from './LaunchStrip';
import { useHardwareStore } from '../../stores/hardwareStore';

// Regression: previously `useHardwareStore((s) => s.clearJob)` was called
// AFTER the `if (!latestJob) return null` early return, so adding the first
// job changed the hook count from 5 → 6 mid-mount and React threw
// "Rendered more hooks than during the previous render", white-paging the
// whole tree because LaunchStrip wasn't inside an ErrorBoundary.
describe('LaunchStrip — Rules of Hooks', () => {
  beforeEach(() => {
    useHardwareStore.setState({ jobs: [] });
  });

  afterEach(() => {
    cleanup();
    useHardwareStore.setState({ jobs: [] });
  });

  it('does not throw when a job is added after initial empty render', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { container } = render(<LaunchStrip />);
      expect(container.innerHTML).toBe('');

      act(() => {
        useHardwareStore.getState().addJob({
          id: 'job-test-1',
          provider: 'simulator',
          backend: 'aer_simulator',
          submittedAt: new Date().toISOString(),
          status: 'complete',
          queuePosition: null,
          shots: 1024,
        });
      });

      const hooksError = errorSpy.mock.calls.find((args) =>
        args.some((a) => typeof a === 'string' && /Rendered more hooks/.test(a)),
      );
      expect(hooksError).toBeUndefined();
      expect(container.textContent).toContain('aer_simulator');
    } finally {
      errorSpy.mockRestore();
    }
  });
});
