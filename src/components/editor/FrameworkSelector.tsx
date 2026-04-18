import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import { useThemeStore } from '../../stores/themeStore';
import { usePlatform } from '../../platform/PlatformProvider';
import type { Framework } from '../../types/quantum';

const STARTER_TEMPLATES: Record<Framework, string> = {
  qiskit: `from qiskit import QuantumCircuit\n\n# Create a Bell State\nqc = QuantumCircuit(2, 2)\nqc.h(0)\nqc.cx(0, 1)\nqc.measure([0, 1], [0, 1])\n`,
  cirq: `import cirq\n\n# Create a Bell State\nq0, q1 = cirq.LineQubit.range(2)\ncircuit = cirq.Circuit([\n    cirq.H(q0),\n    cirq.CNOT(q0, q1),\n    cirq.measure(q0, q1, key='result'),\n])\n`,
  'cuda-q': `import cudaq\n\n# Create a Bell State\n@cudaq.kernel\ndef bell():\n    q = cudaq.qvector(2)\n    h(q[0])\n    cx(q[0], q[1])\n    mz(q)\n`,
};

const FRAMEWORKS: Framework[] = ['qiskit', 'cirq', 'cuda-q'];

function displayName(f: Framework): string {
  return f === 'cuda-q' ? 'CUDA-Q' : f.charAt(0).toUpperCase() + f.slice(1);
}

export function FrameworkSelector() {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const framework = useEditorStore((s) => s.framework);
  const setFramework = useEditorStore((s) => s.setFramework);
  const setCode = useEditorStore((s) => s.setCode);
  const isDirty = useEditorStore((s) => s.isDirty);
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);
  const platform = usePlatform();
  const isWeb = platform.getPlatform() === 'web';
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // The dropdown is portaled to document.body so ancestors with
  // `overflow: hidden` (e.g. the tab bar) can't clip it. The menu's
  // position is computed from the button's bounding rect.
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const btn = buttonRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      setMenuPos({ top: r.bottom + 6, left: r.left });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  // In the browser IDE only Cirq can actually run — Qiskit/CUDA-Q require the
  // desktop app's native Python kernel. Non-Cirq options stay visible (so
  // students know they exist) but are disabled with a tooltip.
  const isDisabled = (f: Framework) => isWeb && f !== 'cirq';

  const applyTemplate = (f: Framework) => {
    if (isDirty) {
      const ok = window.confirm(
        'You have unsaved changes. Replacing the buffer will lose them. Continue?',
      );
      if (!ok) return;
    }
    setCode(STARTER_TEMPLATES[f]);
    setFramework(f);
    setOpen(false);
  };

  const menu = open && menuPos ? (
    <div
      ref={menuRef}
      role="menu"
      style={{
        position: 'fixed',
        top: menuPos.top,
        left: menuPos.left,
        background: colors.bgElevated,
        border: `1px solid ${colors.borderStrong}`,
        borderRadius: 6,
        overflow: 'hidden',
        zIndex: 1000,
        minWidth: 200,
        boxShadow: shadow.md,
      }}
    >
      <div style={{ padding: '4px 0' }}>
        <div
          style={{
            padding: '6px 12px 4px',
            fontSize: 9,
            fontWeight: 600,
            color: colors.textDim,
            fontFamily: "'Geist Sans', sans-serif",
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          }}
        >
          Framework
        </div>
        {FRAMEWORKS.map((f) => {
          const disabled = isDisabled(f);
          const isActive = f === framework;
          return (
            <button
              key={f}
              disabled={disabled}
              onClick={() => {
                if (disabled) return;
                setFramework(f);
                setOpen(false);
              }}
              title={disabled ? 'Desktop app only — download from getnuclei.dev' : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '6px 12px',
                background: isActive ? `${colors.accent}12` : 'transparent',
                color: disabled ? colors.textDim : isActive ? colors.accent : colors.text,
                border: 'none',
                cursor: disabled ? 'not-allowed' : 'pointer',
                fontSize: 12,
                fontFamily: "'Geist Sans', sans-serif",
                textAlign: 'left',
                opacity: disabled ? 0.55 : 1,
              }}
              onMouseEnter={(e) => {
                if (!isActive && !disabled)
                  e.currentTarget.style.background = `${colors.accent}08`;
              }}
              onMouseLeave={(e) => {
                if (!isActive && !disabled) e.currentTarget.style.background = 'transparent';
              }}
            >
              {isActive && <span style={{ color: colors.accent, fontSize: 10 }}>●</span>}
              <span style={{ marginLeft: isActive ? 0 : 18, flex: 1 }}>{displayName(f)}</span>
              {disabled && (
                <span
                  style={{
                    fontSize: 9,
                    color: colors.textDim,
                    fontWeight: 500,
                    textTransform: 'uppercase',
                    letterSpacing: 0.4,
                  }}
                >
                  Desktop
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div style={{ borderTop: `1px solid ${colors.border}`, padding: '4px 0' }}>
        <div
          style={{
            padding: '6px 12px 4px',
            fontSize: 9,
            fontWeight: 600,
            color: colors.textDim,
            fontFamily: "'Geist Sans', sans-serif",
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          }}
        >
          New from template
        </div>
        {FRAMEWORKS.map((f) => {
          const disabled = isDisabled(f);
          return (
            <button
              key={`tpl-${f}`}
              disabled={disabled}
              onClick={() => {
                if (disabled) return;
                applyTemplate(f);
              }}
              title={disabled ? 'Desktop app only — download from getnuclei.dev' : undefined}
              style={{
                display: 'block',
                width: '100%',
                padding: '6px 12px',
                background: 'transparent',
                color: disabled ? colors.textDim : colors.textMuted,
                border: 'none',
                cursor: disabled ? 'not-allowed' : 'pointer',
                fontSize: 12,
                fontFamily: "'Geist Sans', sans-serif",
                textAlign: 'left',
                opacity: disabled ? 0.55 : 1,
              }}
              onMouseEnter={(e) => {
                if (disabled) return;
                e.currentTarget.style.color = colors.text;
                e.currentTarget.style.background = `${colors.accent}08`;
              }}
              onMouseLeave={(e) => {
                if (disabled) return;
                e.currentTarget.style.color = colors.textMuted;
                e.currentTarget.style.background = 'transparent';
              }}
            >
              New {displayName(f)} file
            </button>
          );
        })}
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Framework"
        style={{
          background: open ? colors.bgElevated : 'transparent',
          border: `1px solid ${open ? colors.borderStrong : colors.border}`,
          borderRadius: 5,
          color: colors.accentLight,
          cursor: 'pointer',
          fontSize: 12,
          fontFamily: "'Geist Sans', sans-serif",
          fontWeight: 500,
          padding: '0 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          height: 26,
          transition: 'background 120ms ease, border-color 120ms ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = colors.bgElevated;
          e.currentTarget.style.borderColor = colors.borderStrong;
        }}
        onMouseLeave={(e) => {
          if (!open) {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.borderColor = colors.border;
          }
        }}
      >
        {displayName(framework)}
        <ChevronDown
          size={12}
          style={{
            opacity: 0.7,
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 150ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        />
      </button>
      {menu && createPortal(menu, document.body)}
    </>
  );
}
