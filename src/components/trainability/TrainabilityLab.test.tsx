// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { TrainabilityLab } from './TrainabilityLab';
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
    expect(screen.getByText('The Trainability Lab needs the desktop kernel')).toBeTruthy();
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
    expect(screen.getByText('exponential dla')).toBeTruthy();
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
