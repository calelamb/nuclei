import { useMemo } from 'react';
import { Download, Check, Minus, Clock } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import type { Student, Assignment } from '../../stores/educatorStore';

interface ProgressReportProps {
  students: Student[];
  assignments: Assignment[];
}

export function ProgressReport({ students, assignments }: ProgressReportProps) {
  const colors = useThemeStore((s) => s.colors);
  const font = "'Geist Sans', sans-serif";

  // Compute per-cell status: 'complete' | 'partial' | 'none'
  const grid = useMemo(() => {
    return students.map((student) =>
      assignments.map((assignment) => {
        const total = assignment.exerciseIds.length;
        if (total === 0) return 'none' as const;
        const done = assignment.exerciseIds.filter((eid) =>
          student.exercisesCompleted.includes(eid)
        ).length;
        if (done === total) return 'complete' as const;
        if (done > 0) return 'partial' as const;
        return 'none' as const;
      })
    );
  }, [students, assignments]);

  // Summary row: overall completion per assignment
  const summaryPcts = useMemo(() => {
    if (students.length === 0) return assignments.map(() => 0);
    return assignments.map((assignment) => {
      const total = assignment.exerciseIds.length * students.length;
      if (total === 0) return 0;
      const done = students.reduce((acc, student) => {
        return acc + assignment.exerciseIds.filter((eid) =>
          student.exercisesCompleted.includes(eid)
        ).length;
      }, 0);
      return Math.round((done / total) * 100);
    });
  }, [students, assignments]);

  const handleExportCSV = () => {
    const headers = ['Student', ...assignments.map((a) => a.title)];
    const rows = students.map((student, sIdx) => {
      const cells = assignments.map((_assignment, aIdx) => {
        const status = grid[sIdx][aIdx];
        if (status === 'complete') return 'Complete';
        if (status === 'partial') return 'Partial';
        return 'Not Started';
      });
      return [student.name, ...cells];
    });
    const summaryRow = ['OVERALL %', ...summaryPcts.map((p) => `${p}%`)];

    const csvContent = [headers, ...rows, summaryRow]
      .map((row) => row.map((cell) => `"${cell}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nuclei-progress-report.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const statusIcon = (status: 'complete' | 'partial' | 'none') => {
    if (status === 'complete') return <Check size={12} color={colors.success} strokeWidth={2.5} />;
    if (status === 'partial') return <Clock size={12} color={colors.warning} strokeWidth={2} />;
    return <Minus size={12} color={colors.textDim} strokeWidth={1.5} />;
  };

  const statusBg = (status: 'complete' | 'partial' | 'none') => {
    if (status === 'complete') return `${colors.success}15`;
    if (status === 'partial') return `${colors.warning}15`;
    return 'transparent';
  };

  if (students.length === 0 || assignments.length === 0) {
    return (
      <div style={{
        padding: 16, textAlign: 'center',
        fontSize: 11, color: colors.textDim, fontFamily: font,
      }}>
        Add students and assignments to see progress data.
      </div>
    );
  }

  return (
    <div style={{ fontFamily: font }}>
      {/* Export button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 0 8px' }}>
        <button
          onClick={handleExportCSV}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            fontSize: 10, fontWeight: 500, fontFamily: font,
            padding: '4px 8px', borderRadius: 4,
            border: `1px solid ${colors.border}`,
            background: 'transparent', color: colors.textMuted,
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = colors.accent;
            e.currentTarget.style.color = colors.accent;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = colors.border;
            e.currentTarget.style.color = colors.textMuted;
          }}
        >
          <Download size={11} />
          Export CSV
        </button>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{
          width: '100%', borderCollapse: 'collapse', fontSize: 11,
        }}>
          <thead>
            <tr>
              <th style={{
                textAlign: 'left', padding: '6px 8px',
                fontSize: 10, fontWeight: 600, color: colors.textMuted,
                textTransform: 'uppercase', letterSpacing: 0.4,
                borderBottom: `1px solid ${colors.borderStrong}`,
                position: 'sticky', left: 0,
                background: colors.bgElevated,
              }}>
                Student
              </th>
              {assignments.map((a) => (
                <th key={a.id} style={{
                  textAlign: 'center', padding: '6px 8px',
                  fontSize: 10, fontWeight: 600, color: colors.textMuted,
                  textTransform: 'uppercase', letterSpacing: 0.4,
                  borderBottom: `1px solid ${colors.borderStrong}`,
                  maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {a.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {students.map((student, sIdx) => (
              <tr key={student.id}>
                <td style={{
                  padding: '6px 8px', color: colors.text, fontWeight: 500,
                  borderBottom: `1px solid ${colors.border}`,
                  position: 'sticky', left: 0,
                  background: colors.bgElevated,
                  whiteSpace: 'nowrap',
                }}>
                  {student.name}
                </td>
                {assignments.map((a, aIdx) => {
                  const status = grid[sIdx][aIdx];
                  return (
                    <td key={a.id} style={{
                      textAlign: 'center', padding: '6px 8px',
                      borderBottom: `1px solid ${colors.border}`,
                      background: statusBg(status),
                    }}>
                      {statusIcon(status)}
                    </td>
                  );
                })}
              </tr>
            ))}

            {/* Summary row */}
            <tr>
              <td style={{
                padding: '6px 8px', fontWeight: 600, color: colors.textMuted,
                fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4,
                borderTop: `1px solid ${colors.borderStrong}`,
                position: 'sticky', left: 0,
                background: colors.bgElevated,
              }}>
                Completion
              </td>
              {summaryPcts.map((pct, i) => (
                <td key={i} style={{
                  textAlign: 'center', padding: '6px 8px',
                  fontWeight: 600, fontSize: 11,
                  color: pct >= 80 ? colors.success : pct >= 40 ? colors.warning : colors.textDim,
                  borderTop: `1px solid ${colors.borderStrong}`,
                }}>
                  {pct}%
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
