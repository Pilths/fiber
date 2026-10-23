"""surveyed capacity, count-only reservations, assigned event, reservation state views

Revision ID: 0004
Revises: 0003
"""
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

OLD_TYPES = ("'requested','approved','rejected','withdrawn','kept','release_requested',"
             "'released','release_declined','corrected'")
NEW_TYPES = OLD_TYPES + ",'assigned'"

CORE_STATUS_V = """
CREATE OR REPLACE VIEW core_status_v AS
SELECT c.id AS core_id,
  CASE
    WHEN fault.new_value = 'Faulty' THEN 'Faulty'
    WHEN c.in_use THEN 'In use'
    WHEN hold.last_event IN (%s) THEN 'Reserved'
    WHEN hold.last_event = 'requested' THEN 'Requested'
    ELSE 'Available'
  END AS status
FROM cores c
LEFT JOIN LATERAL (
  SELECT e.new_value FROM data_edits e
  WHERE e.entity = 'core' AND e.field = 'status' AND e.entity_id = c.id
  ORDER BY e.created_at DESC, e.id DESC LIMIT 1
) fault ON true
LEFT JOIN LATERAL (
  SELECT (SELECT re.type FROM reservation_events re
          WHERE re.reservation_id = h.reservation_id
          ORDER BY re.created_at DESC, re.id DESC LIMIT 1) AS last_event
  FROM core_holds h WHERE h.core_id = c.id
) hold ON true
"""
# A held core whose reservation's last event is 'released' is the rest of a partial release: still Reserved.
RESERVED_OLD = "'approved','kept','release_requested','release_declined','corrected'"
RESERVED_NEW = RESERVED_OLD + ",'released','assigned'"

# status: pending (no approval yet), rejected, withdrawn, approved, ended (released and nothing held any more).
# stale_since: latest keep, else approval (imported with a reserved date: that date), in Asia/Kuala_Lumpur dates.
STATE_V = """
CREATE VIEW reservation_state_v AS
SELECT t.*,
  (t.status = 'approved' AND t.last_event <> 'release_requested'
   AND (t.stale_since + interval '3 months')::date < (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date) AS is_stale
FROM (
  SELECT r.id AS reservation_id,
    CASE
      WHEN ap.at IS NOT NULL THEN
        CASE WHEN rel.n > 0 AND NOT EXISTS (SELECT 1 FROM core_holds h WHERE h.reservation_id = r.id)
             THEN 'ended' ELSE 'approved' END
      WHEN le.type = 'rejected' THEN 'rejected'
      WHEN le.type = 'withdrawn' THEN 'withdrawn'
      ELSE 'pending'
    END AS status,
    le.type AS last_event, le.created_at AS last_event_at,
    CASE WHEN le.type IN ('rejected','release_declined') THEN le.reason END AS last_reason,
    GREATEST(
      CASE WHEN r.imported AND r.planned_date IS NOT NULL THEN r.planned_date
           ELSE (ap.at AT TIME ZONE 'Asia/Kuala_Lumpur')::date END,
      (kp.at AT TIME ZONE 'Asia/Kuala_Lumpur')::date) AS stale_since
  FROM reservations r
  LEFT JOIN LATERAL (SELECT e.type, e.reason, e.created_at FROM reservation_events e
                     WHERE e.reservation_id = r.id ORDER BY e.created_at DESC, e.id DESC LIMIT 1) le ON true
  LEFT JOIN LATERAL (SELECT min(e.created_at) AS at FROM reservation_events e
                     WHERE e.reservation_id = r.id AND e.type = 'approved') ap ON true
  LEFT JOIN LATERAL (SELECT max(e.created_at) AS at FROM reservation_events e
                     WHERE e.reservation_id = r.id AND e.type = 'kept') kp ON true
  LEFT JOIN LATERAL (SELECT count(*) AS n FROM reservation_events e
                     WHERE e.reservation_id = r.id AND e.type = 'released') rel ON true
) t
"""

# Count-only reservations: still-unassigned cores = unassigned_cores - cores assigned so far; 0 once the reservation is over.
UNASSIGNED_V = """
CREATE VIEW reservation_unassigned_v AS
SELECT r.id AS reservation_id, r.unassigned_span_id AS span_id,
  CASE WHEN st.status IN ('pending','approved')
       THEN GREATEST(r.unassigned_cores - (SELECT count(*) FROM reservation_cores rc WHERE rc.reservation_id = r.id), 0)
       ELSE 0 END AS remaining
FROM reservations r
JOIN reservation_state_v st ON st.reservation_id = r.id
WHERE r.unassigned_cores > 0
"""


def upgrade() -> None:
    op.execute("ALTER TABLE spans ADD COLUMN cable_size integer NOT NULL DEFAULT 144 "
               "CONSTRAINT spans_cable_size_ck CHECK (cable_size > 0)")
    op.execute("ALTER TABLE reservations ADD COLUMN unassigned_cores integer NOT NULL DEFAULT 0 "
               "CONSTRAINT reservations_unassigned_ck CHECK (unassigned_cores >= 0)")
    op.execute("ALTER TABLE reservations ADD COLUMN unassigned_span_id bigint REFERENCES spans(id)")
    op.execute("ALTER TABLE reservations ADD CONSTRAINT reservations_unassigned_span_ck "
               "CHECK (unassigned_cores = 0 OR unassigned_span_id IS NOT NULL)")
    op.execute("ALTER TABLE reservation_events DROP CONSTRAINT reservation_events_type_ck")
    op.execute(f"ALTER TABLE reservation_events ADD CONSTRAINT reservation_events_type_ck CHECK (type IN ({NEW_TYPES}))")
    op.execute(CORE_STATUS_V % RESERVED_NEW)
    op.execute(STATE_V)
    op.execute(UNASSIGNED_V)


def downgrade() -> None:
    op.execute("DROP VIEW reservation_unassigned_v")
    op.execute("DROP VIEW reservation_state_v")
    op.execute(CORE_STATUS_V % RESERVED_OLD)
    op.execute("ALTER TABLE reservation_events DROP CONSTRAINT reservation_events_type_ck")
    op.execute(f"ALTER TABLE reservation_events ADD CONSTRAINT reservation_events_type_ck CHECK (type IN ({OLD_TYPES}))")
    op.execute("ALTER TABLE reservations DROP CONSTRAINT reservations_unassigned_span_ck")
    op.execute("ALTER TABLE reservations DROP COLUMN unassigned_span_id")
    op.execute("ALTER TABLE reservations DROP COLUMN unassigned_cores")
    op.execute("ALTER TABLE spans DROP COLUMN cable_size")
