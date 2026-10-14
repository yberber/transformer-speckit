"""The inference service: `uv run uvicorn app.main:app --port 7860 --no-access-log`.

The model loads in the background after start-up, so the service answers at once: `/health`
says `model_loading` (503) until it is ready, which the frontend shows as "waking up".
Interactive docs are off; the contract in `contracts/` is the API's documentation.
"""

from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from starlette.concurrency import run_in_threadpool

from app import api
from app.core import model as gpt2
from app.errors import InternalErrorMiddleware, install_handlers
from app.logging import RequestLogMiddleware

logger = logging.getLogger("app")


def allowed_origins() -> list[str]:
    """`ALLOWED_ORIGINS`, comma-separated; empty or unset allows no cross-origin caller."""
    return [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]


async def _load_model(app: FastAPI) -> None:
    try:
        await run_in_threadpool(gpt2.load)
    except Exception as exc:  # the class only: a message could name local paths
        logger.error("model load failed: %s", type(exc).__name__)
        return
    app.state.ready = True
    logger.info("model ready")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    task = asyncio.create_task(_load_model(app))
    yield
    task.cancel()


def _configure_logging() -> None:
    """Uvicorn configures only its own loggers; give ours a console handler at INFO."""
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(levelname)s:     %(name)s %(message)s"))
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)


def create_app() -> FastAPI:
    _configure_logging()
    # Uvicorn's access log has the full path and the client address; run uvicorn with
    # --no-access-log too. The request log in app.logging replaces it.
    logging.getLogger("uvicorn.access").disabled = True
    app = FastAPI(
        title="Inside the Transformer inference API",
        version=api.API_VERSION,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )
    app.state.ready = False
    install_handlers(app)
    app.include_router(api.router)
    # Added innermost first: errors become 500s inside CORS (so the browser can read them),
    # and the request log sees every final status.
    app.add_middleware(InternalErrorMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins(),
        allow_methods=["GET", "POST"],
        allow_headers=["content-type"],
    )
    app.add_middleware(GZipMiddleware, minimum_size=1000)
    app.add_middleware(RequestLogMiddleware)
    return app


app = create_app()
