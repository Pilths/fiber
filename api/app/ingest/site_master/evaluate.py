"""Compare parsed sheets with the database: protection rules, diff, renames, blocks."""
from collections import Counter
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.ingest.checks import norm
from app.ingest.site_master.model import (
    DROP_LIMIT,
    LOCATION_FIELDS,
    SHEETS,
    UPLOAD_REASON,
    DbSite,
    Item,
    ParsedSheet,
    SheetResult,
    _fmt,
)

SNAPSHOT_SQL = """
SELECT s.id, s.name, s.kind, s.active, ST_Y(s.geom) AS lat, ST_X(s.geom) AS lon, s.details,
       l.name AS lrd, s.lrd_site_id AS lrd_id
FROM sites s LEFT JOIN sites l ON l.id = s.lrd_site_id
"""
PROTECTED_SQL = (
    "SELECT entity_id, field FROM data_edits "
    "WHERE entity = :entity AND NOT (reason LIKE ANY (CAST(:prefixes AS text[])))"
)
USED_SITE_IDS_SQL = """
SELECT DISTINCT site_id FROM (
    SELECT site_a_id AS site_id FROM segments
    UNION ALL SELECT site_b_id FROM segments
    UNION ALL SELECT site_id FROM ports
    UNION ALL SELECT site_a_id FROM routes
    UNION ALL SELECT site_b_id FROM routes
) used WHERE site_id = ANY(:ids)
"""


def load_snapshot(db: Session) -> dict[str, DbSite]:
    snapshot = {}
    for row in db.execute(text(SNAPSHOT_SQL)).mappings():
        site = DbSite(**{**row, "details": row["details"] or {}})
        snapshot[site.name] = site
    return snapshot


def load_protected(db: Session, entity: str, upload_reasons: tuple[str, ...]) -> dict[int, set[str]]:
    """Fields edited in the dashboard are protected from uploads.

    An edit counts unless its reason starts with one of the upload reasons.
    """
    protected: dict[int, set[str]] = {}
    prefixes = [reason + "%" for reason in upload_reasons]
    for entity_id, field_name in db.execute(text(PROTECTED_SQL), {"entity": entity, "prefixes": prefixes}):
        protected.setdefault(entity_id, set()).add(field_name)
    return protected


def is_protected(protected: dict[int, set[str]], site_id: int, field_name: str) -> bool:
    edited = protected.get(site_id)
    if not edited:
        return False
    names = {field_name}
    if field_name.startswith("details."):
        names.add(field_name.removeprefix("details."))
    if field_name == "location":
        names |= LOCATION_FIELDS
    return bool(edited & names)


def _same(a: Any, b: Any) -> bool:
    if a == b:
        return True
    return a is not None and b is not None and str(a) == str(b)


def _new_fields(kind: str, parsed: dict[str, Any]) -> dict[str, Any]:
    fields: dict[str, Any] = {"location": _fmt(parsed["lat"], parsed["lon"])}
    if kind == "dcs":  # Site Location has no region: it is neither checked nor compared nor written
        fields["lrd"] = parsed["lrd"]
    if parsed.get("kind"):
        fields["kind"] = parsed["kind"]
    for key, value in parsed["details"].items():
        fields["details." + key] = value
    return fields


def _drop_region(details: dict[str, Any]) -> None:
    """An old region stays in the database as it is, so it is never compared."""
    for key in details:
        if norm(key) == "region":
            del details[key]
            return


def _old_fields(kind: str, row: DbSite) -> dict[str, Any]:
    details = dict(row.details)
    fields: dict[str, Any] = {"location": _fmt(row.lat, row.lon)}
    if kind == "sites":
        fields["kind"] = row.kind
        _drop_region(details)
    else:
        fields["lrd"] = row.lrd
    for key, value in details.items():
        fields["details." + key] = value
    return fields


def diff_fields(kind: str, parsed: dict[str, Any], row: DbSite,
                protected: dict[int, set[str]]) -> list[dict[str, Any]]:
    new = _new_fields(kind, parsed)
    old = _old_fields(kind, row)
    if "kind" not in new:
        old.pop("kind", None)  # the file has no Type column
    old_by_norm = {norm(key): key for key in old}
    changes = []
    for key, value in new.items():
        old_value = old.get(old_by_norm.get(norm(key), ""))
        if not _same(old_value, value):
            changes.append({"field": key, "old": old_value, "new": value})
    new_norms = {norm(key) for key in new}
    for key, value in old.items():
        if norm(key) not in new_norms and value is not None:
            changes.append({"field": key, "old": value, "new": None})
    if not row.active:
        changes.append({"field": "active", "old": False, "new": True})
    for change in changes:
        change["protected"] = is_protected(protected, row.id, change["field"])
        if change["protected"]:
            change["note"] = "edited in dashboard, file differs"
    return changes


def _duplicate_reason(kind: str, items: list[Item], key: str) -> str:
    label = "site_name" if kind == "sites" else "DC Name / Link"
    rows = ", ".join(str(item.row_number) for item in items if item.parsed["key"] == key)
    return f"duplicate {label} '{key}' in file (rows {rows})"


def _check_dc(
    item: Item, known: set[str], site_coords: dict[str, tuple[float, float]], reasons: list[str]
) -> None:
    """A DC needs a known LRD site; without its own coordinates it takes the site's."""
    parsed = item.parsed
    lrd = parsed["lrd"]
    if not lrd:
        reasons.append("LRD is blank")
    elif lrd not in known:
        reasons.append(f"unknown site code {lrd}")
    if parsed["lat"] is not None:
        item.effective = (parsed["lat"], parsed["lon"])
    elif lrd in known:
        if lrd in site_coords:
            item.effective = site_coords[lrd]
            item.note = f"location from site {lrd}"
        else:
            reasons.append(f"no valid coordinates for the DC or its site {lrd}")


def _set_group(kind: str, item: Item, row: DbSite | None, reasons: list[str],
               protected: dict[int, set[str]]) -> None:
    item.reason = "; ".join(reasons) or None
    if reasons:
        item.status = "needs_review"
        item.group = "problem"
        return
    item.status = "ready"
    if row is None:
        item.group = "added"
        return
    item.db_id = row.id
    item.changes = diff_fields(kind, item.parsed, row, protected)
    if item.changes:
        item.group = "changed"
    else:
        item.group = "unchanged"


def _row_count_block(file_rows: int, active: int) -> str:
    fewer = round(100 * (active - file_rows) / active)
    return f"file has {file_rows} rows but the database has {active} active ({fewer}% fewer, limit is 10%)"


def _too_few_rows(file_rows: int, active: int) -> bool:
    keep, out_of = DROP_LIMIT
    return file_rows * out_of <= active * keep


def _eval_sheet(
    kind: str,
    parsed_sheet: ParsedSheet,
    snapshot: dict[str, DbSite],
    protected: dict[int, set[str]],
    site_coords: dict[str, tuple[float, float]],
    known: set[str],
    add_only: bool = False,
) -> SheetResult:
    result = SheetResult(kind, parsed_sheet.sheet_name, parsed_sheet.found, parsed_sheet.items)
    expected = SHEETS[kind][1]
    if not parsed_sheet.found:
        result.block_reasons = [f"No worksheet has the expected headers: {expected}"]
        result.hard = True
        return result
    key_counts = Counter(item.parsed["key"] for item in parsed_sheet.items if item.parsed["key"])
    for item in parsed_sheet.items:
        reasons = list(item.parsed["reasons"])
        key = item.parsed["key"]
        if key and key_counts[key] > 1:
            reasons.append(_duplicate_reason(kind, parsed_sheet.items, key))
        if kind == "dcs":
            _check_dc(item, known, site_coords, reasons)
        row = snapshot.get(key) if key else None
        if row and row.cls != kind:
            reasons.append(f"name already used by a {row.kind} in the database")
        _set_group(kind, item, row, reasons, protected)

    active_rows = [site for site in snapshot.values() if site.cls == kind and site.active]
    # add-only: the file is a part of the list, so nothing is "missing" and the row-count check does not apply
    if add_only:
        result.missing = []
    else:
        result.missing = [site for site in active_rows if site.name not in key_counts]
    # whole-file checks
    if not parsed_sheet.items:
        result.block_reasons.append("sheet is empty")
        result.hard = True
    file_rows = len(key_counts)
    if parsed_sheet.items and not add_only and _too_few_rows(file_rows, len(active_rows)):
        result.block_reasons.append(_row_count_block(file_rows, len(active_rows)))
    if kind == "dcs":
        _possible_renames(result, site_coords)
    return result


def _same_place(item: Item, missing: DbSite, location: tuple[float, float]) -> bool:
    if item.effective is None:
        return False
    return item.parsed["lrd"] == missing.lrd and _fmt(*item.effective) == _fmt(*location)


def _possible_renames(result: SheetResult, site_coords: dict[str, tuple[float, float]]) -> None:
    """A missing DC and a new DC on the same LRD site at the same place may be one DC renamed."""
    added = [item for item in result.items if item.group == "added" and item.effective]
    taken: set[int] = set()
    for missing in result.missing:
        if missing.lat is not None:
            location = (missing.lat, missing.lon)
        else:
            location = site_coords.get(missing.lrd or "")
        if not location:
            continue
        for item in added:
            if id(item) in taken or not _same_place(item, missing, location):  # type: ignore[arg-type]
                continue
            taken.add(id(item))
            item.rename = {"missing_dc_id": missing.id, "missing_dc_name": missing.name}
            result.renames.append({
                "missing_dc_id": missing.id,
                "missing_dc_name": missing.name,
                "new_dc_name": item.parsed["key"],
                "new_row_number": item.row_number,
                "new_row_id": item.id,
                "lrd": missing.lrd,
            })
            break


def used_site_ids(db: Session, ids: list[int]) -> set[int]:
    if not ids:
        return set()
    return {row[0] for row in db.execute(text(USED_SITE_IDS_SQL), {"ids": ids})}


def _site_coords(snapshot: dict[str, DbSite]) -> dict[str, tuple[float, float]]:
    coords = {}
    for name, site in snapshot.items():
        if site.cls == "sites" and site.lat is not None and site.lon is not None:
            coords[name] = (site.lat, site.lon)
    return coords


def evaluate(db: Session, parsed: dict[str, ParsedSheet], add_only: bool = False) -> dict[str, SheetResult]:
    snapshot = load_snapshot(db)
    protected = load_protected(db, "site", (UPLOAD_REASON,))
    coords = _site_coords(snapshot)
    known = {name for name, site in snapshot.items() if site.cls == "sites"}
    sites = _eval_sheet("sites", parsed["sites"], snapshot, protected, {}, set(), add_only)
    out = {"sites": sites}
    # file sites count for the DCs unless the sites sheet is blocked for good
    if not sites.blocked or not sites.hard:
        for item in sites.items:
            if item.status != "ready":
                continue
            known.add(item.parsed["key"])
            if item.parsed["lat"] is not None:
                coords[item.parsed["key"]] = (item.parsed["lat"], item.parsed["lon"])
    out["dcs"] = _eval_sheet("dcs", parsed["dcs"], snapshot, protected, coords, known, add_only)
    for result in out.values():
        result.in_use = used_site_ids(db, [missing.id for missing in result.missing])
    return out
