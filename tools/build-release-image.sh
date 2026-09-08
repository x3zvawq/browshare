#!/usr/bin/env bash
set -euo pipefail

repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
remote_tab_source="${BROWSHARE_REMOTE_TAB_SOURCE:-$repo_root/../browshare-tab-remote}"
target="${1:?Usage: build-release-image.sh backend|migrator|gateway|portal|worker-chrome output-directory}"
output="${2:?An empty output directory is required}"
case "$target" in backend|migrator|gateway|portal|worker-chrome) ;; *) echo 'Unknown image target' >&2; exit 1 ;; esac
node "$repo_root/tools/check-worker-runtime-compatibility.mjs"
if [ ! -f "$repo_root/../build-inputs.json" ]; then
  echo 'Run this tool from a release:prepare .sources/browshare snapshot.' >&2
  exit 1
fi
mkdir -p "$(dirname -- "$output")"
mkdir "$output"
output="$(CDPATH= cd -- "$output" && pwd)"
cp "$repo_root/../build-inputs.json" "$output/source-inputs.json"
version="$(node -p "require(process.argv[1]).releaseVersion" "$repo_root/deploy/compatibility.json")"
image_name="$target"
if [ "$target" = worker-chrome ]; then image_name=worker; fi
# OCI export retains attestations even when the Docker image store cannot load them.
# No registry push; in particular, the Chrome-containing Worker is local-use only.
docker buildx build --platform linux/amd64 \
  --tag "browshare/$image_name:$version-candidate" \
  --build-context "remote-tab-source=$remote_tab_source" \
  --target "$target" --file "$repo_root/deploy/docker/Dockerfile" \
  --provenance=mode=max --sbom=true \
  --metadata-file "$output/build-metadata.json" \
  --output "type=oci,dest=$output/$target.oci.tar" "$repo_root"
node "$repo_root/tools/verify-release-image.mjs" "$output/$target.oci.tar" "$output"
node "$repo_root/tools/release-artifacts.mjs" finalize "$output"
node "$repo_root/tools/release-artifacts.mjs" verify "$output"
