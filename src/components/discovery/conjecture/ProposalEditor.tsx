import { useState } from 'react';
import { LabButton, LabField, LabInput, LabNumber, LabSelect } from '../../lab';
import type { SchemaIssue } from '../../../services/conjecture/jsonSchema';
import { CIRCUITS_RANGE, MAX_N_QUBITS, POINTS_RANGE, PREDICATE_OPS, type Conjecture, type ConjectureSchemaInfo, type JsonSchema } from '../../../types/conjecture';

type Props = {
  conjecture: Conjecture;
  schema: ConjectureSchemaInfo;
  onSave: (next: Conjecture) => { ok: boolean; error?: string; issues?: SchemaIssue[] };
  onCancel: () => void;
};

const props = (s: JsonSchema): Record<string, JsonSchema> => (s.properties && typeof s.properties === 'object' ? (s.properties as Record<string, JsonSchema>) : {});

function FamilyField({ name, spec, value, onChange }: { name: string; spec: JsonSchema; value: unknown; onChange: (v: unknown) => void }) {
  const id = `cj-family-${name}`;
  const label = name.replace(/_/g, ' ');
  if (Array.isArray(spec.enum)) {
    return (
      <LabField label={label} htmlFor={id}>
        <LabSelect id={id} value={String(value)} onChange={(e) => onChange((spec.enum as unknown[]).find((o) => String(o) === e.target.value))}>
          {(spec.enum as unknown[]).map((o) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
        </LabSelect>
      </LabField>
    );
  }
  if (spec.type === 'integer' || spec.type === 'number') {
    return (
      <LabField label={label} htmlFor={id}>
        <LabNumber id={id} value={Number(value)} integer={spec.type === 'integer'} min={spec.minimum as number | undefined} max={spec.maximum as number | undefined} onCommit={onChange} />
      </LabField>
    );
  }
  if (spec.type === 'string') {
    return <LabField label={label} htmlFor={id}><LabInput id={id} mono value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} /></LabField>;
  }
  return <LabField label={label}><span className="lab-mono">{JSON.stringify(value)}</span></LabField>;
}

/** Edit a draft; every save is validated against the kernel's schema. */
export function ProposalEditor({ conjecture, schema, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState<Conjecture>(conjecture);
  const [predicateText, setPredicateText] = useState(() => JSON.stringify(conjecture.feature_predicate, null, 2));
  const [problems, setProblems] = useState<SchemaIssue[]>([]);
  const patch = (p: Partial<Conjecture>) => setDraft((d) => ({ ...d, ...p }));
  const familyProps = props(schema.families);

  const save = () => {
    let predicate: unknown;
    try {
      predicate = JSON.parse(predicateText);
    } catch {
      setProblems([{ path: 'feature_predicate', message: 'is not valid JSON' }]);
      return;
    }
    const res = onSave({ ...draft, feature_predicate: predicate as Conjecture['feature_predicate'] });
    setProblems(res.ok ? [] : (res.issues ?? [{ path: 'conjecture', message: res.error ?? 'could not be saved' }]));
  };

  return (
    <form className="lab-stack" aria-label={`Edit ${conjecture.id}`} onSubmit={(e) => { e.preventDefault(); save(); }}>
      <div className="cj-edit">
        <div className="cj-edit__wide">
          <LabField label="Statement" htmlFor="cj-statement">
            <textarea id="cj-statement" className="lab-input" value={draft.statement} onChange={(e) => patch({ statement: e.target.value })} />
          </LabField>
        </div>
        <LabField label="Prediction quantity" htmlFor="cj-quantity">
          <LabSelect id="cj-quantity" value={draft.prediction.quantity} onChange={(e) => patch({ prediction: { ...draft.prediction, quantity: e.target.value } })}>
            {schema.quantities.map((q) => <option key={q.key} value={q.key}>{q.key}</option>)}
          </LabSelect>
        </LabField>
        <div className="lab-row">
          <LabField label="Comparison" htmlFor="cj-op">
            <LabSelect id="cj-op" value={draft.prediction.op} onChange={(e) => patch({ prediction: { ...draft.prediction, op: e.target.value as Conjecture['prediction']['op'] } })}>
              {PREDICATE_OPS.map((op) => <option key={op} value={op}>{op}</option>)}
            </LabSelect>
          </LabField>
          <LabField label="Threshold" htmlFor="cj-value">
            <LabInput id="cj-value" mono value={String(draft.prediction.value)} onChange={(e) => patch({ prediction: { ...draft.prediction, value: e.target.value.trim() !== '' && Number.isFinite(Number(e.target.value)) ? Number(e.target.value) : e.target.value } })} />
          </LabField>
        </div>
        <div className="lab-row">
          <LabField label="n min" htmlFor="cj-nmin"><LabNumber id="cj-nmin" min={2} max={MAX_N_QUBITS} value={draft.n_range[0]} onCommit={(v) => patch({ n_range: [v, draft.n_range[1]] })} /></LabField>
          <LabField label="n max" htmlFor="cj-nmax"><LabNumber id="cj-nmax" min={2} max={MAX_N_QUBITS} value={draft.n_range[1]} onCommit={(v) => patch({ n_range: [draft.n_range[0], v] })} /></LabField>
          <LabField label="Circuits" htmlFor="cj-circuits"><LabNumber id="cj-circuits" min={CIRCUITS_RANGE[0]} max={CIRCUITS_RANGE[1]} value={draft.circuits} onCommit={(v) => patch({ circuits: v })} /></LabField>
          <LabField label="Points" htmlFor="cj-points"><LabNumber id="cj-points" min={POINTS_RANGE[0]} max={POINTS_RANGE[1]} value={draft.points} onCommit={(v) => patch({ points: v })} /></LabField>
        </div>
        {Object.entries(familyProps).filter(([name]) => name !== 'family').map(([name, spec]) => (
          <FamilyField key={name} name={name} spec={spec} value={draft.test_family[name]} onChange={(v) => patch({ test_family: { ...draft.test_family, [name]: v } })} />
        ))}
        <div className="cj-edit__wide">
          <LabField label="Feature predicate (JSON)" hint="{ all: [ ... ] } or { any: [ ... ] } over the kernel features." htmlFor="cj-predicate">
            <textarea id="cj-predicate" className="lab-input lab-input--mono" value={predicateText} onChange={(e) => setPredicateText(e.target.value)} />
          </LabField>
        </div>
      </div>
      {problems.length > 0 && (
        <ul className="cj-issues" role="alert" aria-label="Validation problems">
          {problems.map((p) => <li key={`${p.path}${p.message}`}><code>{p.path}</code> {p.message}</li>)}
        </ul>
      )}
      <div className="cj-actions">
        <LabButton variant="primary" type="submit">Save edits</LabButton>
        <LabButton variant="ghost" onClick={onCancel}>Cancel</LabButton>
      </div>
    </form>
  );
}
