"""Staging: store every row raw in upload_rows, and read staged rows back."""
import json
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.ingest.site_master.evaluate import evaluate
from app.ingest.site_master.model import GROUP_COL, SHEETS, DbSite, Item, ParsedSheet, SheetResult

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
