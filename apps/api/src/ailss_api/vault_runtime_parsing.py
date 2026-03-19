from __future__ import annotations

import re
from typing import cast

import yaml  # type: ignore[import-untyped]

from .vault_runtime_constants import (
    AILSS_FRONTMATTER_ENTITY_VALUES,
    AILSS_FRONTMATTER_LAYER_VALUES,
    AILSS_FRONTMATTER_STATUS_VALUES,
    AILSS_TYPED_LINK_KEYS,
)
from .vault_runtime_fs import normalize_newlines
from .vault_runtime_types import (
    FrontmatterEnumViolation,
    NormalizedAilssNoteMeta,
    ParsedMarkdownNote,
    TypedLinkRecord,
)


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
