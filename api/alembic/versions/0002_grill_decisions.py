"""grill decisions: corrections, append-only reservations, partial release, measurement fields, shared segment sites

Revision ID: 0002
Revises: 0001
"""
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

APPEND_ONLY = ["reservations", "reservation_cores", "release_cores"]
PAIR = "(LEAST(site_a_id, site_b_id), GREATEST(site_a_id, site_b_id))"


def upgrade() -> None:
    op.execute("ALTER TABLE reservation_events ADD COLUMN customer_id bigint REFERENCES customers(id)")
    op.execute("ALTER TABLE reservation_events ADD COLUMN planned_date date")
    op.execute("ALTER TABLE reservation_events ADD CONSTRAINT reservation_events_correction_ck "
               "CHECK (type = 'corrected' OR (customer_id IS NULL AND planned_date IS NULL))")
    op.execute("ALTER TABLE reservation_events ADD CONSTRAINT reservation_events_corrected_ck "
               "CHECK (type <> 'corrected' OR ((customer_id IS NOT NULL OR planned_date IS NOT NULL) "
               "AND length(trim(coalesce(reason, ''))) > 0))")
    op.execute("""
CREATE TABLE release_cores (
  event_id bigint NOT NULL REFERENCES reservation_events(id),
  core_id bigint NOT NULL REFERENCES cores(id),
  PRIMARY KEY (event_id, core_id)
)""")
    for t in APPEND_ONLY:
        op.execute(f"CREATE TRIGGER {t}_append_only BEFORE UPDATE OR DELETE ON {t} "
                   "FOR EACH ROW EXECUTE FUNCTION forbid_change()")
    op.execute("ALTER TABLE measurements ADD COLUMN test_method text")
    op.execute("ALTER TABLE measurements ADD COLUMN field_team text")
    op.execute("DROP INDEX segments_site_pair_uq")
    op.execute(f"CREATE INDEX segments_site_pair_ix ON segments {PAIR}")


def downgrade() -> None:
    op.execute("DROP INDEX segments_site_pair_ix")
    op.execute(f"CREATE UNIQUE INDEX segments_site_pair_uq ON segments {PAIR}")
    op.execute("ALTER TABLE measurements DROP COLUMN field_team")
    op.execute("ALTER TABLE measurements DROP COLUMN test_method")
    for t in APPEND_ONLY:
        op.execute(f"DROP TRIGGER {t}_append_only ON {t}")
    op.execute("DROP TABLE release_cores")
    op.execute("ALTER TABLE reservation_events DROP CONSTRAINT reservation_events_corrected_ck")
    op.execute("ALTER TABLE reservation_events DROP CONSTRAINT reservation_events_correction_ck")
    op.execute("ALTER TABLE reservation_events DROP COLUMN planned_date")
    op.execute("ALTER TABLE reservation_events DROP COLUMN customer_id")
