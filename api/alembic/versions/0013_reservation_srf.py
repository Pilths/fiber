"""reservations.srf_id: SRF reference (optional, from Excel or the create form)

Revision ID: 0013
Revises: 0012
"""
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE reservations ADD COLUMN srf_id text")


def downgrade() -> None:
    op.execute("ALTER TABLE reservations DROP COLUMN srf_id")
