"""drop postgis_tiger_geocoder, postgis_topology and fuzzystrmatch (the app uses only postgis and pg_trgm)

Revision ID: 0006
Revises: 0005
"""
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP EXTENSION IF EXISTS postgis_tiger_geocoder CASCADE")
    op.execute("DROP EXTENSION IF EXISTS postgis_topology CASCADE")
    op.execute("DROP EXTENSION IF EXISTS fuzzystrmatch")
    for schema in ("tiger_data", "tiger", "topology"):
        op.execute(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


def downgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS fuzzystrmatch")
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis_tiger_geocoder")
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis_topology")
