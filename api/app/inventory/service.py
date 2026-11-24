from typing import Any, get_args

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.inventory.schemas import (
    CoreDetail,
    CoreHolderDetail,
    Customer,
    CustomerUsage,
    Holder,
    Owner,
    SearchResult,
    SegmentDetail,
    SegmentSummary,
    ReservationUsage,
    SegmentUsage,
    UnassignedHold,
)
from app.inventory.capacity import free_to_reserve, health
from app.auth.deps import CurrentUser
from app.link_type import ROUTE_TYPE_SQL
from app.reservations.actions import allowed_names
from app.reservations.service import TZ

PER_TYPE = 20


# Segment list with free cores and status mix; status always comes from core_status_v.
SEGMENT_SQL = """
SELECT s.id, a.name AS site_a, b.name AS site_b, a.kind AS site_a_kind, b.kind AS site_b_kind,
       @@ROUTE_TYPE@@ AS route_type, s.region, s.route, s.section, s.distance_km,
       s.survey_cores, s.cable_size, s.fiber_cut, COALESCE(mix.m, '{}'::jsonb) AS status_mix,
       COALESCE((SELECT sum(u.remaining) FROM reservation_unassigned_v u WHERE u.segment_id = s.id), 0)::int
         AS unassigned_reserved
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
  AND (CAST(:route_type AS text) IS NULL OR @@ROUTE_TYPE@@ = :route_type)
  AND (CAST(:route AS text) IS NULL OR lower(s.route) = lower(:route))
  AND (CAST(:q AS text) IS NULL OR a.name ILIKE '%' || :q || '%' OR b.name ILIKE '%' || :q || '%')
  AND (CAST(:id AS bigint) IS NULL OR s.id = :id)
ORDER BY s.id
""".replace("@@ROUTE_TYPE@@", ROUTE_TYPE_SQL)

# Customer and planned date: each field takes its latest 'corrected' value, else the reservation row.
# (A correction may set only one of the two fields.)
CORE_SQL = f"""
SELECT c.id, c.number, v.status, pa.port_id AS port_a, pb.port_id AS port_b,
       COALESCE(cust.name, hc.name) AS customer,
       COALESCE(corr_date.planned_date, r.planned_date) AS planned_date,
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

# One core with its holder: CORE_SQL by core id, plus the segment's id and name.
# Hidden cores (above survey_cores) are not found. Stale comes from reservation_state_v.
CORE_ONE_SQL = (
    CORE_SQL
    .replace(
        "SELECT c.id, c.number,",
        "SELECT c.segment_id, a.name || ' - ' || b.name AS segment_name, c.id, c.number,",
        1,
    )
    .replace(
        "JOIN segments sp ON sp.id = c.segment_id\n",
        "JOIN segments sp ON sp.id = c.segment_id\n"
        "JOIN sites a ON a.id = sp.site_a_id JOIN sites b ON b.id = sp.site_b_id\n",
    )
    .replace("WHERE c.segment_id = :id AND", "WHERE c.id = :id AND")
    .replace("ORDER BY c.number", "")
)

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
SELECT r.planner_id AS id, u.username, u.display_name
FROM reservations r JOIN users u ON u.id = r.planner_id
WHERE r.id = :reservation_id
"""
RESERVATION_STATE_SQL = """
SELECT st.status, st.last_event, st.is_stale, COALESCE(un.remaining, 0) AS remaining
FROM reservation_state_v st
LEFT JOIN reservation_unassigned_v un ON un.reservation_id = st.reservation_id
WHERE st.reservation_id = :reservation_id
"""

LIST_CUSTOMERS_SQL = """
SELECT id, name FROM customers WHERE CAST(:q AS text) IS NULL OR name ILIKE '%' || :q || '%' ORDER BY name
"""
SIMILAR_CUSTOMERS_SQL = """
SELECT id, name FROM customers WHERE similarity(name, :name) >= 0.4
ORDER BY similarity(name, :name) DESC, name
"""
FIND_CUSTOMER_SQL = "SELECT id, name FROM customers WHERE lower(name) = lower(:name)"
CREATE_CUSTOMER_SQL = """
INSERT INTO customers (name, created_by) VALUES (:name, :user_id)
ON CONFLICT (lower(name)) DO NOTHING RETURNING id, name
"""

# Search: one query per key; each returns (label, segment_id, core_id, customer_id).
# Customers are linked to segments through their reservations' cores (one hit per customer, first segment).
SEARCH_CUSTOMER_SQL = """
SELECT cu.name, COALESCE(min(c.segment_id), min(un.segment_id)), NULL::bigint, cu.id FROM customers cu
LEFT JOIN reservations r ON r.customer_id = cu.id
LEFT JOIN reservation_cores rc ON rc.reservation_id = r.id
LEFT JOIN cores c ON c.id = rc.core_id
LEFT JOIN reservation_unassigned_v un ON un.reservation_id = r.id AND un.remaining > 0
WHERE cu.name ILIKE :like ESCAPE '\\' OR similarity(cu.name, :q) >= 0.3
GROUP BY cu.id, cu.name ORDER BY max(similarity(cu.name, :q)) DESC, cu.name LIMIT :n
"""

# Segments where one customer has cores: Reserved or In use cores count as used (Requested does not), plus the
# remaining cores of approved count-only reservations (reservation_unassigned_v). The customer is the holder's
# reservation customer with the latest 'corrected' one applied, as in CORE_SQL.
CUSTOMER_USAGE_SQL = """
SELECT segment_id, sum(used)::int AS used_cores FROM (
  SELECT c.segment_id,
         CASE WHEN v.status IN ('Reserved', 'In use') THEN 1 ELSE 0 END AS used
  FROM core_holds h
  JOIN cores c ON c.id = h.core_id
  JOIN core_status_v v ON v.core_id = c.id
  JOIN segments sp ON sp.id = c.segment_id
  JOIN reservations r ON r.id = h.reservation_id
  LEFT JOIN LATERAL (
    SELECT e.customer_id FROM reservation_events e
    WHERE e.reservation_id = r.id AND e.type = 'corrected' AND e.customer_id IS NOT NULL
    ORDER BY e.created_at DESC, e.id DESC LIMIT 1
  ) corr_cust ON true
  WHERE COALESCE(corr_cust.customer_id, r.customer_id) = :customer_id
    AND v.status IN ('Requested', 'Reserved', 'In use')
    AND (sp.survey_cores IS NULL OR c.number <= sp.survey_cores)
  UNION ALL
  SELECT u.segment_id, u.remaining::int
  FROM reservation_unassigned_v u
  JOIN reservations r ON r.id = u.reservation_id
  JOIN reservation_state_v st ON st.reservation_id = r.id AND st.status = 'approved'
  LEFT JOIN LATERAL (
    SELECT e.customer_id FROM reservation_events e
    WHERE e.reservation_id = r.id AND e.type = 'corrected' AND e.customer_id IS NOT NULL
    ORDER BY e.created_at DESC, e.id DESC LIMIT 1
  ) corr_cust ON true
  WHERE u.remaining > 0 AND COALESCE(corr_cust.customer_id, r.customer_id) = :customer_id
) usage
GROUP BY segment_id ORDER BY segment_id
"""
# The same counting as CUSTOMER_USAGE_SQL, kept per reservation and segment (one row each). srf_id and planned_date
# take the latest 'corrected' planned date like CORE_SQL.
CUSTOMER_RESERVATIONS_SQL = """
SELECT usage.reservation_id, r.srf_id, COALESCE(corr_date.planned_date, r.planned_date) AS planned_date,
       usage.segment_id, sum(usage.used)::int AS used_cores
FROM (
  SELECT h.reservation_id, c.segment_id,
         CASE WHEN v.status IN ('Reserved', 'In use') THEN 1 ELSE 0 END AS used
  FROM core_holds h
  JOIN cores c ON c.id = h.core_id
  JOIN core_status_v v ON v.core_id = c.id
  JOIN segments sp ON sp.id = c.segment_id
  WHERE v.status IN ('Requested', 'Reserved', 'In use')
    AND (sp.survey_cores IS NULL OR c.number <= sp.survey_cores)
  UNION ALL
  SELECT u.reservation_id, u.segment_id, u.remaining::int
  FROM reservation_unassigned_v u
  JOIN reservation_state_v st ON st.reservation_id = u.reservation_id AND st.status = 'approved'
  WHERE u.remaining > 0
) usage
JOIN reservations r ON r.id = usage.reservation_id
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
WHERE COALESCE(corr_cust.customer_id, r.customer_id) = :customer_id
GROUP BY usage.reservation_id, r.srf_id, corr_date.planned_date, r.planned_date, usage.segment_id
ORDER BY usage.reservation_id, usage.segment_id
"""
GET_CUSTOMER_SQL = "SELECT id, name FROM customers WHERE id = :customer_id"

SEARCH_SEGMENT_SQL = """
SELECT a.name || ' - ' || b.name, s.id, NULL::bigint, NULL::bigint FROM segments s
JOIN sites a ON a.id = s.site_a_id JOIN sites b ON b.id = s.site_b_id
WHERE a.name ILIKE :like ESCAPE '\\' OR b.name ILIKE :like ESCAPE '\\'
ORDER BY s.id LIMIT :n
"""
SEARCH_CORE_SQL = """
SELECT 'Core ' || c.number || ' on ' || a.name || ' - ' || b.name, c.segment_id, c.id, NULL::bigint FROM cores c
JOIN segments s ON s.id = c.segment_id AND (s.survey_cores IS NULL OR c.number <= s.survey_cores)
JOIN sites a ON a.id = s.site_a_id JOIN sites b ON b.id = s.site_b_id
WHERE c.number = :num ORDER BY c.segment_id LIMIT :n
"""


def _summary(row: dict[str, Any]) -> dict[str, Any]:
    free = row["status_mix"].get("Available", 0)
    not_surveyed = None
    if row["survey_cores"] is not None:
        not_surveyed = row["cable_size"] - row["survey_cores"]
    return {**row, "free_cores": free, "not_surveyed": not_surveyed,
            "free_to_reserve": free_to_reserve(row), "health": health(row)}


def list_segments(db: Session, region: str | None, route_type: str | None, query: str | None,
                  segment_id: int | None = None, route: str | None = None) -> list[dict[str, Any]]:
    params = {
        "region": region,
        "route_type": route_type,
        "route": (route or "").strip() or None,
        "q": query or None,
        "id": segment_id,
    }
    rows = db.execute(text(SEGMENT_SQL), params).mappings()
    return [_summary(dict(row)) for row in rows]


def get_segment(db: Session, segment_id: int) -> SegmentDetail | None:
    segments = list_segments(db, None, None, None, segment_id)
    if not segments:
        return None
    cores = db.execute(text(CORE_SQL), {"id": segment_id}).mappings()
    held = db.execute(text(UNASSIGNED_SQL), {"id": segment_id}).mappings()
    return SegmentDetail(
        **segments[0],
        cores=[CoreDetail(**core) for core in cores],
        unassigned=[UnassignedHold(**hold) for hold in held],
    )


def _holder_state(last: Any) -> str:
    """pending = requested; approved with a release waiting = release_requested."""
    if last["status"] == "pending":
        return "requested"
    if last["last_event"] == "release_requested":
        return "release_requested"
    return "approved"


def _holder(db: Session, row: Any, user: CurrentUser) -> Holder:
    reservation_id = row["reservation_id"]
    owner = db.execute(text(HOLDER_SQL), {"reservation_id": reservation_id}).mappings().one()
    last = db.execute(text(RESERVATION_STATE_SQL), {"reservation_id": reservation_id}).mappings().one()
    action_row = {**last, "planner_id": owner["id"]}
    return Holder(
        reservation_id=reservation_id,
        customer=row["customer"],
        planned_date=row["planned_date"],
        state=_holder_state(last),
        actions=allowed_names(action_row, user),
        stale=row["stale"],
        stale_since=row["stale_since"],
        srf_id=row["srf_id"],
        planner=row["planner"],
        age_days=row["age_days"],
        owner=Owner(**owner),
        is_mine=owner["id"] == user.id,
    )


def get_core(db: Session, core_id: int, user: CurrentUser) -> CoreHolderDetail | None:
    row = db.execute(text(CORE_ONE_SQL), {"id": core_id}).mappings().first()
    if row is None:
        return None
    holder = None
    if row["reservation_id"] is not None:
        holder = _holder(db, row, user)
    return CoreHolderDetail(
        core_id=row["id"],
        number=row["number"],
        segment_id=row["segment_id"],
        segment_name=row["segment_name"],
        status=row["status"],
        port_a=row["port_a"],
        port_b=row["port_b"],
        holder=holder,
    )


def list_segment_summaries(db: Session, region: str | None, route_type: str | None,
                           query: str | None, route: str | None = None) -> list[SegmentSummary]:
    segments = list_segments(db, region, route_type, query, route=route)
    return [SegmentSummary(**segment) for segment in segments]


def list_customers(db: Session, query: str | None) -> list[Customer]:
    rows = db.execute(text(LIST_CUSTOMERS_SQL), {"q": query or None}).mappings()
    return [Customer(**row) for row in rows]


def similar_customers(db: Session, name: str) -> list[Customer]:
    rows = db.execute(text(SIMILAR_CUSTOMERS_SQL), {"name": name}).mappings()
    return [Customer(**row) for row in rows]


def find_customer(db: Session, name: str) -> Customer | None:
    row = db.execute(text(FIND_CUSTOMER_SQL), {"name": name}).mappings().first()
    if row is None:
        return None
    return Customer(**row)


def create_customer(db: Session, name: str, user_id: int) -> Customer:
    row = db.execute(text(CREATE_CUSTOMER_SQL), {"name": name, "user_id": user_id}).mappings().first()
    if row is None:
        # someone added the same name (any case) first
        return find_customer(db, name)  # type: ignore[return-value]
    return Customer(**row)


def _like_pattern(query: str) -> str:
    """The query as a LIKE pattern matching anywhere, with LIKE's own characters escaped."""
    escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return "%" + escaped + "%"


def search(db: Session, query: str) -> list[SearchResult]:
    number = None
    if query.isdigit():
        number = int(query)
    params = {"q": query, "like": _like_pattern(query), "n": PER_TYPE, "num": number}
    searches = [
        ("customer", SEARCH_CUSTOMER_SQL),
        ("segment", SEARCH_SEGMENT_SQL),
    ]
    if number is not None:
        searches.append(("core", SEARCH_CORE_SQL))
    result_types = get_args(SearchResult.model_fields["type"].annotation)
    out: list[SearchResult] = []
    for result_type, sql in searches:
        assert result_type in result_types
        for label, segment_id, core_id, customer_id in db.execute(text(sql), params):
            result = SearchResult(
                type=result_type,  # type: ignore[arg-type]
                label=label,
                segment_id=segment_id,
                core_id=core_id,
                customer_id=customer_id,
            )
            out.append(result)
    return out


def customer_usage(db: Session, customer_id: int) -> CustomerUsage | None:
    customer = db.execute(text(GET_CUSTOMER_SQL), {"customer_id": customer_id}).first()
    if customer is None:
        return None
    rows = db.execute(text(CUSTOMER_USAGE_SQL), {"customer_id": customer_id})
    segments = [SegmentUsage(segment_id=row.segment_id, used_cores=row.used_cores) for row in rows]
    return CustomerUsage(
        customer_id=customer.id,
        name=customer.name,
        segments=segments,
        reservations=_customer_reservations(db, customer_id),
    )


def _customer_reservations(db: Session, customer_id: int) -> list[ReservationUsage]:
    rows = db.execute(text(CUSTOMER_RESERVATIONS_SQL), {"customer_id": customer_id})
    by_reservation: dict[int, ReservationUsage] = {}
    for row in rows:
        reservation = by_reservation.get(row.reservation_id)
        if reservation is None:
            reservation = ReservationUsage(
                reservation_id=row.reservation_id,
                srf_id=row.srf_id,
                planned_date=row.planned_date,
                used_cores=0,
                segments=[],
            )
            by_reservation[row.reservation_id] = reservation
        reservation.used_cores += row.used_cores
        reservation.segments.append(SegmentUsage(segment_id=row.segment_id, used_cores=row.used_cores))
    return list(by_reservation.values())
