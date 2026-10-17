// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Table, Thead, Tbody, Tr, Th, Td } from './Table';

afterEach(cleanup);

function Sample({ dense }: { dense?: boolean }) {
  return (
    <Table label="Results" dense={dense}>
      <Thead>
        <Tr><Th>Name</Th><Th numeric>Rate</Th></Tr>
      </Thead>
      <Tbody>
        <Tr><Td>pymatching</Td><Td numeric>3.20e-3</Td></Tr>
      </Tbody>
    </Table>
  );
}

describe('Table', () => {
  it('renders a labelled table inside a scroll region', () => {
    render(<Sample />);
    const table = screen.getByRole('table', { name: 'Results' });
    expect(table.className).toContain('nuclei-table');
    expect(table.parentElement?.className).toContain('nuclei-table-scroll');
  });

  it('names the scroll region and is a tab stop only while it overflows', () => {
    const widths = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(900);
    const client = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
    const { unmount } = render(<Sample />);
    const overflowing = screen.getByRole('region', { name: 'Results' });
    expect(overflowing.getAttribute('tabindex')).toBe('0');
    unmount();
    widths.mockReturnValue(300);
    render(<Sample />);
    expect(screen.getByRole('region', { name: 'Results' }).getAttribute('tabindex')).toBe('-1');
    widths.mockRestore();
    client.mockRestore();
  });

  it('right-aligns numeric headers and cells via a class', () => {
    render(<Sample />);
    expect(screen.getByRole('columnheader', { name: 'Rate' }).className).toContain('nuclei-table__num');
    expect(screen.getByRole('cell', { name: '3.20e-3' }).className).toContain('nuclei-table__num');
    expect(screen.getByRole('columnheader', { name: 'Name' }).className).not.toContain('nuclei-table__num');
  });

  it('scopes column headers', () => {
    render(<Sample />);
    expect(screen.getByRole('columnheader', { name: 'Name' }).getAttribute('scope')).toBe('col');
  });

  it('supports a dense variant', () => {
    render(<Sample dense />);
    expect(screen.getByRole('table').className).toContain('nuclei-table--dense');
  });
});
