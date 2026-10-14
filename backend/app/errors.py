"""Error codes and handlers. No response or log line ever contains request input (Principle IV,
research R15).

Every error has the body `{"error": {"code", "params"?}}`, with params holding only numbers and
field names. FastAPI's default 422 echoes the offending `input`; it is replaced here. Unexpected
exceptions are logged by class name and code location only, never `str(exc)` or locals, because
an exception message can carry the text being processed.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger("app.errors")

HTTP_STATUS = {
    "empty_input": 422,
    "input_too_long_chars": 422,
    "input_too_long_tokens": 422,
    "invalid_request": 400,
    "rate_limited": 429,
    "busy": 503,
    "model_loading": 503,
    "internal": 500,
}

# Suggested wait while the model loads after a cold start (seconds, for Retry-After).
MODEL_LOADING_RETRY_S = 5

_FIELD = re.compile(r"^[a-z_]+$")


class ApiError(Exception):
    def __init__(self, code: str, params: dict[str, int | str] | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.http_status = HTTP_STATUS[code]
        self.params = params or {}

    @property
    def retry_after_s(self) -> int | None:
        if self.http_status not in (429, 503):
            return None
        return int(self.params.get("retry_after_s", MODEL_LOADING_RETRY_S))


def error_response(
    code: str,
    params: dict[str, Any] | None = None,
    status: int | None = None,
    retry_after_s: int | None = None,
) -> JSONResponse:
    error: dict[str, Any] = {"code": code}
    if params:
        error["params"] = params
    headers = {"Retry-After": str(retry_after_s)} if retry_after_s is not None else None
    return JSONResponse({"error": error}, status_code=status or HTTP_STATUS[code], headers=headers)


async def _api_error(_request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, ApiError)
    return error_response(exc.code, exc.params, exc.http_status, exc.retry_after_s)


def _field(exc: RequestValidationError) -> str | None:
    """The offending field's name: the last string element of the first error's location that
    looks like a field name. Never the error's `input` or `msg`, which can quote the input."""
    for error in exc.errors():
        names = [p for p in error.get("loc", ()) if isinstance(p, str) and _FIELD.match(p)]
        if names:
            return names[-1]
    return None


async def _validation_error(_request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)
    field = _field(exc)
    return error_response("invalid_request", {"field": field} if field else None)


async def _http_error(_request: Request, exc: Exception) -> JSONResponse:
    """Unknown routes, wrong methods: the status stays, the body follows the contract."""
    assert isinstance(exc, StarletteHTTPException)
    return error_response("invalid_request", status=exc.status_code)


def install_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ApiError, _api_error)
    app.add_exception_handler(RequestValidationError, _validation_error)
    app.add_exception_handler(StarletteHTTPException, _http_error)


def _location(exc: BaseException) -> str:
    """`module:lineno` of the frame that raised: request-independent."""
    tb = exc.__traceback__
    if tb is None:
        return "unknown"
    while tb.tb_next is not None:
        tb = tb.tb_next
    return f"{tb.tb_frame.f_globals.get('__name__', '?')}:{tb.tb_lineno}"


class InternalErrorMiddleware:
    """Turns any unhandled exception into `500 internal`.

    Starlette's own handler for `Exception` re-raises after responding, so the server would log
    the full exception, message included. This middleware stops it here instead.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = False

        async def send_tracking(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, send_tracking)
        except Exception as exc:  # every failure becomes `internal`
            logger.error("internal error: %s at %s", type(exc).__name__, _location(exc))
            if not started:
                await error_response("internal")(scope, receive, send)
