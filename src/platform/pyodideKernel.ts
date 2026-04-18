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

// Minimal structural type for the parts of the Pyodide API we actually call.
// Pyodide's real types aren't published as a standalone package, so we model
// just the surface we use rather than pulling in `any`.
interface PyodideModule {
  loadPackage(name: string): Promise<void>;
  pyimport(name: string): { install(pkg: string): Promise<void> };
  runPythonAsync(code: string): Promise<string>;
}

interface PyodideLoadState {
  pyodide: PyodideModule;
  cirqInstalled: boolean;
}

// Cache the load promise itself so concurrent callers await the same work,
// instead of polling module-level state.
let loadPromise: Promise<PyodideLoadState> | null = null;
let loadState: PyodideLoadState | null = null;

const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.27.0/full/pyodide.js';

type PyodideGlobal = Window & {
  loadPyodide?: () => Promise<PyodideModule>;
};

function getState(): PyodideLoadState | null {
  return loadState;
}

function loadPyodide(): Promise<PyodideLoadState> {
  if (loadState) return Promise.resolve(loadState);
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    // Load Pyodide CDN script
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = PYODIDE_CDN;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Pyodide'));
      document.head.appendChild(script);
    });

    const globalLoad = (window as PyodideGlobal).loadPyodide;
    if (!globalLoad) {
      throw new Error('Pyodide loader not found on window after script load');
    }
    const pyodide = await globalLoad();

    // numpy is bundled with Pyodide and is a hard transitive dependency of
    // cirq-core — load it FIRST so micropip can satisfy cirq's numpy pin
    // from the local environment instead of trying (and failing) to pull a
    // pure-Python numpy wheel from PyPI. Failure here is non-fatal: parse
    // still works for plain Python.
    try {
      await pyodide.loadPackage('numpy');
    } catch {
      // proceed — some features will be unavailable but parse can still work
    }

    // Install quantum packages (micropip)
    await pyodide.loadPackage('micropip');
    const micropip = pyodide.pyimport('micropip');

    let cirqInstalled = false;
    try {
      // 1.5.0 is the first cirq-core release compatible with numpy 2.x, which
      // Pyodide 0.27 ships. 1.4.1 required numpy~=1.22 and fails to resolve.
      await micropip.install('cirq-core==1.5.0');
      cirqInstalled = true;
    } catch {
      cirqInstalled = false;
    }

    loadState = { pyodide, cirqInstalled };
    return loadState;
  })();

  // If the load fails, clear the promise so the next caller can retry.
  loadPromise.catch(() => { loadPromise = null; });

  return loadPromise;
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

    # No framework detected is not an error for plain Python — the user may
    # just be exploring with print statements. Stay silent.
    return None, output, None

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
            "shot_count": shots,
        }, snapshot, output, None
    except ImportError:
        return None, None, output, "Cirq not available in browser. Try a Cirq circuit."
    except Exception:
        return None, None, output, traceback.format_exc()

def _run_python(code):
    namespace = {"__builtins__": __builtins__}
    stdout = io.StringIO()
    old_stdout = sys.stdout
    sys.stdout = stdout

    try:
        exec(code, namespace)
        sys.stdout = old_stdout
        return stdout.getvalue(), None
    except Exception:
        sys.stdout = old_stdout
        return stdout.getvalue(), traceback.format_exc()
`;

/**
 * Translate ModuleNotFoundError for unsupported frameworks into a
 * user-friendly message pointing to the desktop app.
 *
 * Messaging adapts to whether Cirq actually installed: if Cirq failed to
 * load, we can't claim "the browser IDE supports Cirq" — that contradicts
 * what the user just saw.
 */
function translateModuleError(errorMsg: string): string {
  const match = errorMsg.match(
    /ModuleNotFoundError: No module named '(qiskit|pennylane|qutip|cudaq|cirq)'/,
  );
  if (!match) return errorMsg;

  const framework = match[1];
  const displayName =
    framework === 'qiskit'
      ? 'Qiskit'
      : framework === 'cudaq'
        ? 'CUDA-Q'
        : framework === 'cirq'
          ? 'Cirq'
      : framework === 'pennylane'
        ? 'PennyLane'
        : 'QuTiP';

  const cirqOk = loadState?.cirqInstalled ?? false;

  if (framework === 'cirq' && !cirqOk) {
    return 'Cirq failed to load in the browser. For full framework support, download the desktop app from getnuclei.dev';
  }

  if (cirqOk) {
    return `${displayName} isn't available in the browser version. The browser IDE supports Cirq. For Qiskit/CUDA-Q support, download the desktop app from getnuclei.dev`;
  }

  return `${displayName} isn't available in the browser version. For full framework support, download the desktop app from getnuclei.dev`;
}

function classifyKernelError(message: string): { code: string; phase?: 'parse' | 'execute' | 'python' } {
  if (message.includes('No supported quantum framework detected')) {
    return { code: 'unsupported_framework' };
  }
  if (message.includes('No circuit found')) {
    return { code: 'no_circuit' };
  }
  if (message.includes('ModuleNotFoundError')) {
    return { code: 'missing_dependency' };
  }
  if (message.includes('timed out')) {
    return { code: 'timeout' };
  }
  return { code: 'execution_error' };
}

export function isCirqAvailable(): boolean {
  return loadState?.cirqInstalled ?? false;
}

export class PyodideKernel {
  private onMessage: MessageHandler;
  private pyodide: PyodideModule | null = null;

  constructor(onMessage: MessageHandler) {
    this.onMessage = onMessage;
  }

  async init() {
    try {
      const state = await loadPyodide();
      this.pyodide = state.pyodide;
      await this.pyodide.runPythonAsync(KERNEL_PYTHON);
      if (state.cirqInstalled) {
        this.onMessage({ type: 'output', text: 'Pyodide kernel ready (browser mode) — Cirq loaded.' });
      } else {
        this.onMessage({
          type: 'output',
          text: 'Pyodide kernel ready (browser mode) — Cirq unavailable. For full framework support, download the desktop app from getnuclei.dev',
        });
      }
    } catch (e) {
      this.onMessage({ type: 'error', message: `Failed to initialize Pyodide: ${e}` });
      throw e;
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
        this.onMessage({ type: 'snapshot', data: data.snapshot ?? null });
        if (data.error) {
          const translated = translateModuleError(data.error);
          this.onMessage({
            type: 'error',
            message: translated.split('\n').filter(Boolean).pop() ?? translated,
            traceback: translated,
            phase: 'parse',
            code: classifyKernelError(data.error).code,
          });
        }
      } catch (e) {
        const translated = translateModuleError(String(e));
        this.onMessage({ type: 'snapshot', data: null });
        this.onMessage({
          type: 'error',
          message: translated.split('\n').filter(Boolean).pop() ?? translated,
          traceback: translated,
          phase: 'parse',
          code: classifyKernelError(String(e)).code,
        });
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
        if (data.snapshot || data.error) {
          this.onMessage({ type: 'snapshot', data: data.snapshot ?? null });
        }
        if (data.error) {
          const translated = translateModuleError(data.error);
          this.onMessage({ type: 'result', data: null });
          this.onMessage({
            type: 'error',
            message: translated.split('\n').filter(Boolean).pop() ?? translated,
            traceback: translated,
            phase: 'execute',
            code: classifyKernelError(data.error).code,
          });
        } else {
          this.onMessage({ type: 'result', data: data.result ?? null });
        }
      } catch (e) {
        const translated = translateModuleError(String(e));
        this.onMessage({ type: 'snapshot', data: null });
        this.onMessage({ type: 'result', data: null });
        this.onMessage({
          type: 'error',
          message: translated.split('\n').filter(Boolean).pop() ?? translated,
          traceback: translated,
          phase: 'execute',
          code: classifyKernelError(String(e)).code,
        });
      }
    } else if (msg.type === 'run_python') {
      try {
        const code = msg.code as string;
        const result = await this.pyodide.runPythonAsync(`
import json
_out, _err = _run_python(${JSON.stringify(code)})
json.dumps({"output": _out, "error": _err})
`);
        const data = JSON.parse(result);
        if (data.output) {
          this.onMessage({ type: 'output', text: data.output });
        }
        this.onMessage({ type: 'python_result', success: !data.error });
        if (data.error) {
          const translated = translateModuleError(data.error);
          this.onMessage({
            type: 'error',
            message: translated.split('\n').filter(Boolean).pop() ?? translated,
            traceback: translated,
            phase: 'python',
            code: classifyKernelError(data.error).code,
          });
        }
      } catch (e) {
        const translated = translateModuleError(String(e));
        this.onMessage({ type: 'python_result', success: false });
        this.onMessage({
          type: 'error',
          message: translated.split('\n').filter(Boolean).pop() ?? translated,
          traceback: translated,
          phase: 'python',
          code: classifyKernelError(String(e)).code,
        });
      }
    }
  }

  isReady(): boolean {
    return getState() !== null;
  }
}
