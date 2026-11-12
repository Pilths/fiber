"""drop cores.circuit_id: no data source for it (owner decision, 11 Nov 2026)

Revision ID: 0004
Revises: 0003
"""
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE cores DROP COLUMN circuit_id")


def downgrade() -> None:
    op.execute("ALTER TABLE cores ADD COLUMN circuit_id text")
