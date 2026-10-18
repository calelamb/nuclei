import { Check, Copy, LoaderCircle } from 'lucide-react';
import type { ReactElement } from 'react';

import type { QecImportClient } from '../../../services/qecDataClient';
import type { QecJobRecord } from '../../../stores/qecJobStore';
import { ICON_SIZE, ICON_STROKE } from '../../../styles/tokens';
import { Button, IconButton } from '../../ui';
import { formatByteSize, shortHash } from './formatBytes';
import { useCopied } from './useCopied';

/** Job ids are UUIDs; eight characters tell jobs apart and the full id stays in the tooltip and copy. */
const SHORT_ID_LENGTH = 8;
const ACTIVE_STATUSES: ReadonlySet<string> = new Set(['running', 'starting']);

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function Field({ label, children }: { label: string; children: ReactElement | string }): ReactElement {
  return <div><dt>{label}</dt><dd className="qec-mono">{children}</dd></div>;
}

function CopyIcon({ copied }: { copied: boolean }): ReactElement {
  return copied
    ? <Check aria-hidden="true" size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} />
    : <Copy aria-hidden="true" size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} />;
}

function HashField({ hash }: { hash: string | null | undefined }): ReactElement {
  const { copied, copy } = useCopied(hash ?? '');
  if (!hash) return <Field label="Hash">Pending</Field>;
  return (
    <div>
      <dt>Hash</dt>
      <dd className="qec-mono qec-tray__hash">
        <span>{shortHash(hash)}</span>
        <IconButton size="sm" aria-label="Copy source hash" tooltip={{ label: copied ? 'Copied' : 'Copy full hash' }} onClick={copy}>
          <CopyIcon copied={copied} />
        </IconButton>
      </dd>
    </div>
  );
}

function CopyJobId({ id }: { id: string }): ReactElement {
  const { copied, copy } = useCopied(id);
  const short = id.slice(0, SHORT_ID_LENGTH);
  return (
    <>
      <span className="qec-mono" title={id}>{short}</span>
      <IconButton size="sm" aria-label={`Copy job id ${short}`} tooltip={{ label: copied ? 'Copied' : 'Copy full job id' }} onClick={copy}>
        <CopyIcon copied={copied} />
      </IconButton>
    </>
  );
}

interface QecTrayJobCardProps {
  job: QecJobRecord;
  client: QecImportClient | null;
  onCancel(jobId: string): void;
}

/** One durable job: a header row (what it is, its short id, Cancel while it runs), then its provenance fields. */
export function QecTrayJobCard({ job, client, onCancel }: QecTrayJobCardProps): ReactElement {
  const active = ACTIVE_STATUSES.has(job.status);
  return (
    <li>
      <div className="qec-tray__job-head">
        {active && <LoaderCircle className="nuclei-spin" aria-hidden="true" size={ICON_SIZE.sm} />}
        <strong>{capitalise(job.kind)} · {job.status}</strong>
        <CopyJobId id={job.id} />
        {client && active && (
          <Button size="sm" aria-label={`Cancel ${job.kind} ${job.id}`} onClick={() => onCancel(job.id)}>Cancel</Button>
        )}
      </div>
      <dl>
        <Field label="Source">{job.source ?? 'Not recorded'}</Field>
        <Field label="Adapter">{job.adapterId ?? 'Not recorded'}</Field>
        <Field label="Session">{job.sessionId ?? 'Not recorded'}</Field>
        <Field label="Size">{job.sourceByteSize == null ? 'Pending' : formatByteSize(job.sourceByteSize)}</Field>
        <HashField hash={job.sourceHash} />
        <Field label="Provenance">{job.provenanceId ?? 'Pending'}</Field>
      </dl>
    </li>
  );
}
