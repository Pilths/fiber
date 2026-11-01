"""loss belongs to a core: measurements.core_id (nullable; old Excel imports have no core)

Revision ID: 0012
Revises: 0011
"""
from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE measurements ADD COLUMN core_id bigint REFERENCES cores(id)")
    op.execute("CREATE INDEX measurements_core_ix ON measurements (core_id)")


def downgrade() -> None:
    op.execute("DROP INDEX measurements_core_ix")
    op.execute("ALTER TABLE measurements DROP COLUMN core_id")
