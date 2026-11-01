"""span-level fiber cut: spans.fiber_cut

Revision ID: 0009
Revises: 0008
"""
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE spans ADD COLUMN fiber_cut boolean NOT NULL DEFAULT false")


def downgrade() -> None:
    op.execute("ALTER TABLE spans DROP COLUMN fiber_cut")
