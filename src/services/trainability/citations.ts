/** Foundational references behind each Trainability Lab analysis. */

export interface TrainabilityCitation {
  id: string;
  label: string;
  url: string;
  /** Short note on what the reference supports in the Lab. */
  supports: string;
}

export const TRAINABILITY_CITATIONS: readonly TrainabilityCitation[] = Object.freeze([
  {
    id: 'mcclean2018',
    label: 'McClean et al., Nat. Commun. 9, 4812 (2018)',
    url: 'https://doi.org/10.1038/s41467-018-07090-4',
    supports: 'Barren plateaus in parameterized quantum circuits; gradient-variance scaling.',
  },
  {
    id: 'cerezo2021',
    label: 'Cerezo et al., Nat. Commun. 12, 1791 (2021)',
    url: 'https://doi.org/10.1038/s41467-021-21728-w',
    supports: 'Cost-function-dependent barren plateaus (global vs local costs).',
  },
  {
    id: 'ragone2024',
    label: 'Ragone et al., Nat. Commun. 15, 7172 (2024)',
    url: 'https://doi.org/10.1038/s41467-024-49909-3',
    supports: 'Lie-algebraic variance formula and g-purities.',
  },
  {
    id: 'larocca2023',
    label: 'Larocca et al., Nat. Comput. Sci. 3, 542 (2023)',
    url: 'https://doi.org/10.1038/s43588-023-00467-6',
    supports: 'Overparameterization and the dimension of the dynamical Lie algebra.',
  },
  {
    id: 'goh2023',
    label: 'Goh et al., arXiv:2308.01432 (2023)',
    url: 'https://arxiv.org/abs/2308.01432',
    supports: 'Lie-algebraic classical simulation (𝔤-sim).',
  },
  {
    id: 'sim2019',
    label: 'Sim, Johnson & Aspuru-Guzik, Adv. Quantum Technol. 2, 1900070 (2019)',
    url: 'https://doi.org/10.1002/qute.201900070',
    supports: 'Expressibility (KL to Haar) and entangling capability of circuits.',
  },
  {
    id: 'meyer2002',
    label: 'Meyer & Wallach, J. Math. Phys. 43, 4273 (2002)',
    url: 'https://doi.org/10.1063/1.1497700',
    supports: 'Meyer–Wallach global entanglement measure.',
  },
  {
    id: 'cerezo2023',
    label: 'Cerezo et al., arXiv:2312.09121 (2023)',
    url: 'https://arxiv.org/abs/2312.09121',
    supports: 'Does provable absence of barren plateaus imply classical simulability?',
  },
]);
