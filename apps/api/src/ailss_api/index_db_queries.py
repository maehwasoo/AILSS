from __future__ import annotations

import sqlite3
from typing import Literal

from .index_db_types import (
    IndexNoteMeta,
    ResolvedNoteTarget,
    SearchNotesFilters,
    SearchNotesResult,
    TypedLinkBackref,
    TypedLinkQuery,
    TypedLinkRelFacet,
    TypedLinkRelFacetQuery,
)
from .index_db_utils import (
    normalize_string_list,
    safe_parse_json_object,
    to_literal_prefix_like_pattern,
)
from .vault_runtime import TypedLinkRecord


def get_note_meta(conn: sqlite3.Connection, note_path: str) -> IndexNoteMeta | None:
    note = conn.execute("SELECT * FROM notes WHERE path = ?", (note_path,)).fetchone()
    if note is None:
        return None

    tags = [
        str(row["tag"])
        for row in conn.execute(
            "SELECT tag FROM note_tags WHERE path = ? ORDER BY tag", (note_path,)
        ).fetchall()
        if row["tag"] is not None
    ]
    keywords = [
        str(row["keyword"])
        for row in conn.execute(
            "SELECT keyword FROM note_keywords WHERE path = ? ORDER BY keyword", (note_path,)
        ).fetchall()
        if row["keyword"] is not None
    ]
    sources = [
        str(row["source"])
        for row in conn.execute(
            "SELECT source FROM note_sources WHERE path = ? ORDER BY source", (note_path,)
        ).fetchall()
        if row["source"] is not None
    ]
    typed_links = [
        TypedLinkRecord(
            rel=str(row["rel"]),
            to_target=str(row["to_target"]),
            to_wikilink=str(row["to_wikilink"]),
            position=int(row["position"]),
        )
        for row in conn.execute(
            """
            SELECT rel, to_target, to_wikilink, position
            FROM typed_links
            WHERE from_path = ?
            ORDER BY rel, position
            """,
            (note_path,),
        ).fetchall()
    ]
    frontmatter_json = (
        str(note["frontmatter_json"]) if note["frontmatter_json"] is not None else "{}"
    )

    return IndexNoteMeta(
        path=str(note["path"]),
        note_id=str(note["note_id"]) if note["note_id"] is not None else None,
        created=str(note["created"]) if note["created"] is not None else None,
        title=str(note["title"]) if note["title"] is not None else None,
        summary=str(note["summary"]) if note["summary"] is not None else None,
        entity=str(note["entity"]) if note["entity"] is not None else None,
        layer=str(note["layer"]) if note["layer"] is not None else None,
        status=str(note["status"]) if note["status"] is not None else None,
        updated=str(note["updated"]) if note["updated"] is not None else None,
        tags=tags,
        keywords=keywords,
        sources=sources,
        frontmatter=safe_parse_json_object(frontmatter_json),
        typed_links=typed_links,
    )


def list_tags(conn: sqlite3.Connection, limit: int = 200) -> list[dict[str, object]]:
    effective_limit = min(max(1, limit), 5000)
    return [
        {"tag": str(row["tag"]), "count": int(row["count"])}
        for row in conn.execute(
            """
            SELECT tag, COUNT(*) AS count
            FROM note_tags
            GROUP BY tag
            ORDER BY count DESC, tag ASC
            LIMIT ?
            """,
            (effective_limit,),
        ).fetchall()
    ]


def list_keywords(conn: sqlite3.Connection, limit: int = 200) -> list[dict[str, object]]:
    effective_limit = min(max(1, limit), 5000)
    return [
        {"keyword": str(row["keyword"]), "count": int(row["count"])}
        for row in conn.execute(
            """
            SELECT keyword, COUNT(*) AS count
            FROM note_keywords
            GROUP BY keyword
            ORDER BY count DESC, keyword ASC
            LIMIT ?
            """,
            (effective_limit,),
        ).fetchall()
    ]


def search_notes(
    conn: sqlite3.Connection,
    filters: SearchNotesFilters | None = None,
) -> list[SearchNotesResult]:
    effective_filters = filters or SearchNotesFilters()
    where: list[str] = []
    params: list[object] = []

    if effective_filters.path_prefix:
        where.append("notes.path LIKE ? ESCAPE '\\'")
        params.append(to_literal_prefix_like_pattern(effective_filters.path_prefix))

    if effective_filters.title_query:
        where.append("notes.title LIKE ?")
        params.append(f"%{effective_filters.title_query}%")

    for column_name, raw_values in (
        ("note_id", normalize_string_list(effective_filters.note_id)),
        ("entity", normalize_string_list(effective_filters.entity)),
        ("layer", normalize_string_list(effective_filters.layer)),
        ("status", normalize_string_list(effective_filters.status)),
    ):
        if not raw_values:
            continue
        placeholders = ", ".join("?" for _ in raw_values)
        where.append(f"notes.{column_name} IN ({placeholders})")
        params.extend(raw_values)

    if effective_filters.created_from:
        where.append("notes.created IS NOT NULL AND notes.created >= ?")
        params.append(effective_filters.created_from)
    if effective_filters.created_to:
        where.append("notes.created IS NOT NULL AND notes.created <= ?")
        params.append(effective_filters.created_to)
    if effective_filters.updated_from:
        where.append("notes.updated IS NOT NULL AND notes.updated >= ?")
        params.append(effective_filters.updated_from)
    if effective_filters.updated_to:
        where.append("notes.updated IS NOT NULL AND notes.updated <= ?")
        params.append(effective_filters.updated_to)

    tags_any = [tag for tag in effective_filters.tags_any or [] if tag]
    if tags_any:
        placeholders = ", ".join("?" for _ in tags_any)
        where.append(
            "EXISTS (SELECT 1 FROM note_tags t WHERE t.path = notes.path AND t.tag IN "
            f"({placeholders}))"
        )
        params.extend(tags_any)

    for tag in [tag for tag in effective_filters.tags_all or [] if tag]:
        where.append("EXISTS (SELECT 1 FROM note_tags t WHERE t.path = notes.path AND t.tag = ?)")
        params.append(tag)

    keywords_any = [keyword for keyword in effective_filters.keywords_any or [] if keyword]
    if keywords_any:
        placeholders = ", ".join("?" for _ in keywords_any)
        where.append(
            "EXISTS (SELECT 1 FROM note_keywords k WHERE k.path = notes.path "
            f"AND k.keyword IN ({placeholders}))"
        )
        params.extend(keywords_any)

    sources_any = [source for source in effective_filters.sources_any or [] if source]
    if sources_any:
        placeholders = ", ".join("?" for _ in sources_any)
        where.append(
            "EXISTS (SELECT 1 FROM note_sources s WHERE s.path = notes.path "
            f"AND s.source IN ({placeholders}))"
        )
        params.extend(sources_any)

    limit = min(max(1, effective_filters.limit), 500)
    order_dir = "DESC" if effective_filters.order_dir == "desc" else "ASC"
    if effective_filters.order_by == "created":
        order_sql = f"notes.created IS NULL, notes.created {order_dir}, notes.path"
    elif effective_filters.order_by == "updated":
        order_sql = f"notes.updated IS NULL, notes.updated {order_dir}, notes.path"
    else:
        order_sql = f"notes.path {order_dir}"

    rows = conn.execute(
        f"""
        SELECT path, note_id, created, title, summary, entity, layer, status, updated
        FROM notes
        {"WHERE " + " AND ".join(where) if where else ""}
        ORDER BY {order_sql}
        LIMIT ?
        """,
        [*params, limit],
    ).fetchall()
    if not rows:
        return []

    paths = [str(row["path"]) for row in rows]
    placeholders = ", ".join("?" for _ in paths)

    tags_by_path = _load_grouped_string_rows(conn, "note_tags", "tag", paths, placeholders)
    keywords_by_path = _load_grouped_string_rows(
        conn, "note_keywords", "keyword", paths, placeholders
    )
    sources_by_path = _load_grouped_string_rows(conn, "note_sources", "source", paths, placeholders)

    return [
        SearchNotesResult(
            path=str(row["path"]),
            note_id=str(row["note_id"]) if row["note_id"] is not None else None,
            created=str(row["created"]) if row["created"] is not None else None,
            title=str(row["title"]) if row["title"] is not None else None,
            summary=str(row["summary"]) if row["summary"] is not None else None,
            entity=str(row["entity"]) if row["entity"] is not None else None,
            layer=str(row["layer"]) if row["layer"] is not None else None,
            status=str(row["status"]) if row["status"] is not None else None,
            updated=str(row["updated"]) if row["updated"] is not None else None,
            tags=tags_by_path.get(str(row["path"]), []),
            keywords=keywords_by_path.get(str(row["path"]), []),
            sources=sources_by_path.get(str(row["path"]), []),
        )
        for row in rows
    ]


def _load_grouped_string_rows(
    conn: sqlite3.Connection,
    table: str,
    column: str,
    paths: list[str],
    placeholders: str,
) -> dict[str, list[str]]:
    rows = conn.execute(
        f"SELECT path, {column} FROM {table} WHERE path IN ({placeholders}) ORDER BY {column}",
        paths,
    ).fetchall()
    grouped: dict[str, list[str]] = {}
    for row in rows:
        path = str(row["path"])
        value = str(row[column])
        grouped.setdefault(path, []).append(value)
    return grouped


def find_notes_by_typed_link(
    conn: sqlite3.Connection,
    query: TypedLinkQuery,
) -> list[TypedLinkBackref]:
    where: list[str] = []
    params: list[object] = []

    if query.rel:
        where.append("tl.rel = ?")
        params.append(query.rel)
    if query.to_target:
        where.append("tl.to_target = ?")
        params.append(query.to_target)
    if query.rels:
        rels = [rel.strip() for rel in query.rels if rel.strip()]
        if rels:
            placeholders = ", ".join("?" for _ in rels)
            where.append(f"tl.rel IN ({placeholders})")
            params.extend(rels)

    limit = min(max(1, query.limit), 1000)
    rows = conn.execute(
        f"""
        SELECT
          tl.from_path AS from_path,
          n.title AS from_title,
          tl.rel AS rel,
          tl.to_target AS to_target,
          tl.to_wikilink AS to_wikilink
        FROM typed_links tl
        JOIN notes n ON n.path = tl.from_path
        {"WHERE " + " AND ".join(where) if where else ""}
        ORDER BY tl.rel, tl.to_target, tl.from_path, tl.position
        LIMIT ?
        """,
        [*params, limit],
    ).fetchall()
    return [
        TypedLinkBackref(
            from_path=str(row["from_path"]),
            from_title=str(row["from_title"]) if row["from_title"] is not None else None,
            rel=str(row["rel"]),
            to_target=str(row["to_target"]),
            to_wikilink=str(row["to_wikilink"]),
        )
        for row in rows
    ]


def list_typed_link_rels(
    conn: sqlite3.Connection,
    query: TypedLinkRelFacetQuery | None = None,
) -> list[TypedLinkRelFacet]:
    effective_query = query or TypedLinkRelFacetQuery()
    where: list[str] = []
    params: list[object] = []

    path_prefix = effective_query.path_prefix.strip() if effective_query.path_prefix else ""
    if path_prefix:
        where.append("from_path LIKE ? ESCAPE '\\'")
        params.append(to_literal_prefix_like_pattern(path_prefix))

    limit = min(max(1, effective_query.limit), 5000)
    order_sql = (
        "ORDER BY rel ASC, count DESC"
        if effective_query.order_by == "rel_asc"
        else "ORDER BY count DESC, rel ASC"
    )
    rows = conn.execute(
        f"""
        SELECT rel, COUNT(*) AS count
        FROM typed_links
        {"WHERE " + " AND ".join(where) if where else ""}
        GROUP BY rel
        {order_sql}
        LIMIT ?
        """,
        [*params, limit],
    ).fetchall()
    return [TypedLinkRelFacet(rel=str(row["rel"]), count=int(row["count"])) for row in rows]


def resolve_note_paths_by_wikilink_target(
    conn: sqlite3.Connection,
    target: str,
    limit: int = 20,
) -> list[ResolvedNoteTarget]:
    trimmed = target.strip()
    if not trimmed:
        return []

    effective_limit = min(max(1, limit), 200)
    target_no_ext = trimmed[:-3] if trimmed.lower().endswith(".md") else trimmed
    target_with_ext = trimmed if trimmed.lower().endswith(".md") else f"{trimmed}.md"

    path_matches = conn.execute(
        """
        SELECT path, title
        FROM notes
        WHERE path = ? OR path LIKE ?
        ORDER BY path
        LIMIT ?
        """,
        (target_with_ext, f"%/{target_with_ext}", effective_limit),
    ).fetchall()
    note_id_matches = conn.execute(
        """
        SELECT path, title
        FROM notes
        WHERE note_id = ?
        ORDER BY path
        LIMIT ?
        """,
        (target_no_ext, effective_limit),
    ).fetchall()
    title_matches = conn.execute(
        """
        SELECT path, title
        FROM notes
        WHERE title = ?
        ORDER BY path
        LIMIT ?
        """,
        (target_no_ext, effective_limit),
    ).fetchall()

    results: list[ResolvedNoteTarget] = []
    seen_paths: set[str] = set()

    def append_rows(
        rows: list[sqlite3.Row],
        matched_by: Literal["path", "note_id", "title"],
    ) -> None:
        for row in rows:
            path = str(row["path"])
            if path in seen_paths:
                continue
            seen_paths.add(path)
            results.append(
                ResolvedNoteTarget(
                    path=path,
                    title=str(row["title"]) if row["title"] is not None else None,
                    matched_by=matched_by,
                )
            )
            if len(results) >= effective_limit:
                return

    append_rows(path_matches, "path")
    if len(results) < effective_limit:
        append_rows(note_id_matches, "note_id")
    if len(results) < effective_limit:
        append_rows(title_matches, "title")
    return results
