import { useState } from 'react';
import { X } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { getExercisesByTopic } from '../../data/exercises/index';
import type { Assignment } from '../../stores/educatorStore';

interface AssignmentCreatorProps {
  onClose: () => void;
  onSave: (assignment: Assignment) => void;
}

export function AssignmentCreator({ onClose, onSave }: AssignmentCreatorProps) {
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const exercisesByTopic = getExercisesByTopic();
  const font = "'Geist Sans', sans-serif";

  const toggleExercise = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = () => {
    if (!title.trim()) return;
    onSave({
      id: `assign-${Date.now()}`,
      title: title.trim(),
      description: description.trim(),
      exerciseIds: Array.from(selectedIds),
      dueDate,
      createdAt: new Date().toISOString(),
    });
  };

  const inputStyle = {
    width: '100%',
    padding: '7px 10px',
    fontSize: 12,
    fontFamily: font,
    background: colors.bg,
    border: `1px solid ${colors.border}`,
    borderRadius: 4,
    color: colors.text,
    outline: 'none',
    boxSizing: 'border-box' as const,
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
        fontFamily: font,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: 440,
        maxHeight: '80vh',
        background: colors.bgElevated,
        borderRadius: 10,
        boxShadow: shadow.lg,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: `1px solid ${colors.border}`,
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>
            Create Assignment
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: colors.textDim, padding: 4, display: 'flex', borderRadius: 3,
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Title */}
          <div>
            <label style={{ fontSize: 10, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Title
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Assignment title..."
              style={{ ...inputStyle, marginTop: 4 }}
              onFocus={(e) => { e.currentTarget.style.borderColor = colors.accent; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = colors.border; }}
            />
          </div>

          {/* Description */}
          <div>
            <label style={{ fontSize: 10, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the assignment..."
              rows={3}
              style={{ ...inputStyle, marginTop: 4, resize: 'vertical' }}
              onFocus={(e) => { e.currentTarget.style.borderColor = colors.accent; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = colors.border; }}
            />
          </div>

          {/* Due date */}
          <div>
            <label style={{ fontSize: 10, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Due Date
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              style={{ ...inputStyle, marginTop: 4 }}
            />
          </div>

          {/* Exercise selector */}
          <div>
            <label style={{ fontSize: 10, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Exercises ({selectedIds.size} selected)
            </label>
            <div style={{
              marginTop: 6, maxHeight: 220, overflowY: 'auto',
              border: `1px solid ${colors.border}`, borderRadius: 4,
              background: colors.bg,
            }}>
              {Object.entries(exercisesByTopic).map(([topic, exercises]) => (
                <div key={topic}>
                  <div style={{
                    fontSize: 10, fontWeight: 600, color: colors.textMuted,
                    padding: '6px 10px 4px',
                    textTransform: 'uppercase', letterSpacing: 0.4,
                    background: colors.bgElevated,
                    borderBottom: `1px solid ${colors.border}`,
                  }}>
                    {topic}
                  </div>
                  {exercises.map((ex) => (
                    <label
                      key={ex.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '5px 10px',
                        cursor: 'pointer',
                        borderBottom: `1px solid ${colors.border}`,
                        fontSize: 11,
                        color: colors.text,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(ex.id)}
                        onChange={() => toggleExercise(ex.id)}
                        style={{ accentColor: colors.accent, cursor: 'pointer' }}
                      />
                      <span style={{ flex: 1 }}>{ex.title}</span>
                      <span style={{
                        fontSize: 9, color: colors.textDim,
                        padding: '1px 5px', borderRadius: 3,
                        background: colors.bgElevated,
                      }}>
                        {ex.difficulty}
                      </span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: 8,
          padding: '12px 16px',
          borderTop: `1px solid ${colors.border}`,
        }}>
          <button
            onClick={onClose}
            style={{
              fontSize: 11, fontWeight: 500, fontFamily: font,
              padding: '6px 14px', borderRadius: 4,
              border: `1px solid ${colors.border}`,
              background: 'transparent', color: colors.textMuted,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!title.trim()}
            style={{
              fontSize: 11, fontWeight: 500, fontFamily: font,
              padding: '6px 14px', borderRadius: 4,
              border: 'none',
              background: title.trim() ? colors.accent : colors.borderStrong,
              color: title.trim() ? '#fff' : colors.textDim,
              cursor: title.trim() ? 'pointer' : 'default',
            }}
          >
            Save Assignment
          </button>
        </div>
      </div>
    </div>
  );
}
