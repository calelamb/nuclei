import { useState, type KeyboardEvent } from 'react';
import { Atom } from 'lucide-react';
import { QEC_TEMPLATES, type QecTemplate } from '../../services/qecTemplates';
import { scaffoldQecExperiment } from '../../services/qecScaffold';
import { ICON_SIZE, ICON_STROKE } from '../../styles/tokens';
import { Button, Dialog, TextInput } from '../ui';
import './experiments.css';

/**
 * "New QEC experiment": a dialog with a template radiogroup and a name field
 * that scaffolds real editable files (stim-generating Python + campaign YAML).
 * Lives beside "New experiment" in the Experiments rail. Escape, the scrim and
 * the Cancel button dismiss it, and focus returns to the QEC button.
 */
function TemplateRadios({ value, onChange }: { value: QecTemplate; onChange: (t: QecTemplate) => void }) {
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const group = e.currentTarget;
    const at = QEC_TEMPLATES.findIndex((t) => t.id === value.id);
    const next = QEC_TEMPLATES[(at + step + QEC_TEMPLATES.length) % QEC_TEMPLATES.length];
    onChange(next);
    requestAnimationFrame(() => {
      group.querySelector<HTMLElement>(`[data-template="${next.id}"]`)?.focus();
    });
  };
  return (
    <div role="radiogroup" aria-label="Template" className="nuclei-qec-templates" onKeyDown={move}>
      {QEC_TEMPLATES.map((t) => {
        const checked = t.id === value.id;
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={checked}
            data-template={t.id}
            tabIndex={checked ? 0 : -1}
            className="nuclei-experiment-template"
            onClick={() => onChange(t)}
          >
            <span className="nuclei-experiment-template__title">{t.label}</span>
            <span className="nuclei-experiment-template__desc">{t.description}</span>
          </button>
        );
      })}
    </div>
  );
}

export function NewQecExperimentMenu({ projectRoot }: { projectRoot: string }) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<QecTemplate>(QEC_TEMPLATES[0]);
  const [name, setName] = useState(QEC_TEMPLATES[0].label);
  const [nameEdited, setNameEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setOpen(false);
    setError(null);
    setBusy(false);
  };

  const pick = (t: QecTemplate) => {
    setChosen(t);
    // Follow the template name until the user types their own.
    if (!nameEdited) setName(t.label);
  };

  const create = async () => {
    const finalName = name.trim() || chosen.label;
    setBusy(true);
    setError(null);
    const result = await scaffoldQecExperiment(chosen, finalName, projectRoot);
    if (result.ok) {
      close();
      setNameEdited(false);
      setName(chosen.label);
    } else {
      setError(result.error ?? 'Could not create the experiment.');
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        size="md"
        onClick={() => setOpen(true)}
        aria-label="New QEC experiment"
        aria-haspopup="dialog"
        aria-expanded={open}
        icon={<Atom size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} />}
      >
        QEC
      </Button>
      {open && (
        <Dialog
          title="New QEC experiment"
          description="Pick a template. Nuclei writes an editable circuit script and campaign file."
          width={440}
          onClose={close}
          initialFocus="[role=radio][aria-checked=true]"
          footer={(
            <>
              <Button variant="ghost" onClick={close}>Cancel</Button>
              <Button variant="primary" loading={busy} onClick={() => { void create(); }}>
                {busy ? 'Creating…' : 'Create'}
              </Button>
            </>
          )}
        >
          <TemplateRadios value={chosen} onChange={pick} />
          <label htmlFor="qec-experiment-name" className="nuclei-qec-name-label">Experiment name</label>
          <TextInput
            id="qec-experiment-name"
            value={name}
            onChange={(e) => { setName(e.target.value); setNameEdited(true); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !busy) { e.preventDefault(); void create(); } }}
          />
          <p className="nuclei-qec-name-hint">
            Writes <code>qec/…py</code> and <code>experiments/…experiment.yaml</code>.
          </p>
          {error && <p role="alert" className="nuclei-qec-name-error">{error}</p>}
        </Dialog>
      )}
    </>
  );
}
