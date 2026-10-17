const NS_PER_SECOND = 1e9;
const NS_PER_MINUTE = 6e10;
const NS_PER_HOUR = 3.6e12;
const NS_PER_DAY = 8.64e13;

/** Nanoseconds -> the most legible unit, from ns up to days (fault-tolerant runs routinely take hours). */
export function humanNs(ns: number | null): string {
  if (ns === null || !Number.isFinite(ns)) return '—';
  if (ns < 1e3) return `${ns} ns`;
  if (ns < 1e6) return `${(ns / 1e3).toFixed(2)} µs`;
  if (ns < NS_PER_SECOND) return `${(ns / 1e6).toFixed(2)} ms`;
  if (ns < NS_PER_MINUTE) return `${(ns / NS_PER_SECOND).toFixed(2)} s`;
  if (ns < NS_PER_HOUR) return `${(ns / NS_PER_MINUTE).toFixed(2)} min`;
  if (ns < NS_PER_DAY) return `${(ns / NS_PER_HOUR).toFixed(2)} h`;
  return `${(ns / NS_PER_DAY).toFixed(2)} d`;
}
