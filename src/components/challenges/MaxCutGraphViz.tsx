import { useMemo } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import type { ChallengeVisualization } from '../../types/challenge';

interface MaxCutGraphVizProps {
  visualization: ChallengeVisualization;
  bestBitstring?: string;
}

interface NodePosition {
  id: number;
  label: string;
  x: number;
  y: number;
}

function computeLayout(
  nodes: ChallengeVisualization['nodes'],
  width: number,
  height: number,
): NodePosition[] {
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.35;

  if (nodes.length < 5) {
    // Simple grid layout for small graphs
    const cols = Math.ceil(Math.sqrt(nodes.length));
    const cellW = width / (cols + 1);
    const rows = Math.ceil(nodes.length / cols);
    const cellH = height / (rows + 1);

    return nodes.map((node, i) => ({
      id: node.id,
      label: node.label,
      x: cellW * ((i % cols) + 1),
      y: cellH * (Math.floor(i / cols) + 1),
    }));
  }

  // Circle layout for larger graphs
  return nodes.map((node, i) => {
    const angle = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
    return {
      id: node.id,
      label: node.label,
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  });
}

function isCutEdge(source: number, target: number, bitstring: string): boolean {
  if (source >= bitstring.length || target >= bitstring.length) return false;
  return bitstring[source] !== bitstring[target];
}

export function MaxCutGraphViz({ visualization, bestBitstring }: MaxCutGraphVizProps) {
  const colors = useThemeStore((s) => s.colors);

  const svgWidth = 280;
  const svgHeight = 220;
  const nodeRadius = 18;

  const positions = useMemo(
    () => computeLayout(visualization.nodes, svgWidth, svgHeight),
    [visualization.nodes],
  );

  const posMap = useMemo(() => {
    const map = new Map<number, NodePosition>();
    for (const p of positions) {
      map.set(p.id, p);
    }
    return map;
  }, [positions]);

  const cutValue = bestBitstring
    ? visualization.edges.filter((e) => isCutEdge(e.source, e.target, bestBitstring)).length
    : null;

  return (
    <div style={{
      borderRadius: 8,
      border: `1px solid ${colors.border}`,
      background: colors.bgPanel,
      padding: 12,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8,
      }}>
        <span style={{
          color: colors.textMuted,
          fontSize: 11,
          fontWeight: 600,
          fontFamily: "'Geist Sans', sans-serif",
        }}>
          Graph Visualization
        </span>
        {cutValue !== null && (
          <span style={{
            color: colors.accent,
            fontSize: 11,
            fontWeight: 600,
            fontFamily: "'Geist Mono', monospace",
          }}>
            Cut value: {cutValue}
          </span>
        )}
      </div>

      <svg
        width={svgWidth}
        height={svgHeight}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        style={{ display: 'block', margin: '0 auto' }}
      >
        {/* Edges */}
        {visualization.edges.map((edge, i) => {
          const src = posMap.get(edge.source);
          const tgt = posMap.get(edge.target);
          if (!src || !tgt) return null;

          const cut = bestBitstring ? isCutEdge(edge.source, edge.target, bestBitstring) : false;
          const midX = (src.x + tgt.x) / 2;
          const midY = (src.y + tgt.y) / 2;

          return (
            <g key={i}>
              <line
                x1={src.x}
                y1={src.y}
                x2={tgt.x}
                y2={tgt.y}
                stroke={cut ? colors.accent : colors.borderStrong}
                strokeWidth={cut ? 2.5 : 1.5}
                strokeDasharray={cut ? '6 3' : 'none'}
                opacity={cut ? 1 : 0.6}
              />
              {edge.weight !== undefined && (
                <text
                  x={midX}
                  y={midY - 6}
                  textAnchor="middle"
                  fill={colors.textDim}
                  fontSize={9}
                  fontFamily="'Geist Mono', monospace"
                >
                  {edge.weight}
                </text>
              )}
            </g>
          );
        })}

        {/* Nodes */}
        {positions.map((node) => {
          const bit = bestBitstring ? bestBitstring[node.id] : undefined;
          const fillColor = bit === '0'
            ? colors.accent
            : bit === '1'
              ? colors.dirac
              : colors.bgElevated;
          const textColor = bit !== undefined ? '#fff' : colors.text;

          return (
            <g key={node.id}>
              <circle
                cx={node.x}
                cy={node.y}
                r={nodeRadius}
                fill={fillColor}
                stroke={bit !== undefined ? 'none' : colors.borderStrong}
                strokeWidth={1.5}
              />
              <text
                x={node.x}
                y={node.y + 1}
                textAnchor="middle"
                dominantBaseline="central"
                fill={textColor}
                fontSize={11}
                fontWeight={600}
                fontFamily="'Geist Sans', sans-serif"
              >
                {node.label}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Partition legend */}
      {bestBitstring && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          marginTop: 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: colors.accent,
            }} />
            <span style={{
              color: colors.textDim,
              fontSize: 10,
              fontFamily: "'Geist Sans', sans-serif",
            }}>
              Partition 0
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: colors.dirac,
            }} />
            <span style={{
              color: colors.textDim,
              fontSize: 10,
              fontFamily: "'Geist Sans', sans-serif",
            }}>
              Partition 1
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
