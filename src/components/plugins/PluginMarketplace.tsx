import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Package, Trash2, RefreshCw, FolderOpen, Plus, Palette } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import {
  usePluginStore,
  selectEnabledPanels,
  selectEnabledThemes,
} from '../../plugins/pluginManager';
import {
  installPluginFromDir,
  reloadPlugin,
  enablePlugin,
  disablePlugin,
  uninstallPlugin,
} from '../../plugins/pluginLoader';
import { scaffoldPlugin } from '../../services/pluginScaffold';
import { loadBridge } from '../../platform/PlatformProvider';
import { PluginPanelHost } from './PluginPanelHost';
import { PluginErrorCard } from './PluginErrorCard';
import type { InstalledPlugin } from '../../plugins/types';

type Tab = 'installed' | 'panels';

const FONT = "'Geist Sans', sans-serif";

/* ── Small building blocks ───────────────────────────────── */

function ActionButton({
  label,
  icon,
  onClick,
  disabled,
  tone = 'default',
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'default' | 'accent' | 'danger';
}) {
  const colors = useThemeStore((s) => s.colors);
  const color =
    tone === 'accent' ? colors.accent : tone === 'danger' ? colors.error : colors.textMuted;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 10,
        fontWeight: 500,
        fontFamily: FONT,
        color,
        background: 'transparent',
        border: `1px solid ${color}40`,
        borderRadius: 4,
        padding: '3px 8px',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        flexShrink: 0,
      }}
    >
      {icon}
      {label}
    </button>
  );
}

/* ── Root ────────────────────────────────────────────────── */

export function PluginMarketplace() {
  const colors = useThemeStore((s) => s.colors);
  const plugins = usePluginStore((s) => s.plugins);

  const [tab, setTab] = useState<Tab>('installed');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleLoad = () =>
    run(async () => {
      const bridge = await loadBridge();
      const picked = await bridge.openDirectory();
      if (!picked) return; // user cancelled
      const res = await installPluginFromDir(picked.path);
      if (!res.ok) setError(res.error);
    });

  const handleCreate = () =>
    run(async () => {
      const name = newName.trim();
      if (!name) {
        setError('Enter a name for your plugin first.');
        return;
      }
      const bridge = await loadBridge();
      const picked = await bridge.openDirectory();
      if (!picked) return; // user cancelled
      const res = await scaffoldPlugin(name, picked.path);
      if (!res.ok) {
        setError(res.error ?? 'Could not create plugin.');
        return;
      }
      if (res.load && !res.load.ok) setError(res.load.error);
      setCreating(false);
      setNewName('');
      setTab('panels');
    });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: FONT }}>
      {/* Header actions */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          padding: '10px 12px 8px',
          flexShrink: 0,
          flexWrap: 'wrap',
        }}
      >
        <ActionButton
          label="Load plugin…"
          icon={<FolderOpen size={12} />}
          onClick={handleLoad}
          disabled={busy}
          tone="accent"
        />
        <ActionButton
          label="Create plugin…"
          icon={<Plus size={12} />}
          onClick={() => {
            setCreating((c) => !c);
            setError(null);
          }}
          disabled={busy}
        />
      </div>

      {/* Inline create form */}
      {creating && (
        <div style={{ display: 'flex', gap: 6, padding: '0 12px 8px', flexShrink: 0 }}>
          <input
            value={newName}
            autoFocus
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) handleCreate();
            }}
            placeholder="plugin name"
            style={{
              flex: 1,
              minWidth: 0,
              padding: '5px 8px',
              fontSize: 12,
              fontFamily: FONT,
              background: colors.bg,
              border: `1px solid ${colors.border}`,
              borderRadius: 4,
              color: colors.text,
              outline: 'none',
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = colors.accent;
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = colors.border;
            }}
          />
          <ActionButton
            label="Choose folder…"
            icon={<FolderOpen size={12} />}
            onClick={handleCreate}
            disabled={busy}
            tone="accent"
          />
        </div>
      )}

      {error && <PluginErrorCard title="Plugin error" message={error} />}

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${colors.border}`, flexShrink: 0 }}>
        {(['installed', 'panels'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              padding: '8px 0',
              fontSize: 11,
              fontWeight: 600,
              fontFamily: FONT,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              border: 'none',
              borderBottom: `2px solid ${tab === t ? colors.accent : 'transparent'}`,
              background: 'transparent',
              color: tab === t ? colors.accent : colors.textMuted,
              cursor: 'pointer',
              transition: 'color 0.15s, border-color 0.15s',
            }}
          >
            {t === 'installed' ? `Installed (${plugins.length})` : 'Panels'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {tab === 'installed' ? <InstalledTab plugins={plugins} busy={busy} run={run} /> : <PanelsTab />}
      </div>
    </div>
  );
}

/* ── Installed tab ───────────────────────────────────────── */

function InstalledTab({
  plugins,
  busy,
  run,
}: {
  plugins: InstalledPlugin[];
  busy: boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
}) {
  const colors = useThemeStore((s) => s.colors);

  if (plugins.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 32,
          gap: 12,
          textAlign: 'center',
        }}
      >
        <Package size={32} color={colors.textDim} strokeWidth={1} />
        <span style={{ fontSize: 12, color: colors.textDim, fontFamily: FONT }}>
          No plugins installed
        </span>
        <span style={{ fontSize: 11, color: colors.textDim, fontFamily: FONT }}>
          Load one from a folder or create your own. Plugins are local, user-authored code — there
          is no remote marketplace.
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {plugins.map((p) => (
        <PluginRow key={p.manifest.name} plugin={p} busy={busy} run={run} />
      ))}
    </div>
  );
}

function PluginRow({
  plugin,
  busy,
  run,
}: {
  plugin: InstalledPlugin;
  busy: boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
}) {
  const colors = useThemeStore((s) => s.colors);
  const name = plugin.manifest.name;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '10px 12px',
        borderBottom: `1px solid ${colors.border}`,
        opacity: plugin.enabled ? 1 : 0.65,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: colors.text,
            fontFamily: FONT,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {name}
        </span>
        <span
          style={{
            fontSize: 9,
            color: colors.textDim,
            background: colors.bg,
            padding: '1px 4px',
            borderRadius: 3,
            flexShrink: 0,
          }}
        >
          v{plugin.manifest.version}
        </span>
        <StatusPill status={plugin.status} />
      </div>

      {plugin.manifest.author && (
        <span style={{ fontSize: 10, color: colors.textMuted, fontFamily: FONT }}>
          by {plugin.manifest.author}
        </span>
      )}

      {plugin.manifest.description && (
        <span style={{ fontSize: 11, color: colors.textMuted, fontFamily: FONT, lineHeight: 1.4 }}>
          {plugin.manifest.description}
        </span>
      )}

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {plugin.manifest.capabilities.map((cap) => (
          <span
            key={cap}
            style={{
              fontSize: 9,
              fontFamily: "'Geist Mono', monospace",
              color: colors.accentLight,
              background: `${colors.accent}12`,
              padding: '1px 5px',
              borderRadius: 3,
            }}
          >
            {cap}
          </span>
        ))}
      </div>

      {plugin.status === 'error' && plugin.error && (
        <span
          style={{
            fontSize: 10,
            color: colors.error,
            fontFamily: "'Geist Mono', monospace",
            wordBreak: 'break-word',
          }}
        >
          {plugin.error}
        </span>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
        <ActionButton
          label={plugin.enabled ? 'Disable' : 'Enable'}
          icon={<Package size={11} />}
          disabled={busy}
          onClick={() =>
            run(async () => {
              if (plugin.enabled) await disablePlugin(name);
              else await enablePlugin(name);
            })
          }
        />
        <ActionButton
          label="Reload"
          icon={<RefreshCw size={11} />}
          disabled={busy || !plugin.source}
          onClick={() => run(async () => void (await reloadPlugin(name)))}
        />
        <ActionButton
          label="Uninstall"
          icon={<Trash2 size={11} />}
          tone="danger"
          disabled={busy}
          onClick={() => { if (window.confirm(`Uninstall "${name}"? It will be removed from Nuclei.`)) run(() => uninstallPlugin(name)); }}
        />
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: InstalledPlugin['status'] }) {
  const colors = useThemeStore((s) => s.colors);
  const tone =
    status === 'active' ? colors.success : status === 'error' ? colors.error : colors.textDim;
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: 0.3,
        color: tone,
        background: `${tone}18`,
        padding: '1px 5px',
        borderRadius: 3,
        flexShrink: 0,
        marginLeft: 'auto',
      }}
    >
      {status}
    </span>
  );
}

/* ── Panels tab ──────────────────────────────────────────── */

function PanelsTab() {
  const colors = useThemeStore((s) => s.colors);
  const panels = usePluginStore(useShallow(selectEnabledPanels));
  const themes = usePluginStore(useShallow(selectEnabledThemes));
  const overlayActive = useThemeStore((s) => s.pluginOverlay !== null);
  const applyPluginTheme = useThemeStore((s) => s.applyPluginTheme);
  const clearPluginTheme = useThemeStore((s) => s.clearPluginTheme);
  const [appliedTheme, setAppliedTheme] = useState<string | null>(null);

  if (panels.length === 0 && themes.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 32,
          gap: 12,
          textAlign: 'center',
        }}
      >
        <Package size={32} color={colors.textDim} strokeWidth={1} />
        <span style={{ fontSize: 11, color: colors.textDim, fontFamily: FONT }}>
          No enabled plugin registered a panel or theme yet.
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Themes */}
      {themes.length > 0 && (
        <div style={{ padding: '8px 12px', borderBottom: `1px solid ${colors.border}` }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginBottom: 8,
            }}
          >
            <Palette size={12} color={colors.textMuted} />
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                color: colors.textMuted,
                fontFamily: FONT,
              }}
            >
              Themes
            </span>
            {overlayActive && (
              <button
                onClick={() => {
                  clearPluginTheme();
                  setAppliedTheme(null);
                }}
                style={{
                  marginLeft: 'auto',
                  fontSize: 10,
                  fontFamily: FONT,
                  color: colors.textMuted,
                  background: 'transparent',
                  border: `1px solid ${colors.border}`,
                  borderRadius: 4,
                  padding: '2px 8px',
                  cursor: 'pointer',
                }}
              >
                Clear
              </button>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {themes.map((theme) => {
              const active = overlayActive && appliedTheme === `${theme.pluginName}:${theme.name}`;
              return (
                <div
                  key={`${theme.pluginName}:${theme.name}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  <span style={{ fontSize: 12, color: colors.text, fontFamily: FONT, flex: 1 }}>
                    {theme.name}
                  </span>
                  <button
                    onClick={() => {
                      applyPluginTheme(theme.colors);
                      setAppliedTheme(`${theme.pluginName}:${theme.name}`);
                    }}
                    style={{
                      fontSize: 10,
                      fontFamily: FONT,
                      color: active ? colors.success : colors.accent,
                      background: 'transparent',
                      border: `1px solid ${(active ? colors.success : colors.accent)}40`,
                      borderRadius: 4,
                      padding: '2px 8px',
                      cursor: 'pointer',
                    }}
                  >
                    {active ? 'Applied' : 'Apply'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Panels */}
      {panels.map((panel) => (
        <PluginPanelHost key={`${panel.pluginName}:${panel.id}`} panel={panel} />
      ))}
    </div>
  );
}
