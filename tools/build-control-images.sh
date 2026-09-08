#!/usr/bin/env bash
set -euo pipefail

repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
remote_tab_source="${BROWSHARE_REMOTE_TAB_SOURCE:-$repo_root/../browshare-tab-remote}"
tag="${1:-local}"
if [ ! -f "$remote_tab_source/packages/viewer/package.json" ]; then
  echo 'Remote Tab source is required. Set BROWSHARE_REMOTE_TAB_SOURCE to its checkout.' >&2
  exit 1
fi
node "$repo_root/tools/check-worker-runtime-compatibility.mjs"
for target in backend migrator gateway portal; do
  docker build --platform linux/amd64 \
    --build-context "remote-tab-source=$remote_tab_source" \
    --target "$target" \
    --file "$repo_root/deploy/docker/Dockerfile" \
    --tag "browshare/$target:$tag" "$repo_root"
done
