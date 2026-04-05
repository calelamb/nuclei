import { usePluginStore } from '../../plugins/pluginManager';
import { useThemeStore } from '../../stores/themeStore';

export function PluginManagerPanel({ onClose }: { onClose: () => void }) {
  const plugins = usePluginStore((s) => s.plugins);
  const extensions = usePluginStore((s) => s.extensions);
  const { togglePlugin, uninstallPlugin } = usePluginStore();
  const colors = useThemeStore((s) => s.colors);

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.4)',
    }} onClick={onClose}>
      <div style={{
        background: colors.bg, border: `1px solid ${colors.border}`,
        borderRadius: 8, padding: 24, maxWidth: 480, width: '90%', maxHeight: '80vh', overflow: 'auto',
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <span style={{ color: colors.accent, fontSize: 18, fontWeight: 700, fontFamily: 'Inter, sans-serif' }}>
            Plugins
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: colors.textMuted, cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>

        {plugins.length === 0 ? (
          <div style={{ color: colors.textMuted, fontSize: 13, fontFamily: 'Inter, sans-serif', textAlign: 'center', padding: 20 }}>
            No plugins installed.<br />
            <span style={{ fontSize: 11 }}>Plugins extend Nuclei with custom panels, gate renderers, Dirac skills, and themes.</span>
          </div>
        ) : (
          plugins.map((plugin) => (
            <div
              key={plugin.manifest.name}
              style={{
                padding: 12, marginBottom: 8,
                border: `1px solid ${colors.border}`, borderRadius: 6,
                opacity: plugin.enabled ? 1 : 0.6,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ color: colors.text, fontSize: 14, fontWeight: 600, fontFamily: 'Inter, sans-serif' }}>
                    {plugin.manifest.name}
                  </span>
                  <span style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'Inter, sans-serif', marginLeft: 8 }}>
                    v{plugin.manifest.version}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => togglePlugin(plugin.manifest.name)}
                    style={{
                      padding: '3px 8px', fontSize: 11, fontFamily: 'Inter, sans-serif',
                      background: plugin.enabled ? colors.accent : colors.border,
                      color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer',
                    }}
                  >
                    {plugin.enabled ? 'Enabled' : 'Disabled'}
                  </button>
                  <button
                    onClick={() => uninstallPlugin(plugin.manifest.name)}
                    style={{
                      padding: '3px 8px', fontSize: 11, fontFamily: 'Inter, sans-serif',
                      background: colors.border, color: colors.error,
                      border: 'none', borderRadius: 3, cursor: 'pointer',
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
              <div style={{ color: colors.textMuted, fontSize: 12, fontFamily: 'Inter, sans-serif', marginTop: 4 }}>
                {plugin.manifest.description}
              </div>
              <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                {plugin.manifest.capabilities.map((cap) => (
                  <span key={cap} style={{
                    padding: '1px 6px', fontSize: 10, fontFamily: 'Inter, sans-serif',
                    background: colors.bgPanel, color: colors.accentLight,
                    borderRadius: 3, border: `1px solid ${colors.border}`,
                  }}>
                    {cap}
                  </span>
                ))}
              </div>
            </div>
          ))
        )}

        <div style={{ marginTop: 16, padding: 12, background: colors.bgPanel, borderRadius: 6 }}>
          <div style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'Inter, sans-serif' }}>
            Active extensions: {extensions.panels.length} panels, {extensions.diracSkills.length} Dirac skills, {extensions.themes.length} themes
          </div>
        </div>
      </div>
    </div>
  );
}
