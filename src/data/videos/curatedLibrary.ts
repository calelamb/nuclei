export interface CuratedVideo {
  id: string;
  youtubeId: string;
  title: string;
  creator: '3blue1brown' | 'ibm-technology' | 'nvidia' | 'qiskit' | 'other';
  duration: string;
  difficulty: 'prerequisite' | 'beginner' | 'intermediate' | 'advanced';
  topics: string[];
  description: string;
}

export const CURATED_VIDEOS: CuratedVideo[] = [
  // 3Blue1Brown - Linear algebra & math foundations
  { id: 'v-3b1b-linalg-1', youtubeId: 'fNk_zzaMoSs', title: 'Vectors, what even are they?', creator: '3blue1brown', duration: '9:52', difficulty: 'prerequisite', topics: ['linear-algebra', 'vectors'], description: 'Foundation for understanding quantum states as vectors.' },
  { id: 'v-3b1b-linalg-2', youtubeId: 'k7RM-ot2NWY', title: 'Linear combinations, span, and basis vectors', creator: '3blue1brown', duration: '9:59', difficulty: 'prerequisite', topics: ['linear-algebra', 'basis'], description: 'How basis vectors relate to qubit states |0\u27E9 and |1\u27E9.' },
  { id: 'v-3b1b-linalg-3', youtubeId: 'kYB8IZa5AuE', title: 'Linear transformations and matrices', creator: '3blue1brown', duration: '12:09', difficulty: 'prerequisite', topics: ['linear-algebra', 'matrices', 'transformations'], description: 'Quantum gates are linear transformations \u2014 this is the intuition.' },
  { id: 'v-3b1b-linalg-4', youtubeId: 'XkY2DOUCWMU', title: 'Matrix multiplication as composition', creator: '3blue1brown', duration: '10:03', difficulty: 'prerequisite', topics: ['linear-algebra', 'matrices'], description: 'Gate sequences are matrix multiplications.' },
  { id: 'v-3b1b-complex', youtubeId: 'T647CGsuOVU', title: 'e^(i\u03C0) in 3.14 minutes', creator: '3blue1brown', duration: '3:14', difficulty: 'prerequisite', topics: ['complex-numbers', 'euler'], description: 'Complex exponentials are the heart of quantum phase.' },

  // IBM Technology - Quantum concepts explained
  { id: 'v-ibm-5levels', youtubeId: 'OWJCfOvochA', title: 'Quantum Computing Expert Explains One Concept in 5 Levels of Difficulty', creator: 'ibm-technology', duration: '17:43', difficulty: 'beginner', topics: ['quantum-basics', 'superposition', 'entanglement'], description: 'Wired challenge: IBM researcher explains quantum computing from child to expert.' },
  { id: 'v-ibm-qubit', youtubeId: 'QuR969uMICM', title: 'What Is A Qubit?', creator: 'ibm-technology', duration: '6:32', difficulty: 'beginner', topics: ['qubit', 'superposition', 'bloch-sphere'], description: 'IBM explains the fundamental unit of quantum information.' },
  { id: 'v-ibm-entangle', youtubeId: 'rle42cVAlEI', title: 'Quantum Entanglement Explained', creator: 'ibm-technology', duration: '7:15', difficulty: 'beginner', topics: ['entanglement', 'bell-state'], description: 'How entanglement works and why Einstein called it "spooky action."' },
  { id: 'v-ibm-gates', youtubeId: 'tsbCSkvHhMo', title: 'Quantum Gates Explained', creator: 'ibm-technology', duration: '8:22', difficulty: 'beginner', topics: ['gates', 'hadamard', 'cnot', 'pauli'], description: 'The building blocks of quantum circuits.' },
  { id: 'v-ibm-error', youtubeId: 'v7b4J2INq9c', title: 'Quantum Error Correction Explained', creator: 'ibm-technology', duration: '10:05', difficulty: 'intermediate', topics: ['error-correction', 'fault-tolerance'], description: 'Why quantum computers need error correction and how it works.' },

  // NVIDIA - CUDA-Q and hybrid computing
  { id: 'v-nvidia-cudaq', youtubeId: 'rQkBLilFbY4', title: 'Introduction to CUDA-Q', creator: 'nvidia', duration: '12:30', difficulty: 'intermediate', topics: ['cuda-q', 'hybrid-computing', 'gpu'], description: 'NVIDIA\'s platform for hybrid quantum-classical computing.' },
  { id: 'v-nvidia-hybrid', youtubeId: '2pBGEbIHbEg', title: 'The Future of Quantum Computing with GPUs', creator: 'nvidia', duration: '15:20', difficulty: 'intermediate', topics: ['hybrid-computing', 'gpu-acceleration', 'simulation'], description: 'How GPUs accelerate quantum circuit simulation.' },
  { id: 'v-nvidia-qaoa', youtubeId: 'JOmQRsaFMJo', title: 'Solving Optimization with QAOA', creator: 'nvidia', duration: '18:45', difficulty: 'advanced', topics: ['qaoa', 'maxcut', 'optimization'], description: 'QAOA for combinatorial optimization \u2014 directly relevant to MaxCut challenges.' },

  // Qiskit - Official tutorials
  { id: 'v-qiskit-hello', youtubeId: 'RrUTwq5jKM4', title: 'Hello World with Qiskit', creator: 'qiskit', duration: '8:15', difficulty: 'beginner', topics: ['qiskit', 'getting-started', 'circuit'], description: 'Your first quantum circuit in Qiskit.' },
  { id: 'v-qiskit-bell', youtubeId: 'f3CLdRl2TSY', title: 'Creating Bell States in Qiskit', creator: 'qiskit', duration: '6:30', difficulty: 'beginner', topics: ['qiskit', 'bell-state', 'entanglement'], description: 'Build and measure the four Bell states step by step.' },
  { id: 'v-qiskit-grover', youtubeId: '0RPFWZj7Jm0', title: "Grover's Algorithm Tutorial", creator: 'qiskit', duration: '14:20', difficulty: 'intermediate', topics: ['qiskit', 'grovers', 'search', 'oracle'], description: 'Implement Grover\'s search algorithm from scratch.' },
  { id: 'v-qiskit-teleport', youtubeId: 'mMwBMcKBHjc', title: 'Quantum Teleportation in Qiskit', creator: 'qiskit', duration: '11:45', difficulty: 'intermediate', topics: ['qiskit', 'teleportation', 'bell-state'], description: 'Build the quantum teleportation protocol step by step.' },
  { id: 'v-qiskit-vqe', youtubeId: 'Z-A6G0WVI9w', title: 'Variational Quantum Eigensolver (VQE)', creator: 'qiskit', duration: '16:30', difficulty: 'advanced', topics: ['qiskit', 'vqe', 'variational', 'chemistry'], description: 'Using VQE to find ground state energies of molecules.' },
];

export function getVideosByTopic(topic: string): CuratedVideo[] {
  return CURATED_VIDEOS.filter((v) => v.topics.includes(topic));
}

export function getVideosByCreator(creator: CuratedVideo['creator']): CuratedVideo[] {
  return CURATED_VIDEOS.filter((v) => v.creator === creator);
}

export function getVideosByDifficulty(difficulty: CuratedVideo['difficulty']): CuratedVideo[] {
  return CURATED_VIDEOS.filter((v) => v.difficulty === difficulty);
}
