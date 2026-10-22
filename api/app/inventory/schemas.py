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
    free_cores: int
    status_mix: dict[str, int]


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


class CustomerStub(BaseModel):
    """STUB response: nothing is inserted yet (real endpoint is TASK-029)."""
    name: str
    similar: list[Customer]
    created: bool = False
