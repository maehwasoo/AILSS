from __future__ import annotations

from time import perf_counter

from .config import Settings
from .embeddings import embed_query as _embed_query
from .models import RetrieveRequest, RetrieveResponse
from .retrieval_index import IndexNotReadyError, build_health_response, inspect_index
from .retrieval_lexical import run_lexical_retrieval
from .retrieval_semantic import run_semantic_retrieval

# Test seam
embed_query = _embed_query

__all__ = [
    "IndexNotReadyError",
    "build_health_response",
    "embed_query",
    "inspect_index",
    "retrieve_notes",
]


def retrieve_notes(request: RetrieveRequest, settings: Settings) -> RetrieveResponse:
    started = perf_counter()
    if request.mode == "semantic":
        return run_semantic_retrieval(
            request,
            settings,
            started,
            embed_query_fn=embed_query,
        )
    return run_lexical_retrieval(request, settings, started)
