#!/usr/bin/env bash

set -euo pipefail

repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
manifest="$repo_root/deploy/compatibility.json"
seccomp_profile="$repo_root/deploy/docker/chrome-seccomp.json"
image="${1:-browshare/worker:local}"
container="browshare-worker-image-verify-$$"

read_manifest() {
  node -e "const p=require(process.argv[1]); process.stdout.write(String($1))" "$manifest"
}

expected_node="$(read_manifest 'p.node.runtimeVersion')"
expected_chrome="$(read_manifest 'p.chrome.product.replace("Chrome/", "")')"
expected_remote_tab="$(read_manifest 'p.remoteTab.releaseVersion')"
expected_chrome_package="$(read_manifest 'p.chrome.packageVersion')"

cleanup() {
  docker rm --force "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

test "$(docker image inspect "$image" --format '{{.Architecture}}')" = amd64
test "$(docker image inspect "$image" --format '{{.Config.User}}')" = node
test "$(docker image inspect "$image" --format '{{json .Config.Entrypoint}}')" = '["/usr/bin/tini","--"]'
test "$(docker image inspect "$image" --format '{{json .Config.Cmd}}')" = '["node","dist/cli.mjs"]'
test "$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.licenses"}}')" = MIT

docker run --rm \
  --entrypoint /bin/sh \
  --env "EXPECTED_NODE=$expected_node" \
  --env "EXPECTED_REMOTE_TAB=$expected_remote_tab" \
  --env "EXPECTED_CHROME=$expected_chrome" \
  --env "EXPECTED_CHROME_PACKAGE=$expected_chrome_package" \
  "$image" \
  -ceu '
    test "$(google-chrome-stable --version)" = "Google Chrome $EXPECTED_CHROME "
    test "$(dpkg-query -W -f="\${Version}" google-chrome-stable)" = "$EXPECTED_CHROME_PACKAGE"
    test "$(node --version)" = "v$EXPECTED_NODE"
    test "$(stat -c "%U:%G %a" /var/lib/browshare/identity)" = "node:node 700"
    test "$(stat -c "%U:%G %a" /var/lib/browshare/profiles)" = "node:node 700"
    test "$(stat -c "%U:%G %a" /var/lib/browshare/session-temp)" = "node:node 700"
    test "$(stat -c "%U:%G %a" /var/lib/browshare/chrome-policy)" = "node:node 700"
    test "$(stat -c "%U:%G %a" /opt/google/chrome/chrome-sandbox)" = "root:root 4755"
    test "$(readlink /etc/opt/chrome/policies/managed/browshare-remote-tab.json)" = "/var/lib/browshare/chrome-policy/browshare-remote-tab.json"
    test -f /app/dist/cli.mjs
    test -f /app/package.json
    test ! -e /etc/apt/sources.list.d/google-chrome.sources
    test ! -e /etc/cron.daily/google-chrome
    test ! -e /etc/default/google-chrome
    test ! -e /usr/share/keyrings/google-chrome.gpg
    test ! -e /usr/local/lib/node_modules/npm
    test ! -e /usr/local/lib/node_modules/corepack
    test ! -x /usr/local/bin/npm
    test ! -x /usr/local/bin/corepack
    test ! -x /usr/local/bin/pnpm
    test ! -x /usr/local/bin/yarn
  '

docker run --rm --entrypoint node --env "EXPECTED_REMOTE_TAB=$expected_remote_tab" "$image" \
  --input-type=module -e 'const core = await import("@browshare/remote-tab-core"); const protocol = await import("@browshare/remote-tab-protocol"); if (core.REMOTE_TAB_CORE_VERSION !== process.env.EXPECTED_REMOTE_TAB || !Array.isArray(protocol.CAPABILITIES)) process.exit(1)'

docker run --detach \
  --name "$container" \
  --security-opt "seccomp=$seccomp_profile" \
  --security-opt no-new-privileges:true \
  --cap-drop ALL --cap-add SYS_CHROOT \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=256m \
  --tmpfs /home/node:rw,noexec,nosuid,uid=1000,gid=1000,mode=0700,size=64m \
  --shm-size 1g \
  --entrypoint /usr/bin/google-chrome-stable \
  "$image" \
  --headless=new \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/browshare-image-verify-profile \
  about:blank >/dev/null

version_json=''
for _ in $(seq 1 50); do
  if version_json="$(docker exec "$container" curl --fail --silent http://127.0.0.1:9222/json/version 2>/dev/null)"; then
    break
  fi
  if ! docker inspect "$container" --format '{{.State.Running}}' 2>/dev/null | grep -qx true; then
    docker logs "$container" >&2
    exit 1
  fi
  sleep 0.2
done

test -n "$version_json"
node -e '
  const version = JSON.parse(process.argv[1])
  if (version.Browser !== process.argv[2]) process.exit(1)
' "$version_json" "Chrome/$expected_chrome"

targets_json="$(docker exec "$container" curl --fail --silent http://127.0.0.1:9222/json/list)"
node -e '
  const targets = JSON.parse(process.argv[1])
  if (!targets.some((target) => target.type === "page" && target.url === "about:blank")) process.exit(1)
' "$targets_json"

test "$(docker exec "$container" id -u)" = 1000
if docker inspect "$container" --format '{{json .Args}}' | grep -Fq -- '--no-sandbox'; then
  printf 'Worker image verification rejected --no-sandbox\n' >&2
  exit 1
fi

printf '{"status":"passed","image":"%s","node":"%s","chrome":"Chrome/%s","sandbox":"chrome-seccomp"}\n' \
  "$image" "$expected_node" "$expected_chrome"
