"""Segment list upload: create and update segments (site pairs) from one sheet with Link and Distance headers.

Staging writes only `uploads` and `upload_rows`. Apply recomputes the diff from the staged rows against the
current database (like the site master), so a stale preview cannot overwrite newer data.
"""
import json
import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any

import openpyxl
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.ingest.checks import blank, clean, split_nodes
from app.ingest.excel import _json
from app.ingest.pipeline import apply_staged_upload, insert_staged_rows, load_staged_rows
from app.ingest.reservation_import import add_cores
from app.ingest.segment_fields import write_segment_field
from app.ingest.site_master import hkey, load_protected
from app.ingest.uploads import ApplyError, insert_upload

UPLOAD_REMARKS = "segment list upload"
ALIASES = {
    "link": "link",
    "links": "link",
    "sitea": "site_a",
    "section": "section",
    "segment": "section",
    "distance": "distance",
    "distancekm": "distance",
    "km": "distance",
    "route": "route",
    "verifiedcores": "verified_cores",
    "surveyedcores": "verified_cores",  # old header
    "totalcores": "total_cores",
}
EXPECTED = "Link, Distance"
GROUP_COL = {"new": "new", "changed": "changed", "unchanged": "unchanged", "problem": "needs_review"}
FIELDS = ("distance_km", "route", "section", "survey_cores", "cable_size")  # segment columns a row may change
DEFAULT_CABLE_SIZE = 144  # segments.cable_size default, used for a new segment with no Total cores
MAX_DISTANCE = Decimal("9999999.999")  # numeric(10,3)

SELECT_SITES_BY_NAME = "SELECT id, name, active FROM sites WHERE name = ANY(:names)"
# n_cores: same idea as the Reservation upload, the core rows that count as verified now.
SELECT_SEGMENTS = """
    SELECT id, site_a_id, site_b_id, distance_km, route, section, survey_cores, cable_size,
           (SELECT count(*) FROM cores c
            WHERE c.segment_id = segments.id
              AND (segments.survey_cores IS NULL OR c.number <= segments.survey_cores)) AS n_cores
    FROM segments
"""
INSERT_SEGMENT = """
    INSERT INTO segments (site_a_id, site_b_id, distance_km, route, section, survey_cores, cable_size)
    VALUES (:site_a_id, :site_b_id, CAST(:distance AS numeric), :route, :section,
            CAST(:verified_cores AS integer), CAST(:total_cores AS integer))
    RETURNING id
"""


@dataclass
class Item:
    row_number: int
    raw: dict[str, Any]
    parsed: dict[str, Any]
    id: int | None = None
    status: str = "ready"
    reason: str | None = None
    group: str = "unchanged"
    changes: list[dict[str, Any]] = field(default_factory=list)
    db_id: int | None = None
    ids: tuple[int, int] | None = None  # site ids of the pair, set when both sites exist


@dataclass
class Parsed:
    sheet_name: str | None
    items: list[Item]
    found: bool = True


def _cell(value: Any) -> str | None:
    if blank(value):
        return None
    return " ".join(str(value).split())


def _distance(value: Any) -> tuple[str | None, str | None]:
    """(distance text with 3 decimals, reason). Digits with '.' as the decimal point; blank is allowed."""
    if blank(value):
        return None, None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        distance_text = format(Decimal(repr(value)), "f")
    else:
        distance_text = str(value).strip()
    distance = None
    try:
        if re.fullmatch(r"\d+(\.\d+)?", distance_text):
            distance = Decimal(distance_text).quantize(Decimal("0.001"), ROUND_HALF_UP)
    except InvalidOperation:
        distance = None
    if distance is None or distance > MAX_DISTANCE:
        return None, "distance is not a number"
    return str(distance), None


def _count(value: Any, label: str, minimum: int) -> tuple[int | None, str | None]:
    """(whole number, reason). Blank is allowed; a decimal like 24.5 or text is a problem, never rounded."""
    if blank(value):
        return None, None
    count_text = format(Decimal(repr(value)), "f") if isinstance(value, float) else str(value).strip()
    if isinstance(value, bool) or not re.fullmatch(r"\d+(\.0+)?", count_text):
        return None, f"{label} is not a whole number"
    count = int(count_text.split(".")[0])
    if count < minimum:
        return None, f"{label} must be above 0"
    return count, None


def _raw_cells(headers: list[str], values: tuple[Any, ...]) -> dict[str, Any]:
    return {header: _json(value) for header, value in zip(headers, values) if header and not blank(value)}


def _parse_row(headers: list[str], values: tuple[Any, ...]) -> Item:
    fields: dict[str, Any] = {}
    for header, value in zip(headers, values):
        if header and ALIASES.get(hkey(header)):
            fields.setdefault(ALIASES[hkey(header)], clean(value))
    item = Item(0, _raw_cells(headers, values), {})
    reasons: list[str] = []
    link = _cell(fields.get("link"))
    site_a = None
    site_b = None
    if link is None:
        reasons.append("Link is blank")
    else:
        pair = None if re.search(r"\s", str(fields["link"]).strip()) else split_nodes(link)
        if pair is None:
            reasons.append("Link must be two different site names joined by a dash, like AAAA-BBBB, with no spaces")
        else:
            site_a = pair[0]
            site_b = pair[1]
    distance, distance_reason = _distance(fields.get("distance"))
    if distance_reason:
        reasons.append(distance_reason)
    verified_cores, verified_reason = _count(fields.get("verified_cores"), "Verified cores", 0)
    total_cores, total_reason = _count(fields.get("total_cores"), "Total cores", 1)
    reasons.extend(reason for reason in (verified_reason, total_reason) if reason)
    # The keys "a" and "b" are stored in staged payloads; keep them.
    item.parsed = {
        "link": link,
        "a": site_a,
        "b": site_b,
        "distance": distance,
        "route": _cell(fields.get("route")),
        "section": _cell(fields.get("section")),
        "verified_cores": verified_cores,
        "total_cores": total_cores,
        "reasons": reasons,
    }
    return item


def _find_sheet(workbook: Any) -> tuple[Any, int, list[str]] | None:
    """First sheet with a row holding the Link header (any column) and a Distance header."""
    for sheet in workbook.worksheets:
        for row_number, row in enumerate(sheet.iter_rows(values_only=True), 1):
            headers = [" ".join(str(clean(cell)).split()) if not blank(cell) else "" for cell in row]
            fields = {ALIASES.get(hkey(header)) for header in headers if header}
            if {"link", "distance"} <= fields:
                return sheet, row_number, headers
    return None


def parse_workbook(data: Any) -> Parsed:
    """Never raises on a row."""
    workbook = openpyxl.load_workbook(data, read_only=True, data_only=True)
    hit = _find_sheet(workbook)
    if not hit:
        return Parsed(None, [], found=False)
    sheet, header_row, headers = hit
    items = []
    for row_number, values in enumerate(sheet.iter_rows(min_row=header_row + 1, values_only=True), header_row + 1):
        if all(blank(value) for value in values):
            continue
        try:
            item = _parse_row(headers, values)
        except Exception as error:  # noqa: BLE001  a bad row never stops the import
            failed = {
                "link": None, "a": None, "b": None, "distance": None, "route": None, "section": None,
                "verified_cores": None, "total_cores": None,
                "reasons": [f"could not parse row: {type(error).__name__}: {error}"],
            }
            item = Item(0, _raw_cells(headers, values), failed)
        item.row_number = row_number
        items.append(item)
    return Parsed(sheet.title, items)


# ---- diff -----------------------------------------------------------------------------------------------------

def _old(row: Any) -> dict[str, str | None]:
    return {name: None if row[name] is None else str(row[name]) for name in FIELDS}


def _pair_key(item: Item) -> frozenset:
    return frozenset((item.parsed["a"], item.parsed["b"]))


def _problems(item: Item, pairs: Counter, items: list[Item], sites: dict[str, Any]) -> list[str]:
    parsed = item.parsed
    reasons = list(parsed["reasons"])
    if not parsed["a"]:
        return reasons
    key = _pair_key(item)
    if pairs[key] > 1:
        same_link = [other.row_number for other in items if other.parsed["a"] and _pair_key(other) == key]
        reasons.append(f"duplicate link in file (rows {', '.join(map(str, same_link))})")
    for name in (parsed["a"], parsed["b"]):
        if name not in sites:
            reasons.append(f"site {name} is not in the dashboard")
        elif not sites[name].active:
            reasons.append(f"site {name} is not active in the dashboard")
    return reasons


def _changes(item: Item, row: Any, protected: dict[int, set[str]]) -> list[dict[str, Any]]:
    parsed = item.parsed
    old = _old(row)
    new = {
        "distance_km": parsed["distance"],
        "route": parsed["route"],
        "section": parsed["section"],
        "survey_cores": _text(parsed.get("verified_cores")),
        "cable_size": _text(parsed.get("total_cores")),
    }
    changes = []
    for field_name in FIELDS:
        # A blank file cell never clears a value.
        if new[field_name] is None or new[field_name] == old[field_name]:
            continue
        is_protected = field_name in protected.get(row["id"], ())
        note = "edited in dashboard, file differs" if is_protected else None
        changes.append({
            "field": field_name,
            "old": old[field_name],
            "new": new[field_name],
            "protected": is_protected,
            "note": note,
        })
        if field_name == "survey_cores" and int(new[field_name]) < row["n_cores"]:
            changes[-1]["blocked"] = f"cannot lower below the {row['n_cores']} cores that already exist"
    return changes


def _text(number: int | None) -> str | None:
    return None if number is None else str(number)


def _too_many_verified(item: Item, row: Any) -> str | None:
    """Verified cores above Total cores, using the database value for whichever cell the file leaves blank."""
    verified = item.parsed.get("verified_cores")
    total = item.parsed.get("total_cores")
    if verified is None and row is not None:
        verified = row["survey_cores"]
    if total is None:
        total = DEFAULT_CABLE_SIZE if row is None else row["cable_size"]
    if verified is not None and verified > total:
        return f"Verified cores {verified} is above Total cores {total}"
    return None


def evaluate(db: Session, parsed: Parsed) -> list[Item]:
    """Set status, reason, group, changes and db_id on every item."""
    names = {name for item in parsed.items for name in (item.parsed["a"], item.parsed["b"]) if name}
    sites = {row.name: row for row in db.execute(text(SELECT_SITES_BY_NAME), {"names": sorted(names)})}
    segment_rows = db.execute(text(SELECT_SEGMENTS)).mappings()
    segments = {frozenset((row["site_a_id"], row["site_b_id"])): row for row in segment_rows}
    protected = load_protected(db, "segment")
    pairs = Counter(_pair_key(item) for item in parsed.items if item.parsed["a"])
    for item in parsed.items:
        reasons = _problems(item, pairs, parsed.items, sites)
        item.reason = "; ".join(reasons) or None
        item.status = "needs_review" if reasons else "ready"
        if reasons:
            item.group = "problem"
            continue
        site_a_id = sites[item.parsed["a"]].id
        site_b_id = sites[item.parsed["b"]].id
        item.ids = (site_a_id, site_b_id)
        row = segments.get(frozenset((site_a_id, site_b_id)))
        too_many = _too_many_verified(item, row)
        if too_many:
            item.reason = too_many
            item.status = "needs_review"
            item.group = "problem"
            continue
        if row is None:
            item.group = "new"
            continue
        item.db_id = row["id"]
        item.changes = _changes(item, row, protected)
        item.group = "changed" if item.changes else "unchanged"
    return parsed.items


def block_reason(parsed: Parsed) -> str | None:
    if not parsed.found:
        return f"No worksheet has the expected headers: {EXPECTED}"
    if parsed.items:
        return None
    return "sheet is empty"


def _counts(items: list[Item]) -> dict[str, int]:
    by_group = Counter(item.group for item in items)
    return {
        "rows": len(items),
        "new": by_group["new"],
        "changed": by_group["changed"],
        "unchanged": by_group["unchanged"],
        "problem": by_group["problem"],
    }


# ---- staging --------------------------------------------------------------------------------------------------

def _staged_row(upload_id: int, sheet_name: str | None, item: Item) -> dict[str, Any]:
    payload = {
        "group": item.group,
        "db_id": item.db_id,
        "changes": item.changes,
        "edited_in_dashboard": any(change["protected"] for change in item.changes),
        "parsed": item.parsed,
    }
    return {
        "upload_id": upload_id,
        "row_group": GROUP_COL[item.group],
        "entity": "segment",
        "sheet": sheet_name,
        "row_number": item.row_number,
        "status": item.status,
        "reason": item.reason,
        "raw": json.dumps(item.raw),
        "payload": json.dumps(payload),
    }


def stage(db: Session, admin_id: int, filename: str, parsed: Parsed) -> dict[str, Any]:
    """Store every row raw in upload_rows and the uploads row. Writes nothing else."""
    items = evaluate(db, parsed)
    summary = {
        "sheet_name": parsed.sheet_name,
        "found": parsed.found,
        "block_reason": block_reason(parsed),
        "counts": _counts(items),
        "applied": None,
    }
    upload_id = insert_upload(db, admin_id, filename, "segment_list", summary)
    insert_staged_rows(db, [_staged_row(upload_id, parsed.sheet_name, item) for item in items])
    db.commit()
    return {"upload_id": upload_id, "filename": filename, **summary}


def load_staged(db: Session, upload_id: int, summary: dict[str, Any]) -> Parsed:
    items = []
    for row in load_staged_rows(db, upload_id):
        items.append(Item(row["row_number"], row["raw"] or {}, row["payload"]["parsed"], id=row["id"]))
    return Parsed(summary["sheet_name"], items, summary["found"])


# ---- apply ----------------------------------------------------------------------------------------------------

def _segment_id_order(item: Item) -> tuple[bool, int]:
    return (item.db_id is None, item.db_id or 0)


def _create_segment(db: Session, item: Item) -> None:
    parsed = item.parsed
    params = {
        "site_a_id": item.ids[0],  # type: ignore[index]
        "site_b_id": item.ids[1],  # type: ignore[index]
        "distance": parsed["distance"],
        "route": parsed["route"],
        "section": parsed["section"],
        "verified_cores": parsed.get("verified_cores"),
        "total_cores": parsed.get("total_cores") or DEFAULT_CABLE_SIZE,
    }
    segment_id = db.execute(text(INSERT_SEGMENT), params).scalar_one()
    if params["verified_cores"]:
        add_cores(db, segment_id, params["verified_cores"])


def _update_segment(
    db: Session, admin_id: int, upload_id: int, item: Item, changes: list[dict[str, Any]], why: str
) -> None:
    for change in changes:
        write_segment_field(
            db, admin_id, upload_id, item.db_id, change["field"], change["old"], change["new"], why  # type: ignore[arg-type]
        )
        if change["field"] == "survey_cores":
            add_cores(db, item.db_id, int(change["new"]))  # type: ignore[arg-type]


def apply_upload(db: Session, admin_id: int, upload_id: int) -> dict[str, Any]:
    def evaluate_staged(upload: dict[str, Any]) -> list[Item]:
        parsed = load_staged(db, upload_id, upload["summary"])
        blocked = block_reason(parsed)
        if blocked:
            raise ApplyError(409, f"Nothing can be applied: {blocked}")
        return evaluate(db, parsed)

    def write_all(upload: dict[str, Any], items: list[Item]) -> tuple[dict[str, Any], dict[str, Any]]:
        why = f"{UPLOAD_REMARKS} {upload['filename']} #{upload_id}"
        counts = {"created": 0, "changed": 0, "protected_kept": 0, "skipped": 0}
        warnings: list[str] = []
        blocked: list[str] = []
        # Same order as reservation create(), which locks segments by id; new segments (no id yet) go last.
        for item in sorted(items, key=_segment_id_order):
            if item.group == "problem":
                counts["skipped"] += 1
            elif item.group == "new":
                _create_segment(db, item)
                counts["created"] += 1
            elif item.group == "changed":
                counts["protected_kept"] += sum(change["protected"] for change in item.changes)
                link = item.parsed["link"]
                # a protected change is kept anyway, so it is not reported as blocked
                blocked.extend(
                    f"row {item.row_number} {link}: {c['blocked']}"
                    for c in item.changes
                    if "blocked" in c and not c["protected"]
                )
                to_apply = [c for c in item.changes if not c["protected"] and "blocked" not in c]
                if not to_apply:
                    continue
                _update_segment(db, admin_id, upload_id, item, to_apply, why)
                counts["changed"] += 1
        extra = {"warnings": warnings, "blocked": len(blocked), "blocked_changes": blocked}
        applied = {"by": admin_id, "at": datetime.now(UTC).isoformat(), **counts, **extra}
        return applied, {"upload_id": upload_id, **counts, **extra}

    message = "This upload was already applied"
    return apply_staged_upload(db, upload_id, "segment_list", message, evaluate_staged, write_all)
