import { useState, useMemo, type ReactNode } from 'react';
import {
  ChevronDown, ChevronRight, Users, BookOpen, TrendingUp,
  Plus, Trash2, Edit2, Check,
} from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useEducatorStore, type Assignment } from '../../stores/educatorStore';
import { AssignmentCreator } from './AssignmentCreator';
import { ProgressReport } from './ProgressReport';

/* ── Collapsible Section (matches SettingsPanel pattern) ── */

function Section({ title, icon: Icon, defaultOpen = false, children }: {
  title: string; icon?: React.ComponentType<{ size: number }>; defaultOpen?: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const colors = useThemeStore((s) => s.colors);
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div style={{ borderBottom: `1px solid ${colors.border}` }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 6,
          padding: '8px 12px', border: 'none', background: 'transparent',
          cursor: 'pointer', color: colors.textMuted,
        }}
      >
        <Chevron size={12} />
        {Icon && <Icon size={12} />}
        <span style={{
          fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
          letterSpacing: 0.5, fontFamily: "'Geist Sans', sans-serif",
        }}>
          {title}
        </span>
      </button>
      <div style={{
        overflow: 'hidden',
        maxHeight: open ? 2000 : 0,
        transition: 'max-height 0.25s ease',
      }}>
        <div style={{ padding: '0 12px 10px' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/* ── Main ClassroomPanel ─────────────────────────────────── */

export function ClassroomPanel() {
  const colors = useThemeStore((s) => s.colors);
  const font = "'Geist Sans', sans-serif";

  const isEducator = useEducatorStore((s) => s.isEducator);
  const classroomName = useEducatorStore((s) => s.classroomName);
  const students = useEducatorStore((s) => s.students);
  const assignments = useEducatorStore((s) => s.assignments);
  const setEducatorMode = useEducatorStore((s) => s.setEducatorMode);
  const setClassroomName = useEducatorStore((s) => s.setClassroomName);
  const addStudent = useEducatorStore((s) => s.addStudent);
  const removeStudent = useEducatorStore((s) => s.removeStudent);
  const addAssignment = useEducatorStore((s) => s.addAssignment);
  const removeAssignment = useEducatorStore((s) => s.removeAssignment);

  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(classroomName);
  const [newStudentName, setNewStudentName] = useState('');
  const [showCreator, setShowCreator] = useState(false);

  const avgCompletion = useMemo(() => {
    if (students.length === 0 || assignments.length === 0) return 0;
    const totalExercises = assignments.reduce((acc, a) => acc + a.exerciseIds.length, 0);
    if (totalExercises === 0) return 0;
    const totalDone = students.reduce((acc, st) => {
      const done = assignments.reduce((a2, a) =>
        a2 + a.exerciseIds.filter((eid) => st.exercisesCompleted.includes(eid)).length, 0
      );
      return acc + done;
    }, 0);
    return Math.round((totalDone / (totalExercises * students.length)) * 100);
  }, [students, assignments]);

  if (!isEducator) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', padding: 32, gap: 16, fontFamily: font,
      }}>
        <Users size={36} color={colors.textDim} strokeWidth={1} />
        <span style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>
          Educator Tools
        </span>
        <span style={{
          fontSize: 11, color: colors.textMuted, textAlign: 'center', lineHeight: 1.5,
        }}>
          Enable educator mode to manage classrooms, create assignments, and track student progress.
        </span>
        <button
          onClick={() => setEducatorMode(true)}
          style={{
            fontSize: 11, fontWeight: 500, fontFamily: font,
            padding: '7px 16px', borderRadius: 4,
            border: 'none',
            background: colors.accent,
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          Enable Educator Mode
        </button>
      </div>
    );
  }

  const handleNameSave = () => {
    setClassroomName(nameInput.trim());
    setEditingName(false);
  };

  const handleAddStudent = () => {
    const name = newStudentName.trim();
    if (!name) return;
    addStudent({
      id: `stu-${Date.now()}`,
      name,
      exercisesCompleted: [],
      lastActive: new Date().toISOString(),
    });
    setNewStudentName('');
  };

  const handleSaveAssignment = (assignment: Assignment) => {
    addAssignment(assignment);
    setShowCreator(false);
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch { return iso; }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: font }}>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Classroom name header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '10px 12px',
          borderBottom: `1px solid ${colors.border}`,
        }}>
          {editingName ? (
            <>
              <input
                autoFocus
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleNameSave(); }}
                placeholder="Classroom name..."
                style={{
                  flex: 1, padding: '4px 8px', fontSize: 13, fontWeight: 600,
                  fontFamily: font, background: colors.bg,
                  border: `1px solid ${colors.accent}`,
                  borderRadius: 4, color: colors.text, outline: 'none',
                }}
              />
              <button
                onClick={handleNameSave}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: colors.accent, padding: 4, display: 'flex',
                }}
              >
                <Check size={14} />
              </button>
            </>
          ) : (
            <>
              <span style={{
                flex: 1, fontSize: 13, fontWeight: 600, color: colors.text,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {classroomName || 'Untitled Classroom'}
              </span>
              <button
                onClick={() => { setNameInput(classroomName); setEditingName(true); }}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: colors.textDim, padding: 4, display: 'flex',
                }}
              >
                <Edit2 size={12} />
              </button>
            </>
          )}
        </div>

        {/* Stats bar */}
        <div style={{
          display: 'flex', gap: 0,
          borderBottom: `1px solid ${colors.border}`,
        }}>
          {[
            { label: 'Students', value: students.length, icon: Users, color: colors.accent },
            { label: 'Assignments', value: assignments.length, icon: BookOpen, color: colors.info },
            { label: 'Avg Completion', value: `${avgCompletion}%`, icon: TrendingUp, color: colors.success },
          ].map((stat, i) => (
            <div key={stat.label} style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', padding: '8px 4px', gap: 2,
              borderRight: i < 2 ? `1px solid ${colors.border}` : 'none',
            }}>
              <stat.icon size={13} color={stat.color} />
              <span style={{ fontSize: 14, fontWeight: 700, color: colors.text }}>
                {stat.value}
              </span>
              <span style={{ fontSize: 9, color: colors.textDim, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                {stat.label}
              </span>
            </div>
          ))}
        </div>

        {/* Students section */}
        <Section title="Students" icon={Users} defaultOpen>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {students.length === 0 && (
              <div style={{ fontSize: 11, color: colors.textDim, padding: '4px 0 8px' }}>
                No students added yet.
              </div>
            )}
            {students.map((st) => (
              <div key={st.id} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 0',
                borderBottom: `1px solid ${colors.border}`,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 12, fontWeight: 500, color: colors.text,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {st.name}
                  </div>
                  <div style={{ fontSize: 10, color: colors.textDim, marginTop: 1 }}>
                    {st.exercisesCompleted.length} exercises &middot; {formatDate(st.lastActive)}
                  </div>
                </div>
                <button
                  onClick={() => removeStudent(st.id)}
                  style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    color: colors.textDim, padding: 4, display: 'flex', borderRadius: 3,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = colors.error; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = colors.textDim; }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}

            {/* Add student row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
              <input
                value={newStudentName}
                onChange={(e) => setNewStudentName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddStudent(); }}
                placeholder="Student name..."
                style={{
                  flex: 1, padding: '5px 8px', fontSize: 11, fontFamily: font,
                  background: colors.bg, border: `1px solid ${colors.border}`,
                  borderRadius: 4, color: colors.text, outline: 'none',
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = colors.accent; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = colors.border; }}
              />
              <button
                onClick={handleAddStudent}
                style={{
                  display: 'flex', alignItems: 'center', gap: 3,
                  fontSize: 10, fontWeight: 500, fontFamily: font,
                  padding: '5px 8px', borderRadius: 4,
                  border: 'none',
                  background: colors.accent,
                  color: '#fff',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                <Plus size={11} />
                Add
              </button>
            </div>
          </div>
        </Section>

        {/* Assignments section */}
        <Section title="Assignments" icon={BookOpen} defaultOpen>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {assignments.length === 0 && (
              <div style={{ fontSize: 11, color: colors.textDim, padding: '4px 0 8px' }}>
                No assignments created yet.
              </div>
            )}
            {assignments.map((a) => (
              <div key={a.id} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 0',
                borderBottom: `1px solid ${colors.border}`,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 12, fontWeight: 500, color: colors.text,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {a.title}
                  </div>
                  <div style={{ fontSize: 10, color: colors.textDim, marginTop: 1 }}>
                    {a.exerciseIds.length} exercises
                    {a.dueDate && <> &middot; Due {formatDate(a.dueDate)}</>}
                  </div>
                </div>
                <button
                  onClick={() => removeAssignment(a.id)}
                  style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    color: colors.textDim, padding: 4, display: 'flex', borderRadius: 3,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = colors.error; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = colors.textDim; }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}

            <button
              onClick={() => setShowCreator(true)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: 4, marginTop: 8,
                width: '100%', padding: '6px 0', borderRadius: 4,
                border: `1px dashed ${colors.border}`,
                background: 'transparent',
                color: colors.textMuted, fontSize: 11, fontFamily: font,
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
              <Plus size={12} />
              Create Assignment
            </button>
          </div>
        </Section>

        {/* Progress section */}
        <Section title="Progress Report" icon={TrendingUp}>
          <ProgressReport students={students} assignments={assignments} />
        </Section>
      </div>

      {/* Footer: disable educator mode */}
      <div style={{ padding: 12, borderTop: `1px solid ${colors.border}`, flexShrink: 0 }}>
        <button
          onClick={() => setEducatorMode(false)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 6, padding: '6px 0', border: `1px solid ${colors.border}`,
            borderRadius: 4, background: 'transparent', color: colors.textMuted,
            fontSize: 11, cursor: 'pointer', fontFamily: font,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = colors.error;
            e.currentTarget.style.color = colors.error;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = colors.border;
            e.currentTarget.style.color = colors.textMuted;
          }}
        >
          Disable Educator Mode
        </button>
      </div>

      {/* Assignment creator modal */}
      {showCreator && (
        <AssignmentCreator
          onClose={() => setShowCreator(false)}
          onSave={handleSaveAssignment}
        />
      )}
    </div>
  );
}
