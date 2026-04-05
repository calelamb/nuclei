import { useCallback } from 'react';
import { useCircuitStore } from '../stores/circuitStore';
import { useEditorStore } from '../stores/editorStore';
import type { CircuitSnapshot, Gate } from '../types/quantum';

function gateToQasm(gate: Gate): string {
  const params = gate.params.length > 0 ? `(${gate.params.join(',')})` : '';
  const allQubits = [...gate.controls, ...gate.targets];
  const qubits = allQubits.map((q) => `q[${q}]`).join(', ');

  switch (gate.type) {
    case 'H': return `h ${qubits};`;
    case 'X': return `x ${qubits};`;
    case 'Y': return `y ${qubits};`;
    case 'Z': return `z ${qubits};`;
    case 'S': return `s ${qubits};`;
    case 'T': return `t ${qubits};`;
    case 'RX': return `rx${params} ${qubits};`;
    case 'RY': return `ry${params} ${qubits};`;
    case 'RZ': return `rz${params} ${qubits};`;
    case 'CNOT': return `cx q[${gate.controls[0]}], q[${gate.targets[0]}];`;
    case 'CZ': return `cz q[${gate.controls[0]}], q[${gate.targets[0]}];`;
    case 'SWAP': return `swap q[${gate.targets[0]}], q[${gate.targets[1]}];`;
    case 'Toffoli': return `ccx q[${gate.controls[0]}], q[${gate.controls[1]}], q[${gate.targets[0]}];`;
    case 'Measure': return `measure q[${gate.targets[0]}] -> c[${gate.targets[0]}];`;
    default: return `// Unknown gate: ${gate.type}`;
  }
}

function snapshotToQasm(snapshot: CircuitSnapshot): string {
  const lines: string[] = [
    'OPENQASM 3.0;',
    'include "stdgates.inc";',
    '',
    `qubit[${snapshot.qubit_count}] q;`,
  ];
  if (snapshot.classical_bit_count > 0) {
    lines.push(`bit[${snapshot.classical_bit_count}] c;`);
  }
  lines.push('');

  // Sort gates by layer
  const sorted = [...snapshot.gates].sort((a, b) => a.layer - b.layer);
  let currentLayer = -1;
  for (const gate of sorted) {
    if (gate.layer !== currentLayer) {
      if (currentLayer >= 0) lines.push('');
      currentLayer = gate.layer;
    }
    lines.push(gateToQasm(gate));
  }

  return lines.join('\n');
}

function getCircuitSvgElement(): SVGSVGElement | null {
  return document.querySelector('.circuit-renderer-container svg') as SVGSVGElement | null;
}

async function svgToDataUrl(svgElement: SVGSVGElement): Promise<string> {
  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(svgElement);
  const blob = new Blob([svgString], { type: 'image/svg+xml' });
  return URL.createObjectURL(blob);
}

async function svgToPngDataUrl(svgElement: SVGSVGElement, scale = 2): Promise<string> {
  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(svgElement);
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(svgBlob);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = url;
  });
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
  if (dataUrl.startsWith('blob:')) URL.revokeObjectURL(dataUrl);
}

function encodeCircuitToUrl(snapshot: CircuitSnapshot): string {
  const compressed = JSON.stringify({
    f: snapshot.framework,
    q: snapshot.qubit_count,
    c: snapshot.classical_bit_count,
    g: snapshot.gates.map((g) => ({
      t: g.type,
      r: g.targets,
      c: g.controls,
      p: g.params,
      l: g.layer,
    })),
  });
  const encoded = btoa(encodeURIComponent(compressed));
  return `${window.location.origin}/c/${encoded}`;
}

export function useCircuitExport() {
  const exportQasm = useCallback(() => {
    const snapshot = useCircuitStore.getState().snapshot;
    if (!snapshot) return null;
    return snapshotToQasm(snapshot);
  }, []);

  const exportQasmFile = useCallback(() => {
    const qasm = exportQasm();
    if (!qasm) return;
    const blob = new Blob([qasm], { type: 'text/plain' });
    downloadDataUrl(URL.createObjectURL(blob), 'circuit.qasm');
  }, [exportQasm]);

  const exportSvg = useCallback(async () => {
    const svg = getCircuitSvgElement();
    if (!svg) return;
    const url = await svgToDataUrl(svg);
    downloadDataUrl(url, 'circuit.svg');
  }, []);

  const exportPng = useCallback(async (scale = 2) => {
    const svg = getCircuitSvgElement();
    if (!svg) return;
    const dataUrl = await svgToPngDataUrl(svg, scale);
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = 'circuit.png';
    a.click();
  }, []);

  const copyCodeToClipboard = useCallback(async () => {
    const code = useEditorStore.getState().code;
    await navigator.clipboard.writeText(code);
  }, []);

  const copyQasmToClipboard = useCallback(async () => {
    const qasm = exportQasm();
    if (qasm) await navigator.clipboard.writeText(qasm);
  }, [exportQasm]);

  const getShareUrl = useCallback(() => {
    const snapshot = useCircuitStore.getState().snapshot;
    if (!snapshot) return null;
    return encodeCircuitToUrl(snapshot);
  }, []);

  const copyShareUrl = useCallback(async () => {
    const url = getShareUrl();
    if (url) await navigator.clipboard.writeText(url);
    return url;
  }, [getShareUrl]);

  const exportJsonSnapshot = useCallback(() => {
    const snapshot = useCircuitStore.getState().snapshot;
    if (!snapshot) return;
    const json = JSON.stringify(snapshot, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    downloadDataUrl(URL.createObjectURL(blob), 'circuit.json');
  }, []);

  return {
    exportQasm,
    exportQasmFile,
    exportSvg,
    exportPng,
    copyCodeToClipboard,
    copyQasmToClipboard,
    getShareUrl,
    copyShareUrl,
    exportJsonSnapshot,
  };
}

// Import helpers
export function detectFileType(content: string): 'qasm' | 'python' | 'json' | null {
  if (content.trim().startsWith('OPENQASM')) return 'qasm';
  if (content.trim().startsWith('{') && content.includes('"framework"')) return 'json';
  if (content.includes('import ') || content.includes('def ')) return 'python';
  return null;
}

export function importQasm(_qasmContent: string): string {
  // Basic QASM to Python conversion (Qiskit)
  // For a full implementation, this would parse QASM properly
  return `# Imported from QASM — edit as needed\nfrom qiskit import QuantumCircuit\n\n# TODO: Convert QASM gates to Qiskit\n`;
}
