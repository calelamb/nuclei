/**
 * Deterministic, dependency-free content hashing for the agent runtime.
 *
 * This is NOT a cryptographic hash — it exists purely to detect "has this
 * file changed since I last looked at it" for conflict-checked patches and
 * rollback safety. FNV-1a (32-bit) is fast, synchronous, has no external
 * dependency, and is stable across platforms for a given string input.
 */
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function hashContent(input: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  // Fold in length so that inputs which happen to collide on the 32-bit
  // FNV digest (rare, but possible for short strings) are still very
  // likely to be distinguished.
  const withLength = (hash >>> 0) ^ Math.imul(input.length + 1, FNV_PRIME);
  return (withLength >>> 0).toString(16).padStart(8, '0');
}
