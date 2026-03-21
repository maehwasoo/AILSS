from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from .index_db import resolve_note_paths_by_wikilink_target
from .vault_runtime import (
    AILSS_REQUIRED_FRONTMATTER_KEYS,
    AILSS_TYPED_LINK_ONTOLOGY_BY_REL,
    TypedLinkRecord,
    coerce_trimmed_string_or_empty,
    has_frontmatter_block,
    id_from_created,
    list_markdown_files,
    normalize_ailss_note_meta,
    normalize_vault_rel_path,
    parse_markdown_note,
    read_utf8_file,
    validate_ailss_frontmatter_enums,
)

REQUIRED_FRONTMATTER_KEYS = list(AILSS_REQUIRED_FRONTMATTER_KEYS)


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


def Object_has_own(record: dict[str, object], key: str) -> bool:
    return key in record


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


def _optional_int_from_record(item: dict[str, object], key: str) -> int | None:
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
