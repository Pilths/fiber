"""initial schema

Revision ID: 0001
Revises:
"""
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

TABLES = """
CREATE TABLE users (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username text NOT NULL UNIQUE,
  display_name text NOT NULL,
  role text NOT NULL CONSTRAINT users_role_ck CHECK (role IN ('planner','admin')),
  password_hash text,
  must_change_password boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sites (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE,
  kind text NOT NULL CONSTRAINT sites_kind_ck CHECK (kind IN ('site','building','equipment','data_center','toc')),
  geom geometry(Point,4326),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE spans (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_a_id bigint NOT NULL REFERENCES sites(id),
  site_b_id bigint NOT NULL REFERENCES sites(id),
  route_type text CONSTRAINT spans_route_type_ck CHECK (route_type IN ('Bespoke','Trunk','Metro')),
  region text CONSTRAINT spans_region_ck CHECK (region IN ('North','Central','South','East Coast')),
  distance_km numeric(10,3) CONSTRAINT spans_distance_ck CHECK (distance_km >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spans_sites_differ_ck CHECK (site_a_id <> site_b_id)
);
CREATE UNIQUE INDEX spans_site_pair_uq ON spans (LEAST(site_a_id, site_b_id), GREATEST(site_a_id, site_b_id));
CREATE TABLE segments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_a_id bigint NOT NULL REFERENCES sites(id),
  site_b_id bigint NOT NULL REFERENCES sites(id),
  geom geometry(LineString,4326),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT segments_sites_differ_ck CHECK (site_a_id <> site_b_id)
);
CREATE UNIQUE INDEX segments_site_pair_uq ON segments (LEAST(site_a_id, site_b_id), GREATEST(site_a_id, site_b_id));
CREATE TABLE segment_spans (
  segment_id bigint NOT NULL REFERENCES segments(id),
  span_id bigint NOT NULL REFERENCES spans(id),
  position integer NOT NULL,
  PRIMARY KEY (segment_id, span_id),
  UNIQUE (segment_id, position)
);
CREATE TABLE ports (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  port_id text NOT NULL UNIQUE,
  site_id bigint NOT NULL REFERENCES sites(id)
);
CREATE TABLE cores (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  span_id bigint NOT NULL REFERENCES spans(id),
  number integer NOT NULL,
  port_a_id bigint REFERENCES ports(id),
  port_b_id bigint REFERENCES ports(id),
  circuit_id text,
  in_use boolean NOT NULL DEFAULT false,
  UNIQUE (span_id, number)
);
CREATE TABLE customers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  created_by bigint REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX customers_name_lower_uq ON customers (lower(name));
CREATE TABLE reservations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES customers(id),
  planner_id bigint NOT NULL REFERENCES users(id),
  planned_date date,
  is_new_customer boolean NOT NULL DEFAULT false,
  imported boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE reservation_cores (
  reservation_id bigint NOT NULL REFERENCES reservations(id),
  core_id bigint NOT NULL REFERENCES cores(id),
  PRIMARY KEY (reservation_id, core_id)
);
CREATE TABLE reservation_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reservation_id bigint NOT NULL REFERENCES reservations(id),
  type text NOT NULL CONSTRAINT reservation_events_type_ck CHECK (type IN (
    'requested','approved','rejected','withdrawn','kept','release_requested',
    'released','release_declined','corrected')),
  user_id bigint NOT NULL REFERENCES users(id),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reservation_events_res_created_ix ON reservation_events (reservation_id, created_at);
CREATE TABLE core_holds (
  core_id bigint PRIMARY KEY REFERENCES cores(id),
  reservation_id bigint NOT NULL REFERENCES reservations(id)
);
CREATE TABLE uploads (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id),
  filename text NOT NULL,
  kind text NOT NULL CONSTRAINT uploads_kind_ck CHECK (kind IN ('excel','kmz')),
  status text NOT NULL DEFAULT 'staged' CONSTRAINT uploads_status_ck CHECK (status IN ('staged','confirmed','discarded')),
  summary jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz
);
CREATE TABLE upload_rows (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  upload_id bigint NOT NULL REFERENCES uploads(id),
  row_group text NOT NULL CONSTRAINT upload_rows_group_ck CHECK (row_group IN ('new','changed','conflict','missing','rejected')),
  entity text NOT NULL,
  payload jsonb NOT NULL,
  warnings jsonb
);
CREATE TABLE measurements (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  span_id bigint NOT NULL REFERENCES spans(id),
  loss_db numeric(8,3) NOT NULL,
  tested_on date,
  upload_id bigint REFERENCES uploads(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX measurements_span_created_ix ON measurements (span_id, created_at);
CREATE TABLE data_edits (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity text NOT NULL,
  entity_id bigint NOT NULL,
  field text NOT NULL,
  old_value text,
  new_value text,
  reason text NOT NULL CONSTRAINT data_edits_reason_ck CHECK (length(trim(reason)) > 0),
  user_id bigint NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX data_edits_entity_ix ON data_edits (entity, entity_id, field, created_at);
CREATE TABLE job_runs (
  job_name text NOT NULL,
  run_date date NOT NULL,
  ran_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_name, run_date)
);
"""

# Drop order: children before parents.
DROP_ORDER = [
    "job_runs", "data_edits", "measurements", "upload_rows", "uploads", "core_holds",
    "reservation_events", "reservation_cores", "reservations", "customers", "cores",
    "ports", "segment_spans", "segments", "spans", "sites", "users",
]
APPEND_ONLY = ["reservation_events", "measurements", "data_edits"]

FORBID_CHANGE = """
CREATE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;
"""

# Priority: Faulty > In use > Reserved > Requested > Available.
CORE_STATUS_V = """
CREATE VIEW core_status_v AS
SELECT c.id AS core_id,
  CASE
    WHEN fault.new_value = 'Faulty' THEN 'Faulty'
    WHEN c.in_use THEN 'In use'
    WHEN hold.last_event IN ('approved','kept','release_requested','release_declined','corrected') THEN 'Reserved'
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
) hold ON true;
"""


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    # one statement per execute (psycopg prepared-statement friendly)
    for stmt in TABLES.split(";\n"):
        if stmt.strip():
            op.execute(stmt)
    op.execute(FORBID_CHANGE)
    for t in APPEND_ONLY:
        op.execute(f"CREATE TRIGGER {t}_append_only BEFORE UPDATE OR DELETE ON {t} "
                   "FOR EACH ROW EXECUTE FUNCTION forbid_change()")
    op.execute(CORE_STATUS_V)


def downgrade() -> None:
    op.execute("DROP VIEW core_status_v")
    for t in APPEND_ONLY:
        op.execute(f"DROP TRIGGER {t}_append_only ON {t}")
    op.execute("DROP FUNCTION forbid_change()")
    for t in DROP_ORDER:
        op.execute(f"DROP TABLE {t}")
