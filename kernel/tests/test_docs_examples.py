"""Run the docs-site worked examples against the real kernel seams.

/docs/extending/framework-adapters/ embeds docs-site/fixtures/examples/
toy_adapter.py and /docs/extending/hardware-providers/ embeds
echo_provider.py via Vite ``?raw`` imports — the pages render whatever is
in those files, and this suite executes the same files through the real
``Executor`` and ``HardwareManager``. If a kernel interface changes
underneath an example, this suite goes red before the docs can lie. (Same
contract as test_docs_fixtures.py for the protocol JSON fixtures.)

The toy adapter's fake framework module is installed into ``sys.modules``
as ``toyq`` so the snippet's ``import toyq`` resolves, and its AdapterSpec
is prepended to ``kernel.executor.ADAPTER_SPECS`` via monkeypatch — the
exact registration mechanism the docs describe (in-tree adapters simply
add their spec to the tuple instead).

The echo provider is injected into a fresh, isolated ``HardwareManager``
the same way kernel/tests/hardware/test_manager.py injects its stub:
``auto_reconnect=False`` keeps the OS keyring untouched, and the job store
lives under tmp_path. ``connect_provider`` is called with empty credentials,
which skips keyring persistence (manager.py: ``if persist and credentials``).
"""

from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

import pytest

import kernel.executor as executor_module
from kernel.executor import Executor
from kernel.hardware.job_store import JobStore
from kernel.hardware.manager import HardwareManager

REPO_ROOT = Path(__file__).resolve().parents[2]
EXAMPLES_DIR = REPO_ROOT / "docs-site" / "fixtures" / "examples"
DOCS_DIR = REPO_ROOT / "docs-site" / "src" / "content" / "docs"
RESEARCH_DOCS_DIR = DOCS_DIR / "research"
QEC_WORKBENCH_DOC = RESEARCH_DOCS_DIR / "qec-workbench.mdx"
MARKDOWN_LINK = re.compile(r"\[[^\]]*\]\((/docs/research/[^)\s]*)\)")


def _research_doc_targets(href: str) -> tuple[Path, ...]:
    """Resolve candidate docs-site pages without allowing path escape."""
    parsed = urlsplit(href)
    decoded_path = unquote(parsed.path)
    prefix = "/docs/research/"
    assert decoded_path.startswith(prefix), f"Not a Research docs URL: {href}"
    relative = decoded_path.removeprefix(prefix).rstrip("/")
    parts = Path(relative).parts
    assert relative and ".." not in parts and "\\" not in relative, (
        f"Research docs link escapes its root: {href}"
    )
    target = RESEARCH_DOCS_DIR.joinpath(*parts)
    assert target.is_relative_to(RESEARCH_DOCS_DIR)
    if target.suffix:
        return (target,)
    return (target.with_suffix(".mdx"), target.with_suffix(".md"))


def _research_links(document: Path) -> list[str]:
    """Extract only absolute internal Research-doc links from an MDX page."""
    return MARKDOWN_LINK.findall(document.read_text(encoding="utf-8"))


def _load_example(module_name: str, filename: str):
    """Import a docs example file from the fixtures path."""
    spec = importlib.util.spec_from_file_location(
        module_name, EXAMPLES_DIR / filename
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# ───────────────────────── toy adapter ─────────────────────────


@pytest.fixture
def toyq(monkeypatch):
    """Load toy_adapter.py as the importable module ``toyq`` and register
    its AdapterSpec ahead of the built-in specs."""
    module = _load_example("toyq", "toy_adapter.py")
    sys.modules["toyq"] = module
    monkeypatch.setattr(
        executor_module,
        "ADAPTER_SPECS",
        (module.TOY_SPEC, *executor_module.ADAPTER_SPECS),
    )
    yield module
    sys.modules.pop("toyq", None)


def test_toy_adapter_parse_produces_snapshot(toyq):
    executor = Executor()

    snapshot, stdout, stderr, error = executor.parse(toyq.TOY_SNIPPET)

    assert error is None
    assert stdout == "" and stderr == ""
    assert snapshot is not None
    assert snapshot.framework == "toy"
    assert snapshot.qubit_count == 2
    assert snapshot.classical_bit_count == 2
    # Greedy layering via assign_layer: H on q0 (layer 0), CNOT touching
    # both qubits (layer 1), both measurements free in layer 2.
    assert [(g.type, g.layer) for g in snapshot.gates] == [
        ("H", 0),
        ("CNOT", 1),
        ("Measure", 2),
        ("Measure", 2),
    ]
    assert snapshot.gates[1].controls == [0]
    assert snapshot.gates[1].targets == [1]
    assert snapshot.depth == 3


def test_toy_adapter_execute_returns_deterministic_result(toyq):
    executor = Executor()

    result, snapshot, stdout, stderr, error = executor.execute(
        toyq.TOY_SNIPPET, shots=64
    )

    assert error is None
    assert snapshot is not None and snapshot.framework == "toy"
    assert result is not None
    assert result.probabilities == {"00": 1.0}
    assert result.measurements == {"00": 64}
    assert result.shot_count == 64
    assert len(result.state_vector) == 4
    assert result.state_vector[0] == {"re": 1.0, "im": 0.0}
    assert result.bloch_coords == [{"x": 0.0, "y": 0.0, "z": 1.0}] * 2


def test_toy_spec_is_prepended_without_shadowing_other_frameworks(toyq):
    # The ordering caveat the docs call out: the toy spec sits first, and
    # its regex is narrow enough that existing frameworks still resolve.
    assert executor_module.ADAPTER_SPECS[0].framework == "toy"
    executor = Executor()
    spec = executor._detect_adapter_spec("from qiskit import QuantumCircuit\n")
    assert spec is not None and spec.framework == "qiskit"


# ───────────────────────── echo provider ─────────────────────────


@pytest.fixture
def echo_manager(tmp_path):
    """A fresh HardwareManager with only the EchoProvider registered."""
    module = _load_example("echo_provider_example", "echo_provider.py")
    manager = HardwareManager(
        auto_reconnect=False,
        job_store=JobStore(path=str(tmp_path / "jobs.json")),
    )
    manager._providers = {"echo": module.EchoProvider()}
    manager._connected = set()
    manager._jobs = {}
    return manager, module


def test_echo_provider_connects_and_lists_backends(echo_manager):
    manager, module = echo_manager

    assert manager.connect_provider("echo", {}) is True
    backends = manager.list_backends("echo")

    assert [b.name for b in backends] == ["echo_1"]
    assert backends[0].provider == "echo"
    assert backends[0].to_dict()["qubit_count"] == 8


def test_echo_provider_submit_completes_synchronously(echo_manager):
    manager, _module = echo_manager
    manager.connect_provider("echo", {})

    handle = manager.submit_job("echo", "circuit-source", "echo_1", shots=128)

    assert handle.status == "complete"
    assert handle.error is None
    assert handle.shots == 128
    # The manager registered + persisted the job for us (JobStore interplay).
    assert manager.get_job_status(handle.id).status == "complete"
    assert manager.get_results(handle.id) == {
        "measurements": {"00": 128},
        "status": "complete",
    }


def test_echo_provider_submit_requires_connection(echo_manager):
    manager, _module = echo_manager
    # Not connected: the MANAGER raises (manager.py:152-154). Provider-side
    # failures after connection are returned as failed JobHandles instead.
    with pytest.raises(RuntimeError):
        manager.submit_job("echo", "circuit-source", "echo_1", shots=8)


# ─────────────────── research docs ───────────────────


def test_qec_workbench_page_and_research_links_resolve() -> None:
    assert QEC_WORKBENCH_DOC.is_file(), "Missing Research docs page: qec-workbench.mdx"

    broken: list[str] = []
    for document in sorted(RESEARCH_DOCS_DIR.glob("*.mdx")):
        for href in _research_links(document):
            targets = _research_doc_targets(href)
            if not any(target.is_file() for target in targets):
                expected = " or ".join(target.name for target in targets)
                broken.append(f"{document.name}: {href} -> {expected}")

    assert broken == [], "Broken Research docs links:\n" + "\n".join(broken)


@pytest.mark.parametrize(
    "href",
    [
        "/docs/research/qec-workbench/",
        "/docs/research/qec-workbench/#what-persists",
        "/docs/research/qec-workbench/?view=build#what-persists",
    ],
)
def test_research_doc_link_normalization(href: str) -> None:
    assert QEC_WORKBENCH_DOC in _research_doc_targets(href)


@pytest.mark.parametrize(
    "href",
    [
        "/docs/research/../reference/configuration/",
        "/docs/research/%2e%2e/reference/configuration/",
        "/docs/research/..%5Creference%5Cconfiguration/",
    ],
)
def test_research_doc_links_cannot_escape_research_root(href: str) -> None:
    with pytest.raises(AssertionError, match="escapes its root"):
        _research_doc_targets(href)
