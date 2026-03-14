from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

PACKAGE_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATASET_DIR = PACKAGE_ROOT / "data"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    vault_path: Path | None = Field(default=None, validation_alias=AliasChoices("AILSS_VAULT_PATH"))
    db_path: Path | None = Field(default=None, validation_alias=AliasChoices("AILSS_DB_PATH"))
    eval_artifact_dir: Path | None = Field(
        default=None,
        validation_alias=AliasChoices("AILSS_EVAL_ARTIFACT_DIR"),
    )
    dataset_dir: Path = Field(
        default=DEFAULT_DATASET_DIR,
        validation_alias=AliasChoices("AILSS_API_DATASET_DIR"),
    )
    default_top_k: int = Field(
        default=5,
        ge=1,
        le=20,
        validation_alias=AliasChoices("AILSS_API_DEFAULT_TOP_K"),
    )
    max_candidates: int = Field(
        default=200,
        ge=20,
        le=500,
        validation_alias=AliasChoices("AILSS_API_MAX_CANDIDATES"),
    )
    max_read_chars: int = Field(
        default=4000,
        ge=500,
        le=20000,
        validation_alias=AliasChoices("AILSS_API_MAX_READ_CHARS"),
    )

    @property
    def resolved_vault_path(self) -> Path | None:
        if self.vault_path is None:
            return None
        return self.vault_path.expanduser()

    @property
    def resolved_db_path(self) -> Path | None:
        if self.db_path is not None:
            return self.db_path.expanduser()
        if self.resolved_vault_path is None:
            return None
        return self.resolved_vault_path / ".ailss" / "index.sqlite"

    @property
    def resolved_eval_artifact_dir(self) -> Path:
        if self.eval_artifact_dir is not None:
            return self.eval_artifact_dir.expanduser()
        if self.resolved_vault_path is not None:
            return self.resolved_vault_path / ".ailss" / "evals"
        return Path(".ailss") / "evals"

    @property
    def resolved_dataset_dir(self) -> Path:
        return self.dataset_dir.expanduser()


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
