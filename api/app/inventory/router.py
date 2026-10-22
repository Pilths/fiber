from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.db import get_db
from app.inventory import service
from app.inventory.schemas import (
    Customer, CustomerCreate, CustomerStub, SearchResult, SpanDetail, SpanSummary,
)

router = APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])
DB = Annotated[Session, Depends(get_db)]


@router.get("/search")
def search(db: DB, q: Annotated[str, Query(min_length=1)]) -> list[SearchResult]:
    return service.search(db, q)


@router.get("/spans")
def list_spans(db: DB, region: str | None = None, route_type: str | None = None,
               q: str | None = None) -> list[SpanSummary]:
    return service.list_span_summaries(db, region, route_type, q)


@router.get("/spans/{span_id}")
def get_span(db: DB, span_id: int) -> SpanDetail:
    span = service.get_span(db, span_id)
    if span is None:
        raise HTTPException(404, "Span not found")
    return span


@router.get("/customers")
def list_customers(db: DB, q: str | None = None) -> list[Customer]:
    return service.list_customers(db, q)


@router.post("/customers")
def create_customer(db: DB, body: CustomerCreate) -> CustomerStub:
    """STUB (real one is TASK-029): inserts nothing, only returns similar existing names."""
    return CustomerStub(name=body.name, similar=service.similar_customers(db, body.name))
