from __future__ import annotations

import shutil
from pathlib import Path
from typing import Annotated

from mcp.server.fastmcp import FastMCP
from pydantic import Field

from .mcp_runtime_core import McpRuntime, _noop_context, _now_iso_seconds, _sha256_hex_utf8
from .mcp_runtime_helpers import (
    REQUIRED_FRONTMATTER_KEYS,
    Object_has_own,
    _canonical_wikilink,
    _default_tags_for_rel_path,
    _optional_int_from_record,
    _remove_markdown_extension,
    _resolve_target_candidates,
    _sanitize_file_stem_from_title,
    _split_target_and_display,
)
from .text_patch import LinePatchOp, apply_line_patch_ops
from .vault_runtime import (
    AILSS_TYPED_LINK_KEYS,
    atomic_write_utf8_file,
    build_ailss_frontmatter,
    coerce_non_empty_string,
    has_frontmatter_block,
    id_from_created,
    is_default_ignored_vault_rel_path,
    normalize_string_list,
    normalize_vault_rel_path,
    parse_markdown_note,
    read_utf8_file,
    render_markdown_with_frontmatter,
    resolve_vault_path_safely,
    to_wikilink,
    validate_ailss_frontmatter_enums,
)


def register_write_tools(server: FastMCP, runtime: McpRuntime) -> None:
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
