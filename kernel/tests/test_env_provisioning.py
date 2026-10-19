"""PRD 15 R-C: the Python requirement files, the shell's framework catalog and the
optional-dependency map must agree (R-14 one Qiskit range, R-16 ruff, torch/onnx entries).

The Rust catalog is the shell's source of truth for what it installs into the managed venv;
``kernel/requirements.txt`` is what CI and developers install. They drifted once (the catalog
had no bound and the owner ended up on Qiskit 2.x while CI tested 1.x), so this test reads
``frameworks.rs`` directly rather than duplicating the pins.
"""

from __future__ import annotations

import os
import re

import pytest

from kernel.discovery import _optional

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
FRAMEWORKS_RS = os.path.join(REPO_ROOT, "src-tauri", "src", "commands", "frameworks.rs")
QISKIT_RANGE = "qiskit>=1.2,<3"


def _read(*parts: str) -> str:
    with open(os.path.join(REPO_ROOT, *parts), encoding="utf-8") as handle:
        return handle.read()


def _requirement_lines(text: str) -> list[str]:
    return [line.strip() for line in text.splitlines() if line.strip() and not line.lstrip().startswith("#")]


def _catalog_entry(entry_id: str) -> str:
    """The Rust source block of one ``FrameworkInfo`` in ``CATALOG``."""
    source = _read("src-tauri", "src", "commands", "frameworks.rs")
    match = re.search(r'FrameworkInfo \{\s*id: "%s",(.*?)\n    \},' % re.escape(entry_id), source, re.S)
    assert match, f"catalog entry {entry_id!r} not found in frameworks.rs"
    return match.group(1)


def _catalog_field(entry_id: str, field: str) -> str:
    match = re.search(r'%s:\s*"([^"]*)"' % field, _catalog_entry(entry_id))
    assert match, f"{entry_id}.{field} not found"
    return match.group(1)


def test_requirements_txt_allows_qiskit_1_and_2():
    assert QISKIT_RANGE in _requirement_lines(_read("kernel", "requirements.txt"))


def test_agent_requirements_use_the_same_qiskit_range():
    assert QISKIT_RANGE in _requirement_lines(_read("kernel", "agent-requirements.txt"))


def test_catalog_qiskit_pip_spec_carries_the_same_range():
    pip_name = _catalog_field("qiskit", "pip_name")
    assert QISKIT_RANGE in pip_name.split()
    assert "qiskit-aer>=0.15,<1" in pip_name.split()


@pytest.mark.parametrize("package", ["websockets", "numpy", "ruff", "keyring"])
def test_core_deps_match_requirements_txt(package):
    """Every core dep the shell installs carries the same specifier as requirements.txt."""
    source = _read("src-tauri", "src", "commands", "frameworks.rs")
    block = re.search(r"const KERNEL_CORE_DEPS: &\[&str\] = &\[(.*?)\];", source, re.S)
    assert block, "KERNEL_CORE_DEPS not found"
    core = re.findall(r'"([^"]+)"', block.group(1))
    wanted = [line for line in _requirement_lines(_read("kernel", "requirements.txt")) if line.startswith(package)]
    assert wanted, f"{package} missing from requirements.txt"
    spec = wanted[0].replace(" ", "")
    # requirements.txt writes numpy>=1.26,<3.0 as `numpy>=1.26,<3.0`; compare verbatim.
    assert spec in core, f"{spec} not in KERNEL_CORE_DEPS {core}"


def test_ruff_is_in_the_kernel_import_probe():
    source = _read("src-tauri", "src", "commands", "frameworks.rs")
    probe = re.search(r'const KERNEL_CORE_IMPORT_PROBE: &str = "([^"]+)";', source)
    assert probe and "ruff" in probe.group(1)


@pytest.mark.parametrize(
    "entry_id, pip_name, import_name",
    [("torch", "torch>=2.4,<3", "torch"), ("onnx", "onnx>=1.16,<2", "onnx")],
)
def test_torch_and_onnx_are_research_catalog_entries(entry_id, pip_name, import_name):
    assert _catalog_field(entry_id, "pip_name") == pip_name
    assert _catalog_field(entry_id, "import_name") == import_name
    assert _catalog_field(entry_id, "group") == "research"
    assert "recommended: false" in _catalog_entry(entry_id)


def test_optional_map_names_torch_and_onnx():
    assert _optional.CATALOG_IDS["torch"] == "torch"
    assert _optional.CATALOG_IDS["onnx"] == "onnx"
    hint = _optional.install_hint(["torch"])
    assert hint["catalog_ids"] == ["torch"]
    assert "PyTorch" in hint["hint"]
    assert "ONNX" in _optional.install_hint(["onnx"])["hint"]


def test_requirements_declares_scipy_as_optional():
    """scipy arrives transitively with qiskit/cirq; it is documented, never required."""
    lines = _requirement_lines(_read("kernel", "requirements.txt"))
    assert not any(line.startswith("scipy") for line in lines)
    assert "scipy" in _read("kernel", "requirements.txt").lower()
