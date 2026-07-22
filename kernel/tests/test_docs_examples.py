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
import string
import sys
from pathlib import Path, PurePosixPath
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
RESEARCH_URL_PREFIX = "/docs/research/"
DOC_SOURCE_SUFFIXES = frozenset({".md", ".mdx"})
FENCE_OPEN = re.compile(r"^[ \t]{0,3}(`{3,}|~{3,})")
INLINE_CODE = re.compile(r"(`+).*?\1", re.DOTALL)
HTML_COMMENT = re.compile(r"<!--.*?-->|\{/\*.*?\*/\}", re.DOTALL)
MARKDOWN_ESCAPABLE = frozenset(string.punctuation)
HREF_ATTRIBUTE = re.compile(
    r"(?<![A-Za-z0-9_:-])href\s*=\s*(?:\"([^\"]+)\"|'([^']+)'|"
    r"\{\s*(?:\"([^\"]+)\"|'([^']+)')\s*\})"
)


def _within(path: Path, root: Path) -> bool:
    return path == root or path.is_relative_to(root)


def _source_candidates(target: Path, root: Path) -> tuple[Path, ...]:
    if target == root:
        return (root / "index.mdx", root / "index.md")
    if target.suffix.lower() in DOC_SOURCE_SUFFIXES:
        return (target,)
    return (
        Path(f"{target}.mdx"),
        Path(f"{target}.md"),
        target / "index.mdx",
        target / "index.md",
    )


def _research_doc_targets(
    href: str, research_root: Path = RESEARCH_DOCS_DIR
) -> tuple[Path, ...]:
    """Resolve candidate docs-site pages without allowing path escape."""
    parsed = urlsplit(href)
    decoded_path = unquote(parsed.path)
    assert decoded_path.startswith(
        RESEARCH_URL_PREFIX
    ), f"Not a Research docs URL: {href}"
    relative = decoded_path.removeprefix(RESEARCH_URL_PREFIX).rstrip("/")
    relative_path = PurePosixPath(relative)
    assert (
        not relative_path.is_absolute() and ".." not in relative_path.parts
    ), f"Research docs link escapes its root: {href}"
    assert "\\" not in relative, f"Research docs link escapes its root: {href}"
    target = research_root.joinpath(*relative_path.parts)
    resolved_root = research_root.resolve()
    candidates = _source_candidates(target, research_root)
    for candidate in candidates:
        assert _within(
            candidate.resolve(), resolved_root
        ), f"Research docs link escapes its root: {href}"
    return candidates


def _strip_fenced_code(text: str) -> str:
    kept: list[str] = []
    fence: tuple[str, int] | None = None
    for line in text.splitlines(keepends=True):
        marker = line.lstrip(" \t").rstrip()
        if fence and marker and set(marker) == {fence[0]} and len(marker) >= fence[1]:
            fence = None
            continue
        opening = FENCE_OPEN.match(line) if fence is None else None
        if opening:
            token = opening.group(1)
            fence = (token[0], len(token))
        elif fence is None:
            kept.append(line)
    return "".join(kept)


def _reference_label(label: str) -> str:
    return " ".join(_markdown_unescape(label).split()).casefold()


def _is_escaped(text: str, index: int) -> bool:
    slash_count = 0
    cursor = index - 1
    while cursor >= 0 and text[cursor] == "\\":
        slash_count += 1
        cursor -= 1
    return slash_count % 2 == 1


def _markdown_unescape(value: str) -> str:
    output: list[str] = []
    cursor = 0
    while cursor < len(value):
        if (
            value[cursor] == "\\"
            and cursor + 1 < len(value)
            and value[cursor + 1] in MARKDOWN_ESCAPABLE
        ):
            cursor += 1
        output.append(value[cursor])
        cursor += 1
    return "".join(output)


def _parse_bracket(text: str, start: int) -> tuple[str, int] | None:
    if start >= len(text) or text[start] != "[" or _is_escaped(text, start):
        return None
    depth = 1
    cursor = start + 1
    while cursor < len(text):
        char = text[cursor]
        if char == "\\" and cursor + 1 < len(text):
            cursor += 2
            continue
        if char == "[":
            depth += 1
        elif char == "]":
            depth -= 1
            if depth == 0:
                return text[start + 1 : cursor], cursor + 1
        cursor += 1
    return None


def _skip_whitespace(text: str, start: int) -> int:
    cursor = start
    while cursor < len(text) and text[cursor].isspace():
        cursor += 1
    return cursor


def _parse_destination(text: str, start: int) -> tuple[str, int] | None:
    if start >= len(text):
        return None
    if text[start] == "<":
        cursor = start + 1
        while cursor < len(text):
            if text[cursor] == ">" and not _is_escaped(text, cursor):
                return _markdown_unescape(text[start + 1 : cursor]), cursor + 1
            if text[cursor] in "\n<":
                return None
            cursor += 1
        return None
    return _parse_bare_destination(text, start)


def _parse_bare_destination(text: str, start: int) -> tuple[str, int] | None:
    depth = 0
    cursor = start
    while cursor < len(text):
        char = text[cursor]
        escaped = (
            char == "\\"
            and cursor + 1 < len(text)
            and text[cursor + 1] in MARKDOWN_ESCAPABLE
        )
        if escaped:
            cursor += 2
            continue
        if char == "(":
            depth += 1
        elif char == ")":
            if depth == 0:
                break
            depth -= 1
        elif char.isspace():
            break
        cursor += 1
    if cursor == start or depth != 0:
        return None
    return _markdown_unescape(text[start:cursor]), cursor


def _parse_title(text: str, start: int) -> int | None:
    if start >= len(text) or text[start] not in "\"'(":
        return None
    closer = ")" if text[start] == "(" else text[start]
    cursor = start + 1
    while cursor < len(text):
        if text[cursor] == closer and not _is_escaped(text, cursor):
            return cursor + 1
        if text[cursor] == "\n":
            return None
        cursor += 1
    return None


def _parse_inline_target(text: str, start: int) -> tuple[str, int] | None:
    if start >= len(text) or text[start] != "(":
        return None
    destination_start = _skip_whitespace(text, start + 1)
    parsed = _parse_destination(text, destination_start)
    if not parsed:
        return None
    destination, cursor = parsed
    had_space = cursor < len(text) and text[cursor].isspace()
    cursor = _skip_whitespace(text, cursor)
    if cursor < len(text) and text[cursor] == ")":
        return destination, cursor + 1
    if not had_space:
        return None
    title_end = _parse_title(text, cursor)
    if title_end is None:
        return None
    cursor = _skip_whitespace(text, title_end)
    if cursor >= len(text) or text[cursor] != ")":
        return None
    return destination, cursor + 1


def _parse_definition(line: str) -> tuple[str, str] | None:
    content = line.rstrip("\r\n")
    indent = len(content) - len(content.lstrip(" "))
    if indent > 3:
        return None
    content = content[indent:]
    label = _parse_bracket(content, 0)
    if not label or label[1] >= len(content) or content[label[1]] != ":":
        return None
    destination_start = _skip_whitespace(content, label[1] + 1)
    destination = _parse_destination(content, destination_start)
    if not destination:
        return None
    href, cursor = destination
    cursor = _skip_whitespace(content, cursor)
    if cursor < len(content):
        title_end = _parse_title(content, cursor)
        if title_end is None:
            return None
        cursor = _skip_whitespace(content, title_end)
    if cursor != len(content):
        return None
    return _reference_label(label[0]), href


def _extract_definitions(text: str) -> tuple[dict[str, str], str]:
    definitions: dict[str, str] = {}
    body: list[str] = []
    for line in text.splitlines(keepends=True):
        definition = _parse_definition(line)
        if definition:
            definitions.setdefault(*definition)
        else:
            body.append(line)
    return definitions, "".join(body)


def _is_image_label(text: str, start: int) -> bool:
    return start > 0 and text[start - 1] == "!" and not _is_escaped(text, start - 1)


def _skip_image(text: str, label_end: int) -> int:
    if label_end < len(text) and text[label_end] == "(":
        target = _parse_inline_target(text, label_end)
        return target[1] if target else label_end + 1
    if label_end < len(text) and text[label_end] == "[":
        reference = _parse_bracket(text, label_end)
        return reference[1] if reference else label_end + 1
    return label_end


def _markdown_links(text: str) -> list[str]:
    definitions, body = _extract_definitions(text)
    links: list[str] = []
    cursor = 0
    while cursor < len(body):
        label = _parse_bracket(body, cursor) if body[cursor] == "[" else None
        if not label:
            cursor += 1
            continue
        label_text, label_end = label
        if _is_image_label(body, cursor):
            cursor = _skip_image(body, label_end)
            continue
        href, cursor = _link_after_label(body, label_text, label_end, definitions)
        if href:
            links.append(href)
    return links


def _link_after_label(
    text: str,
    label: str,
    label_end: int,
    definitions: dict[str, str],
) -> tuple[str | None, int]:
    if label_end < len(text) and text[label_end] == "(":
        target = _parse_inline_target(text, label_end)
        return (target[0], target[1]) if target else (None, label_end)
    if label_end < len(text) and text[label_end] == "[":
        reference = _parse_bracket(text, label_end)
        if not reference:
            return None, label_end
        key = _reference_label(reference[0] or label)
        return definitions.get(key), reference[1]
    return definitions.get(_reference_label(label)), label_end


def _tag_hrefs(text: str) -> list[str]:
    links: list[str] = []
    cursor = 0
    while cursor < len(text):
        start = text.find("<", cursor)
        if start < 0:
            break
        end = _tag_end(text, start + 1)
        if end is None:
            break
        for match in HREF_ATTRIBUTE.finditer(text[start : end + 1]):
            links.append(next(group for group in match.groups() if group is not None))
        cursor = end + 1
    return links


def _tag_end(text: str, start: int) -> int | None:
    quote: str | None = None
    cursor = start
    while cursor < len(text):
        char = text[cursor]
        if quote and char == quote and not _is_escaped(text, cursor):
            quote = None
        elif not quote and char in "\"'":
            quote = char
        elif not quote and char == ">":
            return cursor
        cursor += 1
    return None


def _research_documents(research_root: Path) -> list[Path]:
    resolved_root = research_root.resolve()
    documents = sorted(
        path
        for path in research_root.rglob("*")
        if path.is_file() and path.suffix.lower() in DOC_SOURCE_SUFFIXES
    )
    assert all(_within(path.resolve(), resolved_root) for path in documents)
    return documents


def _is_research_href(href: str) -> bool:
    parsed = urlsplit(href)
    return (
        not parsed.scheme
        and not parsed.netloc
        and parsed.path.startswith(RESEARCH_URL_PREFIX)
    )


def _research_links(document: Path) -> list[str]:
    """Extract supported internal links while ignoring code and comments."""
    text = document.read_text(encoding="utf-8")
    visible = HTML_COMMENT.sub("", INLINE_CODE.sub("", _strip_fenced_code(text)))
    links = [*_markdown_links(visible), *_tag_hrefs(visible)]
    return list(dict.fromkeys(href for href in links if _is_research_href(href)))


def _load_example(module_name: str, filename: str):
    """Import a docs example file from the fixtures path."""
    spec = importlib.util.spec_from_file_location(module_name, EXAMPLES_DIR / filename)
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
    for document in _research_documents(RESEARCH_DOCS_DIR):
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


def test_research_link_extraction_supports_mdx_and_reference_forms(
    tmp_path: Path,
) -> None:
    document = tmp_path / "links.mdx"
    document.write_text(
        """
[inline](/docs/research/inline/)
[titled](/docs/research/titled/ "Inline title")
[full reference][full]
[collapsed reference][]
[shortcut]

[full]: /docs/research/full-reference/ "Reference title"
[collapsed reference]: </docs/research/collapsed-reference/>
[shortcut]: /docs/research/shortcut/

<a href="/docs/research/html-anchor/">HTML anchor</a>
<Card href={'/docs/research/mdx-anchor/?mode=build#result'} />

`[inline code](/docs/research/not-a-link/)`
```md
[fenced](/docs/research/not-a-link-either/)
```
Plain text /docs/research/not-a-link-three/ is not a link.
[external](https://example.com/docs/research/not-internal/)
""",
        encoding="utf-8",
    )

    assert set(_research_links(document)) == {
        "/docs/research/inline/",
        "/docs/research/titled/",
        "/docs/research/full-reference/",
        "/docs/research/collapsed-reference/",
        "/docs/research/shortcut/",
        "/docs/research/html-anchor/",
        "/docs/research/mdx-anchor/?mode=build#result",
    }


def test_research_link_extraction_handles_balancing_images_and_exact_href(
    tmp_path: Path,
) -> None:
    document = tmp_path / "adversarial-links.mdx"
    document.write_text(
        r"""
[a [nested] label](/docs/research/nested-label/)
[guide](/docs/research/guide_(advanced)/)
[escaped \[label\]](/docs/research/escaped-label/)
[escaped destination](/docs/research/guide_\(escaped\)/)
[escaped reference][escaped \[key\]]
[escaped \[key\]]: /docs/research/escaped-reference/

![alt][image]
![collapsed image][]
![shortcut image]
![nested [alt]](/docs/research/not-an-inline-link/)
[image]: /docs/research/not-a-reference-link/
[collapsed image]: /docs/research/not-a-collapsed-image-link/
[shortcut image]: /docs/research/not-a-shortcut-image-link/

<Card
  data-href="/docs/research/not-a-data-link/"
  aria-href="/docs/research/not-an-aria-link/"
  href="/docs/research/exact-href/"
/>
""",
        encoding="utf-8",
    )

    assert set(_research_links(document)) == {
        "/docs/research/nested-label/",
        "/docs/research/guide_(advanced)/",
        "/docs/research/escaped-label/",
        "/docs/research/guide_(escaped)/",
        "/docs/research/escaped-reference/",
        "/docs/research/exact-href/",
    }


def test_research_document_discovery_is_recursive(tmp_path: Path) -> None:
    nested = tmp_path / "nested"
    nested.mkdir()
    top_mdx = tmp_path / "top.mdx"
    nested_md = nested / "page.md"
    ignored = nested / "notes.txt"
    for path in (top_mdx, nested_md, ignored):
        path.write_text("content", encoding="utf-8")

    assert _research_documents(tmp_path) == [nested_md, top_mdx]


def test_research_doc_targets_preserve_dotted_slugs_and_directory_indexes(
    tmp_path: Path,
) -> None:
    dotted = tmp_path / "decoder.v2.mdx"
    nested_index = tmp_path / "nested" / "index.md"
    nested_index.parent.mkdir()
    dotted.write_text("dotted", encoding="utf-8")
    nested_index.write_text("index", encoding="utf-8")

    assert dotted in _research_doc_targets("/docs/research/decoder.v2/", tmp_path)
    assert nested_index in _research_doc_targets("/docs/research/nested/", tmp_path)
    assert _research_doc_targets("/docs/research/decoder.v2.mdx", tmp_path) == (dotted,)


def test_research_doc_targets_reject_symlink_escape(tmp_path: Path) -> None:
    research_root = tmp_path / "research"
    outside = tmp_path / "outside"
    research_root.mkdir()
    outside.mkdir()
    (outside / "secret.mdx").write_text("secret", encoding="utf-8")
    (research_root / "linked").symlink_to(outside, target_is_directory=True)

    with pytest.raises(AssertionError, match="escapes its root"):
        _research_doc_targets("/docs/research/linked/secret/", research_root)


def test_qec_workbench_page_is_in_the_research_sidebar() -> None:
    config = (REPO_ROOT / "docs-site" / "astro.config.mjs").read_text(encoding="utf-8")
    qec_studio = config.index("'research/qec-studio'")
    qec_workbench = config.index("'research/qec-workbench'")
    campaigns = config.index("'research/campaigns'")

    assert qec_studio < qec_workbench < campaigns
