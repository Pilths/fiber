"""measurements record which user added them (null for uploads and seeds)

Revision ID: 0003
Revises: 0002
"""
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE measurements ADD COLUMN created_by bigint REFERENCES users(id)")


def downgrade() -> None:
    op.execute("ALTER TABLE measurements DROP COLUMN created_by")
