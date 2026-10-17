// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { ConceptSummary } from './ConceptSummary';
import { CONCEPT_GRAPH } from '../../data/conceptMap';
import { useStudentStore } from '../../stores/studentStore';

afterEach(cleanup);

describe('ConceptSummary', () => {
  it('lists every category with mastered/total counts instead of a scaled graph', () => {
    const basics = CONCEPT_GRAPH.nodes.filter((n) => n.category === 'basics');
    useStudentStore.setState((s) => ({ model: { ...s.model, conceptsMastered: [basics[0].id], conceptsStruggling: [] } }));
    render(<ConceptSummary />);
    expect(document.querySelector('svg')).toBeNull();
    const bar = screen.getByRole('progressbar', { name: 'Basics concepts mastered' });
    expect(bar.getAttribute('aria-valuenow')).toBe('1');
    expect(bar.getAttribute('aria-valuemax')).toBe(String(basics.length));
    expect(screen.getAllByRole('progressbar')).toHaveLength(6);
  });
});
