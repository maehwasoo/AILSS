from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


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
