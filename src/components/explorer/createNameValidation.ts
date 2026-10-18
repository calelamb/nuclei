/** Checks a typed file/folder name before the platform is asked to create it. */

export interface NameCheckInput {
  /** The trimmed name as the person typed it (or with `.py` already applied for files). */
  name: string;
  /** Names already present in the target folder. */
  existingNames: readonly string[];
}

/** Returns a sentence the person can act on, or null when the name is fine. */
export function validateNewName({ name, existingNames }: NameCheckInput): string | null {
  if (name.length === 0) return 'Type a name first.';
  if (name.includes('/') || name.includes('\\')) {
    return 'Names cannot contain slashes. Use the file tree to choose a location.';
  }
  const lower = name.toLowerCase();
  if (existingNames.some((existing) => existing.toLowerCase() === lower)) {
    return `A file or folder named ${name} already exists. Choose another name.`;
  }
  return null;
}
