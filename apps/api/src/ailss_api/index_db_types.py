from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from .vault_runtime import TypedLinkRecord


@dataclass(frozen=True)
class OpenIndexDbOptions:
    db_path: Path
    embedding_model: str
    embedding_dim: int


@dataclass(frozen=True)
class ChunkEmbeddingCacheItem:
    chunk_id: str
    embedding_input_sha256: str
    embedding: list[float] | None


@dataclass(frozen=True)
class TypedLinkBackref:
    from_path: str
    from_title: str | None
    rel: str
    to_target: str
    to_wikilink: str


@dataclass(frozen=True)
class TypedLinkRelFacet:
    rel: str
    count: int


@dataclass(frozen=True)
class ResolvedNoteTarget:
    path: str
    title: str | None
    matched_by: Literal["path", "note_id", "title"]


@dataclass(frozen=True)
class IndexNoteMeta:
    path: str
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
class SearchNotesFilters:
    path_prefix: str | None = None
    title_query: str | None = None
    note_id: str | list[str] | None = None
    entity: str | list[str] | None = None
    layer: str | list[str] | None = None
    status: str | list[str] | None = None
    created_from: str | None = None
    created_to: str | None = None
    updated_from: str | None = None
    updated_to: str | None = None
    tags_any: list[str] | None = None
    tags_all: list[str] | None = None
    keywords_any: list[str] | None = None
    sources_any: list[str] | None = None
    order_by: Literal["path", "created", "updated"] = "path"
    order_dir: Literal["asc", "desc"] = "asc"
    limit: int = 50


@dataclass(frozen=True)
class SearchNotesResult:
    path: str
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


@dataclass(frozen=True)
class TypedLinkQuery:
    rel: str | None = None
    rels: list[str] | None = None
    to_target: str | None = None
    limit: int = 100


@dataclass(frozen=True)
class TypedLinkRelFacetQuery:
    path_prefix: str | None = None
    limit: int = 200
    order_by: Literal["count_desc", "rel_asc"] = "count_desc"
