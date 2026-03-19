from __future__ import annotations

import hashlib
import json
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import cast

import yaml  # type: ignore[import-untyped]

AILSS_TYPED_LINK_ONTOLOGY = (
    {"rel": "instance_of", "constraints": None},
    {"rel": "part_of", "constraints": None},
    {"rel": "depends_on", "constraints": None},
    {"rel": "uses", "constraints": None},
    {"rel": "implements", "constraints": None},
    {"rel": "cites", "constraints": None},
    {"rel": "summarizes", "constraints": None},
    {"rel": "derived_from", "constraints": None},
    {"rel": "explains", "constraints": None},
    {"rel": "supports", "constraints": {"conflicts_with": ("contradicts",)}},
    {"rel": "contradicts", "constraints": None},
    {"rel": "verifies", "constraints": None},
    {"rel": "blocks", "constraints": None},
    {"rel": "mitigates", "constraints": None},
    {"rel": "measures", "constraints": None},
    {
        "rel": "produces",
        "constraints": {
            "source_entities": ("procedure", "pipeline", "workflow"),
            "target_entities": (
                "artifact",
                "dataset",
                "document",
                "software",
                "dashboard",
                "reference",
            ),
        },
    },
    {
        "rel": "authored_by",
        "constraints": {"target_entities": ("person", "organization")},
    },
    {
        "rel": "owned_by",
        "constraints": {
            "max_targets": 1,
            "target_entities": ("person", "organization"),
        },
    },
    {"rel": "supersedes", "constraints": None},
    {"rel": "same_as", "constraints": None},
)
AILSS_TYPED_LINK_KEYS: tuple[str, ...] = tuple(
    cast(str, item["rel"]) for item in AILSS_TYPED_LINK_ONTOLOGY
)
AILSS_TYPED_LINK_ONTOLOGY_BY_REL = {item["rel"]: item for item in AILSS_TYPED_LINK_ONTOLOGY}

AILSS_FRONTMATTER_STATUS_VALUES = ("draft", "in-review", "active", "archived")
AILSS_FRONTMATTER_LAYER_VALUES = (
    "strategic",
    "conceptual",
    "logical",
    "physical",
    "operational",
)
AILSS_FRONTMATTER_ENTITY_VALUES = (
    "interface",
    "pipeline",
    "procedure",
    "dashboard",
    "checklist",
    "workflow",
    "decide",
    "review",
    "plan",
    "implement",
    "approve",
    "reject",
    "observe",
    "measure",
    "test",
    "verify",
    "learn",
    "research",
    "summarize",
    "publish",
    "meet",
    "audit",
    "deploy",
    "rollback",
    "refactor",
    "design",
    "delete",
    "update",
    "create",
    "schedule",
    "migrate",
    "analyze",
    "concept",
    "document",
    "project",
    "artifact",
    "person",
    "organization",
    "place",
    "event",
    "task",
    "method",
    "tool",
    "idea",
    "principle",
    "heuristic",
    "pattern",
    "definition",
    "question",
    "software",
    "dataset",
    "reference",
    "hub",
    "guide",
    "log",
    "structure",
    "architecture",
)
AILSS_REQUIRED_FRONTMATTER_KEYS = (
    "id",
    "created",
    "title",
    "summary",
    "aliases",
    "entity",
    "layer",
    "tags",
    "keywords",
    "status",
    "updated",
    "source",
)

DEFAULT_IGNORE_DIRS = frozenset(
    {
        ".git",
        ".obsidian",
        ".trash",
        ".backups",
        ".ailss",
        "node_modules",
    }
)


@dataclass(frozen=True)
class TypedLinkRecord:
    rel: str
    to_target: str
    to_wikilink: str
    position: int


@dataclass(frozen=True)
class FrontmatterEnumViolation:
    key: str
    value: str | None


@dataclass(frozen=True)
class NormalizedAilssNoteMeta:
    note_id: str | None
    created: str | None
    title: str | None
    summary: str | None
    entity: str | None
    layer: str | None
    status: str | None
    updated: str | None
    tags: list[str]
    keywords: list[str]
    sources: list[str]
    frontmatter: dict[str, object]
    typed_links: list[TypedLinkRecord]


@dataclass(frozen=True)
class ParsedMarkdownNote:
    frontmatter: dict[str, object]
    body: str


@dataclass(frozen=True)
class VaultMarkdownFile:
    abs_path: Path
    rel_path: str
    mtime_ms: int
    size: int
    sha256: str


@dataclass(frozen=True)
class MarkdownChunk:
    content: str
    content_sha256: str
    heading: str | None
    heading_path: list[str]


def now_iso_seconds() -> str:
    current = time.localtime()
    return (
        f"{current.tm_year:04d}-{current.tm_mon:02d}-{current.tm_mday:02d}"
        f"T{current.tm_hour:02d}:{current.tm_min:02d}:{current.tm_sec:02d}"
    )


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def normalize_newlines(text: str) -> str:
    return text.replace("\r\n", "\n")


def normalize_vault_rel_path(value: str) -> str:
    return value.replace("\\", "/").lstrip("/")


def is_default_ignored_vault_rel_path(rel_path: str) -> bool:
    normalized = normalize_vault_rel_path(rel_path).strip()
    if not normalized:
        return False

    segments = [segment for segment in normalized.split("/") if segment]
    return any(segment in DEFAULT_IGNORE_DIRS for segment in segments[:-1])


def resolve_vault_path_safely(vault_path: Path, vault_rel_path: str) -> Path:
    candidate = (vault_path / vault_rel_path).resolve()
    root = vault_path.resolve()
    try:
        candidate.relative_to(root)
    except ValueError as error:
        raise ValueError("Refusing to access a path outside the vault.") from error
    return candidate


def list_markdown_files(vault_path: Path) -> list[Path]:
    results: list[Path] = []
    for path in sorted(vault_path.rglob("*.md")):
        rel_path = normalize_vault_rel_path(str(path.relative_to(vault_path)))
        if is_default_ignored_vault_rel_path(rel_path):
            continue
        if not path.is_file():
            continue
        results.append(path)
    return results


def stat_markdown_file(vault_path: Path, abs_path: Path) -> VaultMarkdownFile:
    stat = abs_path.stat()
    contents = abs_path.read_bytes()
    return VaultMarkdownFile(
        abs_path=abs_path,
        rel_path=normalize_vault_rel_path(str(abs_path.relative_to(vault_path))),
        mtime_ms=int(stat.st_mtime_ns / 1_000_000),
        size=stat.st_size,
        sha256=sha256_bytes(contents),
    )


def read_utf8_file(abs_path: Path) -> str:
    return abs_path.read_text(encoding="utf-8")


def atomic_write_utf8_file(abs_path: Path, text: str) -> None:
    tmp_path = abs_path.with_name(f".{abs_path.name}.tmp-{os.getpid()}-{int(time.time() * 1000)}")
    tmp_path.write_text(text, encoding="utf-8")
    try:
        tmp_path.replace(abs_path)
    except Exception:
        if abs_path.exists():
            abs_path.unlink()
        tmp_path.replace(abs_path)


def split_frontmatter(markdown: str) -> tuple[str, str] | None:
    normalized = normalize_newlines(markdown)
    input_text = normalized[1:] if normalized.startswith("\ufeff") else normalized
    if not input_text.startswith("---\n"):
        return None

    lines = input_text.split("\n")
    if (lines[0] if lines else "") != "---":
        return None

    end_index = -1
    for index in range(1, len(lines)):
        line = lines[index] or ""
        if line in {"---", "..."}:
            end_index = index
            break

    if end_index < 0:
        return None

    frontmatter_raw = "\n".join(lines[1:end_index])
    body = "\n".join(lines[end_index + 1 :])
    return frontmatter_raw, body


def sanitize_frontmatter_for_wikilinks(frontmatter_raw: str) -> str:
    lines = normalize_newlines(frontmatter_raw).split("\n")
    sanitized: list[str] = []

    list_pattern = re.compile(r"^(\s*-\s*)(\[\[[^\r\n]*\]\])(\s*(#.*)?)$")
    kv_pattern = re.compile(r"^(\s*[^:\r\n]+:\s*)(\[\[[^\r\n]*\]\])(\s*(#.*)?)$")

    for line in lines:
        trimmed = line.strip()
        if not trimmed or trimmed.startswith("#"):
            sanitized.append(line)
            continue

        list_match = list_pattern.match(line)
        if list_match:
            sanitized.append(f'{list_match.group(1)}"{list_match.group(2)}"{list_match.group(3)}')
            continue

        kv_match = kv_pattern.match(line)
        if kv_match:
            sanitized.append(f'{kv_match.group(1)}"{kv_match.group(2)}"{kv_match.group(3)}')
            continue

        sanitized.append(line)

    return "\n".join(sanitized)


def parse_markdown_note(markdown: str) -> ParsedMarkdownNote:
    split = split_frontmatter(markdown)
    if split is None:
        return ParsedMarkdownNote(frontmatter={}, body=markdown)

    frontmatter_raw, body = split
    sanitized_frontmatter = sanitize_frontmatter_for_wikilinks(frontmatter_raw)
    try:
        loaded = yaml.safe_load(sanitized_frontmatter)
        frontmatter = cast(dict[str, object] | None, loaded)
    except yaml.YAMLError:
        return ParsedMarkdownNote(frontmatter={}, body=body)

    if not isinstance(frontmatter, dict):
        return ParsedMarkdownNote(frontmatter={}, body=body)

    return ParsedMarkdownNote(frontmatter=frontmatter, body=body)


def coerce_string(value: object) -> str | None:
    if isinstance(value, str):
        trimmed = value.strip()
        return trimmed or None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    return None


def coerce_trimmed_string_or_empty(value: object) -> str | None:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    return None


def coerce_non_empty_string(value: object) -> str | None:
    coerced = coerce_trimmed_string_or_empty(value)
    if coerced is None or coerced == "":
        return None
    return coerced


def flatten_unknown_to_strings(value: object) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        flattened: list[str] = []
        for item in value:
            flattened.extend(flatten_unknown_to_strings(cast(object, item)))
        return flattened
    return []


def normalize_string_list(value: object) -> list[str]:
    deduped: list[str] = []
    seen: set[str] = set()
    for item in flatten_unknown_to_strings(value):
        trimmed = item.strip()
        if not trimmed or trimmed in seen:
            continue
        seen.add(trimmed)
        deduped.append(trimmed)
    return deduped


def to_wikilink(value: str) -> str:
    trimmed = value.strip()
    if not trimmed:
        return "[[]]"
    if trimmed.startswith("[[") and trimmed.endswith("]]"):
        return trimmed
    return f"[[{trimmed}]]"


def wikilink_target(value: str) -> str:
    wikilink = to_wikilink(value)
    inner = wikilink[2:-2].strip()
    no_display = inner.split("|", 1)[0].strip()
    no_heading = no_display.split("#", 1)[0].strip()
    return no_heading or no_display or inner


def normalize_typed_link_target_input(value: str) -> str:
    trimmed = value.strip()
    if not trimmed:
        return ""
    return wikilink_target(trimmed)


def normalize_ailss_note_meta(frontmatter: dict[str, object]) -> NormalizedAilssNoteMeta:
    tags = normalize_string_list(frontmatter.get("tags"))
    keywords = normalize_string_list(frontmatter.get("keywords"))
    sources = normalize_string_list(frontmatter.get("source"))

    typed_links: list[TypedLinkRecord] = []
    for rel in AILSS_TYPED_LINK_KEYS:
        for index, raw_value in enumerate(normalize_string_list(frontmatter.get(rel))):
            normalized_wikilink = to_wikilink(raw_value)
            typed_links.append(
                TypedLinkRecord(
                    rel=rel,
                    to_target=wikilink_target(normalized_wikilink),
                    to_wikilink=normalized_wikilink,
                    position=index,
                )
            )

    normalized_frontmatter = dict(frontmatter)
    normalized_frontmatter["tags"] = tags
    normalized_frontmatter["keywords"] = keywords
    normalized_frontmatter["source"] = sources
    for rel in AILSS_TYPED_LINK_KEYS:
        normalized_frontmatter[rel] = [
            to_wikilink(item) for item in normalize_string_list(frontmatter.get(rel))
        ]

    return NormalizedAilssNoteMeta(
        note_id=coerce_string(frontmatter.get("id")),
        created=coerce_string(frontmatter.get("created")),
        title=coerce_string(frontmatter.get("title")),
        summary=coerce_string(frontmatter.get("summary")),
        entity=coerce_string(frontmatter.get("entity")),
        layer=coerce_string(frontmatter.get("layer")),
        status=coerce_string(frontmatter.get("status")),
        updated=coerce_string(frontmatter.get("updated")),
        tags=tags,
        keywords=keywords,
        sources=sources,
        frontmatter=normalized_frontmatter,
        typed_links=typed_links,
    )


def validate_ailss_frontmatter_enums(
    frontmatter: dict[str, object],
) -> list[FrontmatterEnumViolation]:
    violations: list[FrontmatterEnumViolation] = []

    if "status" in frontmatter:
        status = coerce_string(frontmatter.get("status"))
        if status is None or status not in AILSS_FRONTMATTER_STATUS_VALUES:
            violations.append(
                FrontmatterEnumViolation(
                    key="status",
                    value=coerce_trimmed_string_or_empty(frontmatter.get("status")),
                )
            )

    if "layer" in frontmatter:
        layer_value = frontmatter.get("layer")
        layer = coerce_string(layer_value)
        is_unset = layer_value is None or (isinstance(layer_value, str) and not layer_value.strip())
        if not is_unset and (layer is None or layer not in AILSS_FRONTMATTER_LAYER_VALUES):
            violations.append(
                FrontmatterEnumViolation(
                    key="layer",
                    value=coerce_trimmed_string_or_empty(layer_value),
                )
            )

    if "entity" in frontmatter:
        entity_value = frontmatter.get("entity")
        entity = coerce_string(entity_value)
        is_unset = entity_value is None or (
            isinstance(entity_value, str) and not entity_value.strip()
        )
        if not is_unset and (entity is None or entity not in AILSS_FRONTMATTER_ENTITY_VALUES):
            violations.append(
                FrontmatterEnumViolation(
                    key="entity",
                    value=coerce_trimmed_string_or_empty(entity_value),
                )
            )

    return violations


def has_frontmatter_block(markdown: str) -> bool:
    normalized = normalize_newlines(markdown)
    if not normalized.startswith("---\n"):
        return False
    return "\n---\n" in normalized[4:] or "\n...\n" in normalized[4:]


def id_from_created(created: str) -> str | None:
    trimmed = created.strip()
    if not trimmed:
        return None
    normalized = trimmed[:19].replace(" ", "T")
    digits = normalized.replace("-", "").replace(":", "").replace("T", "")
    if len(digits) < 14:
        return None
    return digits[:14]


def _is_simple_yaml_string(value: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 _.\-]*", value))


def yaml_scalar(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        if not value:
            return '""'
        if re.fullmatch(r"\d+", value) or re.fullmatch(r"(?i:true|false|null|~)", value):
            return json.dumps(value)
        if _is_simple_yaml_string(value):
            return value
        return json.dumps(value)
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, list):
        return json.dumps(value)
    return json.dumps(value)


def build_ailss_frontmatter(
    *,
    title: str,
    now: str | None = None,
    tags: list[str] | None = None,
    overrides: dict[str, object] | None = None,
    preserve: dict[str, object] | None = None,
) -> dict[str, object]:
    current = now or now_iso_seconds()
    default_id = (
        id_from_created(current) or current.replace("-", "").replace(":", "").replace("T", "")[:14]
    )
    base: dict[str, object] = {
        "id": default_id,
        "created": current,
        "title": title,
        "summary": None,
        "aliases": [],
        "entity": None,
        "layer": None,
        "tags": tags or [],
        "keywords": [],
        "status": "draft",
        "updated": current,
        "source": [],
    }
    merged = dict(base)
    if preserve:
        merged.update(preserve)
    if overrides:
        merged.update(overrides)
    for key, value in base.items():
        merged.setdefault(key, value)
    merged["id"] = coerce_non_empty_string(merged.get("id")) or cast(str, base["id"])
    return merged


def render_frontmatter_yaml(frontmatter: dict[str, object]) -> str:
    reserved = set(AILSS_REQUIRED_FRONTMATTER_KEYS) | set(AILSS_TYPED_LINK_KEYS)
    lines: list[str] = []
    for key in AILSS_REQUIRED_FRONTMATTER_KEYS:
        serialized = yaml_scalar(frontmatter.get(key))
        lines.append(f"{key}: {serialized}" if serialized else f"{key}:")

    for key in AILSS_TYPED_LINK_KEYS:
        if key not in frontmatter:
            continue
        values = normalize_string_list(frontmatter.get(key))
        if not values:
            continue
        lines.append(f"{key}: {yaml_scalar([to_wikilink(item) for item in values])}")

    for key in sorted(frontmatter):
        if key in reserved:
            continue
        serialized = yaml_scalar(frontmatter.get(key))
        lines.append(f"{key}: {serialized}" if serialized else f"{key}:")

    return "\n".join(lines)


def render_markdown_with_frontmatter(*, frontmatter: dict[str, object], body: str) -> str:
    cleaned_body = body.lstrip("\n")
    return f"---\n{render_frontmatter_yaml(frontmatter)}\n---\n\n{cleaned_body}"


def chunk_markdown_by_headings(body_markdown: str, *, max_chars: int = 4000) -> list[MarkdownChunk]:
    cap = max(1, max_chars)
    body = normalize_newlines(body_markdown).strip()
    if not body:
        return []

    lines = body.split("\n")
    sections: list[tuple[str | None, list[str], list[str]]] = []
    current_heading: str | None = None
    current_heading_path: list[str] = []
    current_buffer: list[str] = []
    in_fence = False

    def push_current() -> None:
        content = "\n".join(current_buffer).strip()
        if content:
            sections.append((current_heading, list(current_heading_path), [content]))

    for line in lines:
        if re.match(r"^```", line):
            in_fence = not in_fence

        if not in_fence:
            heading_match = re.match(r"^(#{1,6})\s+(.*)$", line)
            if heading_match:
                push_current()
                hashes = heading_match.group(1)
                heading_text = heading_match.group(2).strip()
                if not heading_text:
                    current_buffer.append(line)
                    continue
                depth = len(hashes)
                next_path = list(current_heading_path)
                keep_length = max(0, depth - 1)
                del next_path[keep_length:]
                next_path.append(heading_text)
                current_heading = heading_text
                current_heading_path = next_path
                current_buffer = [line]
                continue

        current_buffer.append(line)

    push_current()

    chunks: list[MarkdownChunk] = []
    for heading, heading_path, section_buffer in sections:
        full_text = "\n".join(section_buffer).strip()
        if not full_text:
            continue
        if len(full_text) <= cap:
            chunks.append(
                MarkdownChunk(
                    content=full_text,
                    content_sha256=sha256_text(full_text),
                    heading=heading,
                    heading_path=heading_path,
                )
            )
            continue

        paragraphs = re.split(r"\n{2,}", full_text)
        buffer = ""

        def hard_split(text: str) -> list[str]:
            return [text[index : index + cap] for index in range(0, len(text), cap)]

        def split_oversized_paragraph(paragraph: str) -> list[str]:
            if len(paragraph) <= cap:
                return [paragraph]
            parts: list[str] = []
            line_buffer = ""
            for raw_line in paragraph.split("\n"):
                next_value = f"{line_buffer}\n{raw_line}" if line_buffer else raw_line
                if len(next_value) > cap and line_buffer:
                    parts.append(line_buffer)
                    line_buffer = raw_line
                else:
                    line_buffer = next_value
                if len(line_buffer) > cap:
                    hard_parts = hard_split(line_buffer)
                    parts.extend(hard_parts[:-1])
                    line_buffer = hard_parts[-1]
            if line_buffer.strip():
                parts.append(line_buffer)
            return parts

        def push_chunk(
            text: str,
            *,
            section_heading: str | None = heading,
            section_heading_path: list[str] = heading_path,
        ) -> None:
            content = text.strip()
            if not content:
                return
            chunks.append(
                MarkdownChunk(
                    content=content,
                    content_sha256=sha256_text(content),
                    heading=section_heading,
                    heading_path=section_heading_path,
                )
            )

        def flush_buffer() -> None:
            nonlocal buffer
            if not buffer.strip():
                return
            push_chunk(buffer)
            buffer = ""

        for paragraph in paragraphs:
            if len(paragraph) > cap:
                flush_buffer()
                for part in split_oversized_paragraph(paragraph):
                    push_chunk(part)
                buffer = ""
                continue

            next_value = f"{buffer}\n\n{paragraph}" if buffer else paragraph
            if len(next_value) > cap and buffer:
                flush_buffer()
                buffer = paragraph
                continue
            buffer = next_value

        flush_buffer()

    return chunks
