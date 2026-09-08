#!/usr/bin/env bash
set -euo pipefail

repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
remote_tab_source="${BROWSHARE_REMOTE_TAB_SOURCE:-$repo_root/../browshare-tab-remote}"
image="${1:-browshare/gateway:local}"

if [ ! -f "$remote_tab_source/apps/signaling/package.json" ]; then
  echo 'Remote Tab signaling source is required. Set BROWSHARE_REMOTE_TAB_SOURCE to its checkout.' >&2
  exit 1
fi
node "$repo_root/tools/check-worker-runtime-compatibility.mjs"
docker build --platform linux/amd64 \
  --build-context "remote-tab-source=$remote_tab_source" \
  --target gateway \
  --file "$repo_root/deploy/docker/Dockerfile" \
  --tag "$image" "$repo_root"
