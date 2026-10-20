import { Check, Copy, LoaderCircle } from 'lucide-react';
import type { ReactElement } from 'react';

import type { QecImportClient } from '../../../services/qecDataClient';
import type { QecJobRecord } from '../../../stores/qecJobStore';
import { ICON_SIZE, ICON_STROKE } from '../../../styles/tokens';
import { Button, IconButton } from '../../ui';
import { formatByteSize, shortHash } from './formatBytes';
import { useCopied } from './useCopied';
import { CopyJobId } from './CopyJobId';
import { PathText } from '../PathText';

const ACTIVE_STATUSES: ReadonlySet<string> = new Set(['running', 'starting']);

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function Field({ label, path = false, children }: { label: string; path?: boolean; children: ReactElement | string }): ReactElement {
  return <div><dt>{label}</dt><dd className={path ? 'qec-mono qec-path' : 'qec-mono'}>{children}</dd></div>;
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
        <Field label="Source" path>{job.source ? <PathText path={job.source} /> : 'Not recorded'}</Field>
        <Field label="Adapter">{job.adapterId ?? 'Not recorded'}</Field>
        <Field label="Session">{job.sessionId ?? 'Not recorded'}</Field>
        <Field label="Size">{job.sourceByteSize == null ? 'Pending' : formatByteSize(job.sourceByteSize)}</Field>
        <HashField hash={job.sourceHash} />
        <Field label="Provenance">{job.provenanceId ?? 'Pending'}</Field>
      </dl>
    </li>
  );
}
