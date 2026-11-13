"""Apply a staged upload to the sites table, all or nothing, with a data_edits row per change."""
import json
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.ingest.checks import norm
from app.ingest.site_master.evaluate import (
    diff_fields,
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

# Sites a Site Location DC can hang off: every site except Site Location DCs themselves
# (those have an LRD site)
LRD_TARGETS_SQL = "SELECT name, id FROM sites WHERE NOT (kind = 'data_center' AND lrd_site_id IS NOT NULL)"
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
