"""assign_cores: which cores each 'assigned' event added (for reservation history)

Revision ID: 0007
Revises: 0006
"""
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
CREATE TABLE assign_cores (
  event_id bigint NOT NULL REFERENCES reservation_events(id),
  core_id bigint NOT NULL REFERENCES cores(id),
  PRIMARY KEY (event_id, core_id)
)""")
    op.execute("CREATE TRIGGER assign_cores_append_only BEFORE UPDATE OR DELETE ON assign_cores "
               "FOR EACH ROW EXECUTE FUNCTION forbid_change()")


def downgrade() -> None:
    op.execute("DROP TABLE assign_cores")
