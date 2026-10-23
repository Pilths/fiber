from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel

CoreStatus = Literal["Available", "Requested", "Reserved", "In use", "Faulty"]


class SearchResult(BaseModel):
    type: Literal["customer", "span", "circuit", "core"]
    label: str
    span_id: int | None = None
    core_id: int | None = None


class SpanSummary(BaseModel):
    id: int
    site_a: str
    site_b: str
    route_type: str | None
    region: str | None
    distance_km: Decimal | None
    free_cores: int  # Available cores
    status_mix: dict[str, int]
    survey_cores: int | None  # cores found at the onsite survey; None = not surveyed (no cells, not bookable)
    cable_size: int
    not_surveyed: int | None  # cable_size - survey_cores
    unassigned_reserved: int  # cores reserved by count only, ports not assigned yet
    free_to_reserve: int  # free_cores - unassigned_reserved (0 when not surveyed)


class CoreDetail(BaseModel):
    id: int
    number: int
    status: CoreStatus
    customer: str | None
    circuit_id: str | None
    planned_date: date | None
    port_a: str | None
    port_b: str | None


class SpanDetail(SpanSummary):
    cores: list[CoreDetail]


class Customer(BaseModel):
    id: int
    name: str


class CustomerCreate(BaseModel):
    name: str
    confirm_new: bool = False


class CustomerResult(BaseModel):
    """created=False with similar names means: resend with confirm_new=true to create it anyway."""
    created: bool
    customer: Customer | None
    similar: list[Customer]
