from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.db import get_db
from app.loss import service
from app.loss.schemas import Coverage, RouteLoss, SegmentLoss, SegmentLossDetail

router = APIRouter(prefix="/api/loss", dependencies=[Depends(get_current_user)])
DB = Annotated[Session, Depends(get_db)]


@router.get("/segments")
def segments(db: DB, segment_id: int | None = None, region: str | None = None,
          route_type: str | None = None) -> list[SegmentLoss]:
    return [SegmentLoss(**r) for r in service.segment_rows(db, segment_id, region, route_type)]


@router.get("/segments/{segment_id}")
def segment(db: DB, segment_id: int) -> SegmentLossDetail:
    rows = service.segment_rows(db, segment_id)
    if not rows:
        raise HTTPException(404, "Segment not found")
    return SegmentLossDetail(**rows[0], history=service.history(db, segment_id),
                          cores=service.core_losses(db, segment_id, rows[0]["calculated_db"]))


@router.get("/coverage")
def coverage(db: DB) -> Coverage:
    return Coverage(**service.coverage(db))


@router.get("/route")
def route(db: DB, segment_ids: Annotated[str, Query(description="Comma-separated segment ids, in route order")]) -> RouteLoss:
    try:
        ids = [int(x) for x in segment_ids.split(",") if x.strip()]
    except ValueError:
        raise HTTPException(422, "segment_ids must be comma-separated integers") from None
    result = service.route(db, ids)
    if result is None:
        raise HTTPException(404, "Unknown segment id")
    return RouteLoss(**result)
