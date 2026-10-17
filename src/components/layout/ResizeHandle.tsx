import { useThemeStore } from '../../stores/themeStore';

/* ── Resize Handle ── */
export function ResizeHandle({ direction, isDragging, onMouseDown, onDoubleClick }: {
  direction: 'horizontal' | 'vertical'; isDragging: boolean; onMouseDown: () => void; onDoubleClick: () => void;
}) {
  const colors = useThemeStore((s) => s.colors);
  const isH = direction === 'horizontal';
  return (
    <div style={{ [isH ? 'width' : 'height']: isDragging ? 2 : 1, cursor: isH ? 'col-resize' : 'row-resize',
      backgroundColor: isDragging ? colors.accent : colors.border, flexShrink: 0, position: 'relative',
      transition: isDragging ? 'none' : 'all 150ms ease' }}
      onMouseDown={onMouseDown} onDoubleClick={onDoubleClick} role="separator">
      <div style={{ position: 'absolute', [isH ? 'left' : 'top']: -3, [isH ? 'right' : 'bottom']: -3,
        [isH ? 'width' : 'height']: 8, [isH ? 'top' : 'left']: 0, [isH ? 'bottom' : 'right']: 0, zIndex: 2 }}
        onMouseEnter={(e) => { const p = e.currentTarget.parentElement; if (p && !isDragging) { p.style.backgroundColor = colors.accent; p.style[isH ? 'width' : 'height'] = '2px'; } }}
        onMouseLeave={(e) => { const p = e.currentTarget.parentElement; if (p && !isDragging) { p.style.backgroundColor = colors.border; p.style[isH ? 'width' : 'height'] = '1px'; } }}
      />
    </div>
  );
}
