import { useId, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import {
  LabButton,
  LabCallout,
  LabCard,
  LabField,
  LabInput,
  LabNumber,
  LabPill,
  LabSectionLabel,
  LabSegmented,
  LabSelect,
} from '../lab';
import { DISCOVERY_TEMPLATES, slugifyName, type DiscoveryTemplate } from '../../services/discovery/templates';
import { FRONTIER_HONESTY, FRONTIER_QUESTION, RED_QUEEN_EXPLAINER } from '../../services/discovery/honesty';
import { findEvaluator, isEvaluatorAvailable } from '../../services/discovery/availability';
import { DEFAULT_RED_QUEEN } from '../../services/discovery/redQueen';
import { useDiscoveryStore } from '../../stores/discoveryStore';
import { AUDIT_EVERY_MODES, MODEL_TIERS, type AuditEvery, type DiscoveryEvaluatorInfo, type ModelTier, type MutatorKind } from '../../types/discovery';
import { EvaluatorUnavailable } from './EvaluatorUnavailable';

const AUDIT_EVERY_LABEL: Record<AuditEvery, string> = {
  improvement: 'Every improvement (new best or new cell)',
  all: 'Every scored candidate',
  top_k: 'Top k by evaluator fitness',
};

/** Example names per template, shown as the Name placeholder. */
const NAME_PLACEHOLDER: Record<string, string> = {
  'qec-repetition-schedule': 'rep-code-fewer-rounds',
  'w-state-synthesis': 'w-state-fewer-cx',
  'tfim-ansatz': 'tfim-shallow-ansatz',
  'trainability-frontier': 'frontier-counterexample-hunt',
};

const MUTATOR_SUBTITLE: Record<MutatorKind, string> = {
  hybrid: 'Many cheap broad edits plus a few deep ones, AlphaEvolve style.',
  llm: 'Every proposal comes from the LLM: many cheap broad edits plus a few deep ones.',
  ast: 'Random structural edits to the program. No LLM calls and no API key needed.',
  red_queen: 'An adversary hunts for programs the evaluator over-scores, and an independent audit checks each one.',
};

const DEFAULTS = {
  evaluations: 200,
  llmCalls: 160,
  wallMinutes: 90,
  concurrency: 3,
  kind: 'hybrid' as MutatorKind,
  breadth: 'haiku' as ModelTier,
  depth: 'opus' as ModelTier,
  depthSharePct: 20,
  llmSharePct: 75,
};

function TemplateCard({
  template,
  selected,
  onSelect,
  unavailable,
}: {
  template: DiscoveryTemplate;
  selected: boolean;
  onSelect: () => void;
  /** The kernel's entry for this template's evaluator when its optional packages are missing. */
  unavailable?: DiscoveryEvaluatorInfo;
}) {
  const frontier = template.id === 'trainability-frontier';
  return (
    <div style={{ display: 'grid', gap: 'var(--space-2)', alignContent: 'start' }}>
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className="lab-card"
      style={{
        textAlign: 'left', cursor: 'pointer', padding: 'var(--space-3) var(--space-4)', display: 'grid', gap: 'var(--space-2)', alignContent: 'start',
        font: 'inherit', color: 'inherit',
        borderColor: selected ? 'var(--color-accent-quantum)' : undefined,
        boxShadow: selected ? '0 0 0 3px var(--lab-quantum-soft)' : undefined,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 13 }}>{template.title}</strong>
        {frontier && <LabPill tone="dirac" icon={FlaskConical}>Research instrument</LabPill>}
      </span>
      <span className="lab-muted" style={{ fontSize: 12, lineHeight: 1.5 }}>{template.summary}</span>
      {frontier && (
        <span style={{ display: 'grid', gap: 4, fontSize: 11.5, lineHeight: 1.5 }}>
          <span>Open question: <em>{FRONTIER_QUESTION}</em></span>
          <span className="lab-muted">{FRONTIER_HONESTY}</span>
        </span>
      )}
    </button>
    {unavailable && (
      <div style={{ padding: '0 var(--space-4)' }}>
        <EvaluatorUnavailable info={unavailable} />
      </div>
    )}
    </div>
  );
}

/** Wizard that scaffolds a `*.discovery.yaml` and its seed program from a template. */
export function NewDiscoveryWizard() {
  const createFromTemplate = useDiscoveryStore((s) => s.createFromTemplate);
  const closeWizard = useDiscoveryStore((s) => s.closeWizard);
  const evaluators = useDiscoveryStore((s) => s.evaluators);
  const [templateId, setTemplateId] = useState(DISCOVERY_TEMPLATES[0].id as string);
  const [name, setName] = useState('');
  const [evaluations, setEvaluations] = useState(DEFAULTS.evaluations);
  const [llmCalls, setLlmCalls] = useState(DEFAULTS.llmCalls);
  const [wallMinutes, setWallMinutes] = useState(DEFAULTS.wallMinutes);
  const [concurrency, setConcurrency] = useState(DEFAULTS.concurrency);
  const [kind, setKind] = useState<MutatorKind>(DEFAULTS.kind);
  const [llmSharePct, setLlmSharePct] = useState(DEFAULTS.llmSharePct);
  const [breadth, setBreadth] = useState<ModelTier>(DEFAULTS.breadth);
  const [depth, setDepth] = useState<ModelTier>(DEFAULTS.depth);
  const [depthSharePct, setDepthSharePct] = useState(DEFAULTS.depthSharePct);
  const [thinking, setThinking] = useState(true);
  const [batchMode, setBatchMode] = useState(false);
  const [auditEvery, setAuditEvery] = useState<AuditEvery>(DEFAULT_RED_QUEEN.audit_every);
  const [topK, setTopK] = useState(DEFAULT_RED_QUEEN.top_k);
  const [maxAudits, setMaxAudits] = useState(DEFAULT_RED_QUEEN.max_audits);
  const [submitting, setSubmitting] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameId = useId();

  const slug = slugifyName(name);
  const nameError = attempted && !slug ? 'Give the discovery a name using letters or numbers.' : null;
  const usesLlm = kind !== 'ast';

  const submit = async () => {
    setAttempted(true);
    if (!slug || submitting) return;
    setSubmitting(true);
    setError(null);
    const result = await createFromTemplate(
      templateId,
      name,
      { max_evaluations: evaluations, max_llm_calls: usesLlm ? llmCalls : 0, max_wall_minutes: wallMinutes, max_concurrent_evaluations: concurrency },
      {
        kind, llm_share: llmSharePct / 100, breadth, depth, depth_share: depthSharePct / 100, depth_thinking: thinking, batch_mode: batchMode,
        ...(kind === 'red_queen' ? { red_queen: { audit_every: auditEvery, top_k: topK, max_audits: maxAudits } } : {}),
      },
    );
    setSubmitting(false);
    if (!result.ok) setError(result.error);
  };

  return (
    <form
      aria-label="New discovery"
      className="lab-stack"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onKeyDown={(e) => {
        // Number fields commit on Enter; do not also submit the form on stale values.
        if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.inputMode === 'numeric') e.preventDefault();
      }}
    >
      <section aria-label="Template" className="lab-stack">
        <LabSectionLabel>1 · Choose a template</LabSectionLabel>
        <div role="radiogroup" aria-label="Discovery template" className="lab-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', alignItems: 'start' }}>
          {DISCOVERY_TEMPLATES.map((t) => {
            const info = findEvaluator(evaluators, t.evaluatorKind);
            return (
              <TemplateCard
                key={t.id}
                template={t}
                selected={t.id === templateId}
                onSelect={() => setTemplateId(t.id)}
                unavailable={info && !isEvaluatorAvailable(info) ? info : undefined}
              />
            );
          })}
        </div>
      </section>

      <LabCard title="2 · Name and budgets" subtitle="Budgets are written into the file, so the file always says what ran.">
        <div className="lab-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
          <LabField label="Name" htmlFor={nameId} error={nameError} hint={slug ? `Writes experiments/${slug}.discovery.yaml` : undefined}>
            <LabInput id={nameId} value={name} placeholder={NAME_PLACEHOLDER[templateId] ?? templateId} aria-invalid={!!nameError} onChange={(e) => setName(e.target.value)} />
          </LabField>
          <LabField label="Max evaluations" htmlFor="wiz-evals" hint="1 to 5000; each screen and each full run counts">
            <LabNumber id="wiz-evals" value={evaluations} min={1} max={5000} onCommit={setEvaluations} width="100%" />
          </LabField>
          <LabField label="Max LLM calls" htmlFor="wiz-llm" hint="0 to 5000">
            <LabNumber id="wiz-llm" value={usesLlm ? llmCalls : 0} min={0} max={5000} disabled={!usesLlm} onCommit={setLlmCalls} width="100%" />
          </LabField>
          <LabField label="Max wall time (minutes)" htmlFor="wiz-wall" hint="1 to 1440">
            <LabNumber id="wiz-wall" value={wallMinutes} min={1} max={1440} onCommit={setWallMinutes} width="100%" />
          </LabField>
          <LabField label="Concurrent evaluations" htmlFor="wiz-conc" hint="1 to 8">
            <LabNumber id="wiz-conc" value={concurrency} min={1} max={8} onCommit={setConcurrency} width="100%" />
          </LabField>
        </div>
      </LabCard>

      <LabCard title="3 · Mutator" subtitle={MUTATOR_SUBTITLE[kind]}>
        <div className="lab-stack">
          <LabSegmented
            label="Mutator kind"
            value={kind}
            onChange={setKind}
            items={[
              { id: 'hybrid', label: 'Hybrid' },
              { id: 'llm', label: 'LLM only' },
              { id: 'ast', label: 'AST only (no API key)' },
              { id: 'red_queen', label: 'Red Queen (audit the evaluator)' },
            ]}
          />
          {kind === 'red_queen' && (
            <div className="lab-stack" data-testid="red-queen-options">
              <LabCallout tone="warning" title="Red Queen mode">{RED_QUEEN_EXPLAINER}</LabCallout>
              <div className="lab-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
                <LabField label="Audit when" htmlFor="wiz-audit-every">
                  <LabSelect id="wiz-audit-every" value={auditEvery} onChange={(e) => setAuditEvery(e.target.value as AuditEvery)}>
                    {AUDIT_EVERY_MODES.map((m) => <option key={m} value={m}>{AUDIT_EVERY_LABEL[m]}</option>)}
                  </LabSelect>
                </LabField>
                <LabField label="Top k" htmlFor="wiz-top-k" hint="Used when auditing the top k">
                  <LabNumber id="wiz-top-k" value={topK} min={1} max={100} disabled={auditEvery !== 'top_k'} onCommit={setTopK} width="100%" />
                </LabField>
                <LabField label="Max audits" htmlFor="wiz-max-audits" hint="1 to 5000">
                  <LabNumber id="wiz-max-audits" value={maxAudits} min={1} max={5000} onCommit={setMaxAudits} width="100%" />
                </LabField>
              </div>
            </div>
          )}
          <div className="lab-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
            <LabField label="Breadth model" htmlFor="wiz-breadth">
              <LabSelect id="wiz-breadth" value={breadth} disabled={!usesLlm} onChange={(e) => setBreadth(e.target.value as ModelTier)}>
                {MODEL_TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
              </LabSelect>
            </LabField>
            <LabField label="Depth model" htmlFor="wiz-depth">
              <LabSelect id="wiz-depth" value={depth} disabled={!usesLlm} onChange={(e) => setDepth(e.target.value as ModelTier)}>
                {MODEL_TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
              </LabSelect>
            </LabField>
            <LabField label="Depth share (%)" htmlFor="wiz-depth-share" hint="Of LLM proposals">
              <LabNumber id="wiz-depth-share" value={depthSharePct} min={0} max={100} disabled={!usesLlm} onCommit={setDepthSharePct} width="100%" />
            </LabField>
            <LabField label="LLM share (%)" htmlFor="wiz-llm-share" hint="Hybrid only">
              <LabNumber id="wiz-llm-share" value={llmSharePct} min={0} max={100} disabled={kind !== 'hybrid'} onCommit={setLlmSharePct} width="100%" />
            </LabField>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-5)', flexWrap: 'wrap' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 28 }}>
              <input type="checkbox" checked={thinking} disabled={!usesLlm} onChange={(e) => setThinking(e.target.checked)} />
              Extended thinking on depth calls
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 28 }}>
              <input type="checkbox" checked={batchMode} disabled={!usesLlm} onChange={(e) => setBatchMode(e.target.checked)} />
              Batch mode (async, cheaper, for unattended runs)
            </label>
          </div>
        </div>
      </LabCard>

      {error && <LabCallout tone="danger" title="Could not create the discovery">{error}</LabCallout>}

      <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
        <LabButton variant="ghost" size="md" onClick={closeWizard}>Cancel</LabButton>
        <LabButton variant="primary" size="md" type="submit" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create discovery'}
        </LabButton>
      </div>
    </form>
  );
}
