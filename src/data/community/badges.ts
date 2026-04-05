export interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'learning' | 'building' | 'community' | 'hardware';
  criteria: string;
}

export const BADGES: Badge[] = [
  {
    id: 'first-circuit',
    name: 'First Circuit',
    description: 'Ran your first quantum simulation',
    icon: 'Atom',
    category: 'learning',
    criteria: 'Run a quantum simulation for the first time using any supported framework.',
  },
  {
    id: 'bell-ringer',
    name: 'Bell Ringer',
    description: 'Built a Bell state circuit',
    icon: 'Bell',
    category: 'building',
    criteria: 'Create and successfully simulate a circuit that produces a Bell state (|00> + |11>) / sqrt(2).',
  },
  {
    id: 'entangler',
    name: 'Entangler',
    description: 'Mastered entanglement concepts',
    icon: 'Link',
    category: 'learning',
    criteria: 'Complete all exercises in the entanglement module of the learning paths.',
  },
  {
    id: 'superposition-explorer',
    name: 'Superposition Explorer',
    description: 'Completed all superposition exercises',
    icon: 'Layers',
    category: 'learning',
    criteria: 'Complete every exercise in the superposition section across all learning paths.',
  },
  {
    id: 'algorithm-designer',
    name: 'Algorithm Designer',
    description: 'Completed the algorithms learning path',
    icon: 'BrainCircuit',
    category: 'learning',
    criteria: 'Finish all modules and exercises in the Quantum Algorithms learning path.',
  },
  {
    id: 'error-detective',
    name: 'Error Detective',
    description: 'Fixed 10 quantum circuit errors',
    icon: 'Bug',
    category: 'building',
    criteria: 'Successfully resolve 10 circuit errors identified by Dirac or the editor diagnostics.',
  },
  {
    id: 'hardware-hacker',
    name: 'Hardware Hacker',
    description: 'Ran a circuit on real quantum hardware',
    icon: 'Server',
    category: 'hardware',
    criteria: 'Submit and receive results from a real quantum hardware backend (IBM, Google, or IonQ).',
  },
  {
    id: 'speed-demon',
    name: 'Speed Demon',
    description: 'Completed 5 exercises in a single session',
    icon: 'Zap',
    category: 'learning',
    criteria: 'Complete 5 or more exercises without closing the application.',
  },
  {
    id: 'teacher',
    name: 'Teacher',
    description: 'Shared a circuit that got 10+ likes',
    icon: 'Heart',
    category: 'community',
    criteria: 'Share a circuit to the community gallery and receive at least 10 likes from other users.',
  },
  {
    id: 'contributor',
    name: 'Contributor',
    description: 'Shared 5+ circuits to the gallery',
    icon: 'Upload',
    category: 'community',
    criteria: 'Publish 5 or more circuits to the community gallery.',
  },
  {
    id: 'streak-keeper',
    name: 'Streak Keeper',
    description: 'Maintained a 7-day coding streak',
    icon: 'Flame',
    category: 'building',
    criteria: 'Write and run quantum code on 7 consecutive days.',
  },
  {
    id: 'quantum-explorer',
    name: 'Quantum Explorer',
    description: 'Completed all learning paths',
    icon: 'Map',
    category: 'learning',
    criteria: 'Finish every available learning path in the Nuclei learning system.',
  },
  {
    id: 'capstone-graduate',
    name: 'Capstone Graduate',
    description: 'Completed a capstone project',
    icon: 'GraduationCap',
    category: 'learning',
    criteria: 'Successfully complete and submit a capstone project for review.',
  },
];
