from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.auth.deps import CurrentUser, get_current_user
from app.db import get_db
from app.inventory import service
from app.inventory.schemas import (
    CoreHolderDetail,
    Customer,
    CustomerCreate,
    CustomerResult,
    SearchResult,
    SegmentDetail,
    SegmentSummary,
)

router = APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])
DB = Annotated[Session, Depends(get_db)]


@router.get("/search")
def search(db: DB, q: Annotated[str, Query(min_length=1)]) -> list[SearchResult]:
    return service.search(db, q)


@router.get("/segments")
def list_segments(db: DB, region: str | None = None, route_type: str | None = None,
               q: str | None = None, route: str | None = None) -> list[SegmentSummary]:
    return service.list_segment_summaries(db, region, route_type, q, route)


@router.get("/segments/{segment_id}")
def get_segment(db: DB, segment_id: int) -> SegmentDetail:
    segment = service.get_segment(db, segment_id)
    if segment is None:
        raise HTTPException(404, "Segment not found")
    return segment


@router.get("/cores/{core_id}")
def get_core(db: DB, user: Annotated[CurrentUser, Depends(get_current_user)], core_id: int) -> CoreHolderDetail:
    core = service.get_core(db, core_id, user.id)
    if core is None:
        raise HTTPException(404, "Core not found")
    return core


@router.get("/customers")
def list_customers(db: DB, q: str | None = None) -> list[Customer]:
    return service.list_customers(db, q)


@router.post("/customers")
def create_customer(db: DB, user: Annotated[CurrentUser, Depends(get_current_user)], body: CustomerCreate) -> CustomerResult:
    """Existing name (any case): returned as is. Similar names (>= 0.4) need confirm_new=true before a new one is created."""
    name = " ".join(body.name.split())
    if not name:
        raise HTTPException(422, "Customer name is required")
    exact = service.find_customer(db, name)
    if exact:
        return CustomerResult(created=False, customer=exact, similar=[])
    similar = service.similar_customers(db, name)
    if similar and not body.confirm_new:
        return CustomerResult(created=False, customer=None, similar=similar)
    created = service.create_customer(db, name, user.id)
    db.commit()
    return CustomerResult(created=True, customer=created, similar=[])
