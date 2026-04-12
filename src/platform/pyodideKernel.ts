/**
 * PyodideKernel — runs Python in the browser via Pyodide (WebAssembly).
 *
 * Provides the same message interface as the native WebSocket kernel:
 * - { type: 'parse', code } → { type: 'snapshot', data }
 * - { type: 'execute', code, shots } → { type: 'result', data }
 *
 * This is used by useKernel when running in web mode, replacing the
 * WebSocket connection to the native Python process.
 */

type KernelMessage = { type: string; [key: string]: unknown };
type MessageHandler = (msg: KernelMessage) => void;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pyodideInstance: any = null;
let loading = false;
let ready = false;
let cirqInstalled = false;

const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.27.0/full/pyodide.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadPyodide(): Promise<any> {
  if (pyodideInstance) return pyodideInstance;
  if (loading) {
    // Wait for the in-progress load
    return new Promise((resolve) => {
      const check = setInterval(() => {
        if (pyodideInstance) { clearInterval(check); resolve(pyodideInstance); }
      }, 200);
    });
  }

  loading = true;

  // Load Pyodide script
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PYODIDE_CDN;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Pyodide'));
    document.head.appendChild(script);
  });

  // Initialize Pyodide
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pyodideInstance = await (window as any).loadPyodide();

  // Install quantum packages (micropip)
  await pyodideInstance.loadPackage('micropip');
  const micropip = pyodideInstance.pyimport('micropip');

  // Try to install cirq (lighter, better Pyodide support)
  try {
    await micropip.install('cirq-core==1.4.1');
    cirqInstalled = true;
  } catch {
    cirqInstalled = false;
  }

  // Install numpy (needed for computations)
  try {
    await pyodideInstance.loadPackage('numpy');
    // numpy loaded successfully
  } catch {
    // numpy not available
  }

  ready = true;
  loading = false;
  return pyodideInstance;
}

// Python code that implements the kernel parse/execute logic for the browser
const KERNEL_PYTHON = `
import json, sys, io, traceback
import numpy as np

def _parse_circuit(code):
    """Parse code and extract circuit snapshot."""
    namespace = {"__builtins__": __builtins__}
    stdout = io.StringIO()
    old_stdout = sys.stdout
    sys.stdout = stdout

    try:
        exec(code, namespace)
    except Exception:
        sys.stdout = old_stdout
        return None, stdout.getvalue(), traceback.format_exc()

    sys.stdout = old_stdout
    output = stdout.getvalue()

    # Try cirq
    try:
        import cirq
        circuits = [v for v in namespace.values() if isinstance(v, cirq.Circuit)]
        if circuits:
            circuit = circuits[-1]
            all_qubits = sorted(circuit.all_qubits())
            qubit_index = {q: i for i, q in enumerate(all_qubits)}
            gates = []
            for moment_idx, moment in enumerate(circuit.moments):
                for op in moment.operations:
                    gate = op.gate
                    qubits = [qubit_index[q] for q in op.qubits]
                    gate_name = str(type(gate).__name__).replace('PowGate','')
                    if 'HGate' in str(type(gate)) or (hasattr(gate,'exponent') and isinstance(gate, cirq.HPowGate) and gate.exponent==1):
                        gate_name = 'H'
                    elif isinstance(gate, cirq.CNotPowGate) and gate.exponent == 1:
                        gate_name = 'CNOT'
                    elif isinstance(gate, cirq.MeasurementGate):
                        gate_name = 'Measure'
                    elif isinstance(gate, cirq.XPowGate) and gate.exponent == 1:
                        gate_name = 'X'
                    elif isinstance(gate, cirq.ZPowGate) and gate.exponent == 1:
                        gate_name = 'Z'

                    controls = qubits[:1] if gate_name in ('CNOT','CZ') else []
                    targets = qubits[1:] if gate_name in ('CNOT','CZ') else qubits

                    gates.append({
                        "type": gate_name,
                        "targets": targets,
                        "controls": controls,
                        "params": [],
                        "layer": moment_idx,
                    })

            return {
                "framework": "cirq",
                "qubit_count": len(all_qubits),
                "classical_bit_count": sum(1 for op in circuit.all_operations() if isinstance(op.gate, cirq.MeasurementGate)),
                "depth": len(circuit.moments),
                "gates": gates,
            }, output, None
    except ImportError:
        pass

    return None, output, "No supported quantum framework detected."

def _execute_circuit(code, shots):
    """Execute circuit and return results."""
    namespace = {"__builtins__": __builtins__}
    stdout = io.StringIO()
    old_stdout = sys.stdout
    sys.stdout = stdout

    try:
        exec(code, namespace)
    except Exception:
        sys.stdout = old_stdout
        return None, None, stdout.getvalue(), traceback.format_exc()

    sys.stdout = old_stdout
    output = stdout.getvalue()

    try:
        import cirq
        circuits = [v for v in namespace.values() if isinstance(v, cirq.Circuit)]
        if not circuits:
            return None, None, output, "No circuit found."
        circuit = circuits[-1]
        all_qubits = sorted(circuit.all_qubits())
        n_qubits = len(all_qubits)

        # Strip measurements for statevector
        circuit_no_meas = cirq.Circuit(
            op for moment in circuit.moments for op in moment.operations
            if not isinstance(op.gate, cirq.MeasurementGate)
        )
        sim = cirq.Simulator()
        sv_result = sim.simulate(circuit_no_meas, qubit_order=all_qubits)
        sv = sv_result.final_state_vector
        state_vector = [{"re": float(c.real), "im": float(c.imag)} for c in sv]
        probabilities = {}
        for i, c in enumerate(sv):
            p = float(abs(c)**2)
            if p > 1e-10:
                probabilities[format(i, f"0{n_qubits}b")] = p

        # Sampled measurements
        meas_result = sim.run(circuit, repetitions=shots)
        measurements = {}
        if meas_result.measurements:
            keys = sorted(meas_result.measurements.keys())
            arrays = [meas_result.measurements[k] for k in keys]
            combined = np.concatenate(arrays, axis=1)
            for row in combined:
                bs = "".join(str(b) for b in row)
                measurements[bs] = measurements.get(bs, 0) + 1

        # Bloch coords
        bloch_coords = []
        for i in range(n_qubits):
            sv_arr = np.array(sv).reshape([2]*n_qubits)
            axes = [j for j in range(n_qubits) if j != i]
            rho = np.tensordot(sv_arr, sv_arr.conj(), axes=(axes, axes))
            bloch_coords.append({
                "x": float(2*rho[0,1].real),
                "y": float(2*rho[0,1].imag),
                "z": float(rho[0,0].real - rho[1,1].real),
            })

        # Extract snapshot directly from already-executed namespace (no re-exec)
        snapshot = None
        try:
            all_qubits_snap = sorted(circuit.all_qubits())
            qubit_index_snap = {q: i for i, q in enumerate(all_qubits_snap)}
            gates_snap = []
            for moment_idx_snap, moment_snap in enumerate(circuit.moments):
                for op_snap in moment_snap.operations:
                    gate_snap = op_snap.gate
                    qubits_snap = [qubit_index_snap[q] for q in op_snap.qubits]
                    gate_name_snap = str(type(gate_snap).__name__).replace('PowGate','')
                    if 'HGate' in str(type(gate_snap)) or (hasattr(gate_snap,'exponent') and isinstance(gate_snap, cirq.HPowGate) and gate_snap.exponent==1):
                        gate_name_snap = 'H'
                    elif isinstance(gate_snap, cirq.CNotPowGate) and gate_snap.exponent == 1:
                        gate_name_snap = 'CNOT'
                    elif isinstance(gate_snap, cirq.MeasurementGate):
                        gate_name_snap = 'Measure'
                    elif isinstance(gate_snap, cirq.XPowGate) and gate_snap.exponent == 1:
                        gate_name_snap = 'X'
                    elif isinstance(gate_snap, cirq.ZPowGate) and gate_snap.exponent == 1:
                        gate_name_snap = 'Z'
                    controls_snap = qubits_snap[:1] if gate_name_snap in ('CNOT','CZ') else []
                    targets_snap = qubits_snap[1:] if gate_name_snap in ('CNOT','CZ') else qubits_snap
                    gates_snap.append({
                        "type": gate_name_snap,
                        "targets": targets_snap,
                        "controls": controls_snap,
                        "params": [],
                        "layer": moment_idx_snap,
                    })
            snapshot = {
                "framework": "cirq",
                "qubit_count": len(all_qubits_snap),
                "classical_bit_count": sum(1 for op in circuit.all_operations() if isinstance(op.gate, cirq.MeasurementGate)),
                "depth": len(circuit.moments),
                "gates": gates_snap,
            }
        except Exception:
            pass

        return {
            "state_vector": state_vector,
            "probabilities": probabilities,
            "measurements": measurements,
            "bloch_coords": bloch_coords,
            "execution_time_ms": 0,
        }, snapshot, output, None
    except ImportError:
        return None, None, output, "Cirq not available in browser. Try a Cirq circuit."
    except Exception:
        return None, None, output, traceback.format_exc()
`;

/**
 * Translate ModuleNotFoundError for unsupported frameworks into a
 * user-friendly message pointing to the desktop app.
 */
function translateModuleError(errorMsg: string): string {
  const match = errorMsg.match(
    /ModuleNotFoundError: No module named '(qiskit|pennylane|qutip)'/,
  );
  if (!match) return errorMsg;

  const framework = match[1];
  const displayName =
    framework === 'qiskit'
      ? 'Qiskit'
      : framework === 'pennylane'
        ? 'PennyLane'
        : 'QuTiP';

  return `${displayName} isn't available in the browser version. The browser IDE supports Cirq. For Qiskit/CUDA-Q support, download the desktop app from getnuclei.dev`;
}

export class PyodideKernel {
  private onMessage: MessageHandler;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pyodide: any = null;

  constructor(onMessage: MessageHandler) {
    this.onMessage = onMessage;
  }

  async init() {
    try {
      this.pyodide = await loadPyodide();
      // Load the kernel code
      await this.pyodide.runPythonAsync(KERNEL_PYTHON);
      this.onMessage({ type: 'output', text: 'Pyodide kernel ready (browser mode)' });
      if (!cirqInstalled) {
        this.onMessage({
          type: 'output',
          text: 'Warning: cirq-core could not be loaded. Quantum circuit features may be limited. For full framework support, download the desktop app from getnuclei.dev',
        });
      }
    } catch (e) {
      this.onMessage({ type: 'error', message: `Failed to initialize Pyodide: ${e}` });
    }
  }

  async send(msg: KernelMessage) {
    if (!this.pyodide) {
      this.onMessage({ type: 'error', message: 'Pyodide not initialized' });
      return;
    }

    if (msg.type === 'parse') {
      try {
        const code = msg.code as string;
        const result = await this.pyodide.runPythonAsync(`
import json
_snap, _out, _err = _parse_circuit(${JSON.stringify(code)})
json.dumps({"snapshot": _snap, "output": _out, "error": _err})
`);
        const data = JSON.parse(result);
        if (data.output) {
          this.onMessage({ type: 'output', text: data.output });
        }
        if (data.error) {
          this.onMessage({ type: 'error', message: translateModuleError(data.error) });
        } else if (data.snapshot) {
          this.onMessage({ type: 'snapshot', data: data.snapshot });
        }
      } catch (e) {
        this.onMessage({ type: 'error', message: translateModuleError(String(e)) });
      }
    } else if (msg.type === 'execute') {
      try {
        const code = msg.code as string;
        const shots = (msg.shots as number) ?? 1024;
        const result = await this.pyodide.runPythonAsync(`
import json, time
_start = time.time()
_result, _snap, _out, _err = _execute_circuit(${JSON.stringify(code)}, ${shots})
if _result:
    _result["execution_time_ms"] = round((time.time() - _start) * 1000, 1)
json.dumps({"result": _result, "snapshot": _snap, "output": _out, "error": _err})
`);
        const data = JSON.parse(result);
        if (data.output) {
          this.onMessage({ type: 'output', text: data.output });
        }
        if (data.error) {
          this.onMessage({ type: 'error', message: translateModuleError(data.error) });
        } else {
          if (data.snapshot) {
            this.onMessage({ type: 'snapshot', data: data.snapshot });
          }
          if (data.result) {
            this.onMessage({ type: 'result', data: data.result });
          }
        }
      } catch (e) {
        this.onMessage({ type: 'error', message: translateModuleError(String(e)) });
      }
    }
  }

  isReady(): boolean {
    return ready;
  }
}
