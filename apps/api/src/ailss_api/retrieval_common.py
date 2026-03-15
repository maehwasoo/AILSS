from __future__ import annotations

import json
import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from .config import Settings
from .models import EvidenceChunk

TOKEN_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{1,}")


@dataclass(frozen=True)
class NoteMeta:
    title: str | None
    summary: str | None
    tags: list[str]
    keywords: list[str]


@dataclass(frozen=True)
class SemanticHit:
    chunk_id: str
    path: str
    chunk_index: int
    heading: str | None
    heading_path: list[str]
    content: str
    distance: float


@dataclass(frozen=True)
class SemanticSelection:
    path: str
    hits: list[SemanticHit]

    @property
    def best(self) -> SemanticHit:
        return self.hits[0]


@dataclass
class LexicalNoteAccumulator:
    path: str
    title: str | None
    summary: str | None
    score: float
    evidence: list[EvidenceChunk]


@dataclass(frozen=True)
class PreviewResult:
    text: str | None
    truncated: bool


@dataclass(frozen=True)
class StitchResult:
    text: str | None
    truncated: bool
    used_chunk_ids: list[str]


def load_note_metadata(
    conn: sqlite3.Connection,
    paths: list[str],
    tables: frozenset[str],
) -> dict[str, NoteMeta]:
    if not paths:
        return {}

    placeholders = ", ".join("?" for _ in paths)
    notes_rows = conn.execute(
        f"SELECT path, title, summary FROM notes WHERE path IN ({placeholders})",
        paths,
    ).fetchall()
    metadata: dict[str, NoteMeta] = {
        str(row["path"]): NoteMeta(
            title=normalize_optional_text(row["title"]),
            summary=normalize_optional_text(row["summary"]),
            tags=[],
            keywords=[],
        )
        for row in notes_rows
    }

    if "note_tags" in tables:
        for row in conn.execute(
            f"SELECT path, tag FROM note_tags WHERE path IN ({placeholders}) ORDER BY tag",
            paths,
        ).fetchall():
            path = str(row["path"])
            existing = metadata.get(path, NoteMeta(title=None, summary=None, tags=[], keywords=[]))
            metadata[path] = NoteMeta(
                title=existing.title,
                summary=existing.summary,
                tags=[*existing.tags, str(row["tag"])],
                keywords=existing.keywords,
            )

    if "note_keywords" in tables:
        for row in conn.execute(
            "SELECT path, keyword FROM note_keywords "
            f"WHERE path IN ({placeholders}) ORDER BY keyword",
            paths,
        ).fetchall():
            path = str(row["path"])
            existing = metadata.get(path, NoteMeta(title=None, summary=None, tags=[], keywords=[]))
            metadata[path] = NoteMeta(
                title=existing.title,
                summary=existing.summary,
                tags=existing.tags,
                keywords=[*existing.keywords, str(row["keyword"])],
            )

    return metadata


def list_chunks_by_indices(
    conn: sqlite3.Connection,
    path: str,
    indices: list[int],
) -> list[sqlite3.Row]:
    if not indices:
        return []
    placeholders = ", ".join("?" for _ in indices)
    return conn.execute(
        f"""
        SELECT chunk_id, chunk_index, heading, heading_path_json, content
        FROM chunks
        WHERE path = ? AND chunk_index IN ({placeholders})
        ORDER BY chunk_index
        """,
        [path, *indices],
    ).fetchall()


def stitch_chunks(chunks: list[sqlite3.Row], max_chars: int) -> StitchResult:
    budget = max(1, min(max_chars, 20_000))
    text = ""
    truncated = False
    used_chunk_ids: list[str] = []
    for chunk in chunks:
        part = str(chunk["content"]).strip()
        if not part:
            continue
        separator = "\n\n" if text else ""
        next_text = f"{text}{separator}{part}"
        if len(next_text) <= budget:
            text = next_text
            used_chunk_ids.append(str(chunk["chunk_id"]))
            continue

        remaining = budget - len(text) - len(separator)
        if remaining > 0:
            text = f"{text}{separator}{part[:remaining]}"
            used_chunk_ids.append(str(chunk["chunk_id"]))
        truncated = True
        break

    return StitchResult(
        text=text or None,
        truncated=truncated,
        used_chunk_ids=used_chunk_ids,
    )


def stitch_text_segments(segments: list[str], max_chars: int) -> StitchResult:
    budget = max(1, min(max_chars, 20_000))
    text = ""
    truncated = False
    used_segment_ids: list[str] = []
    for index, segment in enumerate(segments):
        part = segment.strip()
        if not part:
            continue
        separator = "\n\n" if text else ""
        next_text = f"{text}{separator}{part}"
        if len(next_text) <= budget:
            text = next_text
            used_segment_ids.append(str(index))
            continue
        remaining = budget - len(text) - len(separator)
        if remaining > 0:
            text = f"{text}{separator}{part[:remaining]}"
            used_segment_ids.append(str(index))
        truncated = True
        break

    return StitchResult(text=text or None, truncated=truncated, used_chunk_ids=used_segment_ids)


def read_note_preview(
    settings: Settings,
    note_path: str,
    max_chars: int,
    include_preview: bool,
) -> PreviewResult:
    if not include_preview:
        return PreviewResult(text=None, truncated=False)

    vault_path = settings.resolved_vault_path
    if vault_path is None:
        return PreviewResult(text=None, truncated=False)

    candidate = vault_path / Path(note_path)
    if not candidate.exists():
        return PreviewResult(text=None, truncated=False)

    text = candidate.read_text(encoding="utf-8")
    if len(text) <= max_chars:
        return PreviewResult(text=text.strip() or None, truncated=False)
    return PreviewResult(text=text[:max_chars].strip() or None, truncated=True)


def score_row(
    *,
    query_text: str,
    query_terms: list[str],
    search_terms: list[str],
    path: str,
    title: str | None,
    summary: str | None,
    heading: str | None,
    content: str,
) -> float:
    haystacks = {
        "path": path.casefold(),
        "title": (title or "").casefold(),
        "summary": (summary or "").casefold(),
        "heading": (heading or "").casefold(),
        "content": content.casefold(),
    }

    score = 0.0
    for term in query_terms:
        score += haystacks["title"].count(term) * 2.0
        score += haystacks["summary"].count(term) * 1.6
        score += haystacks["heading"].count(term) * 1.3
        score += haystacks["content"].count(term) * 1.0
        score += haystacks["path"].count(term) * 0.5

    if query_text:
        if query_text in haystacks["title"]:
            score += 3.0
        if query_text in haystacks["summary"]:
            score += 2.5
        if query_text in haystacks["content"]:
            score += 1.5

    coverage = sum(1 for term in search_terms if term and term in haystacks["content"])
    score += coverage * 0.75
    return score


def excerpt_text(content: str, search_terms: list[str]) -> str:
    normalized = content.strip()
    if not normalized:
        return ""
    lowered = normalized.casefold()
    for term in search_terms:
        if not term:
            continue
        index = lowered.find(term.casefold())
        if index < 0:
            continue
        start = max(0, index - 80)
        end = min(len(normalized), index + len(term) + 160)
        excerpt = normalized[start:end].strip()
        prefix = "..." if start > 0 else ""
        suffix = "..." if end < len(normalized) else ""
        return f"{prefix}{excerpt}{suffix}"
    return normalized[:240] + ("..." if len(normalized) > 240 else "")


def tokenize_query(query: str) -> list[str]:
    return [token.casefold() for token in TOKEN_PATTERN.findall(query.casefold())]


def escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def normalize_optional_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def parse_heading_path(value: object) -> list[str]:
    if value is None:
        return []
    raw = str(value).strip()
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except ValueError:
        return []
    if not isinstance(parsed, list):
        return []
    return [str(item) for item in parsed]
