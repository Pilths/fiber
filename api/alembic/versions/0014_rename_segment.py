"""rename: span -> segment (site to site), old segment -> route (named group), segment_spans -> route_segments

Tables, columns, constraint/index/sequence names, the unassigned view, and stored values
(data_edits.entity 'span', uploads.kind 'span_list', upload_rows.entity 'span').

Revision ID: 0014
Revises: 0013
"""
import re

import sqlalchemy as sa
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None

FWD = ({"segment_spans": "route_segments", "segment": "route", "span": "segment"}, r"segment_spans|segment|span")
BACK = ({"route_segments": "segment_spans", "routes": "segments", "route_id": "segment_id", "segment": "span"},
        r"route_segments|routes|route_id|segment")

OLD_VIEW = """
CREATE VIEW reservation_unassigned_v AS
SELECT r.id AS reservation_id, r.unassigned_span_id AS span_id,
  CASE WHEN st.status IN ('pending','approved')
       THEN GREATEST(r.unassigned_cores - (SELECT count(*) FROM reservation_cores rc WHERE rc.reservation_id = r.id), 0)
       ELSE 0 END AS remaining
FROM reservations r
JOIN reservation_state_v st ON st.reservation_id = r.id
WHERE r.unassigned_cores > 0
"""
NEW_VIEW = OLD_VIEW.replace("unassigned_span_id AS span_id", "unassigned_segment_id AS segment_id")


def _names(first_pat: str, second_pat: str, mapping, rx) -> None:
    """Rename constraints, then loose indexes, then sequences, whose names match first_pat, then second_pat.
    Two passes so a new name never meets a name that has not been renamed yet."""
    db = op.get_bind()
    sub = lambda n: re.sub(rx, lambda m: mapping[m.group(0)], n)
    for pat in (first_pat, second_pat):
        for name, tbl in db.execute(sa.text(
                "SELECT conname, conrelid::regclass::text FROM pg_constraint "
                "WHERE connamespace = 'public'::regnamespace AND conrelid <> 0 AND conname ~ :p"), {"p": pat}).all():
            if sub(name) != name:
                op.execute(f'ALTER TABLE {tbl} RENAME CONSTRAINT "{name}" TO "{sub(name)}"')
        for (name,) in db.execute(sa.text("SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname ~ :p"), {"p": pat}).all():
            if sub(name) != name:
                op.execute(f'ALTER INDEX "{name}" RENAME TO "{sub(name)}"')
        for (name,) in db.execute(sa.text(
                "SELECT relname FROM pg_class WHERE relkind = 'S' AND relnamespace = 'public'::regnamespace AND relname ~ :p"), {"p": pat}).all():
            if sub(name) != name:
                op.execute(f'ALTER SEQUENCE "{name}" RENAME TO "{sub(name)}"')


def _values(entity_from, entity_to, kind_from, kind_to, reason_from, reason_to, key_from, key_to) -> None:
    op.execute("ALTER TABLE uploads DROP CONSTRAINT uploads_kind_ck")
    op.execute(f"UPDATE uploads SET kind = '{kind_to}' WHERE kind = '{kind_from}'")
    op.execute(f"ALTER TABLE uploads ADD CONSTRAINT uploads_kind_ck CHECK (kind IN ('excel','kmz','site_master','{kind_to}'))")
    op.execute(f"UPDATE upload_rows SET entity = '{entity_to}' WHERE entity = '{entity_from}'")
    op.execute(f"UPDATE upload_rows SET payload = replace(payload::text, '\"{key_from}\"', '\"{key_to}\"')::jsonb "
               f"WHERE payload::text LIKE '%\"{key_from}\"%'")
    op.execute("ALTER TABLE data_edits DISABLE TRIGGER data_edits_append_only")
    op.execute(f"UPDATE data_edits SET entity = '{entity_to}' WHERE entity = '{entity_from}'")
    op.execute(f"UPDATE data_edits SET reason = '{reason_to}' || substr(reason, {len(reason_from) + 1}) WHERE reason LIKE '{reason_from}%'")
    op.execute("ALTER TABLE data_edits ENABLE TRIGGER data_edits_append_only")


def upgrade() -> None:
    op.execute("DROP VIEW reservation_unassigned_v")
    op.execute("ALTER TABLE segment_spans RENAME TO route_segments")
    op.execute("ALTER TABLE segments RENAME TO routes")
    op.execute("ALTER TABLE route_segments RENAME COLUMN segment_id TO route_id")
    op.execute("ALTER TABLE route_segments RENAME COLUMN span_id TO segment_id")
    op.execute("ALTER TABLE spans RENAME TO segments")
    op.execute("ALTER TABLE cores RENAME COLUMN span_id TO segment_id")
    op.execute("ALTER TABLE measurements RENAME COLUMN span_id TO segment_id")
    op.execute("ALTER TABLE reservations RENAME COLUMN unassigned_span_id TO unassigned_segment_id")
    _names("segment", "span", *FWD)
    op.execute(NEW_VIEW)
    _values("span", "segment", "span_list", "segment_list", "span list upload", "segment list upload", "span_id", "segment_id")


def downgrade() -> None:
    _values("segment", "span", "segment_list", "span_list", "segment list upload", "span list upload", "segment_id", "span_id")
    op.execute("DROP VIEW reservation_unassigned_v")
    _names("segment", "routes|route_id", *BACK)
    op.execute("ALTER TABLE reservations RENAME COLUMN unassigned_segment_id TO unassigned_span_id")
    op.execute("ALTER TABLE measurements RENAME COLUMN segment_id TO span_id")
    op.execute("ALTER TABLE cores RENAME COLUMN segment_id TO span_id")
    op.execute("ALTER TABLE segments RENAME TO spans")
    op.execute("ALTER TABLE route_segments RENAME COLUMN segment_id TO span_id")
    op.execute("ALTER TABLE route_segments RENAME COLUMN route_id TO segment_id")
    op.execute("ALTER TABLE routes RENAME TO segments")
    op.execute("ALTER TABLE route_segments RENAME TO segment_spans")
    op.execute(OLD_VIEW)
