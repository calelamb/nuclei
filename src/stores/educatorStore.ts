import { create } from 'zustand';

export interface Student {
  id: string;
  name: string;
  exercisesCompleted: string[];
  lastActive: string;
}

export interface Assignment {
  id: string;
  title: string;
  description: string;
  exerciseIds: string[];
  dueDate: string;
  createdAt: string;
}

interface EducatorState {
  isEducator: boolean;
  classroomName: string;
  students: Student[];
  assignments: Assignment[];
  // Actions
  setEducatorMode: (enabled: boolean) => void;
  setClassroomName: (name: string) => void;
  addStudent: (student: Student) => void;
  removeStudent: (id: string) => void;
  addAssignment: (assignment: Assignment) => void;
  removeAssignment: (id: string) => void;
  updateStudentProgress: (studentId: string, exerciseId: string) => void;
}

const STORAGE_KEY = 'nuclei-educator';

function loadState(): Partial<EducatorState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

function persist(state: EducatorState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      isEducator: state.isEducator,
      classroomName: state.classroomName,
      students: state.students,
      assignments: state.assignments,
    }));
  } catch { /* ignore */ }
}

export const useEducatorStore = create<EducatorState>((set, get) => {
  const saved = loadState();
  return {
    isEducator: saved.isEducator ?? false,
    classroomName: saved.classroomName ?? '',
    students: saved.students ?? [],
    assignments: saved.assignments ?? [],

    setEducatorMode: (enabled) => {
      set({ isEducator: enabled });
      persist(get());
    },

    setClassroomName: (name) => {
      set({ classroomName: name });
      persist(get());
    },

    addStudent: (student) => {
      set((s) => ({ students: [...s.students, student] }));
      persist(get());
    },

    removeStudent: (id) => {
      set((s) => ({ students: s.students.filter((st) => st.id !== id) }));
      persist(get());
    },

    addAssignment: (assignment) => {
      set((s) => ({ assignments: [...s.assignments, assignment] }));
      persist(get());
    },

    removeAssignment: (id) => {
      set((s) => ({ assignments: s.assignments.filter((a) => a.id !== id) }));
      persist(get());
    },

    updateStudentProgress: (studentId, exerciseId) => {
      set((s) => ({
        students: s.students.map((st) =>
          st.id === studentId
            ? {
                ...st,
                exercisesCompleted: st.exercisesCompleted.includes(exerciseId)
                  ? st.exercisesCompleted
                  : [...st.exercisesCompleted, exerciseId],
                lastActive: new Date().toISOString(),
              }
            : st
        ),
      }));
      persist(get());
    },
  };
});
