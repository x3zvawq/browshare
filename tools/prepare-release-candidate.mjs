import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, chmod, mkdir, readFile, lstat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const remote = resolve(
  process.env.BROWSHARE_REMOTE_TAB_SOURCE ?? resolve(root, '../browshare-tab-remote'),
)
const output = resolve(root, process.argv[2] ?? 'tmp/release-candidate')
if (!output.startsWith(`${root}/tmp/`)) throw new Error('Output must be inside the repository tmp/')
const compatibility = JSON.parse(await readFile(resolve(root, 'deploy/compatibility.json'), 'utf8'))
execFileSync(process.execPath, [resolve(root, 'tools/check-worker-runtime-compatibility.mjs')], {
  stdio: 'inherit',
})
for (const name of [
  'packages/core',
  'packages/protocol',
  'packages/viewer',
  'apps/signaling',
  'packages/extension',
]) {
  const pkg = JSON.parse(await readFile(resolve(remote, `${name}/package.json`), 'utf8'))
  if (pkg.version !== compatibility.remoteTab.releaseVersion)
    throw new Error(`Remote Tab ${name} version mismatch`)
}
// Never replace a previous candidate: its hashes may already identify QA evidence.
await mkdir(dirname(output), { recursive: true })
await mkdir(output)
const startedAt = new Date().toISOString()
const sources = []
for (const [name, directory, version] of [
  ['browshare', root, compatibility.releaseVersion],
  ['browshare-tab-remote', remote, compatibility.remoteTab.releaseVersion],
]) {
  const stage = resolve(output, '.sources', name)
  await mkdir(stage, { recursive: true })
  const git = (...args) =>
    execFileSync('git', ['-C', directory, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 20 * 1024 * 1024,
    })
  let commit = null
  try {
    commit = git('rev-parse', '--verify', 'HEAD').trim()
  } catch {
    /* An unborn checkout is a valid local candidate. */
  }
  const dirty = git('status', '--porcelain', '--untracked-files=all').length > 0
  const files = [
    ...new Set(
      git('ls-files', '-z', '--cached', '--others', '--exclude-standard')
        .split('\0')
        .filter(Boolean),
    ),
  ].sort()
  let copied = 0
  for (const file of files) {
    if (
      file
        .split('/')
        .some((part) =>
          ['.git', 'tmp', 'node_modules', 'dist', 'coverage', '.DS_Store'].includes(part),
        )
    )
      continue
    if (/(^|\/)\.env(?:\..*)?$/.test(file) && !file.endsWith('.env.example')) continue
    const source = resolve(directory, file)
    let metadata
    try {
      metadata = await lstat(source)
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
    if (!metadata.isFile())
      throw new Error(`Source archive requires regular files: ${name}/${file}`)
    const destination = resolve(stage, file)
    await mkdir(dirname(destination), { recursive: true })
    await copyFile(source, destination)
    await chmod(destination, metadata.mode & 0o777)
    copied += 1
  }
  const archive = `${name}-${version}-source.tar.gz`
  execFileSync('tar', ['-czf', resolve(output, archive), '-C', resolve(output, '.sources'), name], {
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  })
  const sha256 = createHash('sha256')
    .update(await readFile(resolve(output, archive)))
    .digest('hex')
  sources.push({
    name,
    version,
    commit,
    dirty,
    identity: commit && !dirty ? 'git-commit' : 'working-tree-snapshot',
    archive,
    sha256,
    files: copied,
  })
}
await writeFile(
  resolve(output, '.sources/build-inputs.json'),
  `${JSON.stringify({ schemaVersion: 1, sources }, null, 2)}\n`,
)
for (const [source, destination] of [
  ['deploy/compatibility.json', 'compatibility.json'],
  ['LICENSE', 'LICENSE'],
  ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md'],
  ['CHANGELOG.md', 'CHANGELOG.md'],
])
  await copyFile(resolve(root, source), resolve(output, destination))
const licenses = {}
for (const [name, cwd] of [
  ['browshare', root],
  ['browshare-tab-remote', remote],
]) {
  const grouped = JSON.parse(
    execFileSync('pnpm', ['licenses', 'list', '--json'], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    }),
  )
  licenses[name] = Object.entries(grouped)
    .flatMap(([license, entries]) =>
      entries.flatMap((entry) =>
        entry.versions.map((version) => ({
          name: entry.name,
          version,
          license: entry.license ?? license,
        })),
      ),
    )
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
}
await writeFile(
  resolve(output, 'dependency-licenses.json'),
  `${JSON.stringify({ generatedBy: 'pnpm licenses list', scopes: 'production and development', packages: licenses }, null, 2)}\n`,
)
await writeFile(
  resolve(output, 'source-record.json'),
  `${JSON.stringify({ schemaVersion: 1, kind: 'release-candidate', startedAt, completedAt: new Date().toISOString(), node: process.version, sources, authenticity: 'Unsigned local record; checksums identify archive bytes, not a trusted publisher.' }, null, 2)}\n`,
)
console.log(JSON.stringify({ output, sources }, null, 2))
