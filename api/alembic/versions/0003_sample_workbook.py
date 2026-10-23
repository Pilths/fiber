"""sample workbook: site details and DC link, survey cores, reservation fields, staged row status, search indexes

Revision ID: 0003
Revises: 0002
"""
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

RESERVATION_COLS = [
    "group_label text", "additional boolean", "cv_ready_date date", "contractor text", "remark text",
    "port_info_raw text", "monitoring_code text",
    "fiber_monitored text CONSTRAINT reservations_fiber_monitored_ck CHECK (fiber_monitored IN ('Y','N','WIP'))",
]
UPLOAD_ROW_COLS = [
    "sheet text", "row_number integer", "reason text", "raw jsonb",
    "status text CONSTRAINT upload_rows_status_ck CHECK (status IN ('ready','needs_review','rejected'))",
]
GROUPS = "'new','changed','conflict','missing','rejected'"


def upgrade() -> None:
    op.execute("ALTER TABLE sites ADD COLUMN details jsonb")
    op.execute("ALTER TABLE sites ADD COLUMN lrd_site_id bigint REFERENCES sites(id)")
    op.execute("ALTER TABLE spans ADD COLUMN survey_cores integer")
    for c in RESERVATION_COLS:
        op.execute(f"ALTER TABLE reservations ADD COLUMN {c}")
    for c in UPLOAD_ROW_COLS:
        op.execute(f"ALTER TABLE upload_rows ADD COLUMN {c}")
    op.execute("ALTER TABLE upload_rows DROP CONSTRAINT upload_rows_group_ck")
    op.execute(f"ALTER TABLE upload_rows ADD CONSTRAINT upload_rows_group_ck CHECK (row_group IN ({GROUPS},'needs_review'))")
    op.execute("CREATE INDEX sites_geom_gix ON sites USING gist (geom)")
    op.execute("CREATE INDEX sites_name_trgm_ix ON sites USING gin (name gin_trgm_ops)")
    # cores.span_id: the UNIQUE (span_id, number) index from 0001 already serves it


def downgrade() -> None:
    op.execute("DROP INDEX sites_name_trgm_ix")
    op.execute("DROP INDEX sites_geom_gix")
    op.execute("ALTER TABLE upload_rows DROP CONSTRAINT upload_rows_group_ck")
    op.execute(f"ALTER TABLE upload_rows ADD CONSTRAINT upload_rows_group_ck CHECK (row_group IN ({GROUPS}))")
    for c in ["status", "raw", "reason", "row_number", "sheet"]:
        op.execute(f"ALTER TABLE upload_rows DROP COLUMN {c}")
    for c in ["fiber_monitored", "monitoring_code", "port_info_raw", "remark", "contractor",
              "cv_ready_date", "additional", "group_label"]:
        op.execute(f"ALTER TABLE reservations DROP COLUMN {c}")
    op.execute("ALTER TABLE spans DROP COLUMN survey_cores")
    op.execute("ALTER TABLE sites DROP COLUMN lrd_site_id")
    op.execute("ALTER TABLE sites DROP COLUMN details")
