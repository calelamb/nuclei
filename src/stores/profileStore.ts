import { create } from 'zustand';

const STORAGE_KEY = 'nuclei-profile';

interface ProfileData {
  displayName: string;
  circuitsShared: number;
  exercisesCompleted: number;
  currentStreak: number;
  longestStreak: number;
  badgesEarned: string[];
  joinedAt: string;
  lastActivityDate: string | null;
}

interface ProfileState extends ProfileData {
  setDisplayName: (name: string) => void;
  incrementCircuitsShared: () => void;
  incrementExercisesCompleted: () => void;
  updateStreak: () => void;
  awardBadge: (badgeId: string) => void;
}

function loadProfile(): ProfileData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return {
    displayName: 'Quantum Explorer',
    circuitsShared: 0,
    exercisesCompleted: 0,
    currentStreak: 0,
    longestStreak: 0,
    badgesEarned: [],
    joinedAt: new Date().toISOString(),
    lastActivityDate: null,
  };
}

function persist(state: ProfileData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function extractData(s: ProfileState): ProfileData {
  return {
    displayName: s.displayName,
    circuitsShared: s.circuitsShared,
    exercisesCompleted: s.exercisesCompleted,
    currentStreak: s.currentStreak,
    longestStreak: s.longestStreak,
    badgesEarned: s.badgesEarned,
    joinedAt: s.joinedAt,
    lastActivityDate: s.lastActivityDate,
  };
}

export const useProfileStore = create<ProfileState>((set) => {
  const initial = loadProfile();
  return {
    ...initial,

    setDisplayName: (name) =>
      set((s) => {
        const next = { ...extractData(s), displayName: name };
        persist(next);
        return { displayName: name };
      }),

    incrementCircuitsShared: () =>
      set((s) => {
        const val = s.circuitsShared + 1;
        const next = { ...extractData(s), circuitsShared: val };
        persist(next);
        return { circuitsShared: val };
      }),

    incrementExercisesCompleted: () =>
      set((s) => {
        const val = s.exercisesCompleted + 1;
        const next = { ...extractData(s), exercisesCompleted: val };
        persist(next);
        return { exercisesCompleted: val };
      }),

    updateStreak: () =>
      set((s) => {
        const today = new Date().toISOString().slice(0, 10);
        const last = s.lastActivityDate;

        if (last === today) return {};

        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        let newStreak: number;
        if (last === yesterday) {
          newStreak = s.currentStreak + 1;
        } else {
          newStreak = 1;
        }
        const newLongest = Math.max(s.longestStreak, newStreak);
        const next = {
          ...extractData(s),
          currentStreak: newStreak,
          longestStreak: newLongest,
          lastActivityDate: today,
        };
        persist(next);
        return { currentStreak: newStreak, longestStreak: newLongest, lastActivityDate: today };
      }),

    awardBadge: (badgeId) =>
      set((s) => {
        if (s.badgesEarned.includes(badgeId)) return {};
        const earned = [...s.badgesEarned, badgeId];
        const next = { ...extractData(s), badgesEarned: earned };
        persist(next);
        return { badgesEarned: earned };
      }),
  };
});
