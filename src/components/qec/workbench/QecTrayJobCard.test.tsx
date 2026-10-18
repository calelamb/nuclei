// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { QecTrayJobCard } from './QecTrayJobCard';
import type { QecJobRecord } from '../../../stores/qecJobStore';

afterEach(() => cleanup());

const HASH = '6f45baf5e9f4215ebabc0e5177c34abe7e2fd5489d2531e70a098924d824dfbc';
const JOB: QecJobRecord = {
  id: '0b6c1f3e-aaaa-bbbb-cccc-1234567890ab', kind: 'import', status: 'complete', message: 'done',
  source: 'circuits/repetition.stim', adapterId: 'stim-results', sessionId: 'minimal-capture',
  sourceByteSize: 8701, sourceHash: HASH, provenanceId: 'prov-1',
};

describe('QecTrayJobCard (rq-r3-01)', () => {
  it('puts the title row above the fields instead of beside them', () => {
    const { container } = render(<ul><QecTrayJobCard job={JOB} client={null} onCancel={() => undefined} /></ul>);
    const li = container.querySelector('li') as HTMLElement;
    expect(li.firstElementChild?.tagName).toBe('DIV');
    expect(li.querySelector('dl')).not.toBeNull();
    // The stylesheet must keep the card a single column so the title cannot collapse next to the fields.
    const css = readFileSync('src/components/qec/import/qecImportWizard.css', 'utf8');
    expect(css).toMatch(/\.qec-tray__jobs > li \{[^}]*grid-template-columns: minmax\(0, 1fr\);/);
  });

  it('writes the kind and status in plain words', () => {
    render(<ul><QecTrayJobCard job={JOB} client={null} onCancel={() => undefined} /></ul>);
    expect(screen.getByText('Import · complete')).toBeTruthy();
  });

  it('shows a human size and a short hash with a copy control', () => {
    render(<ul><QecTrayJobCard job={JOB} client={null} onCancel={() => undefined} /></ul>);
    expect(screen.getByText('8.5 KB')).toBeTruthy();
    expect(screen.queryByText('8701')).toBeNull();
    expect(screen.getByText(HASH.slice(0, 12))).toBeTruthy();
    expect(screen.queryByText(HASH)).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy source hash' })).toBeTruthy();
  });

  it('says Pending until size and hash are known', () => {
    render(<ul><QecTrayJobCard job={{ ...JOB, sourceByteSize: null, sourceHash: null }} client={null} onCancel={() => undefined} /></ul>);
    expect(screen.getAllByText('Pending').length).toBeGreaterThanOrEqual(2);
  });
});
