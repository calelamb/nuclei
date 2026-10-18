import { Dna, FileCode2, MonitorOff, Plus } from 'lucide-react';
import { LabButton, LabCallout, LabEmptyState, LabShell, LabShellBody, LabSkeleton, LabToolbar } from '../lab';
import { useDiscoveryStore } from '../../stores/discoveryStore';
import { DefinitionPanel } from './DefinitionPanel';
import { NewDiscoveryWizard } from './NewDiscoveryWizard';
import { RunDetail } from './RunDetail';
import { useDiscoveryBoot } from './useDiscoveryBoot';
import './discovery.css';

export function DiscoveryUnavailable({ message }: { message: string }) {
  return (
    <LabEmptyState
      icon={MonitorOff}
      title="The Discovery Engine needs the desktop kernel"
      body={`${message} Open Nuclei on the desktop to run evolutionary searches over quantum programs. The web build cannot run the sandboxed evaluators.`}
    />
  );
}

function LoadingRun() {
  return (
    <div className="lab-stack" aria-busy="true" aria-label="Loading run">
      <LabSkeleton height={92} />
      <LabSkeleton height={84} />
      <LabSkeleton height={280} />
    </div>
  );
}

function Body() {
  const { unavailable, projectRoot } = useDiscoveryBoot();
  const wizardOpen = useDiscoveryStore((s) => s.wizardOpen);
  const openWizard = useDiscoveryStore((s) => s.openWizard);
  const selectedRunId = useDiscoveryStore((s) => s.selectedRunId);
  const view = useDiscoveryStore((s) => (s.selectedRunId ? (s.views[s.selectedRunId] ?? null) : null));
  const kpis = useDiscoveryStore((s) => (s.selectedRunId ? (s.kpis[s.selectedRunId] ?? null) : null));
  const definition = useDiscoveryStore((s) => s.definitions.find((d) => d.fileName === s.selectedDefinition) ?? null);
  const hasDefinitions = useDiscoveryStore((s) => s.definitions.length > 0);
  const loading = useDiscoveryStore((s) => s.loading);
  const error = useDiscoveryStore((s) => s.error);

  if (unavailable) return <DiscoveryUnavailable message={unavailable.message} />;
  if (!projectRoot) {
    return <LabEmptyState icon={FileCode2} title="Open a project to use the Discovery Engine" body="Definitions are stored in experiments/*.discovery.yaml, and runs are saved next to them so they can be resumed and committed." />;
  }

  let content;
  if (wizardOpen) content = <NewDiscoveryWizard />;
  else if (selectedRunId) content = view && kpis ? <RunDetail key={selectedRunId} view={view} kpis={kpis} /> : <LoadingRun />;
  else if (definition) content = <DefinitionPanel key={definition.fileName} definition={definition} />;
  else if (loading && !hasDefinitions) content = <LoadingRun />;
  else {
    content = (
      <LabEmptyState
        icon={Dna}
        title={hasDefinitions ? 'Pick a discovery' : 'Evolve a better quantum program'}
        body={hasDefinitions ? 'Choose a definition or a run in the sidebar, or start a new discovery from a template.' : 'The engine proposes edits to a seed program, scores each one with a trusted evaluator it cannot touch, and keeps what works. Start from a template to see it run.'}
        actions={<LabButton variant="primary" icon={Plus} onClick={openWizard}>New discovery</LabButton>}
      />
    );
  }

  return (
    <div className="lab-stack">
      {error && <LabCallout tone="danger" title="Something went wrong">{error}</LabCallout>}
      {content}
    </div>
  );
}

/** Main-area takeover for the Discovery Engine. */
export function DiscoveryWorkbench() {
  const openWizard = useDiscoveryStore((s) => s.openWizard);
  const projectOpen = useDiscoveryStore((s) => s.projectRoot !== null);
  return (
    <LabShell label="Discovery Engine">
      <LabToolbar icon={Dna} title="Discovery Engine" subtitle="Evolutionary search with trusted evaluators">
        <LabButton variant="primary" size="md" icon={Plus} disabled={!projectOpen} onClick={openWizard}>New discovery</LabButton>
      </LabToolbar>
      <LabShellBody>
        <Body />
      </LabShellBody>
    </LabShell>
  );
}
