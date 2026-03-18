from __future__ import annotations

import json

from .config import Settings


def write_run_artifact(
    *,
    settings: Settings,
    run_id: str,
    payload: dict[str, object],
) -> str:
    output_dir = settings.resolved_run_artifact_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    artifact_path = output_dir / f"{run_id}.json"
    artifact_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return str(artifact_path)
