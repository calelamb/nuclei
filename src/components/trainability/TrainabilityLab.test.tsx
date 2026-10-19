// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { TrainabilityLab, TrainabilityUnavailable } from './TrainabilityLab';
import { TrainabilitySidebar } from './TrainabilitySidebar';
import { useCircuitStore } from '../../stores/circuitStore';
import { useEditorStore } from '../../stores/editorStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { useProjectStore } from '../../stores/projectStore';
import { setTrainabilityClientFactory, useTrainabilityStore } from '../../stores/trainabilityStore';
import { codeKey } from '../../services/trainability/hash';
import { createTrainabilityClient } from '../../services/trainability/client';
import { createFakeSession, type FakeLabSession } from '../../services/trainability/fakeSession';
import { withPlatform } from '../../services/trainability/testBridge';
import {
  FIXTURE_CODE,
  circuitSnapshotFixture,
  inspectionFixture,
  jobFixture,
  lieSimulableFixture,
  lintDiagnosticsFixture,
  lintSummaryFixture,
} from '../../services/trainability/fixtures';

let session: FakeLabSession;

function seed(partial: Parameters<typeof useTrainabilityStore.setState>[0] = {}) {
  useTrainabilityStore.setState({
    inspect: { status: 'ready', data: inspectionFixture, error: null, codeKey: 'k' },
    ...partial,
  });
}

function withJob(job = jobFixture()) {
  seed({
    jobs: { [job.id]: job },
    jobOrder: [job.id],
    selectedJobId: job.id,
    activeJobId: ['starting', 'running', 'cancelling'].includes(job.status) ? job.id : null,
  });
}

function mountLab(platform: 'desktop' | 'web' = 'desktop') {
  const Wrapper = withPlatform(platform);
  return render(
    <Wrapper>
      <TrainabilityLab />
    </Wrapper>,
  );
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  useTrainabilityStore.getState().reset();
  useEditorStore.setState({ code: FIXTURE_CODE, framework: 'qiskit', filePath: '/proj/ansatz/hardware_efficient.py' });
  useCircuitStore.setState({ snapshot: circuitSnapshotFixture });
  session = createFakeSession((m, s) => {
    if (m.type === 'trainability_inspect') s.emit({ type: 'trainability_inspected', ...inspectionFixture });
  });
  setTrainabilityClientFactory(async () => createTrainabilityClient(session));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setTrainabilityClientFactory(null);
});

describe('TrainabilityLab: web build', () => {
  it('shows the friendly desktop-kernel state and no controls', () => {
    mountLab('web');
    expect(screen.getByText('The Trainability Lab runs on the desktop app')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download Nuclei' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Run analyses/ })).toBeNull();
    expect(session.sent).toHaveLength(0);
  });
});

describe('TrainabilityLab: empty', () => {
  it('shows the target bar, an empty heatmap legend and empty tabs', () => {
    seed();
    mountLab();
    expect(screen.getByRole('region', { name: 'Trainability target' })).toBeTruthy();
    expect(screen.getByText('hardware_efficient.py')).toBeTruthy();
    expect(screen.getByText('n = 4')).toBeTruthy();
    expect(screen.getByText('m = 6')).toBeTruthy();
    expect(screen.getByText('n_qubits')).toBeTruthy();
    expect(screen.getByText('Gradients: nothing to show yet')).toBeTruthy();
    expect(screen.getByText(/run gradients to tint them/)).toBeTruthy();
    expect(screen.getByText('No evidence yet. Run the analyses to build the chain: scaling fit, Lie algebra, gradient statistics and lint.')).toBeTruthy();
    expect(screen.getByText('Available once an analysis has finished.')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Run analyses/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('disables running for a circuit without parameters', () => {
    seed({ inspect: { status: 'ready', data: { ...inspectionFixture, parameters: [], param_gates: [] }, error: null, codeKey: 'k' } });
    mountLab();
    expect(screen.getByText('No free parameters')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Run analyses/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows an inspect error', () => {
    seed({ inspect: { status: 'error', data: null, error: 'No circuit found in this file', codeKey: 'k' } });
    mountLab();
    expect(screen.getByText('Could not inspect this file')).toBeTruthy();
    expect(screen.getByText('No circuit found in this file')).toBeTruthy();
  });
});

describe('TrainabilityLab: loading', () => {
  it('shows progress, a cancel button and skeleton tabs while running', () => {
    withJob(jobFixture({ status: 'running', results: {}, provenance: null, finishedAt: null, elapsedMs: null, progress: { gradients: { fraction: 0.4, message: 'sample 80/200' } } }));
    mountLab();
    expect(screen.getByRole('status', { name: 'Gradients is running' })).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Analysis progress' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect((screen.getByRole('button', { name: /Run analyses/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText('sample 80/200').length).toBeGreaterThan(0);
  });

  it('cancels through the store', async () => {
    withJob(jobFixture({ status: 'running', results: {}, provenance: null }));
    const cancel = vi.fn(async () => undefined);
    useTrainabilityStore.setState({ cancel });
    mountLab();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(cancel).toHaveBeenCalled();
  });
});

describe('TrainabilityLab: populated', () => {
  it('renders heatmap, verdict rail and every analysis tab', () => {
    withJob();
    useTrainabilityStore.setState({
      lint: { status: 'ready', diagnostics: lintDiagnosticsFixture, summary: lintSummaryFixture, error: null, codeKey: 'k' },
    });
    useEditorStore.setState({ code: FIXTURE_CODE });
    mountLab();

    // Verdict rail
    expect(screen.getByText('BP risk: high')).toBeTruthy();
    const evidence = screen.getByRole('list', { name: 'Evidence chain' });
    expect(within(evidence).getAllByRole('listitem').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('Exponential DLA')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Lint diagnostics' })).toBeTruthy();
    expect(screen.getByText('Cerezo et al., Nat. Commun. 12, 1791 (2021)').getAttribute('href')).toContain('doi.org');
    expect((screen.getByRole('button', { name: /Export certificate/ }) as HTMLButtonElement).disabled).toBe(false);

    // Heatmap
    expect(screen.getAllByRole('img', { name: /^θ\[/ }).length).toBe(6);

    // Tabs
    const tab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));
    expect(screen.getByRole('img', { name: 'Per-parameter gradient variance' })).toBeTruthy();
    tab('Scaling');
    expect(screen.getByRole('img', { name: 'Gradient variance scaling with qubit count' })).toBeTruthy();
    tab('Lie algebra');
    expect(screen.getByRole('meter')).toBeTruthy();
    tab('Expressibility');
    expect(screen.getByRole('img', { name: 'Fidelity histogram against the Haar curve' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Meyer–Wallach entanglement distribution' })).toBeTruthy();
    tab('Landscape');
    expect(screen.getByRole('img', { name: 'Loss landscape heatmap' })).toBeTruthy();
  });

  it('flags results that predate the current code', () => {
    withJob(jobFixture({ codeKey: codeKey('qiskit\nolder code') }));
    mountLab();
    expect(screen.getByText('The code changed after this analysis')).toBeTruthy();
  });

  it('does not flag fresh results', () => {
    withJob(jobFixture({ codeKey: codeKey(`qiskit\n${FIXTURE_CODE}`) }));
    mountLab();
    expect(screen.queryByText('The code changed after this analysis')).toBeNull();
  });
});

describe('TrainabilityLab: error', () => {
  it('shows a job-level failure and per-analysis errors', () => {
    withJob(
      jobFixture({
        status: 'failed',
        results: {},
        error: { code: 'disconnected', message: 'The kernel connection closed while the job was running.' },
      }),
    );
    mountLab();
    expect(screen.getByText('The job did not finish')).toBeTruthy();
    expect(screen.getAllByText(/kernel connection closed/).length).toBeGreaterThan(0);
    expect(screen.getByText('Gradients failed')).toBeTruthy();
  });

  it('shows a partial failure alongside completed analyses', () => {
    const job = jobFixture();
    withJob({ ...job, results: { ...job.results, landscape: undefined }, errors: { landscape: { code: 'too_large', message: 'grid too large for 20 qubits' } } });
    mountLab();
    fireEvent.click(screen.getByRole('tab', { name: 'Landscape' }));
    expect(screen.getByRole('alert').textContent).toContain('grid too large');
    fireEvent.click(screen.getByRole('tab', { name: 'Gradients' }));
    expect(screen.getByRole('img', { name: 'Per-parameter gradient variance' })).toBeTruthy();
  });
});

describe('TargetBar interactions', () => {
  it('writes presets into the observable field', () => {
    seed();
    mountLab();
    const input = screen.getByLabelText('Observable') as HTMLInputElement;
    expect(input.value).toBe('preset:local_z');
    fireEvent.click(screen.getByRole('button', { name: 'TFIM' }));
    expect(input.value).toBe('preset:tfim');
    expect(useTrainabilityStore.getState().observable).toBe('preset:tfim');
    expect(screen.getByRole('button', { name: 'TFIM' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('shows the kernel parse error with a caret under the column', () => {
    seed({ observable: 'Z0 Q1', observableError: { message: 'Unexpected "Q"', column: 3 } });
    mountLab();
    expect(screen.getByRole('alert').textContent).toContain('Unexpected "Q" (column 3)');
    expect(document.querySelector('[aria-hidden]')?.textContent).toBeDefined();
    expect((screen.getByLabelText('Observable') as HTMLInputElement).getAttribute('aria-invalid')).toBe('true');
  });

  it('starts a job on click and on ⌘⇧↵ but not on ⌘↵', async () => {
    seed();
    const start = vi.fn(async () => 'job');
    useTrainabilityStore.setState({ start });
    mountLab();
    fireEvent.click(screen.getByRole('button', { name: /Run analyses/ }));
    expect(start).toHaveBeenCalledTimes(1);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true }));
    });
    expect(start).toHaveBeenCalledTimes(1);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, shiftKey: true }));
    });
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('toggles analyses and validates scaling input', () => {
    seed();
    mountLab();
    fireEvent.click(screen.getByRole('button', { name: 'Landscape' }));
    expect(useTrainabilityStore.getState().effectiveAnalyses()).not.toContain('landscape');
    fireEvent.change(screen.getByLabelText('Scaling qubits'), { target: { value: 'x' } });
    expect(screen.getByText('"x" is not a whole number.')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Run analyses/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables scaling when n_qubits is not sweepable', () => {
    seed({ inspect: { status: 'ready', data: { ...inspectionFixture, sweepable_params: [] }, error: null, codeKey: 'k' } });
    mountLab();
    expect((screen.getByRole('button', { name: 'Scaling' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Verdict rail interactions', () => {
  it('jumps to a lint line by revealing it in the editor', () => {
    withJob();
    useTrainabilityStore.setState({
      lint: { status: 'ready', diagnostics: lintDiagnosticsFixture, summary: lintSummaryFixture, error: null, codeKey: 'k' },
    });
    useNavigationStore.setState({ activeView: 'trainability' });
    mountLab();
    fireEvent.click(screen.getByRole('button', { name: 'Jump to line 9 in the editor' }));
    expect(useTrainabilityStore.getState().revealRequest?.line).toBe(9);
    expect(useNavigationStore.getState().activeView).toBe('files');
  });

  it('exports the certificate through the bridge', async () => {
    withJob();
    useProjectStore.setState({ projectRoot: '/proj' });
    const written: string[] = [];
    const Wrapper = withPlatform('desktop', {
      createFileExclusive: async (path) => {
        written.push(path);
        return 'created';
      },
    });
    render(
      <Wrapper>
        <TrainabilityLab />
      </Wrapper>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Export certificate/ }));
    });
    expect(written).toEqual([
      '/proj/experiments/hardware_efficient.trainability.json',
      '/proj/experiments/hardware_efficient.trainability.md',
    ]);
    expect(screen.getByText('Certificate saved')).toBeTruthy();
  });

  it('shows lint loading, error and clean states', () => {
    seed();
    const { rerender } = mountLab();
    expect(screen.getByText('No lint yet')).toBeTruthy();
    const Wrapper = withPlatform('desktop');
    useTrainabilityStore.setState({ lint: { status: 'loading', diagnostics: [], summary: null, error: null, codeKey: null } });
    rerender(<Wrapper><TrainabilityLab /></Wrapper>);
    expect(document.querySelector('.lab-skeleton')).toBeTruthy();
    useTrainabilityStore.setState({ lint: { status: 'error', diagnostics: [], summary: null, error: 'kernel said no', codeKey: null } });
    rerender(<Wrapper><TrainabilityLab /></Wrapper>);
    expect(screen.getByText('Lint failed')).toBeTruthy();
    useTrainabilityStore.setState({ lint: { status: 'ready', diagnostics: [], summary: lintSummaryFixture, error: null, codeKey: null } });
    rerender(<Wrapper><TrainabilityLab /></Wrapper>);
    expect(screen.getByText('No findings')).toBeTruthy();
  });
});

describe('TrainabilitySidebar', () => {
  it('shows an empty state, then recent jobs, certificates and citations', () => {
    const { rerender } = render(<TrainabilitySidebar />);
    expect(screen.getByText('No analyses yet')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Citations' }).querySelectorAll('li').length).toBeGreaterThanOrEqual(6);
    const job = jobFixture();
    const other = jobFixture({ id: 'trn-2', status: 'failed', target: { ...job.target, fileName: 'tfim_hva.py' } });
    useTrainabilityStore.setState({
      jobs: { [job.id]: job, [other.id]: other },
      jobOrder: [other.id, job.id],
      savedCertificates: [{ jsonPath: '/proj/experiments/x.trainability.json', markdownPath: '/proj/experiments/x.trainability.md', savedAt: 1, fileName: 'x.py', jobId: job.id }],
    });
    rerender(<TrainabilitySidebar />);
    const list = screen.getByRole('list', { name: 'Recent trainability jobs' });
    expect(within(list).getAllByRole('button')).toHaveLength(2);
    fireEvent.click(within(list).getByText('hardware_efficient.py'));
    expect(useTrainabilityStore.getState().selectedJobId).toBe(job.id);
    expect(screen.getByText('/proj/experiments/x.trainability.json')).toBeTruthy();
  });
});

describe('review fixes: target bar (UI-2, UI-3)', () => {
  it('shows a "from file" chip for a declared observable, and drops it when the user edits', () => {
    seed({ observable: 'preset:global_z', observableSource: 'file' });
    mountLab();
    expect(screen.getByText('from file')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Observable'), { target: { value: '0.5*Z0*Z1' } });
    expect(screen.queryByText('from file')).toBeNull();
    expect(useTrainabilityStore.getState().observableSource).toBe('user');
    // The file still declares preset:global_z: offer to go back.
    expect(screen.getByText('preset:global_z')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: "Use the file's" }));
    expect(useTrainabilityStore.getState().observable).toBe('preset:global_z');
    expect(screen.getByText('from file')).toBeTruthy();
  });

  it('picking a preset overrides the file', () => {
    seed({ observable: 'preset:global_z', observableSource: 'file' });
    mountLab();
    fireEvent.click(screen.getByRole('button', { name: 'TFIM' }));
    expect(screen.queryByText('from file')).toBeNull();
    expect(useTrainabilityStore.getState().observable).toBe('preset:tfim');
  });

  it('explains why Run is disabled for a circuit with no parameters', () => {
    seed({ inspect: { status: 'ready', data: { ...inspectionFixture, parameters: [], param_gates: [] }, error: null, codeKey: 'k' } });
    mountLab();
    const run = screen.getByRole('button', { name: /Run analyses/ }) as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    expect(screen.getByText(/no free parameters \(m = 0\), so there is nothing to train/)).toBeTruthy();
    expect(run.getAttribute('aria-describedby')).toBe('trainability-run-reason');
  });
});

describe('review fixes: verdict rail (UI-3, UI-5, low items)', () => {
  it('shows BP risk as not applicable, never "low", for a parameter-free job', () => {
    const base = jobFixture();
    withJob({ ...base, target: { ...base.target, nParameters: 0 }, results: { lie: { ...lieSimulableFixture } } });
    mountLab();
    expect(screen.getByText('BP risk: n/a (no free parameters)')).toBeTruthy();
    expect(screen.queryByText('BP risk: low')).toBeNull();
  });

  it('labels evidence chips with names, not raw ids like "lie"', () => {
    withJob();
    mountLab();
    const evidence = screen.getByRole('list', { name: 'Evidence chain' });
    expect(within(evidence).getAllByText('Lie algebra').length).toBeGreaterThan(0);
    expect(within(evidence).queryByText('lie')).toBeNull();
  });

  it('renders duplicate diagnostics without React key warnings (UI-5)', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    withJob();
    const dup = lintDiagnosticsFixture[1];
    useTrainabilityStore.setState({
      lint: { status: 'ready', diagnostics: [dup, dup, dup], summary: lintSummaryFixture, error: null, codeKey: 'k' },
    });
    mountLab();
    expect(screen.getAllByText('Dead parameter')).toHaveLength(3);
    expect(errors.mock.calls.filter((c) => String(c[0]).includes('same key'))).toHaveLength(0);
  });

  it('softens the TRN003 wording in the lint list', () => {
    withJob();
    useTrainabilityStore.setState({
      lint: {
        status: 'ready',
        diagnostics: [
          {
            code: 'TRN003',
            severity: 'info',
            title: 'Polynomial dynamical Lie algebra',
            message: 'dim 𝔤 = 15 ≤ 36: the circuit is trainable in the barren-plateau sense but likely classically simulable with 𝔤-sim.',
            citation: null,
            line: null,
            source_indices: [],
          },
        ],
        summary: lintSummaryFixture,
        error: null,
        codeKey: 'k',
      },
    });
    mountLab();
    const list = screen.getByRole('list', { name: 'Lint diagnostics' });
    expect(list.textContent).not.toContain('is trainable in the barren-plateau sense');
    expect(list.textContent).toContain('does not bound the gradient variance');
  });

  it('keeps the caveat free of literal asterisks', () => {
    withJob();
    mountLab();
    expect(screen.getByText(/Hardness is resistance to this Pauli-propagation estimator/).textContent).not.toContain('*');
  });

  it('wraps the certificate path inside the rail card (no overflow)', () => {
    withJob();
    mountLab();
    const note = screen.getByText(/Writes/);
    expect(note.getAttribute('style')).toContain('overflow-wrap: anywhere');
  });
});

describe('review fixes: cancelled analyses are neutral (medium 15)', () => {
  it('shows "Not run (cancelled)" instead of a danger callout, and a neutral status pill', () => {
    withJob(jobFixture({ status: 'cancelled', results: {}, provenance: null }));
    mountLab();
    fireEvent.click(screen.getByRole('tab', { name: 'Lie algebra' }));
    expect(screen.getByText('Not run (cancelled)')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/Lie algebra failed/)).toBeNull();
    const pill = screen.getAllByText('cancelled')[0].closest('.lab-pill');
    expect(pill?.className).not.toMatch(/warning|danger/);
  });

  it('keeps cancelled neutral in the sidebar too', () => {
    const job = jobFixture({ status: 'cancelled' });
    useTrainabilityStore.setState({ jobs: { [job.id]: job }, jobOrder: [job.id] });
    render(<TrainabilitySidebar />);
    const pill = screen.getByText('cancelled').closest('.lab-pill');
    expect(pill?.className).not.toMatch(/warning|danger/);
  });
});

describe('review fixes: web-unavailable state and sidebar (low items)', () => {
  it('opens the releases page from the download button', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    mountLab('web');
    fireEvent.click(screen.getByRole('button', { name: 'Download Nuclei' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(open).toHaveBeenCalledWith('https://github.com/calelamb/nuclei/releases', '_blank', 'noopener,noreferrer');
  });

  it('does not tell a web user to "Run analyses from the Trainability Lab"', () => {
    useTrainabilityStore.setState({ unavailable: { reason: 'web_build', message: 'x' } });
    render(<TrainabilitySidebar />);
    expect(screen.queryByText(/Run analyses from the Trainability Lab/)).toBeNull();
    expect(screen.getByText(/Analyses need the desktop app/)).toBeTruthy();
  });

  it('shows a connect failure without a download button', () => {
    render(<TrainabilityUnavailable reason="connect_failed" message="Could not connect to the kernel at ws://x" />);
    expect(screen.getByText('Could not connect to the kernel at ws://x')).toBeTruthy();
    expect(screen.getByText('The Trainability Lab could not reach the kernel')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Download Nuclei' })).toBeNull();
  });
});
