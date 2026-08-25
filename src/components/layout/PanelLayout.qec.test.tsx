// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformBridge } from '../../platform/bridge';
import { PlatformProvider } from '../../platform/PlatformProvider';
import { useChallengeModeStore } from '../../stores/challengeModeStore';
import { useCircuitStore } from '../../stores/circuitStore';
import { useLearnStore } from '../../stores/learnStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSimulationStore } from '../../stores/simulationStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { PanelLayout } from './PanelLayout';

vi.mock('../editor/QuantumEditor', () => ({
  QuantumEditor: () => <div data-testid="persistent-editor">Editor</div>,
}));
vi.mock('../editor/EditorTabs', () => ({ EditorTabs: () => <div>Editor tabs</div> }));
vi.mock('../editor/Breadcrumbs', () => ({
  Breadcrumbs: () => <div>Breadcrumbs</div>,
  ExperimentBreadcrumbs: () => <div>Experiment breadcrumbs</div>,
}));
vi.mock('../hardware/LaunchStrip', () => ({ LaunchStrip: () => <div>Launch strip</div> }));
vi.mock('../qec/VizZone', () => ({ VizZone: () => <div>Visualization zone</div> }));
vi.mock('../dirac/DiracSidePanel', () => ({ DiracSidePanel: () => <aside>Dirac</aside> }));
vi.mock('./StatusBar', () => ({ StatusBar: () => <footer>Status</footer> }));
vi.mock('./ModeSwitchDialog', () => ({ ModeSwitchDialog: () => null }));
vi.mock('./ResearchTour', () => ({ ResearchTour: () => null }));
vi.mock('../qec/workbench/QecWorkbench', () => ({
  QecWorkbench: () => <section aria-label="QEC workbench fixture">Workbench</section>,
}));

function webBridge(): PlatformBridge {
  return {
    startKernel: vi.fn(async () => 'ok'),
    stopKernel: vi.fn(async () => 'ok'),
    openFile: vi.fn(async () => null),
    readFile: vi.fn(async () => null),
    saveFile: vi.fn(async () => undefined),
    saveFileAs: vi.fn(async () => null),
    renameFile: vi.fn(async () => null),
    getStoredValue: vi.fn(async () => null),
    setStoredValue: vi.fn(async () => undefined),
    setWindowTitle: vi.fn(async () => undefined),
    getPlatform: () => 'web',
    openDirectory: vi.fn(async () => null),
    listDirectory: vi.fn(async () => null),
    createFile: vi.fn(async () => null),
    createDirectory: vi.fn(async () => null),
    deleteFile: vi.fn(async () => false),
  };
}

beforeEach(() => {
  useWorkspaceStore.setState({ mode: 'research' });
  useNavigationStore.setState({ activeView: 'qec' });
  useLearnStore.setState({ isLearnMode: false });
  useChallengeModeStore.setState({ isChallengeMode: false });
  useCircuitStore.setState({ snapshot: null });
  useSimulationStore.setState({ result: null, terminalOutput: [] });
  useProjectStore.setState({ projectRoot: null, tabs: [], activeTabPath: null });
});

afterEach(() => {
  cleanup();
});

describe('<PanelLayout> QEC integration', () => {
  it('opens the Research QEC takeover while keeping the editor mounted, then restores it', async () => {
    render(
      <PlatformProvider bridge={webBridge()}>
        <PanelLayout />
      </PlatformProvider>,
    );

    await act(async () => { await Promise.resolve(); });
    expect(await screen.findByLabelText('QEC workbench fixture')).toBeTruthy();
    expect(screen.getByTestId('persistent-editor').closest('[style*="display: none"]')).toBeTruthy();
    expect(screen.getByText('QEC Workbench')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'QEC Workbench' }));

    await waitFor(() => expect(screen.queryByLabelText('QEC workbench fixture')).toBeNull());
    expect(useNavigationStore.getState().activeView).toBeNull();
    expect(screen.getByTestId('persistent-editor').closest('[style*="display: none"]')).toBeNull();
    expect(screen.getByText('Dirac')).toBeTruthy();
  });
});
