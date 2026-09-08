#!/bin/sh

set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 OUTPUT.dump" >&2
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

command -v pg_dump >/dev/null 2>&1 || {
  echo 'pg_dump is required.' >&2
  exit 69
}
command -v pg_restore >/dev/null 2>&1 || {
  echo 'pg_restore is required.' >&2
  exit 69
}

output=$1
if [ -e "$output" ]; then
  echo "Refusing to overwrite existing backup: $output" >&2
  exit 73
fi

read_database_url
output_directory=$(dirname "$output")
mkdir -p "$output_directory"
temporary=$(mktemp "${output}.tmp.XXXXXX")
trap 'rm -f "$temporary"' EXIT HUP INT TERM

umask 077
pg_dump \
  --dbname="$database_url" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="$temporary"
pg_restore --list "$temporary" >/dev/null
chmod 600 "$temporary"
mv "$temporary" "$output"
trap - EXIT HUP INT TERM

echo "BrowShare PostgreSQL backup written to $output"
