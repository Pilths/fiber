from typing import Any, get_args

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.reservations.service import TZ
from app.inventory.schemas import (
    CoreDetail,
    CoreHolderDetail,
    Customer,
    Holder,
    Owner,
    SearchResult,
    SegmentDetail,
    SegmentSummary,
    UnassignedHold,
)

PER_TYPE = 20

# Segment list with free cores and status mix; status always comes from core_status_v.
SEGMENT_SQL = """
SELECT s.id, a.name AS site_a, b.name AS site_b, s.route_type, s.region, s.route, s.section, s.distance_km,
       s.survey_cores, s.cable_size, s.fiber_cut, COALESCE(mix.m, '{}'::jsonb) AS status_mix,
       COALESCE((SELECT sum(u.remaining) FROM reservation_unassigned_v u WHERE u.segment_id = s.id), 0)::int AS unassigned_reserved
FROM segments s
JOIN sites a ON a.id = s.site_a_id
JOIN sites b ON b.id = s.site_b_id
LEFT JOIN LATERAL (
  SELECT jsonb_object_agg(status, n) AS m FROM (
    SELECT v.status, count(*) AS n FROM cores c
    JOIN core_status_v v ON v.core_id = c.id WHERE c.segment_id = s.id
      AND (s.survey_cores IS NULL OR c.number <= s.survey_cores) GROUP BY v.status
  ) t
) mix ON true
WHERE (CAST(:region AS text) IS NULL OR s.region = :region)
  AND (CAST(:route_type AS text) IS NULL OR s.route_type = :route_type)
  AND (CAST(:route AS text) IS NULL OR lower(s.route) = lower(:route))
  AND (CAST(:q AS text) IS NULL OR a.name ILIKE '%' || :q || '%' OR b.name ILIKE '%' || :q || '%')
  AND (CAST(:id AS bigint) IS NULL OR s.id = :id)
ORDER BY s.id
"""

# Customer and planned date: each field takes its latest 'corrected' value, else the reservation row.
# (A correction may set only one of the two fields.)
CORE_SQL = f"""
SELECT c.id, c.number, v.status, c.circuit_id, pa.port_id AS port_a, pb.port_id AS port_b,
       COALESCE(cust.name, hc.name) AS customer, COALESCE(corr_date.planned_date, r.planned_date) AS planned_date,
       r.id AS reservation_id, COALESCE(st.is_stale, false) AS stale, st.stale_since,
       r.srf_id, pu.display_name AS planner,
       (now() AT TIME ZONE {TZ})::date - (r.created_at AT TIME ZONE {TZ})::date AS age_days
FROM cores c
JOIN core_status_v v ON v.core_id = c.id
LEFT JOIN ports pa ON pa.id = c.port_a_id
LEFT JOIN ports pb ON pb.id = c.port_b_id
LEFT JOIN core_holds h ON h.core_id = c.id
LEFT JOIN reservations r ON r.id = h.reservation_id
LEFT JOIN reservation_state_v st ON st.reservation_id = r.id
LEFT JOIN customers hc ON hc.id = r.customer_id
LEFT JOIN users pu ON pu.id = r.planner_id
LEFT JOIN LATERAL (
  SELECT e.customer_id FROM reservation_events e
  WHERE e.reservation_id = r.id AND e.type = 'corrected' AND e.customer_id IS NOT NULL
  ORDER BY e.created_at DESC, e.id DESC LIMIT 1
) corr_cust ON true
LEFT JOIN LATERAL (
  SELECT e.planned_date FROM reservation_events e
  WHERE e.reservation_id = r.id AND e.type = 'corrected' AND e.planned_date IS NOT NULL
  ORDER BY e.created_at DESC, e.id DESC LIMIT 1
) corr_date ON true
LEFT JOIN customers cust ON cust.id = corr_cust.customer_id
JOIN segments sp ON sp.id = c.segment_id
WHERE c.segment_id = :id AND (sp.survey_cores IS NULL OR c.number <= sp.survey_cores)
ORDER BY c.number
"""

# One core with its holder. Hidden cores (above survey_cores) are not found. Stale comes from reservation_state_v.
CORE_ONE_SQL = CORE_SQL.replace("SELECT c.id, c.number,", "SELECT c.segment_id, a.name || ' - ' || b.name AS segment_name, c.id, c.number,", 1) \
    .replace("JOIN segments sp ON sp.id = c.segment_id\n", "JOIN segments sp ON sp.id = c.segment_id\nJOIN sites a ON a.id = sp.site_a_id JOIN sites b ON b.id = sp.site_b_id\n") \
    .replace("WHERE c.segment_id = :id AND", "WHERE c.id = :id AND").replace("ORDER BY c.number", "")
# Count-only holds with cores still to assign; customer and date take the latest correction like CORE_SQL.
UNASSIGNED_SQL = f"""
SELECT u.reservation_id, COALESCE(cust.name, hc.name) AS customer, u.remaining,
       COALESCE(corr_date.planned_date, r.planned_date) AS planned_date, r.srf_id, pu.display_name AS planner,
       COALESCE((now() AT TIME ZONE {TZ})::date - (r.created_at AT TIME ZONE {TZ})::date, 0) AS age_days
FROM reservation_unassigned_v u
JOIN reservations r ON r.id = u.reservation_id
JOIN customers hc ON hc.id = r.customer_id
JOIN users pu ON pu.id = r.planner_id
LEFT JOIN LATERAL (
  SELECT e.customer_id FROM reservation_events e
  WHERE e.reservation_id = r.id AND e.type = 'corrected' AND e.customer_id IS NOT NULL
  ORDER BY e.created_at DESC, e.id DESC LIMIT 1
) corr_cust ON true
LEFT JOIN customers cust ON cust.id = corr_cust.customer_id
LEFT JOIN LATERAL (
  SELECT e.planned_date FROM reservation_events e
  WHERE e.reservation_id = r.id AND e.type = 'corrected' AND e.planned_date IS NOT NULL
  ORDER BY e.created_at DESC, e.id DESC LIMIT 1
) corr_date ON true
WHERE u.segment_id = :id AND u.remaining > 0
ORDER BY u.reservation_id
"""
HOLDER_SQL = """
SELECT r.planner_id AS id, u.username, u.display_name FROM reservations r JOIN users u ON u.id = r.planner_id WHERE r.id = :rid
"""


def _summary(row: dict[str, Any]) -> dict[str, Any]:
    free = row["status_mix"].get("Available", 0)
    surveyed = row["survey_cores"] is not None
    return {**row, "free_cores": free,
            "not_surveyed": row["cable_size"] - row["survey_cores"] if surveyed else None,
            "free_to_reserve": max(free - row["unassigned_reserved"], 0) if surveyed and not row["fiber_cut"] else 0}


def list_segments(db: Session, region: str | None, route_type: str | None, q: str | None,
               segment_id: int | None = None, route: str | None = None) -> list[dict[str, Any]]:
    rows = db.execute(text(SEGMENT_SQL), {"region": region, "route_type": route_type, "route": (route or "").strip() or None,
                                      "q": q or None, "id": segment_id}).mappings()
    return [_summary(dict(r)) for r in rows]


def get_segment(db: Session, segment_id: int) -> SegmentDetail | None:
    segments = list_segments(db, None, None, None, segment_id)
    if not segments:
        return None
    cores = db.execute(text(CORE_SQL), {"id": segment_id}).mappings()
    held = db.execute(text(UNASSIGNED_SQL), {"id": segment_id}).mappings()
    return SegmentDetail(**segments[0], cores=[CoreDetail(**c) for c in cores], unassigned=[UnassignedHold(**h) for h in held])


def get_core(db: Session, core_id: int, user_id: int) -> CoreHolderDetail | None:
    row = db.execute(text(CORE_ONE_SQL), {"id": core_id}).mappings().first()
    if row is None:
        return None
    holder = None
    if row["reservation_id"] is not None:
        # state: pending = requested; approved with a release waiting = release_requested
        last = db.execute(text("SELECT status, last_event FROM reservation_state_v WHERE reservation_id = :r"),
                          {"r": row["reservation_id"]}).one()
        state = ("requested" if last.status == "pending" else
                 "release_requested" if last.last_event == "release_requested" else "approved")
        owner = db.execute(text(HOLDER_SQL), {"rid": row["reservation_id"]}).mappings().one()
        holder = Holder(reservation_id=row["reservation_id"], customer=row["customer"], planned_date=row["planned_date"],
                        state=state, stale=row["stale"], stale_since=row["stale_since"],
                        srf_id=row["srf_id"], planner=row["planner"], age_days=row["age_days"],
                        owner=Owner(**owner), is_mine=owner["id"] == user_id)
    return CoreHolderDetail(core_id=row["id"], number=row["number"], segment_id=row["segment_id"], segment_name=row["segment_name"],
                            status=row["status"], circuit_id=row["circuit_id"], port_a=row["port_a"], port_b=row["port_b"],
                            holder=holder)


def list_segment_summaries(db: Session, region: str | None, route_type: str | None,
                        q: str | None, route: str | None = None) -> list[SegmentSummary]:
    return [SegmentSummary(**s) for s in list_segments(db, region, route_type, q, route=route)]


def list_customers(db: Session, q: str | None) -> list[Customer]:
    rows = db.execute(
        text("SELECT id, name FROM customers WHERE CAST(:q AS text) IS NULL OR name ILIKE '%' || :q || '%' "
             "ORDER BY name"), {"q": q or None}).mappings()
    return [Customer(**r) for r in rows]


def similar_customers(db: Session, name: str) -> list[Customer]:
    rows = db.execute(
        text("SELECT id, name FROM customers WHERE similarity(name, :n) >= 0.4 "
             "ORDER BY similarity(name, :n) DESC, name"), {"n": name}).mappings()
    return [Customer(**r) for r in rows]


def find_customer(db: Session, name: str) -> Customer | None:
    row = db.execute(text("SELECT id, name FROM customers WHERE lower(name) = lower(:n)"), {"n": name}).mappings().first()
    return Customer(**row) if row else None


def create_customer(db: Session, name: str, user_id: int) -> Customer:
    row = db.execute(text("INSERT INTO customers (name, created_by) VALUES (:n, :u) "
                          "ON CONFLICT (lower(name)) DO NOTHING RETURNING id, name"), {"n": name, "u": user_id}).mappings().first()
    return Customer(**row) if row else find_customer(db, name)  # type: ignore[arg-type]


# One query per key; each returns (label, segment_id, core_id). q is escaped for LIKE by the caller.
def search(db: Session, q: str) -> list[SearchResult]:
    p = {"q": q, "like": "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%",
         "n": PER_TYPE, "num": int(q) if q.isdigit() else None}
    out: list[SearchResult] = []

    def add(type_: str, sql: str) -> None:
        assert type_ in get_args(SearchResult.model_fields["type"].annotation)
        for label, segment_id, core_id in db.execute(text(sql), p):
            out.append(SearchResult(type=type_, label=label, segment_id=segment_id, core_id=core_id))  # type: ignore[arg-type]

    # Customers are linked to segments through their reservations' cores (one hit per customer, first segment).
    add("customer", """
        SELECT cu.name, min(c.segment_id), NULL::bigint FROM customers cu
        LEFT JOIN reservations r ON r.customer_id = cu.id
        LEFT JOIN reservation_cores rc ON rc.reservation_id = r.id
        LEFT JOIN cores c ON c.id = rc.core_id
        WHERE cu.name ILIKE :like ESCAPE '\\' OR similarity(cu.name, :q) >= 0.3
        GROUP BY cu.id, cu.name ORDER BY max(similarity(cu.name, :q)) DESC, cu.name LIMIT :n""")
    add("segment", """
        SELECT a.name || ' - ' || b.name, s.id, NULL::bigint FROM segments s
        JOIN sites a ON a.id = s.site_a_id JOIN sites b ON b.id = s.site_b_id
        WHERE a.name ILIKE :like ESCAPE '\\' OR b.name ILIKE :like ESCAPE '\\'
        ORDER BY s.id LIMIT :n""")
    add("circuit", """
        SELECT c.circuit_id, c.segment_id, c.id FROM cores c JOIN segments s ON s.id = c.segment_id
        WHERE (s.survey_cores IS NULL OR c.number <= s.survey_cores) AND c.circuit_id ILIKE :like ESCAPE '\\' ORDER BY c.circuit_id, c.id LIMIT :n""")
    if p["num"] is not None:
        add("core", """
            SELECT 'Core ' || c.number || ' on ' || a.name || ' - ' || b.name, c.segment_id, c.id FROM cores c
            JOIN segments s ON s.id = c.segment_id AND (s.survey_cores IS NULL OR c.number <= s.survey_cores)
            JOIN sites a ON a.id = s.site_a_id JOIN sites b ON b.id = s.site_b_id
            WHERE c.number = :num ORDER BY c.segment_id LIMIT :n""")
    return out
