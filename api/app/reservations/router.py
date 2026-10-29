from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.deps import CurrentUser, get_current_user, require_admin
from app.db import get_db
from app.reservations import service
from app.reservations.schemas import (
    Bell,
    CoreIds,
    CorrectBody,
    NeedsReviewItem,
    ReasonBody,
    ReservationCreate,
    ReservationOut,
    Status,
)

router = APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])
DB = Annotated[Session, Depends(get_db)]
User = Annotated[CurrentUser, Depends(get_current_user)]
Admin = Annotated[CurrentUser, Depends(require_admin)]


@router.post("/reservations")
def create_reservation(db: DB, user: User, body: ReservationCreate) -> ReservationOut:
    return service.create(db, user, body.customer_id, body.planned_date, body.cores, body.srf_id)


@router.get("/reservations")
def list_reservations(db: DB, user: User, mine: bool = False, status: Status | None = None) -> list[ReservationOut]:
    return service.list_reservations(db, user, mine, status)


@router.get("/approvals")
def approvals(db: DB, admin: Admin) -> list[ReservationOut]:
    return service.approvals(db)


@router.get("/needs-review")
def needs_review(db: DB, user: User) -> list[NeedsReviewItem]:
    return service.needs_review(db, user)


@router.get("/bell")
def bell(db: DB, user: User) -> Bell:
    waiting = service.approvals(db) if user.role == "admin" else []
    review = service.needs_review(db, user)
    return Bell(approvals=len(waiting), needs_review=len(review),
                total=len({r.id for r in waiting} | {i.reservation.id for i in review}))


# planner actions (own reservation; admins may act too)
@router.post("/reservations/{rid}/withdraw")
def withdraw(db: DB, user: User, rid: int) -> ReservationOut:
    return service.withdraw(db, user, rid)


@router.post("/reservations/{rid}/keep")
def keep(db: DB, user: User, rid: int) -> ReservationOut:
    return service.keep(db, user, rid)


@router.post("/reservations/{rid}/request-release")
def request_release(db: DB, user: User, rid: int, body: CoreIds) -> ReservationOut:
    return service.request_release(db, user, rid, body.cores)


# admin actions
@router.post("/reservations/{rid}/approve")
def approve(db: DB, admin: Admin, rid: int) -> ReservationOut:
    return service.approve(db, admin, rid)


@router.post("/reservations/{rid}/reject")
def reject(db: DB, admin: Admin, rid: int, body: ReasonBody) -> ReservationOut:
    return service.reject(db, admin, rid, body.reason)


@router.post("/reservations/{rid}/release")
def release(db: DB, admin: Admin, rid: int, body: CoreIds) -> ReservationOut:
    return service.release(db, admin, rid, body.cores)


@router.post("/reservations/{rid}/decline-release")
def decline_release(db: DB, admin: Admin, rid: int, body: ReasonBody) -> ReservationOut:
    return service.decline_release(db, admin, rid, body.reason)


@router.post("/reservations/{rid}/correct")
def correct(db: DB, admin: Admin, rid: int, body: CorrectBody) -> ReservationOut:
    return service.correct(db, admin, rid, body.reason, body.customer_id, body.planned_date, body.cores)


@router.post("/reservations/{rid}/assign")
def assign(db: DB, admin: Admin, rid: int, body: CoreIds) -> ReservationOut:
    return service.assign(db, admin, rid, body.cores)
