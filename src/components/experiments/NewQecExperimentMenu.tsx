import { useState } from 'react';
import { Atom } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { QEC_TEMPLATES, type QecTemplate } from '../../services/qecTemplates';
import { scaffoldQecExperiment } from '../../services/qecScaffold';

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
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '4px 10px', background: 'transparent', border: `1px solid ${colors.dirac}`,
          borderRadius: 4, color: colors.dirac, cursor: 'pointer', fontSize: 11, fontWeight: 600,
          fontFamily: "'Geist Sans', sans-serif",
        }}
      >
        <Atom size={12} /> New QEC experiment
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 20,
            width: 300, background: colors.bg, border: `1px solid ${colors.border}`,
            borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.32)', padding: 8,
            fontFamily: "'Geist Sans', sans-serif",
          }}
        >
          {!chosen ? (
            <>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, color: colors.textDim, padding: '2px 4px 6px' }}>
                Choose a template
              </div>
              {QEC_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => { setChosen(t); setName(t.label); }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '8px', marginBottom: 4,
                    background: 'transparent', border: `1px solid ${colors.border}`, borderRadius: 5,
                    cursor: 'pointer', color: colors.text,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = colors.dirac; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = colors.border; }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{t.label}</div>
                  <div style={{ fontSize: 10.5, color: colors.textDim, lineHeight: 1.4, marginTop: 3 }}>{t.description}</div>
                </button>
              ))}
              <button onClick={reset} style={linkBtn(colors)}>Cancel</button>
            </>
          ) : (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, color: colors.text, marginBottom: 6 }}>{chosen.label}</div>
              <label style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, color: colors.textDim }}>
                Experiment name
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                style={{
                  width: '100%', marginTop: 4, padding: '6px 8px', fontSize: 12,
                  background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 4,
                  color: colors.text, outline: 'none', fontFamily: "'Geist Sans', sans-serif",
                }}
              />
              <div style={{ fontSize: 10.5, color: colors.textDim, marginTop: 6, lineHeight: 1.4 }}>
                Writes an editable <code>qec/…py</code> and <code>experiments/…experiment.yaml</code>.
              </div>
              {error && <div style={{ color: colors.error, fontSize: 11, marginTop: 6 }}>{error}</div>}
              <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => { setChosen(null); setError(null); }} style={linkBtn(colors)}>Back</button>
                <button
                  onClick={() => { void create(); }}
                  disabled={busy}
                  style={{
                    padding: '5px 12px', background: colors.dirac, color: '#fff', border: 'none',
                    borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: busy ? 'default' : 'pointer',
                    opacity: busy ? 0.6 : 1, fontFamily: "'Geist Sans', sans-serif",
                  }}
                >
                  {busy ? 'Creating…' : 'Create'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function linkBtn(colors: { textMuted: string }): React.CSSProperties {
  return {
    padding: '5px 8px', background: 'transparent', border: 'none',
    color: colors.textMuted, fontSize: 11, cursor: 'pointer', fontFamily: "'Geist Sans', sans-serif",
  };
}
