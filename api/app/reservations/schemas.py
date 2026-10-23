from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

Reason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
Status = Literal["pending", "rejected", "withdrawn", "approved", "ended"]


class ReservationCreate(BaseModel):
    customer_id: int
    planned_date: date | None = None
    cores: list[int] = Field(min_length=1)


class CoreIds(BaseModel):
    cores: list[int] = Field(default_factory=list)


class ReasonBody(BaseModel):
    reason: Reason


class CorrectBody(BaseModel):
    reason: Reason
    customer_id: int | None = None
    planned_date: date | None = None
    cores: list[int] | None = None  # always refused: cores are released and requested again


class ResCore(BaseModel):
    core_id: int
    number: int
    span_id: int
    span: str
    held: bool  # False once released


class ReservationOut(BaseModel):
    id: int
    customer_id: int
    customer: str
    planner_id: int
    planner: str
    planned_date: date | None
    status: Status
    last_event: str | None
    last_event_at: datetime | None
    last_reason: str | None  # rejection or declined-release reason
    awaiting: Literal["approval", "release"] | None  # what an admin has to decide
    age_days: int  # days since the last event (Asia/Kuala_Lumpur dates)
    stale: bool
    unassigned_cores: int  # count-only reservation: cores wanted, ports not assigned
    remaining_unassigned: int
    unassigned_span: str | None
    unassigned_span_id: int | None
    is_new_customer: bool
    imported: bool
    cores: list[ResCore]
    release_requested_cores: list[int]


class NeedsReviewItem(BaseModel):
    kind: Literal["stale", "release_requested", "faulty_held"]
    detail: str
    reservation: ReservationOut


class Bell(BaseModel):
    approvals: int
    needs_review: int
    total: int  # distinct reservations in either list
