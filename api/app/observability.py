"""Logging setup and one log line per request that matters."""
import logging
import os
import time
from collections.abc import Awaitable, Callable, Iterator
from contextlib import contextmanager

from fastapi import FastAPI, Request, Response

SLOW_REQUEST_SECONDS = 1.0
QUIET_PATHS = ("/api/health",)

logger = logging.getLogger("app.request")
upload_logger = logging.getLogger("app.upload")


def configure_logging() -> None:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


def _describe(request: Request, status: int, seconds: float) -> str:
    return f"{request.method} {request.url.path} -> {status} in {seconds * 1000:.0f} ms"


def add_request_log(app: FastAPI) -> None:
    """Logs 409 conflicts, server errors and slow requests. Not the query string: it can hold search text."""

    @app.middleware("http")
    async def log_request(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            logger.exception("%s -> unhandled error", f"{request.method} {request.url.path}")
            raise
        seconds = time.perf_counter() - started
        if request.url.path in QUIET_PATHS:
            return response
        if response.status_code >= 500:
            logger.error(_describe(request, response.status_code, seconds))
        elif seconds >= SLOW_REQUEST_SECONDS:
            logger.warning("slow: " + _describe(request, response.status_code, seconds))
        elif response.status_code == 409:
            logger.info("conflict: " + _describe(request, response.status_code, seconds))
        return response


@contextmanager
def logged_apply(kind: str, upload_id: int, admin_id: int) -> Iterator[None]:
    """Start and end of an upload apply. A refusal (HTTPException) is an end, not a crash."""
    upload_logger.info("apply start kind=%s upload=%s admin=%s", kind, upload_id, admin_id)
    started = time.perf_counter()
    try:
        yield
    except Exception as error:
        upload_logger.warning("apply failed kind=%s upload=%s admin=%s after %.1f s: %r",
                              kind, upload_id, admin_id, time.perf_counter() - started, error)
        raise
    upload_logger.info("apply done kind=%s upload=%s admin=%s in %.1f s",
                       kind, upload_id, admin_id, time.perf_counter() - started)
