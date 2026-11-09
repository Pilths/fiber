"""Parse the sample workbook (sheets Reservation, Site Location, DC List) into row results.

Reads only; never raises on a row.
"""
import itertools
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

import openpyxl
from openpyxl.utils.datetime import from_excel

from app.ingest import checks
from app.ingest.checks import blank, clean, norm

SITE_HEADER_ROW = 4
SRF_HEADERS = ("srf", "srf id", "srf no", "srf number", "srf ref")  # optional header, any one
SITE_COLUMNS = ("site_name", "latitude_in_decimal", "longitude_in_decimal")
DC_COLUMNS = ("dc name / link", "lat", "long")


@dataclass
class RowResult:
    sheet: str
    row_number: int
    raw: dict[str, Any]
    parsed: dict[str, Any] = field(default_factory=dict)
    status: str = "ready"
    reason: str | None = None


def _json(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def _float(value: Any) -> float | None:
    if blank(value):
        return None
    return float(str(value).strip())


def _date(value: Any) -> date | None:
    if blank(value):
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, (int, float)):
        return from_excel(value).date()
    return date.fromisoformat(str(value).strip())


def _text(value: Any) -> str | None:
    if blank(value):
        return None
    return str(value).strip()


def _header_text(value: Any) -> str:
    if blank(value):
        return ""
    return " ".join(str(clean(value)).split())


def _merged_values(ws: Any) -> dict[tuple[int, int], Any]:
    """Every cell of a merged range, mapped to the value of its top-left cell."""
    merged: dict[tuple[int, int], Any] = {}
    for cell_range in ws.merged_cells.ranges:
        value = ws.cell(cell_range.min_row, cell_range.min_col).value
        rows = range(cell_range.min_row, cell_range.max_row + 1)
        columns = range(cell_range.min_col, cell_range.max_col + 1)
        for position in itertools.product(rows, columns):
            merged[position] = value
    return merged


def _read(ws: Any, header_row: int) -> tuple[list[str], list[tuple[int, list[Any]]]]:
    """Header texts and (row number, values), with merged cells filled from their top-left cell."""
    merged = _merged_values(ws)
    rows = []
    for cells in ws.iter_rows(min_row=header_row):
        values = [merged.get((cell.row, cell.column), cell.value) for cell in cells]
        rows.append((cells[0].row, values))
    if not rows:
        return [], []
    headers = [_header_text(value) for value in rows[0][1]]
    return headers, rows[1:]


def _sheet(wb: Any, name: str) -> Any:
    for ws in wb.worksheets:
        if norm(ws.title) == norm(name):
            return ws
    return None


def _header_row(ws: Any, anchor: str) -> int | None:
    """Number of the first row, top to bottom, that holds the anchor header in any column.

    None when no row does.
    """
    for cells in ws.iter_rows():
        if any(not blank(cell.value) and norm(cell.value) == anchor for cell in cells):
            return cells[0].row
    return None


def _row(
    sheet: str, row_number: int, headers: list[str], values: list[Any]
) -> tuple[RowResult, dict[str, Any]]:
    raw = {header: _json(value) for header, value in zip(headers, values) if header}
    fields = {norm(header): clean(value) for header, value in zip(headers, values) if header}
    return RowResult(sheet, row_number, raw), fields


def _finish(row: RowResult, reasons: list[str], reject: bool = False) -> None:
    row.reason = "; ".join(reasons) or None
    if reject:
        row.status = "rejected"
    elif reasons:
        row.status = "needs_review"
    else:
        row.status = "ready"


def _guard(row: RowResult, parse: Any, *args: Any) -> None:
    try:
        parse(*args)
    except Exception as error:  # noqa: BLE001  a bad row never stops the import
        row.parsed = {}
        row.status = "needs_review"
        row.reason = f"could not parse row: {type(error).__name__}: {error}"


def _is_group_label(filled: list[Any], fields: dict[str, Any]) -> bool:
    """A row with one text cell and no Nodes is a label for the rows below it."""
    return len(filled) == 1 and isinstance(filled[0], str) and blank(fields.get("nodes"))


def _reservations(ws: Any, known: set[str]) -> list[RowResult]:
    # Nodes is the anchor header; other columns sit beside it
    headers, rows = _read(ws, _header_row(ws, "nodes") or 1)
    out: list[RowResult] = []
    label: str | None = None
    for row_number, values in rows:
        filled = [value for value in values if not blank(value)]
        if not filled:
            continue
        row, fields = _row("Reservation", row_number, headers, values)
        if _is_group_label(filled, fields):
            label = filled[0].strip()
            continue
        _guard(row, _reservation, row, fields, label, known)
        out.append(row)
    return out


def _core_count(count: Any) -> int | None:
    """A whole number of 1 or more, else None."""
    try:
        number = float(str(count).strip())
    except ValueError:
        return None
    if number < 1 or number != int(number):
        return None
    return int(number)


def _read_columns(
    parsed: dict[str, Any], fields: dict[str, Any], columns: list[tuple[str, str, Any]], reasons: list[str]
) -> None:
    for key, column, convert in columns:
        try:
            parsed[key] = convert(fields.get(column))
        except ValueError:
            parsed[key] = None
            reasons.append(f"cannot read {column} '{fields.get(column)}'")


def _read_test_result(parsed: dict[str, Any], fields: dict[str, Any], reasons: list[str]) -> None:
    """Optional columns (not in the sample workbook): a test result for the segment."""
    for key, column, convert in [("loss_db", "loss (db)", _float), ("tested_on", "tested on", _date)]:
        # the header may be written with or without a space before the bracket
        value = fields.get(column, fields.get(column.replace(" (", "(")))
        try:
            parsed[key] = convert(value)
        except ValueError:
            parsed[key] = None
            reasons.append(f"cannot read {column} '{fields.get(column)}'")


def _reservation(row: RowResult, fields: dict[str, Any], label: str | None, known: set[str]) -> None:
    reasons: list[str] = []
    no_customer = checks.check_requestor(fields.get("fiber core requestor"))
    # Region belongs to the segment, which the segment list already made, so a blank one is fine
    region = None
    if not blank(fields.get("region")):
        region, why = checks.map_region(fields.get("region"))
        if why:
            reasons.append(why)
    nodes = checks.split_nodes(fields.get("nodes"))
    parsed: dict[str, Any] = {"group_label": label, "region": region}
    row.parsed = parsed
    if nodes:
        parsed["site_a"] = nodes[0]
        parsed["site_b"] = nodes[1]
        parsed["additional"] = nodes[2]
        if why := checks.check_known_sites(nodes[:2], known):
            reasons.append(why)
    else:
        reasons.append("Nodes is not in the form AABB-BBCC")

    # every row is a count-only reservation; Core assignment and Port info stay raw
    # (ports are added by hand later)
    count = fields.get("no of core requested")
    parsed["unassigned_cores"] = 0
    if blank(count):
        reasons.append("No of core requested is blank")
    else:
        cores = _core_count(count)
        if cores is None:
            reasons.append(f"No of core requested '{count}' is not a whole number of 1 or more")
        else:
            parsed["unassigned_cores"] = cores

    parsed["customer"] = _text(fields.get("fiber core requestor"))
    parsed["contractor"] = _text(fields.get("contractor"))
    parsed["remark"] = _text(fields.get("remark"))
    srf_value = next((fields[header] for header in SRF_HEADERS if header in fields), None)
    parsed["srf_id"] = _text(srf_value)
    parsed["port_info_raw"] = _text(fields.get("port info"))
    parsed["monitoring_code"] = _text(fields.get("fiber core monitoring"))

    # the sample workbook spells the header "montiored"; accept both
    monitored = _text(fields.get("fiber montiored y/n/wip", fields.get("fiber monitored y/n/wip")))
    if monitored is None:
        parsed["fiber_monitored"] = None
    else:
        parsed["fiber_monitored"] = monitored.upper()
    if parsed["fiber_monitored"] not in (None, "Y", "N", "WIP"):
        reasons.append(f"fiber monitored '{monitored}' is not Y, N or WIP")

    columns = [
        ("distance_km", "distance(km)", _float),
        ("survey_cores", "core secured", _float),
        ("cv_ready_date", "expected cv ready", _date),
        ("planned_date", "fiber core request date", _date),
    ]
    _read_columns(parsed, fields, columns, reasons)
    if parsed["survey_cores"] is not None:
        parsed["survey_cores"] = int(parsed["survey_cores"])
    _read_test_result(parsed, fields, reasons)

    if no_customer:
        reasons.insert(0, no_customer)
    _finish(row, reasons, reject=bool(no_customer))


def _parse_site(
    row: RowResult,
    fields: dict[str, Any],
    name: str,
    headers: list[Any],
    values: Any,
    dc: bool,
    columns: tuple[str, str, str],
    own: set[str],
    seen: set[str],
) -> None:
    _, lat_column, lon_column = columns
    reasons = []
    lat = _float(fields.get(lat_column))
    lon = _float(fields.get(lon_column))
    if why := checks.check_coords(lat, lon):
        reasons.append(why)
    if name in seen:
        reasons.append("duplicate site name")
    seen.add(name)
    details = {
        header: _json(value)
        for header, value in zip(headers, values)
        if header and norm(header) not in own and not blank(value)
    }
    kind = "data_center" if dc else "site"
    row.parsed = {"name": name, "kind": kind, "lat": lat, "lon": lon, "details": details}
    if dc:
        row.parsed["lrd"] = _text(fields.get("lrd"))
    _finish(row, reasons)


def _sites(ws: Any, header_row: int, sheet: str, seen: set[str]) -> list[RowResult]:
    headers, rows = _read(ws, header_row)
    out: list[RowResult] = []
    dc = sheet == "DC List"
    columns = DC_COLUMNS if dc else SITE_COLUMNS
    name_column = columns[0]
    own: set[str] = set(columns)
    if dc:
        own.add("lrd")
    for row_number, values in rows:
        row, fields = _row(sheet, row_number, headers, values)
        if blank(fields.get(name_column)):
            continue
        name = str(fields[name_column]).strip()
        _guard(row, _parse_site, row, fields, name, headers, values, dc, columns, own, seen)
        out.append(row)
    return out


def _reservation_sheet(wb: Any) -> Any:
    """The sheet named Reservation, else the first sheet with a Nodes column, else None."""
    ws = _sheet(wb, "Reservation")
    if ws is not None:
        return ws
    for candidate in wb.worksheets:
        if _header_row(candidate, "nodes"):
            return candidate
    return None


def parse_reservation_workbook(path: Any) -> tuple[list[RowResult], list[str]]:
    """Reservation sheet only (the site master comes from its own upload).

    Returns rows and the names of the sheets left out. Site codes are not judged here: the upload checks them
    against the database.
    """
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = _reservation_sheet(wb)
    if ws is None:
        raise ValueError("no Reservation sheet found, and no sheet has a Nodes column")
    left_out = [other.title for other in wb.worksheets if other is not ws]
    return _reservations(ws, set()), left_out


def _check_dc_lrd_sites(rows: list[RowResult], known: set[str]) -> None:
    for row in rows:
        lrd = row.parsed.get("lrd")
        if row.sheet != "DC List" or not lrd:
            continue
        why = checks.check_known_sites([lrd], known)
        if why:
            row.status = "needs_review"
            row.reason = "; ".join(filter(None, [row.reason, why]))


def parse_workbook(path: Any, known_sites: set[str] | None = None) -> list[RowResult]:
    """Rows of Site Location, DC List and Reservation (in that order). Monitoring is skipped.

    Site codes are judged against known_sites plus every site name listed in the workbook;
    with neither, no judgement.
    """
    wb = openpyxl.load_workbook(path, data_only=True)
    out: list[RowResult] = []
    seen: set[str] = set()
    for sheet, header_row in [("Site Location", SITE_HEADER_ROW), ("DC List", 1)]:
        ws = _sheet(wb, sheet)
        if ws:
            out += _sites(ws, header_row, sheet, seen)
    known = set(known_sites or ())
    known |= {row.parsed["name"] for row in out if "name" in row.parsed}
    _check_dc_lrd_sites(out, known)
    ws = _sheet(wb, "Reservation")
    if ws:
        out += _reservations(ws, known)
    return out
