"""Measured loss, typed by hand (each test is its own history row)."""
from datetime import date
from decimal import Decimal

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.errors import NotFound, Invalid, ServiceError
from app.auth.deps import DB, Admin
from app.loss import service as loss_service
from app.loss.schemas import CoreLoss
from app.reservations.service import conflict

router = APIRouter()

CORE_SURVEY_SQL = """
SELECT c.segment_id, c.number, s.survey_cores, s.distance_km
FROM cores c JOIN segments s ON s.id = c.segment_id
WHERE c.id = :core_id
"""
TODAY_KL_SQL = "SELECT (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date"
INSERT_MEASUREMENT_SQL = """
INSERT INTO measurements (segment_id, core_id, loss_db, tested_on, test_method, field_team, created_by)
VALUES (:segment_id, :core_id, :loss_db, :tested_on, :test_method, :field_team, :created_by)
"""


def _trimmed_or_none(value: str | None) -> str | None:
    if value is None:
        return None
    return value.strip() or None


class MeasurementBody(BaseModel):
    loss_db: Decimal = Field(gt=0, le=100)
    tested_on: date
    test_method: str | None = None
    field_team: str | None = None


@router.post("/cores/{core_id}/measurements")
def add_core_measurement(db: DB, admin: Admin, core_id: int, body: MeasurementBody) -> CoreLoss:
    found = db.execute(text(CORE_SURVEY_SQL), {"core_id": core_id}).first()
    if found is None:
        raise NotFound("Core not found")
    segment_id, number, survey_cores, distance_km = found
    # Same rule as inventory: cores above the surveyed count are hidden. A segment with no count yet
    # still shows all its cores in inventory, so it is not refused here.
    if survey_cores is not None and number > survey_cores:
        raise conflict("This core is above the verified cores of the segment")
    if body.tested_on > db.execute(text(TODAY_KL_SQL)).scalar_one():
        raise Invalid("Test date cannot be in the future")
    db.execute(text(INSERT_MEASUREMENT_SQL), {
        "segment_id": segment_id,
        "core_id": core_id,
        "loss_db": body.loss_db,
        "tested_on": body.tested_on,
        "test_method": _trimmed_or_none(body.test_method),
        "field_team": _trimmed_or_none(body.field_team),
        "created_by": admin.id,
    })
    db.commit()
    calculated = loss_service.calculated_loss_db(distance_km)
    for entry in loss_service.core_losses(db, segment_id, calculated):
        if entry["core_id"] == core_id:
            return CoreLoss(**entry)
    raise ServiceError(500, "Measurement was not saved")
