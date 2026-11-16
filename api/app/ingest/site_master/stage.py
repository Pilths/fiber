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
STAGED_ROWS_SQL = """
SELECT id, entity, row_number, raw, payload FROM upload_rows
WHERE upload_id = :upload_id AND entity = 'site' AND row_group <> 'missing' ORDER BY id
"""


def _payload(item: Item) -> dict[str, Any]:
    return {
        "key": item.parsed["key"],
        "group": item.group,
        "db_id": item.db_id,
        "changes": item.changes,
        "edited_in_dashboard": any(change["protected"] for change in item.changes),
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
    payload = {
        "key": missing.name,
        "group": "missing",
        "db_id": missing.id,
        "in_use": missing.id in result.in_use,
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


def stage(db: Session, admin_id: int, filename: str, parsed: dict[str, ParsedSheet],
          add_only: bool = False) -> dict[str, Any]:
    """Store every row raw in upload_rows and the uploads row. Writes nothing else."""
    results = evaluate(db, parsed, add_only)
    summary = {
        "sheets": [results[kind].summary() for kind in SHEETS],
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
    db.commit()
    return {"upload_id": upload_id, "filename": filename, **summary}


def load_staged(db: Session, upload_id: int, summary: dict[str, Any]) -> dict[str, ParsedSheet]:
    out = {}
    for sheet in summary["sheets"]:
        if sheet["kind"] in SHEETS:  # an old upload may list a DC List sheet; it is no longer applied
            out[sheet["kind"]] = ParsedSheet(sheet["kind"], sheet["sheet_name"], [], sheet["found"])
    kind_by_entity = {spec[2]: kind for kind, spec in SHEETS.items()}
    for row in db.execute(text(STAGED_ROWS_SQL), {"upload_id": upload_id}).mappings():
        item = Item(row["row_number"], row["raw"] or {}, row["payload"]["parsed"], id=row["id"])
        out[kind_by_entity[row["entity"]]].items.append(item)
    return out
