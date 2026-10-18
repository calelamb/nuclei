import { Orbit } from 'lucide-react';
import { EmptyState } from '../ui';

export function BlochEmptyState() {
  return (
    <EmptyState className="viz-empty bloch-empty" icon={<Orbit size={20} />} title="No results yet">
      Run a simulation to visualize qubit states.
    </EmptyState>
  );
}
