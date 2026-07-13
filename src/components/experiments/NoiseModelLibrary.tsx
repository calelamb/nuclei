import { useEffect, useMemo, useState } from 'react';
import { X, Copy, GitCompare } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { createTauriExperimentFs } from '../../services/experimentFs';
import { discoverNoiseModels } from '../../services/experimentStore';
import { duplicateNoiseModel } from '../../services/noiseModelScaffold';
import {
  BUILT_IN_NOISE_MODELS,
  noiseModelToYaml,
  diffNoiseModels,
  GENERATOR_ARG_NAMES,
  type NoiseModelDef,
} from '../../types/noiseModel';

/**
 * PRD 10 Phase F — the noise model library. Lists built-in and project
 * (`noise/*.noise.yaml`) models, shows a selected model's channels + YAML,
 * duplicates any model into an editable project file, and diffs two models'
 * generator-arg coefficients. Files remain the source of truth — this GUI
 * reads them and writes copies, it never edits in place.
 */
export function NoiseModelLibrary({ projectRoot, onClose }: { projectRoot: string; onClose: () => void }) {
  const colors = useThemeStore((s) => s.colors);
  const [projectModels, setProjectModels] = useState<NoiseModelDef[]>([]);
  const [errors, setErrors] = useState<{ fileName: string; errors: string[] }[]>([]);
  const [selectedName, setSelectedName] = useState<string>(BUILT_IN_NOISE_MODELS[0].name);
  const [compareName, setCompareName] = useState<string | null>(null);
  const [dupOpen, setDupOpen] = useState(false);
  const [dupName, setDupName] = useState('');
  const [dupError, setDupError] = useState<string | null>(null);

  const reload = () => {
    void discoverNoiseModels(projectRoot, createTauriExperimentFs()).then((r) => {
      setProjectModels(r.models);
      setErrors(r.validationErrors.map((e) => ({ fileName: e.fileName, errors: e.errors })));
    });
  };
  useEffect(reload, [projectRoot]);

  const all = useMemo<NoiseModelDef[]>(() => [...BUILT_IN_NOISE_MODELS, ...projectModels], [projectModels]);
  const selected = all.find((m) => m.name === selectedName) ?? all[0];
  const compare = compareName ? all.find((m) => m.name === compareName) ?? null : null;
  const diff = compare ? diffNoiseModels(selected, compare) : [];

  const doDuplicate = async () => {
    const result = await duplicateNoiseModel(selected, dupName, projectRoot);
    if (result.ok) {
      setDupOpen(false);
      setDupName('');
      setDupError(null);
      reload();
    } else {
      setDupError(result.error ?? 'Could not duplicate.');
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Noise model library"
      style={{
        position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.5)', fontFamily: "'Geist Sans', sans-serif",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 720, maxWidth: '92vw', height: 520, maxHeight: '88vh', display: 'flex', flexDirection: 'column',
          background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: `1px solid ${colors.border}` }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>Noise models</span>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', color: colors.textMuted, cursor: 'pointer' }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {/* List */}
          <div style={{ width: 220, borderRight: `1px solid ${colors.border}`, overflow: 'auto', flexShrink: 0 }}>
            <ListGroup label="Built-in" colors={colors}>
              {BUILT_IN_NOISE_MODELS.map((m) => (
                <ModelRow key={m.name} model={m} active={m.name === selectedName} compareActive={m.name === compareName} colors={colors} onSelect={() => setSelectedName(m.name)} />
              ))}
            </ListGroup>
            <ListGroup label={`Project (${projectModels.length})`} colors={colors}>
              {projectModels.length === 0 && (
                <div style={{ padding: '6px 12px', fontSize: 11, color: colors.textDim }}>
                  None yet. Duplicate a model to create <code>noise/…noise.yaml</code>.
                </div>
              )}
              {projectModels.map((m) => (
                <ModelRow key={m.name} model={m} active={m.name === selectedName} compareActive={m.name === compareName} colors={colors} onSelect={() => setSelectedName(m.name)} />
              ))}
              {errors.map((e) => (
                <div key={e.fileName} role="alert" style={{ padding: '6px 12px', fontSize: 10.5, color: colors.error }}>
                  {e.fileName}: {e.errors[0]}
                </div>
              ))}
            </ListGroup>
          </div>

          {/* Detail */}
          <div style={{ flex: 1, overflow: 'auto', padding: 14, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>{selected.name}</span>
              <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: selected.builtin ? colors.border : colors.dirac, color: selected.builtin ? colors.textMuted : '#fff' }}>
                {selected.builtin ? 'built-in' : 'project'}
              </span>
              <div style={{ flex: 1 }} />
              <button onClick={() => { setDupName(`${selected.name}-copy`); setDupOpen(true); setDupError(null); }} style={actionBtn(colors)}>
                <Copy size={12} /> Duplicate to edit
              </button>
            </div>
            <p style={{ fontSize: 12, color: colors.textMuted, lineHeight: 1.5, marginTop: 8 }}>{selected.description}</p>
            {selected.citation && (
              <p style={{ fontSize: 11, color: colors.textDim, fontStyle: 'italic' }}>{selected.citation}</p>
            )}

            <SectionLabel colors={colors}>Generator arguments (coefficients × p)</SectionLabel>
            {selected.generator_args === null ? (
              <div style={{ fontSize: 12, color: colors.textDim }}>
                Entry-only — this model can't be expressed through stim's uniform generator; a Python entry applies it.
              </div>
            ) : (
              <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
                <tbody>
                  {GENERATOR_ARG_NAMES.map((arg) => (
                    <tr key={arg}>
                      <td style={{ padding: '3px 8px 3px 0', color: colors.textMuted, fontFamily: "'Geist Mono', monospace" }}>{arg}</td>
                      <td style={{ padding: '3px 0', color: colors.text, fontFamily: "'Geist Mono', monospace" }}>
                        {selected.generator_args?.[arg] ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <SectionLabel colors={colors}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <GitCompare size={12} /> Compare with
              </span>
            </SectionLabel>
            <select
              value={compareName ?? ''}
              onChange={(e) => setCompareName(e.target.value || null)}
              style={{ background: colors.bg, color: colors.text, border: `1px solid ${colors.border}`, borderRadius: 4, padding: '5px 8px', fontSize: 12 }}
            >
              <option value="">— none —</option>
              {all.filter((m) => m.name !== selected.name).map((m) => (
                <option key={m.name} value={m.name}>{m.name}</option>
              ))}
            </select>
            {compare && (
              diff.length === 0 ? (
                <div style={{ fontSize: 12, color: colors.textDim, marginTop: 8 }}>
                  Identical generator arguments.
                </div>
              ) : (
                <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%', marginTop: 8 }}>
                  <thead>
                    <tr>
                      <th style={diffTh(colors)}>channel</th>
                      <th style={diffTh(colors)}>{selected.name}</th>
                      <th style={diffTh(colors)}>{compare.name}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diff.map((d) => (
                      <tr key={d.arg}>
                        <td style={diffTd(colors)}>{d.arg}</td>
                        <td style={diffTd(colors)}>{d.a ?? '—'}</td>
                        <td style={diffTd(colors)}>{d.b ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            )}

            <SectionLabel colors={colors}>YAML</SectionLabel>
            <pre style={{ margin: 0, padding: 10, borderRadius: 6, border: `1px solid ${colors.border}`, background: colors.bg, color: colors.textMuted, fontFamily: "'Geist Mono', monospace", fontSize: 11, overflow: 'auto' }}>
              {noiseModelToYaml(selected)}
            </pre>
          </div>
        </div>

        {dupOpen && (
          <div style={{ padding: '10px 14px', borderTop: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: colors.textMuted }}>Copy name</span>
            <input
              value={dupName}
              onChange={(e) => setDupName(e.target.value)}
              autoFocus
              style={{ flex: 1, background: colors.bg, color: colors.text, border: `1px solid ${colors.border}`, borderRadius: 4, padding: '5px 8px', fontSize: 12 }}
            />
            {dupError && <span style={{ color: colors.error, fontSize: 11 }}>{dupError}</span>}
            <button onClick={() => setDupOpen(false)} style={{ ...actionBtn(colors), border: 'none' }}>Cancel</button>
            <button onClick={() => { void doDuplicate(); }} style={{ padding: '5px 12px', background: colors.dirac, color: '#fff', border: 'none', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
              Create
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface C { bg: string; border: string; text: string; textMuted: string; textDim: string; dirac: string; error: string; }

function ListGroup({ label, colors, children }: { label: string; colors: C; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ padding: '8px 12px 4px', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, color: colors.textDim }}>{label}</div>
      {children}
    </div>
  );
}

function ModelRow({ model, active, compareActive, colors, onSelect }: { model: NoiseModelDef; active: boolean; compareActive: boolean; colors: C; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      style={{
        display: 'block', width: '100%', textAlign: 'left', padding: '6px 12px', background: active ? colors.border : 'transparent',
        border: 'none', borderLeft: `2px solid ${compareActive ? colors.dirac : 'transparent'}`, color: colors.text, cursor: 'pointer', fontSize: 12,
      }}
    >
      {model.name}
    </button>
  );
}

function SectionLabel({ colors, children }: { colors: C; children: React.ReactNode }) {
  return <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, color: colors.textDim, margin: '14px 0 6px' }}>{children}</div>;
}

function actionBtn(colors: C): React.CSSProperties {
  return { display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', background: 'transparent', border: `1px solid ${colors.border}`, borderRadius: 4, color: colors.textMuted, cursor: 'pointer', fontSize: 11, fontFamily: "'Geist Sans', sans-serif" };
}
function diffTh(colors: C): React.CSSProperties {
  return { textAlign: 'left', padding: '3px 8px', color: colors.textDim, fontWeight: 600, borderBottom: `1px solid ${colors.border}`, fontSize: 11 };
}
function diffTd(colors: C): React.CSSProperties {
  return { padding: '3px 8px', color: colors.text, fontFamily: "'Geist Mono', monospace", borderBottom: `1px solid ${colors.border}` };
}
