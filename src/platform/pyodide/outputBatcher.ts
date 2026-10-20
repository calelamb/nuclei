/**
 * Coalesces a program's live output lines into a few multi-line chunks.
 *
 * The worker posts one message per printed line so output appears while Python
 * is still running; handing each one to the terminal store separately would
 * re-render it thousands of times for a print loop. Lines gathered within one
 * interval are delivered together as a single newline-terminated block.
 */
export const OUTPUT_FLUSH_MS = 50;

export class OutputBatcher {
  private lines: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly deliver: (text: string) => void;
  private readonly intervalMs: number;

  constructor(deliver: (text: string) => void, intervalMs: number = OUTPUT_FLUSH_MS) {
    this.deliver = deliver;
    this.intervalMs = intervalMs;
  }

  /** Arrow property so it can be passed around unbound. */
  readonly push = (line: string): void => {
    this.lines.push(line); // internal buffer: copying per line would be quadratic
    if (this.timer === null) this.timer = setTimeout(this.flush, this.intervalMs);
  };

  /** Deliver everything gathered so far (also called once a run ends). */
  readonly flush = (): void => {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.lines.length === 0) return;
    const text = `${this.lines.join('\n')}\n`;
    this.lines = [];
    this.deliver(text);
  };
}
