"""Site master workbook (replace-file model).

Find sheets by headers, parse, diff against the database, stage, apply.

Staging writes only `uploads` and `upload_rows`. Apply recomputes the diff from the staged rows against the
current database, so a stale preview cannot overwrite newer data.
"""
import json
import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import openpyxl
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.ingest import checks
from app.ingest.checks import blank, clean, norm
from app.ingest.excel import _json
from app.routing.graph import invalidate as invalidate_routes

BLANKS = {"", "tba", "n/a", "na", "-", "tbc"}
DROP_LIMIT = (9, 10)  # a sheet with file rows * 10 <= database rows * 9 (10% or more fewer) is blocked
UPLOAD_REASON = "site master upload"
LOCATION_FIELDS = {"location", "geom", "lat", "lon", "latitude", "longitude"}
SHEETS = {  # kind: (required header keys, expected-headers text, entity, own header keys)
    "sites": (
        ("sitename", "latitudeindecimal", "longitudeindecimal"),
        "site_name, latitude_in_decimal, longitude_in_decimal",
        "site",
        {"sitename", "latitudeindecimal", "longitudeindecimal", "region", "type"},
    ),
    "dcs": (
        ("dcnamelink", "lrd"),
        "DC Name / Link, LRD",
        "dc",
        {"dcnamelink", "lrd", "lat", "long", "latitude", "longitude", "lon"},
    ),
}
# Type column of the Sites sheet; blank or Trunk means a trunk site ('site')
SITE_KINDS = {"trunk": "site", "dc": "data_center", "toc": "toc"}
GROUP_COL = {
    "added": "new",
    "changed": "changed",
    "missing": "missing",
    "problem": "needs_review",
    "unchanged": "unchanged",
}
APPLY_COUNTERS = ["added", "changed", "protected_kept", "renamed", "deactivated", "kept_active", "skipped"]

# Sites a Site Location DC can hang off: every site except Site Location DCs themselves
# (those have an LRD site)
LRD_TARGETS_SQL = "SELECT name, id FROM sites WHERE NOT (kind = 'data_center' AND lrd_site_id IS NOT NULL)"
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
INSERT_UPLOAD_SQL = """
INSERT INTO uploads (user_id, filename, kind, status, summary)
VALUES (:user_id, :filename, 'site_master', 'staged', CAST(:summary AS jsonb)) RETURNING id
"""
INSERT_UPLOAD_ROW_SQL = """
INSERT INTO upload_rows (upload_id, row_group, entity, payload, sheet, row_number, status, reason, raw)
VALUES (:upload_id, :row_group, :entity, CAST(:payload AS jsonb), :sheet, :row_number, :status, :reason,
        CAST(:raw AS jsonb))
"""
NEW_DC_ROW_IDS_SQL = """
SELECT row_number, id FROM upload_rows WHERE upload_id = :upload_id AND entity = 'dc' AND row_group = 'new'
"""
SET_ROW_RENAME_SQL = """
UPDATE upload_rows SET payload = jsonb_set(payload, '{possible_rename}', CAST(:rename AS jsonb))
WHERE id = :row_id
"""
SET_MISSING_RENAME_SQL = """
UPDATE upload_rows SET payload = jsonb_set(payload, '{possible_rename}', CAST(:rename AS jsonb))
WHERE upload_id = :upload_id AND row_group = 'missing' AND (payload->>'db_id')::bigint = :missing_dc_id
"""
UPDATE_SUMMARY_SQL = "UPDATE uploads SET summary = CAST(:summary AS jsonb) WHERE id = :upload_id"
STAGED_ROWS_SQL = """
SELECT id, entity, row_number, raw, payload FROM upload_rows
WHERE upload_id = :upload_id AND row_group <> 'missing' ORDER BY id
"""
INSERT_SITE_SQL = """
INSERT INTO sites (name, kind, geom, details, lrd_site_id)
VALUES (:name, :kind,
        ST_SetSRID(ST_MakePoint(CAST(:lon AS double precision), CAST(:lat AS double precision)), 4326),
        CAST(:details AS jsonb), :lrd_site_id)
"""
UPDATE_SITE_SQL = """
UPDATE sites SET name = :name, kind = :kind,
       geom = ST_SetSRID(ST_MakePoint(CAST(:lon AS double precision), CAST(:lat AS double precision)), 4326),
       details = CAST(:details AS jsonb), lrd_site_id = :lrd_site_id, active = :active
WHERE id = :id
"""
INSERT_SITE_EDIT_SQL = """
INSERT INTO data_edits (entity, entity_id, field, old_value, new_value, reason, user_id)
VALUES ('site', :site_id, :field, :old_value, :new_value, :reason, :user_id)
"""
SITE_MASTER_UPLOAD_SQL = """
SELECT id, filename, status, summary FROM uploads WHERE id = :upload_id AND kind = 'site_master'
"""
INSERT_OVERRIDE_EDIT_SQL = """
INSERT INTO data_edits (entity, entity_id, field, old_value, new_value, reason, user_id)
VALUES ('upload', :upload_id, 'override_drop', NULL, :sheet, :reason, :user_id)
"""
FINISH_UPLOAD_SQL = """
UPDATE uploads SET status = :status,
       confirmed_at = CASE WHEN :status = 'confirmed' THEN now() ELSE confirmed_at END,
       summary = CAST(:summary AS jsonb)
WHERE id = :upload_id
"""


def isblank(value: Any) -> bool:
    """Empty, TBA, N/A, NA, -, TBC (any case) are blank, never invalid text."""
    if value is None:
        return True
    return str(clean(value)).strip().casefold() in BLANKS


def hkey(header: Any) -> str:
    return re.sub(r"[^0-9a-z]", "", str(header).casefold())


def _fmt(lat: float | None, lon: float | None) -> str | None:
    if lat is None or lon is None:
        return None
    return f"{lat:.6f},{lon:.6f}"


def _num(value: Any) -> tuple[float | None, str | None]:
    if isblank(value):
        return None, None
    try:
        return float(str(value).strip()), None
    except ValueError:
        return None, f"cannot read '{str(value).strip()}'"


def _cell_text(value: Any) -> str | None:
    if isblank(value):
        return None
    return str(value).strip()


@dataclass
class Item:
    row_number: int
    raw: dict[str, Any]
    parsed: dict[str, Any]  # parsed fields; parsed["reasons"] are the parse-stage reasons
    id: int | None = None
    status: str = "ready"
    reason: str | None = None
    group: str = "unchanged"
    changes: list[dict[str, Any]] = field(default_factory=list)
    db_id: int | None = None
    note: str | None = None
    effective: tuple[float, float] | None = None
    rename: dict[str, Any] | None = None


@dataclass
class DbSite:
    id: int
    name: str
    kind: str
    active: bool
    lat: float | None
    lon: float | None
    details: dict[str, Any]
    lrd: str | None
    lrd_id: int | None

    @property
    def cls(self) -> str:
        # a DC from the Site Location sheet always has an LRD site; a DC from the Sites sheet has none
        if self.kind == "data_center" and self.lrd_id is not None:
            return "dcs"
        return "sites"


@dataclass
class ParsedSheet:
    kind: str
    sheet_name: str | None
    items: list[Item]
    found: bool = True


@dataclass
class SheetResult:
    kind: str
    sheet_name: str | None
    found: bool
    items: list[Item] = field(default_factory=list)
    missing: list[DbSite] = field(default_factory=list)
    in_use: set[int] = field(default_factory=set)
    renames: list[dict[str, Any]] = field(default_factory=list)
    block_reasons: list[str] = field(default_factory=list)
    hard: bool = False  # a block the admin cannot override

    @property
    def blocked(self) -> bool:
        return bool(self.block_reasons)

    @property
    def counts(self) -> dict[str, int]:
        groups = Counter(item.group for item in self.items)
        return {
            "rows": len(self.items),
            "added": groups["added"],
            "changed": groups["changed"],
            "missing": len(self.missing),
            "problem": groups["problem"],
            "unchanged": groups["unchanged"],
        }

    def summary(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "sheet_name": self.sheet_name,
            "found": self.found,
            "blocked": self.blocked,
            "block_reasons": self.block_reasons,
            "counts": self.counts,
            "needs_override": self.blocked and not self.hard,
        }


def _can_apply(result: SheetResult, override_on: bool) -> bool:
    """A found sheet can be applied unless it is blocked; a soft block yields to an override."""
    if not result.found:
        return False
    if not result.blocked:
        return True
    return not result.hard and override_on


# ---- reading the workbook ------------------------------------------------------------------------

def _header_text(value: Any) -> str:
    if blank(value):
        return ""
    return " ".join(str(clean(value)).split())


def _find_sheet(wb: Any, kind: str, taken: set[str]) -> tuple[Any, int, list[str]] | None:
    """Scan each sheet top to bottom, any row and column, for the name header (site_name / DC Name / Link).

    That row, holding the other required headers too, is the header row.
    """
    anchor, *rest = SHEETS[kind][0]
    for ws in wb.worksheets:
        if ws.title in taken:
            continue
        for row_number, row in enumerate(ws.iter_rows(values_only=True), 1):
            if not any(not blank(cell) and hkey(cell) == anchor for cell in row):
                continue
            headers = [_header_text(cell) for cell in row]
            if set(rest) <= {hkey(header) for header in headers if header}:
                return ws, row_number, headers
    return None


def _first_present(fields: dict[str, Any], keys: tuple[str, ...]) -> Any:
    for key in keys:
        if key in fields:
            return fields[key]
    return None


def _coordinate_problem(kind: str, lat: float | None, lon: float | None, lat_error: str | None,
                        lon_error: str | None) -> str | None:
    if lat_error:
        return f"latitude {lat_error}"
    if lon_error:
        return f"longitude {lon_error}"
    # a DC may leave its coordinates blank and fall back to its site
    if kind == "sites" or lat is not None or lon is not None:
        return checks.check_coords(lat, lon)
    return None


def _site_kind(site_type: Any) -> str | None:
    if isblank(site_type):
        return "site"
    return SITE_KINDS.get(str(site_type).strip().casefold())


def _parse_row(kind: str, headers: list[str], values: tuple[Any, ...]) -> Item:
    own = SHEETS[kind][3]
    raw = {header: _json(value) for header, value in zip(headers, values) if header and not blank(value)}
    item = Item(0, raw, {})  # raw, as read
    values = tuple(clean(value) for value in values)
    fields = {hkey(header): value for header, value in zip(headers, values) if header}
    reasons: list[str] = []

    if kind == "sites":
        key = _cell_text(fields.get("sitename"))
        lat_source = fields.get("latitudeindecimal")
        lon_source = fields.get("longitudeindecimal")
    else:
        key = _cell_text(fields.get("dcnamelink"))
        lat_source = _first_present(fields, ("lat", "latitude"))
        lon_source = _first_present(fields, ("long", "lon", "longitude"))
    lat, lat_error = _num(lat_source)
    lon, lon_error = _num(lon_source)
    coordinate_problem = _coordinate_problem(kind, lat, lon, lat_error, lon_error)
    if coordinate_problem:
        lat = None
        lon = None

    details = {
        header: _json(value)
        for header, value in zip(headers, values)
        if header and hkey(header) not in own and not isblank(value)
    }
    parsed: dict[str, Any] = {"key": key, "lat": lat, "lon": lon, "details": details}
    if not key:
        name_header = "site_name" if kind == "sites" else "DC Name / Link"
        reasons.append(name_header + " is blank")
    if kind == "sites":
        if coordinate_problem:
            reasons.append(coordinate_problem)
    else:
        parsed["lrd"] = _cell_text(fields.get("lrd"))
        # not a problem by itself: the DC falls back to its site
        parsed["own_coords_note"] = coordinate_problem
    # no Type column: parsed has no "kind" and existing kinds are left alone
    if kind == "sites" and "type" in fields:
        parsed["kind"] = _site_kind(fields["type"])
        if parsed["kind"] is None:
            reasons.append("Type must be Trunk, DC, TOC or blank")
    parsed["reasons"] = reasons
    item.parsed = parsed
    return item


def _unreadable_row(headers: list[str], values: tuple[Any, ...], error: Exception) -> Item:
    raw = {header: _json(value) for header, value in zip(headers, values) if header and not blank(value)}
    reason = f"could not parse row: {type(error).__name__}: {error}"
    return Item(0, raw, {"key": None, "details": {}, "reasons": [reason]})


def _parse_rows(ws: Any, kind: str, header_row: int, headers: list[str]) -> list[Item]:
    items = []
    first_row = header_row + 1
    for row_number, values in enumerate(ws.iter_rows(min_row=first_row, values_only=True), first_row):
        if all(blank(value) for value in values):
            continue
        try:
            item = _parse_row(kind, headers, values)
        except Exception as error:  # noqa: BLE001  a bad row never stops the import
            item = _unreadable_row(headers, values, error)
        item.row_number = row_number
        items.append(item)
    return items


def parse_workbook(data: Any) -> dict[str, ParsedSheet]:
    """Both parts of the site master workbook.

    A part with no matching sheet comes back found=False. Never raises on a row.
    """
    wb = openpyxl.load_workbook(data, read_only=True, data_only=True)
    out: dict[str, ParsedSheet] = {}
    taken: set[str] = set()
    for kind in SHEETS:
        hit = _find_sheet(wb, kind, taken)
        if not hit:
            out[kind] = ParsedSheet(kind, None, [], found=False)
            continue
        ws, header_row, headers = hit
        taken.add(ws.title)
        out[kind] = ParsedSheet(kind, ws.title, _parse_rows(ws, kind, header_row, headers))
    return out


# ---- diff ----------------------------------------------------------------------------------------

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


# ---- staging -------------------------------------------------------------------------------------

def _payload(item: Item) -> dict[str, Any]:
    return {
        "key": item.parsed["key"],
        "group": item.group,
        "db_id": item.db_id,
        "changes": item.changes,
        "edited_in_dashboard": any(change["protected"] for change in item.changes),
        "location_note": item.note,
        "possible_rename": item.rename,
        "parsed": item.parsed,
    }


def _row_params(upload_id: int, entity: str, sheet_name: str | None, item: Item) -> dict[str, Any]:
    return {
        "upload_id": upload_id,
        "row_group": GROUP_COL[item.group],
        "entity": entity,
        "payload": json.dumps(_payload(item)),
        "sheet": sheet_name,
        "row_number": item.row_number,
        "status": item.status,
        "reason": item.reason,
        "raw": json.dumps(item.raw),
    }


def _missing_params(upload_id: int, entity: str, result: SheetResult, missing: DbSite) -> dict[str, Any]:
    rename = next((rename for rename in result.renames if rename["missing_dc_id"] == missing.id), None)
    payload = {
        "key": missing.name,
        "group": "missing",
        "db_id": missing.id,
        "in_use": missing.id in result.in_use,
        "possible_rename": rename,
    }
    return {
        "upload_id": upload_id,
        "row_group": "missing",
        "entity": entity,
        "payload": json.dumps(payload),
        "sheet": result.sheet_name,
        "row_number": None,
        "status": None,
        "reason": None,
        "raw": None,
    }


def _store_renames(db: Session, upload_id: int, renames: list[dict[str, Any]]) -> None:
    """Put each possible rename on both its new row and its missing row, now that the new rows have ids."""
    row_ids = dict(db.execute(text(NEW_DC_ROW_IDS_SQL), {"upload_id": upload_id}).all())
    for rename in renames:
        rename["new_row_id"] = row_ids.get(rename["new_row_number"])
        rename_json = json.dumps(rename)
        db.execute(text(SET_ROW_RENAME_SQL), {"rename": rename_json, "row_id": rename["new_row_id"]})
        missing_params = {
            "rename": rename_json,
            "upload_id": upload_id,
            "missing_dc_id": rename["missing_dc_id"],
        }
        db.execute(text(SET_MISSING_RENAME_SQL), missing_params)


def stage(db: Session, admin_id: int, filename: str, parsed: dict[str, ParsedSheet],
          add_only: bool = False) -> dict[str, Any]:
    """Store every row raw in upload_rows and the uploads row. Writes nothing else."""
    results = evaluate(db, parsed, add_only)
    summary = {
        "sheets": [results[kind].summary() for kind in SHEETS],
        "possible_renames": [],
        "applied": None,
        "add_only": add_only,
    }
    upload_params = {"user_id": admin_id, "filename": filename, "summary": json.dumps(summary)}
    upload_id = db.execute(text(INSERT_UPLOAD_SQL), upload_params).scalar_one()
    row_params = []
    for kind, result in results.items():
        entity = SHEETS[kind][2]
        for item in result.items:
            row_params.append(_row_params(upload_id, entity, result.sheet_name, item))
        for missing in result.missing:
            row_params.append(_missing_params(upload_id, entity, result, missing))
    if row_params:
        db.execute(text(INSERT_UPLOAD_ROW_SQL), row_params)
    renames = results["dcs"].renames
    if renames:
        _store_renames(db, upload_id, renames)
        summary["possible_renames"] = renames
        db.execute(text(UPDATE_SUMMARY_SQL), {"summary": json.dumps(summary), "upload_id": upload_id})
    db.commit()
    return {"upload_id": upload_id, "filename": filename, **summary}


def load_staged(db: Session, upload_id: int, summary: dict[str, Any]) -> dict[str, ParsedSheet]:
    out = {}
    for sheet in summary["sheets"]:
        out[sheet["kind"]] = ParsedSheet(sheet["kind"], sheet["sheet_name"], [], sheet["found"])
    kind_by_entity = {spec[2]: kind for kind, spec in SHEETS.items()}
    for row in db.execute(text(STAGED_ROWS_SQL), {"upload_id": upload_id}).mappings():
        item = Item(row["row_number"], row["raw"] or {}, row["payload"]["parsed"], id=row["id"])
        out[kind_by_entity[row["entity"]]].items.append(item)
    return out


# ---- apply ---------------------------------------------------------------------------------------

def _set_detail(details: dict[str, Any], key: str, value: Any) -> None:
    """Replace a detail whatever the spelling of its key; None removes it."""
    for existing in [existing for existing in details if norm(existing) == norm(key)]:
        del details[existing]
    if value is not None:
        details[key] = value


def _site_values(row: DbSite) -> dict[str, Any]:
    """Column values of a site as stored; the SQL parameters of UPDATE_SITE_SQL."""
    return {
        "id": row.id,
        "name": row.name,
        "kind": row.kind,
        "lat": row.lat,
        "lon": row.lon,
        "details": dict(row.details),
        "lrd_site_id": row.lrd_id,
        "active": row.active,
    }


def _apply_changes(kind: str, row: DbSite, item: Item, lrd_ids: dict[str, int],
                   warnings: list[str]) -> tuple[dict[str, Any], list[tuple]]:
    """Final column values for a site and the data_edits rows (field, old, new) actually applied."""
    final = _site_values(row)
    done: list[tuple] = []
    for change in item.changes:
        if change["protected"]:
            continue
        field_name = change["field"]
        new = change["new"]
        if field_name == "location":
            final["lat"] = item.parsed["lat"]
            final["lon"] = item.parsed["lon"]
        elif field_name == "lrd":
            if new not in lrd_ids:
                warnings.append(f"{item.parsed['key']}: LRD site {new} was not found; link kept")
                continue
            final["lrd_site_id"] = lrd_ids[new]
        elif field_name == "active":
            final["active"] = True
        elif field_name == "name":
            final["name"] = new
        elif field_name == "kind":
            final["kind"] = new
        else:
            _set_detail(final["details"], field_name.removeprefix("details."), new)
        done.append((field_name, change["old"], new))
    return final, done


def _edit_text(value: Any) -> str | None:
    """data_edits stores text; booleans as 'true' / 'false'."""
    if value is None:
        return None
    if isinstance(value, bool):
        return str(value).lower()
    return str(value)


def _new_site(kind: str, item: Item, lrd_site_id: int | None) -> dict[str, Any]:
    default_kind = "site" if kind == "sites" else "data_center"
    return {
        "name": item.parsed["key"],
        "kind": item.parsed.get("kind") or default_kind,
        "lat": item.parsed["lat"],
        "lon": item.parsed["lon"],
        "details": json.dumps(dict(item.parsed["details"])),
        "lrd_site_id": lrd_site_id,
    }


def _deactivated_site(missing: DbSite) -> dict[str, Any]:
    values = _site_values(missing)
    values["details"] = json.dumps(missing.details)
    values["active"] = False
    return values


def _write_sites(db: Session, admin_id: int, reason: str, inserts: list[dict[str, Any]],
                 updates: list[dict[str, Any]], edits: list[tuple]) -> None:
    if inserts:
        db.execute(text(INSERT_SITE_SQL), inserts)
    if updates:
        db.execute(text(UPDATE_SITE_SQL), updates)
    if edits:
        edit_params = [
            {
                "site_id": site_id,
                "field": field_name,
                "old_value": _edit_text(old),
                "new_value": _edit_text(new),
                "reason": reason,
                "user_id": admin_id,
            }
            for site_id, field_name, old, new in edits
        ]
        db.execute(text(INSERT_SITE_EDIT_SQL), edit_params)


def apply_sheet(
    db: Session,
    admin_id: int,
    kind: str,
    result: SheetResult,
    reason: str,
    pairs: dict[int, Item],
    warnings: list[str],
    protected: dict[int, set[str]],
    snapshot: dict[str, DbSite],
) -> dict[str, int]:
    out = dict.fromkeys(APPLY_COUNTERS, 0)
    by_id = {site.id: site for site in snapshot.values()}
    # DC links resolve against the database now, so sites inserted earlier in this transaction count
    lrd_ids: dict[str, int] = {}
    if kind == "dcs":
        lrd_ids = dict(db.execute(text(LRD_TARGETS_SQL)).all())
    renamed_new = {id(item) for item in pairs.values()}
    inserts: list[dict[str, Any]] = []
    updates: list[dict[str, Any]] = []
    edits: list[tuple] = []

    def record_update(row: DbSite, final: dict[str, Any], done: list[tuple]) -> None:
        updates.append({**final, "details": json.dumps(final["details"])})
        edits.extend((row.id, field_name, old, new) for field_name, old, new in done)

    for item in result.items:
        if item.group == "added" and id(item) not in renamed_new:
            lrd_site_id = None
            if kind == "dcs":
                lrd_site_id = lrd_ids.get(item.parsed["lrd"])
                if lrd_site_id is None:
                    key = item.parsed["key"]
                    lrd = item.parsed["lrd"]
                    warnings.append(f"{key}: LRD site {lrd} is not in the database; DC skipped")
                    out["skipped"] += 1
                    continue
            inserts.append(_new_site(kind, item, lrd_site_id))
        elif item.group == "changed":
            row = by_id[item.db_id]  # type: ignore[index]
            out["protected_kept"] += sum(change["protected"] for change in item.changes)
            final, done = _apply_changes(kind, row, item, lrd_ids, warnings)
            if done:
                out["changed"] += 1
                record_update(row, final, done)

    # possible renames chosen as "rename": update the existing DC, keep its history
    for missing_id, item in pairs.items():
        row = by_id[missing_id]
        item.changes = diff_fields(kind, item.parsed, row, protected)
        if item.parsed["key"] != row.name:
            name_protected = is_protected(protected, row.id, "name")
            name_change = {
                "field": "name",
                "old": row.name,
                "new": item.parsed["key"],
                "protected": name_protected,
            }
            item.changes.append(name_change)
        out["protected_kept"] += sum(change["protected"] for change in item.changes)
        final, done = _apply_changes(kind, row, item, lrd_ids, warnings)
        out["renamed"] += 1
        if done:
            record_update(row, final, done)

    for missing in result.missing:
        if missing.id in pairs:
            continue
        if missing.id in result.in_use:
            used_by = "is used by a segment, port or route"
            warnings.append(f"{missing.name} is missing from the file but {used_by}; kept active")
            out["kept_active"] += 1
        elif is_protected(protected, missing.id, "active"):
            out["protected_kept"] += 1
        else:
            updates.append(_deactivated_site(missing))
            edits.append((missing.id, "active", True, False))
            out["deactivated"] += 1

    _write_sites(db, admin_id, reason, inserts, updates, edits)
    out["added"] = len(inserts)
    return out


class ApplyError(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        self.message = message


def _check_request(upload: Any, override: dict[str, bool], reason: str | None, only: list[str] | None,
                   done: set[str]) -> None:
    if upload["status"] != "staged" and not only:
        raise ApplyError(409, "This upload was already applied")
    again = [kind for kind in (only or ()) if kind in done]
    if again:
        raise ApplyError(409, f"{', '.join(again)} was already applied from this upload")
    if any(override.values()) and not (reason or "").strip():
        raise ApplyError(422, "A reason is required to override the row-count check")


def _nothing_to_apply(results: dict[str, SheetResult]) -> ApplyError:
    blocked = [
        f"{kind}: {', '.join(result.block_reasons)}"
        for kind, result in results.items()
        if result.blocked
    ]
    return ApplyError(409, "Nothing can be applied: " + "; ".join(blocked))


def _check_renames(renames: list[dict[str, Any]], possible: dict[int, dict[str, Any]],
                   chosen: dict[int, dict[str, Any]], dcs_applied: bool) -> None:
    for missing_id, rename in chosen.items():
        if missing_id not in possible or possible[missing_id]["new_row_id"] != rename["new_row_id"]:
            row_id = rename["new_row_id"]
            message = f"Missing DC {missing_id} and row {row_id} are not a possible rename in this upload"
            raise ApplyError(422, message)
    if not dcs_applied:
        return
    decided = {rename["missing_dc_id"] for rename in renames}
    undecided = [rename for missing_id, rename in possible.items() if missing_id not in decided]
    if undecided:
        listed = "; ".join(
            f"{rename['missing_dc_name']} -> {rename['new_dc_name']} "
            f"(missing_dc_id {rename['missing_dc_id']}, new_row_id {rename['new_row_id']})"
            for rename in undecided
        )
        raise ApplyError(422, "Choose rename or separate for each possible rename: " + listed)


def _rename_pairs(chosen: dict[int, dict[str, Any]], items: list[Item]) -> dict[int, Item]:
    """Missing DC id to the staged new row the admin chose to rename it to."""
    pairs = {}
    for missing_id, rename in chosen.items():
        pairs[missing_id] = next(item for item in items if item.id == rename["new_row_id"])
    return pairs


def _sheet_outcomes(results: dict[str, SheetResult], applied_now: dict[str, dict[str, int]],
                    before: dict[str, Any], done: set[str]) -> dict[str, Any]:
    sheets = {}
    for kind in SHEETS:
        if kind in applied_now:
            sheets[kind] = {**applied_now[kind], "applied": True}
        elif kind in done:
            sheets[kind] = before[kind]
        else:
            sheets[kind] = {"applied": False, "block_reasons": results[kind].block_reasons}
    return sheets


def _applied_record(admin_id: int, sheets: dict[str, Any], earlier: dict[str, Any], warnings: list[str],
                    override: dict[str, bool], reason: str | None) -> dict[str, Any]:
    earlier_override = earlier.get("override_drop") or {}
    override_drop = {kind: bool(override.get(kind)) or bool(earlier_override.get(kind)) for kind in SHEETS}
    return {
        "by": admin_id,
        "at": datetime.now(UTC).isoformat(),
        "sheets": sheets,
        "warnings": earlier.get("warnings", []) + warnings,
        "override_drop": override_drop,
        "override_reason": reason or earlier.get("override_reason"),
    }


def apply_upload(db: Session, admin_id: int, upload_id: int, override: dict[str, bool], reason: str | None,
                 renames: list[dict[str, Any]], only: list[str] | None = None) -> dict[str, Any]:
    """Apply the named sheets (all when only is None).

    The upload stays staged until no sheet is left that can still be applied.
    """
    upload = db.execute(text(SITE_MASTER_UPLOAD_SQL), {"upload_id": upload_id}).mappings().first()
    if not upload:
        raise ApplyError(404, "Upload not found")
    earlier = upload["summary"].get("applied") or {}
    before = earlier.get("sheets", {})
    done = {kind for kind, sheet in before.items() if sheet.get("applied")}
    _check_request(upload, override, reason, only, done)

    staged = load_staged(db, upload_id, upload["summary"])
    results = evaluate(db, staged, bool(upload["summary"].get("add_only")))
    todo = [
        kind for kind in (only or SHEETS)
        if kind not in done and _can_apply(results[kind], bool(override.get(kind)))
    ]
    if not todo:
        raise _nothing_to_apply(results)
    chosen = {rename["missing_dc_id"]: rename for rename in renames if rename["decision"] == "rename"}
    possible = {rename["missing_dc_id"]: rename for rename in results["dcs"].renames}
    _check_renames(renames, possible, chosen, "dcs" in todo)

    why = f"{UPLOAD_REASON} {upload['filename']} #{upload_id}"
    snapshot = load_snapshot(db)
    protected = load_protected(db, "site", (UPLOAD_REASON,))
    warnings: list[str] = []
    applied_now: dict[str, dict[str, int]] = {}
    with db.begin_nested():  # all or nothing
        for kind in todo:
            pairs = {}
            if kind == "dcs":
                pairs = _rename_pairs(chosen, results["dcs"].items)
            applied_now[kind] = apply_sheet(
                db, admin_id, kind, results[kind], why, pairs, warnings, protected, snapshot
            )
        sheets = _sheet_outcomes(results, applied_now, before, done)
        applied = _applied_record(admin_id, sheets, earlier, warnings, override, reason)
        left = [kind for kind in SHEETS if not sheets[kind]["applied"] and _can_apply(results[kind], True)]
        for kind, override_on in override.items():
            if override_on and kind in applied_now:
                override_params = {
                    "upload_id": upload_id,
                    "sheet": kind,
                    "reason": (reason or "").strip(),
                    "user_id": admin_id,
                }
                db.execute(text(INSERT_OVERRIDE_EDIT_SQL), override_params)
        partial = bool(only) and bool(left)
        status = "staged" if partial else "confirmed"
        new_summary = dict(upload["summary"], applied=applied)
        finish_params = {"summary": json.dumps(new_summary), "upload_id": upload_id, "status": status}
        db.execute(text(FINISH_UPLOAD_SQL), finish_params)
    db.commit()
    invalidate_routes()
    return {"upload_id": upload_id, "sheets": sheets, "warnings": warnings, "complete": not partial}
