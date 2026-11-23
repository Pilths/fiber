"""KMZ groups: one group is one KML folder of elements the admin may attach to a segment, a site or a cluster.

describe_groups gives each folder its default target for the preview (never a guess: a folder that is not named
like a site or a cluster is "skip" and Needs review). check_choices validates what the admin picked and
save_groups writes it, in the caller's transaction. Every write is a data_edits row with the upload_id.
"""
import json

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.admin_edits.history import log_edits_for_user
from app.errors import Conflict, Invalid

ACTIVE_SITES_SQL = "SELECT id, name FROM sites WHERE active"
CLUSTERS_SQL = "SELECT id, name FROM clusters"
SITES_IN_AREAS_SQL = """
SELECT s.id FROM sites s
WHERE s.active AND s.geom IS NOT NULL
AND EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(CAST(:areas AS jsonb)) AS area
    WHERE ST_Intersects(s.geom, ST_SetSRID(ST_GeomFromGeoJSON(area), 4326))
)
ORDER BY s.id
"""
TARGET_EXISTS_SQL = {
    "segment": "SELECT 1 FROM segments WHERE id = :id",
    "site": "SELECT 1 FROM sites WHERE id = :id",
    "cluster": "SELECT 1 FROM clusters WHERE id = :id",
}
CLUSTER_NAME_TAKEN_SQL = "SELECT 1 FROM clusters WHERE lower(name) = lower(:name)"
INSERT_CLUSTER_SQL = "INSERT INTO clusters (name, created_by) VALUES (:name, :user_id) RETURNING id"
INSERT_MEMBER_SQL = """
INSERT INTO cluster_sites (cluster_id, site_id, created_by) VALUES (:cluster_id, :site_id, :user_id)
ON CONFLICT DO NOTHING RETURNING site_id
"""
INSERT_GROUP_SQL = """
INSERT INTO kmz_groups (upload_id, name, folder_path, segment_id, site_id, cluster_id, colour_mode, created_by)
VALUES (:upload_id, :name, :folder_path, :segment_id, :site_id, :cluster_id, :colour_mode, :user_id)
RETURNING id
"""
INSERT_ELEMENT_SQL = """
INSERT INTO kmz_elements (group_id, name, kind, geom, kmz_style)
VALUES (:group_id, :name, :kind, ST_SetSRID(ST_GeomFromGeoJSON(:geometry), 4326), CAST(:style AS jsonb))
"""


def member_site_ids(db: Session, elements: list[dict]) -> list[int]:
    """Active sites that touch one of the group's areas."""
    areas = [json.dumps(element["geometry"]) for element in elements if element["kind"] == "area"]
    if not areas:
        return []
    rows = db.execute(text(SITES_IN_AREAS_SQL), {"areas": json.dumps(areas)})
    return [row[0] for row in rows]


def ids_by_name(db: Session, sql: str) -> dict[str, list[int]]:
    """Ids per lower-case trimmed name (a list, because two rows may share a name)."""
    found: dict[str, list[int]] = {}
    for row in db.execute(text(sql)):
        found.setdefault(row[1].strip().lower(), []).append(row[0])
    return found


def default_target(name: str, sites: dict, clusters: dict) -> tuple[str, int | None, str, str | None]:
    """(target, target id, status, reason) from the folder name."""
    key = name.strip().lower()
    site_ids = sites.get(key, [])
    cluster_ids = clusters.get(key, [])
    if len(site_ids) + len(cluster_ids) > 1:
        return "skip", None, "Needs review", "the name matches more than one site or cluster"
    if site_ids:
        return "site", site_ids[0], "Ready", None
    if cluster_ids:
        return "cluster", cluster_ids[0], "Ready", None
    return "skip", None, "Needs review", "pick a target"


def describe_groups(db: Session, raw_groups: list[dict]) -> list[dict]:
    """Add the default target, status and cluster candidates to each group. Saves nothing."""
    sites = ids_by_name(db, ACTIVE_SITES_SQL)
    clusters = ids_by_name(db, CLUSTERS_SQL)
    described = []
    for group in raw_groups:
        target, target_id, status, reason = default_target(group["name"], sites, clusters)
        if group["outside_malaysia"]:
            target, target_id, status, reason = "skip", None, "Needs review", "outside Malaysia"
        described.append({
            **group,
            "default_target": target,
            "default_target_id": target_id,
            "status": status,
            "reason": reason,
            "member_site_ids": member_site_ids(db, group["elements"]),
        })
    return described


def target_must_exist(db: Session, target: str, target_id: int) -> None:
    if db.execute(text(TARGET_EXISTS_SQL[target]), {"id": target_id}).first() is None:
        raise Invalid(f"{target} {target_id} not found")


def check_choices(db: Session, summary_groups: list[dict], choices: list[dict]) -> list[dict]:
    """Validate the admin's choices (nothing is written) and return the ones to save, each with its group.
    Choices on 'skip' and groups not listed are left out."""
    by_key = {group["key"]: group for group in summary_groups}
    seen_keys = set()
    new_names = set()
    to_save = []
    for choice in choices:
        group = by_key.get(choice["key"])
        if group is None:
            raise Invalid(f"unknown group {choice['key']}")
        if choice["key"] in seen_keys:
            raise Invalid(f"group {choice['key']} listed twice")
        seen_keys.add(choice["key"])
        target = choice["target"]
        if target == "skip":
            continue
        if group["outside_malaysia"]:
            raise Invalid(f"group '{group['name']}' is outside Malaysia and cannot be applied")
        target_id = choice.get("target_id")
        new_name = (choice.get("new_cluster_name") or "").strip()
        if target != "cluster":
            if target_id is None:
                raise Invalid(f"group '{group['name']}': pick a {target}")
            if new_name:
                raise Invalid("a new cluster name is only for the cluster target")
        elif (target_id is None) == (not new_name):
            raise Invalid(f"group '{group['name']}': give a cluster or a new cluster name, not both or neither")
        if target_id is not None:
            target_must_exist(db, target, target_id)
        if new_name and new_name.lower() not in new_names:
            if db.execute(text(CLUSTER_NAME_TAKEN_SQL), {"name": new_name}).first() is not None:
                raise Conflict(f"cluster '{new_name}' already exists")
            new_names.add(new_name.lower())
        for site_id in choice.get("member_site_ids", []):
            target_must_exist(db, "site", site_id)
        to_save.append({**choice, "group": group, "new_cluster_name": new_name})
    return to_save


def make_cluster(db: Session, admin_id: int, upload_id: int, name: str) -> int:
    cluster_id = db.execute(text(INSERT_CLUSTER_SQL), {"name": name, "user_id": admin_id}).scalar_one()
    log_edits_for_user(db, admin_id, "cluster", cluster_id, [("created", None, name)], "", upload_id)
    return cluster_id


def add_members(db: Session, admin_id: int, upload_id: int, cluster_id: int, site_ids: list[int]) -> None:
    for site_id in site_ids:
        parameters = {"cluster_id": cluster_id, "site_id": site_id, "user_id": admin_id}
        added = db.execute(text(INSERT_MEMBER_SQL), parameters).first()
        if added is not None:
            log_edits_for_user(db, admin_id, "cluster", cluster_id, [("site_added", None, site_id)], "", upload_id)


def save_groups(db: Session, admin_id: int, upload_id: int, to_save: list[dict]) -> tuple[int, int]:
    """Insert the groups and their elements, create new clusters and add members. Returns (groups, clusters)."""
    new_clusters: dict[str, int] = {}  # lower-case name -> id, so two folders can fill one new cluster
    for choice in to_save:
        group = choice["group"]
        target = choice["target"]
        target_id = choice.get("target_id")
        if target == "cluster":
            if target_id is None:
                name = choice["new_cluster_name"]
                target_id = new_clusters.get(name.lower())
                if target_id is None:
                    target_id = make_cluster(db, admin_id, upload_id, name)
                    new_clusters[name.lower()] = target_id
            add_members(db, admin_id, upload_id, target_id, choice.get("member_site_ids", []))
        parameters = {
            "upload_id": upload_id,
            "name": group["name"],
            "folder_path": group["folder_path"],
            "segment_id": target_id if target == "segment" else None,
            "site_id": target_id if target == "site" else None,
            "cluster_id": target_id if target == "cluster" else None,
            "colour_mode": choice["colour_mode"],
            "user_id": admin_id,
        }
        group_id = db.execute(text(INSERT_GROUP_SQL), parameters).scalar_one()
        for element in group["elements"]:
            db.execute(text(INSERT_ELEMENT_SQL), {
                "group_id": group_id,
                "name": element["name"],
                "kind": element["kind"],
                "geometry": json.dumps(element["geometry"]),
                "style": json.dumps(element["kmz_style"]),
            })
        edit = ("created", None, f"{target} {target_id}")
        log_edits_for_user(db, admin_id, "kmz_group", group_id, [edit], "", upload_id)
    return len(to_save), len(new_clusters)
