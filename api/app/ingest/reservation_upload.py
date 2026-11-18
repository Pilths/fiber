"""Reservation workbook upload: stage every row raw, group it against the database, apply in one transaction.

Staging writes only `uploads` and `upload_rows`. Confirm re-runs `evaluate` on the staged rows against the current
database (switch, held cores, existing reservations), so a stale preview cannot import something that is no
longer valid.
Reservations are insert-only: nothing here updates or deletes one.

Not built (parked or not in this workbook): reservation clash labels (New/Same/Differs/Clash), the "modify" proposal,
chained routes with more than one path (this workbook carries no routes), segment route type (no column in it).
"""
import json
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.admin_edits.history import log_edits_for_user
from app.ingest.excel import RowResult
from app.ingest.reservation_import import (
    Skip,
    add_cores,
    ensure_segment,
    find_segment,
    place_reservation,
)
from app.ingest.site_master import load_protected
from app.ingest.uploads import ApplyError, finish_upload, insert_upload, lock_staged_upload
from app.inventory import service as inventory
from app.reservations.service import lock_segments
from app.routing.graph import invalidate as invalidate_routes

REASON = "reservation upload"
SEGMENT_FIELDS = ("region", "distance_km", "survey_cores")
GROUPS = (
    "new", "changed", "unchanged", "missing", "reservations", "conflicts", "already_imported", "ignored",
    "needs_review", "rejected",
)
ROW_GROUP = {
    "new": "new",
    "changed": "changed",
    "missing": "missing",
    "unchanged": "unchanged",
    "reservations": "new",
    "conflicts": "conflict",
    "already_imported": "unchanged",
    "ignored": "unchanged",
    "needs_review": "needs_review",
    "rejected": "rejected",
}
SEGMENT_GROUPS = ("new", "changed", "unchanged", "missing")
RESERVATION_ENTITY_GROUPS = ("reservations", "conflicts", "already_imported", "ignored")

SELECT_IMPORT_CLOSED = """
    SELECT d.created_at, d.reason, u.username
    FROM data_edits d
    JOIN users u ON u.id = d.user_id
    WHERE d.entity = 'system'
      AND d.entity_id = 0
      AND d.field = 'reservation_import'
      AND d.new_value = 'closed'
    ORDER BY d.id
    LIMIT 1
"""
LOCK_IMPORT_SWITCH = "SELECT pg_advisory_xact_lock(7001)"
SELECT_SEGMENT_FOR_COMPARE = """
    SELECT region, distance_km, survey_cores,
           (SELECT count(*) FROM cores c
            WHERE c.segment_id = :segment_id
              AND (segments.survey_cores IS NULL OR c.number <= segments.survey_cores)) AS n_cores
    FROM segments
    WHERE id = :segment_id
"""
SELECT_SAME_MEASUREMENT = """
    SELECT 1 FROM measurements
    WHERE segment_id = :segment_id
      AND loss_db = :loss_db
      AND tested_on IS NOT DISTINCT FROM CAST(:tested_on AS date)
"""
SELECT_SAME_RESERVATIONS = """
    SELECT r.id,
           lower(cu.name) = lower(:customer) AS same_customer,
           r.planned_date IS NOT DISTINCT FROM CAST(:planned_date AS date) AS same_date,
           r.group_label IS NOT DISTINCT FROM CAST(:group_label AS text) AS same_label,
           coalesce(r.additional, false) = :additional AS same_additional
    FROM reservations r
    JOIN customers cu ON cu.id = r.customer_id
    WHERE """
SELECT_SITE_IDS_BY_NAME = "SELECT name, id FROM sites WHERE name = ANY(CAST(:names AS text[]))"
SELECT_ALL_SEGMENT_KEYS = """
    SELECT s.id,
           CASE WHEN a.name COLLATE "C" < b.name COLLATE "C"
                THEN a.name || '-' || b.name
                ELSE b.name || '-' || a.name
           END
    FROM segments s
    JOIN sites a ON a.id = s.site_a_id
    JOIN sites b ON b.id = s.site_b_id
    ORDER BY s.id
"""
INSERT_UPLOAD_ROWS = """
    INSERT INTO upload_rows (upload_id, row_group, entity, payload, warnings, sheet, row_number, status, reason, raw)
    VALUES (:upload_id, :row_group, :entity, CAST(:payload AS jsonb), CAST(:warnings AS jsonb), :sheet, :row_number,
            :status, :reason, CAST(:raw AS jsonb))
"""
SELECT_STAGED_ROWS = """
    SELECT id, row_number, sheet, raw, payload
    FROM upload_rows
    WHERE upload_id = :upload_id AND entity <> 'segment'
    ORDER BY row_number
"""
SELECT_STAGED_SEGMENT_KEYS = """
    SELECT id, payload->>'key'
    FROM upload_rows
    WHERE upload_id = :upload_id AND entity = 'segment' AND row_group <> 'missing'
"""
INSERT_MEASUREMENT = """
    INSERT INTO measurements (segment_id, loss_db, tested_on, upload_id)
    VALUES (:segment_id, :loss_db, :tested_on, :upload_id)
"""



COUNT_KEYS = (
    "segments", "cores", "ports", "customers", "reservations", "segment_updates", "measurements",
)


def update_segment_field_sql(field_name: str) -> str:
    # field_name comes from SEGMENT_FIELDS only, never from the file.
    return f"UPDATE segments SET {field_name} = :value WHERE id = :segment_id"


# ---- the one-time switch --------------------------------------------------------------------------------------

def import_state(db: Session) -> dict[str, Any]:
    row = db.execute(text(SELECT_IMPORT_CLOSED)).first()
    if row is None:
        return {"closed": False, "closed_at": None, "closed_by": None, "reason": None}
    return {"closed": True, "closed_at": row[0], "closed_by": row[2], "reason": row[1]}


def close_import(db: Session, admin_id: int, reason: str) -> dict[str, Any]:
    if not (reason or "").strip():
        raise ApplyError(422, "A reason is required")
    # Two simultaneous closes: the second sees the first.
    db.execute(text(LOCK_IMPORT_SWITCH))
    if import_state(db)["closed"]:
        raise ApplyError(409, "Reservation import is already closed")
    log_edits_for_user(db, admin_id, "system", 0, [("reservation_import", "open", "closed")], reason.strip())
    db.commit()
    return import_state(db)


# ---- evaluate -------------------------------------------------------------------------------------------------

@dataclass
class Row:
    row_number: int
    sheet: str
    raw: dict[str, Any]
    parsed: dict[str, Any]
    parse_status: str
    parse_reason: str | None
    id: int | None = None
    status: str = "ready"
    reason: str | None = None
    group: str = ""
    warnings: list[str] = field(default_factory=list)
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class SegmentItem:
    key: str
    site_a: str
    site_b: str
    rows: list[int]
    values: dict[str, Any]
    segment_id: int | None = None
    group: str = "unchanged"
    changes: list[dict[str, Any]] = field(default_factory=list)
    measurements: list[dict[str, Any]] = field(default_factory=list)
    verified_cores: int | None = None  # verified cores after this upload is applied
    db_verified_cores: int | None = None
    db_free: int = 0
    warnings: list[str] = field(default_factory=list)
    used: int = 0


@dataclass
class Eval:
    rows: list[Row]
    segments: dict[str, SegmentItem]
    missing: list[dict[str, Any]]
    warnings: list[dict[str, Any]]
    closed: bool

    def counts(self) -> dict[str, int]:
        counts = dict.fromkeys(GROUPS, 0)
        for row in self.rows:
            counts[row.group] += 1
        for item in self.segments.values():
            counts[item.group] += 1
        counts["missing"] = len(self.missing)
        return counts


def from_results(results: list[RowResult]) -> list[Row]:
    return [
        Row(result.row_number, result.sheet, result.raw, result.parsed, result.status, result.reason)
        for result in results
    ]


def _num_same(first: Any, second: Any) -> bool:
    if first == second:
        return True
    if first is None or second is None:
        return False
    if not isinstance(first, str) and round(float(first), 3) == round(float(second), 3):
        return True
    return str(first) == str(second)


def _add_row_to_segment_item(row: Row, item: SegmentItem) -> None:
    item.rows.append(row.row_number)
    for field_name in SEGMENT_FIELDS:
        value = row.parsed.get(field_name)
        if value is None:
            continue
        if field_name not in item.values:
            item.values[field_name] = value
        elif not _num_same(item.values[field_name], value):
            item.warnings.append(
                f"rows disagree on {field_name}: {item.values[field_name]} vs {value} "
                f"(row {row.row_number}); the first is used"
            )
    if row.parsed.get("loss_db") is None:
        return
    measurement = {
        "loss_db": row.parsed["loss_db"],
        "tested_on": row.parsed.get("tested_on"),
        "row_number": row.row_number,
    }
    already_listed = any(
        _num_same(other["loss_db"], measurement["loss_db"]) and other["tested_on"] == measurement["tested_on"]
        for other in item.measurements
    )
    if not already_listed:
        item.measurements.append(measurement)


def _compare_with_database(
    db: Session,
    item: SegmentItem,
    segment_id: int,
    protected: dict[int, set[str]],
    wins: set[tuple[str, str]],
) -> None:
    old = db.execute(text(SELECT_SEGMENT_FOR_COMPARE), {"segment_id": segment_id}).mappings().one()
    item.db_verified_cores = old["survey_cores"]
    item.verified_cores = old["survey_cores"]
    item.db_free = inventory.list_segments(db, None, None, None, segment_id)[0]["free_to_reserve"]
    for field_name in SEGMENT_FIELDS:
        new = item.values.get(field_name)
        if new is None or _num_same(old[field_name], new):
            continue
        is_protected = field_name in protected.get(segment_id, set())
        if old[field_name] is None:
            old_value = None
        elif field_name == "distance_km":
            old_value = float(old[field_name])
        else:
            old_value = old[field_name]
        change: dict[str, Any] = {"field": field_name, "old": old_value, "new": new, "protected": is_protected}
        if is_protected:
            change["note"] = "edited in dashboard, file differs"
        if field_name == "survey_cores" and new < old["n_cores"]:
            change["blocked"] = f"cannot lower below the {old['n_cores']} cores that already exist"
        change["applied"] = "blocked" not in change and (not is_protected or (item.key, field_name) in wins)
        if change["applied"] and field_name == "survey_cores":
            item.verified_cores = new
        item.changes.append(change)
    for measurement in list(item.measurements):
        params = {
            "segment_id": segment_id,
            "loss_db": measurement["loss_db"],
            "tested_on": measurement["tested_on"],
        }
        if db.execute(text(SELECT_SAME_MEASUREMENT), params).first():
            item.measurements.remove(measurement)


def _segment_items(
    db: Session,
    rows: list[Row],
    sites: dict[str, int],
    wins: set[tuple[str, str]],
) -> dict[str, SegmentItem]:
    segments: dict[str, SegmentItem] = {}
    for row in rows:
        if row.group:
            continue
        key = "-".join(sorted((row.parsed["site_a"], row.parsed["site_b"])))
        new_item = SegmentItem(key, row.parsed["site_a"], row.parsed["site_b"], [], {})
        item = segments.setdefault(key, new_item)
        row.extra["segment_key"] = key
        _add_row_to_segment_item(row, item)
    protected = load_protected(db, "segment", (REASON,))
    for item in segments.values():
        found = find_segment(db, sites[item.site_a], sites[item.site_b])
        if found is None:
            item.segment_id = None
            item.group = "new"
            item.verified_cores = item.values.get("survey_cores")
            continue
        item.segment_id = found[0]
        _compare_with_database(db, item, found[0], protected, wins)
    for item in segments.values():
        if item.segment_id and (item.changes or item.measurements):
            item.group = "changed"
    return segments


def _flags(parsed: dict[str, Any]) -> dict[str, Any]:
    return {
        "customer": parsed["customer"],
        "planned_date": parsed["planned_date"],
        "group_label": parsed["group_label"],
        "additional": bool(parsed["additional"]),
    }


def _matches(db: Session, where: str, **params: Any) -> tuple[list[int], list[int]]:
    """(reservations equal on customer, date, label, additional; reservations equal on the where clause only)."""
    rows = db.execute(text(SELECT_SAME_RESERVATIONS + where), params).all()
    equal_on_all = [row[0] for row in rows if all(row[1:])]
    equal_on_where = [row[0] for row in rows]
    return equal_on_all, equal_on_where


def _set(row: Row, group: str, reason: str | None = None) -> None:
    row.group = group
    row.reason = reason or row.reason
    row.status = {"needs_review": "needs_review", "rejected": "rejected"}.get(group, "ready")


NO_ROOM_TEXT = "free to reserve on this segment"


def _reservation_row(
    db: Session,
    row: Row,
    item: SegmentItem,
    sites: dict[str, int],
    closed: bool,
    claims: dict[tuple, int],
    count_rows: dict[tuple, int],
) -> None:
    parsed = row.parsed
    if closed:
        _set(row, "ignored", "reservation import is closed; reservation rows are ignored")
        return
    row.extra["cores"] = 0
    if parsed["planned_date"] is None:
        row.warnings.append("no reserved date: the import date starts the stale clock")
    count = parsed["unassigned_cores"]
    if count < 1:  # parser left it Needs review already; defensive
        _set(row, "needs_review", "no core count")
        return
    if item.segment_id:
        where = "r.unassigned_cores = :count AND r.unassigned_segment_id = :segment_id"
        already_imported, _ = _matches(db, where, count=count, segment_id=item.segment_id, **_flags(parsed))
        if already_imported:
            row.extra["matched_reservation_id"] = already_imported[0]
            _set(row, "already_imported", f"already imported as reservation #{already_imported[0]}")
            return
    identity = (
        item.key, count, parsed["customer"].casefold(), parsed["planned_date"], parsed["group_label"],
        bool(parsed["additional"]),
    )
    if identity in count_rows:
        _set(row, "needs_review", f"identical to row {count_rows[identity]} in this file")
        return
    if item.verified_cores is None:
        _set(row, "needs_review", "segment has no verified core count: a count-only reservation cannot be booked")
        return
    already_free = item.db_free if item.segment_id else 0
    new_cores = max(item.verified_cores - (item.db_verified_cores or 0), 0)
    free = already_free + new_cores - item.used
    if count > free:
        _set(row, "needs_review", f"{count} cores requested but only {max(free, 0)} {NO_ROOM_TEXT}")
        return
    count_rows[identity] = row.row_number
    item.used += count
    _set(row, "reservations")


def _unknown_sites(row: Row, sites: dict[str, int]) -> list[str]:
    return [name for name in (row.parsed["site_a"], row.parsed["site_b"]) if name not in sites]


def evaluate(db: Session, rows: list[Row], wins: set[tuple[str, str]] = frozenset()) -> Eval:  # type: ignore[assignment]
    closed = import_state(db)["closed"]
    names = {name for row in rows for name in (row.parsed.get("site_a"), row.parsed.get("site_b")) if name}
    sites = dict(db.execute(text(SELECT_SITE_IDS_BY_NAME), {"names": sorted(names)}).all())
    warnings: list[dict[str, Any]] = []
    for row in rows:
        row.group = {"rejected": "rejected", "needs_review": "needs_review"}.get(row.parse_status, "")
        row.reason = row.parse_reason
        if row.group:
            continue
        unknown = _unknown_sites(row, sites)
        if unknown:
            _set(row, "rejected", "unknown site " + ", ".join(unknown))
    segments = _segment_items(db, rows, sites, wins)
    claims: dict[tuple, int] = {}
    count_rows: dict[tuple, int] = {}
    for row in rows:
        if not row.group:
            _reservation_row(db, row, segments[row.extra["segment_key"]], sites, closed, claims, count_rows)
    file_keys = set(segments)
    missing = []
    for segment_id, key in db.execute(text(SELECT_ALL_SEGMENT_KEYS)):
        if key not in file_keys:
            missing.append({"key": key, "segment_id": segment_id})
    _warnings(rows, segments, closed, warnings)
    return Eval(rows, segments, missing, warnings, closed)


def _warnings(rows: list[Row], segments: dict[str, SegmentItem], closed: bool, warnings: list[dict[str, Any]]) -> None:
    def add(kind: str, message: str, row_numbers: list[int]) -> None:
        warnings.append({"kind": kind, "message": message, "rows": row_numbers})

    if closed:
        ignored = [row.row_number for row in rows if row.group == "ignored"]
        add("import_closed", f"Reservation import is closed: {len(ignored)} reservation rows are ignored.", ignored)
    for item in segments.values():
        firsts = [
            row.row_number for row in rows
            if row.extra.get("segment_key") == item.key and not row.parsed.get("additional")
        ]
        if len(firsts) > 1:
            listed = ", ".join(map(str, firsts))
            add("duplicate_cable", f"Cable {item.key} looks listed twice (rows {listed}).", firsts)
        for warning in item.warnings:
            add("segment_values", f"{item.key}: {warning}", item.rows)
    for row in rows:
        if row.group == "conflicts":
            add("core_held", f"Row {row.row_number}: {row.reason}", [row.row_number])
        for warning in row.warnings:
            add("row", f"Row {row.row_number}: {warning}", [row.row_number])


# ---- stage ----------------------------------------------------------------------------------------------------

def _json_default(value: Any) -> Any:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return float(value)


def _dump(payload: Any) -> Any:
    return json.loads(json.dumps(payload, default=_json_default))


def _row_payload(row: Row) -> dict[str, Any]:
    parsed = row.parsed
    shown = None
    if parsed.get("site_a"):
        shown = {
            "customer": parsed.get("customer"),
            "segment": f"{parsed['site_a']}-{parsed['site_b']}",
            "cores": row.extra.get("cores", 0),
            "count_only": parsed.get("unassigned_cores") or None,
            "planned_date": parsed.get("planned_date"),
            "group_label": parsed.get("group_label"),
            "additional": parsed.get("additional"),
        }
    extra = {key: value for key, value in row.extra.items() if key != "cores"}
    return _dump({
        "group": row.group,
        "parse_status": row.parse_status,
        "parse_reason": row.parse_reason,
        "parsed": parsed,
        "reservation": shown,
        **extra,
    })


def _segment_payload(item: SegmentItem) -> dict[str, Any]:
    return _dump({
        "group": item.group,
        "key": item.key,
        "segment_id": item.segment_id,
        "rows": item.rows,
        "fields": item.values,
        "changes": item.changes,
        "measurements": item.measurements,
        "survey_cores_after": item.verified_cores,
        "edited_in_dashboard": any(change["protected"] for change in item.changes),
        "warnings": item.warnings,
    })


def _staged_row(upload_id: int, row: Row) -> dict[str, Any]:
    if row.group in RESERVATION_ENTITY_GROUPS:
        entity = "reservation"
    else:
        entity = "row"
    return {
        "upload_id": upload_id,
        "row_group": ROW_GROUP[row.group],
        "entity": entity,
        "payload": json.dumps(_row_payload(row)),
        "warnings": json.dumps(row.warnings),
        "sheet": row.sheet,
        "row_number": row.row_number,
        "status": row.status,
        "reason": row.reason,
        "raw": json.dumps(row.raw),
    }


def _staged_segment(upload_id: int, item: SegmentItem, first_row: Row) -> dict[str, Any]:
    return {
        "upload_id": upload_id,
        "row_group": ROW_GROUP[item.group],
        "entity": "segment",
        "payload": json.dumps(_segment_payload(item)),
        "warnings": json.dumps(item.warnings),
        "sheet": "Reservation",
        "row_number": item.rows[0],
        "status": "ready",
        "reason": None,
        "raw": json.dumps(first_row.raw),
    }


def _staged_missing(upload_id: int, missing: dict[str, Any]) -> dict[str, Any]:
    return {
        "upload_id": upload_id,
        "row_group": "missing",
        "entity": "segment",
        "payload": json.dumps({"group": "missing", **missing}),
        "warnings": "[]",
        "sheet": None,
        "row_number": None,
        "status": None,
        "reason": None,
        "raw": None,
    }


def stage(db: Session, admin_id: int, filename: str, results: list[RowResult], ignored: list[str]) -> dict[str, Any]:
    evaluation = evaluate(db, from_results(results))
    warnings = list(evaluation.warnings)
    if ignored:
        ignored_sheet_warning = {
            "kind": "ignored_sheet",
            "rows": [],
            "message": "Sheets left out of this upload (sites come from the site master upload): " + ", ".join(ignored),
        }
        warnings = [ignored_sheet_warning] + warnings
    summary = {
        "counts": evaluation.counts(),
        "warnings": warnings,
        "switch_closed": evaluation.closed,
        "ignored_sheets": ignored,
        "applied": None,
    }
    upload_id = insert_upload(db, admin_id, filename, "excel", summary)
    staged = [_staged_row(upload_id, row) for row in evaluation.rows]
    first_row_of_segment = {
        row.extra["segment_key"]: row for row in reversed(evaluation.rows) if row.extra.get("segment_key")
    }
    for item in evaluation.segments.values():
        staged.append(_staged_segment(upload_id, item, first_row_of_segment[item.key]))
    for missing in evaluation.missing:
        staged.append(_staged_missing(upload_id, missing))
    if staged:
        db.execute(text(INSERT_UPLOAD_ROWS), staged)
    db.commit()
    return {"upload_id": upload_id, "filename": filename, "status": "staged", **summary}


def _unjson(parsed: dict[str, Any]) -> dict[str, Any]:
    parsed = dict(parsed)
    for key in ("planned_date", "cv_ready_date", "tested_on"):
        if parsed.get(key):
            parsed[key] = date.fromisoformat(parsed[key])
    return parsed


def load_staged(db: Session, upload_id: int) -> list[Row]:
    rows = []
    for staged in db.execute(text(SELECT_STAGED_ROWS), {"upload_id": upload_id}).mappings():
        payload = staged["payload"]
        rows.append(Row(
            staged["row_number"],
            staged["sheet"],
            staged["raw"] or {},
            _unjson(payload["parsed"]),
            payload["parse_status"],
            payload["parse_reason"],
            id=staged["id"],
        ))
    return rows


# ---- confirm --------------------------------------------------------------------------------------------------

def _segment_id_order(item: SegmentItem) -> tuple[bool, int]:
    return (item.segment_id is None, item.segment_id or 0)


def _read_wins(db: Session, upload_id: int, excel_wins: list[dict[str, Any]]) -> set[tuple[str, str]]:
    segment_keys = dict(db.execute(text(SELECT_STAGED_SEGMENT_KEYS), {"upload_id": upload_id}).all())
    wins: set[tuple[str, str]] = set()
    for win in excel_wins:
        if win["row_id"] not in segment_keys or win["field"] not in SEGMENT_FIELDS:
            raise ApplyError(422, f"Row {win['row_id']} / field '{win['field']}' is not a segment field of this upload")
        wins.add((segment_keys[win["row_id"]], win["field"]))
    return wins


def _check_wins_are_protected(evaluation: Eval, wins: set[tuple[str, str]]) -> None:
    for key, field_name in wins:
        item = evaluation.segments.get(key, SegmentItem(key, "", "", [], {}))
        if not any(change["field"] == field_name and change["protected"] for change in item.changes):
            raise ApplyError(422, f"{key}: '{field_name}' is not a protected field that differs in the file")


def _apply_segment_changes(
    db: Session,
    admin_id: int,
    upload_id: int,
    item: SegmentItem,
    segment_id: int,
    why: str,
    counts: dict[str, int],
) -> None:
    for change in item.changes:
        if not change["applied"]:
            continue
        params = {"value": change["new"], "segment_id": segment_id}
        db.execute(text(update_segment_field_sql(change["field"])), params)
        log_edits_for_user(db, admin_id, "segment", segment_id, [(change["field"], change["old"], change["new"])], why)
        if change["field"] == "survey_cores":
            counts["cores"] += add_cores(db, segment_id, change["new"])
        counts["segment_updates"] += 1
    for measurement in item.measurements:
        params = {
            "segment_id": segment_id,
            "loss_db": measurement["loss_db"],
            "tested_on": measurement["tested_on"],
            "upload_id": upload_id,
        }
        db.execute(text(INSERT_MEASUREMENT), params)
        counts["measurements"] += 1


def _place_reservations(
    db: Session,
    admin_id: int,
    evaluation: Eval,
    sites: dict[str, int],
    counts: dict[str, int],
    skipped: list[dict[str, Any]],
) -> None:
    for row in evaluation.rows:
        if row.group != "reservations":
            continue
        try:
            with db.begin_nested():
                place_reservation(db, counts, row.parsed, sites, admin_id, admin_id)
        except (Skip, IntegrityError) as error:
            skipped.append({"row_number": row.row_number, "reason": str(error) or "core already taken"})
    for row in evaluation.rows:
        if row.group == "conflicts":
            skipped.append({"row_number": row.row_number, "reason": row.reason})
        elif row.group == "needs_review" and NO_ROOM_TEXT in (row.reason or ""):
            skipped.append({"row_number": row.row_number, "reason": row.reason})


def confirm(db: Session, admin_id: int, upload_id: int, excel_wins: list[dict[str, Any]]) -> dict[str, Any]:
    upload = lock_staged_upload(db, upload_id, "excel", "This upload was already confirmed")
    wins = _read_wins(db, upload_id, excel_wins)
    evaluation = evaluate(db, load_staged(db, upload_id), wins)
    # Lock first, then decide again: Free is read under the same segment locks create() takes.
    lock_segments(db, {item.segment_id for item in evaluation.segments.values() if item.segment_id})
    evaluation = evaluate(db, load_staged(db, upload_id), wins)  # fresh rows: evaluate adds warnings to them
    _check_wins_are_protected(evaluation, wins)
    why = f"{REASON} {upload['filename']} #{upload_id}"
    counts: dict[str, int] = dict.fromkeys(COUNT_KEYS, 0)
    skipped: list[dict[str, Any]] = []
    site_names = sorted({name for item in evaluation.segments.values() for name in (item.site_a, item.site_b)})
    sites = dict(db.execute(text(SELECT_SITE_IDS_BY_NAME), {"names": site_names}).all())
    with db.begin_nested():  # all or nothing
        # Same order as reservation create(), which locks segments by id; new segments (no id yet) go last.
        for item in sorted(evaluation.segments.values(), key=_segment_id_order):
            if item.group == "new":
                ensure_segment(db, counts, sites[item.site_a], sites[item.site_b], item.values)
            segment_id = item.segment_id or find_segment(db, sites[item.site_a], sites[item.site_b])[0]  # type: ignore[index]
            _apply_segment_changes(db, admin_id, upload_id, item, segment_id, why, counts)
        _place_reservations(db, admin_id, evaluation, sites, counts, skipped)
        ignored_rows = evaluation.counts()["ignored"]
        applied = {
            "by": admin_id,
            "at": datetime.now(UTC).isoformat(),
            "counts": counts,
            "skipped": skipped,
            "excel_wins": [list(win) for win in sorted(wins)],
            "ignored_reservation_rows": ignored_rows,
        }
        finish_upload(db, upload_id, dict(upload["summary"], applied=applied))
    db.commit()
    invalidate_routes()  # new segments or distances
    return {
        "upload_id": upload_id,
        "counts": counts,
        "skipped": skipped,
        "warnings": evaluation.warnings,
        "ignored_reservation_rows": evaluation.counts()["ignored"],
    }
