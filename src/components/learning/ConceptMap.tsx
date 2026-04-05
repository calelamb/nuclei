import { useState, useMemo } from 'react';
import { CONCEPT_GRAPH, type ConceptNode } from '../../data/conceptMap';
import { useStudentStore } from '../../stores/studentStore';
import { useThemeStore } from '../../stores/themeStore';

const CATEGORY_X: Record<string, number> = {
  basics: 80,
  gates: 220,
  entanglement: 360,
  algorithms: 500,
  'error-correction': 640,
  hardware: 780,
};

const CATEGORY_LABELS: Record<string, string> = {
  basics: 'Basics',
  gates: 'Gates',
  entanglement: 'Entanglement',
  algorithms: 'Algorithms',
  'error-correction': 'Error Correction',
  hardware: 'Hardware',
};

const NODE_R = 18;

interface NodePosition {
  id: string;
  x: number;
  y: number;
  node: ConceptNode;
}

function layoutNodes(): NodePosition[] {
  const byCat: Record<string, ConceptNode[]> = {};
  for (const node of CONCEPT_GRAPH.nodes) {
    if (!byCat[node.category]) byCat[node.category] = [];
    byCat[node.category].push(node);
  }

  const positions: NodePosition[] = [];
  for (const [cat, nodes] of Object.entries(byCat)) {
    const x = CATEGORY_X[cat] ?? 80;
    const totalHeight = (nodes.length - 1) * 55;
    const startY = Math.max(60, 200 - totalHeight / 2);
    nodes.forEach((node, i) => {
      positions.push({ id: node.id, x, y: startY + i * 55, node });
    });
  }
  return positions;
}

export function ConceptMap() {
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);
  const conceptsMastered = useStudentStore((s) => s.model.conceptsMastered);
  const conceptsStruggling = useStudentStore((s) => s.model.conceptsStruggling);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const positions = useMemo(() => layoutNodes(), []);
  const posMap = useMemo(() => {
    const m: Record<string, NodePosition> = {};
    for (const p of positions) m[p.id] = p;
    return m;
  }, [positions]);

  const maxY = Math.max(...positions.map((p) => p.y)) + 60;
  const svgHeight = Math.max(400, maxY);
  const svgWidth = 860;

  const selectedNode = selectedId ? posMap[selectedId] : null;

  const getNodeColor = (id: string): string => {
    if (conceptsMastered.includes(id)) return '#10B981';
    if (conceptsStruggling.includes(id)) return colors.accent;
    return colors.textDim;
  };

  const getNodeOpacity = (id: string): number => {
    if (conceptsMastered.includes(id) || conceptsStruggling.includes(id)) return 1;
    return 0.45;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Legend */}
      <div style={{ padding: '8px 12px', display: 'flex', gap: 14, alignItems: 'center', flexShrink: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontFamily: 'Geist Sans, Inter, sans-serif', color: colors.textMuted }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10B981', display: 'inline-block' }} />
          Mastered
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontFamily: 'Geist Sans, Inter, sans-serif', color: colors.textMuted }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: colors.accent, display: 'inline-block' }} />
          In Progress
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontFamily: 'Geist Sans, Inter, sans-serif', color: colors.textMuted }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: colors.textDim, opacity: 0.45, display: 'inline-block' }} />
          Unseen
        </span>
      </div>

      {/* SVG container with horizontal scroll */}
      <div style={{ flex: 1, overflowX: 'auto', overflowY: 'auto' }}>
        <svg width={svgWidth} height={svgHeight} style={{ display: 'block' }}>
          {/* Category labels */}
          {Object.entries(CATEGORY_X).map(([cat, x]) => (
            <text
              key={cat}
              x={x}
              y={20}
              textAnchor="middle"
              fill={colors.textDim}
              fontSize={9}
              fontFamily="Geist Sans, Inter, sans-serif"
              fontWeight={600}
              style={{ textTransform: 'uppercase', letterSpacing: '0.5px' }}
            >
              {CATEGORY_LABELS[cat]}
            </text>
          ))}

          {/* Edges */}
          {CONCEPT_GRAPH.edges.map((edge, i) => {
            const from = posMap[edge.from];
            const to = posMap[edge.to];
            if (!from || !to) return null;
            return (
              <line
                key={i}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke={colors.borderStrong}
                strokeWidth={1}
                opacity={0.4}
              />
            );
          })}

          {/* Nodes */}
          {positions.map((pos) => {
            const isSelected = selectedId === pos.id;
            const nodeColor = getNodeColor(pos.id);
            const opacity = getNodeOpacity(pos.id);

            return (
              <g
                key={pos.id}
                style={{ cursor: 'pointer' }}
                onClick={() => setSelectedId(isSelected ? null : pos.id)}
              >
                {/* Glow ring for selected */}
                {isSelected && (
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={NODE_R + 5}
                    fill="none"
                    stroke={nodeColor}
                    strokeWidth={2}
                    opacity={0.5}
                  />
                )}
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={NODE_R}
                  fill={nodeColor}
                  opacity={opacity}
                />
                <text
                  x={pos.x}
                  y={pos.y + NODE_R + 12}
                  textAnchor="middle"
                  fill={colors.textMuted}
                  fontSize={8}
                  fontFamily="Geist Sans, Inter, sans-serif"
                >
                  {pos.node.label}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Popover for selected node */}
        {selectedNode && (
          <div
            style={{
              position: 'sticky',
              bottom: 0,
              left: 0,
              right: 0,
              background: colors.bgElevated,
              border: `1px solid ${colors.borderStrong}`,
              borderRadius: 6,
              padding: 12,
              margin: '0 8px 8px 8px',
              boxShadow: shadow.md,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ color: colors.text, fontSize: 13, fontWeight: 600, fontFamily: 'Geist Sans, Inter, sans-serif' }}>
                {selectedNode.node.label}
              </span>
              <button
                onClick={() => setSelectedId(null)}
                style={{ background: 'none', border: 'none', color: colors.textDim, cursor: 'pointer', fontSize: 14, padding: 0 }}
              >
                x
              </button>
            </div>
            <div style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'Geist Sans, Inter, sans-serif', lineHeight: 1.5, marginBottom: 6 }}>
              {selectedNode.node.description}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{
                fontSize: 9,
                fontFamily: 'Geist Sans, Inter, sans-serif',
                padding: '2px 6px',
                borderRadius: 3,
                background: getNodeColor(selectedNode.id) + '22',
                color: getNodeColor(selectedNode.id),
                fontWeight: 600,
              }}>
                {conceptsMastered.includes(selectedNode.id) ? 'Mastered' : conceptsStruggling.includes(selectedNode.id) ? 'In Progress' : 'Not Started'}
              </span>
              {selectedNode.node.exerciseIds.length > 0 && (
                <span style={{
                  fontSize: 9,
                  fontFamily: 'Geist Sans, Inter, sans-serif',
                  color: colors.accent,
                }}>
                  {selectedNode.node.exerciseIds.length} exercise{selectedNode.node.exerciseIds.length > 1 ? 's' : ''} available
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
