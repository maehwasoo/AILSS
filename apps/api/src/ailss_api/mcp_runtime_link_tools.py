from __future__ import annotations

from collections import deque
from dataclasses import asdict
from typing import Annotated, Literal

from mcp.server.fastmcp import FastMCP
from pydantic import Field

from .index_db import (
    TypedLinkQuery,
    TypedLinkRelFacetQuery,
    find_notes_by_typed_link,
    get_note_meta,
    list_typed_link_rels,
)
from .mcp_runtime_core import McpRuntime
from .mcp_runtime_helpers import (
    _clean_optional_string,
    _normalize_filter_strings,
    _resolve_target_candidates,
)
from .vault_runtime import AILSS_TYPED_LINK_KEYS


def register_link_tools(server: FastMCP, runtime: McpRuntime) -> None:
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
