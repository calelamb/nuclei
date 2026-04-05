import { useState, useMemo } from 'react';
import { Search, Trash2, Package } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { usePluginStore } from '../../plugins/pluginManager';
import { PLUGIN_REGISTRY, type PluginRegistryEntry } from '../../data/pluginRegistry';
import { PluginCard } from './PluginCard';

type Tab = 'installed' | 'browse';
type Category = 'all' | PluginRegistryEntry['category'];

const CATEGORIES: { value: Category; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'visualization', label: 'Visualization' },
  { value: 'hardware', label: 'Hardware' },
  { value: 'learning', label: 'Learning' },
  { value: 'theme', label: 'Theme' },
  { value: 'integration', label: 'Integration' },
];

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const colors = useThemeStore((s) => s.colors);
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        width: 32, height: 18, borderRadius: 9, padding: 2,
        border: 'none', cursor: 'pointer',
        background: value ? colors.accent : colors.borderStrong,
        display: 'flex', alignItems: 'center',
        justifyContent: value ? 'flex-end' : 'flex-start',
        transition: 'background 0.2s',
        flexShrink: 0,
      }}
    >
      <div style={{
        width: 14, height: 14, borderRadius: '50%',
        background: value ? '#fff' : colors.textDim,
        transition: 'background 0.2s',
      }} />
    </button>
  );
}

export function PluginMarketplace() {
  const colors = useThemeStore((s) => s.colors);
  const plugins = usePluginStore((s) => s.plugins);
  const togglePlugin = usePluginStore((s) => s.togglePlugin);
  const uninstallPlugin = usePluginStore((s) => s.uninstallPlugin);
  const installPlugin = usePluginStore((s) => s.installPlugin);

  const [tab, setTab] = useState<Tab>('browse');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<Category>('all');

  const installedNames = useMemo(() => new Set(plugins.map((p) => p.manifest.name)), [plugins]);

  const filteredRegistry = useMemo(() => {
    let items = PLUGIN_REGISTRY;
    if (category !== 'all') {
      items = items.filter((p) => p.category === category);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(
        (p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
      );
    }
    return items;
  }, [search, category]);

  const handleInstall = (entry: PluginRegistryEntry) => {
    installPlugin(
      {
        name: entry.name,
        version: entry.version,
        description: entry.description,
        author: entry.author,
        entry: entry.repositoryUrl,
        capabilities: [],
        permissions: [],
      },
      entry.repositoryUrl
    );
  };

  const font = "'Geist Sans', sans-serif";

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: font }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex', borderBottom: `1px solid ${colors.border}`,
        flexShrink: 0,
      }}>
        {(['installed', 'browse'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              padding: '8px 0',
              fontSize: 11,
              fontWeight: 600,
              fontFamily: font,
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
            {t === 'installed' ? `Installed (${plugins.length})` : 'Browse'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {tab === 'installed' ? (
          <InstalledTab
            plugins={plugins}
            onToggle={togglePlugin}
            onRemove={uninstallPlugin}
          />
        ) : (
          <BrowseTab
            search={search}
            onSearchChange={setSearch}
            category={category}
            onCategoryChange={setCategory}
            plugins={filteredRegistry}
            installedNames={installedNames}
            onInstall={handleInstall}
            onRemove={uninstallPlugin}
          />
        )}
      </div>
    </div>
  );
}

/* ── Installed Tab ───────────────────────────────────────── */

function InstalledTab({
  plugins,
  onToggle,
  onRemove,
}: {
  plugins: ReturnType<typeof usePluginStore.getState>['plugins'];
  onToggle: (name: string) => void;
  onRemove: (name: string) => void;
}) {
  const colors = useThemeStore((s) => s.colors);
  const font = "'Geist Sans', sans-serif";

  if (plugins.length === 0) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', padding: 32, gap: 12,
      }}>
        <Package size={32} color={colors.textDim} strokeWidth={1} />
        <span style={{ fontSize: 12, color: colors.textDim, fontFamily: font }}>
          No plugins installed
        </span>
        <span style={{ fontSize: 11, color: colors.textDim, fontFamily: font, textAlign: 'center' }}>
          Browse the marketplace to discover plugins for quantum computing workflows.
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {plugins.map((p) => (
        <div
          key={p.manifest.name}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 12px',
            borderBottom: `1px solid ${colors.border}`,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                fontSize: 12, fontWeight: 600, color: colors.text, fontFamily: font,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {p.manifest.name}
              </span>
              <span style={{
                fontSize: 9, color: colors.textDim,
                background: colors.bg, padding: '1px 4px', borderRadius: 3,
                flexShrink: 0,
              }}>
                v{p.manifest.version}
              </span>
            </div>
          </div>

          <Toggle value={p.enabled} onChange={() => onToggle(p.manifest.name)} />

          <button
            onClick={() => onRemove(p.manifest.name)}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: colors.textDim, padding: 4, display: 'flex',
              borderRadius: 3,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = colors.error; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = colors.textDim; }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ── Browse Tab ──────────────────────────────────────────── */

function BrowseTab({
  search,
  onSearchChange,
  category,
  onCategoryChange,
  plugins,
  installedNames,
  onInstall,
  onRemove,
}: {
  search: string;
  onSearchChange: (q: string) => void;
  category: Category;
  onCategoryChange: (c: Category) => void;
  plugins: PluginRegistryEntry[];
  installedNames: Set<string>;
  onInstall: (p: PluginRegistryEntry) => void;
  onRemove: (name: string) => void;
}) {
  const colors = useThemeStore((s) => s.colors);
  const font = "'Geist Sans', sans-serif";

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Search */}
      <div style={{ padding: '10px 12px 6px', position: 'relative' }}>
        <Search
          size={13}
          color={colors.textDim}
          style={{ position: 'absolute', left: 20, top: 19, pointerEvents: 'none' }}
        />
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search plugins..."
          style={{
            width: '100%',
            padding: '6px 10px 6px 28px',
            fontSize: 12,
            fontFamily: font,
            background: colors.bg,
            border: `1px solid ${colors.border}`,
            borderRadius: 4,
            color: colors.text,
            outline: 'none',
            boxSizing: 'border-box',
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = colors.accent; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = colors.border; }}
        />
      </div>

      {/* Category filters */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 4,
        padding: '4px 12px 8px',
      }}>
        {CATEGORIES.map((c) => {
          const active = category === c.value;
          return (
            <button
              key={c.value}
              onClick={() => onCategoryChange(c.value)}
              style={{
                fontSize: 10,
                fontWeight: 500,
                fontFamily: font,
                padding: '3px 8px',
                borderRadius: 10,
                border: `1px solid ${active ? colors.accent : colors.border}`,
                background: active ? `${colors.accent}18` : 'transparent',
                color: active ? colors.accent : colors.textMuted,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {/* Plugin grid */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 12px 12px' }}>
        {plugins.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: 24,
            fontSize: 11, color: colors.textDim, fontFamily: font,
          }}>
            No plugins match your search.
          </div>
        ) : (
          plugins.map((p) => (
            <PluginCard
              key={p.name}
              plugin={p}
              isInstalled={installedNames.has(p.name)}
              onInstall={() => onInstall(p)}
              onRemove={() => onRemove(p.name)}
            />
          ))
        )}
      </div>
    </div>
  );
}
