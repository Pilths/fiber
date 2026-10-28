#!/bin/sh
# Make a separate, fully seeded DEMO database next to your normal one. Nothing is deleted or overwritten.
# Run from the project folder with the stack up:  ./demo/setup_demo_db.sh
# Then point the app at it (see demo/DEMO.md). Safe to run again: it rebuilds only the fiber_demo database.
set -eu
cd "$(dirname "$0")/.."

docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS fiber_demo WITH (FORCE)" -c "CREATE DATABASE fiber_demo"'

docker compose exec -T api sh -c '
  set -e
  U="${DATABASE_URL%/*}/fiber_demo"
  export ALEMBIC_DATABASE_URL="$U" DATABASE_URL="$U"
  alembic upgrade head
  for m in seed_dev seed_dev_loss seed_dev_shape; do python -m app.$m; done
'
echo
echo "Demo database ready: fiber_demo (users planner1, planner2, admin1, admin2; password is DEV_PASSWORD from .env)."
echo "Now set DATABASE_URL in .env to end with /fiber_demo and run: docker compose up -d api"
