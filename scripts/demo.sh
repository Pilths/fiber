#!/usr/bin/env bash
# Demo copy of production, next to it on the same server. Production is never touched.
#   ./scripts/demo.sh up                            # backup, start demo on DEMO_PORT, load the backup into it
#   ./scripts/demo.sh up ADMIN mock.xlsx route.kmz  # same, then load mock files as ADMIN
#   ./scripts/demo.sh down                          # delete the demo containers and its database
# Run from the repo root on the production server (main branch).
set -euo pipefail

cd "$(dirname "$0")/.."

project="fiber-demo"
port="${DEMO_PORT:-8001}"

demo() {
  API_PORT="$port" docker compose -p "$project" "$@"
}

start_demo() {
  ./scripts/backup-db.sh
  local dump
  dump="$(ls -1t backups/fiber-*.dump | head -n 1)"

  demo up -d --build --wait
  demo exec -T db sh -c 'dropdb -U "$POSTGRES_USER" --force "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
  demo exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error' < "$dump"
  demo restart api
  echo "demo loaded from $dump"
}

load_mock_files() {
  local admin="$1"
  shift
  for file in "$@"; do
    local name
    name="$(basename "$file")"
    demo cp "$file" "api:/app/data/$name"
    if [[ "$name" == *.kmz ]]; then
      demo exec -T api python -m app.load_kmz "$admin" "data/$name"
    else
      demo exec -T api python -m app.load_data "$admin" "data/$name"
    fi
  done
}

case "${1:-}" in
  up)
    shift
    start_demo
    if [[ $# -ge 2 ]]; then
      load_mock_files "$@"
    fi
    echo "demo ready: http://$(hostname):$port (use a separate browser profile)"
    ;;
  down)
    # The project name is fixed here so this can never remove the production volume.
    demo down -v
    echo "demo deleted"
    ;;
  *)
    echo "usage: $0 up [ADMIN file.xlsx|file.kmz ...] | down" >&2
    exit 1
    ;;
esac
