import { useId } from 'react';
import { ChevronDown } from 'lucide-react';
import { Menu, type MenuEntry } from '../ui/Menu';
import { ICON_SIZE, ICON_STROKE } from '../../styles/tokens';
import type { BackendInfo, HardwareProviderType } from '../../types/hardware';

const PROVIDER_LABELS: Record<HardwareProviderType, string> = {
  ibm: 'IBM',
  google: 'Google',
  ionq: 'IonQ',
  nvidia: 'NVIDIA',
  braket: 'Braket',
  azure: 'Azure',
  quantinuum: 'Quantinuum',
  xanadu: 'Xanadu',
  dwave: 'D-Wave',
  simulator: 'Sim',
};

const STATUS_DOT_COLOR: Record<BackendInfo['status'], string> = {
  online: 'var(--color-success)',
  maintenance: 'var(--color-warning)',
  offline: 'var(--color-danger)',
};

const MENU_MIN_WIDTH = 300;

interface BackendSelectorProps {
  backends: BackendInfo[];
  selected: string | null;
  onSelect: (name: string) => void;
  /** Id of the visible label element; names the trigger together with its value. */
  labelledBy?: string;
}

function entryFor(b: BackendInfo): MenuEntry {
  return {
    id: b.name,
    label: `${b.name} · ${PROVIDER_LABELS[b.provider]}`,
    icon: <span aria-hidden="true" style={{ display: 'block', width: 6, height: 6, borderRadius: '50%', background: STATUS_DOT_COLOR[b.status] }} />,
    hint: `${b.qubitCount} qubits · queue ${b.queueLength}`,
    title: `${b.name}: ${b.status}`,
  };
}

/** Backend picker on the shared Menu: aria-haspopup/expanded, arrow keys, and Escape closes only the menu. */
export function BackendSelector({ backends, selected, onSelect, labelledBy }: BackendSelectorProps) {
  const valueId = useId();
  const current = backends.find((b) => b.name === selected);

  const entries: MenuEntry[] = backends.length === 0
    ? [{ id: 'none', label: 'No backends available', disabled: true }]
    : backends.map((b) => ({ ...entryFor(b), checked: b.name === selected, onSelect: () => onSelect(b.name) }));

  return (
    <Menu
      label="Backend"
      entries={entries}
      minWidth={MENU_MIN_WIDTH}
      trigger={(p) => (
        <button
          {...p}
          aria-labelledby={labelledBy ? `${labelledBy} ${valueId}` : undefined}
          aria-label={labelledBy ? undefined : 'Backend'}
          className="nuclei-select-trigger"
          data-placeholder={current ? undefined : 'true'}
        >
          <span id={valueId} className="nuclei-select-trigger__value">{current ? current.name : 'Select backend…'}</span>
          <ChevronDown className="nuclei-select-trigger__chevron" size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} aria-hidden="true" />
        </button>
      )}
    />
  );
}
