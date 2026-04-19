import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
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

interface BackendSelectorProps {
  backends: BackendInfo[];
  selected: string | null;
  onSelect: (name: string) => void;
}

export function BackendSelector({ backends, selected, onSelect }: BackendSelectorProps) {
  const colors = useThemeStore((s) => s.colors);
  const [open, setOpen] = useState(false);

  const selectedBackend = backends.find((b) => b.name === selected);

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '7px 10px',
          background: colors.bgElevated,
          border: `1px solid ${open ? colors.accent : colors.border}`,
          borderRadius: 4,
          color: selectedBackend ? colors.text : colors.textDim,
          fontSize: 11,
          fontFamily: "'Geist Sans', sans-serif",
          cursor: 'pointer',
          outline: 'none',
        }}
      >
        <span>{selectedBackend ? selectedBackend.name : 'Select backend...'}</span>
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            background: colors.bgElevated,
            border: `1px solid ${colors.border}`,
            borderRadius: 4,
            zIndex: 20,
            maxHeight: 240,
            overflowY: 'auto',
          }}
        >
          {backends.length === 0 ? (
            <div
              style={{
                padding: '12px 10px',
                fontSize: 11,
                color: colors.textDim,
                fontFamily: "'Geist Sans', sans-serif",
                textAlign: 'center',
              }}
            >
              No backends available
            </div>
          ) : (
            backends.map((b) => {
              const isSelected = b.name === selected;
              const statusColor =
                b.status === 'online'
                  ? colors.success
                  : b.status === 'maintenance'
                    ? colors.warning
                    : colors.error;

              return (
                <button
                  key={b.name}
                  onClick={() => {
                    onSelect(b.name);
                    setOpen(false);
                  }}
                  style={{
                    width: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    padding: '8px 10px',
                    background: isSelected ? `${colors.accent}12` : 'transparent',
                    border: 'none',
                    borderLeft: isSelected
                      ? `2px solid ${colors.accent}`
                      : '2px solid transparent',
                    cursor: 'pointer',
                    textAlign: 'left',
                    borderBottom: `1px solid ${colors.border}`,
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.background = `${colors.accent}08`;
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
                    <div
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: statusColor,
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        fontSize: 11,
                        color: colors.text,
                        fontFamily: "'Geist Sans', sans-serif",
                        flex: 1,
                      }}
                    >
                      {b.name}
                    </span>
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                        padding: '1px 5px',
                        borderRadius: 3,
                        background: `${colors.accent}18`,
                        color: colors.accent,
                        fontFamily: "'Geist Sans', sans-serif",
                      }}
                    >
                      {PROVIDER_LABELS[b.provider]}
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      gap: 10,
                      fontSize: 10,
                      color: colors.textDim,
                      fontFamily: "'Geist Sans', sans-serif",
                      paddingLeft: 12,
                    }}
                  >
                    <span>{b.qubitCount} qubits</span>
                    <span>Queue: {b.queueLength}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
