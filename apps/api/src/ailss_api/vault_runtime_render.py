from __future__ import annotations

import json
import re
from typing import cast

from .vault_runtime_constants import (
    AILSS_REQUIRED_FRONTMATTER_KEYS,
    AILSS_TYPED_LINK_KEYS,
)
from .vault_runtime_fs import normalize_newlines, now_iso_seconds, sha256_text
from .vault_runtime_parsing import (
    coerce_non_empty_string,
    id_from_created,
    normalize_string_list,
    to_wikilink,
)
from .vault_runtime_types import MarkdownChunk


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
