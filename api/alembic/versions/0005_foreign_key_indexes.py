"""btree indexes on foreign-key columns that had none

Revision ID: 0005
Revises: 0004
"""
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

NEW_INDEXES = (
    ("reservation_cores", "core_id"),
    ("core_holds", "reservation_id"),
    ("reservations", "customer_id"),
    ("reservations", "planner_id"),
    ("reservations", "unassigned_segment_id"),
    ("release_cores", "core_id"),
    ("assign_cores", "core_id"),
    ("route_segments", "segment_id"),
    ("upload_rows", "upload_id"),
    ("cores", "port_a_id"),
    ("cores", "port_b_id"),
    ("reservation_events", "user_id"),
    ("routes", "site_a_id"),
    ("routes", "site_b_id"),
    ("segments", "site_a_id"),
    ("segments", "site_b_id"),
)


def upgrade() -> None:
    for table, column in NEW_INDEXES:
        op.create_index(f"{table}_{column}_ix", table, [column])


def downgrade() -> None:
    for table, column in NEW_INDEXES:
        op.drop_index(f"{table}_{column}_ix", table_name=table)
