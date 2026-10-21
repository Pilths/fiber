from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    BigInteger, Boolean, CheckConstraint, Date, DateTime, ForeignKey, Index,
    Integer, Numeric, Text, UniqueConstraint, func, text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import UserDefinedType


class Geometry(UserDefinedType):
    cache_ok = True

    def __init__(self, kind: str, srid: int = 4326):
        self.kind, self.srid = kind, srid

    def get_col_spec(self, **kw: Any) -> str:
        return f"geometry({self.kind},{self.srid})"


class Base(DeclarativeBase):
    pass


def _id() -> Mapped[int]:
    return mapped_column(BigInteger, primary_key=True, autoincrement=True)


def _fk(table: str, nullable: bool = False) -> Mapped[Any]:
    return mapped_column(BigInteger, ForeignKey(f"{table}.id"), nullable=nullable)


def _created() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now())


def _in(col: str, values: tuple[str, ...], name: str) -> CheckConstraint:
    return CheckConstraint(f"{col} IN ({', '.join(repr(v) for v in values)})", name=name)


def _pair_ix(name: str, unique: bool = False) -> Index:
    return Index(name, func.least(text("site_a_id"), text("site_b_id")),
                 func.greatest(text("site_a_id"), text("site_b_id")), unique=unique)


class User(Base):
    __tablename__ = "users"
    __table_args__ = (_in("role", ("planner", "admin"), "users_role_ck"),)
    id: Mapped[int] = _id()
    username: Mapped[str] = mapped_column(Text, unique=True)
    display_name: Mapped[str] = mapped_column(Text)
    role: Mapped[str] = mapped_column(Text)
    password_hash: Mapped[str | None] = mapped_column(Text)
    must_change_password: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    created_at: Mapped[datetime] = _created()


class Site(Base):
    __tablename__ = "sites"
    __table_args__ = (_in("kind", ("site", "building", "equipment", "data_center", "toc"), "sites_kind_ck"),)
    id: Mapped[int] = _id()
    name: Mapped[str] = mapped_column(Text, unique=True)
    kind: Mapped[str] = mapped_column(Text)
    geom: Mapped[Any] = mapped_column(Geometry("Point"), nullable=True)
    created_at: Mapped[datetime] = _created()


class Span(Base):
    __tablename__ = "spans"
    __table_args__ = (
        CheckConstraint("site_a_id <> site_b_id", name="spans_sites_differ_ck"),
        _in("route_type", ("Bespoke", "Trunk", "Metro"), "spans_route_type_ck"),
        _in("region", ("North", "Central", "South", "East Coast"), "spans_region_ck"),
        CheckConstraint("distance_km >= 0", name="spans_distance_ck"),
        _pair_ix("spans_site_pair_uq", unique=True),
    )
    id: Mapped[int] = _id()
    site_a_id: Mapped[int] = _fk("sites")
    site_b_id: Mapped[int] = _fk("sites")
    route_type: Mapped[str | None] = mapped_column(Text)
    region: Mapped[str | None] = mapped_column(Text)
    distance_km: Mapped[Decimal | None] = mapped_column(Numeric(10, 3))
    created_at: Mapped[datetime] = _created()


class Segment(Base):
    __tablename__ = "segments"
    __table_args__ = (
        CheckConstraint("site_a_id <> site_b_id", name="segments_sites_differ_ck"),
        _pair_ix("segments_site_pair_ix"),
    )
    id: Mapped[int] = _id()
    site_a_id: Mapped[int] = _fk("sites")
    site_b_id: Mapped[int] = _fk("sites")
    geom: Mapped[Any] = mapped_column(Geometry("LineString"), nullable=True)
    created_at: Mapped[datetime] = _created()


class SegmentSpan(Base):
    __tablename__ = "segment_spans"
    __table_args__ = (UniqueConstraint("segment_id", "position"),)
    segment_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("segments.id"), primary_key=True)
    span_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("spans.id"), primary_key=True)
    position: Mapped[int] = mapped_column(Integer)


class Port(Base):
    __tablename__ = "ports"
    id: Mapped[int] = _id()
    port_id: Mapped[str] = mapped_column(Text, unique=True)
    site_id: Mapped[int] = _fk("sites")


class Core(Base):
    __tablename__ = "cores"
    __table_args__ = (UniqueConstraint("span_id", "number"),)
    id: Mapped[int] = _id()
    span_id: Mapped[int] = _fk("spans")
    number: Mapped[int] = mapped_column(Integer)
    port_a_id: Mapped[int | None] = _fk("ports", True)
    port_b_id: Mapped[int | None] = _fk("ports", True)
    circuit_id: Mapped[str | None] = mapped_column(Text)
    in_use: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))


class Customer(Base):
    __tablename__ = "customers"
    __table_args__ = (Index("customers_name_lower_uq", func.lower(text("name")), unique=True),)
    id: Mapped[int] = _id()
    name: Mapped[str] = mapped_column(Text)
    created_by: Mapped[int | None] = _fk("users", True)
    created_at: Mapped[datetime] = _created()


class Reservation(Base):
    __tablename__ = "reservations"
    id: Mapped[int] = _id()
    customer_id: Mapped[int] = _fk("customers")
    planner_id: Mapped[int] = _fk("users")
    planned_date: Mapped[date | None] = mapped_column(Date)
    is_new_customer: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    imported: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    created_at: Mapped[datetime] = _created()


class ReservationCore(Base):
    __tablename__ = "reservation_cores"
    reservation_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("reservations.id"), primary_key=True)
    core_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("cores.id"), primary_key=True)


EVENT_TYPES = ("requested", "approved", "rejected", "withdrawn", "kept", "release_requested",
               "released", "release_declined", "corrected")


class ReservationEvent(Base):
    __tablename__ = "reservation_events"
    __table_args__ = (
        _in("type", EVENT_TYPES, "reservation_events_type_ck"),
        CheckConstraint("type = 'corrected' OR (customer_id IS NULL AND planned_date IS NULL)",
                        name="reservation_events_correction_ck"),
        CheckConstraint("type <> 'corrected' OR ((customer_id IS NOT NULL OR planned_date IS NOT NULL) "
                        "AND length(trim(coalesce(reason, ''))) > 0)",
                        name="reservation_events_corrected_ck"),
        Index("reservation_events_res_created_ix", "reservation_id", "created_at"),
    )
    id: Mapped[int] = _id()
    reservation_id: Mapped[int] = _fk("reservations")
    type: Mapped[str] = mapped_column(Text)
    user_id: Mapped[int] = _fk("users")
    reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = _created()
    customer_id: Mapped[int | None] = _fk("customers", True)
    planned_date: Mapped[date | None] = mapped_column(Date)


class ReleaseCore(Base):
    __tablename__ = "release_cores"
    event_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("reservation_events.id"), primary_key=True)
    core_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("cores.id"), primary_key=True)


class CoreHold(Base):
    __tablename__ = "core_holds"
    core_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("cores.id"), primary_key=True)
    reservation_id: Mapped[int] = _fk("reservations")


class Upload(Base):
    __tablename__ = "uploads"
    __table_args__ = (
        _in("kind", ("excel", "kmz"), "uploads_kind_ck"),
        _in("status", ("staged", "confirmed", "discarded"), "uploads_status_ck"),
    )
    id: Mapped[int] = _id()
    user_id: Mapped[int] = _fk("users")
    filename: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, server_default="staged")
    summary: Mapped[Any] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = _created()
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class UploadRow(Base):
    __tablename__ = "upload_rows"
    __table_args__ = (
        _in("row_group", ("new", "changed", "conflict", "missing", "rejected"), "upload_rows_group_ck"),
    )
    id: Mapped[int] = _id()
    upload_id: Mapped[int] = _fk("uploads")
    row_group: Mapped[str] = mapped_column(Text)
    entity: Mapped[str] = mapped_column(Text)
    payload: Mapped[Any] = mapped_column(JSONB)
    warnings: Mapped[Any] = mapped_column(JSONB, nullable=True)


class Measurement(Base):
    __tablename__ = "measurements"
    __table_args__ = (Index("measurements_span_created_ix", "span_id", "created_at"),)
    id: Mapped[int] = _id()
    span_id: Mapped[int] = _fk("spans")
    loss_db: Mapped[Decimal] = mapped_column(Numeric(8, 3))
    tested_on: Mapped[date | None] = mapped_column(Date)
    upload_id: Mapped[int | None] = _fk("uploads", True)
    created_at: Mapped[datetime] = _created()
    test_method: Mapped[str | None] = mapped_column(Text)
    field_team: Mapped[str | None] = mapped_column(Text)


class DataEdit(Base):
    __tablename__ = "data_edits"
    __table_args__ = (
        CheckConstraint("length(trim(reason)) > 0", name="data_edits_reason_ck"),
        Index("data_edits_entity_ix", "entity", "entity_id", "field", "created_at"),
    )
    id: Mapped[int] = _id()
    entity: Mapped[str] = mapped_column(Text)
    entity_id: Mapped[int] = mapped_column(BigInteger)
    field: Mapped[str] = mapped_column(Text)
    old_value: Mapped[str | None] = mapped_column(Text)
    new_value: Mapped[str | None] = mapped_column(Text)
    reason: Mapped[str] = mapped_column(Text)
    user_id: Mapped[int] = _fk("users")
    created_at: Mapped[datetime] = _created()


class JobRun(Base):
    __tablename__ = "job_runs"
    job_name: Mapped[str] = mapped_column(Text, primary_key=True)
    run_date: Mapped[date] = mapped_column(Date, primary_key=True)
    ran_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
