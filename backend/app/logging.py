"""Request log: one line per request with method, route template, status and duration.

Never the concrete path, query string, client address, headers or body (Principle IV,
research R15). Uvicorn's access log is disabled in `app.main`, so this is the only request log.
"""

from __future__ import annotations

import logging
import time

from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger("app.requests")


class RequestLogMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        start = time.perf_counter()
        status = 500

        async def send_status(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, send_status)
        finally:
            # The router stores the matched route in the scope; its path is the template.
            route = scope.get("route")
            template = getattr(route, "path", None) or "unmatched"
            duration_ms = round((time.perf_counter() - start) * 1000)
            logger.info("%s %s %d %d", scope["method"], template, status, duration_ms)
