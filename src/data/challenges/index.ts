import type { QuantumChallenge } from '../../types/challenge';
import { bellStateFactory } from './bellStateFactory';
import { uniformSuperposition } from './uniformSuperposition';
import { quantumParity } from './quantumParity';
import { maxcutSmall } from './maxcutSmall';
import { bernsteinVazirani } from './bernsteinVazirani';
import { quantumTeleportation } from './quantumTeleportation';
import { groversSearch } from './groversSearch';
import { maxcutWeighted } from './maxcutWeighted';
import { quantumPhaseEstimation } from './quantumPhaseEstimation';
import { simonsAlgorithm } from './simonsAlgorithm';

export const QUANTUM_CHALLENGES: QuantumChallenge[] = [
  // Easy
  bellStateFactory,
  uniformSuperposition,
  quantumParity,
  // Medium
  maxcutSmall,
  bernsteinVazirani,
  quantumTeleportation,
  groversSearch,
  // Hard
  maxcutWeighted,
  quantumPhaseEstimation,
  simonsAlgorithm,
];

export {
  bellStateFactory,
  uniformSuperposition,
  quantumParity,
  maxcutSmall,
  bernsteinVazirani,
  quantumTeleportation,
  groversSearch,
  maxcutWeighted,
  quantumPhaseEstimation,
  simonsAlgorithm,
};
