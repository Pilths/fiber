"""cluster_sites.removed_at / removed_by: removing a site from a cluster keeps the row

Revision ID: 0010
Revises: 0009
"""
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE cluster_sites ADD COLUMN removed_at timestamptz")
    op.execute("ALTER TABLE cluster_sites ADD COLUMN removed_by bigint REFERENCES users (id)")
    op.execute("CREATE INDEX cluster_sites_removed_by_ix ON cluster_sites (removed_by)")


def downgrade() -> None:
    op.execute("DROP INDEX cluster_sites_removed_by_ix")
    op.execute("ALTER TABLE cluster_sites DROP COLUMN removed_by")
    op.execute("ALTER TABLE cluster_sites DROP COLUMN removed_at")
