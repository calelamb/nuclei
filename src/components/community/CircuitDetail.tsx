import { useState } from 'react';
import { X, Copy, Play } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import type { GalleryCircuit } from '../../data/community/mockGallery';

const FRAMEWORK_COLORS: Record<string, string> = {
  qiskit: '#6929C4',
  cirq: '#F4B400',
  'cuda-q': '#76B900',
};

interface CircuitDetailProps {
  circuit: GalleryCircuit;
  onClose: () => void;
  onOpenInEditor: () => void;
}

export function CircuitDetail({ circuit, onClose, onOpenInEditor }: CircuitDetailProps) {
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(circuit.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '90%',
          maxWidth: 640,
          maxHeight: '85vh',
          background: colors.bgElevated,
          border: `1px solid ${colors.borderStrong}`,
          borderRadius: 12,
          boxShadow: shadow.lg,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            padding: '16px 20px 12px',
            borderBottom: `1px solid ${colors.border}`,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 }}>
            <span
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: colors.text,
                fontFamily: "'Geist Sans', sans-serif",
              }}
            >
              {circuit.title}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  fontSize: 12,
                  color: colors.textMuted,
                  fontFamily: "'Geist Sans', sans-serif",
                }}
              >
                by {circuit.author.displayName}
              </span>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  fontFamily: "'Geist Sans', sans-serif",
                  color: '#fff',
                  background: FRAMEWORK_COLORS[circuit.framework] ?? colors.accent,
                  padding: '2px 6px',
                  borderRadius: 3,
                  textTransform: 'uppercase',
                }}
              >
                {circuit.framework}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: colors.textDim,
              padding: 4,
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              flexShrink: 0,
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {/* Description */}
          <p
            style={{
              fontSize: 12,
              color: colors.textMuted,
              fontFamily: "'Geist Sans', sans-serif",
              lineHeight: 1.6,
              margin: '0 0 16px',
            }}
          >
            {circuit.description}
          </p>

          {/* Tags */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 16 }}>
            {circuit.tags.map((tag) => (
              <span
                key={tag}
                style={{
                  fontSize: 10,
                  fontFamily: "'Geist Sans', sans-serif",
                  color: colors.accent,
                  background: `${colors.accent}15`,
                  padding: '2px 8px',
                  borderRadius: 10,
                }}
              >
                {tag}
              </span>
            ))}
          </div>

          {/* Code block */}
          <pre
            style={{
              background: colors.bgEditor,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              padding: 12,
              maxHeight: 300,
              overflowY: 'auto',
              margin: '0 0 16px',
            }}
          >
            <code
              style={{
                fontSize: 12,
                fontFamily: "'JetBrains Mono', monospace",
                color: colors.text,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {circuit.code}
            </code>
          </pre>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            <button
              onClick={onOpenInEditor}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '8px 12px',
                borderRadius: 6,
                border: 'none',
                background: colors.accent,
                color: '#fff',
                fontSize: 12,
                fontWeight: 600,
                fontFamily: "'Geist Sans', sans-serif",
                cursor: 'pointer',
              }}
            >
              <Play size={13} />
              Open in Editor
            </button>
            <button
              onClick={handleCopy}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '8px 16px',
                borderRadius: 6,
                border: `1px solid ${colors.border}`,
                background: 'transparent',
                color: copied ? colors.success : colors.textMuted,
                fontSize: 12,
                fontWeight: 600,
                fontFamily: "'Geist Sans', sans-serif",
                cursor: 'pointer',
                transition: 'color 0.15s',
              }}
            >
              <Copy size={13} />
              {copied ? 'Copied!' : 'Copy Code'}
            </button>
          </div>

          {/* Discussion placeholder */}
          <div
            style={{
              padding: '16px 0',
              borderTop: `1px solid ${colors.border}`,
              textAlign: 'center',
            }}
          >
            <span
              style={{
                fontSize: 12,
                color: colors.textDim,
                fontFamily: "'Geist Sans', sans-serif",
                fontStyle: 'italic',
              }}
            >
              Discussion coming soon
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
