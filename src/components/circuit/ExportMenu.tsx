import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useCircuitStore } from '../../stores/circuitStore';
import { useThemeStore } from '../../stores/themeStore';
import { useCircuitExport } from '../../hooks/useCircuitExport';
import { TYPOGRAPHY } from '../../styles/tokens';
import { Button, Menu, type MenuEntry } from '../ui';

export const COPIED_NOTICE_MS = 1500;
const ERROR_NOTICE_MS = 5000;
const CLIPBOARD_BLOCKED = "Couldn't copy: clipboard blocked";

/**
 * The circuit's Export menu. Copy actions confirm with a brief "Copied" and report a
 * blocked clipboard instead of failing silently; image exports say so when the diagram
 * is not on screen.
 */
export function ExportMenu() {
  const [notice, setNotice] = useState<string | null>(null);
  const colors = useThemeStore((s) => s.colors);
  const snapshot = useCircuitStore((s) => s.snapshot);
  const { exportQasmFile, exportSvg, exportPng, copyCodeToClipboard, copyQasmToClipboard, copyShareUrl, exportJsonSnapshot } = useCircuitExport();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const flash = useCallback((message: string | null, ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    setNotice(message);
    timer.current = message ? setTimeout(() => setNotice(null), ms) : null;
  }, []);

  if (!snapshot || snapshot.gates.length === 0) return null;

  const copy = async (action: () => Promise<unknown>, done: string) => {
    try {
      await action();
      flash(done, COPIED_NOTICE_MS);
    } catch {
      flash(CLIPBOARD_BLOCKED, ERROR_NOTICE_MS);
    }
  };

  const exportImage = async (pending: Promise<boolean>) => {
    try {
      flash((await pending) ? null : 'The diagram is not on screen, so there is nothing to export.', ERROR_NOTICE_MS);
    } catch (err) {
      flash(`Export failed: ${err instanceof Error ? err.message : 'unknown error'}`, ERROR_NOTICE_MS);
    }
  };

  const entries: MenuEntry[] = [
    { id: 'copy-code', label: 'Copy code', onSelect: () => { void copy(copyCodeToClipboard, 'Code copied'); } },
    { id: 'copy-qasm', label: 'Copy QASM', onSelect: () => { void copy(copyQasmToClipboard, 'QASM copied'); } },
    { id: 'copy-url', label: 'Copy share URL', onSelect: () => { void copy(copyShareUrl, 'Share URL copied'); } },
    { id: 'sep', separator: true },
    { id: 'qasm-file', label: 'Export QASM file', onSelect: exportQasmFile },
    { id: 'svg', label: 'Export SVG', onSelect: () => { void exportImage(exportSvg()); } },
    { id: 'png', label: 'Export PNG (2x)', onSelect: () => { void exportImage(exportPng(2)); } },
    { id: 'json', label: 'Export JSON', onSelect: exportJsonSnapshot },
  ];

  return (
    <div style={{ position: 'relative' }}>
      <Menu
        label="Export circuit"
        placement="bottom-end"
        entries={entries}
        onOpenChange={(open) => { if (open) flash(null, 0); }}
        trigger={(p) => (
          <Button {...p} size="sm" icon={<ChevronDown size={12} />} className="nuclei-export-btn">
            Export
          </Button>
        )}
      />
      <div
        role="status"
        style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 10, width: notice ? 200 : 0,
          padding: notice ? '6px 10px' : 0, overflow: 'hidden',
          background: colors.bgPanel, border: notice ? `1px solid ${colors.border}` : 'none', borderRadius: 'var(--radius-xs)',
          color: colors.textMuted, fontSize: 11, fontFamily: TYPOGRAPHY.fontSans, lineHeight: 1.4,
        }}
      >
        {notice}
      </div>
    </div>
  );
}
