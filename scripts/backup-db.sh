#!/usr/bin/env bash
# Dump the database to backups/ and keep the newest KEEP files.
# Run from the repo root on the server, by hand or from cron:
#   15 2 * * * cd /path/to/fiber && ./scripts/backup-db.sh >> backups/backup.log 2>&1
# Copy backups/ to another machine or share: a backup on the same disk does not survive a disk loss.
set -euo pipefail

cd "$(dirname "$0")/.."

keep="${KEEP:-14}"
backup_dir="backups"
stamp="$(date +%Y%m%d-%H%M%S)"
target="$backup_dir/fiber-$stamp.dump"

mkdir -p "$backup_dir"

# Custom format (-Fc) is compressed and lets pg_restore pick tables; written to a temp name first
# so a failed dump never looks like a good backup.
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$target.partial"
mv "$target.partial" "$target"
echo "$(date -Iseconds) wrote $target ($(du -h "$target" | cut -f1))"

ls -1t "$backup_dir"/fiber-*.dump | tail -n +"$((keep + 1))" | while read -r old; do
  rm -- "$old"
  echo "removed $old"
done
