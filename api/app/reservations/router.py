from datetime import date

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth.deps import get_current_user

router = APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])


class ReservationCreate(BaseModel):
    customer_id: int
    planned_date: date | None = None
    cores: list[int]


class ReservationStub(BaseModel):
    id: int
    status: str


@router.post("/reservations")
def create_reservation(body: ReservationCreate) -> ReservationStub:
    """STUB (real one is TASK-028): stores nothing."""
    return ReservationStub(id=0, status="stub")
