from __future__ import annotations

from collections import deque
from dataclasses import asdict
from typing import Annotated, Any, Literal

from mcp.server.fastmcp import FastMCP
from pydantic import Field

from .index_db import (
    SearchNotesFilters,
    TypedLinkQuery,
    TypedLinkRelFacetQuery,
    find_notes_by_typed_link,
    get_note_meta,
    list_keywords,
    list_tags,
    list_typed_link_rels,
    resolve_note_paths_by_wikilink_target,
    search_notes,
)
from .mcp_runtime_core import McpRuntime
from .mcp_runtime_helpers import (
    REQUIRED_FRONTMATTER_KEYS,
    TypedLinkDiagnostic,
    _clean_optional_string,
    _collect_typed_link_diagnostics,
    _normalize_filter_strings,
    _resolve_target_candidates,
    _scan_vault_notes_for_frontmatter_validate,
)
from .models import RetrieveRequest
from .retrieval import retrieve_notes
from .vault_runtime import (
    AILSS_FRONTMATTER_ENTITY_VALUES,
    AILSS_FRONTMATTER_LAYER_VALUES,
    AILSS_FRONTMATTER_STATUS_VALUES,
    AILSS_TYPED_LINK_KEYS,
    list_markdown_files,
    normalize_typed_link_target_input,
    normalize_vault_rel_path,
    read_utf8_file,
    resolve_vault_path_safely,
)


def register_read_tools(server: FastMCP, runtime: McpRuntime) -> None:
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
        top_k: Annotated[int, Field(ge=1, le=50)] = runtime.default_top_k,
        expand_top_k: Annotated[int, Field(ge=0, le=50)] = 5,
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
                    "expand_top_k": min(max(0, expand_top_k), top_k),
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
                        "evidence_text": item.evidence_text,
                        "evidence_truncated": item.evidence_truncated,
                        "evidence_chunks": [
                            {
                                "chunk_id": chunk.chunk_id,
                                "chunk_index": chunk.chunk_index or 0,
                                "kind": chunk.kind if chunk.kind in {"hit", "neighbor"} else "hit",
                                "distance": chunk.distance,
                                "heading": chunk.heading,
                                "heading_path": chunk.heading_path,
                            }
                            for chunk in item.evidence
                        ],
                        "preview": item.preview,
                        "preview_truncated": item.preview_truncated,
                    }
                    for item in results
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

    @server.tool(
        name="list_typed_link_rels",
        title="List typed-link relations",
        description="List typed-link relation keys with usage counts.",
        structured_output=True,
    )
    def list_typed_link_rels_tool(
        path_prefix: str | None = None,
        limit: Annotated[int, Field(ge=1, le=5000)] = 200,
        order_by: Literal["count_desc", "rel_asc"] = "count_desc",
    ) -> dict[str, object]:
        args = {"path_prefix": path_prefix, "limit": limit, "order_by": order_by}

        def run() -> dict[str, object]:
            canonical_rels = set(AILSS_TYPED_LINK_KEYS)
            normalized_path_prefix = _clean_optional_string(path_prefix)
            rows = list_typed_link_rels(
                runtime.conn,
                TypedLinkRelFacetQuery(
                    path_prefix=normalized_path_prefix,
                    limit=limit,
                    order_by=order_by,
                ),
            )
            return {
                "query": {
                    "path_prefix": normalized_path_prefix,
                    "limit": limit,
                    "order_by": order_by,
                },
                "rels": [
                    {
                        "rel": row.rel,
                        "count": row.count,
                        "canonical": row.rel in canonical_rels,
                    }
                    for row in rows
                ],
            }

        return runtime.call_tool("list_typed_link_rels", args, run)

    @server.tool(
        name="find_typed_links_incoming",
        title="Find typed links incoming",
        description="Find incoming typed-link references to a target.",
        structured_output=True,
    )
    def find_typed_links_incoming(
        rel: str | None = None,
        to_target: str | None = None,
        limit: Annotated[int, Field(ge=1, le=1000)] = 100,
        canonical_only: bool = True,
    ) -> dict[str, object]:
        args = {
            "rel": rel,
            "to_target": to_target,
            "limit": limit,
            "canonical_only": canonical_only,
        }

        def run() -> dict[str, object]:
            query = TypedLinkQuery(
                rel=_clean_optional_string(rel),
                rels=list(AILSS_TYPED_LINK_KEYS) if canonical_only else None,
                to_target=_clean_optional_string(to_target),
                limit=limit,
            )
            backrefs = find_notes_by_typed_link(runtime.conn, query)
            return {
                "query": {
                    "rel": query.rel,
                    "to_target": query.to_target,
                    "limit": limit,
                    "canonical_only": canonical_only,
                },
                "backrefs": [asdict(item) for item in backrefs],
            }

        return runtime.call_tool("find_typed_links_incoming", args, run)

    @server.tool(
        name="expand_typed_links_outgoing",
        title="Expand typed links outgoing",
        description="Expand outgoing typed links from a seed note into a bounded graph.",
        structured_output=True,
    )
    def expand_typed_links_outgoing(
        path: Annotated[str, Field(min_length=1)],
        max_notes: Annotated[int, Field(ge=1, le=200)] = 50,
        max_edges: Annotated[int, Field(ge=1, le=10_000)] = 2000,
        max_links_per_note: Annotated[int, Field(ge=1, le=200)] = 40,
        max_resolutions_per_target: Annotated[int, Field(ge=1, le=20)] = 5,
    ) -> dict[str, object]:
        args = {
            "path": path,
            "max_notes": max_notes,
            "max_edges": max_edges,
            "max_links_per_note": max_links_per_note,
            "max_resolutions_per_target": max_resolutions_per_target,
        }

        def run() -> dict[str, object]:
            seed_meta = get_note_meta(runtime.conn, path)
            if seed_meta is None:
                raise RuntimeError(
                    f'Note metadata not found for path="{path}". Re-run indexing first.'
                )

            visited = {path}
            queue: deque[tuple[str, int]] = deque([(path, 0)])
            nodes: list[dict[str, object]] = []
            edges: list[dict[str, object]] = []
            truncated = False

            while queue and len(nodes) < max_notes:
                current_path, hop = queue.popleft()
                meta = get_note_meta(runtime.conn, current_path)
                nodes.append(
                    {
                        "path": current_path,
                        "hop": hop,
                        "title": meta.title if meta else None,
                        "summary": meta.summary if meta else None,
                        "entity": meta.entity if meta else None,
                        "layer": meta.layer if meta else None,
                        "status": meta.status if meta else None,
                        "updated": meta.updated if meta else None,
                        "tags": meta.tags if meta else [],
                        "keywords": meta.keywords if meta else [],
                    }
                )
                if meta is None:
                    continue

                for link in meta.typed_links[:max_links_per_note]:
                    resolved = _resolve_target_candidates(
                        runtime.conn,
                        link.to_target,
                        max_resolutions_per_target,
                    )
                    for match in resolved:
                        if len(edges) >= max_edges:
                            truncated = True
                            break
                        next_path = str(match["path"])
                        edges.append(
                            {
                                "direction": "outgoing",
                                "rel": link.rel,
                                "target": link.to_target,
                                "from_path": current_path,
                                "to_path": next_path,
                                "to_wikilink": link.to_wikilink,
                            }
                        )
                        if next_path not in visited:
                            visited.add(next_path)
                            queue.append((next_path, hop + 1))
                            if len(nodes) + len(queue) >= max_notes:
                                break
                    if truncated or len(nodes) + len(queue) >= max_notes:
                        break

            return {
                "seed_path": path,
                "params": {
                    "max_notes": max_notes,
                    "max_edges": max_edges,
                    "max_links_per_note": max_links_per_note,
                    "max_resolutions_per_target": max_resolutions_per_target,
                },
                "truncated": truncated,
                "nodes": nodes,
                "edges": edges,
            }

        return runtime.call_tool("expand_typed_links_outgoing", args, run)

    @server.tool(
        name="find_broken_links",
        title="Find broken links",
        description="Detect unresolved or ambiguous typed-link targets from the local DB.",
        structured_output=True,
    )
    def find_broken_links(
        treat_ambiguous_as_broken: bool = True,
        path_prefix: str | None = None,
        rels: list[str] | None = None,
        max_links: Annotated[int, Field(ge=1, le=100_000)] = 20_000,
        max_broken: Annotated[int, Field(ge=1, le=10_000)] = 2000,
        max_resolutions_per_target: Annotated[int, Field(ge=1, le=20)] = 5,
    ) -> dict[str, object]:
        normalized_rels = _normalize_filter_strings(rels) or list(AILSS_TYPED_LINK_KEYS)
        prefix = _clean_optional_string(path_prefix)
        args = {
            "treat_ambiguous_as_broken": treat_ambiguous_as_broken,
            "path_prefix": prefix,
            "rels": normalized_rels,
            "max_links": max_links,
            "max_broken": max_broken,
            "max_resolutions_per_target": max_resolutions_per_target,
        }

        def run() -> dict[str, object]:
            where: list[str] = []
            params: list[object] = []
            if prefix:
                where.append("from_path LIKE ?")
                params.append(f"{prefix}%")
            if normalized_rels:
                where.append(f"rel IN ({', '.join('?' for _ in normalized_rels)})")
                params.extend(normalized_rels)

            rows = runtime.conn.execute(
                f"""
                SELECT from_path, rel, to_target, to_wikilink, position
                FROM typed_links
                {"WHERE " + " AND ".join(where) if where else ""}
                ORDER BY from_path, rel, position
                LIMIT ?
                """,
                [*params, max_links],
            ).fetchall()
            resolve_limit = max(
                max_resolutions_per_target,
                2 if treat_ambiguous_as_broken else 1,
            )
            cache: dict[str, list[dict[str, str | None]]] = {}
            broken: list[dict[str, object]] = []
            broken_total = 0
            broken_truncated = False

            for row in rows:
                target = str(row["to_target"]).strip()
                if not target:
                    continue
                resolved = cache.setdefault(
                    target,
                    _resolve_target_candidates(runtime.conn, target, resolve_limit),
                )
                is_broken = not resolved or (treat_ambiguous_as_broken and len(resolved) >= 2)
                if not is_broken:
                    continue
                broken_total += 1
                if len(broken) >= max_broken:
                    broken_truncated = True
                    continue
                broken.append(
                    {
                        "from_path": str(row["from_path"]),
                        "rel": str(row["rel"]),
                        "target": target,
                        "to_wikilink": str(row["to_wikilink"]),
                        "resolutions": resolved[:max_resolutions_per_target],
                    }
                )

            return {
                "path_prefix": prefix,
                "rels": normalized_rels,
                "scanned_links": len(rows),
                "broken_total": broken_total,
                "truncated": len(rows) >= max_links,
                "broken_truncated": broken_truncated,
                "broken": broken,
            }

        return runtime.call_tool("find_broken_links", args, run)

    @server.tool(
        name="read_note",
        title="Read note",
        description="Read a vault note by vault-relative path.",
        structured_output=True,
    )
    def read_note(
        path: Annotated[str, Field(min_length=1)],
        start_index: Annotated[int, Field(ge=0)] = 0,
        max_chars: Annotated[int, Field(ge=200, le=200_000)] = 20_000,
    ) -> dict[str, object]:
        args = {"path": path, "start_index": start_index, "max_chars": max_chars}

        def run() -> dict[str, object]:
            vault_path = runtime.ensure_vault_path()
            full_text = read_utf8_file(resolve_vault_path_safely(vault_path, path))
            if start_index >= len(full_text):
                return {
                    "path": path,
                    "start_index": start_index,
                    "max_chars": max_chars,
                    "truncated": False,
                    "next_start_index": None,
                    "content": "",
                }
            text = full_text[start_index : start_index + max_chars]
            next_start_index = start_index + len(text)
            truncated = next_start_index < len(full_text)
            return {
                "path": path,
                "start_index": start_index,
                "max_chars": max_chars,
                "truncated": truncated,
                "next_start_index": next_start_index if truncated else None,
                "content": text,
            }

        return runtime.call_tool("read_note", args, run)

    @server.tool(
        name="get_vault_tree",
        title="Get vault tree",
        description="Render a folder tree for vault markdown files.",
        structured_output=True,
    )
    def get_vault_tree(
        path_prefix: str | None = None,
        include_files: bool = False,
        max_depth: Annotated[int, Field(ge=1, le=50)] = 8,
        max_nodes: Annotated[int, Field(ge=1, le=20_000)] = 2000,
    ) -> dict[str, object]:
        prefix = _clean_optional_string(path_prefix)
        args = {
            "path_prefix": prefix,
            "include_files": include_files,
            "max_depth": max_depth,
            "max_nodes": max_nodes,
        }

        def run() -> dict[str, object]:
            vault_path = runtime.ensure_vault_path()
            rel_files = [
                normalize_vault_rel_path(str(path.relative_to(vault_path)))
                for path in list_markdown_files(vault_path)
            ]
            filtered_files = [
                rel_path for rel_path in rel_files if prefix is None or rel_path.startswith(prefix)
            ]

            folder_set: set[str] = set()
            for file_path in filtered_files:
                parts = [part for part in file_path.split("/") if part]
                for index in range(len(parts) - 1):
                    folder_set.add("/".join(parts[: index + 1]))

            folders = sorted(folder_set)
            files = sorted(filtered_files) if include_files else []
            root: dict[str, Any] = {"name": "", "type": "dir", "children": {}}

            def add_path(rel_path: str, node_type: str) -> None:
                segments = [segment for segment in rel_path.split("/") if segment]
                node = root
                for index, segment in enumerate(segments):
                    is_last = index == len(segments) - 1
                    children = node["children"]
                    if not is_last:
                        node = children.setdefault(
                            segment,
                            {"name": segment, "type": "dir", "children": {}},
                        )
                        continue
                    if node_type == "dir":
                        children.setdefault(
                            segment,
                            {"name": segment, "type": "dir", "children": {}},
                        )
                    else:
                        children.setdefault(
                            segment,
                            {"name": segment, "type": "file", "children": {}},
                        )

            for folder in folders:
                add_path(folder, "dir")
            for file_path in files:
                add_path(file_path, "file")

            lines = ["."]
            node_count = 0
            truncated = False

            def walk(node: dict[str, Any], prefix_text: str, depth: int) -> None:
                nonlocal node_count, truncated
                if depth >= max_depth:
                    if node["children"]:
                        lines.append(f"{prefix_text}└── …")
                        truncated = True
                        node_count += 1
                    return

                children = sorted(
                    node["children"].values(),
                    key=lambda child: (child["type"] != "dir", child["name"]),
                )
                for index, child in enumerate(children):
                    if node_count >= max_nodes:
                        truncated = True
                        return
                    is_last = index == len(children) - 1
                    connector = "└── " if is_last else "├── "
                    lines.append(f"{prefix_text}{connector}{child['name']}")
                    node_count += 1
                    if child["type"] == "dir":
                        walk(
                            child,
                            prefix_text + ("    " if is_last else "│   "),
                            depth + 1,
                        )
                        if truncated and node_count >= max_nodes:
                            return

            walk(root, "", 0)
            return {
                "path_prefix": prefix,
                "include_files": include_files,
                "max_depth": max_depth,
                "max_nodes": max_nodes,
                "files_scanned": len(filtered_files),
                "folder_count": len(folders),
                "file_count": len(files),
                "node_count": node_count,
                "truncated": truncated,
                "folders": folders,
                "files": files,
                "tree": "\n".join(lines),
            }

        return runtime.call_tool("get_vault_tree", args, run)

    @server.tool(
        name="frontmatter_validate",
        title="Frontmatter validate",
        description="Validate required frontmatter keys and typed-link constraints.",
        structured_output=True,
    )
    def frontmatter_validate(
        path_prefix: str | None = None,
        max_files: Annotated[int, Field(ge=1, le=100_000)] = 20_000,
        typed_link_constraint_mode: Literal["off", "warn", "error"] = "warn",
    ) -> dict[str, object]:
        prefix = _clean_optional_string(path_prefix)
        args = {
            "path_prefix": prefix,
            "max_files": max_files,
            "typed_link_constraint_mode": typed_link_constraint_mode,
        }

        def run() -> dict[str, object]:
            vault_path = runtime.ensure_vault_path()
            (
                scanned_notes,
                lookup_notes,
                files_scanned,
                truncated,
            ) = _scan_vault_notes_for_frontmatter_validate(vault_path, prefix, max_files)
            typed_link_diagnostics = (
                []
                if typed_link_constraint_mode == "off"
                else _collect_typed_link_diagnostics(
                    scanned_notes,
                    lookup_notes,
                    typed_link_constraint_mode,
                )
            )
            diagnostics_by_path: dict[str, list[TypedLinkDiagnostic]] = {}
            for diag in typed_link_diagnostics:
                diagnostics_by_path.setdefault(diag.path, []).append(diag)

            issues: list[dict[str, object]] = []
            ok_count = 0
            for note in scanned_notes:
                note_diagnostics = diagnostics_by_path.get(note.path, [])
                has_constraint_error = (
                    typed_link_constraint_mode == "error" and len(note_diagnostics) > 0
                )
                base_is_ok = (
                    note.has_frontmatter
                    and note.parsed_frontmatter
                    and not note.missing_keys
                    and not note.enum_violations
                    and note.id_format_ok
                    and note.created_format_ok
                    and note.id_matches_created
                )
                is_ok = base_is_ok and not has_constraint_error
                if is_ok:
                    ok_count += 1
                    continue
                issues.append(
                    {
                        "path": note.path,
                        "has_frontmatter": note.has_frontmatter,
                        "parsed_frontmatter": note.parsed_frontmatter,
                        "missing_keys": note.missing_keys,
                        "id_value": note.id_value,
                        "created_value": note.created_value,
                        "id_format_ok": note.id_format_ok,
                        "created_format_ok": note.created_format_ok,
                        "id_matches_created": note.id_matches_created,
                        "enum_violations": note.enum_violations,
                        "typed_link_diagnostics": [asdict(item) for item in note_diagnostics],
                    }
                )

            return {
                "path_prefix": prefix,
                "files_scanned": files_scanned,
                "ok_count": ok_count,
                "issue_count": len(issues),
                "truncated": truncated,
                "enum_schema": {
                    "status": list(AILSS_FRONTMATTER_STATUS_VALUES),
                    "layer": list(AILSS_FRONTMATTER_LAYER_VALUES),
                    "entity": list(AILSS_FRONTMATTER_ENTITY_VALUES),
                },
                "typed_link_constraint_mode": typed_link_constraint_mode,
                "typed_link_diagnostic_count": len(typed_link_diagnostics),
                "typed_link_diagnostics": [asdict(item) for item in typed_link_diagnostics],
                "required_keys": REQUIRED_FRONTMATTER_KEYS,
                "issues": issues,
            }

        return runtime.call_tool("frontmatter_validate", args, run)

    @server.tool(
        name="get_tool_failure_report",
        title="Get tool failure report",
        description="Summarize MCP tool failure diagnostics from <vault>/.ailss/logs.",
        structured_output=True,
    )
    def get_tool_failure_report(
        recent_limit: Annotated[int, Field(ge=1, le=500)] = 50,
        top_error_limit: Annotated[int, Field(ge=1, le=50)] = 10,
        tool: str | None = None,
    ) -> dict[str, object]:
        args = {
            "recent_limit": recent_limit,
            "top_error_limit": top_error_limit,
            "tool": tool,
        }

        def run() -> dict[str, object]:
            report = runtime.diagnostics.get_tool_failure_report(
                recent_limit=recent_limit,
                top_error_limit=top_error_limit,
                tool=_clean_optional_string(tool),
            )
            return {
                "enabled": report.enabled,
                "log_dir": report.log_dir,
                "log_path": report.log_path,
                "scanned_events": report.scanned_events,
                "matched_events": report.matched_events,
                "first_timestamp": report.first_timestamp,
                "last_timestamp": report.last_timestamp,
                "top_error_types": [asdict(item) for item in report.top_error_types],
                "recent_events": [asdict(item) for item in report.recent_events],
            }

        return runtime.call_tool("get_tool_failure_report", args, run)
