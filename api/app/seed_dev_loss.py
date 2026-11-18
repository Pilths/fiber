"""Dev-only: add measurements covering every loss level to existing segments. Idempotent.

Run: python -m app.seed_dev_loss
"""
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import engine
from app.environment import require_development
from app.loss.service import calculated_loss_db

TAG = "DEV-LOSS"  # field_team marker; rows carrying it are never added twice
# factor vs calculated (calculated_loss_db(km)): below, green, amber, red, off_scale
FACTORS = [("below calculated", 0.9), ("green", 1.02), ("amber", 1.05), ("red", 1.085), ("off_scale", 1.2)]


SELECT_TAGGED = "SELECT 1 FROM measurements WHERE field_team = :tag LIMIT 1"
SELECT_SEGMENTS = "SELECT id, distance_km FROM segments WHERE distance_km IS NOT NULL ORDER BY id"
SELECT_CORES = "SELECT id FROM cores WHERE segment_id = :segment_id ORDER BY number LIMIT 3"
INSERT_MEASUREMENT = """
    INSERT INTO measurements (segment_id, core_id, loss_db, tested_on, test_method, field_team)
    VALUES (:segment_id, :core_id, :loss_db, (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date - :days_ago, 'OTDR', :tag)
"""


def measurement_plan(index: int, factor: float) -> list[tuple[int | None, float, int]]:
    """(core index or None, factor, days ago): the labelled level sits on the worst core; extra cores are milder.

    Segment 1: three cores. Segment 2: core 1 tested twice (old bad, new ok).
    Segment 3: no core (like an Excel import).
    """
    if index == 1:
        return [(0, factor, 0), (1, 0.95, 0), (2, 0.97, 0)]
    if index == 2:
        return [(0, factor, 0), (0, 1.15, 30)]
    if index == 3:
        return [(None, factor, 0)]
    return [(0, factor, 0), (1, 0.96, 0)]


def main() -> None:
    require_development("seed_dev_loss")
    with Session(engine) as db:
        if db.execute(text(SELECT_TAGGED), {"tag": TAG}).first():
            print("already seeded; nothing to do")
            return
        # Newest test date wins; today (KL) beats every seed_dev date, so these override the older random ones.
        segments = db.execute(text(SELECT_SEGMENTS)).all()
        for index, ((segment_id, km), (label, level_factor)) in enumerate(zip(segments, FACTORS)):
            cores = db.execute(text(SELECT_CORES), {"segment_id": segment_id}).scalars().all()
            for core_index, factor, days_ago in measurement_plan(index, level_factor):
                if core_index is not None and core_index >= len(cores):
                    continue
                core_id = None if core_index is None else cores[core_index]
                loss_db = round(float(calculated_loss_db(km)) * factor, 3)
                params = {
                    "segment_id": segment_id, "core_id": core_id, "loss_db": loss_db,
                    "days_ago": days_ago, "tag": TAG,
                }
                db.execute(text(INSERT_MEASUREMENT), params)
            print(f"segment {segment_id}: {label}")
        db.commit()


if __name__ == "__main__":
    main()
