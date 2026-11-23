"""data_edits.upload_id: which upload wrote an edit; no upload means a dashboard edit

Revision ID: 0008
Revises: 0007

Protection of a field from uploads used to read the remarks text. Now a field is protected when it has an edit
with no upload_id. Old rows are linked once from their remarks (the trailing "#N" of an upload note). Old
"data file load" rows get one new uploads row of their own. Remarks stay as they are.

uploads.kind gets one more value, data_file, for what app.load_data writes.
data_edits is append-only, so the trigger is switched off for the backfill and back on after it.
"""
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None

UPLOAD_NOTE_PREFIXES = ("segment list upload", "reservation upload", "site master upload")
KIND_CHECK = "uploads_kind_ck"


def upgrade() -> None:
    op.execute("ALTER TABLE data_edits ADD COLUMN upload_id bigint REFERENCES uploads (id)")
    op.execute("CREATE INDEX data_edits_upload_id_ix ON data_edits (upload_id)")
    op.execute(f"ALTER TABLE uploads DROP CONSTRAINT {KIND_CHECK}")
    op.execute(
        f"ALTER TABLE uploads ADD CONSTRAINT {KIND_CHECK} "
        "CHECK (kind IN ('excel', 'kmz', 'site_master', 'segment_list', 'data_file'))"
    )
    op.execute("ALTER TABLE data_edits DISABLE TRIGGER data_edits_append_only")
    for prefix in UPLOAD_NOTE_PREFIXES:
        op.execute(f"""
            UPDATE data_edits d
            SET upload_id = u.id
            FROM uploads u
            WHERE d.upload_id IS NULL
              AND d.remarks LIKE '{prefix}%'
              AND u.id = CAST(substring(d.remarks FROM '#([0-9]+)$') AS bigint)
        """)
    # The "override_drop" rows of a site master upload point at their upload by entity_id.
    op.execute("""
        UPDATE data_edits d
        SET upload_id = u.id
        FROM uploads u
        WHERE d.entity = 'upload' AND d.upload_id IS NULL AND u.id = d.entity_id
    """)
    op.execute("""
        WITH first_edit AS (
            SELECT user_id FROM data_edits WHERE remarks LIKE 'data file load%' ORDER BY id LIMIT 1
        ), new_upload AS (
            INSERT INTO uploads (user_id, filename, kind, status, confirmed_at)
            SELECT user_id, 'data file load, before 0008', 'data_file', 'confirmed', now() FROM first_edit
            RETURNING id
        )
        UPDATE data_edits
        SET upload_id = (SELECT id FROM new_upload)
        WHERE remarks LIKE 'data file load%' AND upload_id IS NULL AND EXISTS (SELECT 1 FROM new_upload)
    """)
    op.execute("ALTER TABLE data_edits ENABLE TRIGGER data_edits_append_only")


def downgrade() -> None:
    op.execute("ALTER TABLE data_edits DROP COLUMN upload_id")
    # Rows of kind data_file may exist, so the old check guards new rows only.
    op.execute(f"ALTER TABLE uploads DROP CONSTRAINT {KIND_CHECK}")
    op.execute(
        f"ALTER TABLE uploads ADD CONSTRAINT {KIND_CHECK} "
        "CHECK (kind IN ('excel', 'kmz', 'site_master', 'segment_list')) NOT VALID"
    )
