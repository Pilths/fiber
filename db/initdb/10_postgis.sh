#!/bin/sh
# Replaces the postgis image's own 10_postgis.sh, which also creates tiger geocoder, topology and
# fuzzystrmatch. The app needs only postgis (pg_trgm is created by migration 0001).
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
	CREATE EXTENSION IF NOT EXISTS postgis;
SQL
