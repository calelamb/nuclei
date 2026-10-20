// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { act } from 'react';
import golden from '../../types/__fixtures__/sinter_golden.json';
import { QecAnalysisView } from './QecAnalysisView';
import { useQecCampaignStore } from '../../stores/qecCampaignStore';

vi.mock('../../platform/buildTarget', () => ({ isWebBuild: () => true }));
vi.mock('../../services/experimentExport', () => ({ downloadCsv: vi.fn(), downloadSvg: vi.fn() }));

function csvFile(text: string): File {
  const f = new File([text], 'stats.csv', { type: 'text/csv' });
  if (typeof f.text !== 'function') Object.defineProperty(f, 'text', { value: async () => text });
  return f;
}

beforeEach(() => { useQecCampaignStore.getState().reset(); });
afterEach(() => cleanup());

describe('focus after loading a CSV from the empty state (interaction-r-04)', () => {
  it('lands on the header Open CSV button, not <body>, when the drop zone unmounts', async () => {
    const { getByRole, getByLabelText } = render(<QecAnalysisView />);
    const choose = getByRole('button', { name: 'Choose file…' });
    choose.focus();
    const input = getByLabelText('Choose sinter stats CSV') as HTMLInputElement;
    await act(async () => { fireEvent.change(input, { target: { files: [csvFile(golden.cases[0].csv)] } }); });
    await waitFor(() => expect(document.querySelector('[data-testid="csv-drop-zone"]')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(getByRole('button', { name: 'Open CSV' })));
  });

  it('keeps focus where it is after a bad CSV', async () => {
    const { getByRole, getByLabelText } = render(<QecAnalysisView />);
    const choose = getByRole('button', { name: 'Choose file…' });
    choose.focus();
    const input = getByLabelText('Choose sinter stats CSV') as HTMLInputElement;
    await act(async () => { fireEvent.change(input, { target: { files: [csvFile('a,b\n1,2')] } }); });
    expect(document.activeElement).toBe(choose);
  });
});
