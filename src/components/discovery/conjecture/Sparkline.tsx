import { formatSci } from '../../lab';
import type { EvidencePoint } from '../../../types/conjecture';

const W = 84;
const H = 26;
const PAD = 2;

/** Gradient variance against qubit count on a log axis, with the 95% band when the kernel gave one. */
export function Sparkline({ points, label, tone }: { points: EvidencePoint[]; label: string; tone: 'success' | 'danger' | 'warning' }) {
  const usable = points.filter((p) => p.variance > 0);
  if (usable.length < 2) return <span className="lab-dim" aria-label={`${label}: not enough scaling points`}>—</span>;
  const logs = usable.flatMap((p) => [Math.log10(p.variance), ...(p.lo && p.lo > 0 ? [Math.log10(p.lo)] : []), ...(p.hi && p.hi > 0 ? [Math.log10(p.hi)] : [])]);
  const [lo, hi] = [Math.min(...logs), Math.max(...logs)];
  const [n0, n1] = [usable[0].n, usable[usable.length - 1].n];
  const px = (n: number) => PAD + ((n - n0) / Math.max(1e-9, n1 - n0)) * (W - 2 * PAD);
  const py = (v: number) => PAD + (1 - (Math.log10(v) - lo) / Math.max(1e-9, hi - lo)) * (H - 2 * PAD);
  const line = usable.map((p, i) => `${i ? 'L' : 'M'}${px(p.n).toFixed(1)},${py(p.variance).toFixed(1)}`).join(' ');
  const banded = usable.filter((p) => p.lo && p.hi && p.lo > 0 && p.hi > 0);
  const band =
    banded.length > 1
      ? `${banded.map((p, i) => `${i ? 'L' : 'M'}${px(p.n).toFixed(1)},${py(p.hi!).toFixed(1)}`).join(' ')} ${[...banded].reverse().map((p) => `L${px(p.n).toFixed(1)},${py(p.lo!).toFixed(1)}`).join(' ')} Z`
      : null;
  const first = usable[0];
  const last = usable[usable.length - 1];
  const aria = `${label}: gradient variance falls from ${formatSci(first.variance, 2)} at n = ${first.n} to ${formatSci(last.variance, 2)} at n = ${last.n}`;
  return (
    <svg className="cj-spark" width={W} height={H} role="img" aria-label={aria}>
      {band && <path className="cj-spark__band" d={band} />}
      <path d={line} stroke={`var(--color-${tone})`} />
    </svg>
  );
}
