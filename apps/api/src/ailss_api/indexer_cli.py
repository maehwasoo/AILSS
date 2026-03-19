from __future__ import annotations

import argparse
from pathlib import Path

from openai import OpenAI

from .config import Settings
from .index_db import (
    OpenIndexDbOptions,
    embedding_dim_for_model,
    open_index_db,
    resolve_default_db_path,
)
from .indexer_runtime import IndexVaultOptions, index_vault


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="AILSS vault indexing CLI (embeddings + sqlite-vec)"
    )
    parser.add_argument("--vault", type=Path, help="Absolute path to the Obsidian vault")
    parser.add_argument(
        "--db",
        type=Path,
        help="DB file path (default: <vault>/.ailss/index.sqlite)",
    )
    parser.add_argument("--model", help="OpenAI embeddings model")
    parser.add_argument("--paths", nargs="+", help="Only index these vault-relative markdown paths")
    parser.add_argument(
        "--reset-db",
        action="store_true",
        help="Delete and recreate the DB before indexing",
    )
    parser.add_argument("--max-chars", type=int, default=4000, help="Max chunk size (characters)")
    parser.add_argument("--batch-size", type=int, default=32, help="Embedding request batch size")
    return parser


def _delete_db_family(db_path: Path) -> None:
    for suffix in ("", "-wal", "-shm", "-journal"):
        candidate = Path(f"{db_path}{suffix}")
        if candidate.exists():
            candidate.unlink()


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()
    settings = Settings()

    try:
        vault_path = args.vault or settings.resolved_vault_path
        if vault_path is None:
            raise RuntimeError("Vault path is missing. Set --vault or AILSS_VAULT_PATH.")

        embedding_model = args.model or settings.openai_embedding_model
        openai_api_key = (settings.openai_api_key or "").strip()
        if not openai_api_key:
            raise RuntimeError(
                "OPENAI_API_KEY is missing. Set it via .env or environment variables."
            )

        db_path = args.db or resolve_default_db_path(vault_path)
        if args.reset_db:
            print(f"[ailss-indexer] reset-db: deleting {db_path}")
            _delete_db_family(db_path)

        conn = open_index_db(
            OpenIndexDbOptions(
                db_path=db_path,
                embedding_model=embedding_model,
                embedding_dim=embedding_dim_for_model(embedding_model),
            )
        )
        try:
            index_vault(
                IndexVaultOptions(
                    conn=conn,
                    db_path_for_log=str(db_path),
                    vault_path=vault_path,
                    openai=OpenAI(api_key=openai_api_key),
                    embedding_model=embedding_model,
                    max_chars=args.max_chars,
                    batch_size=args.batch_size,
                    paths=list(args.paths) if args.paths else None,
                    logger_log=print,
                    logger_write=lambda text: print(text, end=""),
                )
            )
        finally:
            conn.close()
    except Exception as error:
        message = error if isinstance(error, str) else str(error)
        print(f"[ailss-indexer] error: {message}")
        raise SystemExit(1) from error
