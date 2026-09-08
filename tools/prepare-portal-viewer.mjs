import { execFileSync } from 'node:child_process'
import { readFile, mkdir, rm, symlink } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(
  process.env.BROWSHARE_REMOTE_TAB_SOURCE ?? resolve(root, '../browshare-tab-remote'),
)
const expected = JSON.parse(await readFile(resolve(root, 'deploy/compatibility.json'), 'utf8'))
  .remoteTab.releaseVersion
const actual = JSON.parse(
  await readFile(resolve(source, 'packages/viewer/package.json'), 'utf8'),
).version
if (actual !== expected) throw new Error(`Remote Tab Viewer ${actual} does not match ${expected}`)
// Match Worker/Gateway's coordinated source build, consuming only the exported package boundary.
execFileSync('pnpm', ['--filter', '@browshare/remote-tab-viewer...', 'build'], {
  cwd: source,
  stdio: 'inherit',
})
const output = resolve(root, 'tmp/portal-viewer-package')
await rm(output, { recursive: true, force: true })
execFileSync(
  'pnpm',
  ['--filter', '@browshare/remote-tab-viewer', 'deploy', '--legacy', '--prod', output],
  { cwd: source, stdio: 'inherit' },
)
const target = resolve(root, 'apps/portal/node_modules/@browshare/remote-tab-viewer')
await mkdir(dirname(target), { recursive: true })
await rm(target, { recursive: true, force: true })
await symlink(output, target, 'dir')
