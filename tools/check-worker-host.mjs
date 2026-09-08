import { access, statfs } from 'node:fs/promises'
import { constants } from 'node:fs'
import { arch, platform } from 'node:process'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const args = process.argv.slice(2)
const json = args.includes('--json')
const value = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}
const dataRoot = value('--data-root', '/var/lib/browshare')
const minimumFreeBytes = Number(value('--min-free-bytes', String(512 * 1024 ** 2)))
if (!Number.isSafeInteger(minimumFreeBytes) || minimumFreeBytes < 0)
  throw new TypeError('--min-free-bytes must be a non-negative integer')

const checks = []
const add = (name, ok, detail) => checks.push({ name, ok, detail })
add('linux', platform === 'linux', `${platform}/${arch}`)
add('amd64', arch === 'x64', arch)
try {
  await exec('docker', ['info', '--format', '{{.ServerVersion}}'])
  add('docker', true, 'Docker Engine reachable')
} catch {
  add('docker', false, 'Docker Engine is not reachable')
}
try {
  await access(dataRoot, constants.R_OK | constants.W_OK | constants.X_OK)
  const filesystem = await statfs(dataRoot)
  const freeBytes = Number(filesystem.bavail) * Number(filesystem.bsize)
  add('data-root', freeBytes >= minimumFreeBytes, `${freeBytes} free bytes at ${dataRoot}`)
} catch (error) {
  add('data-root', false, `${dataRoot}: ${error.code ?? error.message}`)
}
try {
  await access('/dev/shm', constants.R_OK | constants.W_OK | constants.X_OK)
  add('shared-memory', true, '/dev/shm accessible')
} catch {
  add('shared-memory', false, '/dev/shm is not accessible')
}

const result = { ok: checks.every((check) => check.ok), checks }
if (json) console.log(JSON.stringify(result))
else
  for (const check of checks)
    console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}: ${check.detail}`)
if (!result.ok) process.exitCode = 1
