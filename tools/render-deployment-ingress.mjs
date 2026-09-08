#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export async function renderDeploymentIngress(directory) {
  const environment = parseEnv(await readFile(join(directory, '.env'), 'utf8'))
  const hostname = environment.BROWSHARE_PUBLIC_HOSTNAME
  if (!hostname || !/^[a-z0-9.-]+$/u.test(hostname)) throw new Error('Invalid public hostname')
  const ports = ['BROWSHARE_HTTPS_PORT', 'BROWSHARE_CONTROL_PORT', 'BROWSHARE_FILES_PORT'].map(
    (name) => (environment[name] === undefined ? undefined : Number(environment[name])),
  )
  if (ports.slice(0, 2).some((port) => port === undefined))
    throw new Error('HTTPS and control ports are required')
  const configured = ports.filter((port) => port !== undefined)
  if (
    configured.some(
      (port) =>
        !Number.isInteger(port) || port < 1024 || port > 65535 || port === 8080 || port === 8444,
    ) ||
    new Set(configured).size !== configured.length
  )
    throw new Error('Deployment ports must be distinct, nonprivileged and not reserved')
  for (const name of ['ingress', 'stream', ...(ports[2] === undefined ? [] : ['files'])]) {
    const source = await readFile(join(root, `deploy/docker/${name}.conf.template`), 'utf8')
    const content = source
      .replaceAll('__HOSTNAME__', hostname)
      .replaceAll('__HTTPS_PORT__', String(ports[0]))
      .replaceAll('__CONTROL_PORT__', String(ports[1]))
      .replaceAll('__FILES_PORT__', String(ports[2]))
    // Keep the inode when re-rendering files already bind-mounted by a running container.
    await writeFile(join(directory, `${name}.conf`), content, { mode: 0o644 })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4 || process.argv[2] !== '--directory')
    throw new Error('Usage: --directory <deployment directory>')
  const directory = resolve(process.argv[3])
  await renderDeploymentIngress(directory)
  process.stdout.write(JSON.stringify({ status: 'rendered', directory }) + '\n')
}
