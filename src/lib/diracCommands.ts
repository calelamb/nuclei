export interface SlashCommand {
  command: string;
  description: string;
  insert: string;
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { command: '/explain', description: 'Explain the current circuit', insert: '/explain ' },
  { command: '/fix', description: 'Diagnose and fix the current error', insert: '/fix ' },
  { command: '/exercise', description: 'Start a new exercise', insert: '/exercise ' },
  { command: '/think', description: 'Enable reasoning mode', insert: '/think ' },
  { command: '/clear', description: 'Clear conversation history', insert: '/clear' },
];

export function filterSlashCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase();
  return SLASH_COMMANDS.filter((c) => c.command.startsWith(q));
}

/**
 * Input that must never be sent as a chat message: a lone "/" or a "/word"
 * that is not one of the known commands. Complete commands are sendable.
 */
export function isUnfinishedSlashInput(text: string): boolean {
  const t = text.trim();
  if (!/^\/\w*$/.test(t)) return false;
  return !SLASH_COMMANDS.some((c) => c.command === t.toLowerCase());
}
