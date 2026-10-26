"""Dev-only: add measurements covering every loss level to existing spans. Idempotent. Run: python -m app.seed_dev_loss"""
import os
import sys

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import engine

TAG = "DEV-LOSS"  # field_team marker; rows carrying it are never added twice
# factor vs calculated (distance * 0.3): below, green, amber, red, off_scale
FACTORS = [("below calculated", 0.9), ("green", 1.02), ("amber", 1.05), ("red", 1.085), ("off_scale", 1.2)]


def main() -> None:
    if os.environ.get("APP_ENV") != "development":
        sys.exit("seed_dev_loss runs only when APP_ENV=development")
    with Session(engine) as db:
        if db.execute(text("SELECT 1 FROM measurements WHERE field_team = :t LIMIT 1"), {"t": TAG}).first():
            print("already seeded; nothing to do")
            return
        # newest measurement wins, so these override the older random ones from seed_dev
        spans = db.execute(text("SELECT id, distance_km FROM spans WHERE distance_km IS NOT NULL ORDER BY id")).all()
        for (sid, km), (label, f) in zip(spans, FACTORS):
            db.execute(text("INSERT INTO measurements (span_id, loss_db, tested_on, test_method, field_team) "
                            "VALUES (:s, :l, current_date - 7, 'OTDR', :t)"),
                       {"s": sid, "l": round(float(km) * 0.3 * f, 3), "t": TAG})
            print(f"span {sid}: {label}")
        db.commit()


if __name__ == "__main__":
    main()
