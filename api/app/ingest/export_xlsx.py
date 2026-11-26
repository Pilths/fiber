"""Export live Sites and Segments as one locked workbook the upload reads back unchanged.

Keys (site_name, Link) and headers are locked; the other cells are open with validation.
Sheet protection stops accidents, not people: it has no password. The upload still checks every row.
"""
import io

import openpyxl
from openpyxl.styles import Protection
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.worksheet import Worksheet
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.load_data import SEGMENTS, SITES

KIND_TO_TYPE = {"site": "Trunk", "building": "Trunk", "data_center": "DC", "toc": "TOC"}
SELECT_SITES = """
    SELECT name, ST_Y(geom) AS lat, ST_X(geom) AS lon, kind FROM sites WHERE active ORDER BY name
"""
SELECT_SEGMENTS = """
    SELECT a.name AS site_a, b.name AS site_b, s.distance_km, s.route, s.section, s.survey_cores, s.cable_size
    FROM segments s JOIN sites a ON a.id = s.site_a_id JOIN sites b ON b.id = s.site_b_id
    ORDER BY a.name, b.name
"""
SITES_WITHOUT_REGION = [header for header in SITES if header != "region"]  # region is never stored for a site


def _validation(ws: Worksheet, kind: str, formula: str, cells: str, message: str) -> None:
    rule = DataValidation(type=kind, formula1=formula, allow_blank=True, showErrorMessage=True,
                          errorTitle="Not accepted", error=message)
    if kind == "custom":
        rule.type = "custom"
    ws.add_data_validation(rule)
    rule.add(cells)


def _open_columns(ws: Worksheet, first_open: int, last_row: int) -> None:
    for row in ws.iter_rows(min_row=2, max_row=last_row, min_col=first_open, max_col=ws.max_column):
        for cell in row:
            cell.protection = Protection(locked=False)
    ws.protection.sheet = True


def _sites_sheet(ws: Worksheet, db: Session) -> None:
    ws.append(SITES_WITHOUT_REGION)
    for row in db.execute(text(SELECT_SITES)).mappings():
        ws.append([row["name"], row["lat"], row["lon"], KIND_TO_TYPE.get(row["kind"], "Trunk")])
    last = max(ws.max_row, 2)
    _validation(ws, "decimal", "-90", f"B2:B{last}", "Latitude is a number")
    ws.data_validations.dataValidation[-1].operator = "between"
    ws.data_validations.dataValidation[-1].formula2 = "90"
    _validation(ws, "decimal", "-180", f"C2:C{last}", "Longitude is a number")
    ws.data_validations.dataValidation[-1].operator = "between"
    ws.data_validations.dataValidation[-1].formula2 = "180"
    _validation(ws, "list", '"Trunk,DC,TOC"', f"D2:D{last}", "Pick Trunk, DC or TOC")
    _open_columns(ws, 2, last)


def _segments_sheet(ws: Worksheet, db: Session) -> None:
    ws.append(SEGMENTS)
    for row in db.execute(text(SELECT_SEGMENTS)).mappings():
        distance = float(row["distance_km"]) if row["distance_km"] is not None else None
        ws.append([f"{row['site_a']}-{row['site_b']}", distance, row["route"], row["section"],
                   row["survey_cores"], row["cable_size"]])
    last = max(ws.max_row, 2)
    _validation(ws, "decimal", "0", f"B2:B{last}", "Distance is a number, 0 or more")
    ws.data_validations.dataValidation[-1].operator = "greaterThanOrEqual"
    cores_ok = "AND(ISNUMBER({c}2),{c}2=INT({c}2),{c}2>0)"
    _validation(ws, "custom", f"AND({cores_ok.format(c='E')},OR(F2=\"\",E2<=F2))", f"E2:E{last}",
                "Whole number above 0, not more than Total cores")
    _validation(ws, "custom", cores_ok.format(c="F"), f"F2:F{last}", "Whole number above 0")
    _open_columns(ws, 2, last)


def build_workbook(db: Session) -> bytes:
    wb = openpyxl.Workbook()
    sites = wb.active
    sites.title = "Sites"  # type: ignore[union-attr]
    _sites_sheet(sites, db)  # type: ignore[arg-type]
    _segments_sheet(wb.create_sheet("Segments"), db)
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()
