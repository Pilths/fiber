from typing import Annotated

from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.admin_edits import router as admin_edits_router
from app.auth.admin import router as admin_users_router
from app.auth.deps import PasswordChangeRequired
from app.auth.router import router as auth_router
from app.db import get_db
from app.history import router as history_router
from app.ingest.reservation_upload_router import router as reservation_upload_router
from app.ingest.site_master_router import router as site_master_router
from app.ingest.span_list_router import router as span_list_router
from app.inventory.router import router as inventory_router
from app.loss.router import router as loss_router
from app.map.router import router as map_router
from app.reservations.router import router as reservations_router
from app.routing.router import router as routing_router

app = FastAPI(title="Fiber Dashboard API")
app.include_router(auth_router)
app.include_router(admin_users_router)
app.include_router(inventory_router)
app.include_router(reservations_router)
app.include_router(loss_router)
app.include_router(site_master_router)
app.include_router(span_list_router)
app.include_router(reservation_upload_router)
app.include_router(admin_edits_router)
app.include_router(history_router)
app.include_router(routing_router)
app.include_router(map_router)


@app.get("/api/health")
def health(db: Annotated[Session, Depends(get_db)]) -> dict[str, str]:
    postgis = db.execute(text("SELECT postgis_version()")).scalar_one()
    return {"status": "ok", "postgis": postgis}


@app.exception_handler(PasswordChangeRequired)
def password_change_required(request: Request, exc: PasswordChangeRequired) -> JSONResponse:
    return JSONResponse({"detail": "Password change required", "code": "password_change_required"}, 403)
