from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

LOG_FILE_NAME = "mcp-tool-failures.jsonl"


@dataclass(frozen=True)
class ToolFailureEvent:
    timestamp: str
    tool: str
    operation: str
    input_path: str | None
    resolved_path: str | None
    error: dict[str, str | None]
    cwd: str
    vault_root: str | None
    request_id: str | int | None
    session_id: str | None
    correlation_id: str | None


@dataclass(frozen=True)
class ToolFailureTypeSummary:
    tool: str
    error_code: str | None
    error_name: str | None
    count: int
    first_timestamp: str
    last_timestamp: str
    sample_message: str


@dataclass(frozen=True)
class ToolFailureReport:
    enabled: bool
    log_dir: str | None
    log_path: str | None
    scanned_events: int
    matched_events: int
    first_timestamp: str | None
    last_timestamp: str | None
    top_error_types: list[ToolFailureTypeSummary]
    recent_events: list[ToolFailureEvent]


def _to_nullable_string(value: object) -> str | None:
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    return None


def _to_request_id(value: object) -> str | int | None:
    if isinstance(value, str):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return None


def _extract_primary_input_path(args: Mapping[str, object] | None) -> str | None:
    if args is None:
        return None
    for key in ("path", "input_path", "from_path", "to_path"):
        value = args.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return None


def _normalize_error(error: Exception) -> dict[str, str | None]:
    code = getattr(error, "code", None)
    return {
        "code": str(code) if isinstance(code, (str, int)) else None,
        "name": error.__class__.__name__,
        "message": str(error) or "Unknown error",
    }


def _correlation_id_for(
    request_id: str | int | None,
    session_id: str | None,
) -> str | None:
    if request_id is None and session_id is None:
        return None
    return f"{session_id or 'no-session'}:{request_id or 'no-request'}"


def _resolved_path(vault_root: Path | None, input_path: str | None) -> str | None:
    if vault_root is None or input_path is None:
        return None
    return str((vault_root / input_path).resolve())


class ToolFailureDiagnostics:
    def __init__(self, *, vault_path: Path | None, cwd: Path) -> None:
        self._vault_root = vault_path.resolve() if vault_path is not None else None
        self._cwd = cwd.resolve()
        self.enabled = self._vault_root is not None
        self.log_dir = self._vault_root / ".ailss" / "logs" if self._vault_root else None
        self.log_path = self.log_dir / LOG_FILE_NAME if self.log_dir else None

    def log_tool_failure(
        self,
        *,
        tool: str,
        args: Mapping[str, object] | None,
        error: Exception,
        request_id: object = None,
        session_id: object = None,
        operation: str = "tool_call",
    ) -> None:
        if not self.enabled or self.log_dir is None or self.log_path is None:
            return

        input_path = _extract_primary_input_path(args)
        event = ToolFailureEvent(
            timestamp=self._now_iso(),
            tool=tool,
            operation=operation,
            input_path=input_path,
            resolved_path=_resolved_path(self._vault_root, input_path),
            error=_normalize_error(error),
            cwd=str(self._cwd),
            vault_root=str(self._vault_root) if self._vault_root else None,
            request_id=_to_request_id(request_id),
            session_id=_to_nullable_string(session_id),
            correlation_id=_correlation_id_for(
                _to_request_id(request_id),
                _to_nullable_string(session_id),
            ),
        )

        self.log_dir.mkdir(parents=True, exist_ok=True)
        with self.log_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event.__dict__, ensure_ascii=True))
            handle.write("\n")

    def get_tool_failure_report(
        self,
        *,
        recent_limit: int,
        top_error_limit: int,
        tool: str | None = None,
    ) -> ToolFailureReport:
        if self.log_path is None:
            return ToolFailureReport(
                enabled=False,
                log_dir=None,
                log_path=None,
                scanned_events=0,
                matched_events=0,
                first_timestamp=None,
                last_timestamp=None,
                top_error_types=[],
                recent_events=[],
            )

        events = self._read_events()
        matched = [event for event in events if tool is None or event.tool == tool]
        recent_events = sorted(matched, key=lambda event: event.timestamp, reverse=True)[
            :recent_limit
        ]
        top_error_types = self._summarize_top_errors(matched, top_error_limit)

        timestamps = [event.timestamp for event in matched]
        return ToolFailureReport(
            enabled=self.enabled,
            log_dir=str(self.log_dir) if self.log_dir else None,
            log_path=str(self.log_path),
            scanned_events=len(events),
            matched_events=len(matched),
            first_timestamp=min(timestamps) if timestamps else None,
            last_timestamp=max(timestamps) if timestamps else None,
            top_error_types=top_error_types,
            recent_events=recent_events,
        )

    def _read_events(self) -> list[ToolFailureEvent]:
        if self.log_path is None or not self.log_path.exists():
            return []

        events: list[ToolFailureEvent] = []
        for raw_line in self.log_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line:
                continue
            try:
                parsed = json.loads(line)
            except ValueError:
                continue
            if not isinstance(parsed, dict):
                continue

            error = parsed.get("error")
            if not isinstance(error, dict):
                continue

            timestamp = parsed.get("timestamp")
            tool = parsed.get("tool")
            operation = parsed.get("operation")
            cwd = parsed.get("cwd")
            message = error.get("message")
            if not all(
                isinstance(value, str) for value in (timestamp, tool, operation, cwd, message)
            ):
                continue
            assert isinstance(timestamp, str)
            assert isinstance(tool, str)
            assert isinstance(operation, str)
            assert isinstance(cwd, str)
            assert isinstance(message, str)

            events.append(
                ToolFailureEvent(
                    timestamp=timestamp,
                    tool=tool,
                    operation=operation,
                    input_path=_to_nullable_string(parsed.get("input_path")),
                    resolved_path=_to_nullable_string(parsed.get("resolved_path")),
                    error={
                        "code": _to_nullable_string(error.get("code")),
                        "name": _to_nullable_string(error.get("name")),
                        "message": message,
                    },
                    cwd=cwd,
                    vault_root=_to_nullable_string(parsed.get("vault_root")),
                    request_id=_to_request_id(parsed.get("request_id")),
                    session_id=_to_nullable_string(parsed.get("session_id")),
                    correlation_id=_to_nullable_string(parsed.get("correlation_id")),
                )
            )
        return events

    def _summarize_top_errors(
        self,
        events: list[ToolFailureEvent],
        limit: int,
    ) -> list[ToolFailureTypeSummary]:
        buckets: dict[tuple[str, str | None, str | None], ToolFailureTypeSummary] = {}
        for event in events:
            key = (event.tool, event.error["code"], event.error["name"])
            existing = buckets.get(key)
            if existing is None:
                buckets[key] = ToolFailureTypeSummary(
                    tool=event.tool,
                    error_code=event.error["code"],
                    error_name=event.error["name"],
                    count=1,
                    first_timestamp=event.timestamp,
                    last_timestamp=event.timestamp,
                    sample_message=event.error["message"] or "Unknown error",
                )
                continue

            buckets[key] = ToolFailureTypeSummary(
                tool=existing.tool,
                error_code=existing.error_code,
                error_name=existing.error_name,
                count=existing.count + 1,
                first_timestamp=min(existing.first_timestamp, event.timestamp),
                last_timestamp=max(existing.last_timestamp, event.timestamp),
                sample_message=(
                    event.error["message"]
                    if event.timestamp >= existing.last_timestamp
                    else existing.sample_message
                )
                or "Unknown error",
            )

        return sorted(
            buckets.values(),
            key=lambda item: (-item.count, item.last_timestamp),
            reverse=False,
        )[:limit]

    def _now_iso(self) -> str:
        from datetime import datetime

        return datetime.now().isoformat(timespec="seconds")
