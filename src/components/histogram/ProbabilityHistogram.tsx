import { useState, useCallback, useRef } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useSimulationStore } from '../../stores/simulationStore';

type ViewMode = 'ideal' | 'sampled';

export function ProbabilityHistogram() {
  const result = useSimulationStore((s) => s.result);
  const shots = useSimulationStore((s) => s.shots);
  const setShots = useSimulationStore((s) => s.setShots);
  const [viewMode, setViewMode] = useState<ViewMode>('sampled');
  const chartRef = useRef<HTMLDivElement>(null);

  if (!result) {
    return (
      <div style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#3D5A80',
        fontSize: 13,
        fontFamily: 'Inter, sans-serif',
      }}>
        Press Cmd+Enter to run simulation
      </div>
    );
  }

  // Build chart data based on view mode
  const data = viewMode === 'ideal'
    ? Object.entries(result.probabilities)
        .map(([state, prob]) => ({ state: `|${state}⟩`, probability: prob }))
        .sort((a, b) => a.state.localeCompare(b.state))
    : Object.entries(result.measurements)
        .map(([state, count]) => ({ state: `|${state}⟩`, probability: count / shots }))
        .sort((a, b) => a.state.localeCompare(b.state));

  const handleExportCSV = () => {
    const header = 'State,Probability\n';
    const rows = data.map(d => `${d.state},${d.probability.toFixed(6)}`).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nuclei_results.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleShotsChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val) && val >= 100 && val <= 100000) {
      setShots(val);
    }
  }, [setShots]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '8px 12px' }}>
      {/* Controls bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginBottom: 8,
        flexShrink: 0,
      }}>
        {/* View mode toggle */}
        <div style={{
          display: 'flex',
          borderRadius: 4,
          overflow: 'hidden',
          border: '1px solid #1A2A42',
        }}>
          {(['sampled', 'ideal'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              style={{
                padding: '4px 10px',
                fontSize: 11,
                fontFamily: 'Inter, sans-serif',
                border: 'none',
                cursor: 'pointer',
                background: viewMode === mode ? '#00B4D8' : '#0A1220',
                color: viewMode === mode ? '#0F1B2D' : '#3D5A80',
                fontWeight: viewMode === mode ? 600 : 400,
              }}
            >
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>

        {/* Shots control */}
        <label style={{ color: '#3D5A80', fontSize: 11, fontFamily: 'Inter, sans-serif', display: 'flex', alignItems: 'center', gap: 6 }}>
          Shots:
          <input
            type="number"
            value={shots}
            onChange={handleShotsChange}
            min={100}
            max={100000}
            step={100}
            style={{
              width: 70,
              padding: '3px 6px',
              fontSize: 11,
              fontFamily: "'Fira Code', monospace",
              background: '#0A1220',
              border: '1px solid #1A2A42',
              borderRadius: 3,
              color: '#E0E0E0',
              outline: 'none',
            }}
          />
        </label>

        <div style={{ flex: 1 }} />

        {/* Export */}
        <button
          onClick={handleExportCSV}
          style={{
            padding: '4px 10px',
            fontSize: 11,
            fontFamily: 'Inter, sans-serif',
            background: '#0A1220',
            border: '1px solid #1A2A42',
            borderRadius: 4,
            color: '#3D5A80',
            cursor: 'pointer',
          }}
        >
          Export CSV
        </button>

        {/* Execution time */}
        <span style={{ color: '#3D5A80', fontSize: 11, fontFamily: "'Fira Code', monospace" }}>
          {result.execution_time_ms.toFixed(0)}ms
        </span>
      </div>

      {/* Chart */}
      <div ref={chartRef} style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
            <XAxis
              dataKey="state"
              tick={{ fill: '#E0E0E0', fontSize: 11, fontFamily: "'Fira Code', monospace" }}
              axisLine={{ stroke: '#1A2A42' }}
              tickLine={{ stroke: '#1A2A42' }}
            />
            <YAxis
              domain={[0, 1]}
              tick={{ fill: '#3D5A80', fontSize: 11, fontFamily: "'Fira Code', monospace" }}
              axisLine={{ stroke: '#1A2A42' }}
              tickLine={{ stroke: '#1A2A42' }}
              tickFormatter={(v: number) => v.toFixed(1)}
            />
            <Tooltip
              contentStyle={{
                background: '#0A1220',
                border: '1px solid #1A2A42',
                borderRadius: 6,
                fontSize: 12,
                fontFamily: "'Fira Code', monospace",
              }}
              labelStyle={{ color: '#E0E0E0' }}
              itemStyle={{ color: '#00B4D8' }}
              formatter={(value: number) => [value.toFixed(4), 'Probability']}
            />
            <Bar dataKey="probability" radius={[4, 4, 0, 0]}>
              {data.map((_, index) => (
                <Cell key={index} fill="#00B4D8" fillOpacity={0.8} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
