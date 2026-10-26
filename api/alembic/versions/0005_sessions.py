"""login sessions (cookie token stored as SHA-256)

Revision ID: 0005
Revises: 0004
"""
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE TABLE sessions (id text PRIMARY KEY, user_id bigint NOT NULL REFERENCES users(id), "
               "created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL)")
    op.execute("CREATE INDEX sessions_user_ix ON sessions (user_id)")


def downgrade() -> None:
    op.execute("DROP TABLE sessions")
