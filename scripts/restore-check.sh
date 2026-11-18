#!/usr/bin/env bash
# Restore drill: load a backup into a separate database (fiber_restore_check) and count rows,
# so a backup is proven usable without touching the live database.
#   ./scripts/restore-check.sh                         # newest file in backups/
#   ./scripts/restore-check.sh backups/fiber-X.dump    # a given file
# A real restore (after data loss) uses the same pg_restore line against an empty live database.
set -euo pipefail

cd "$(dirname "$0")/.."

dump="${1:-$(ls -1t backups/fiber-*.dump | head -n 1)}"
check_db="fiber_restore_check"

echo "restoring $dump into $check_db"

docker compose exec -T db sh -c "dropdb -U \"\$POSTGRES_USER\" --if-exists $check_db"
docker compose exec -T db sh -c "createdb -U \"\$POSTGRES_USER\" $check_db"
docker compose exec -T db sh -c "pg_restore -U \"\$POSTGRES_USER\" -d $check_db --no-owner --exit-on-error" < "$dump"

count_sql="SELECT 'sites', count(*) FROM sites
UNION ALL SELECT 'segments', count(*) FROM segments
UNION ALL SELECT 'cores', count(*) FROM cores
UNION ALL SELECT 'reservations', count(*) FROM reservations
UNION ALL SELECT 'reservation_events', count(*) FROM reservation_events
UNION ALL SELECT 'users', count(*) FROM users
UNION ALL SELECT 'alembic_version ' || version_num, 1 FROM alembic_version"

docker compose exec -T db sh -c "psql -U \"\$POSTGRES_USER\" -d $check_db -At -F ' ' -c \"$count_sql\""

docker compose exec -T db sh -c "dropdb -U \"\$POSTGRES_USER\" $check_db"
echo "restore check passed; compare the counts with the live database"
