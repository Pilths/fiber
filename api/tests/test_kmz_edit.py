"""KMZ edits: PATCH/list of groups, cluster members and names. Nothing is deleted."""
from sqlalchemy import text
from test_auth import login, mkuser
from test_kmz_elements import apply, group_rows, preview, sites  # noqa: F401 (fixtures)
from test_kmz_upload import URL, admin, segments  # noqa: F401 (fixtures)
from test_load_kmz import make_site, one


def make_groups(client, segments, sites):
    upload_id, _ = preview(client)
    response = apply(client, upload_id, route_segment_ids=[], groups=[
        {"key": "0/0", "target": "segment", "target_id": segments[0]},
        {"key": "1", "target": "site", "target_id": sites["inside"]},
    ])
    assert response.status_code == 200
    return upload_id


def edits(db, entity, entity_id, field=None):
    sql = "SELECT field, old_value, new_value, upload_id FROM data_edits WHERE entity = :e AND entity_id = :i"
    sql += " AND field = :f ORDER BY id" if field else " ORDER BY id"
    return db.execute(text(sql), {"e": entity, "i": entity_id, "f": field}).mappings().all()


def first_group(db):
    return one(db, "SELECT id FROM kmz_groups ORDER BY id LIMIT 1")


def map_group_ids(client):
    features = client.get("/api/map/kmz-elements").json()["features"]
    return {feature["properties"]["group_id"] for feature in features}


def test_hide_then_show(client, db, admin, segments, sites):
    make_groups(client, segments, sites)
    group_id = first_group(db)
    assert group_id in map_group_ids(client)
    assert client.patch(f"{URL}/groups/{group_id}", json={"hidden": True}).json()["hidden"] is True
    assert group_id not in map_group_ids(client)
    assert one(db, "SELECT hidden_by FROM kmz_groups WHERE id = :i", i=group_id) is not None
    assert client.patch(f"{URL}/groups/{group_id}", json={"hidden": False}).json()["hidden"] is False
    assert group_id in map_group_ids(client)
    rows = edits(db, "kmz_group", group_id, "hidden")
    assert [(row.old_value, row.new_value, row.upload_id) for row in rows] == [
        ("false", "true", None), ("true", "false", None)]


def test_colour_rename_retarget_and_no_change(client, db, admin, segments, sites):
    make_groups(client, segments, sites)
    group_id = first_group(db)
    body = client.patch(f"{URL}/groups/{group_id}", json={"colour_mode": "kmz", "name": " Renamed ",
                                                        "remarks": "why"}).json()
    assert body["colour_mode"] == "kmz"
    assert body["name"] == "Renamed"
    assert [row.field for row in edits(db, "kmz_group", group_id)] == ["created", "name", "colour_mode"]
    body = client.patch(f"{URL}/groups/{group_id}", json={"target": {"kind": "site", "id": sites["inside"]}}).json()
    assert body["target"] == {"kind": "site", "id": sites["inside"]}
    row = group_rows(db)[0]
    assert (row["segment_id"], row["site_id"], row["cluster_id"]) == (None, sites["inside"], None)
    target_edit = edits(db, "kmz_group", group_id, "target")[0]
    assert (target_edit.old_value, target_edit.new_value) == (f"segment {segments[0]}", f"site {sites['inside']}")
    before = len(edits(db, "kmz_group", group_id))
    assert client.patch(f"{URL}/groups/{group_id}", json={"name": "Renamed", "colour_mode": "kmz"}).status_code == 200
    assert len(edits(db, "kmz_group", group_id)) == before


def test_patch_errors(client, db, admin, segments, sites):
    make_groups(client, segments, sites)
    group_id = first_group(db)
    assert client.patch(f"{URL}/groups/999999", json={"hidden": True}).status_code == 404
    assert client.patch(f"{URL}/groups/{group_id}", json={"target": {"kind": "site", "id": 999999}}).status_code == 422
    assert client.patch(f"{URL}/groups/{group_id}", json={"name": "  "}).status_code == 422


def test_list_groups(client, db, admin, segments, sites):
    upload_id = make_groups(client, segments, sites)
    group_id = first_group(db)
    client.patch(f"{URL}/groups/{group_id}", json={"hidden": True})
    [group] = client.get(f"{URL}/groups", params={"segment_id": segments[0]}).json()
    assert group["id"] == group_id
    assert group["hidden"] is True
    assert group["counts"] == {"lines": 0, "areas": 1, "points": 0}
    assert group["upload"]["id"] == upload_id
    assert group["target"] == {"kind": "segment", "id": segments[0]}
    [site_group] = client.get(f"{URL}/groups", params={"site_id": sites["inside"]}).json()
    assert site_group["counts"]["points"] == 1
    assert site_group["hidden"] is False
    assert client.get(f"{URL}/groups").status_code == 422
    assert client.get(f"{URL}/groups", params={"site_id": 1, "segment_id": 2}).status_code == 422


def new_cluster(db, name):
    return one(db, "INSERT INTO clusters (name, created_by) VALUES (:n, (SELECT id FROM users LIMIT 1)) RETURNING id",
               n=name)


def test_cluster_sites_add_remove_readd(client, db, admin, sites):
    cluster_id = new_cluster(db, "Alpha")
    assert client.get(f"{URL}/clusters").json() == [{"id": cluster_id, "name": "Alpha", "sites": []}]
    url = f"{URL}/clusters/{cluster_id}/sites"
    site_id = sites["inside"]
    body = client.post(url, json={"site_id": site_id}).json()
    assert body["sites"] == [{"id": site_id, "name": "INSIDE"}]
    assert [row.new_value for row in edits(db, "cluster", cluster_id, "site_added")] == [str(site_id)]
    assert client.post(url, json={"site_id": site_id}).status_code == 409
    assert client.post(url, json={"site_id": 999999}).status_code == 422
    assert client.post(f"{URL}/clusters/999999/sites", json={"site_id": site_id}).status_code == 404
    assert client.delete(f"{url}/{site_id}").status_code == 204
    removed = db.execute(text("SELECT removed_at, removed_by FROM cluster_sites WHERE cluster_id = :c"),
                         {"c": cluster_id}).one()
    assert removed.removed_at is not None
    assert removed.removed_by is not None
    assert [row.old_value for row in edits(db, "cluster", cluster_id, "site_removed")] == [str(site_id)]
    assert client.get(f"{URL}/clusters").json()[0]["sites"] == []
    assert client.delete(f"{url}/{site_id}").status_code == 404
    assert client.post(url, json={"site_id": site_id}).status_code == 201
    assert one(db, "SELECT count(*) FROM cluster_sites") == 1
    assert one(db, "SELECT removed_at FROM cluster_sites") is None
    assert client.delete(f"{url}/{sites['outside']}").status_code == 404


def test_cluster_rename(client, db, admin):
    cluster_id = new_cluster(db, "Alpha")
    other_id = new_cluster(db, "Beta")
    url = f"{URL}/clusters/{cluster_id}"
    assert client.patch(url, json={"name": " alpha "}).status_code == 200  # case-only change of itself
    assert client.patch(url, json={"name": "alpha"}).status_code == 200  # unchanged
    assert [row.new_value for row in edits(db, "cluster", cluster_id, "name")] == ["alpha"]
    assert client.patch(url, json={"name": "BETA"}).status_code == 409
    assert client.patch(url, json={"name": " "}).status_code == 422
    assert client.patch(f"{URL}/clusters/999999", json={"name": "x"}).status_code == 404
    assert other_id != cluster_id


def test_non_admin_is_403(client, db, admin, segments, sites):
    make_groups(client, segments, sites)
    group_id = first_group(db)
    client.post("/api/auth/logout")
    mkuser(db, "plan", "planner")
    assert login(client, "plan").status_code == 200
    assert client.patch(f"{URL}/groups/{group_id}", json={"hidden": True}).status_code == 403
