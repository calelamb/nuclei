import { useCallback, useEffect, useMemo, useState } from 'react';
import { X, Copy, GitCompare } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';
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
import { TYPOGRAPHY, ICON_SIZE, ICON_STROKE } from '../../styles/tokens';
import { Button, IconButton, Select, TextInput } from '../ui';
import { Table, Thead, Tbody, Tr, Th, Td } from '../ui/Table';
import './experiments.css';

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

  // Escape cancels the inline duplicate form if it's open, otherwise closes
  // the whole library — so a stray Escape mid-edit doesn't lose the modal.
  const handleEscape = useCallback(() => {
    if (dupOpen) setDupOpen(false);
    else onClose();
  }, [dupOpen, onClose]);
  useEscapeToClose(handleEscape);

  return (
    <div
      role="dialog"
      aria-label="Noise model library"
      style={{
        position: 'fixed', inset: 0, zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.5)', fontFamily: TYPOGRAPHY.fontSans,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 720, maxWidth: '92vw', height: 520, maxHeight: '88vh', display: 'flex', flexDirection: 'column',
          background: colors.bg, border: `1px solid ${colors.borderStrong}`, borderRadius: 'var(--radius-round)', overflow: 'hidden',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', padding: '8px 16px', borderBottom: `1px solid ${colors.border}` }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>Noise models</span>
          <div style={{ flex: 1 }} />
          <IconButton aria-label="Close" onClick={onClose}>
            <X size={ICON_SIZE.md} strokeWidth={ICON_STROKE} />
          </IconButton>
        </div>

        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {/* List */}
          <div style={{ width: 220, borderRight: `1px solid ${colors.border}`, overflow: 'auto', flexShrink: 0 }}>
            <ListGroup label="Built-in" colors={colors}>
              {BUILT_IN_NOISE_MODELS.map((m) => (
                <ModelRow key={m.name} model={m} active={m.name === selectedName} compareActive={m.name === compareName} onSelect={() => setSelectedName(m.name)} />
              ))}
            </ListGroup>
            <ListGroup label={`Project (${projectModels.length})`} colors={colors}>
              {projectModels.length === 0 && (
                <div style={{ padding: '8px 12px', fontSize: 11, color: colors.textDim }}>
                  None yet. Duplicate a model to create <code>noise/…noise.yaml</code>.
                </div>
              )}
              {projectModels.map((m) => (
                <ModelRow key={m.name} model={m} active={m.name === selectedName} compareActive={m.name === compareName} onSelect={() => setSelectedName(m.name)} />
              ))}
              {errors.map((e) => (
                <div key={e.fileName} role="alert" style={{ padding: '8px 12px', fontSize: 11, color: colors.error }}>
                  {e.fileName}: {e.errors[0]}
                </div>
              ))}
            </ListGroup>
          </div>

          {/* Detail */}
          <div style={{ flex: 1, overflow: 'auto', padding: 16, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>{selected.name}</span>
              <span style={{
                fontSize: 11, padding: '1px 8px', borderRadius: 'var(--radius-pill)',
                background: colors.bgElevated, border: `1px solid ${colors.border}`, color: colors.textMuted,
              }}>
                {selected.builtin ? 'built-in' : 'project'}
              </span>
              <div style={{ flex: 1 }} />
              <Button size="sm" onClick={() => { setDupName(`${selected.name}-copy`); setDupOpen(true); setDupError(null); }} icon={<Copy size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} />}>
                Duplicate to edit
              </Button>
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
              <Table label="Generator arguments" dense>
                <Thead>
                  <Tr><Th plain>argument</Th><Th numeric plain>coefficient</Th></Tr>
                </Thead>
                <Tbody>
                  {GENERATOR_ARG_NAMES.map((arg) => (
                    <Tr key={arg}>
                      <Td muted>{arg}</Td>
                      <Td numeric>{selected.generator_args?.[arg] ?? '—'}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}

            <SectionLabel colors={colors}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <GitCompare size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} /> Compare with
              </span>
            </SectionLabel>
            <Select size="sm" aria-label="Compare with" value={compareName ?? ''} onChange={(e) => setCompareName(e.target.value || null)}>
              <option value="">— none —</option>
              {all.filter((m) => m.name !== selected.name).map((m) => (
                <option key={m.name} value={m.name}>{m.name}</option>
              ))}
            </Select>
            {compare && (
              diff.length === 0 ? (
                <div style={{ fontSize: 12, color: colors.textDim, marginTop: 8 }}>
                  Identical generator arguments.
                </div>
              ) : (
                <div style={{ marginTop: 8 }}>
                  <Table label="Generator argument differences" dense>
                    <Thead>
                      <Tr>
                        <Th plain>channel</Th>
                        <Th numeric plain>{selected.name}</Th>
                        <Th numeric plain>{compare.name}</Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {diff.map((d) => (
                        <Tr key={d.arg}>
                          <Td muted>{d.arg}</Td>
                          <Td numeric>{d.a ?? '—'}</Td>
                          <Td numeric>{d.b ?? '—'}</Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                </div>
              )
            )}

            <SectionLabel colors={colors}>YAML</SectionLabel>
            <pre style={{ margin: 0, padding: 12, borderRadius: 'var(--radius-soft)', border: `1px solid ${colors.border}`, background: colors.bgPanel, color: colors.textMuted, fontFamily: TYPOGRAPHY.fontMono, fontSize: 11, overflow: 'auto' }}>
              {noiseModelToYaml(selected)}
            </pre>
          </div>
        </div>

        {dupOpen && (
          <div style={{ padding: '8px 16px', borderTop: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
            <label htmlFor="noise-copy-name" style={{ fontSize: 12, color: colors.textMuted }}>Copy name</label>
            <TextInput
              id="noise-copy-name"
              mono
              value={dupName}
              onChange={(e) => setDupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && dupName.trim()) {
                  e.preventDefault();
                  void doDuplicate();
                }
              }}
              autoFocus
              style={{ flex: 1 }}
            />
            {dupError && <span style={{ color: colors.error, fontSize: 11 }}>{dupError}</span>}
            <Button variant="ghost" onClick={() => setDupOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => { void doDuplicate(); }}>Create</Button>
          </div>
        )}
      </div>
    </div>
  );
}

interface C { bg: string; border: string; text: string; textMuted: string; textDim: string; error: string; }

function ListGroup({ label, children }: { label: string; colors: C; children: React.ReactNode }) {
  return (
    <div>
      <div className="nuclei-overline" style={{ padding: '8px 12px 4px' }}>{label}</div>
      {children}
    </div>
  );
}

function ModelRow({ model, active, compareActive, onSelect }: { model: NoiseModelDef; active: boolean; compareActive: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      className="nuclei-menu-item nuclei-noise-row"
      data-active={active}
      data-compare={compareActive}
      onClick={onSelect}
    >
      {model.name}
    </button>
  );
}

function SectionLabel({ children }: { colors: C; children: React.ReactNode }) {
  return <div className="nuclei-overline" style={{ margin: '16px 0 8px' }}>{children}</div>;
}
