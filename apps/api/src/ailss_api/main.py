from __future__ import annotations

from fastapi import FastAPI, HTTPException

from .agent import run_agent_workflow
from .config import Settings, get_settings
from .evals import DatasetNotFoundError, run_eval
from .models import (
    AgentRunRequest,
    AgentRunResponse,
    EvalRunRequest,
    EvalRunResponse,
    HealthResponse,
    RetrieveRequest,
    RetrieveResponse,
)
from .retrieval import IndexNotReadyError, build_health_response, retrieve_notes


def create_app(settings: Settings | None = None) -> FastAPI:
    app_settings = settings or get_settings()
    app = FastAPI(
        title="AILSS API",
        version="0.1.0-dev",
        summary="Python-first local agent backend baseline",
    )

    @app.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return build_health_response(app_settings)

    @app.post("/retrieve", response_model=RetrieveResponse)
    def retrieve(request: RetrieveRequest) -> RetrieveResponse:
        try:
            return retrieve_notes(request, app_settings)
        except IndexNotReadyError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

    @app.post("/agent/run", response_model=AgentRunResponse)
    def agent_run(request: AgentRunRequest) -> AgentRunResponse:
        try:
            return run_agent_workflow(request, app_settings)
        except IndexNotReadyError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

    @app.post("/eval/run", response_model=EvalRunResponse)
    def eval_run(request: EvalRunRequest) -> EvalRunResponse:
        try:
            return run_eval(request, app_settings)
        except DatasetNotFoundError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        except IndexNotReadyError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

    return app


app = create_app()
