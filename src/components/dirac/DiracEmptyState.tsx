import { useNavigationStore } from '../../stores/navigationStore';
import { useWorkspaceStore, type WorkspaceMode } from '../../stores/workspaceStore';
import { DiracAtomIcon } from './DiracAtomIcon';
import './dirac.css';

interface Copy {
  subtitle: string;
  starters: readonly string[];
}

const DIRAC_EMPTY_COPY: Record<WorkspaceMode, Copy> = {
  learn: {
    subtitle: 'Your quantum computing tutor.',
    starters: ['Explain what my circuit does', 'Why does a Hadamard gate make a superposition?', 'Quiz me on what I just learned'],
  },
  research: {
    subtitle: 'Your research collaborator.',
    starters: ['Summarize the last sweep', 'What limits fidelity in this circuit?', 'Suggest the next experiment to run'],
  },
};

export function DiracEmptyState({ onPick }: { onPick: (text: string) => void }) {
  const mode = useWorkspaceStore((s) => s.mode);
  const copy = DIRAC_EMPTY_COPY[mode];
  const openSettings = useNavigationStore((s) => s.openSettings);
  return (
    <div className="dirac-empty">
      <DiracAtomIcon />
      <h3 className="dirac-empty__title">{mode === 'research' ? 'Dirac' : 'Hi, I’m Dirac'}</h3>
      <p className="dirac-empty__sub">{copy.subtitle}</p>
      <div className="dirac-empty__starters">
        {copy.starters.map((text) => (
          <button key={text} type="button" className="dirac-starter" onClick={() => onPick(text)}>
            {text}
          </button>
        ))}
      </div>
      <p className="dirac-empty__hint">Or try a slash command like <code>/explain</code></p>
      <p className="dirac-empty__hint">
        Want a running commentary on your circuit?{' '}
        <button type="button" className="dirac-link" onClick={() => openSettings('dirac')}>
          Turn on ambient narration
        </button>
      </p>
    </div>
  );
}
