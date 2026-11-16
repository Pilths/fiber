"""Apply a staged upload to the sites table, all or nothing, with a data_edits row per change."""
import json
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.ingest.checks import norm
from app.ingest.site_master.evaluate import (
    evaluate,
    is_protected,
    load_protected,
    load_snapshot,
)
from app.ingest.site_master.model import (
    APPLY_COUNTERS,
    SHEETS,
    UPLOAD_REASON,
    DbSite,
    Item,
    SheetResult,
    _can_apply,
)
from app.ingest.site_master.stage import load_staged
from app.routing.graph import invalidate as invalidate_routes

INSERT_SITE_SQL = """
INSERT INTO sites (name, kind, geom, details)
VALUES (:name, :kind,
        ST_SetSRID(ST_MakePoint(CAST(:lon AS double precision), CAST(:lat AS double precision)), 4326),
        CAST(:details AS jsonb))
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


def _apply_changes(row: DbSite, item: Item) -> tuple[dict[str, Any], list[tuple]]:
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
        elif field_name == "active":
            final["active"] = True
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


def _new_site(item: Item) -> dict[str, Any]:
    return {
        "name": item.parsed["key"],
        "kind": item.parsed.get("kind") or "site",
        "lat": item.parsed["lat"],
        "lon": item.parsed["lon"],
        "details": json.dumps(dict(item.parsed["details"])),
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
    result: SheetResult,
    reason: str,
    warnings: list[str],
    protected: dict[int, set[str]],
    snapshot: dict[str, DbSite],
) -> dict[str, int]:
    out = dict.fromkeys(APPLY_COUNTERS, 0)
    by_id = {site.id: site for site in snapshot.values()}
    inserts: list[dict[str, Any]] = []
    updates: list[dict[str, Any]] = []
    edits: list[tuple] = []

    def record_update(row: DbSite, final: dict[str, Any], done: list[tuple]) -> None:
        updates.append({**final, "details": json.dumps(final["details"])})
        edits.extend((row.id, field_name, old, new) for field_name, old, new in done)

    for item in result.items:
        if item.group == "added":
            inserts.append(_new_site(item))
        elif item.group == "changed":
            row = by_id[item.db_id]  # type: ignore[index]
            out["protected_kept"] += sum(change["protected"] for change in item.changes)
            final, done = _apply_changes(row, item)
            if done:
                out["changed"] += 1
                record_update(row, final, done)

    for missing in result.missing:
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


def _check_request(upload: Any, override: dict[str, bool], reason: str | None, only: Sequence[str] | None,
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
                 only: Sequence[str] | None = None) -> dict[str, Any]:
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

    why = f"{UPLOAD_REASON} {upload['filename']} #{upload_id}"
    snapshot = load_snapshot(db)
    protected = load_protected(db, "site", (UPLOAD_REASON,))
    warnings: list[str] = []
    applied_now: dict[str, dict[str, int]] = {}
    with db.begin_nested():  # all or nothing
        for kind in todo:
            applied_now[kind] = apply_sheet(db, admin_id, results[kind], why, warnings, protected, snapshot)
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
