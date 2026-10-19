import type { GradientStatistics, LieAlgebraResult } from '../../../types/trainability';
import { isNumber } from '../../../services/trainability/intervals';

/** Upper bound of dim 𝔤: dim su(2ⁿ) = 4ⁿ − 1. */
export function maxAlgebraDimension(n: number): number {
  return 4 ** n - 1;
}

export interface RagoneComparison {
  /** Predicted Var[C], or null when the prediction does not apply. */
  predicted: number | null;
  /** Empirical Var[C] from the sampling path, or null when absent. */
  empirical: number | null;
  /** empirical / predicted, only when both exist and predicted > 0. */
  ratio: number | null;
}

/**
 * Compare like with like: the Ragone prediction is for the cost variance, so
 * it is set against the empirical `cost_variance`, never `variance_mean`
 * (that is the gradient variance, a different quantity).
 */
export function ragoneComparison(lie: LieAlgebraResult, gradients: GradientStatistics | undefined): RagoneComparison {
  const predicted = lie.prediction_applicable && isNumber(lie.predicted_variance) ? lie.predicted_variance : null;
  const empirical = isNumber(gradients?.cost_variance) ? gradients.cost_variance : null;
  const ratio = predicted !== null && empirical !== null && predicted > 0 ? empirical / predicted : null;
  return { predicted, empirical, ratio };
}
