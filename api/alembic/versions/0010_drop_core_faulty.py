"""drop the per-core Faulty status: core_status_v without the data_edits 'fault' branch (a fibre cut is spans.fiber_cut)

Old data_edits rows (entity 'core', field 'status') are kept as history and no longer drive a status.

Revision ID: 0010
Revises: 0009
"""
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None

RESERVED = "'approved','kept','release_requested','release_declined','corrected','released','assigned'"

HOLD = """
LEFT JOIN LATERAL (
  SELECT (SELECT re.type FROM reservation_events re
          WHERE re.reservation_id = h.reservation_id
          ORDER BY re.created_at DESC, re.id DESC LIMIT 1) AS last_event
  FROM core_holds h WHERE h.core_id = c.id
) hold ON true
"""

NEW = f"""
CREATE OR REPLACE VIEW core_status_v AS
SELECT c.id AS core_id,
  CASE
    WHEN c.in_use THEN 'In use'
    WHEN hold.last_event IN ({RESERVED}) THEN 'Reserved'
    WHEN hold.last_event = 'requested' THEN 'Requested'
    ELSE 'Available'
  END AS status
FROM cores c
{HOLD}"""

OLD = f"""
CREATE OR REPLACE VIEW core_status_v AS
SELECT c.id AS core_id,
  CASE
    WHEN fault.new_value = 'Faulty' THEN 'Faulty'
    WHEN c.in_use THEN 'In use'
    WHEN hold.last_event IN ({RESERVED}) THEN 'Reserved'
    WHEN hold.last_event = 'requested' THEN 'Requested'
    ELSE 'Available'
  END AS status
FROM cores c
LEFT JOIN LATERAL (
  SELECT e.new_value FROM data_edits e
  WHERE e.entity = 'core' AND e.field = 'status' AND e.entity_id = c.id
  ORDER BY e.created_at DESC, e.id DESC LIMIT 1
) fault ON true
{HOLD}"""


def upgrade() -> None:
    op.execute(NEW)


def downgrade() -> None:
    op.execute(OLD)
