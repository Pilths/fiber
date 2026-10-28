"""span list upload: spans.route, spans.section and upload kind 'span_list'

Revision ID: 0008
Revises: 0007
"""
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE spans ADD COLUMN route text, ADD COLUMN section text")
    op.execute("ALTER TABLE uploads DROP CONSTRAINT uploads_kind_ck")
    op.execute("ALTER TABLE uploads ADD CONSTRAINT uploads_kind_ck CHECK (kind IN ('excel','kmz','site_master','span_list'))")


def downgrade() -> None:
    # span list staging cannot exist under the old constraint
    op.execute("DELETE FROM upload_rows WHERE upload_id IN (SELECT id FROM uploads WHERE kind = 'span_list')")
    op.execute("DELETE FROM uploads WHERE kind = 'span_list'")
    op.execute("ALTER TABLE uploads DROP CONSTRAINT uploads_kind_ck")
    op.execute("ALTER TABLE uploads ADD CONSTRAINT uploads_kind_ck CHECK (kind IN ('excel','kmz','site_master'))")
    op.execute("ALTER TABLE spans DROP COLUMN route, DROP COLUMN section")
