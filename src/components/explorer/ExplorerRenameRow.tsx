import type { CSSProperties, ReactNode } from 'react';
import type { ThemeColors } from '../../stores/themeStore';
import { TYPOGRAPHY } from '../../styles/tokens';
import { ExplorerNameInput } from './ExplorerNameInput';

interface ExplorerRenameRowProps {
  name: string;
  /** The row's own style, so the row keeps its indent and height while editing. */
  rowStyle: CSSProperties;
  /** The file icon, kept so the row does not reflow when editing starts. */
  icon: ReactNode;
  value: string;
  error: string | null;
  colors: ThemeColors;
  onChange: (value: string) => void;
  onCommit: (viaKeyboard: boolean) => void;
  onCancel: (viaKeyboard: boolean) => void;
}

/**
 * The rename field for a tree file row. It keeps the spacer and icon of the
 * row it replaces and shows a rejected name right under the input, exactly
 * like the create field does.
 */
export function ExplorerRenameRow({
  name, rowStyle, icon, value, error, colors, onChange, onCommit, onCancel,
}: ExplorerRenameRowProps) {
  const errorId = 'explorer-rename-error';
  return (
    <div>
      <div style={rowStyle}>
        <span aria-hidden="true" data-tree-spacer style={{ width: 12, marginRight: 2, flexShrink: 0 }} />
        {icon}
        <ExplorerNameInput
          ariaLabel={`Rename ${name}`}
          selectBaseName
          value={value}
          invalid={error !== null}
          describedBy={error ? errorId : undefined}
          onChange={onChange}
          onBlur={() => (error ? onCancel(false) : onCommit(false))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); onCommit(true); }
            if (e.key === 'Escape') { e.preventDefault(); onCancel(true); }
          }}
          style={{
            flex: 1,
            minWidth: 0,
            background: colors.bgElevated,
            border: `1px solid ${error ? colors.error : colors.accent}`,
            color: colors.text,
            fontSize: 12,
            padding: '1px 6px',
            borderRadius: 4,
            fontFamily: TYPOGRAPHY.fontSans,
          }}
        />
      </div>
      {error && (
        <div
          id={errorId}
          role="alert"
          style={{ color: colors.error, fontSize: 11, lineHeight: 1.4, padding: '2px 8px 4px 36px' }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
