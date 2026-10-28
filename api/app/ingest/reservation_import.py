"""The one write path for imported reservations, shared by the seed and the Reservation workbook upload.

Takes a Session or Connection (the caller commits). Reservations are insert-only: this never updates one.
"""
from typing import Any

from sqlalchemy import text


class Skip(Exception):
    pass


def one(db: Any, sql: str, **p: Any) -> Any:
    return db.execute(text(sql), p).scalar_one_or_none()


def find_span(db: Any, a: int, b: int) -> tuple[int, int] | None:
    """(span id, its site_a_id) for the unordered pair."""
    row = db.execute(text("SELECT id, site_a_id FROM spans WHERE LEAST(site_a_id, site_b_id) = LEAST(:a, :b) "
                          "AND GREATEST(site_a_id, site_b_id) = GREATEST(:a, :b)"), {"a": a, "b": b}).first()
    return (row[0], row[1]) if row else None


def add_cores(db: Any, span_id: int, upto: int) -> int:
    """Portless surveyed cores up to number `upto`; returns how many were added."""
    have = one(db, "SELECT coalesce(max(number), 0) FROM cores WHERE span_id = :s", s=span_id)
    for num in range(have + 1, upto + 1):
        db.execute(text("INSERT INTO cores (span_id, number) VALUES (:s, :n)"), {"s": span_id, "n": num})
    return max(upto - have, 0)


def ensure_span(db: Any, counts: dict[str, int], a: int, b: int, p: dict[str, Any]) -> tuple[int, int]:
    """Find the span for a site pair or create it (surveyed cores 1..N, ports filled in later). Returns (id, site_a_id)."""
    span = find_span(db, a, b)
    if span:
        return span
    span_id = one(db, "INSERT INTO spans (site_a_id, site_b_id, region, distance_km, survey_cores) "
                      "VALUES (:a, :b, :g, :d, :c) RETURNING id", a=a, b=b, g=p.get("region"), d=p.get("distance_km"),
                  c=p.get("survey_cores"))
    counts["spans"] = counts.get("spans", 0) + 1
    if p.get("survey_cores"):
        counts["cores"] = counts.get("cores", 0) + add_cores(db, span_id, p["survey_cores"])
    return span_id, a


def port(db: Any, counts: dict[str, int], label: str, site_id: int) -> int:
    n = one(db, "INSERT INTO ports (port_id, site_id) VALUES (:p, :s) ON CONFLICT (port_id) DO NOTHING RETURNING id",
            p=label, s=site_id)
    if n is None:
        return one(db, "SELECT id FROM ports WHERE port_id = :p", p=label)
    counts["ports"] = counts.get("ports", 0) + 1
    return n


def port_pairs(p: dict[str, Any], site_ids: dict[str, int], span_a: int, span_b: int) -> list[tuple[str, str]]:
    """Paired port labels oriented (span site_a side, span site_b side); empty for a count-only row."""
    labels = {site_ids[code]: lbls for code, lbls in p.get("ports") or []}
    return list(zip(labels.get(span_a, []), labels.get(span_b, [])))


def place_reservation(db: Any, counts: dict[str, int], p: dict[str, Any], site_ids: dict[str, int],
                      creator_id: int, approver_id: int) -> int:
    """Insert an approved reservation (events requested + approved) for a parsed Ready row. Raises Skip if a core is held."""
    a, b = site_ids[p["site_a"]], site_ids[p["site_b"]]
    span_id, span_a = ensure_span(db, counts, a, b, p)
    span_b = b if span_a == a else a
    core_ids = []
    for la, lb in port_pairs(p, site_ids, span_a, span_b):
        pa, pb = port(db, counts, la, span_a), port(db, counts, lb, span_b)
        core = one(db, "SELECT id FROM cores WHERE span_id = :s AND port_a_id = :a AND port_b_id = :b", s=span_id, a=pa, b=pb)
        if core is None:  # next portless surveyed core in number order, else a new one
            core = one(db, "SELECT id FROM cores WHERE span_id = :s AND port_a_id IS NULL AND port_b_id IS NULL "
                           "AND number <= coalesce((SELECT survey_cores FROM spans WHERE id = :s), number) "
                           "ORDER BY number LIMIT 1", s=span_id)
            if core is None:
                core = one(db, "INSERT INTO cores (span_id, number, port_a_id, port_b_id) VALUES "
                               "(:s, (SELECT coalesce(max(number), 0) + 1 FROM cores WHERE span_id = :s), :a, :b) RETURNING id",
                           s=span_id, a=pa, b=pb)
                counts["cores"] = counts.get("cores", 0) + 1
            else:
                db.execute(text("UPDATE cores SET port_a_id = :a, port_b_id = :b WHERE id = :c"), {"a": pa, "b": pb, "c": core})
        elif one(db, "SELECT core_id FROM core_holds WHERE core_id = :c", c=core):
            raise Skip("core already taken")
        core_ids.append(core)
    cust = one(db, "SELECT id FROM customers WHERE lower(name) = lower(:n)", n=p["customer"])
    if cust is None:
        cust = one(db, "INSERT INTO customers (name, created_by) VALUES (:n, :u) RETURNING id", n=p["customer"], u=creator_id)
        counts["customers"] = counts.get("customers", 0) + 1
    res = one(db, "INSERT INTO reservations (customer_id, planner_id, planned_date, imported, group_label, additional, "
                  "cv_ready_date, contractor, remark, port_info_raw, monitoring_code, fiber_monitored, "
                  "unassigned_cores, unassigned_span_id) VALUES "
                  "(:c, :u, :pd, true, :gl, :ad, :cv, :ct, :rm, :pi, :mc, :fm, :uc, :us) RETURNING id",
              c=cust, u=creator_id, pd=p["planned_date"], gl=p["group_label"], ad=p["additional"],
              cv=p["cv_ready_date"], ct=p["contractor"], rm=p["remark"], pi=p["port_info_raw"],
              mc=p["monitoring_code"], fm=p["fiber_monitored"],
              uc=p["unassigned_cores"], us=span_id if p["unassigned_cores"] else None)
    ev = "INSERT INTO reservation_events (reservation_id, type, user_id) VALUES (:r, :t, :u)"
    db.execute(text(ev), {"r": res, "t": "requested", "u": creator_id})
    db.execute(text(ev), {"r": res, "t": "approved", "u": approver_id})
    for core in core_ids:
        db.execute(text("INSERT INTO reservation_cores (reservation_id, core_id) VALUES (:r, :c)"), {"r": res, "c": core})
        db.execute(text("INSERT INTO core_holds (core_id, reservation_id) VALUES (:c, :r)"), {"c": core, "r": res})
    counts["reservations"] = counts.get("reservations", 0) + 1
    return res
