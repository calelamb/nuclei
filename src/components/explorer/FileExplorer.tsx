import { useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useEditorStore } from '../../stores/editorStore';
import { useThemeStore } from '../../stores/themeStore';

function FileIcon({ name }: { name: string }) {
  const ext = name.split('.').pop()?.toLowerCase();
  const iconMap: Record<string, string> = {
    py: '🐍', qasm: '⚛', json: '{}', md: '📄', txt: '📄',
  };
  return <span style={{ fontSize: 12, marginRight: 4 }}>{iconMap[ext ?? ''] ?? '📄'}</span>;
}

export function FileExplorer() {
  const { files, openTabs, activeTab, openTab, closeTab, removeFile, addFile } = useProjectStore();
  const setCode = useEditorStore((s) => s.setCode);
  const colors = useThemeStore((s) => s.colors);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string } | null>(null);

  const handleFileClick = (file: typeof files[0]) => {
    openTab(file.path);
    setCode(file.content);
  };

  const handleContextMenu = (e: React.MouseEvent, path: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, path });
  };

  const handleNewFile = () => {
    const name = `untitled_${files.length + 1}.py`;
    addFile({ path: name, name, content: '', isDirty: false });
    openTab(name);
    setCode('');
    setContextMenu(null);
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        padding: '6px 10px',
        borderBottom: `1px solid ${colors.border}`,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'Inter, sans-serif', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Files
        </span>
        <button
          onClick={handleNewFile}
          style={{ background: 'none', border: 'none', color: colors.accent, cursor: 'pointer', fontSize: 14 }}
          title="New file"
        >
          +
        </button>
      </div>

      {/* File list */}
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
        {files.length === 0 ? (
          <div style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'Inter, sans-serif', padding: '12px 10px', textAlign: 'center' }}>
            No files yet
          </div>
        ) : (
          files.map((file) => (
            <button
              key={file.path}
              onClick={() => handleFileClick(file)}
              onContextMenu={(e) => handleContextMenu(e, file.path)}
              style={{
                display: 'flex',
                alignItems: 'center',
                width: '100%',
                padding: '4px 10px',
                background: activeTab === file.path ? colors.border : 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: colors.text,
                fontSize: 12,
                fontFamily: 'Inter, sans-serif',
                textAlign: 'left',
              }}
            >
              <FileIcon name={file.name} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {file.isDirty ? '● ' : ''}{file.name}
              </span>
            </button>
          ))
        )}
      </div>

      {/* Tabs */}
      {openTabs.length > 1 && (
        <div style={{
          borderTop: `1px solid ${colors.border}`,
          display: 'flex',
          overflow: 'auto',
          flexShrink: 0,
        }}>
          {openTabs.map((path) => {
            const file = files.find((f) => f.path === path);
            if (!file) return null;
            return (
              <div
                key={path}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 8px',
                  background: activeTab === path ? colors.bg : 'transparent',
                  borderBottom: activeTab === path ? `2px solid ${colors.accent}` : '2px solid transparent',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontFamily: 'Inter, sans-serif',
                  color: activeTab === path ? colors.accent : colors.textMuted,
                  flexShrink: 0,
                }}
                onClick={() => { openTab(path); setCode(file.content); }}
              >
                {file.isDirty ? '●' : ''}{file.name}
                <button
                  onClick={(e) => { e.stopPropagation(); closeTab(path); }}
                  style={{ background: 'none', border: 'none', color: colors.textMuted, cursor: 'pointer', fontSize: 10, padding: 0 }}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            left: contextMenu.x, top: contextMenu.y,
            background: colors.bgPanel, border: `1px solid ${colors.border}`,
            borderRadius: 4, overflow: 'hidden', zIndex: 1500, minWidth: 120,
          }}
          onClick={() => setContextMenu(null)}
        >
          <button
            onClick={() => { removeFile(contextMenu.path); setContextMenu(null); }}
            style={{ display: 'block', width: '100%', padding: '6px 12px', background: 'transparent', color: colors.error, border: 'none', cursor: 'pointer', fontSize: 12, fontFamily: 'Inter, sans-serif', textAlign: 'left' }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
