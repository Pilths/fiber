from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.db import get_db
from app.routing import service

router = APIRouter(prefix="/api/routes", dependencies=[Depends(get_current_user)])
DB = Annotated[Session, Depends(get_db)]


@router.get("/endpoints")
def endpoints(db: DB) -> list[dict[str, Any]]:
    return service.endpoints(db)


@router.get("")
def routes(db: DB, frm: Annotated[int, Query(alias="from")], to: int, cores_needed: Annotated[int, Query(ge=1)],
           sort: Literal["km", "free_cores"] = "km") -> dict[str, Any]:
    return service.find_routes(db, frm, to, cores_needed, sort)


@router.get("/pick")
def pick(db: DB, span_ids: Annotated[list[int], Query(min_length=1)], cores_needed: Annotated[int, Query(ge=1)]) -> dict[str, Any]:
    """The cores a route reservation would take: the first free cores on each span. The UI sends them to POST /api/reservations."""
    return service.pick(db, span_ids, cores_needed)
