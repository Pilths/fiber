"""Link loss: calculated vs measured. Pure rules first, then the queries. Rounding happens in schemas only."""
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.link_type import ROUTE_TYPE_SQL

DB_PER_KM = Decimal("0.25")
DB_PER_SPLICE = Decimal("0.1")
DB_PER_CONNECTOR = Decimal("0.5")
KM_PER_SPLICE = Decimal(4)  # one splice every 4 km, exact fraction
CONNECTORS_PER_SEGMENT = 2
Level = Literal["green", "amber", "red", "off_scale"]
LEVELS: tuple[Level, ...] = ("green", "amber", "red", "off_scale")  # worst last


def calculated_loss_db(distance_km: Decimal | None) -> Decimal | None:
    """Owner formula: km x 0.25 + 0.1 x (km / 4) + 0.5 x 2 connectors, 2 decimals. Same for every core."""
    if distance_km is None:
        return None
    km = Decimal(distance_km)
    db = km * DB_PER_KM + DB_PER_SPLICE * (km / KM_PER_SPLICE) + DB_PER_CONNECTOR * CONNECTORS_PER_SEGMENT
    return db.quantize(Decimal("0.01"), ROUND_HALF_UP)


def deviation_pct(measured: Decimal | None, calculated: Decimal | None) -> Decimal | None:
    if measured is None or not calculated:
        return None
    return (Decimal(measured) - calculated) / calculated * 100


def warning_level(deviation: Decimal | None) -> Level | None:
    """Values exactly on 3, 7 or 10 belong to the lower level (RISK-004); at or below calculated is green."""
    if deviation is None:
        return None
    for limit, level in ((3, "green"), (7, "amber"), (10, "red")):
        if deviation <= limit:
            return level  # type: ignore[return-value]
    return "off_scale"


def worst(levels: list[Level | None]) -> Level | None:
    known = [lv for lv in levels if lv]
    return max(known, key=LEVELS.index) if known else None


_ROWS = """
SELECT s.id AS segment_id, a.name || ' - ' || b.name AS segment_name, s.region, @@ROUTE_TYPE@@ AS route_type, s.distance_km,
       m.loss_db AS measured_db, m.test_method, m.field_team, c.number AS worst_core_number,
       (SELECT count(DISTINCT core_id) FROM measurements WHERE segment_id = s.id) AS measured_cores,
       coalesce(s.survey_cores, 0) AS total_cores,
       coalesce(m.tested_on, (m.created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date) AS last_test_date
FROM segments s JOIN sites a ON a.id = s.site_a_id JOIN sites b ON b.id = s.site_b_id
LEFT JOIN LATERAL (
  SELECT * FROM (SELECT DISTINCT ON (coalesce(core_id, -1)) * FROM measurements WHERE segment_id = s.id
                 ORDER BY coalesce(core_id, -1), coalesce(tested_on, (created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date) DESC, created_at DESC, id DESC) l
  ORDER BY loss_db DESC, coalesce(tested_on, (created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date) DESC, id DESC LIMIT 1) m ON true
LEFT JOIN cores c ON c.id = m.core_id
WHERE (CAST(:segment_id AS bigint) IS NULL OR s.id = :segment_id)
  AND (CAST(:region AS text) IS NULL OR s.region = :region)
  AND (CAST(:route_type AS text) IS NULL OR @@ROUTE_TYPE@@ = :route_type)
""".replace("@@ROUTE_TYPE@@", ROUTE_TYPE_SQL)


def _row(r: dict) -> dict:
    calc = calculated_loss_db(r["distance_km"])
    meas = r["measured_db"]
    dev = deviation_pct(meas, calc)
    status = "no_distance" if calc is None else "measured" if meas is not None else "calculated_only"
    return {**r, "calculated_db": calc, "difference_db": None if calc is None or meas is None else meas - calc,
            "deviation_pct": dev, "level": warning_level(dev), "status": status}


def segment_rows(db: Session, segment_id: int | None = None, region: str | None = None,
              route_type: str | None = None) -> list[dict]:
    rs = db.execute(text(_ROWS + " ORDER BY s.id"), {"segment_id": segment_id, "region": region, "route_type": route_type})
    return [_row(dict(r)) for r in rs.mappings()]


def history(db: Session, segment_id: int) -> list[dict]:
    rs = db.execute(text(
        "SELECT m.loss_db, m.tested_on, m.created_at, m.test_method, m.field_team, m.core_id, c.number AS core_number "
        "FROM measurements m LEFT JOIN cores c ON c.id = m.core_id WHERE m.segment_id = :s "
        "ORDER BY coalesce(m.tested_on, (m.created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date) DESC, m.created_at DESC, m.id DESC"),
        {"s": segment_id})
    return [dict(r) for r in rs.mappings()]


def core_losses(db: Session, segment_id: int, calculated: Decimal | None) -> list[dict]:
    """One entry per core with measurements, by core number; history newest first. Anonymous (no core) rows are left out."""
    by_core: dict[int, list[dict]] = {}
    for h in history(db, segment_id):
        if h["core_id"] is not None:
            by_core.setdefault(h["core_id"], []).append(h)
    out = []
    for hs in by_core.values():
        latest = hs[0]
        dev = deviation_pct(latest["loss_db"], calculated)
        out.append({"core_id": latest["core_id"], "core_number": latest["core_number"], "calculated_db": calculated,
                    "measured_db": latest["loss_db"], "difference_db": None if calculated is None else latest["loss_db"] - calculated,
                    "deviation_pct": dev, "level": warning_level(dev), "tested_on": latest["tested_on"],
                    "test_method": latest["test_method"], "field_team": latest["field_team"], "history": hs})
    return sorted(out, key=lambda c: c["core_number"])


def coverage(db: Session) -> dict:
    segments = db.execute(text(
        "SELECT s.id, s.region, EXISTS (SELECT 1 FROM measurements WHERE segment_id = s.id) AS measured FROM segments s"
    )).mappings().all()

    def count(rows) -> dict:
        return {"measured": sum(r["measured"] for r in rows), "total": len(rows)}

    segs = db.execute(text(
        "SELECT g.id AS route_id, a.name || ' - ' || b.name AS name, count(*) AS total, "
        "count(*) FILTER (WHERE EXISTS (SELECT 1 FROM measurements WHERE segment_id = ss.segment_id)) AS measured "
        "FROM routes g JOIN sites a ON a.id = g.site_a_id JOIN sites b ON b.id = g.site_b_id "
        "JOIN route_segments ss ON ss.route_id = g.id GROUP BY g.id, a.name, b.name ORDER BY g.id")).mappings().all()
    return {**count(segments),
            "by_region": {reg: count([r for r in segments if r["region"] == reg])
                          for reg in sorted({r["region"] for r in segments if r["region"]})},
            "routes": [dict(s) for s in segs]}


def route(db: Session, segment_ids: list[int]) -> dict | None:
    """Rows in the given order plus totals. None if any id is unknown."""
    by_id = {r["segment_id"]: r for r in segment_rows(db)}
    if any(i not in by_id for i in segment_ids):
        return None
    rows = [by_id[i] for i in segment_ids]
    calc = [r["calculated_db"] for r in rows]
    meas = [r["measured_db"] for r in rows]
    # ponytail: totals are null (not partial sums) when any segment lacks the figure, so a gap never reads as 0 dB
    total_calc = None if not rows or None in calc else sum(calc)
    total_meas = None if not rows or None in meas else sum(meas)
    return {"segments": rows, "total_calculated_db": total_calc, "total_measured_db": total_meas,
            "level": worst([r["level"] for r in rows])}
