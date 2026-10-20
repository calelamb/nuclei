/** "stats r=3d" -> "rounds = 3d"; the default "stats" label carries no information. */
export function displayExperiment(label: string): string {
  return label.replace(/^(stats|unlabeled)\s*/, '').replace(/\br=/g, 'rounds = ').trim() || 'default';
}

/** The first word every label shares, when stripping it still leaves each label something to say. */
function sharedPrefix(labels: readonly string[]): string {
  if (labels.length < 2) return '';
  const first = labels[0].split(/\s+/)[0];
  if (!first || /^r=/.test(first)) return '';
  const everyoneHasRest = labels.every((l) => l.startsWith(`${first} `) && l.slice(first.length).trim() !== '');
  return everyoneHasRest ? `${first} ` : '';
}

/**
 * One name per experiment across legend, Λ table and decoder table: a prefix common to
 * every label ("synth") is dropped, then rounds notation is spelled out.
 */
export function experimentNames(labels: readonly string[]): Map<string, string> {
  const unique = [...new Set(labels)];
  const prefix = sharedPrefix(unique);
  return new Map(unique.map((l) => [l, displayExperiment(prefix ? l.slice(prefix.length) : l)]));
}
