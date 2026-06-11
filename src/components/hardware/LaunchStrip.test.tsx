// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/react';
import { LaunchStrip, relativeAge } from './LaunchStrip';
import { useHardwareStore } from '../../stores/hardwareStore';

const mockHardware = {
  hardwareConnect: vi.fn(),
  hardwareSubmit: vi.fn(),
  hardwareCancel: vi.fn(),
  hardwareDismiss: vi.fn(),
};

vi.mock('../../App', () => ({
  getHardware: () => mockHardware,
}));

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

describe('relativeAge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['2026-06-10T11:59:55Z', '5s ago'],
    ['2026-06-10T11:55:00Z', '5m ago'],
    ['2026-06-10T07:00:00Z', '5h ago'],
    ['2026-06-05T12:00:00Z', '5d ago'],
    ['2026-05-03T12:00:00Z', '5w ago'],
  ])('formats %s as %s', (iso, expected) => {
    expect(relativeAge(iso)).toBe(expected);
  });

  it('clamps future timestamps to 0s ago', () => {
    expect(relativeAge('2026-06-10T12:00:05Z')).toBe('0s ago');
  });
});

describe('LaunchStrip — terminal jobs', () => {
  beforeEach(() => {
    useHardwareStore.setState({ jobs: [] });
    mockHardware.hardwareCancel.mockClear();
    mockHardware.hardwareDismiss.mockClear();
  });

  afterEach(() => {
    cleanup();
    useHardwareStore.setState({ jobs: [] });
  });

  const addJob = (status: 'failed' | 'complete' | 'running', submittedAt: string) => {
    act(() => {
      useHardwareStore.getState().addJob({
        id: 'job-1',
        provider: 'simulator',
        backend: 'sim_qasm',
        submittedAt,
        status,
        queuePosition: null,
        shots: 1024,
      });
    });
  };

  it('shows a static relative age for failed jobs instead of a ticking timer', () => {
    const fiveWeeksAgo = new Date(Date.now() - 5 * 7 * 24 * 3600 * 1000).toISOString();
    addJob('failed', fiveWeeksAgo);
    const { container } = render(<LaunchStrip />);
    expect(container.textContent).toContain('failed');
    expect(container.textContent).toContain('5w ago');
    // The old bug: 38 days rendered as a live "56309m 29s" elapsed counter.
    expect(container.textContent).not.toMatch(/\d+m \d+s/);
  });

  it('keeps the live elapsed timer for running jobs', () => {
    const ninetySecondsAgo = new Date(Date.now() - 90 * 1000).toISOString();
    addJob('running', ninetySecondsAgo);
    const { container } = render(<LaunchStrip />);
    expect(container.textContent).toMatch(/1m \d+s/);
    expect(container.textContent).not.toContain('ago');
  });

  it('Dismiss sends hardware_dismiss to the kernel and clears the job locally', () => {
    addJob('failed', new Date().toISOString());
    const { getByLabelText } = render(<LaunchStrip />);
    fireEvent.click(getByLabelText('Dismiss job'));
    expect(mockHardware.hardwareDismiss).toHaveBeenCalledWith('job-1');
    expect(mockHardware.hardwareCancel).not.toHaveBeenCalled();
    expect(useHardwareStore.getState().jobs).toHaveLength(0);
  });

  it('Cancel (non-terminal) still routes to hardwareCancel, not dismiss', () => {
    addJob('running', new Date().toISOString());
    const { getByLabelText } = render(<LaunchStrip />);
    fireEvent.click(getByLabelText('Cancel job'));
    expect(mockHardware.hardwareCancel).toHaveBeenCalledWith('job-1');
    expect(mockHardware.hardwareDismiss).not.toHaveBeenCalled();
  });
});
