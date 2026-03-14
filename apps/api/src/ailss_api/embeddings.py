from __future__ import annotations

from dataclasses import dataclass

from openai import OpenAI

from .config import Settings


@dataclass(frozen=True)
class EmbedQueryResult:
    vector: list[float]
    model: str
    prompt_tokens: int | None


def embed_query(settings: Settings, text: str) -> EmbedQueryResult:
    api_key = (settings.openai_api_key or "").strip()
    if not api_key:
        raise ValueError(
            "Semantic retrieval requires OPENAI_API_KEY (or AILSS_OPENAI_API_KEY) to be set."
        )

    client = OpenAI(api_key=api_key)
    response = client.embeddings.create(
        model=settings.openai_embedding_model,
        input=text,
        encoding_format="float",
    )
    embedding = list(response.data[0].embedding)
    usage = getattr(response, "usage", None)
    prompt_tokens = getattr(usage, "prompt_tokens", None)
    return EmbedQueryResult(
        vector=embedding,
        model=response.model,
        prompt_tokens=prompt_tokens,
    )
