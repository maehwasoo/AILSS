from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class LinePatchOp:
    op: str
    at_line: int | None = None
    from_line: int | None = None
    to_line: int | None = None
    text: str | None = None


def _parse_patch_text(text: str) -> list[str]:
    if not text:
        return []
    normalized = text.replace("\r\n", "\n")
    ends_with_newline = normalized.endswith("\n")
    parts = normalized.split("\n")
    if ends_with_newline:
        parts.pop()
    return parts


def _detect_eol(text: str) -> str:
    return "\r\n" if "\r\n" in text else "\n"


def apply_line_patch_ops(original_text: str, ops: list[LinePatchOp]) -> str:
    eol = _detect_eol(original_text)
    normalized = original_text.replace("\r\n", "\n")
    had_trailing_newline = normalized.endswith("\n")
    lines = normalized.split("\n")
    if had_trailing_newline:
        lines.pop()

    for op in ops:
        if op.op == "insert_lines":
            if op.at_line is None:
                raise ValueError('insert_lines requires "at_line".')
            if op.text is None:
                raise ValueError('insert_lines requires "text".')
            max_at_line = len(lines) + 1
            if op.at_line < 1 or op.at_line > max_at_line:
                raise ValueError(
                    f"insert_lines.at_line out of range: {op.at_line} (valid: 1..{max_at_line})"
                )
            lines[op.at_line - 1 : op.at_line - 1] = _parse_patch_text(op.text)
            continue

        if op.from_line is None:
            raise ValueError(f'{op.op} requires "from_line".')
        if op.to_line is None:
            raise ValueError(f'{op.op} requires "to_line".')
        if op.from_line < 1 or op.to_line < 1:
            raise ValueError(f"{op.op} line numbers must be >= 1.")
        if op.to_line < op.from_line:
            raise ValueError(
                f"{op.op}.to_line must be >= from_line (from={op.from_line}, to={op.to_line})."
            )

        max_line = len(lines)
        if op.from_line > max_line or op.to_line > max_line:
            raise ValueError(
                f"{op.op} range out of bounds: {op.from_line}..{op.to_line} (max line: {max_line})."
            )

        start = op.from_line - 1
        count = op.to_line - op.from_line + 1
        if op.op == "delete_lines":
            del lines[start : start + count]
            continue

        if op.op == "replace_lines":
            if op.text is None:
                raise ValueError('replace_lines requires "text".')
            lines[start : start + count] = _parse_patch_text(op.text)
            continue

        raise ValueError(f"Unsupported patch op: {op.op}")

    output = "\n".join(lines)
    if had_trailing_newline:
        output += "\n"
    if eol == "\r\n":
        output = output.replace("\n", "\r\n")
    return output
