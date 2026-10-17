import { useState } from 'react';
import { Atom } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { QEC_TEMPLATES, type QecTemplate } from '../../services/qecTemplates';
import { scaffoldQecExperiment } from '../../services/qecScaffold';
import { TYPOGRAPHY, ICON_SIZE, ICON_STROKE } from '../../styles/tokens';
import { Button, TextInput } from '../ui';
import './experiments.css';

/**
 * PRD 10 Phase F — "New QEC experiment" menu. Picks a memory template, names
 * it, and scaffolds real editable files (stim-generating Python + campaign
 * YAML). Lives beside "+ New experiment" in the Experiments rail.
 */
export function NewQecExperimentMenu({ projectRoot }: { projectRoot: string }) {
  const colors = useThemeStore((s) => s.colors);
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<QecTemplate | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setOpen(false);
    setChosen(null);
    setName('');
    setError(null);
    setBusy(false);
  };

  const create = async () => {
    if (!chosen) return;
    const finalName = name.trim() || chosen.label;
    setBusy(true);
    setError(null);
    const result = await scaffoldQecExperiment(chosen, finalName, projectRoot);
    if (result.ok) {
      reset();
    } else {
      setError(result.error ?? 'Could not create the experiment.');
      setBusy(false);
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <Button
        size="md"
        onClick={() => setOpen((v) => !v)}
        title="New QEC experiment"
        aria-label="New QEC experiment"
        aria-haspopup="menu"
        aria-expanded={open}
        icon={<Atom size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} />}
      >
        QEC
      </Button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 20,
            width: 300, background: colors.bg, border: `1px solid ${colors.borderStrong}`,
            borderRadius: 'var(--radius-soft)', boxShadow: 'var(--shadow-md)', padding: 8,
            fontFamily: TYPOGRAPHY.fontSans,
          }}
        >
          {!chosen ? (
            <>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, color: colors.textMuted, padding: '2px 4px 8px' }}>
                Choose a template
              </div>
              {QEC_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="nuclei-menu-item nuclei-experiment-template"
                  onClick={() => { setChosen(t); setName(t.label); }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{t.label}</div>
                  <div style={{ fontSize: 11, color: colors.textMuted, lineHeight: 1.4, marginTop: 4 }}>{t.description}</div>
                </button>
              ))}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button variant="ghost" size="sm" onClick={reset}>Cancel</Button>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, color: colors.text, marginBottom: 8 }}>{chosen.label}</div>
              <label htmlFor="qec-experiment-name" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: colors.textMuted }}>
                Experiment name
              </label>
              <TextInput
                id="qec-experiment-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                style={{ marginTop: 4 }}
              />
              <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 8, lineHeight: 1.4 }}>
                Writes an editable <code>qec/…py</code> and <code>experiments/…experiment.yaml</code>.
              </div>
              {error && <div style={{ color: colors.error, fontSize: 11, marginTop: 8 }}>{error}</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
                <Button variant="ghost" size="sm" onClick={() => { setChosen(null); setError(null); }}>Back</Button>
                <Button variant="primary" size="sm" loading={busy} onClick={() => { void create(); }}>
                  {busy ? 'Creating…' : 'Create'}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
