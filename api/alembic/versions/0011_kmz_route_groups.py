"""kmz_groups.route: a route group is a group on a segment whose line elements are that segment's route lines

Revision ID: 0011
Revises: 0010
"""
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE kmz_groups ADD COLUMN route boolean NOT NULL DEFAULT false")
    op.execute(
        "ALTER TABLE kmz_groups ADD CONSTRAINT kmz_groups_route_needs_segment "
        "CHECK (NOT route OR segment_id IS NOT NULL)"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE kmz_groups DROP CONSTRAINT kmz_groups_route_needs_segment")
    op.execute("ALTER TABLE kmz_groups DROP COLUMN route")
