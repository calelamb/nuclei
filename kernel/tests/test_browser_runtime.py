"""Tests for the Pyodide browser kernel (src/platform/pyodide).

The browser build cannot install real Qiskit, so it ships a pure-Python subset
(shim/qiskit, shim/qiskit_aer). These tests run that code under plain CPython
in a subprocess (it shadows the real `qiskit` package, so it cannot share a
process with the kernel's own adapters) and compare its output with what the
desktop adapter produces for the same program.
"""

import json
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
PYODIDE_DIR = REPO / "src" / "platform" / "pyodide"
SHIM_DIR = PYODIDE_DIR / "shim"

_DRIVER = textwrap.dedent(
    """
    import json, sys
    sys.path[:0] = [{shim!r}, {runtime!r}]
    import kernel_runtime as rt
    call = json.loads(sys.stdin.read())
    fn = getattr(rt, call["fn"])
    sys.stdout.write("\\n@@RESULT@@" + fn(*call["args"]))
    """
)


def run_browser(fn, *args):
    """Call a kernel_runtime entry point in a clean interpreter; return decoded JSON."""
    driver = _DRIVER.format(shim=str(SHIM_DIR), runtime=str(PYODIDE_DIR))
    proc = subprocess.run(
        [sys.executable, "-I", "-c", driver],
        input=json.dumps({"fn": fn, "args": list(args)}),
        capture_output=True, text=True, timeout=120,
    )
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout.split("@@RESULT@@", 1)[1])


BELL = """
from qiskit import QuantumCircuit
qc = QuantumCircuit(2, 2)
qc.h(0)
qc.cx(0, 1)
qc.measure([0, 1], [0, 1])
"""


def test_bell_execute_matches_expected_shapes():
    out = run_browser("nuclei_execute", BELL, 1000)
    assert out["error"] is None
    result = out["result"]
    assert set(result["measurements"]) == {"00", "11"}
    assert sum(result["measurements"].values()) == 1000
    assert result["probabilities"] == pytest.approx({"00": 0.5, "11": 0.5})
    assert len(result["state_vector"]) == 4
    assert result["shot_count"] == 1000
    assert result["metrics"] == {}
    assert out["snapshot"]["framework"] == "qiskit"


def test_parse_returns_snapshot_and_keeps_stdout_separate():
    out = run_browser("nuclei_parse", BELL + "print('hello')\n")
    assert out["error"] is None
    assert out["output"] == "hello\n"
    assert out["snapshot"]["qubit_count"] == 2
    assert [g["type"] for g in out["snapshot"]["gates"]] == ["H", "CNOT", "Measure", "Measure"]


def test_parse_error_reports_only_user_frames():
    out = run_browser("nuclei_parse", "x = 1\nfoo(\n")
    assert out["snapshot"] is None
    assert "SyntaxError" in out["error"]
    out = run_browser("nuclei_parse", "x = 1\nundefined_name\n")
    assert 'File "untitled.py", line 2' in out["error"]
    assert "<string>" not in out["error"]
    assert "_run_user_code" not in out["error"]
    assert out["error"].rstrip().endswith("NameError: name 'undefined_name' is not defined")


def test_circuit_without_measurements_executes():
    code = "from qiskit import QuantumCircuit\nqc = QuantumCircuit(2)\nqc.h(0)\nqc.cx(0, 1)\n"
    out = run_browser("nuclei_execute", code, 100)
    assert out["error"] is None
    assert out["result"]["measurements"] == {}
    assert out["result"]["probabilities"] == pytest.approx({"00": 0.5, "11": 0.5})


def test_unsupported_qiskit_feature_points_to_desktop():
    code = "from qiskit_aer.noise import NoiseModel\n"
    out = run_browser("nuclei_execute", code, 10)
    assert "browser version of Qiskit" in out["error"]
    assert "desktop app" in out["error"]
    out = run_browser("nuclei_execute", "from qiskit import QuantumCircuit, transpile\nqc=QuantumCircuit(1)\ntranspile(qc)\n", 10)
    assert "transpile" in out["error"] and "desktop app" in out["error"]


def test_record_metric_is_available():
    code = BELL + "record_metric('fidelity', 0.5)\n"
    out = run_browser("nuclei_execute", code, 10)
    assert out["result"]["metrics"] == {"fidelity": 0.5}


def test_system_exit_does_not_crash_the_runtime():
    out = run_browser("nuclei_run_python", "import sys\nsys.exit(3)\n")
    assert "SystemExit" in out["error"]


def test_no_circuit_message():
    out = run_browser("nuclei_execute", "x = 1\n", 10)
    assert out["error"] == "No circuit found."


def test_mid_circuit_measurement_and_conditional():
    code = textwrap.dedent(
        """
        from qiskit import QuantumCircuit, QuantumRegister, ClassicalRegister
        qr = QuantumRegister(2, 'q'); cr = ClassicalRegister(2, 'c')
        qc = QuantumCircuit(qr, cr)
        qc.x(0)
        qc.measure(0, 0)
        qc.x(1).c_if(cr, 1)
        qc.measure(1, 1)
        """
    )
    out = run_browser("nuclei_execute", code, 50)
    assert out["error"] is None
    assert out["result"]["measurements"] == {"11": 50}


# --- parity against the real adapter -----------------------------------------
PARITY_PROGRAMS = {
    "bell": BELL,
    "ghz": "from qiskit import QuantumCircuit\nqc = QuantumCircuit(3, 3)\nqc.h(0)\nqc.cx(0,1)\nqc.cx(1,2)\nqc.measure([0,1,2],[0,1,2])\n",
    "rotations": "from qiskit import QuantumCircuit\nimport numpy as np\nqc = QuantumCircuit(2)\nqc.ry(0.7, 0)\nqc.rz(1.1, 1)\nqc.cp(0.4, 0, 1)\nqc.t(0)\nqc.sdg(1)\nqc.swap(0, 1)\nqc.measure_all()\n",
    "toffoli": "from qiskit import QuantumCircuit\nqc = QuantumCircuit(3, 3)\nqc.x(0)\nqc.x(1)\nqc.ccx(0, 1, 2)\nqc.cswap(2, 0, 1)\nqc.barrier()\nqc.measure_all()\n",
    "grover2": "from qiskit import QuantumCircuit\nqc = QuantumCircuit(2, 2)\nqc.h([0,1])\nqc.cz(0,1)\nqc.h([0,1])\nqc.z([0,1])\nqc.cz(0,1)\nqc.h([0,1])\nqc.measure([0,1],[0,1])\n",
}


@pytest.mark.parametrize("name", sorted(PARITY_PROGRAMS))
def test_matches_desktop_qiskit_adapter(name):
    pytest.importorskip("qiskit")
    pytest.importorskip("qiskit_aer")
    from kernel.executor import Executor

    code = PARITY_PROGRAMS[name]
    expected_result, expected_snapshot, *_rest = Executor().execute(code, 2000, language="python", seed=7)
    assert expected_result is not None
    ours = run_browser("nuclei_execute", code, 2000, 7)
    assert ours["error"] is None, ours["error"]

    exp, got = expected_result.to_dict(), ours["result"]
    assert got["probabilities"] == pytest.approx(exp["probabilities"], abs=1e-9)
    for a, b in zip(got["state_vector"], exp["state_vector"]):
        # global phase is unobservable; probabilities above are the contract
        assert abs(a["re"] ** 2 + a["im"] ** 2 - (b["re"] ** 2 + b["im"] ** 2)) < 1e-9
    for a, b in zip(got["bloch_coords"], exp["bloch_coords"]):
        assert a == pytest.approx(b, abs=1e-9)
    assert set(got["measurements"]) == set(exp["measurements"]) or not exp["measurements"]
    for key, count in exp["measurements"].items():
        assert abs(got["measurements"].get(key, 0) - count) < 250  # 2000 shots, loose
    assert ours["snapshot"] == expected_snapshot.to_dict()


def test_qft_unitary_is_the_discrete_fourier_transform():
    code = textwrap.dedent(
        """
        import numpy as np
        from qiskit.circuit.library import QFT
        from qiskit.quantum_info import Operator
        n = 3
        u = Operator(QFT(n)).data
        dim = 2 ** n
        w = np.exp(2j * np.pi / dim)
        dft = np.array([[w ** (j * k) for k in range(dim)] for j in range(dim)]) / np.sqrt(dim)
        print("DFT_OK", bool(np.allclose(u, dft)))
        inv = Operator(QFT(n, inverse=True)).data
        print("INV_OK", bool(np.allclose(inv, dft.conj().T)))
        """
    )
    out = run_browser("nuclei_run_python", code)
    assert out["error"] is None, out["error"]
    assert "DFT_OK True" in out["output"] and "INV_OK True" in out["output"]


def test_c_if_accepts_clbit_index_and_statevector_is_iterable():
    code = textwrap.dedent(
        """
        from qiskit import QuantumCircuit
        from qiskit.quantum_info import Statevector
        qc = QuantumCircuit(2, 2)
        qc.x(0)
        qc.measure(0, 0)
        qc.x(1).c_if(0, 1)
        qc.measure(1, 1)
        amps = list(Statevector.from_label("+"))
        """
    )
    out = run_browser("nuclei_execute", code, 20)
    assert out["error"] is None, out["error"]
    assert out["result"]["measurements"] == {"11": 20}


def test_measure_all_and_register_keys():
    code = textwrap.dedent(
        """
        from qiskit import QuantumCircuit
        qc = QuantumCircuit(2)
        qc.x(1)
        qc.measure_all()
        """
    )
    out = run_browser("nuclei_execute", code, 10)
    assert out["error"] is None, out["error"]
    assert out["result"]["measurements"] == {"10": 10}


def test_cirq_circuit_without_measurements_does_not_crash():
    pytest.importorskip("cirq")
    code = textwrap.dedent(
        """
        import cirq
        qs = cirq.LineQubit.range(3)
        circuit = cirq.Circuit(cirq.rx(0.7)(qs[0]), cirq.ry(1.2)(qs[1]), cirq.H(qs[2]))
        """
    )
    out = run_browser("nuclei_execute", code, 100)
    assert out["error"] is None, out["error"]
    result = out["result"]
    assert result["measurements"] == {}
    assert len(result["state_vector"]) == 8
    assert len(result["bloch_coords"]) == 3
    assert sum(result["probabilities"].values()) == pytest.approx(1.0)
    assert out["snapshot"]["framework"] == "cirq"


def test_cirq_bell_still_samples_and_reports_cirq_snapshot():
    pytest.importorskip("cirq")
    code = textwrap.dedent(
        """
        import cirq
        q0, q1 = cirq.LineQubit.range(2)
        circuit = cirq.Circuit([cirq.H(q0), cirq.CNOT(q0, q1), cirq.measure(q0, q1, key='result')])
        """
    )
    out = run_browser("nuclei_execute", code, 200, 3)
    assert out["error"] is None, out["error"]
    assert set(out["result"]["measurements"]) <= {"00", "11"}
    assert [g["type"] for g in out["snapshot"]["gates"]] == ["H", "CNOT", "Measure", "Measure"]


def test_mid_circuit_measurement_state_excludes_final_readout():
    # h, measure, h, measure: the Measurement lesson's demo. The shown state is
    # the one before the final readout, i.e. 50/50, never a collapsed basis state.
    code = (
        "from qiskit import QuantumCircuit\n"
        "qc = QuantumCircuit(1, 1)\nqc.h(0)\nqc.measure(0, 0)\nqc.h(0)\nqc.measure(0, 0)\n"
    )
    for seed in (1, 2, 3, 4, 5):
        out = run_browser("nuclei_execute", code, 1000, seed)
        assert out["error"] is None
        probs = out["result"]["probabilities"]
        assert probs["0"] == pytest.approx(0.5, abs=1e-9)
        assert probs["1"] == pytest.approx(0.5, abs=1e-9)
        counts = out["result"]["measurements"]
        assert abs(counts.get("0", 0) - 500) < 100


def test_mid_circuit_measurement_matches_desktop_probabilities():
    pytest.importorskip("qiskit")
    pytest.importorskip("qiskit_aer")
    from kernel.executor import Executor

    code = (
        "from qiskit import QuantumCircuit\n"
        "qc = QuantumCircuit(1, 1)\nqc.h(0)\nqc.measure(0, 0)\nqc.h(0)\nqc.measure(0, 0)\n"
    )
    expected, *_ = Executor().execute(code, 1000, language="python", seed=3)
    ours = run_browser("nuclei_execute", code, 1000, 3)
    assert ours["result"]["probabilities"] == pytest.approx(expected.to_dict()["probabilities"], abs=1e-9)


_STREAM_DRIVER = textwrap.dedent(
    """
    import json, sys
    sys.path[:0] = [{shim!r}, {runtime!r}]
    import kernel_runtime as rt
    lines = []
    rt.set_output_sink(lines.append)
    out = json.loads(rt.nuclei_run_python(sys.stdin.read()))
    sys.stdout.write("\\n@@RESULT@@" + json.dumps({{"lines": lines, "out": out}}))
    """
)


def run_streaming(code):
    driver = _STREAM_DRIVER.format(shim=str(SHIM_DIR), runtime=str(PYODIDE_DIR))
    proc = subprocess.run(
        [sys.executable, "-I", "-c", driver], input=code,
        capture_output=True, text=True, timeout=120,
    )
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout.split("@@RESULT@@", 1)[1])


def test_output_streams_line_by_line_without_duplicating_the_final_reply():
    got = run_streaming('print("step 0")\nprint("step 1")\nprint("tail", end="")\n')
    assert got["lines"] == ["step 0", "step 1", "tail"]
    assert got["out"]["output"] == ""
    assert got["out"]["error"] is None


def test_lines_printed_before_an_error_are_streamed_and_the_error_is_reported():
    got = run_streaming('print("before")\nraise ValueError("boom")\n')
    assert got["lines"][0] == "before"
    assert "ValueError: boom" in got["out"]["error"]


def test_a_failing_sink_falls_back_to_returning_the_whole_output():
    driver = _STREAM_DRIVER.format(shim=str(SHIM_DIR), runtime=str(PYODIDE_DIR)).replace(
        "rt.set_output_sink(lines.append)", "rt.set_output_sink(lambda line: 1 / 0)"
    )
    proc = subprocess.run(
        [sys.executable, "-I", "-c", driver], input='print("kept")\n',
        capture_output=True, text=True, timeout=120,
    )
    assert proc.returncode == 0, proc.stderr
    got = json.loads(proc.stdout.split("@@RESULT@@", 1)[1])
    assert got["out"]["output"] == "kept\n"


def test_qiskit_typo_reads_as_typo_with_suggestion():
    code = "from qiskit import QuantumCircuit\nqc = QuantumCircuit(1)\nqc.hh(0)\n"
    out = run_browser("nuclei_execute", code, 10)
    assert out["error"].rstrip().endswith(
        "AttributeError: 'QuantumCircuit' object has no attribute 'hh'. Did you mean: 'h'?"
    )
    assert "browser" not in out["error"] and "_nuclei_unsupported" not in out["error"]


def test_real_qiskit_method_outside_subset_is_browser_limit_without_module_prefix():
    code = "from qiskit import QuantumCircuit\nqc = QuantumCircuit(1)\nqc.assign_parameters({})\n"
    out = run_browser("nuclei_execute", code, 10)
    assert "isn't available in the browser version of Qiskit" in out["error"]
    assert "_nuclei_unsupported" not in out["error"]
    assert "UnsupportedAttribute: QuantumCircuit.assign_parameters()" in out["error"]


def test_module_typo_suggests_real_name():
    out = run_browser("nuclei_execute", "from qiskit import QuantumCirquit\n", 10)
    assert "QuantumCirquit" in out["error"] and "browser version" not in out["error"]
    out = run_browser("nuclei_execute", "import qiskit\nqiskit.QuantumCirquit(1)\n", 10)
    assert "Did you mean: 'QuantumCircuit'?" in out["error"]


def test_module_typo_suggestion_appears_exactly_once():
    out = run_browser("nuclei_execute", "import qiskit\nqiskit.QuantumCirquit(1)\n", 10)
    assert out["error"].count("Did you mean") == 1
    assert "?." not in out["error"]
    out = run_browser(
        "nuclei_execute", "import qiskit.quantum_info as qi\nqi.Statevectr\n", 10
    )
    assert out["error"].count("Did you mean") == 1


def test_import_typo_hides_shim_install_path():
    out = run_browser("nuclei_execute", "from qiskit import QuantumCirquit\n", 10)
    assert "/shim/" not in out["error"] and "__init__.py" not in out["error"]
    assert out["error"].count("Did you mean: 'QuantumCircuit'?") == 1


def test_traceback_names_the_running_tab_instead_of_string():
    out = run_browser("nuclei_parse", "x = 1\nundefined_name\n", "bell.py")
    assert 'File "bell.py", line 2' in out["error"]
    out = run_browser("nuclei_execute", "foo(\n", 10, None, "bell.py")
    assert 'File "bell.py", line 1' in out["error"] and "<string>" not in out["error"]
    out = run_browser("nuclei_run_python", "raise ValueError('x')\n", "my script.py")
    assert 'File "my script.py", line 1' in out["error"]


def test_hostile_filename_falls_back_to_untitled():
    out = run_browser("nuclei_run_python", "1/0\n", 'a"\n b.py')
    assert 'File "a b.py", line 1' in out["error"]
    out = run_browser("nuclei_run_python", "1/0\n", "   ")
    assert 'File "untitled.py", line 1' in out["error"]


def test_mistyped_top_level_module_gets_one_suggestion():
    out = run_browser("nuclei_execute", "from qiskitt import QuantumCircuit\n", 10)
    assert out["error"].rstrip().endswith("No module named 'qiskitt'. Did you mean: 'qiskit'?")
    assert out["error"].count("Did you mean") == 1
    out = run_browser("nuclei_run_python", "import numpyy\n")
    assert "Did you mean: 'numpy'?" in out["error"]


def test_unrelated_missing_module_gets_no_suggestion():
    out = run_browser("nuclei_run_python", "import totally_unrelated_thing\n")
    assert "Did you mean" not in out["error"]
    out = run_browser("nuclei_run_python", "import cirq.nope\n")
    assert out["error"].count("Did you mean") <= 1
