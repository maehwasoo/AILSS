from __future__ import annotations

from typing import Annotated, Literal

from mcp.server.fastmcp import FastMCP
from pydantic import Field

from .index_db import (
    SearchNotesFilters,
    list_keywords,
    list_tags,
    resolve_note_paths_by_wikilink_target,
    search_notes,
)
from .mcp_runtime_core import McpRuntime
from .mcp_runtime_helpers import _clean_optional_string, _normalize_filter_strings
from .models import RetrieveRequest
from .retrieval import retrieve_notes
from .vault_runtime import normalize_typed_link_target_input


def register_context_tools(server: FastMCP, runtime: McpRuntime) -> None:
    @server.tool(
        name="get_context",
        title="Get context",
        description="Semantic retrieval over the local index DB with stitched evidence.",
        structured_output=True,
    )
    def get_context(
        query: Annotated[str, Field(min_length=1)],
        path_prefix: str | None = None,
        tags_any: list[str] | None = None,
        tags_all: list[str] | None = None,
        top_k: Annotated[int, Field(ge=1, le=20)] = runtime.default_top_k,
        expand_top_k: Annotated[int, Field(ge=0, le=20)] = 5,
        hit_chunks_per_note: Annotated[int, Field(ge=1, le=5)] = 2,
        neighbor_window: Annotated[int, Field(ge=0, le=3)] = 1,
        max_evidence_chars_per_note: Annotated[int, Field(ge=200, le=20_000)] = 1500,
        include_file_preview: bool = False,
        max_chars_per_note: Annotated[int, Field(ge=200, le=50_000)] = 800,
    ) -> dict[str, object]:
        normalized_tags_any = _normalize_filter_strings(tags_any)
        normalized_tags_all = _normalize_filter_strings(tags_all)
        normalized_prefix = _clean_optional_string(path_prefix)
        args = {
            "query": query,
            "path_prefix": normalized_prefix,
            "tags_any": normalized_tags_any,
            "tags_all": normalized_tags_all,
            "top_k": top_k,
            "expand_top_k": expand_top_k,
            "hit_chunks_per_note": hit_chunks_per_note,
            "neighbor_window": neighbor_window,
            "max_evidence_chars_per_note": max_evidence_chars_per_note,
            "include_file_preview": include_file_preview,
            "max_chars_per_note": max_chars_per_note,
        }

        def run() -> dict[str, object]:
            response = retrieve_notes(
                RetrieveRequest(
                    query=query,
                    mode="semantic",
                    top_k=top_k,
                    path_prefix=normalized_prefix,
                    tags_any=normalized_tags_any,
                    tags_all=normalized_tags_all,
                    hit_chunks_per_note=hit_chunks_per_note,
                    neighbor_window=neighbor_window,
                    include_file_preview=include_file_preview,
                    max_evidence_chars_per_note=max_evidence_chars_per_note,
                    max_chars_per_note=max_chars_per_note,
                ),
                runtime.settings,
            )
            results = response.results[:top_k]
            expanded_result_count = min(max(0, expand_top_k), len(results))
            return {
                "query": query,
                "top_k": top_k,
                "db": str(runtime.db_path) if runtime.db_path else "<missing-db>",
                "used_chunks_k": response.usage.used_chunks_k,
                "applied_filters": {
                    "path_prefix": normalized_prefix,
                    "tags_any": normalized_tags_any,
                    "tags_all": normalized_tags_all,
                },
                "params": {
                    "expand_top_k": expanded_result_count,
                    "hit_chunks_per_note": hit_chunks_per_note,
                    "neighbor_window": neighbor_window,
                    "max_evidence_chars_per_note": max_evidence_chars_per_note,
                    "include_file_preview": bool(include_file_preview and runtime.vault_path),
                    "max_chars_per_note": max_chars_per_note,
                },
                "results": [
                    {
                        "path": item.path,
                        "distance": float(item.distance or 0.0),
                        "title": item.title,
                        "summary": item.summary,
                        "tags": item.tags,
                        "keywords": item.keywords,
                        "heading": item.heading,
                        "heading_path": item.heading_path,
                        "snippet": item.snippet,
                        "evidence_text": item.evidence_text
                        if index < expanded_result_count
                        else None,
                        "evidence_truncated": (
                            item.evidence_truncated if index < expanded_result_count else False
                        ),
                        "evidence_chunks": (
                            [
                                {
                                    "chunk_id": chunk.chunk_id,
                                    "chunk_index": chunk.chunk_index or 0,
                                    "kind": (
                                        chunk.kind if chunk.kind in {"hit", "neighbor"} else "hit"
                                    ),
                                    "distance": chunk.distance,
                                    "heading": chunk.heading,
                                    "heading_path": chunk.heading_path,
                                }
                                for chunk in item.evidence
                            ]
                            if index < expanded_result_count
                            else []
                        ),
                        "preview": item.preview,
                        "preview_truncated": item.preview_truncated,
                    }
                    for index, item in enumerate(results)
                ],
            }

        return runtime.call_tool("get_context", args, run)

    @server.tool(
        name="resolve_note",
        title="Resolve note",
        description="Resolve an id/title/wikilink target to indexed note paths.",
        structured_output=True,
    )
    def resolve_note(
        query: Annotated[str, Field(min_length=1)],
        limit: Annotated[int, Field(ge=1, le=200)] = 20,
    ) -> dict[str, object]:
        args = {"query": query, "limit": limit}

        def run() -> dict[str, object]:
            normalized_target = normalize_typed_link_target_input(query)
            if not normalized_target:
                raise RuntimeError(f'Cannot resolve an empty target: query="{query}"')
            candidates = resolve_note_paths_by_wikilink_target(
                runtime.conn,
                normalized_target,
                limit,
            )
            status: Literal["ok", "ambiguous", "not_found"]
            if not candidates:
                status = "not_found"
            elif len(candidates) == 1:
                status = "ok"
            else:
                status = "ambiguous"
            best = candidates[0] if candidates else None
            return {
                "query": {
                    "raw": query,
                    "normalized_target": normalized_target,
                    "limit": limit,
                },
                "status": status,
                "best": (
                    {
                        "path": best.path,
                        "title": best.title,
                        "matched_by": best.matched_by,
                    }
                    if best
                    else None
                ),
                "candidates": [
                    {
                        "path": item.path,
                        "title": item.title,
                        "matched_by": item.matched_by,
                    }
                    for item in candidates
                ],
            }

        return runtime.call_tool("resolve_note", args, run)

    @server.tool(
        name="search_notes",
        title="Search notes",
        description="Search indexed note metadata without embeddings.",
        structured_output=True,
    )
    def search_notes_tool(
        path_prefix: str | None = None,
        title_query: str | None = None,
        note_id: str | list[str] | None = None,
        entity: str | list[str] | None = None,
        layer: str | list[str] | None = None,
        status: str | list[str] | None = None,
        created_from: str | None = None,
        created_to: str | None = None,
        updated_from: str | None = None,
        updated_to: str | None = None,
        tags_any: list[str] | None = None,
        tags_all: list[str] | None = None,
        keywords_any: list[str] | None = None,
        sources_any: list[str] | None = None,
        order_by: Literal["path", "created", "updated"] = "path",
        order_dir: Literal["asc", "desc"] = "asc",
        limit: Annotated[int, Field(ge=1, le=500)] = 50,
    ) -> dict[str, object]:
        args = {
            "path_prefix": path_prefix,
            "title_query": title_query,
            "note_id": note_id,
            "entity": entity,
            "layer": layer,
            "status": status,
            "created_from": created_from,
            "created_to": created_to,
            "updated_from": updated_from,
            "updated_to": updated_to,
            "tags_any": tags_any,
            "tags_all": tags_all,
            "keywords_any": keywords_any,
            "sources_any": sources_any,
            "order_by": order_by,
            "order_dir": order_dir,
            "limit": limit,
        }

        def run() -> dict[str, object]:
            normalized_path_prefix = _clean_optional_string(path_prefix)
            normalized_title_query = _clean_optional_string(title_query)
            results = search_notes(
                runtime.conn,
                SearchNotesFilters(
                    path_prefix=normalized_path_prefix,
                    title_query=normalized_title_query,
                    note_id=note_id,
                    entity=entity,
                    layer=layer,
                    status=status,
                    created_from=created_from,
                    created_to=created_to,
                    updated_from=updated_from,
                    updated_to=updated_to,
                    tags_any=_normalize_filter_strings(tags_any),
                    tags_all=_normalize_filter_strings(tags_all),
                    keywords_any=_normalize_filter_strings(keywords_any),
                    sources_any=_normalize_filter_strings(sources_any),
                    order_by=order_by,
                    order_dir=order_dir,
                    limit=limit,
                ),
            )
            return {
                "filters": args,
                "results": [
                    {
                        "path": item.path,
                        "note_id": item.note_id,
                        "created": item.created,
                        "title": item.title,
                        "summary": item.summary,
                        "entity": item.entity,
                        "layer": item.layer,
                        "status": item.status,
                        "updated": item.updated,
                        "tags": item.tags,
                        "keywords": item.keywords,
                        "sources": item.sources,
                    }
                    for item in results
                ],
            }

        return runtime.call_tool("search_notes", args, run)

    @server.tool(
        name="list_tags",
        title="List tags",
        description="List indexed tags with usage counts.",
        structured_output=True,
    )
    def list_tags_tool(limit: Annotated[int, Field(ge=1, le=5000)] = 200) -> dict[str, object]:
        args = {"limit": limit}
        return runtime.call_tool(
            "list_tags",
            args,
            lambda: {"tags": list_tags(runtime.conn, limit)},
        )

    @server.tool(
        name="list_keywords",
        title="List keywords",
        description="List indexed keywords with usage counts.",
        structured_output=True,
    )
    def list_keywords_tool(
        limit: Annotated[int, Field(ge=1, le=5000)] = 200,
    ) -> dict[str, object]:
        args = {"limit": limit}
        return runtime.call_tool(
            "list_keywords",
            args,
            lambda: {"keywords": list_keywords(runtime.conn, limit)},
        )
