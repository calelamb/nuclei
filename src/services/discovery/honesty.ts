/** Mandatory honesty copy (PRD 14 addendum §B, §C and PRD §1). */

export const FRONTIER_QUESTION = 'Is every trainable ansatz classically simulable?';

export const FRONTIER_HONESTY =
  'Hardness is resistance to this Pauli-propagation estimator under this budget. It is not a proof of classical hardness. A high score is a lead to investigate, not a counterexample.';

export const FRONTIER_CONTEXT =
  'Cerezo et al. conjecture that every provably barren-plateau-free ansatz is also classically simulable. This evaluator searches for counterexamples, scored exactly by Pauli propagation at 8 to 64 qubits.';

/**
 * The single source of truth for what the candidate sandbox blocks. Update here
 * (and only here) when the isolation behavior changes.
 */
export const SANDBOX_HONESTY =
  'Where an OS sandbox runs (macOS sandbox-exec; Linux bwrap, untested on Linux), it blocks network access and file writes outside a private scratch directory, and denies file reads except an allow-list (the Python interpreter and venv, the kernel code, system libraries and the scratch directory). File metadata (names, sizes) stays readable. Plain process isolation blocks nothing at the OS level. Each evaluation reports whether its reads were restricted.';

/** Title for the Guardrails callout when every evaluation reported restricted reads. */
export const SANDBOX_READS_TITLE = 'File reads are restricted to an allow-list';

/** Caveat appended wherever SANDBOX_HONESTY is shown. */
export const SANDBOX_READS_CAVEAT =
  'Restriction applies only to evaluations that report reads: restricted. Linux bwrap binds only the needed paths read-only and has not been tested on Linux.';

/** Title for the Guardrails callout when any evaluation reported unrestricted (or no) read restriction. */
export const SANDBOX_READS_UNRESTRICTED_TITLE = 'Some evaluations ran with unrestricted file reads';

/** Caveat for runs where reads were unrestricted or unreported: never claim a restriction that was not reported. */
export const SANDBOX_READS_UNRESTRICTED_CAVEAT =
  'Those evaluations could read any file the app can read. Only evaluations that report reads: restricted had file reads limited to the allow-list.';

/** One-paragraph explainer shown wherever Red Queen mode is offered or active. */
export const RED_QUEEN_EXPLAINER =
  `Red Queen mode flips the search around. The LLM is told the evaluator's guardrails and is rewarded for programs the evaluator scores well but an independent, stricter audit rejects. It is security testing of Nuclei's own scoring logic, not of your machine: the adversary is instructed not to touch the network, the filesystem or the sandbox, and is not trusted to obey: ${SANDBOX_HONESTY} Every exploit is saved and can be exported as a permanent regression fixture. A run that finds nothing is evidence of robustness, not proof.`;
