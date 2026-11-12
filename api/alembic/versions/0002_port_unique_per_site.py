"""port label is unique per site, not across the whole network

Revision ID: 0002
Revises: 0001
"""
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE ports DROP CONSTRAINT ports_port_id_key")
    op.execute("ALTER TABLE ports ADD CONSTRAINT ports_site_port_key UNIQUE (site_id, port_id)")


def downgrade() -> None:
    # Fails if the same label now exists at two sites; remove or rename those ports first.
    op.execute("ALTER TABLE ports DROP CONSTRAINT ports_site_port_key")
    op.execute("ALTER TABLE ports ADD CONSTRAINT ports_port_id_key UNIQUE (port_id)")
