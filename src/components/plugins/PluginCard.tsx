import { useState } from 'react';
import { Star, Download, Award } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import type { PluginRegistryEntry } from '../../data/pluginRegistry';

interface PluginCardProps {
  plugin: PluginRegistryEntry;
  isInstalled: boolean;
  onInstall: () => void;
  onRemove: () => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  visualization: '#00B4D8',
  hardware: '#F59E0B',
  learning: '#10B981',
  theme: '#A855F7',
  integration: '#3B82F6',
};

export function PluginCard({ plugin, isInstalled, onInstall, onRemove }: PluginCardProps) {
  const colors = useThemeStore((s) => s.colors);
  const [hovered, setHovered] = useState(false);

  const catColor = CATEGORY_COLORS[plugin.category] ?? colors.textMuted;
  const fullStars = Math.floor(plugin.rating);
  const hasHalf = plugin.rating - fullStars >= 0.5;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: colors.bgElevated,
        border: `1px solid ${hovered ? colors.borderStrong : colors.border}`,
        borderRadius: 8,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        position: 'relative',
        transition: 'border-color 0.15s',
        fontFamily: "'Geist Sans', sans-serif",
      }}
    >
      {/* Featured badge */}
      {plugin.featured && (
        <div style={{
          position: 'absolute', top: 8, right: 8,
          display: 'flex', alignItems: 'center', gap: 3,
          background: `${colors.warning}20`,
          color: colors.warning,
          padding: '2px 6px',
          borderRadius: 4,
          fontSize: 9,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 0.3,
        }}>
          <Award size={9} />
          Featured
        </div>
      )}

      {/* Header: name + version */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingRight: plugin.featured ? 64 : 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>
          {plugin.name}
        </span>
        <span style={{
          fontSize: 10, color: colors.textDim,
          background: colors.bg,
          padding: '1px 5px',
          borderRadius: 3,
          flexShrink: 0,
        }}>
          v{plugin.version}
        </span>
      </div>

      {/* Author */}
      <span style={{ fontSize: 11, color: colors.textMuted }}>
        by {plugin.author}
      </span>

      {/* Description */}
      <p style={{
        fontSize: 12,
        color: colors.textMuted,
        margin: 0,
        lineHeight: 1.4,
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}>
        {plugin.description}
      </p>

      {/* Bottom row: rating, downloads, category, action */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 'auto',
        gap: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Star rating */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Star
                key={i}
                size={11}
                fill={i < fullStars || (i === fullStars && hasHalf) ? colors.warning : 'none'}
                color={i < fullStars || (i === fullStars && hasHalf) ? colors.warning : colors.textDim}
                strokeWidth={1.5}
              />
            ))}
            <span style={{ fontSize: 10, color: colors.textMuted, marginLeft: 3 }}>
              {plugin.rating}
            </span>
          </div>

          {/* Downloads */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, color: colors.textDim, fontSize: 10 }}>
            <Download size={10} />
            {plugin.downloads >= 1000 ? `${(plugin.downloads / 1000).toFixed(1)}k` : plugin.downloads}
          </div>

          {/* Category pill */}
          <span style={{
            fontSize: 9,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: 0.3,
            color: catColor,
            background: `${catColor}15`,
            padding: '2px 6px',
            borderRadius: 3,
          }}>
            {plugin.category}
          </span>
        </div>

        {/* Action button */}
        {isInstalled ? (
          <button
            onClick={onRemove}
            style={{
              fontSize: 10,
              fontWeight: 500,
              fontFamily: "'Geist Sans', sans-serif",
              color: colors.error,
              background: 'transparent',
              border: `1px solid ${colors.error}40`,
              borderRadius: 4,
              padding: '3px 8px',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            Remove
          </button>
        ) : (
          <button
            onClick={onInstall}
            style={{
              fontSize: 10,
              fontWeight: 500,
              fontFamily: "'Geist Sans', sans-serif",
              color: colors.accent,
              background: 'transparent',
              border: `1px solid ${colors.accent}40`,
              borderRadius: 4,
              padding: '3px 8px',
              cursor: 'pointer',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = `${colors.accent}15`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            Install
          </button>
        )}
      </div>
    </div>
  );
}
