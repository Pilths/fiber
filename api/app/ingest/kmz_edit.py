"""Admin edits of KMZ groups and clusters. Nothing is deleted: hide a group, mark a cluster member removed.

Each changed field is one data_edits row with no upload_id (a dashboard edit). Callers pass the admin id.
"""
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.admin_edits.history import bool_text, log_edits_for_user
from app.errors import Conflict, Invalid, NotFound
from app.ingest.kmz_groups import CLUSTER_NAME_TAKEN_SQL, INSERT_MEMBER_SQL, target_must_exist

GROUP_FOR_UPDATE_SQL = """
SELECT id, name, colour_mode, hidden_at, hidden_by, segment_id, site_id, cluster_id FROM kmz_groups WHERE id = :group_id
FOR UPDATE
"""
SET_GROUP_SQL = """
UPDATE kmz_groups
SET name = :name, colour_mode = :colour_mode, segment_id = :segment_id, site_id = :site_id,
    cluster_id = :cluster_id, hidden_at = :hidden_at, hidden_by = :hidden_by
WHERE id = :group_id
"""
LIST_GROUPS_SQL = """
SELECT g.id, g.name, g.folder_path, g.colour_mode, g.hidden_at, g.segment_id, g.site_id, g.cluster_id,
       u.id AS upload_id, u.filename, u.created_at AS upload_created_at,
       count(e.id) FILTER (WHERE e.kind = 'line') AS lines,
       count(e.id) FILTER (WHERE e.kind = 'area') AS areas,
       count(e.id) FILTER (WHERE e.kind = 'point') AS points
FROM kmz_groups g
JOIN uploads u ON u.id = g.upload_id
LEFT JOIN kmz_elements e ON e.group_id = g.id
WHERE {column} = :target_id
GROUP BY g.id, u.id
ORDER BY g.id
"""
GROUP_COLUMNS = {"segment_id": "g.segment_id", "site_id": "g.site_id", "cluster_id": "g.cluster_id"}
CLUSTER_SQL = "SELECT id, name FROM clusters WHERE id = :cluster_id"
CLUSTER_FOR_UPDATE_SQL = CLUSTER_SQL + " FOR UPDATE"
CLUSTER_SITES_SQL = """
SELECT s.id, s.name FROM cluster_sites m JOIN sites s ON s.id = m.site_id
WHERE m.cluster_id = :cluster_id AND m.removed_at IS NULL ORDER BY s.name, s.id
"""
ALL_CLUSTERS_SQL = "SELECT id, name FROM clusters ORDER BY name"
ACTIVE_MEMBER_SQL = """
SELECT 1 FROM cluster_sites WHERE cluster_id = :cluster_id AND site_id = :site_id AND removed_at IS NULL
"""
REMOVE_MEMBER_SQL = """
UPDATE cluster_sites SET removed_at = now(), removed_by = :user_id
WHERE cluster_id = :cluster_id AND site_id = :site_id AND removed_at IS NULL
"""
RENAME_CLUSTER_SQL = "UPDATE clusters SET name = :name WHERE id = :cluster_id"


def target_text(row) -> str:
    for kind in ("segment", "site", "cluster"):
        if row[f"{kind}_id"] is not None:
            return f"{kind} {row[f'{kind}_id']}"
    return ""


def group_out(db: Session, group_id: int) -> dict:
    return list_groups_where(db, "g.id", group_id)[0]


def list_groups_where(db: Session, column: str, value: int) -> list[dict]:
    rows = db.execute(text(LIST_GROUPS_SQL.format(column=column)), {"target_id": value}).mappings()
    groups = []
    for row in rows:
        kind = "cluster"
        if row["segment_id"] is not None:
            kind = "segment"
        elif row["site_id"] is not None:
            kind = "site"
        groups.append({
            "id": row["id"],
            "name": row["name"],
            "folder_path": row["folder_path"],
            "counts": {"lines": row["lines"], "areas": row["areas"], "points": row["points"]},
            "colour_mode": row["colour_mode"],
            "hidden": row["hidden_at"] is not None,
            "hidden_at": row["hidden_at"],
            "target": {"kind": kind, "id": row[f"{kind}_id"]},
            "upload": {"id": row["upload_id"], "filename": row["filename"], "created_at": row["upload_created_at"]},
        })
    return groups


def groups_for(db: Session, segment_id: int | None, site_id: int | None, cluster_id: int | None) -> list[dict]:
    given = {"segment_id": segment_id, "site_id": site_id, "cluster_id": cluster_id}
    given = {column: value for column, value in given.items() if value is not None}
    if len(given) != 1:
        raise Invalid("give exactly one of segment_id, site_id, cluster_id")
    [(column, value)] = given.items()
    return list_groups_where(db, GROUP_COLUMNS[column], value)


def edit_group(db: Session, admin_id: int, group_id: int, changes: dict, remarks: str) -> dict:
    """changes holds only the fields the caller sent: name, hidden, colour_mode, target."""
    row = db.execute(text(GROUP_FOR_UPDATE_SQL), {"group_id": group_id}).mappings().first()
    if row is None:
        raise NotFound("KMZ group not found")
    values = {
        "group_id": group_id,
        "name": row["name"],
        "colour_mode": row["colour_mode"],
        "segment_id": row["segment_id"],
        "site_id": row["site_id"],
        "cluster_id": row["cluster_id"],
        "hidden_at": row["hidden_at"],
        "hidden_by": row["hidden_by"],
    }
    edits = []
    if "name" in changes:
        name = (changes["name"] or "").strip()
        if not name:
            raise Invalid("name cannot be empty")
        if name != row["name"]:
            edits.append(("name", row["name"], name))
            values["name"] = name
    if changes.get("colour_mode") is not None and changes["colour_mode"] != row["colour_mode"]:
        edits.append(("colour_mode", row["colour_mode"], changes["colour_mode"]))
        values["colour_mode"] = changes["colour_mode"]
    target = changes.get("target")
    if target is not None:
        target_must_exist(db, target["kind"], target["id"])
        old_target = target_text(row)
        new_target = f"{target['kind']} {target['id']}"
        if new_target != old_target:
            edits.append(("target", old_target, new_target))
            for kind in ("segment", "site", "cluster"):
                values[f"{kind}_id"] = target["id"] if kind == target["kind"] else None
    hidden = changes.get("hidden")
    if hidden is not None and hidden != (row["hidden_at"] is not None):
        edits.append(("hidden", bool_text(not hidden), bool_text(hidden)))
        values["hidden_at"] = datetime.now(timezone.utc) if hidden else None
        values["hidden_by"] = admin_id if hidden else None
    if edits:
        db.execute(text(SET_GROUP_SQL), values)
        log_edits_for_user(db, admin_id, "kmz_group", group_id, edits, remarks)
    return group_out(db, group_id)


def cluster_out(db: Session, cluster_id: int) -> dict:
    row = db.execute(text(CLUSTER_SQL), {"cluster_id": cluster_id}).mappings().first()
    sites = db.execute(text(CLUSTER_SITES_SQL), {"cluster_id": cluster_id}).mappings()
    return {"id": row["id"], "name": row["name"], "sites": [dict(site) for site in sites]}


def all_clusters(db: Session) -> list[dict]:
    return [cluster_out(db, row["id"]) for row in db.execute(text(ALL_CLUSTERS_SQL)).mappings().all()]


def lock_cluster(db: Session, cluster_id: int):
    row = db.execute(text(CLUSTER_FOR_UPDATE_SQL), {"cluster_id": cluster_id}).mappings().first()
    if row is None:
        raise NotFound("Cluster not found")
    return row


def is_active_member(db: Session, cluster_id: int, site_id: int) -> bool:
    parameters = {"cluster_id": cluster_id, "site_id": site_id}
    return db.execute(text(ACTIVE_MEMBER_SQL), parameters).first() is not None


def add_site(db: Session, admin_id: int, cluster_id: int, site_id: int, remarks: str) -> dict:
    lock_cluster(db, cluster_id)
    target_must_exist(db, "site", site_id)
    if is_active_member(db, cluster_id, site_id):
        raise Conflict("site is already in the cluster")
    parameters = {"cluster_id": cluster_id, "site_id": site_id, "user_id": admin_id}
    db.execute(text(INSERT_MEMBER_SQL), parameters)
    log_edits_for_user(db, admin_id, "cluster", cluster_id, [("site_added", None, site_id)], remarks)
    return cluster_out(db, cluster_id)


def remove_site(db: Session, admin_id: int, cluster_id: int, site_id: int, remarks: str) -> None:
    lock_cluster(db, cluster_id)
    parameters = {"cluster_id": cluster_id, "site_id": site_id, "user_id": admin_id}
    if db.execute(text(REMOVE_MEMBER_SQL), parameters).rowcount == 0:
        raise NotFound("site is not in the cluster")
    log_edits_for_user(db, admin_id, "cluster", cluster_id, [("site_removed", site_id, None)], remarks)


def rename_cluster(db: Session, admin_id: int, cluster_id: int, name: str, remarks: str) -> dict:
    row = lock_cluster(db, cluster_id)
    name = name.strip()
    if not name:
        raise Invalid("name cannot be empty")
    if name == row["name"]:
        return cluster_out(db, cluster_id)
    if name.lower() != row["name"].lower():
        if db.execute(text(CLUSTER_NAME_TAKEN_SQL), {"name": name}).first() is not None:
            raise Conflict(f"cluster '{name}' already exists")
    db.execute(text(RENAME_CLUSTER_SQL), {"name": name, "cluster_id": cluster_id})
    log_edits_for_user(db, admin_id, "cluster", cluster_id, [("name", row["name"], name)], remarks)
    return cluster_out(db, cluster_id)
