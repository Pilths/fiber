from typing import Annotated, Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.db import get_db
from app.map import service

router = APIRouter(prefix="/api/map", dependencies=[Depends(get_current_user)])
DB = Annotated[Session, Depends(get_db)]


@router.get("/spans")
def spans(db: DB) -> dict[str, Any]:
    return service.map_spans(db)


@router.get("/sites")
def sites(db: DB) -> dict[str, Any]:
    return service.map_sites(db)
