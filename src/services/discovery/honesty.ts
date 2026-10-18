/** Mandatory honesty copy (PRD 14 addendum §B, §C and PRD §1). */

export const FRONTIER_QUESTION = 'Is every trainable ansatz classically simulable?';

export const FRONTIER_HONESTY =
  'Hardness is resistance to this Pauli-propagation estimator under this budget. It is not a proof of classical hardness. A high score is a lead to investigate, not a counterexample.';

export const FRONTIER_CONTEXT =
  'Cerezo et al. conjecture that every provably barren-plateau-free ansatz is also classically simulable. This evaluator searches for counterexamples, scored exactly by Pauli propagation at 8 to 64 qubits.';

export const SANDBOX_HONESTY = 'The sandbox blocks network access and file writes. It does not block file reads.';

/** One-paragraph explainer shown wherever Red Queen mode is offered or active. */
export const RED_QUEEN_EXPLAINER =
  'Red Queen mode flips the search around. The LLM is told the evaluator\'s guardrails and is rewarded for programs the evaluator scores well but an independent, stricter audit rejects. It is security testing of Nuclei\'s own scoring logic, not of your machine: the adversary is forbidden from touching the network, the filesystem or the sandbox. Every exploit is saved and can be exported as a permanent regression fixture. A run that finds nothing is evidence of robustness, not proof.';
