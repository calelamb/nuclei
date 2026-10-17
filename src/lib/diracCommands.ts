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

/** A lone "/" or "/word": an unfinished command that must never be sent as a chat message. */
export function isUnfinishedSlashInput(text: string): boolean {
  return /^\/\w*$/.test(text.trim());
}
