from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.db import get_db
from app.loss import service
from app.loss.schemas import Coverage, RouteLoss, SpanLoss, SpanLossDetail

router = APIRouter(prefix="/api/loss", dependencies=[Depends(get_current_user)])
DB = Annotated[Session, Depends(get_db)]


@router.get("/spans")
def spans(db: DB, span_id: int | None = None, region: str | None = None,
          route_type: str | None = None) -> list[SpanLoss]:
    return [SpanLoss(**r) for r in service.span_rows(db, span_id, region, route_type)]


@router.get("/spans/{span_id}")
def span(db: DB, span_id: int) -> SpanLossDetail:
    rows = service.span_rows(db, span_id)
    if not rows:
        raise HTTPException(404, "Span not found")
    return SpanLossDetail(**rows[0], history=service.history(db, span_id),
                          cores=service.core_losses(db, span_id, rows[0]["calculated_db"]))


@router.get("/coverage")
def coverage(db: DB) -> Coverage:
    return Coverage(**service.coverage(db))


@router.get("/route")
def route(db: DB, span_ids: Annotated[str, Query(description="Comma-separated span ids, in route order")]) -> RouteLoss:
    try:
        ids = [int(x) for x in span_ids.split(",") if x.strip()]
    except ValueError:
        raise HTTPException(422, "span_ids must be comma-separated integers") from None
    result = service.route(db, ids)
    if result is None:
        raise HTTPException(404, "Unknown span id")
    return RouteLoss(**result)
