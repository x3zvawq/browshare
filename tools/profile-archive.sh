#!/bin/sh

# Run as the Worker storage owner after draining Sessions and stopping the Worker.
set -eu
umask 077
if [ "$#" -ne 4 ]; then
  echo "Usage: $0 backup|restore IDENTITY_DIRECTORY PROFILE_DIRECTORY ARCHIVE_DIRECTORY" >&2
  exit 64
fi
action=$1
identity=$2
profile=$3
archive=$4
case "$action" in backup|restore) ;; *) exit 64 ;; esac
for executable in node flock tar; do
  command -v "$executable" >/dev/null 2>&1 || { echo "$executable is required." >&2; exit 69; }
done

# Validate identity and paths without printing the Worker credential material.
node --input-type=module - "$identity" "$profile" "$archive" <<'NODE'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
const [identity, profile, archive] = process.argv.slice(2).map(p => path.resolve(p))
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
assert(uuid.test(path.basename(profile)), 'Profile directory must be its UUIDv7')
const worker = JSON.parse(fs.readFileSync(path.join(identity, 'worker-identity.json'), 'utf8'))
assert(worker.version === 1 && uuid.test(worker.workerId), 'Existing Worker identity required')
const info = fs.lstatSync(profile)
assert(info.isDirectory() && info.uid === process.getuid(), 'Run as the Profile directory owner')
const realProfile = fs.realpathSync(profile)
const realArchive = path.join(fs.realpathSync(path.dirname(archive)), path.basename(archive))
assert(realArchive !== realProfile && !realArchive.startsWith(realProfile + path.sep), 'Archive must be outside the Profile')
NODE

# Same inode and advisory lock as ProfileChromeProcess. Never unlink this lock file.
exec 9>"$profile/.browshare-runtime.lock"
flock --nonblock --conflict-exit-code 73 9 || {
  echo 'Profile is still running or another storage operation holds its lock.' >&2
  exit 73
}

temporary=
trap 'if [ -n "$temporary" ]; then rm -rf -- "$temporary"; fi' EXIT
trap 'exit 1' HUP INT TERM
if [ "$action" = backup ]; then
  if [ -e "$archive" ] || [ -L "$archive" ]; then
    echo 'Refusing to overwrite an existing archive.' >&2
    exit 73
  fi
  temporary=$(mktemp -d "${archive}.tmp.XXXXXX")
  tar -czf "$temporary/profile.tar.gz" \
    --exclude=./.browshare-runtime.lock --exclude=./SingletonLock \
    --exclude=./SingletonSocket --exclude=./SingletonCookie --exclude=./DevToolsActivePort \
    -C "$profile" .
  tar -tzf "$temporary/profile.tar.gz" >/dev/null
  node --input-type=module - "$identity" "$profile" "$temporary" <<'NODE'
import fs from 'node:fs'
import path from 'node:path'
const [identity, profile, archive] = process.argv.slice(2)
const { workerId } = JSON.parse(fs.readFileSync(path.join(identity, 'worker-identity.json'), 'utf8'))
fs.writeFileSync(path.join(archive, 'manifest.json'), JSON.stringify({
  version: 1, workerId, profileId: path.basename(path.resolve(profile)), createdAt: new Date().toISOString(),
}, null, 2) + '\n', { mode: 0o600 })
NODE
  # -T rejects an existing directory instead of nesting an archive inside it.
  mv -T -- "$temporary" "$archive"
  temporary=
else
  node --input-type=module - "$identity" "$profile" "$archive" <<'NODE'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
const [identity, profile, archive] = process.argv.slice(2)
const { workerId } = JSON.parse(fs.readFileSync(path.join(identity, 'worker-identity.json'), 'utf8'))
const manifest = JSON.parse(fs.readFileSync(path.join(archive, 'manifest.json'), 'utf8'))
assert(manifest.version === 1 && manifest.workerId === workerId, 'Restore requires the original Worker identity')
assert(manifest.profileId === path.basename(path.resolve(profile)), 'Restore requires the original Profile ID')
assert(fs.readdirSync(profile).every(name => name === '.browshare-runtime.lock'), 'Restore requires an empty Profile directory; preserve existing data elsewhere first')
NODE
  temporary=$(mktemp -d "${profile}.restore.XXXXXX")
  tar -xzf "$archive/profile.tar.gz" --no-same-owner -C "$temporary"
  node --input-type=module - "$temporary" "$profile" <<'NODE'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
const [source, target] = process.argv.slice(2)
const entries = fs.readdirSync(source)
assert(!entries.includes('.browshare-runtime.lock'), 'Archive contains a runtime lock')
for (const name of entries) fs.renameSync(path.join(source, name), path.join(target, name))
NODE
fi
echo "BrowShare Profile $action completed."
