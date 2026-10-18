import { Check, Copy } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import type { QecImportClient } from '../../../services/qecDataClient';
import type { QecJobRecord } from '../../../stores/qecJobStore';
import { ICON_SIZE, ICON_STROKE } from '../../../styles/tokens';
import { Button, IconButton } from '../../ui';
import { formatByteSize, shortHash } from './formatBytes';

const COPIED_RESET_MS = 1500;
const ACTIVE_STATUSES: ReadonlySet<string> = new Set(['running', 'starting']);

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function Field({ label, children }: { label: string; children: ReactElement | string }): ReactElement {
  return <div><dt>{label}</dt><dd className="qec-mono">{children}</dd></div>;
}

function HashField({ hash }: { hash: string | null | undefined }): ReactElement {
  const [copied, setCopied] = useState(false);
  if (!hash) return <Field label="Hash">Pending</Field>;
  const copy = (): void => {
    void navigator.clipboard?.writeText(hash).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), COPIED_RESET_MS);
      },
      () => setCopied(false),
    );
  };
  return (
    <div>
      <dt>Hash</dt>
      <dd className="qec-mono qec-tray__hash">
        <span>{shortHash(hash)}</span>
        <IconButton size="sm" aria-label="Copy source hash" tooltip={{ label: copied ? 'Copied' : 'Copy full hash' }} onClick={copy}>
          {copied
            ? <Check aria-hidden="true" size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} />
            : <Copy aria-hidden="true" size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} />}
        </IconButton>
      </dd>
    </div>
  );
}

interface QecTrayJobCardProps {
  job: QecJobRecord;
  client: QecImportClient | null;
  onCancel(jobId: string): void;
}

/** One durable job: a title row (what it is and how it ended), then its provenance fields in a grid. */
export function QecTrayJobCard({ job, client, onCancel }: QecTrayJobCardProps): ReactElement {
  return (
    <li>
      <div>
        <strong>{capitalise(job.kind)} · {job.status}</strong>
        <span className="qec-mono">{job.id}</span>
      </div>
      <dl>
        <Field label="Source">{job.source ?? 'Not recorded'}</Field>
        <Field label="Adapter">{job.adapterId ?? 'Not recorded'}</Field>
        <Field label="Session">{job.sessionId ?? 'Not recorded'}</Field>
        <Field label="Size">{job.sourceByteSize == null ? 'Pending' : formatByteSize(job.sourceByteSize)}</Field>
        <HashField hash={job.sourceHash} />
        <Field label="Provenance">{job.provenanceId ?? 'Pending'}</Field>
      </dl>
      {client && ACTIVE_STATUSES.has(job.status) && (
        <Button size="sm" aria-label={`Cancel ${job.kind} ${job.id}`} onClick={() => onCancel(job.id)}>Cancel</Button>
      )}
    </li>
  );
}
