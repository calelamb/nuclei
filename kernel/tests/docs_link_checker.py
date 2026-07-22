"""Safe Markdown/MDX Research-doc link discovery for documentation tests."""

from __future__ import annotations

import re
import string
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlsplit

REPO_ROOT = Path(__file__).resolve().parents[2]
RESEARCH_DOCS_DIR = REPO_ROOT / "docs-site" / "src" / "content" / "docs" / "research"
RESEARCH_URL_PREFIX = "/docs/research/"
DOC_SOURCE_SUFFIXES = frozenset({".md", ".mdx"})
FENCE_OPEN = re.compile(r"^[ \t]{0,3}(`{3,}|~{3,})")
INLINE_CODE = re.compile(r"(`+).*?\1", re.DOTALL)
HTML_COMMENT = re.compile(r"<!--.*?-->|\{/\*.*?\*/\}", re.DOTALL)
MARKDOWN_ESCAPABLE = frozenset(string.punctuation)
TAG_NAME_CHARS = frozenset("_.:-")


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


def research_doc_targets(
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


def _reference_label(label: str) -> str:
    return " ".join(_markdown_unescape(label).split()).casefold()


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


def _name_end(text: str, start: int) -> int | None:
    if start >= len(text) or not (text[start].isalpha() or text[start] == "_"):
        return None
    cursor = start + 1
    while cursor < len(text):
        char = text[cursor]
        if not (char.isalnum() or char in TAG_NAME_CHARS):
            break
        cursor += 1
    return cursor


def _consume_quoted(text: str, start: int) -> tuple[str, int] | None:
    if start >= len(text) or text[start] not in "\"'":
        return None
    quote = text[start]
    cursor = start + 1
    while cursor < len(text):
        if text[cursor] == quote and not _is_escaped(text, cursor):
            return text[start + 1 : cursor], cursor + 1
        cursor += 1
    return None


def _consume_jsx_expression(text: str, start: int) -> int | None:
    if start >= len(text) or text[start] != "{":
        return None
    depth = 1
    quote: str | None = None
    cursor = start + 1
    while cursor < len(text):
        char = text[cursor]
        if quote:
            if char == quote and not _is_escaped(text, cursor):
                quote = None
        elif char in "\"'`":
            quote = char
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return cursor + 1
        cursor += 1
    return None


def _static_jsx_string(text: str, start: int, end: int) -> str | None:
    inner = text[start + 1 : end - 1].strip()
    parsed = _consume_quoted(inner, 0)
    if not parsed or parsed[1] != len(inner):
        return None
    return parsed[0]


def _attribute_value(text: str, start: int) -> tuple[str | None, int] | None:
    if start >= len(text):
        return None
    if text[start] in "\"'":
        return _consume_quoted(text, start)
    if text[start] == "{":
        end = _consume_jsx_expression(text, start)
        return (_static_jsx_string(text, start, end), end) if end else None
    cursor = start
    while cursor < len(text) and not text[cursor].isspace() and text[cursor] != ">":
        cursor += 1
    return (None, cursor) if cursor > start else None


def _parse_attribute(text: str, start: int) -> tuple[str, str | None, int] | None:
    name_end = _name_end(text, start)
    if name_end is None:
        return None
    name = text[start:name_end]
    cursor = _skip_whitespace(text, name_end)
    if cursor >= len(text) or text[cursor] != "=":
        return name, None, cursor
    value_start = _skip_whitespace(text, cursor + 1)
    value = _attribute_value(text, value_start)
    return (name, value[0], value[1]) if value else None


def _parse_tag(text: str, start: int) -> tuple[list[str], int] | None:
    cursor = start + 1
    closing = cursor < len(text) and text[cursor] == "/"
    cursor += 1 if closing else 0
    name_end = _name_end(text, cursor)
    if name_end is None:
        return None
    cursor = name_end
    if closing:
        cursor = _skip_whitespace(text, cursor)
        return ([], cursor + 1) if cursor < len(text) and text[cursor] == ">" else None
    hrefs: list[str] = []
    while cursor < len(text):
        cursor = _skip_whitespace(text, cursor)
        if text.startswith("/>", cursor):
            return hrefs, cursor + 2
        if cursor < len(text) and text[cursor] == ">":
            return hrefs, cursor + 1
        if cursor < len(text) and text[cursor] == "{":
            cursor = _consume_jsx_expression(text, cursor) or len(text)
            continue
        attribute = _parse_attribute(text, cursor)
        if not attribute:
            return [], len(text)
        name, value, cursor = attribute
        if name == "href" and value is not None:
            hrefs.append(value)
    return [], len(text)


def _tag_hrefs(text: str) -> list[str]:
    links: list[str] = []
    cursor = 0
    while cursor < len(text):
        start = text.find("<", cursor)
        if start < 0:
            break
        parsed = _parse_tag(text, start)
        if parsed is None:
            cursor = start + 1
            continue
        hrefs, cursor = parsed
        links.extend(hrefs)
    return links


def research_documents(research_root: Path) -> list[Path]:
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


def research_links(document: Path) -> list[str]:
    """Extract supported internal links while ignoring code and comments."""
    text = document.read_text(encoding="utf-8")
    visible = HTML_COMMENT.sub("", INLINE_CODE.sub("", _strip_fenced_code(text)))
    links = [*_markdown_links(visible), *_tag_hrefs(visible)]
    return list(dict.fromkeys(href for href in links if _is_research_href(href)))
