"""Link loss: calculated vs measured. Pure rules first, then the queries. Rounding happens in schemas only."""
from decimal import Decimal
from typing import Literal

from sqlalchemy import text
from sqlalchemy.orm import Session

DB_PER_KM = Decimal("0.3")
Level = Literal["green", "amber", "red", "off_scale"]
LEVELS: tuple[Level, ...] = ("green", "amber", "red", "off_scale")  # worst last


def calculated_loss_db(distance_km: Decimal | None) -> Decimal | None:
    return None if distance_km is None else Decimal(distance_km) * DB_PER_KM


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
SELECT s.id AS span_id, a.name || ' - ' || b.name AS span_name, s.region, s.route_type, s.distance_km,
       m.loss_db AS measured_db, m.test_method, m.field_team,
       coalesce(m.tested_on, (m.created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date) AS last_test_date
FROM spans s JOIN sites a ON a.id = s.site_a_id JOIN sites b ON b.id = s.site_b_id
LEFT JOIN LATERAL (SELECT * FROM measurements WHERE span_id = s.id ORDER BY coalesce(tested_on, (created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date) DESC, created_at DESC, id DESC LIMIT 1) m ON true
WHERE (CAST(:span_id AS bigint) IS NULL OR s.id = :span_id)
  AND (CAST(:region AS text) IS NULL OR s.region = :region)
  AND (CAST(:route_type AS text) IS NULL OR s.route_type = :route_type)
"""


def _row(r: dict) -> dict:
    calc = calculated_loss_db(r["distance_km"])
    meas = r["measured_db"]
    dev = deviation_pct(meas, calc)
    status = "no_distance" if calc is None else "measured" if meas is not None else "calculated_only"
    return {**r, "calculated_db": calc, "difference_db": None if calc is None or meas is None else meas - calc,
            "deviation_pct": dev, "level": warning_level(dev), "status": status}


def span_rows(db: Session, span_id: int | None = None, region: str | None = None,
              route_type: str | None = None) -> list[dict]:
    rs = db.execute(text(_ROWS + " ORDER BY s.id"), {"span_id": span_id, "region": region, "route_type": route_type})
    return [_row(dict(r)) for r in rs.mappings()]


def history(db: Session, span_id: int) -> list[dict]:
    rs = db.execute(text(
        "SELECT loss_db, tested_on, created_at, test_method, field_team FROM measurements "
        "WHERE span_id = :s ORDER BY coalesce(tested_on, (created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date) DESC, created_at DESC, id DESC"), {"s": span_id})
    return [dict(r) for r in rs.mappings()]


def coverage(db: Session) -> dict:
    spans = db.execute(text(
        "SELECT s.id, s.region, EXISTS (SELECT 1 FROM measurements WHERE span_id = s.id) AS measured FROM spans s"
    )).mappings().all()

    def count(rows) -> dict:
        return {"measured": sum(r["measured"] for r in rows), "total": len(rows)}

    segs = db.execute(text(
        "SELECT g.id AS segment_id, a.name || ' - ' || b.name AS name, count(*) AS total, "
        "count(*) FILTER (WHERE EXISTS (SELECT 1 FROM measurements WHERE span_id = ss.span_id)) AS measured "
        "FROM segments g JOIN sites a ON a.id = g.site_a_id JOIN sites b ON b.id = g.site_b_id "
        "JOIN segment_spans ss ON ss.segment_id = g.id GROUP BY g.id, a.name, b.name ORDER BY g.id")).mappings().all()
    return {**count(spans),
            "by_region": {reg: count([r for r in spans if r["region"] == reg])
                          for reg in sorted({r["region"] for r in spans if r["region"]})},
            "segments": [dict(s) for s in segs]}


def route(db: Session, span_ids: list[int]) -> dict | None:
    """Rows in the given order plus totals. None if any id is unknown."""
    by_id = {r["span_id"]: r for r in span_rows(db)}
    if any(i not in by_id for i in span_ids):
        return None
    rows = [by_id[i] for i in span_ids]
    calc = [r["calculated_db"] for r in rows]
    meas = [r["measured_db"] for r in rows]
    # ponytail: totals are null (not partial sums) when any span lacks the figure, so a gap never reads as 0 dB
    total_calc = None if not rows or None in calc else sum(calc)
    total_meas = None if not rows or None in meas else sum(meas)
    return {"spans": rows, "total_calculated_db": total_calc, "total_measured_db": total_meas,
            "level": worst([r["level"] for r in rows])}
