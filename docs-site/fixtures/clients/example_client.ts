// Minimal Nuclei kernel client: parse a Bell circuit, run it, print counts.
//
// Run with: npx tsx example_client.ts [ws://localhost:9742]
// Requires the `ws` package: npm install ws
// (This file is documentation — it mirrors example_client.py, which is the
// variant exercised by the kernel test suite.)
import WebSocket from 'ws';

const BELL = `from qiskit import QuantumCircuit

qc = QuantumCircuit(2, 2)
qc.h(0)
qc.cx(0, 1)
qc.measure([0, 1], [0, 1])
`;

const url = process.argv[2] ?? 'ws://localhost:9742';
const ws = new WebSocket(url);

type KernelMessage = { type: string; [key: string]: unknown };
const queue: KernelMessage[] = [];
let wake: (() => void) | null = null;

ws.on('message', (raw) => {
  queue.push(JSON.parse(raw.toString()) as KernelMessage);
  wake?.();
});

// Every request produces an ordered SEQUENCE of messages — output/stderr
// may interleave before the terminal message, so a robust client loops.
async function drainUntil(terminalType: string): Promise<KernelMessage> {
  for (;;) {
    while (queue.length === 0) {
      await new Promise<void>((resolve) => { wake = resolve; });
    }
    const message = queue.shift()!;
    if (message.type === 'output') process.stdout.write(message.text as string);
    if (message.type === 'stderr') process.stderr.write(message.text as string);
    if (message.type === 'error') console.error(`kernel error: ${message.message}`);
    if (message.type === terminalType) return message;
  }
}

ws.on('open', async () => {
  ws.send(JSON.stringify({ type: 'parse', code: BELL, language: 'python' }));
  const snapshot = await drainUntil('snapshot');
  const data = snapshot.data as { gates: unknown[]; depth: number } | null;
  if (!data) process.exit(1);
  console.log(`circuit: ${data.gates.length} gates, depth ${data.depth}`);

  ws.send(JSON.stringify({ type: 'execute', code: BELL, shots: 512, language: 'python' }));
  const result = await drainUntil('result');
  const sim = result.data as { measurements: Record<string, number> } | null;
  if (!sim) process.exit(1);
  for (const [bitstring, count] of Object.entries(sim.measurements).sort()) {
    console.log(`${bitstring}: ${count}`);
  }
  ws.close();
});
