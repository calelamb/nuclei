import { useMemo } from 'react';
import { useThemeStore } from '../../stores/themeStore';

interface ConnectivityMapProps {
  connectivity: Array<[number, number]>;
  qubitCount: number;
}

function computePositions(qubitCount: number, width: number, height: number) {
  const positions: Array<{ x: number; y: number }> = [];
  if (qubitCount === 0) return positions;

  const cols = Math.ceil(Math.sqrt(qubitCount));
  const rows = Math.ceil(qubitCount / cols);
  const padX = 24;
  const padY = 24;
  const cellW = (width - padX * 2) / Math.max(cols - 1, 1);
  const cellH = (height - padY * 2) / Math.max(rows - 1, 1);

  for (let i = 0; i < qubitCount; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    positions.push({
      x: padX + col * cellW,
      y: padY + row * cellH,
    });
  }

  return positions;
}

export function ConnectivityMap({ connectivity, qubitCount }: ConnectivityMapProps) {
  const colors = useThemeStore((s) => s.colors);

  const svgWidth = 230;
  const svgHeight = Math.max(100, Math.ceil(Math.sqrt(qubitCount)) * 40 + 48);

  const positions = useMemo(
    () => computePositions(qubitCount, svgWidth, svgHeight),
    [qubitCount, svgWidth, svgHeight]
  );

  if (qubitCount === 0) {
    return (
      <div
        style={{
          fontSize: 11,
          color: colors.textDim,
          fontFamily: "'Geist Sans', sans-serif",
          textAlign: 'center',
          padding: '12px 0',
        }}
      >
        No connectivity data
      </div>
    );
  }

  return (
    <svg
      width={svgWidth}
      height={svgHeight}
      style={{ display: 'block', margin: '0 auto' }}
    >
      {/* Edges */}
      {connectivity.map(([a, b], i) => {
        const pa = positions[a];
        const pb = positions[b];
        if (!pa || !pb) return null;
        return (
          <line
            key={`edge-${i}`}
            x1={pa.x}
            y1={pa.y}
            x2={pb.x}
            y2={pb.y}
            stroke={colors.borderStrong}
            strokeWidth={1.5}
            strokeLinecap="round"
          />
        );
      })}

      {/* Nodes */}
      {positions.map((pos, i) => (
        <g key={`node-${i}`}>
          <circle
            cx={pos.x}
            cy={pos.y}
            r={8}
            fill={colors.bgElevated}
            stroke={colors.accent}
            strokeWidth={1.5}
          />
          <text
            x={pos.x}
            y={pos.y}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={8}
            fontFamily="'Geist Sans', sans-serif"
            fill={colors.textMuted}
          >
            {i}
          </text>
        </g>
      ))}
    </svg>
  );
}
