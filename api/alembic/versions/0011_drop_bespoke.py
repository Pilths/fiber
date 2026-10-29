"""route type Bespoke is the same as Metro: Bespoke spans become Metro, the check allows Trunk and Metro

Revision ID: 0011
Revises: 0010
"""
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # keep the change as history, attributed to the first admin when one exists
    op.execute("""
        INSERT INTO data_edits (entity, entity_id, field, old_value, new_value, reason, user_id)
        SELECT 'span', s.id, 'route_type', 'Bespoke', 'Metro', 'Bespoke merged into Metro (migration 0011)', a.id
        FROM spans s CROSS JOIN LATERAL (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1) a
        WHERE s.route_type = 'Bespoke'
    """)
    op.execute("UPDATE spans SET route_type = 'Metro' WHERE route_type = 'Bespoke'")
    op.execute("ALTER TABLE spans DROP CONSTRAINT spans_route_type_ck")
    op.execute("ALTER TABLE spans ADD CONSTRAINT spans_route_type_ck CHECK (route_type IN ('Trunk','Metro'))")


def downgrade() -> None:
    op.execute("ALTER TABLE spans DROP CONSTRAINT spans_route_type_ck")
    op.execute("ALTER TABLE spans ADD CONSTRAINT spans_route_type_ck CHECK (route_type IN ('Bespoke','Trunk','Metro'))")
