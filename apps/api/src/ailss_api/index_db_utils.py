from __future__ import annotations

import json
from datetime import datetime


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def safe_parse_embedding(value: object) -> list[float] | None:
    if isinstance(value, list) and all(isinstance(item, (int, float)) for item in value):
        return [float(item) for item in value]
    if isinstance(value, (str, bytes)):
        try:
            text = value if isinstance(value, str) else value.decode("utf-8")
            parsed = json.loads(text)
        except (UnicodeDecodeError, ValueError):
            return None
        if isinstance(parsed, list) and all(isinstance(item, (int, float)) for item in parsed):
            return [float(item) for item in parsed]
    return None


def safe_parse_json_object(input_text: str) -> dict[str, object]:
    try:
        value = json.loads(input_text)
    except ValueError:
        return {}
    if isinstance(value, dict):
        return {str(key): value[key] for key in value}
    return {}


def safe_parse_json_array(input_text: str) -> list[str]:
    try:
        value = json.loads(input_text)
    except ValueError:
        return []
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if isinstance(item, str)]


def normalize_string_list(input_value: str | list[str] | None) -> list[str] | None:
    if isinstance(input_value, str):
        return [input_value]
    if isinstance(input_value, list):
        return [item for item in input_value if isinstance(item, str)]
    return None


def escape_sql_like_literal(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def to_literal_prefix_like_pattern(prefix: str) -> str:
    return f"{escape_sql_like_literal(prefix)}%"
