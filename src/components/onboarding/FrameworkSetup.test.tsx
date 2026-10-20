// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const status = {
  venv_path: null, venv_exists: false, python_version: '3.12', system_python_path: '/usr/bin/python3', installed: [],
  catalog: [
    { id: 'qiskit', label: 'Qiskit', description: 'IBM framework', group: 'core', recommended: true, approximate_size_mb: 120 },
    { id: 'cirq', label: 'Cirq', description: 'Google framework', group: 'core', recommended: false, approximate_size_mb: 60 },
  ],
};

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => status) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

import { FrameworkSetup } from './FrameworkSetup';

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('FrameworkSetup rows', () => {
  it('uses the themed Checkbox instead of a raw native input, and still toggles', async () => {
    const { container } = render(<FrameworkSetup open onClose={() => {}} />);
    const cirq = await waitFor(() => screen.getByRole('checkbox', { name: 'Cirq' }));
    expect(cirq.closest('label')?.classList.contains('nuclei-checkbox')).toBe(true);
    expect(container.ownerDocument.querySelectorAll('label label')).toHaveLength(0);
    expect((cirq as HTMLInputElement).checked).toBe(false);
    fireEvent.click(cirq);
    expect((screen.getByRole('checkbox', { name: 'Cirq' }) as HTMLInputElement).checked).toBe(true);
  });
});
