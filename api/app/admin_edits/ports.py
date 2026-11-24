"""Core ports (typed by hand; the reservation upload does not import ports) and paste ports per segment."""
from collections import Counter
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.errors import NotFound, Conflict, Invalid
from app.admin_edits.history import log_edits
from app.auth.deps import DB, Admin, CurrentUser
from app.ingest.reservation_import import port
from app.inventory import service as inventory
from app.inventory.schemas import CoreHolderDetail
from app.port_label import LABEL_HELP, normalize_port_label
from app.reservations.schemas import Remarks

router = APIRouter()

CORE_PORTS_SQL = """
SELECT c.segment_id, c.port_a_id, c.port_b_id, s.site_a_id, s.site_b_id
FROM cores c JOIN segments s ON s.id = c.segment_id WHERE c.id = :core_id
"""
PORT_SITE_SQL = """
SELECT p.site_id, a.name AS name_a, b.name AS name_b
FROM ports p, cores c
JOIN segments s ON s.id = c.segment_id
JOIN sites a ON a.id = s.site_a_id
JOIN sites b ON b.id = s.site_b_id
WHERE p.id = :port_row_id AND c.id = :core_id
"""
LOCK_SEGMENT_SQL = "SELECT id FROM segments WHERE id = :segment_id FOR UPDATE"
PORT_LABEL_SQL = "SELECT port_id FROM ports WHERE id = :port_row_id"
PASTE_SEGMENT_SQL = """
SELECT s.site_a_id, s.site_b_id, s.survey_cores, a.name || ' - ' || b.name AS name
FROM segments s JOIN sites a ON a.id = s.site_a_id JOIN sites b ON b.id = s.site_b_id
WHERE s.id = :segment_id
"""
PASTE_CORES_SQL = """
SELECT c.id, c.number, pa.port_id AS port_a, pb.port_id AS port_b
FROM cores c
LEFT JOIN ports pa ON pa.id = c.port_a_id
LEFT JOIN ports pb ON pb.id = c.port_b_id
WHERE c.segment_id = :segment_id
"""
PORT_OWNERS_SQL = """
SELECT p.port_id AS label, c.id AS core_id, c.number, c.segment_id, a.name || ' - ' || b.name AS segment
FROM ports p
JOIN cores c ON p.id IN (c.port_a_id, c.port_b_id)
JOIN segments s ON s.id = c.segment_id
JOIN sites a ON a.id = s.site_a_id
JOIN sites b ON b.id = s.site_b_id
WHERE p.site_id = :site_id AND p.port_id = ANY(CAST(:labels AS text[]))
"""
SET_CORE_PORT_SQL = {
    "port_a": "UPDATE cores SET port_a_id = :port_row_id WHERE id = :core_id",
    "port_b": "UPDATE cores SET port_b_id = :port_row_id WHERE id = :core_id",
}


# ---------- core ports (typed by hand; the reservation upload does not import ports) ----------

PORT_ENDS = ("port_a", "port_b")

class CorePortsBody(BaseModel):
    # Label at the segment's first site; null or empty clears it; not sent = untouched.
    port_a: str | None = None
    # Label at the segment's second site.
    port_b: str | None = None
    remarks: Remarks = ""


def _port_label(db: Session, port_row_id: int | None) -> str | None:
    if not port_row_id:
        return None
    return db.execute(text(PORT_LABEL_SQL), {"port_row_id": port_row_id}).scalar_one_or_none()


def _port_for_site(db: Session, label: str, site_id: int) -> int:
    """The port row for a label at this site, made if new; the same label may exist at other sites."""
    return port(db, {}, label, site_id)


def _canonical_label(typed: str | None) -> str | None:
    """Empty means clear; anything else must be an FDF or ODF port, saved in canonical form."""
    text_value = (typed or "").strip()
    if not text_value:
        return None
    label = normalize_port_label(text_value)
    if label is None:
        raise Invalid(f"{text_value} is not a port label. {LABEL_HELP}")
    return label


def _refuse_port_outside_segment(db: Session, port_row_id: int, label: str, core_id: int, site_id: int) -> None:
    """A core's A port is at the segment's site A and its B port at site B; any other site is refused."""
    port_site_id, name_a, name_b = db.execute(
        text(PORT_SITE_SQL), {"port_row_id": port_row_id, "core_id": core_id}
    ).one()
    if port_site_id != site_id:
        raise Invalid(f"Port {label} is not at {name_a} or {name_b}")


def _refuse_label_on_other_core(db: Session, label: str, site_id: int, core_id: int) -> None:
    """A port label is one physical port per site, so only one core may hold it."""
    owners = _owners_by_label(db, site_id, [label]).get(label, [])
    for owner in owners:
        if owner["core_id"] != core_id:
            raise Conflict(f"{label} is on core {owner['number']} of {owner['segment']}")


def _write_core_ports(
    db: Session, user: CurrentUser, core_id: int, wanted: dict[str, str | None], remarks: str,
    check_owners: bool = True,
) -> bool:
    """Set the wanted labels on one core (field name -> label, empty or None clears) and log each change.

    The paste preview has already checked the owners (a label may move between cores in one paste),
    so it passes check_owners=False. Does not commit; returns whether anything changed.
    """
    segment_id, current_a, current_b, site_a, site_b = db.execute(
        text(CORE_PORTS_SQL), {"core_id": core_id}
    ).one()
    current = {"port_a": (current_a, site_a), "port_b": (current_b, site_b)}
    edits: list[tuple[str, Any, Any]] = []
    new_port_ids: dict[str, int | None] = {}
    for field_name, typed in wanted.items():
        current_row_id, site_id = current[field_name]
        label = _canonical_label(typed)
        old = _port_label(db, current_row_id)
        if label == old:
            continue
        if label is None:
            new_port_ids[field_name] = None
        else:
            if check_owners:
                _refuse_label_on_other_core(db, label, site_id, core_id)
            port_row_id = _port_for_site(db, label, site_id)
            _refuse_port_outside_segment(db, port_row_id, label, core_id, site_id)
            new_port_ids[field_name] = port_row_id
        edits.append((field_name, old, label))
    for field_name, port_row_id in new_port_ids.items():
        db.execute(text(SET_CORE_PORT_SQL[field_name]), {"port_row_id": port_row_id, "core_id": core_id})
    if edits:
        log_edits(db, user, "core", core_id, edits, remarks)
    return bool(edits)


@router.post("/cores/{core_id}/ports")
def set_core_ports(db: DB, admin: Admin, core_id: int, body: CorePortsBody) -> CoreHolderDetail:
    found = db.execute(text(CORE_PORTS_SQL), {"core_id": core_id}).first()
    if found is None:
        raise NotFound("Core not found")
    db.execute(text(LOCK_SEGMENT_SQL), {"segment_id": found[0]})
    wanted = {end: getattr(body, end) for end in PORT_ENDS if end in body.model_fields_set}
    if _write_core_ports(db, admin, core_id, wanted, body.remarks):
        db.commit()
    core = inventory.get_core(db, core_id, admin)
    if core is None:
        raise NotFound("Core not found")
    return core


# ---------- paste ports for a whole segment (preview first, then apply) ----------

MAX_PASTED_LINES = 2000
SITE_OF_END = {"port_a": "site_a_id", "port_b": "site_b_id"}


class PastePortsBody(BaseModel):
    start_core: int = Field(1, ge=1)
    port_a: list[str] | None = Field(None, max_length=MAX_PASTED_LINES)  # null leaves end A untouched
    port_b: list[str] | None = Field(None, max_length=MAX_PASTED_LINES)
    apply: bool = False  # false = preview only, nothing is written

    @model_validator(mode="after")
    def need_one_list(self) -> "PastePortsBody":
        if self.port_a is None and self.port_b is None:
            raise ValueError("Paste at least one of port_a and port_b")
        return self


class PastePortRow(BaseModel):
    core_number: int
    port_a_old: str | None
    port_a_new: str | None
    port_b_old: str | None
    port_b_new: str | None
    status: Literal["new", "replaces", "unchanged", "problem"]
    problem: str | None = None


class PastePortCounts(BaseModel):
    new: int = 0
    replaces: int = 0
    unchanged: int = 0
    problem: int = 0


class PastePortsResult(BaseModel):
    rows: list[PastePortRow]
    counts: PastePortCounts
    applied: bool


def _pasted_labels(lines: list[str] | None, start_core: int) -> dict[int, str]:
    """Core number -> label for the non-empty lines; an empty line skips that core."""
    labels: dict[int, str] = {}
    for index, line in enumerate(lines or []):
        label = line.strip()
        if label:
            labels[start_core + index] = normalize_port_label(label) or label
    return labels


def _owners_by_label(db: Session, site_id: int, labels: list[str]) -> dict[str, list[Any]]:
    owners: dict[str, list[Any]] = {}
    if not labels:
        return owners
    rows = db.execute(text(PORT_OWNERS_SQL), {"site_id": site_id, "labels": labels}).mappings()
    for row in rows:
        owners.setdefault(row["label"], []).append(row)
    return owners


def _label_problem(
    label: str, core_id: int, segment_id: int,
    pasted: dict[int, str], repeats: Counter[str], owners: dict[str, list[Any]],
    unapplied: set[int],
) -> str | None:
    if normalize_port_label(label) is None:
        return f"{label} is not a port label. {LABEL_HELP}"
    if repeats[label] > 1:
        return f"{label} is pasted more than once for this end"
    for owner in owners.get(label, []):
        if owner["core_id"] == core_id:
            continue
        pasted_for_owner = pasted.get(owner["number"])
        owner_gets_other_label = owner["segment_id"] == segment_id and pasted_for_owner not in (None, label)
        # A problem row is never applied, so its owner keeps the label.
        moving_away = owner_gets_other_label and owner["number"] not in unapplied
        if not moving_away:
            return f"{label} is on core {owner['number']} of {owner['segment']}"
    return None


def _paste_problems(
    db: Session, segment_id: int, segment: Any, cores: dict[int, Any], numbers: list[int],
    pasted_by_end: dict[str, dict[int, str]],
) -> dict[int, str]:
    """Core number -> first problem found; those rows are never applied."""
    problems: dict[int, str] = {}
    for number in numbers:
        if segment["survey_cores"] is None:
            problems[number] = "Core verification count not set for this segment"
        elif number > segment["survey_cores"]:
            problems[number] = f"Core {number} is above the verified cores ({segment['survey_cores']})"
        elif number not in cores:
            problems[number] = f"Core {number} does not exist"
    repeats_by_end = {end: Counter(pasted_by_end[end].values()) for end in PORT_ENDS}
    owners_by_end = {
        end: _owners_by_label(db, segment[SITE_OF_END[end]], list(repeats_by_end[end]))
        for end in PORT_ENDS
    }
    # A new problem row can stop a label from moving off its owner, which can make another
    # row a problem. Repeat until a pass finds nothing new.
    found_new = True
    while found_new:
        found_new = False
        for end in PORT_ENDS:
            for number, label in pasted_by_end[end].items():
                if number in problems:
                    continue
                found = _label_problem(
                    label, cores[number]["id"], segment_id, pasted_by_end[end],
                    repeats_by_end[end], owners_by_end[end], set(problems),
                )
                if found:
                    problems[number] = found
                    found_new = True
    return problems


def _paste_row(
    number: int, core: Any, pasted_by_end: dict[str, dict[int, str]], problem: str | None
) -> PastePortRow:
    old = {end: (core[end] if core else None) for end in PORT_ENDS}
    new = {end: pasted_by_end[end].get(number, old[end]) for end in PORT_ENDS}
    changed = [end for end in PORT_ENDS if new[end] != old[end]]
    if problem:
        status = "problem"
    elif not changed:
        status = "unchanged"
    elif any(old[end] is not None for end in changed):
        status = "replaces"
    else:
        status = "new"
    return PastePortRow(
        core_number=number,
        port_a_old=old["port_a"], port_a_new=new["port_a"],
        port_b_old=old["port_b"], port_b_new=new["port_b"],
        status=status, problem=problem,
    )


def _paste_preview(
    db: Session, segment_id: int, body: PastePortsBody
) -> tuple[PastePortsResult, dict[int, int]]:
    """Rows and counts for the paste, plus core number -> core id for applying."""
    segment = db.execute(text(PASTE_SEGMENT_SQL), {"segment_id": segment_id}).mappings().first()
    if segment is None:
        raise NotFound("Segment not found")
    core_rows = db.execute(text(PASTE_CORES_SQL), {"segment_id": segment_id}).mappings()
    cores = {row["number"]: row for row in core_rows}
    pasted_by_end = {
        "port_a": _pasted_labels(body.port_a, body.start_core),
        "port_b": _pasted_labels(body.port_b, body.start_core),
    }
    numbers = sorted(set(pasted_by_end["port_a"]) | set(pasted_by_end["port_b"]))
    problems = _paste_problems(db, segment_id, segment, cores, numbers, pasted_by_end)
    rows = [_paste_row(number, cores.get(number), pasted_by_end, problems.get(number)) for number in numbers]
    counts = PastePortCounts()
    for row in rows:
        setattr(counts, row.status, getattr(counts, row.status) + 1)
    core_ids = {number: core["id"] for number, core in cores.items()}
    return PastePortsResult(rows=rows, counts=counts, applied=False), core_ids


def _apply_paste(db: Session, admin: Admin, result: PastePortsResult, core_ids: dict[int, int]) -> None:
    for row in result.rows:
        if row.status not in ("new", "replaces"):
            continue
        wanted: dict[str, str | None] = {}
        if row.port_a_new != row.port_a_old:
            wanted["port_a"] = row.port_a_new
        if row.port_b_new != row.port_b_old:
            wanted["port_b"] = row.port_b_new
        _write_core_ports(db, admin, core_ids[row.core_number], wanted, "", check_owners=False)


@router.post("/segments/{segment_id}/ports")
def paste_segment_ports(db: DB, admin: Admin, segment_id: int, body: PastePortsBody) -> PastePortsResult:
    if body.apply:
        db.execute(text(LOCK_SEGMENT_SQL), {"segment_id": segment_id})
    result, core_ids = _paste_preview(db, segment_id, body)
    if not body.apply:
        return result
    _apply_paste(db, admin, result, core_ids)
    db.commit()
    result.applied = True
    return result
