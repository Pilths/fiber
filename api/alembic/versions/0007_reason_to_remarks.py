"""reason becomes remarks (optional everywhere); the checks that forced a non-blank reason go

Revision ID: 0007
Revises: 0006

Downgrade renames back and re-adds the non-blank checks as NOT VALID: rows with NULL remarks may exist
and the append-only triggers forbid fixing them, so the checks guard new rows only. data_edits.reason
stays nullable for the same reason.
"""
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE data_edits DROP CONSTRAINT IF EXISTS data_edits_reason_ck")
    op.execute("ALTER TABLE data_edits RENAME COLUMN reason TO remarks")
    op.execute("ALTER TABLE data_edits ALTER COLUMN remarks DROP NOT NULL")
    op.execute("ALTER TABLE reservation_events DROP CONSTRAINT reservation_events_corrected_ck")
    op.execute("ALTER TABLE reservation_events RENAME COLUMN reason TO remarks")
    op.execute(
        "ALTER TABLE reservation_events ADD CONSTRAINT reservation_events_corrected_ck "
        "CHECK (type <> 'corrected' OR customer_id IS NOT NULL OR planned_date IS NOT NULL)"
    )
    # ALTER VIEW keeps reservation_unassigned_v, which reads this view.
    op.execute("ALTER VIEW reservation_state_v RENAME COLUMN last_reason TO last_remarks")


def downgrade() -> None:
    op.execute("ALTER VIEW reservation_state_v RENAME COLUMN last_remarks TO last_reason")
    op.execute("ALTER TABLE reservation_events DROP CONSTRAINT reservation_events_corrected_ck")
    op.execute("ALTER TABLE reservation_events RENAME COLUMN remarks TO reason")
    op.execute(
        "ALTER TABLE reservation_events ADD CONSTRAINT reservation_events_corrected_ck "
        "CHECK (type <> 'corrected' OR ((customer_id IS NOT NULL OR planned_date IS NOT NULL) "
        "AND length(trim(coalesce(reason, ''))) > 0)) NOT VALID"
    )
    op.execute("ALTER TABLE data_edits RENAME COLUMN remarks TO reason")
    op.execute(
        "ALTER TABLE data_edits ADD CONSTRAINT data_edits_reason_ck "
        "CHECK (length(trim(reason)) > 0) NOT VALID"
    )
