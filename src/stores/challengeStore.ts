import { create } from 'zustand';
import type { Challenge, LeaderboardEntry } from '../data/community/mockChallenges';

interface ChallengeState {
  challenges: Challenge[];
  activeChallenge: Challenge | null;
  leaderboard: LeaderboardEntry[];
  setChallenges: (challenges: Challenge[]) => void;
  setActiveChallenge: (challenge: Challenge | null) => void;
  setLeaderboard: (entries: LeaderboardEntry[]) => void;
}

export const useChallengeStore = create<ChallengeState>((set) => ({
  challenges: [],
  activeChallenge: null,
  leaderboard: [],
  setChallenges: (challenges) => set({ challenges }),
  setActiveChallenge: (challenge) => set({ activeChallenge: challenge }),
  setLeaderboard: (entries) => set({ leaderboard: entries }),
}));
