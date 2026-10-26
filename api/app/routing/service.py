"""Route options over the span graph. Free cores use inventory.list_spans (free_to_reserve), loss uses loss.span_rows."""
import time
from itertools import islice
from typing import Any

import networkx as nx
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.inventory import service as inventory
from app.loss import service as loss
from app.routing.graph import get_graph

MAX_CANDIDATES = 20
TIME_CAP_S = 2.0
SHOWN = 3


def _bad(field: str, msg: str) -> HTTPException:
    return HTTPException(422, [{"loc": ["query", field], "msg": msg, "type": "value_error"}])


def endpoints(db: Session) -> list[dict[str, Any]]:
    return [dict(r) for r in db.execute(text(
        "SELECT id, name, kind FROM sites s WHERE EXISTS (SELECT 1 FROM spans p WHERE s.id IN (p.site_a_id, p.site_b_id)) "
        "ORDER BY name, id")).mappings()]


def _candidates(g: nx.Graph, a: int, b: int) -> list[list[int]]:
    if a not in g or b not in g:
        return []
    start = time.monotonic()
    out: list[list[int]] = []
    try:
        for p in islice(nx.shortest_simple_paths(g, a, b, weight="weight"), MAX_CANDIDATES):
            out.append(p)
            if time.monotonic() - start > TIME_CAP_S:
                break
    except nx.NetworkXNoPath:
        pass
    return out


def find_routes(db: Session, frm: int, to: int, cores_needed: int, sort: str) -> dict[str, Any]:
    if frm == to:
        raise _bad("to", "from and to must differ")
    for field, sid in (("from", frm), ("to", to)):
        if not db.execute(text("SELECT 1 FROM sites WHERE id = :i"), {"i": sid}).first():
            raise _bad(field, "Unknown site")
    paths = _candidates(get_graph(db), frm, to)
    if not paths:
        return {"options": [], "message": "No route connects these sites"}

    g = get_graph(db)
    inv = {s["id"]: s for s in inventory.list_spans(db, None, None, None)}
    ls = {r["span_id"]: r for r in loss.span_rows(db)}
    labels = dict(db.execute(text(
        "SELECT DISTINCT ON (ss.span_id) ss.span_id, a.name || ' - ' || b.name FROM segment_spans ss "
        "JOIN segments g ON g.id = ss.segment_id JOIN sites a ON a.id = g.site_a_id JOIN sites b ON b.id = g.site_b_id "
        "ORDER BY ss.span_id, g.id")).all())

    names = dict(db.execute(text("SELECT id, name FROM sites WHERE id = ANY(CAST(:ids AS bigint[]))"),
                            {"ids": sorted({n for p in paths for n in p})}).all())
    options = []
    for path in paths:
        spans = []
        for u, v in zip(path, path[1:]):
            sid = g[u][v]["span_id"]
            s, lo = inv[sid], ls[sid]
            spans.append({"span_id": sid, "name": f"{s['site_a']} - {s['site_b']}", "site_a": names[u], "site_b": names[v],  # travel order
                          "km": None if s["distance_km"] is None else float(s["distance_km"]),
                          "free_to_reserve": s["free_to_reserve"], "surveyed": s["survey_cores"] is not None,
                          "segment_label": labels.get(sid), "measured": lo["measured_db"] is not None,
                          "_calc": lo["calculated_db"]})
        calc = [x.pop("_calc") for x in spans]
        bottleneck = min(spans, key=lambda x: x["free_to_reserve"])
        fewest = bottleneck["free_to_reserve"]
        options.append({
            "spans": spans, "total_km": round(sum(x["km"] or 0 for x in spans), 3),
            "_weight": sum(g[u][v]["weight"] for u, v in zip(path, path[1:])),  # fallback km for spans without distance
            "distance_incomplete": any(x["km"] is None for x in spans),
            "estimated_db": None if None in calc else round(float(sum(calc)), 2),
            "fewest_free": fewest, "bottleneck_span_id": bottleneck["span_id"],
            "measured_spans": sum(x["measured"] for x in spans), "total_spans": len(spans),
            "insufficient": fewest < cores_needed or not all(x["surveyed"] for x in spans), "best_match": False})
    key = (lambda o: (o["insufficient"], o["_weight"])) if sort == "km" else \
          (lambda o: (o["insufficient"], -o["fewest_free"], o["_weight"]))
    options.sort(key=key)  # stable: ties keep the shortest-path order
    options = options[:SHOWN]
    for o in options:
        del o["_weight"]
    first_ok = next((o for o in options if not o["insufficient"]), None)
    if first_ok:
        first_ok["best_match"] = True
    return {"options": options, "message": None}


def pick(db: Session, span_ids: list[int], cores_needed: int) -> dict[str, Any]:
    """First `cores_needed` Available cores (lowest number first) on each span. 409 naming the first short span.

    Available already excludes held cores; free_to_reserve (count-only holds) is the same figure the span list shows.
    Not a lock: POST /api/reservations re-checks and locks, and answers 409 if someone was first.
    """
    out = []
    for sid in span_ids:
        s = next(iter(inventory.list_spans(db, None, None, None, sid)), None)
        if s is None:
            raise HTTPException(422, f"Unknown span {sid}")
        label = f"{s['site_a']} - {s['site_b']}"
        if s["survey_cores"] is None:
            raise HTTPException(409, {"message": f"{label} is not surveyed yet; it cannot be booked.", "span_id": sid})
        if s["free_to_reserve"] < cores_needed:
            raise HTTPException(409, {"message": f"{label}: {cores_needed} needed but only {s['free_to_reserve']} free to reserve.",
                                      "span_id": sid})
        rows = db.execute(text(
            "SELECT c.id AS core_id, c.number FROM cores c JOIN core_status_v v ON v.core_id = c.id "
            "WHERE c.span_id = :s AND v.status = 'Available' AND c.number <= :n ORDER BY c.number LIMIT :k"),
            {"s": sid, "n": s["survey_cores"], "k": cores_needed}).mappings().all()
        out.append({"span_id": sid, "name": label, "cores": [dict(r) for r in rows]})
    return {"spans": out, "core_ids": [c["core_id"] for s in out for c in s["cores"]]}
