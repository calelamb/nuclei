const KET0 = '|0⟩';
const KET1 = '|1⟩';
const MINUS = '−';

/** One amplitude component as an unsigned magnitude string: "0", "1", "0.707" or "0.354". */
function magnitude(n: number): string {
  const abs = Math.abs(n);
  if (abs < 1e-6) return '0';
  if (Math.abs(abs - 1) < 1e-6) return '1';
  if (Math.abs(abs - Math.SQRT1_2) < 1e-4) return '0.707';
  return abs.toFixed(3);
}

function signOf(n: number): '+' | '-' {
  return n < 0 && Math.abs(n) >= 1e-6 ? '-' : '+';
}

/**
 * |ψ⟩ = cos(θ/2)|0⟩ + e^{iφ} sin(θ/2)|1⟩ as a readable string. The sign of the second
 * term is the joiner ("a − b|1⟩"), never "+ -b", and a complex amplitude is parenthesised.
 */
export function formatStateEquation(theta: number, phi: number): string {
  const alpha = Math.cos(theta / 2);
  const betaRe = Math.cos(phi) * Math.sin(theta / 2);
  const betaIm = Math.sin(phi) * Math.sin(theta / 2);
  const hasRe = Math.abs(betaRe) >= 1e-6;
  const hasIm = Math.abs(betaIm) >= 1e-6;
  const first = `${magnitude(alpha)}${KET0}`;

  if (!hasRe && !hasIm) return `${first} + 0${KET1}`;
  if (hasRe && hasIm) {
    const joiner = signOf(betaIm) === '-' ? MINUS : '+';
    const imag = magnitude(betaIm) === '1' ? 'i' : `${magnitude(betaIm)}i`;
    return `${first} + (${signOf(betaRe) === '-' ? MINUS : ''}${magnitude(betaRe)} ${joiner} ${imag})${KET1}`;
  }
  const joiner = signOf(hasRe ? betaRe : betaIm) === '-' ? MINUS : '+';
  if (hasRe) return `${first} ${joiner} ${magnitude(betaRe)}${KET1}`;
  const imag = magnitude(betaIm) === '1' ? 'i' : `${magnitude(betaIm)}i`;
  return `${first} ${joiner} ${imag}${KET1}`;
}
