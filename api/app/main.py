import logging
from functools import lru_cache
from pathlib import Path
from typing import Annotated

from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.admin_edits import router as admin_edits_router
from app.auth.admin import router as admin_users_router
from app.auth.deps import PasswordChangeRequired
from app.auth.router import router as auth_router
from app.db import get_db
from app.errors import ServiceError
from app.environment import check_startup_environment
from app.history import router as history_router
from app.ingest.kmz_router import router as kmz_router
from app.ingest.reservation_upload_router import router as reservation_upload_router
from app.ingest.segment_list_router import router as segment_list_router
from app.ingest.site_master_router import router as site_master_router
from app.inventory.router import router as inventory_router
from app.loss.router import router as loss_router
from app.map.router import router as map_router
from app.observability import add_request_log, configure_logging
from app.reservations.router import router as reservations_router
from app.routing.router import router as routing_router

configure_logging()
check_startup_environment()
app = FastAPI(title="Fiber Dashboard API")
add_request_log(app)


@app.exception_handler(ServiceError)
def service_error_response(request: Request, error: ServiceError) -> JSONResponse:
    return JSONResponse({"detail": error.message}, status_code=error.status)


app.include_router(auth_router)
app.include_router(admin_users_router)
app.include_router(inventory_router)
app.include_router(reservations_router)
app.include_router(loss_router)
app.include_router(site_master_router)
app.include_router(segment_list_router)
app.include_router(kmz_router)
app.include_router(reservation_upload_router)
app.include_router(admin_edits_router)
app.include_router(history_router)
app.include_router(routing_router)
app.include_router(map_router)


@app.get("/api/health")
def health(db: Annotated[Session, Depends(get_db)]) -> dict[str, str]:
    postgis = db.execute(text("SELECT postgis_version()")).scalar_one()
    return {"status": "ok", "postgis": postgis}


_API_DIR = Path(__file__).resolve().parent.parent

ALEMBIC_VERSION_SQL = text("SELECT version_num FROM alembic_version")


@lru_cache
def _alembic_head() -> str | None:
    config = Config(str(_API_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(_API_DIR / "alembic"))
    return ScriptDirectory.from_config(config).get_current_head()


@app.get("/api/ready")
def ready(db: Annotated[Session, Depends(get_db)]) -> JSONResponse:
    database_revision = db.execute(ALEMBIC_VERSION_SQL).scalar_one_or_none()
    head = _alembic_head()
    if database_revision == head:
        return JSONResponse({"status": "ready", "revision": head})
    return JSONResponse(
        {"status": "schema behind", "database": database_revision, "head": head},
        status_code=503,
    )


LOCK_BUSY_SQLSTATES = {"55P03", "40P01"}  # lock_not_available, deadlock_detected
BUSY_MESSAGE = "The data is busy with another change. Try again."
logger = logging.getLogger("app.main")


@app.exception_handler(DBAPIError)  # OperationalError is a subclass
def database_error(request: Request, exc: DBAPIError) -> JSONResponse:
    if getattr(exc.orig, "sqlstate", None) not in LOCK_BUSY_SQLSTATES:
        raise exc
    logger.info("lock wait gave up on %s %s: %s", request.method, request.url.path, exc.orig)
    return JSONResponse({"detail": BUSY_MESSAGE}, status_code=409)


@app.exception_handler(PasswordChangeRequired)
def password_change_required(request: Request, exc: PasswordChangeRequired) -> JSONResponse:
    return JSONResponse({"detail": "Password change required", "code": "password_change_required"}, 403)


# The production image copies the built web app here; in development the folder is absent and Vite
# serves the pages. Mounted last so every /api route above wins over it.
STATIC_DIR = _API_DIR / "static"

if STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="web")
