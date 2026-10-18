/** Upper bound of dim 𝔤: dim su(2ⁿ) = 4ⁿ − 1. */
export function maxAlgebraDimension(n: number): number {
  return 4 ** n - 1;
}

