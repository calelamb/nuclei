import type { Command } from './CommandPalette';

export interface CommandGroup {
  category: string;
  commands: Command[];
}

/** Group commands by category, categories in first-appearance order, commands in their given order. */
export function groupByCategory(commands: readonly Command[]): CommandGroup[] {
  const groups: CommandGroup[] = [];
  for (const command of commands) {
    const existing = groups.find((g) => g.category === command.category);
    if (existing) existing.commands.push(command);
    else groups.push({ category: command.category, commands: [command] });
  }
  return groups;
}
