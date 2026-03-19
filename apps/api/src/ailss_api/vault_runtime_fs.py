from __future__ import annotations

import hashlib
import os
import time
from pathlib import Path

from .vault_runtime_constants import DEFAULT_IGNORE_DIRS
from .vault_runtime_types import VaultMarkdownFile


def now_iso_seconds() -> str:
    current = time.localtime()
    return (
        f"{current.tm_year:04d}-{current.tm_mon:02d}-{current.tm_mday:02d}"
        f"T{current.tm_hour:02d}:{current.tm_min:02d}:{current.tm_sec:02d}"
    )


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def normalize_newlines(text: str) -> str:
    return text.replace("\r\n", "\n")


def normalize_vault_rel_path(value: str) -> str:
    return value.replace("\\", "/").lstrip("/")


def is_default_ignored_vault_rel_path(rel_path: str) -> bool:
    normalized = normalize_vault_rel_path(rel_path).strip()
    if not normalized:
        return False

    segments = [segment for segment in normalized.split("/") if segment]
    return any(segment in DEFAULT_IGNORE_DIRS for segment in segments[:-1])


def resolve_vault_path_safely(vault_path: Path, vault_rel_path: str) -> Path:
    candidate = (vault_path / vault_rel_path).resolve()
    root = vault_path.resolve()
    try:
        candidate.relative_to(root)
    except ValueError as error:
        raise ValueError("Refusing to access a path outside the vault.") from error
    return candidate


def list_markdown_files(vault_path: Path) -> list[Path]:
    results: list[Path] = []
    for path in sorted(vault_path.rglob("*.md")):
        rel_path = normalize_vault_rel_path(str(path.relative_to(vault_path)))
        if is_default_ignored_vault_rel_path(rel_path):
            continue
        if not path.is_file():
            continue
        results.append(path)
    return results


def stat_markdown_file(vault_path: Path, abs_path: Path) -> VaultMarkdownFile:
    stat = abs_path.stat()
    contents = abs_path.read_bytes()
    return VaultMarkdownFile(
        abs_path=abs_path,
        rel_path=normalize_vault_rel_path(str(abs_path.relative_to(vault_path))),
        mtime_ms=int(stat.st_mtime_ns / 1_000_000),
        size=stat.st_size,
        sha256=sha256_bytes(contents),
    )


def read_utf8_file(abs_path: Path) -> str:
    return abs_path.read_text(encoding="utf-8")


def atomic_write_utf8_file(abs_path: Path, text: str) -> None:
    tmp_path = abs_path.with_name(f".{abs_path.name}.tmp-{os.getpid()}-{int(time.time() * 1000)}")
    tmp_path.write_text(text, encoding="utf-8")
    try:
        tmp_path.replace(abs_path)
    except Exception:
        if abs_path.exists():
            abs_path.unlink()
        tmp_path.replace(abs_path)
