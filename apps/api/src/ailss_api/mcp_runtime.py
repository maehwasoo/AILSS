from __future__ import annotations

import os
import shutil
import signal
import sqlite3
import threading
import time
from collections import deque
from collections.abc import Callable, Mapping
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Annotated, Any, Literal

from mcp.server.auth.provider import AccessToken, TokenVerifier
from mcp.server.fastmcp import FastMCP
from openai import OpenAI
from pydantic import Field
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from .config import Settings
from .index_db import (
    OpenIndexDbOptions,
    SearchNotesFilters,
    TypedLinkQuery,
    TypedLinkRelFacetQuery,
    embedding_dim_for_model,
    find_notes_by_typed_link,
    get_note_meta,
    list_keywords,
    list_tags,
    list_typed_link_rels,
    open_index_db,
    resolve_note_paths_by_wikilink_target,
    search_notes,
)
from .indexer_runtime import IndexVaultOptions, index_vault
from .models import RetrieveRequest
from .retrieval import retrieve_notes
from .text_patch import LinePatchOp, apply_line_patch_ops
from .tool_failure_diagnostics import ToolFailureDiagnostics
from .vault_runtime import (
    AILSS_FRONTMATTER_ENTITY_VALUES,
    AILSS_FRONTMATTER_LAYER_VALUES,
    AILSS_FRONTMATTER_STATUS_VALUES,
    AILSS_REQUIRED_FRONTMATTER_KEYS,
    AILSS_TYPED_LINK_KEYS,
    AILSS_TYPED_LINK_ONTOLOGY_BY_REL,
    TypedLinkRecord,
    atomic_write_utf8_file,
    build_ailss_frontmatter,
    coerce_non_empty_string,
    coerce_trimmed_string_or_empty,
    has_frontmatter_block,
    id_from_created,
    is_default_ignored_vault_rel_path,
    list_markdown_files,
    normalize_ailss_note_meta,
    normalize_string_list,
    normalize_typed_link_target_input,
    normalize_vault_rel_path,
    parse_markdown_note,
    read_utf8_file,
    render_markdown_with_frontmatter,
    resolve_vault_path_safely,
    to_wikilink,
    validate_ailss_frontmatter_enums,
)

REQUIRED_FRONTMATTER_KEYS = list(AILSS_REQUIRED_FRONTMATTER_KEYS)
ORDER_BY_TYPED_LINKS: tuple[Literal["count_desc", "rel_asc"], ...] = ("count_desc", "rel_asc")


def _now_iso_seconds() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime())


def _sha256_hex_utf8(text: str) -> str:
    from hashlib import sha256

    return sha256(text.encode("utf-8")).hexdigest()


def _terminate_current_process() -> None:
    time.sleep(0.1)
    os.kill(os.getpid(), signal.SIGTERM)


class FixedBearerTokenVerifier(TokenVerifier):
    def __init__(self, token: str) -> None:
        self._token = token

    async def verify_token(self, token: str) -> AccessToken | None:
        if token != self._token:
            return None
        return AccessToken(token=token, client_id="ailss-localhost", scopes=["*"])


@dataclass(frozen=True)
class ScannedNote:
    path: str
    has_frontmatter: bool
    parsed_frontmatter: bool
    missing_keys: list[str]
    enum_violations: list[dict[str, str | None]]
    id_value: str | None
    created_value: str | None
    id_format_ok: bool
    created_format_ok: bool
    id_matches_created: bool
    note_id: str | None
    title: str | None
    entity: str | None
    typed_links: list[TypedLinkRecord]


@dataclass(frozen=True)
class TypedLinkDiagnostic:
    path: str
    rel: str
    target: str | None
    reason: str
    fix_hint: str
    severity: Literal["warn", "error"]


def _normalize_entity(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip().lower()
    return normalized or None


def _normalize_lookup_value(value: str | None) -> str | None:
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


def _clean_optional_string(value: str | None) -> str | None:
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


def _normalize_filter_strings(values: list[str] | None) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for value in values or []:
        trimmed = value.strip()
        if not trimmed or trimmed in seen:
            continue
        seen.add(trimmed)
        out.append(trimmed)
    return out


def _default_tags_for_rel_path(vault_rel_path: str) -> list[str]:
    normalized = normalize_vault_rel_path(vault_rel_path).strip()
    if normalized == "100. Inbox" or normalized.startswith("100. Inbox/"):
        return ["inbox"]
    return []


def _sanitize_file_stem_from_title(title: str) -> str:
    trimmed = title.strip()
    no_separators = trimmed.replace("/", "-").replace("\\", "-")
    collapsed = " ".join(no_separators.split())
    shortened = collapsed[:120].strip()
    return shortened or "Untitled"


def _remove_markdown_extension(vault_rel_path: str) -> str:
    return vault_rel_path[:-3] if vault_rel_path.lower().endswith(".md") else vault_rel_path


def _split_target_and_display(raw: str) -> tuple[str, str]:
    trimmed = raw.strip()
    if not trimmed:
        return "", ""
    inner = (
        trimmed[2:-2].strip() if trimmed.startswith("[[") and trimmed.endswith("]]") else trimmed
    )
    left, right = (inner.split("|", 1) + [""])[:2]
    left = left.strip()
    right = right.strip()
    target_for_resolution = left.split("#", 1)[0].strip() or left or inner
    display_for_canonical_link = right or left or inner
    return target_for_resolution, display_for_canonical_link


def _canonical_wikilink(path_without_extension: str, display: str) -> str:
    return f"[[{path_without_extension}|{display}]]"


def _resolve_target_candidates(
    conn: sqlite3.Connection,
    target: str,
    limit: int = 20,
) -> list[dict[str, str | None]]:
    normalized = target.strip().replace("\\", "/").lstrip("/")
    if not normalized:
        return []

    if "/" in normalized:
        with_ext = normalized if normalized.lower().endswith(".md") else f"{normalized}.md"
        rows = conn.execute(
            """
            SELECT path, title
            FROM notes
            WHERE path = ?
            ORDER BY path
            LIMIT ?
            """,
            (with_ext, limit),
        ).fetchall()
        return [
            {
                "path": str(row["path"]),
                "title": str(row["title"]) if row["title"] is not None else None,
                "matched_by": "path",
            }
            for row in rows
        ]

    return [
        {"path": item.path, "title": item.title, "matched_by": item.matched_by}
        for item in resolve_note_paths_by_wikilink_target(conn, normalized, limit)
    ]


def _optional_int_from_record(item: Mapping[str, object], key: str) -> int | None:
    value = item.get(key)
    if value is None:
        return None
    if isinstance(value, bool):
        raise RuntimeError(f'Line patch field "{key}" must be an integer, not a boolean.')
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str):
        trimmed = value.strip()
        if trimmed:
            return int(trimmed)
    raise RuntimeError(f'Line patch field "{key}" must be an integer.')


def _scan_vault_notes_for_frontmatter_validate(
    vault_path: Path,
    path_prefix: str | None,
    max_files: int,
) -> tuple[list[ScannedNote], list[ScannedNote], int, bool]:
    prefix = path_prefix.strip() if path_prefix else None
    rel_files = [
        normalize_vault_rel_path(str(path.relative_to(vault_path)))
        for path in list_markdown_files(vault_path)
    ]
    filtered = [rel_path for rel_path in rel_files if prefix is None or rel_path.startswith(prefix)]

    scanned_notes: list[ScannedNote] = []
    files_scanned = 0
    truncated = False

    for rel_path in filtered:
        if files_scanned >= max_files:
            truncated = True
            break

        files_scanned += 1
        markdown = read_utf8_file(vault_path / rel_path)
        has_fm = has_frontmatter_block(markdown)
        parsed = parse_markdown_note(markdown)
        frontmatter = parsed.frontmatter
        normalized_meta = normalize_ailss_note_meta(frontmatter)
        missing_keys = [
            key for key in REQUIRED_FRONTMATTER_KEYS if not Object_has_own(frontmatter, key)
        ]
        enum_violations = [
            {"key": violation.key, "value": violation.value}
            for violation in validate_ailss_frontmatter_enums(frontmatter)
        ]
        id_value = coerce_trimmed_string_or_empty(frontmatter.get("id"))
        created_value = coerce_trimmed_string_or_empty(frontmatter.get("created"))
        created_id = id_from_created(created_value) if created_value else None
        id_format_ok = bool(id_value and len(id_value) == 14 and id_value.isdigit())
        created_format_ok = bool(created_id and len(created_id) == 14 and created_id.isdigit())
        parsed_frontmatter = has_fm and len(frontmatter) > 0

        scanned_notes.append(
            ScannedNote(
                path=rel_path,
                has_frontmatter=has_fm,
                parsed_frontmatter=parsed_frontmatter,
                missing_keys=missing_keys,
                enum_violations=enum_violations,
                id_value=id_value,
                created_value=created_value,
                id_format_ok=id_format_ok,
                created_format_ok=created_format_ok,
                id_matches_created=bool(
                    id_format_ok and created_format_ok and id_value == created_id
                ),
                note_id=normalized_meta.note_id,
                title=normalized_meta.title,
                entity=_normalize_entity(normalized_meta.entity),
                typed_links=normalized_meta.typed_links,
            )
        )

    lookup_notes = scanned_notes
    if prefix:
        scanned_paths = {note.path for note in scanned_notes}
        additional: list[ScannedNote] = []
        for rel_path in rel_files:
            if rel_path in scanned_paths:
                continue
            markdown = read_utf8_file(vault_path / rel_path)
            has_fm = has_frontmatter_block(markdown)
            parsed = parse_markdown_note(markdown)
            normalized_meta = normalize_ailss_note_meta(parsed.frontmatter)
            additional.append(
                ScannedNote(
                    path=rel_path,
                    has_frontmatter=has_fm,
                    parsed_frontmatter=has_fm and len(parsed.frontmatter) > 0,
                    missing_keys=[],
                    enum_violations=[],
                    id_value=None,
                    created_value=None,
                    id_format_ok=False,
                    created_format_ok=False,
                    id_matches_created=False,
                    note_id=normalized_meta.note_id,
                    title=normalized_meta.title,
                    entity=_normalize_entity(normalized_meta.entity),
                    typed_links=[],
                )
            )
        lookup_notes = [*lookup_notes, *additional]

    return scanned_notes, lookup_notes, files_scanned, truncated


def _collect_typed_link_diagnostics(
    notes: list[ScannedNote],
    lookup_notes: list[ScannedNote],
    mode: Literal["warn", "error"],
) -> list[TypedLinkDiagnostic]:
    parseable_notes = [note for note in notes if note.parsed_frontmatter]
    parseable_lookup_notes = [note for note in lookup_notes if note.parsed_frontmatter]

    note_id_index: dict[str, list[ScannedNote]] = {}
    title_index: dict[str, list[ScannedNote]] = {}
    for note in parseable_lookup_notes:
        note_id = _normalize_lookup_value(note.note_id)
        if note_id:
            note_id_index.setdefault(note_id, []).append(note)
        title = _normalize_lookup_value(note.title)
        if title:
            title_index.setdefault(title, []).append(note)

    def resolve_target_entity(target: str) -> tuple[str, str | None]:
        trimmed = target.strip()
        if not trimmed:
            return "unresolved", None

        target_no_ext = trimmed[:-3] if trimmed.lower().endswith(".md") else trimmed
        target_with_ext = trimmed if trimmed.lower().endswith(".md") else f"{trimmed}.md"

        matches: list[ScannedNote] = []
        seen_paths: set[str] = set()

        def add_match(candidate: ScannedNote) -> None:
            if candidate.path in seen_paths:
                return
            seen_paths.add(candidate.path)
            matches.append(candidate)

        for note in parseable_lookup_notes:
            if note.path == target_with_ext or note.path.endswith(f"/{target_with_ext}"):
                add_match(note)
        for note in note_id_index.get(target_no_ext, []):
            add_match(note)
        for note in title_index.get(target_no_ext, []):
            add_match(note)

        if not matches:
            return "unresolved", None
        if len(matches) >= 2:
            return "ambiguous", None
        return "resolved", _normalize_entity(matches[0].entity)

    severity: Literal["warn", "error"] = "error" if mode == "error" else "warn"
    diagnostics: list[TypedLinkDiagnostic] = []
    seen_keys: set[tuple[str, str, str | None, str]] = set()

    def push(diag: TypedLinkDiagnostic) -> None:
        key = (diag.path, diag.rel, diag.target, diag.reason)
        if key in seen_keys:
            return
        seen_keys.add(key)
        diagnostics.append(diag)

    for note in parseable_notes:
        if not note.typed_links:
            continue

        source_entity = _normalize_entity(note.entity)
        targets_by_rel: dict[str, set[str]] = {}
        for link in note.typed_links:
            rel = link.rel.strip()
            target = link.to_target.strip()
            if not rel:
                continue
            if target:
                targets_by_rel.setdefault(rel, set()).add(target)
            else:
                targets_by_rel.setdefault(rel, set())

        for rel, targets in targets_by_rel.items():
            ontology = AILSS_TYPED_LINK_ONTOLOGY_BY_REL.get(rel)
            constraints = ontology.get("constraints") if ontology else None
            if not isinstance(constraints, dict):
                continue

            max_targets = constraints.get("max_targets")
            if isinstance(max_targets, int) and len(targets) > max_targets:
                push(
                    TypedLinkDiagnostic(
                        path=note.path,
                        rel=rel,
                        target=None,
                        reason=f"cardinality exceeded: {len(targets)} targets (max {max_targets})",
                        fix_hint=f"Keep at most {max_targets} target(s) for `{rel}`.",
                        severity=severity,
                    )
                )

            source_entities = constraints.get("source_entities")
            if (
                isinstance(source_entities, tuple)
                and source_entity is not None
                and source_entity not in {value.lower() for value in source_entities}
            ):
                push(
                    TypedLinkDiagnostic(
                        path=note.path,
                        rel=rel,
                        target=None,
                        reason=(
                            f'source entity "{source_entity}" is incompatible with relation "{rel}"'
                        ),
                        fix_hint=(
                            "Use one of: "
                            + ", ".join(source_entities)
                            + ", or move this link to a compatible note."
                        ),
                        severity=severity,
                    )
                )

            conflicts_with = constraints.get("conflicts_with")
            if isinstance(conflicts_with, tuple):
                for conflict_rel in conflicts_with:
                    conflict_targets = targets_by_rel.get(conflict_rel, set())
                    for target in targets:
                        if target not in conflict_targets:
                            continue
                        push(
                            TypedLinkDiagnostic(
                                path=note.path,
                                rel=rel,
                                target=target,
                                reason=(
                                    f'conflict: same target appears in both "{rel}" and '
                                    f'"{conflict_rel}"'
                                ),
                                fix_hint=f'Keep "{target}" in only one of the two relations.',
                                severity=severity,
                            )
                        )

        for link in note.typed_links:
            rel = link.rel.strip()
            target = link.to_target.strip()
            if not rel or not target:
                continue

            ontology = AILSS_TYPED_LINK_ONTOLOGY_BY_REL.get(rel)
            constraints = ontology.get("constraints") if ontology else None
            target_entities = (
                constraints.get("target_entities") if isinstance(constraints, dict) else None
            )
            if not isinstance(target_entities, tuple) or not target_entities:
                continue

            status, target_entity = resolve_target_entity(target)
            if status != "resolved" or target_entity is None:
                continue

            allowed_entities = {value.lower() for value in target_entities}
            if target_entity in allowed_entities:
                continue

            push(
                TypedLinkDiagnostic(
                    path=note.path,
                    rel=rel,
                    target=target,
                    reason=(
                        f'target entity "{target_entity}" is incompatible with relation "{rel}"'
                    ),
                    fix_hint=f"Point `{rel}` to one of: {', '.join(target_entities)}.",
                    severity=severity,
                )
            )

    return diagnostics


def Object_has_own(record: dict[str, object], key: str) -> bool:
    return key in record


class McpRuntime:
    def __init__(
        self,
        *,
        settings: Settings,
        conn: sqlite3.Connection,
        openai_client: OpenAI,
        diagnostics: ToolFailureDiagnostics,
        enable_write_tools: bool,
        default_top_k: int,
        shutdown_token: str,
    ) -> None:
        self.settings = settings
        self.conn = conn
        self.openai_client = openai_client
        self.diagnostics = diagnostics
        self.enable_write_tools = enable_write_tools
        self.default_top_k = default_top_k
        self.shutdown_token = shutdown_token
        self.write_lock = threading.Lock()
        self.db_path = settings.resolved_db_path
        self.vault_path = settings.resolved_vault_path

    def call_tool(
        self,
        tool: str,
        args: Mapping[str, object],
        fn: Callable[[], dict[str, object]],
    ) -> dict[str, object]:
        try:
            return fn()
        except Exception as error:
            self.diagnostics.log_tool_failure(tool=tool, args=args, error=error)
            raise

    def apply_and_optional_reindex(
        self,
        *,
        apply: bool,
        changed: bool,
        reindex_after_apply: bool,
        reindex_paths: list[str],
        apply_write: Callable[[], None],
    ) -> dict[str, object]:
        applied = bool(apply and changed)
        if not applied:
            return {
                "applied": False,
                "needs_reindex": False,
                "reindexed": False,
                "reindex_summary": None,
                "reindex_error": None,
            }

        apply_write()

        if not reindex_after_apply:
            return {
                "applied": True,
                "needs_reindex": True,
                "reindexed": False,
                "reindex_summary": None,
                "reindex_error": None,
            }

        try:
            summary = self.reindex_paths(reindex_paths)
            return {
                "applied": True,
                "needs_reindex": False,
                "reindexed": True,
                "reindex_summary": summary,
                "reindex_error": None,
            }
        except Exception as error:
            return {
                "applied": True,
                "needs_reindex": True,
                "reindexed": False,
                "reindex_summary": None,
                "reindex_error": str(error),
            }

    def reindex_paths(self, paths: list[str]) -> dict[str, int]:
        if self.db_path is None or self.vault_path is None:
            raise RuntimeError(
                "Reindexing requires both AILSS_DB_PATH and AILSS_VAULT_PATH to be configured."
            )
        summary = index_vault(
            IndexVaultOptions(
                conn=self.conn,
                db_path_for_log=str(self.db_path),
                vault_path=self.vault_path,
                openai=self.openai_client,
                embedding_model=self.settings.openai_embedding_model,
                paths=paths,
            )
        )
        return {
            "changed_files": summary.changed_files,
            "indexed_chunks": summary.indexed_chunks,
            "deleted_files": summary.deleted_files,
        }

    def ensure_vault_path(self) -> Path:
        if self.vault_path is None:
            raise RuntimeError("AILSS_VAULT_PATH is not set.")
        return self.vault_path

    def ensure_markdown_path(self, vault_rel_path: str, *, action: str) -> None:
        if not vault_rel_path.lower().endswith(".md"):
            raise RuntimeError(f'Refusing to {action} non-markdown file: path="{vault_rel_path}".')


def create_mcp_server_from_env() -> FastMCP:
    settings = Settings()
    db_path = settings.resolved_db_path
    if db_path is None:
        raise RuntimeError("DB path is missing. Set AILSS_VAULT_PATH or AILSS_DB_PATH.")

    openai_api_key = (settings.openai_api_key or "").strip()
    if not openai_api_key:
        raise RuntimeError("OPENAI_API_KEY is missing. Set it via .env or environment variables.")

    token = os.environ.get("AILSS_MCP_HTTP_TOKEN", "").strip()
    if not token:
        raise RuntimeError("AILSS_MCP_HTTP_TOKEN is required for the MCP HTTP service.")

    shutdown_token = os.environ.get("AILSS_MCP_HTTP_SHUTDOWN_TOKEN", "").strip()
    if not shutdown_token:
        raise RuntimeError("AILSS_MCP_HTTP_SHUTDOWN_TOKEN is required for the MCP HTTP service.")

    host = os.environ.get("AILSS_MCP_HTTP_HOST", "127.0.0.1").strip() or "127.0.0.1"
    port = int(os.environ.get("AILSS_MCP_HTTP_PORT", "31415").strip() or "31415")
    streamable_http_path = os.environ.get("AILSS_MCP_HTTP_PATH", "/mcp").strip() or "/mcp"
    default_top_k = int(os.environ.get("AILSS_GET_CONTEXT_DEFAULT_TOP_K", "10").strip() or "10")

    conn = open_index_db(
        OpenIndexDbOptions(
            db_path=db_path,
            embedding_model=settings.openai_embedding_model,
            embedding_dim=embedding_dim_for_model(settings.openai_embedding_model),
        )
    )
    runtime = McpRuntime(
        settings=settings,
        conn=conn,
        openai_client=OpenAI(api_key=openai_api_key),
        diagnostics=ToolFailureDiagnostics(vault_path=settings.resolved_vault_path, cwd=Path.cwd()),
        enable_write_tools=os.environ.get("AILSS_ENABLE_WRITE_TOOLS", "").strip() == "1",
        default_top_k=max(1, min(default_top_k, 50)),
        shutdown_token=shutdown_token,
    )

    server = FastMCP(
        name="ailss-mcp",
        host=host,
        port=port,
        streamable_http_path=streamable_http_path,
        token_verifier=FixedBearerTokenVerifier(token),
    )
    register_mcp_tools(server, runtime)

    @server.custom_route("/__ailss/shutdown", methods=["POST"], include_in_schema=False)  # type: ignore[untyped-decorator]
    async def shutdown(request: Request) -> Response:
        authorization = request.headers.get("Authorization")
        if authorization != f"Bearer {runtime.shutdown_token}":
            return JSONResponse({"detail": "Invalid shutdown token."}, status_code=401)
        threading.Thread(target=_terminate_current_process, daemon=True).start()
        return JSONResponse({"status": "ok"})

    return server


def register_mcp_tools(server: FastMCP, runtime: McpRuntime) -> None:
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
            payload = {
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
            return payload

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

    if not runtime.enable_write_tools:
        return

    @server.tool(
        name="capture_note",
        title="Capture note",
        description="Create a new note with AILSS frontmatter.",
        structured_output=True,
    )
    def capture_note(
        title: Annotated[str, Field(min_length=1)],
        body: str = "",
        folder: str = "100. Inbox",
        frontmatter: dict[str, object] | None = None,
        apply: bool = False,
        reindex_after_apply: bool = True,
    ) -> dict[str, object]:
        args = {
            "title": title,
            "body": body,
            "folder": folder,
            "frontmatter": frontmatter or {},
            "apply": apply,
            "reindex_after_apply": reindex_after_apply,
        }

        def run() -> dict[str, object]:
            vault_path = runtime.ensure_vault_path()
            overrides = frontmatter or {}
            violations = validate_ailss_frontmatter_enums(overrides)
            if violations:
                rendered = "; ".join(f"{item.key}={item.value!r}" for item in violations)
                raise RuntimeError(
                    f"Invalid frontmatter override(s): {rendered}. "
                    "See docs/standards/vault/frontmatter-schema.md."
                )

            folder_rel_path = normalize_vault_rel_path(folder).rstrip("/")
            stem = _sanitize_file_stem_from_title(title)

            def find_available_path() -> str:
                candidates = []
                for index in range(0, 50):
                    suffix = "" if index == 0 else f" ({index + 1})"
                    filename = f"{stem}{suffix}.md"
                    rel_path = f"{folder_rel_path}/{filename}" if folder_rel_path else filename
                    candidates.append(rel_path)
                timestamp_suffix = (
                    _now_iso_seconds().replace("-", "").replace(":", "").replace("T", "")[:14]
                )
                fallback = (
                    f"{folder_rel_path}/{stem}-{timestamp_suffix}.md"
                    if folder_rel_path
                    else f"{stem}-{timestamp_suffix}.md"
                )
                candidates.append(fallback)
                for rel_path in candidates:
                    if is_default_ignored_vault_rel_path(rel_path):
                        continue
                    abs_path = resolve_vault_path_safely(vault_path, rel_path)
                    if not abs_path.exists():
                        return rel_path
                raise RuntimeError("Failed to allocate a new note path in the requested folder.")

            rel_path = find_available_path()
            if is_default_ignored_vault_rel_path(rel_path):
                raise RuntimeError(f'Refusing to create note in ignored folder: path="{rel_path}"')

            now = _now_iso_seconds()
            note_frontmatter = build_ailss_frontmatter(
                title=title.strip(),
                now=now,
                tags=_default_tags_for_rel_path(rel_path),
                overrides=overrides,
            )
            markdown = render_markdown_with_frontmatter(
                frontmatter=note_frontmatter,
                body=body,
            )
            sha256 = _sha256_hex_utf8(markdown)

            def apply_write() -> None:
                abs_path = resolve_vault_path_safely(vault_path, rel_path)
                abs_path.parent.mkdir(parents=True, exist_ok=True)
                atomic_write_utf8_file(abs_path, markdown)

            with runtime.write_lock if apply else _noop_context():
                reindex_state = runtime.apply_and_optional_reindex(
                    apply=apply,
                    changed=True,
                    reindex_after_apply=reindex_after_apply,
                    reindex_paths=[rel_path],
                    apply_write=apply_write,
                )

            return {
                "path": rel_path,
                "applied": reindex_state["applied"],
                "note_id": str(note_frontmatter.get("id", "")),
                "created": str(note_frontmatter.get("created", "")),
                "title": str(note_frontmatter.get("title", "")),
                "sha256": sha256,
                "needs_reindex": reindex_state["needs_reindex"],
                "reindexed": reindex_state["reindexed"],
                "reindex_summary": reindex_state["reindex_summary"],
                "reindex_error": reindex_state["reindex_error"],
            }

        return runtime.call_tool("capture_note", args, run)

    @server.tool(
        name="edit_note",
        title="Edit note",
        description="Apply line-based patch ops to an existing note.",
        structured_output=True,
    )
    def edit_note(
        path: Annotated[str, Field(min_length=1)],
        ops: list[dict[str, object]],
        expected_sha256: str | None = None,
        apply: bool = False,
        reindex_after_apply: bool = True,
    ) -> dict[str, object]:
        args = {
            "path": path,
            "ops": ops,
            "expected_sha256": expected_sha256,
            "apply": apply,
            "reindex_after_apply": reindex_after_apply,
        }

        def run() -> dict[str, object]:
            vault_path = runtime.ensure_vault_path()
            runtime.ensure_markdown_path(path, action="edit")
            before_text = read_utf8_file(resolve_vault_path_safely(vault_path, path))
            before_sha256 = _sha256_hex_utf8(before_text)
            if expected_sha256 and expected_sha256 != before_sha256:
                raise RuntimeError(
                    "Edit rejected due to sha256 mismatch. "
                    f'path="{path}" expected_sha256="{expected_sha256}" '
                    f'actual_sha256="{before_sha256}"'
                )

            parsed_ops = [
                LinePatchOp(
                    op=str(item.get("op", "")),
                    at_line=_optional_int_from_record(item, "at_line"),
                    from_line=_optional_int_from_record(item, "from_line"),
                    to_line=_optional_int_from_record(item, "to_line"),
                    text=str(item["text"]) if item.get("text") is not None else None,
                )
                for item in ops
            ]
            after_text = apply_line_patch_ops(before_text, parsed_ops)
            after_sha256 = _sha256_hex_utf8(after_text)
            changed = after_sha256 != before_sha256

            def apply_write() -> None:
                atomic_write_utf8_file(
                    resolve_vault_path_safely(vault_path, path),
                    after_text,
                )

            with runtime.write_lock if apply else _noop_context():
                reindex_state = runtime.apply_and_optional_reindex(
                    apply=apply,
                    changed=changed,
                    reindex_after_apply=reindex_after_apply,
                    reindex_paths=[path],
                    apply_write=apply_write,
                )

            return {
                "path": path,
                "applied": reindex_state["applied"],
                "changed": changed,
                "before_sha256": before_sha256,
                "after_sha256": after_sha256,
                "needs_reindex": reindex_state["needs_reindex"],
                "reindexed": reindex_state["reindexed"],
                "reindex_summary": reindex_state["reindex_summary"],
                "reindex_error": reindex_state["reindex_error"],
            }

        return runtime.call_tool("edit_note", args, run)

    @server.tool(
        name="improve_frontmatter",
        title="Improve frontmatter",
        description="Normalize or add required AILSS frontmatter keys for a note.",
        structured_output=True,
    )
    def improve_frontmatter(
        path: Annotated[str, Field(min_length=1)],
        expected_sha256: str | None = None,
        apply: bool = False,
        reindex_after_apply: bool = True,
        fix_identity: bool = False,
    ) -> dict[str, object]:
        args = {
            "path": path,
            "expected_sha256": expected_sha256,
            "apply": apply,
            "reindex_after_apply": reindex_after_apply,
            "fix_identity": fix_identity,
        }

        def run() -> dict[str, object]:
            vault_path = runtime.ensure_vault_path()
            runtime.ensure_markdown_path(path, action="edit")
            if is_default_ignored_vault_rel_path(path):
                raise RuntimeError(f'Refusing to edit ignored path: path="{path}".')

            before_text = read_utf8_file(resolve_vault_path_safely(vault_path, path))
            before_sha256 = _sha256_hex_utf8(before_text)
            if expected_sha256 and expected_sha256 != before_sha256:
                raise RuntimeError(
                    "Edit rejected due to sha256 mismatch. "
                    f'path="{path}" expected_sha256="{expected_sha256}" '
                    f'actual_sha256="{before_sha256}"'
                )

            had_frontmatter = has_frontmatter_block(before_text)
            parsed = parse_markdown_note(before_text)
            existing_fm = parsed.frontmatter
            missing_before = [
                key for key in REQUIRED_FRONTMATTER_KEYS if not Object_has_own(existing_fm, key)
            ]
            title = coerce_non_empty_string(existing_fm.get("title")) or _remove_markdown_extension(
                Path(path).name
            )
            now = _now_iso_seconds()
            merged = build_ailss_frontmatter(title=title, now=now, preserve=existing_fm)
            merged["aliases"] = normalize_string_list(merged.get("aliases"))
            merged["tags"] = normalize_string_list(merged.get("tags"))
            merged["keywords"] = normalize_string_list(merged.get("keywords"))
            merged["source"] = normalize_string_list(merged.get("source"))
            for rel in AILSS_TYPED_LINK_KEYS:
                merged[rel] = [to_wikilink(item) for item in normalize_string_list(merged.get(rel))]

            created_raw = coerce_non_empty_string(merged.get("created"))
            if created_raw:
                merged["created"] = created_raw[:19]
            updated_raw = coerce_non_empty_string(merged.get("updated"))
            if updated_raw:
                merged["updated"] = updated_raw[:19]

            identity_fixed = False
            if fix_identity:
                id_raw = coerce_non_empty_string(merged.get("id"))
                created = coerce_non_empty_string(merged.get("created"))
                if created:
                    desired_id = id_from_created(created)
                    if desired_id and desired_id != id_raw:
                        merged["id"] = desired_id
                        identity_fixed = True
                elif id_raw and len(id_raw) == 14 and id_raw.isdigit():
                    desired_created = (
                        f"{id_raw[0:4]}-{id_raw[4:6]}-{id_raw[6:8]}T"
                        f"{id_raw[8:10]}:{id_raw[10:12]}:{id_raw[12:14]}"
                    )
                    merged["created"] = desired_created
                    identity_fixed = True

            preview_text = render_markdown_with_frontmatter(frontmatter=merged, body=parsed.body)
            changed_preview = preview_text != before_text
            after_text = preview_text
            if apply and changed_preview:
                merged["updated"] = now
                after_text = render_markdown_with_frontmatter(frontmatter=merged, body=parsed.body)

            after_sha256 = _sha256_hex_utf8(after_text)
            changed = after_sha256 != before_sha256
            id_value = coerce_non_empty_string(merged.get("id"))
            created_value = coerce_non_empty_string(merged.get("created"))
            created_id = id_from_created(created_value) if created_value else None
            id_matches_created = bool(id_value and created_id and id_value == created_id)

            def apply_write() -> None:
                atomic_write_utf8_file(resolve_vault_path_safely(vault_path, path), after_text)

            with runtime.write_lock if apply else _noop_context():
                reindex_state = runtime.apply_and_optional_reindex(
                    apply=apply,
                    changed=changed,
                    reindex_after_apply=reindex_after_apply,
                    reindex_paths=[path],
                    apply_write=apply_write,
                )

            return {
                "path": path,
                "applied": reindex_state["applied"],
                "changed": changed,
                "before_sha256": before_sha256,
                "after_sha256": after_sha256,
                "has_frontmatter": had_frontmatter,
                "missing_required_keys_before": missing_before,
                "identity": {
                    "id": id_value,
                    "created": created_value,
                    "id_matches_created": id_matches_created,
                    "fixed": identity_fixed,
                },
                "needs_reindex": reindex_state["needs_reindex"],
                "reindexed": reindex_state["reindexed"],
                "reindex_summary": reindex_state["reindex_summary"],
                "reindex_error": reindex_state["reindex_error"],
            }

        return runtime.call_tool("improve_frontmatter", args, run)

    @server.tool(
        name="relocate_note",
        title="Relocate note",
        description="Move or rename a note within the vault.",
        structured_output=True,
    )
    def relocate_note(
        from_path: Annotated[str, Field(min_length=1)],
        to_path: Annotated[str, Field(min_length=1)],
        apply: bool = False,
        overwrite: bool = False,
        reindex_after_apply: bool = True,
    ) -> dict[str, object]:
        args = {
            "from_path": from_path,
            "to_path": to_path,
            "apply": apply,
            "overwrite": overwrite,
            "reindex_after_apply": reindex_after_apply,
        }

        def run() -> dict[str, object]:
            vault_path = runtime.ensure_vault_path()
            runtime.ensure_markdown_path(from_path, action="relocate")
            runtime.ensure_markdown_path(to_path, action="relocate")
            if is_default_ignored_vault_rel_path(from_path):
                raise RuntimeError(f'Refusing to relocate ignored path: from_path="{from_path}".')
            if is_default_ignored_vault_rel_path(to_path):
                raise RuntimeError(f'Refusing to relocate into ignored path: to_path="{to_path}".')

            from_abs = resolve_vault_path_safely(vault_path, from_path)
            to_abs = resolve_vault_path_safely(vault_path, to_path)
            if not from_abs.exists():
                raise RuntimeError(f'Source note not found: from_path="{from_path}".')
            dest_exists = to_abs.exists()
            if dest_exists and not overwrite:
                raise RuntimeError(f'Destination already exists: to_path="{to_path}".')

            updated_value = _now_iso_seconds()
            updated_applied = False

            def apply_write() -> None:
                nonlocal updated_applied
                to_abs.parent.mkdir(parents=True, exist_ok=True)
                if dest_exists and overwrite:
                    to_abs.unlink()
                try:
                    from_abs.rename(to_abs)
                except OSError:
                    shutil.copy2(from_abs, to_abs)
                    from_abs.unlink()

                moved_text = read_utf8_file(to_abs)
                if has_frontmatter_block(moved_text):
                    lines = moved_text.replace("\r\n", "\n").split("\n")
                    try:
                        end_index = lines[1:].index("---") + 1
                    except ValueError:
                        end_index = -1
                    if end_index > 0:
                        frontmatter_lines = lines[1:end_index]
                        updated_line = f'updated: "{updated_value}"'
                        for index, line in enumerate(frontmatter_lines):
                            if line.strip().startswith("updated:"):
                                frontmatter_lines[index] = updated_line
                                break
                        else:
                            frontmatter_lines.append(updated_line)
                        rebuilt = ["---", *frontmatter_lines, "---", *lines[end_index + 1 :]]
                        atomic_write_utf8_file(to_abs, "\n".join(rebuilt))
                        updated_applied = True

            with runtime.write_lock if apply else _noop_context():
                reindex_state = runtime.apply_and_optional_reindex(
                    apply=apply,
                    changed=True,
                    reindex_after_apply=reindex_after_apply,
                    reindex_paths=[from_path, to_path],
                    apply_write=apply_write,
                )

            return {
                "from_path": from_path,
                "to_path": to_path,
                "applied": reindex_state["applied"],
                "overwritten": bool(dest_exists and overwrite and reindex_state["applied"]),
                "updated_applied": updated_applied,
                "updated_value": updated_value if updated_applied else None,
                "needs_reindex": reindex_state["needs_reindex"],
                "reindexed": reindex_state["reindexed"],
                "reindex_summary": reindex_state["reindex_summary"],
                "reindex_error": reindex_state["reindex_error"],
            }

        return runtime.call_tool("relocate_note", args, run)

    @server.tool(
        name="canonicalize_typed_links",
        title="Canonicalize typed links",
        description="Canonicalize typed-link targets to deterministic vault-relative paths.",
        structured_output=True,
    )
    def canonicalize_typed_links(
        path: Annotated[str, Field(min_length=1)],
        apply: bool = False,
        reindex_after_apply: bool = True,
    ) -> dict[str, object]:
        args = {"path": path, "apply": apply, "reindex_after_apply": reindex_after_apply}

        def run() -> dict[str, object]:
            vault_path = runtime.ensure_vault_path()
            runtime.ensure_markdown_path(path, action="edit")
            if is_default_ignored_vault_rel_path(path):
                raise RuntimeError(f'Refusing to edit ignored path: path="{path}".')

            before_text = read_utf8_file(resolve_vault_path_safely(vault_path, path))
            before_sha256 = _sha256_hex_utf8(before_text)
            parsed = parse_markdown_note(before_text)
            next_frontmatter = dict(parsed.frontmatter)
            edits: list[dict[str, object]] = []
            unresolved: list[dict[str, object]] = []
            ambiguous: list[dict[str, object]] = []

            for rel in AILSS_TYPED_LINK_KEYS:
                current = parsed.frontmatter.get(rel)
                if isinstance(current, str):
                    current_values = [current]
                    is_scalar = True
                elif isinstance(current, list):
                    current_values = [item for item in current if isinstance(item, str)]
                    is_scalar = False
                else:
                    continue

                next_values = list(current_values)
                changed_rel = False

                for index, entry in enumerate(current_values):
                    target_for_resolution, display = _split_target_and_display(entry)
                    if not target_for_resolution:
                        continue
                    resolved = _resolve_target_candidates(runtime.conn, target_for_resolution, 20)
                    if len(resolved) == 1:
                        canonical_target = _remove_markdown_extension(str(resolved[0]["path"]))
                        after = _canonical_wikilink(canonical_target, display)
                        if after != entry:
                            next_values[index] = after
                            changed_rel = True
                            edits.append(
                                {
                                    "rel": rel,
                                    "index": index,
                                    "before": entry,
                                    "after": after,
                                    "target_before": target_for_resolution,
                                    "target_after": canonical_target,
                                }
                            )
                        continue
                    if not resolved:
                        unresolved.append(
                            {
                                "rel": rel,
                                "index": index,
                                "before": entry,
                                "target": target_for_resolution,
                            }
                        )
                        continue
                    ambiguous.append(
                        {
                            "rel": rel,
                            "index": index,
                            "before": entry,
                            "target": target_for_resolution,
                            "candidates": resolved[:5],
                        }
                    )

                if changed_rel:
                    next_frontmatter[rel] = next_values[0] if is_scalar else next_values

            after_text = before_text
            if edits and has_frontmatter_block(before_text):
                after_text = render_markdown_with_frontmatter(
                    frontmatter=next_frontmatter,
                    body=parsed.body,
                )
            after_sha256 = _sha256_hex_utf8(after_text)
            changed = after_sha256 != before_sha256

            def apply_write() -> None:
                atomic_write_utf8_file(resolve_vault_path_safely(vault_path, path), after_text)

            with runtime.write_lock if apply else _noop_context():
                reindex_state = runtime.apply_and_optional_reindex(
                    apply=apply,
                    changed=changed,
                    reindex_after_apply=reindex_after_apply,
                    reindex_paths=[path],
                    apply_write=apply_write,
                )

            return {
                "path": path,
                "applied": reindex_state["applied"],
                "changed": changed,
                "before_sha256": before_sha256,
                "after_sha256": after_sha256,
                "edits": edits,
                "unresolved": unresolved,
                "ambiguous": ambiguous,
                "needs_reindex": reindex_state["needs_reindex"],
                "reindexed": reindex_state["reindexed"],
                "reindex_summary": reindex_state["reindex_summary"],
                "reindex_error": reindex_state["reindex_error"],
            }

        return runtime.call_tool("canonicalize_typed_links", args, run)


class _noop_context:
    def __enter__(self) -> None:
        return None

    def __exit__(
        self,
        exc_type: object,
        exc: object,
        tb: object,
    ) -> Literal[False]:
        return False
