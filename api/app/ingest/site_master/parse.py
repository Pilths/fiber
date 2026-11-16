"""Read the site master workbook: find the sheets by their headers and parse every row."""
from typing import Any

import openpyxl

from app.ingest import checks
from app.ingest.checks import blank, clean
from app.ingest.excel import _json
from app.ingest.site_master.model import (
    SHEETS,
    SITE_KINDS,
    Item,
    ParsedSheet,
    _cell_text,
    _num,
    hkey,
    isblank,
)


def _header_text(value: Any) -> str:
    if blank(value):
        return ""
    return " ".join(str(clean(value)).split())


def _find_sheet(wb: Any, kind: str, taken: set[str]) -> tuple[Any, int, list[str]] | None:
    """Scan each sheet top to bottom, any row and column, for the name header (site_name).

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


def _coordinate_problem(lat: float | None, lon: float | None, lat_error: str | None,
                        lon_error: str | None) -> str | None:
    if lat_error:
        return f"latitude {lat_error}"
    if lon_error:
        return f"longitude {lon_error}"
    return checks.check_coords(lat, lon)


def _site_kind(site_type: Any) -> str | None:
    if isblank(site_type):
        return "site"
    return SITE_KINDS.get(str(site_type).strip().casefold())


def _normalise_cluster(details: dict[str, Any]) -> None:
    """Cluster is optional: key always "cluster", spaces trimmed and collapsed, blank not stored."""
    for header in [header for header in details if hkey(header) == "cluster"]:
        value = " ".join(str(details.pop(header)).split())
        if value:
            details["cluster"] = value


def _parse_row(kind: str, headers: list[str], values: tuple[Any, ...]) -> Item:
    own = SHEETS[kind][3]
    raw = {header: _json(value) for header, value in zip(headers, values) if header and not blank(value)}
    item = Item(0, raw, {})  # raw, as read
    values = tuple(clean(value) for value in values)
    fields = {hkey(header): value for header, value in zip(headers, values) if header}
    reasons: list[str] = []

    key = _cell_text(fields.get("sitename"))
    lat, lat_error = _num(fields.get("latitudeindecimal"))
    lon, lon_error = _num(fields.get("longitudeindecimal"))
    coordinate_problem = _coordinate_problem(lat, lon, lat_error, lon_error)
    if coordinate_problem:
        lat = None
        lon = None

    details = {
        header: _json(value)
        for header, value in zip(headers, values)
        if header and hkey(header) not in own and not isblank(value)
    }
    _normalise_cluster(details)
    parsed: dict[str, Any] = {"key": key, "lat": lat, "lon": lon, "details": details}
    if not key:
        reasons.append("site_name is blank")
    if coordinate_problem:
        reasons.append(coordinate_problem)
    # no Type column: parsed has no "kind" and existing kinds are left alone
    if "type" in fields:
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
    """The Sites sheet of the site master workbook; other sheets (such as an old DC List) are ignored.

    No matching sheet comes back found=False. Never raises on a row.
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
