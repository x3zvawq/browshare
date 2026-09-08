#!/bin/sh

set -eu

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 BACKUP_DIRECTORY KEEP_COUNT" >&2
  exit 64
fi

directory=$1
keep=$2
case "$keep" in
  ''|*[!0-9]*) echo 'KEEP_COUNT must be a non-negative integer.' >&2; exit 64 ;;
esac

if [ ! -d "$directory" ]; then
  echo "Backup directory not found: $directory" >&2
  exit 66
fi

# Only archives produced by database-backup.sh are candidates. Other files,
# temporary files and nested paths are intentionally left untouched.
set -- "$directory"/*.dump
if [ ! -e "$1" ]; then
  echo "No PostgreSQL backup archives found in $directory"
  exit 0
fi

archives=$(ls -1t -- "$directory"/*.dump)
index=0
printf '%s\n' "$archives" | while IFS= read -r archive; do
  index=$((index + 1))
  if [ "$index" -gt "$keep" ]; then
    rm -- "$archive"
    echo "Removed expired PostgreSQL backup: $archive"
  fi
done

echo "Retained $keep newest PostgreSQL backup archive(s) in $directory"
