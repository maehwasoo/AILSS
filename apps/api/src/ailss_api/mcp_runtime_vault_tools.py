from __future__ import annotations

from dataclasses import asdict
from typing import Annotated, Any, Literal

from mcp.server.fastmcp import FastMCP
from pydantic import Field

from .mcp_runtime_core import McpRuntime
from .mcp_runtime_helpers import (
    REQUIRED_FRONTMATTER_KEYS,
    TypedLinkDiagnostic,
    _clean_optional_string,
    _collect_typed_link_diagnostics,
    _scan_vault_notes_for_frontmatter_validate,
)
from .vault_runtime import (
    AILSS_FRONTMATTER_ENTITY_VALUES,
    AILSS_FRONTMATTER_LAYER_VALUES,
    AILSS_FRONTMATTER_STATUS_VALUES,
    list_markdown_files,
    normalize_vault_rel_path,
    read_utf8_file,
    resolve_vault_path_safely,
)


def register_vault_tools(server: FastMCP, runtime: McpRuntime) -> None:
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
