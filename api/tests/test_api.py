import pytest
from sqlalchemy import text

H = {"X-Dev-User": "planner1"}


def one(db, sql, **p):
    return db.execute(text(sql), p).scalar_one()


@pytest.fixture
def net(db):
    """Two segments (North, Central); segment 1 has one core per status."""
    u = one(db, "INSERT INTO users (username, display_name, role) VALUES ('planner1','P','planner') RETURNING id")
    adm = one(db, "INSERT INTO users (username, display_name, role) VALUES ('admin1','A','admin') RETURNING id")
    a, b, c = (one(db, "INSERT INTO sites (name, kind) VALUES (:n,'site') RETURNING id", n=n)
               for n in ("Alpha Hub", "Bravo Hub", "Charlie Hub"))
    s1 = one(db, "INSERT INTO segments (site_a_id, site_b_id, region, route_type, distance_km) "
                 "VALUES (:a,:b,'North','Trunk',10) RETURNING id", a=a, b=b)
    db.execute(text("UPDATE segments SET survey_cores = 5 WHERE id = :s"), {"s": s1})
    s2 = one(db, "INSERT INTO segments (site_a_id, site_b_id, region) VALUES (:a,:b,'Central') RETURNING id", a=b, b=c)
    cores = {}
    for n in range(1, 6):
        pa = one(db, "INSERT INTO ports (port_id, site_id) VALUES (:p,:s) RETURNING id", p=f"P-{n}-A", s=a)
        pb = one(db, "INSERT INTO ports (port_id, site_id) VALUES (:p,:s) RETURNING id", p=f"P-{n}-B", s=b)
        cores[n] = one(db, "INSERT INTO cores (segment_id, number, port_a_id, port_b_id, circuit_id, in_use) "
                           "VALUES (:s,:n,:pa,:pb,:ck,:u) RETURNING id",
                       s=s1, n=n, pa=pa, pb=pb, ck="CKT-9001" if n == 4 else None, u=n == 4)
    cust = one(db, "INSERT INTO customers (name) VALUES ('Telekom Zeta') RETURNING id")

    def reserve(core: int, approved: bool) -> None:
        res = one(db, "INSERT INTO reservations (customer_id, planner_id, planned_date) "
                      "VALUES (:c,:u,'2026-12-01') RETURNING id", c=cust, u=u)
        db.execute(text("INSERT INTO reservation_cores VALUES (:r,:c)"), {"r": res, "c": core})
        db.execute(text("INSERT INTO core_holds VALUES (:c,:r)"), {"r": res, "c": core})
        for t, who in [("requested", u)] + ([("approved", adm)] if approved else []):
            db.execute(text("INSERT INTO reservation_events (reservation_id, type, user_id) VALUES (:r,:t,:u)"),
                       {"r": res, "t": t, "u": who})

    reserve(cores[2], approved=False)  # Requested
    reserve(cores[3], approved=True)   # Reserved
    db.execute(text("INSERT INTO data_edits (entity, entity_id, field, new_value, reason, user_id) "
                    "VALUES ('core', :c, 'status', 'Faulty', 'old edit, now history only', :u)"), {"c": cores[5], "u": adm})
    return {"s1": s1, "s2": s2, "cores": cores}


def test_requires_user(client, net):
    assert client.get("/api/segments").status_code == 401
    assert client.get("/api/segments", headers={"X-Dev-User": "nobody"}).status_code == 401


def labels(client, q, type_):
    r = client.get("/api/search", params={"q": q}, headers=H)
    assert r.status_code == 200
    return [x for x in r.json() if x["type"] == type_]


def test_search_customer(client, net):
    hits = labels(client, "telekom", "customer")
    assert [h["label"] for h in hits] == ["Telekom Zeta"]
    assert hits[0]["segment_id"] == net["s1"]
    assert labels(client, "Telecom Zeta", "customer")  # trigram, not substring


def test_search_segment(client, net):
    hits = labels(client, "bravo", "segment")
    assert {h["segment_id"] for h in hits} == {net["s1"], net["s2"]}


def test_search_circuit(client, net):
    hits = labels(client, "ckt-9001", "circuit")
    assert hits == [{"type": "circuit", "label": "CKT-9001", "segment_id": net["s1"], "core_id": net["cores"][4]}]


def test_search_core_number(client, net):
    hits = labels(client, "3", "core")
    assert hits[0]["core_id"] == net["cores"][3]
    assert client.get("/api/search", params={"q": ""}, headers=H).status_code == 422


def test_segment_list_filter(client, net):
    r = client.get("/api/segments", params={"region": "North"}, headers=H).json()
    assert [s["id"] for s in r] == [net["s1"]]
    s = r[0]
    assert (s["site_a"], s["site_b"], s["route_type"], s["free_cores"]) == ("Alpha Hub", "Bravo Hub", "Trunk", 2)
    assert s["status_mix"] == {"Available": 2, "Requested": 1, "Reserved": 1, "In use": 1}
    assert (s["survey_cores"], s["cable_size"], s["not_surveyed"]) == (5, 144, 139)
    assert (s["unassigned_reserved"], s["free_to_reserve"]) == (0, 2)
    other = client.get("/api/segments", headers=H).json()[1]  # never surveyed: not bookable
    assert (other["survey_cores"], other["not_surveyed"], other["free_to_reserve"]) == (None, None, 0)


def test_segment_detail(client, net):
    r = client.get(f"/api/segments/{net['s1']}", headers=H).json()
    cores = r["cores"]
    assert [c["number"] for c in cores] == [1, 2, 3, 4, 5]
    assert [c["status"] for c in cores] == ["Available", "Requested", "Reserved", "In use", "Available"]
    assert cores[1]["customer"] == "Telekom Zeta" and cores[1]["planned_date"] == "2026-12-01"
    assert cores[0]["customer"] is None
    assert cores[3]["circuit_id"] == "CKT-9001"
    assert (cores[0]["port_a"], cores[0]["port_b"]) == ("P-1-A", "P-1-B")


def test_segment_unknown(client, net):
    assert client.get("/api/segments/999999", headers=H).status_code == 404


def test_customers(client, net):
    assert client.get("/api/customers", params={"q": "zeta"}, headers=H).json()[0]["name"] == "Telekom Zeta"
    r = client.post("/api/customers", json={"name": "Telekom Zetta"}, headers=H).json()
    assert [c["name"] for c in r["similar"]] == ["Telekom Zeta"] and r["created"] is False
    assert len(client.get("/api/customers", headers=H).json()) == 1  # stub inserted nothing


def test_customer_create_and_confirm_new(client, net):
    r = client.post("/api/customers", json={"name": "Telekom Zetta"}, headers=H).json()
    assert r["created"] is False and r["customer"] is None and [c["name"] for c in r["similar"]] == ["Telekom Zeta"]
    r = client.post("/api/customers", json={"name": "Telekom Zetta", "confirm_new": True}, headers=H).json()
    assert r["created"] is True and r["customer"]["name"] == "Telekom Zetta"
    assert len(client.get("/api/customers", headers=H).json()) == 2
    r = client.post("/api/customers", json={"name": "  telekom   zetta "}, headers=H).json()  # same name, any case
    assert r["created"] is False and r["customer"]["name"] == "Telekom Zetta"
    assert client.post("/api/customers", json={"name": "Unrelated Name Ltd"}, headers=H).json()["created"] is True
    assert client.post("/api/customers", json={"name": "  "}, headers=H).status_code == 422


def derived_types(client, db, kinds_a_b):
    """Insert one segment per (kind A, kind B) pair; return {pair: route_type from the API}."""
    ids = {}
    for n, (ka, kb) in enumerate(kinds_a_b):
        a = one(db, "INSERT INTO sites (name, kind) VALUES (:n,:k) RETURNING id", n=f"A{n}", k=ka)
        b = one(db, "INSERT INTO sites (name, kind) VALUES (:n,:k) RETURNING id", n=f"B{n}", k=kb)
        ids[(ka, kb)] = one(db, "INSERT INTO segments (site_a_id, site_b_id) VALUES (:a,:b) RETURNING id", a=a, b=b)
    got = {s["id"]: s["route_type"] for s in client.get("/api/segments", headers=H).json()}
    return {pair: got[sid] for pair, sid in ids.items()}, ids


def test_route_type_is_derived_from_end_sites(client, net, db):
    pairs = [("data_center", "data_center"), ("data_center", "toc"), ("toc", "data_center"),
             ("data_center", "site"), ("site", "data_center"), ("toc", "site"), ("site", "site")]
    types, _ = derived_types(client, db, pairs)
    assert types == {
        ("data_center", "data_center"): "DC-DC", ("data_center", "toc"): "DC-TOC", ("toc", "data_center"): "DC-TOC",
        ("data_center", "site"): "Metro", ("site", "data_center"): "Metro",
        ("toc", "site"): "Trunk", ("site", "site"): "Trunk"}


def test_site_kind_change_changes_route_type_without_segment_write(client, net, db):
    _, ids = derived_types(client, db, [("site", "site")])
    sid = ids[("site", "site")]
    site_a = one(db, "SELECT site_a_id FROM segments WHERE id = :s", s=sid)
    db.execute(text("UPDATE sites SET kind = 'data_center' WHERE id = :i"), {"i": site_a})
    got = {s["id"]: s["route_type"] for s in client.get("/api/segments", headers=H).json()}
    assert got[sid] == "Metro"
    assert one(db, "SELECT route_type IS NULL FROM segments WHERE id = :s", s=sid)


def test_route_type_filter_uses_derived_value(client, net, db):
    _, ids = derived_types(client, db, [("data_center", "site"), ("site", "site")])
    metro = client.get("/api/segments", params={"route_type": "Metro"}, headers=H).json()
    assert [s["id"] for s in metro] == [ids[("data_center", "site")]]
    trunk = client.get("/api/segments", params={"route_type": "Trunk"}, headers=H).json()
    assert ids[("site", "site")] in [s["id"] for s in trunk] and net["s1"] in [s["id"] for s in trunk]
