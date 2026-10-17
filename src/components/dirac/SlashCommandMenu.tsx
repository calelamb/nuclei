import type { SlashCommand } from '../../lib/diracCommands';
import './dirac.css';

interface Props {
  id: string;
  commands: readonly SlashCommand[];
  activeIndex: number;
  onSelect: (command: SlashCommand) => void;
  onHover: (index: number) => void;
}

/** Listbox of slash commands. Focus stays in the textarea; it drives `activeIndex` via aria-activedescendant. */
export function SlashCommandMenu({ id, commands, activeIndex, onSelect, onHover }: Props) {
  if (commands.length === 0) return null;
  return (
    <div className="dirac-slash" role="listbox" id={id} aria-label="Slash commands">
      {commands.map((cmd, i) => (
        <button
          key={cmd.command}
          type="button"
          role="option"
          id={`${id}-${i}`}
          aria-selected={i === activeIndex}
          tabIndex={-1}
          className="dirac-slash__item"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onSelect(cmd)}
          onMouseEnter={() => onHover(i)}
        >
          <span className="dirac-slash__cmd">{cmd.command}</span>
          <span className="dirac-slash__desc">{cmd.description}</span>
        </button>
      ))}
    </div>
  );
}
