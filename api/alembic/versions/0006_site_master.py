"""site master upload: sites.active and upload kind 'site_master'

Revision ID: 0006
Revises: 0005
"""
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


GROUPS = "'new','changed','conflict','missing','rejected','needs_review'"


def upgrade() -> None:
    op.execute("ALTER TABLE upload_rows DROP CONSTRAINT upload_rows_group_ck")
    op.execute(f"ALTER TABLE upload_rows ADD CONSTRAINT upload_rows_group_ck CHECK (row_group IN ({GROUPS},'unchanged'))")
    op.execute("ALTER TABLE sites ADD COLUMN active boolean NOT NULL DEFAULT true")
    op.execute("ALTER TABLE uploads DROP CONSTRAINT uploads_kind_ck")
    op.execute("ALTER TABLE uploads ADD CONSTRAINT uploads_kind_ck CHECK (kind IN ('excel','kmz','site_master'))")


def downgrade() -> None:
    # site master staging cannot exist under the old constraint
    op.execute("DELETE FROM upload_rows WHERE upload_id IN (SELECT id FROM uploads WHERE kind = 'site_master')")
    op.execute("DELETE FROM uploads WHERE kind = 'site_master'")
    op.execute("ALTER TABLE uploads DROP CONSTRAINT uploads_kind_ck")
    op.execute("ALTER TABLE uploads ADD CONSTRAINT uploads_kind_ck CHECK (kind IN ('excel','kmz'))")
    op.execute("ALTER TABLE upload_rows DROP CONSTRAINT upload_rows_group_ck")
    op.execute(f"ALTER TABLE upload_rows ADD CONSTRAINT upload_rows_group_ck CHECK (row_group IN ({GROUPS}))")
    op.execute("ALTER TABLE sites DROP COLUMN active")
