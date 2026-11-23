"""KMZ elements: clusters, their sites, and the kept folders of a KMZ with their elements

Revision ID: 0009
Revises: 0008

A kmz_groups row is one kept KML folder. It belongs to exactly one segment, site or cluster. Nothing is deleted:
a group is hidden with hidden_at. data_edits needs no change (entity is free text).
"""
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE clusters (
            id bigserial PRIMARY KEY,
            name text NOT NULL,
            created_by bigint NOT NULL REFERENCES users (id),
            created_at timestamptz NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE UNIQUE INDEX clusters_name_lower_uq ON clusters (lower(name))")
    op.execute("""
        CREATE TABLE cluster_sites (
            cluster_id bigint NOT NULL REFERENCES clusters (id),
            site_id bigint NOT NULL REFERENCES sites (id),
            created_by bigint NOT NULL REFERENCES users (id),
            created_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (cluster_id, site_id)
        )
    """)
    op.execute("CREATE INDEX cluster_sites_site_id_ix ON cluster_sites (site_id)")
    op.execute("""
        CREATE TABLE kmz_groups (
            id bigserial PRIMARY KEY,
            upload_id bigint NOT NULL REFERENCES uploads (id),
            name text NOT NULL,
            folder_path text NOT NULL,
            segment_id bigint REFERENCES segments (id),
            site_id bigint REFERENCES sites (id),
            cluster_id bigint REFERENCES clusters (id),
            colour_mode text NOT NULL DEFAULT 'theme',
            hidden_at timestamptz,
            hidden_by bigint REFERENCES users (id),
            created_by bigint NOT NULL REFERENCES users (id),
            created_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT kmz_groups_one_target_ck CHECK (num_nonnulls(segment_id, site_id, cluster_id) = 1),
            CONSTRAINT kmz_groups_colour_mode_ck CHECK (colour_mode IN ('theme', 'kmz'))
        )
    """)
    for column in ("upload_id", "segment_id", "site_id", "cluster_id", "hidden_by", "created_by"):
        op.execute(f"CREATE INDEX kmz_groups_{column}_ix ON kmz_groups ({column})")
    op.execute("""
        CREATE TABLE kmz_elements (
            id bigserial PRIMARY KEY,
            group_id bigint NOT NULL REFERENCES kmz_groups (id),
            name text NOT NULL DEFAULT '',
            kind text NOT NULL,
            geom geometry(Geometry, 4326) NOT NULL,
            kmz_style jsonb NOT NULL DEFAULT '{}',
            CONSTRAINT kmz_elements_kind_ck CHECK (kind IN ('point', 'line', 'area'))
        )
    """)
    op.execute("CREATE INDEX kmz_elements_group_id_ix ON kmz_elements (group_id)")
    op.execute("CREATE INDEX kmz_elements_geom_ix ON kmz_elements USING gist (geom)")


def downgrade() -> None:
    op.execute("DROP TABLE kmz_elements")
    op.execute("DROP TABLE kmz_groups")
    op.execute("DROP TABLE cluster_sites")
    op.execute("DROP TABLE clusters")
