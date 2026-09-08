#!/bin/sh

set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 INPUT.dump" >&2
  exit 64
fi

read_database_url() {
  if [ -n "${DATABASE_URL:-}" ] && [ -n "${DATABASE_URL_FILE:-}" ]; then
    echo 'Set only one of DATABASE_URL or DATABASE_URL_FILE.' >&2
    exit 64
  fi
  if [ -n "${DATABASE_URL_FILE:-}" ]; then
    if [ ! -f "$DATABASE_URL_FILE" ]; then
      echo 'DATABASE_URL_FILE does not reference a readable file.' >&2
      exit 66
    fi
    database_url=$(cat "$DATABASE_URL_FILE")
  else
    database_url=${DATABASE_URL:-}
  fi
  if [ -z "$database_url" ]; then
    echo 'DATABASE_URL or DATABASE_URL_FILE is required.' >&2
    exit 64
  fi
}

command -v psql >/dev/null 2>&1 || {
  echo 'psql is required.' >&2
  exit 69
}
command -v pg_restore >/dev/null 2>&1 || {
  echo 'pg_restore is required.' >&2
  exit 69
}

archive=$1
if [ ! -f "$archive" ]; then
  echo "Backup archive not found: $archive" >&2
  exit 66
fi

read_database_url
pg_restore --list "$archive" >/dev/null

table_count=$(psql "$database_url" --no-psqlrc --tuples-only --no-align --command="
  select count(*)
  from information_schema.tables
  where table_schema not in ('pg_catalog', 'information_schema');
")
table_count=$(printf '%s' "$table_count" | tr -d '[:space:]')
if [ "$table_count" != '0' ]; then
  echo 'Restore target must be an empty database.' >&2
  exit 65
fi

pg_restore \
  --dbname="$database_url" \
  --exit-on-error \
  --single-transaction \
  --no-owner \
  --no-privileges \
  "$archive"

migration_count=$(psql "$database_url" --no-psqlrc --tuples-only --no-align --command="
  select count(*) from browshare_internal.schema_migrations;
")
migration_count=$(printf '%s' "$migration_count" | tr -d '[:space:]')
if [ "$migration_count" = '0' ]; then
  echo 'Restored database has no BrowShare migration history.' >&2
  exit 65
fi

echo "BrowShare PostgreSQL restore completed with $migration_count recorded migration(s)."
