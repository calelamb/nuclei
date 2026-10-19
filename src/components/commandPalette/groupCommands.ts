import type { Command } from './CommandPalette';

export interface CommandGroup {
  category: string;
  commands: Command[];
}

/** Fixed group order so Help sits last in every workspace; unknown categories follow in first-appearance order. */
const CATEGORY_ORDER: readonly string[] = ['Navigate', 'View', 'Run', 'File', 'Experiment', 'Dirac', 'Circuit', 'Help'];

function rank(category: string): number {
  const i = CATEGORY_ORDER.indexOf(category);
  return i === -1 ? CATEGORY_ORDER.length : i;
}

/** Group commands by category in a fixed category order, commands in their given order. */
export function groupByCategory(commands: readonly Command[]): CommandGroup[] {
  const groups: CommandGroup[] = [];
  for (const command of commands) {
    const existing = groups.find((g) => g.category === command.category);
    if (existing) existing.commands.push(command);
    else groups.push({ category: command.category, commands: [command] });
  }
  return groups
    .map((group, index) => ({ group, index }))
    .sort((a, b) => rank(a.group.category) - rank(b.group.category) || a.index - b.index)
    .map(({ group }) => group);
}
