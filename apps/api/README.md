# AILSS API

Local FastAPI app for the Python-first AILSS backend baseline.

## Commands

```bash
uv sync --directory apps/api
uv run --directory apps/api ailss-api --host 127.0.0.1 --port 8000
uv run --directory apps/api pytest
```

## Environment

- `AILSS_VAULT_PATH`: optional vault root for note reads and default DB path resolution
- `AILSS_DB_PATH`: optional explicit SQLite index path
- `AILSS_EVAL_ARTIFACT_DIR`: optional artifact directory for eval runs
- `AILSS_API_DATASET_DIR`: optional dataset directory for eval inputs
