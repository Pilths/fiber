from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, PlainSerializer

from app.loss.service import Level

# Rounding only here, at the API boundary: dB to 2 decimals, percent to 1.
Db = Annotated[Decimal, PlainSerializer(lambda v: round(float(v), 2), return_type=float, when_used="json")]
Pct = Annotated[Decimal, PlainSerializer(lambda v: round(float(v), 1), return_type=float, when_used="json")]


class SegmentLoss(BaseModel):
    segment_id: int
    segment_name: str
    region: str | None
    route_type: str | None
    distance_km: Decimal | None
    calculated_db: Db | None
    measured_db: Db | None
    difference_db: Db | None
    deviation_pct: Pct | None
    level: Level | None
    last_test_date: date | None
    test_method: str | None
    field_team: str | None
    worst_core_number: int | None = None
    measured_cores: int = 0
    total_cores: int = 0
    status: Literal["measured", "calculated_only", "no_distance"]


class MeasurementOut(BaseModel):
    loss_db: Db
    tested_on: date | None
    created_at: datetime
    test_method: str | None
    field_team: str | None
    core_number: int | None = None


class CoreLoss(BaseModel):
    core_id: int
    core_number: int
    calculated_db: Db | None
    measured_db: Db
    difference_db: Db | None
    deviation_pct: Pct | None
    level: Level | None
    tested_on: date | None
    test_method: str | None
    field_team: str | None
    history: list[MeasurementOut]


class SegmentLossDetail(SegmentLoss):
    history: list[MeasurementOut]
    cores: list[CoreLoss]


class Count(BaseModel):
    measured: int
    total: int


class RouteCount(Count):
    route_id: int
    name: str


class Coverage(Count):
    by_region: dict[str, Count]
    routes: list[RouteCount]


class RouteLoss(BaseModel):
    segments: list[SegmentLoss]
    total_calculated_db: Db | None
    total_measured_db: Db | None
    level: Level | None
