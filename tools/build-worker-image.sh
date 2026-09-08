#!/usr/bin/env bash
set -euo pipefail

repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
remote_tab_source="${BROWSHARE_REMOTE_TAB_SOURCE:-$repo_root/../browshare-tab-remote}"
image="${1:-browshare/worker:local}"

if [ ! -f "$remote_tab_source/packages/core/package.json" ]; then
  echo 'Remote Tab source is required. Set BROWSHARE_REMOTE_TAB_SOURCE to its checkout.' >&2
  exit 1
fi
if ! docker buildx version >/dev/null 2>&1; then
  echo 'Docker Buildx is required to build the Worker with its Remote Tab source context.' >&2
  exit 1
fi
node "$repo_root/tools/check-worker-runtime-compatibility.mjs"
docker build --platform linux/amd64 \
  --build-context "remote-tab-source=$remote_tab_source" \
  --target worker-chrome \
  --file "$repo_root/deploy/docker/Dockerfile" \
  --tag "$image" "$repo_root"
