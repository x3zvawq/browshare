import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const manifest = JSON.parse(
  await readFile(new URL('../deploy/compatibility.json', import.meta.url), 'utf8'),
)
const failures = []

if (manifest.schemaVersion !== 1) failures.push('schemaVersion must be 1')
if (manifest.platform !== 'linux/amd64') failures.push('Worker image platform must be linux/amd64')

const dockerfile = await readFile(new URL('../deploy/docker/Dockerfile', import.meta.url), 'utf8')
for (const [name, value] of [
  ['Node base image', manifest.node.baseImage],
  ['Chrome package version', manifest.chrome.packageVersion],
  ['Chrome runtime version', manifest.chrome.product.replace('Chrome/', '')],
  ['Chrome .deb URL', manifest.chrome.debUrl],
  ['Chrome .deb SHA-256', manifest.chrome.debSha256],
]) {
  if (!dockerfile.includes(value)) failures.push(`Dockerfile does not pin ${name} ${value}`)
}

for (const forbidden of ['--no-sandbox', 'seccomp=unconfined', 'CAP_SYS_ADMIN', 'privileged']) {
  if (dockerfile.includes(forbidden)) {
    failures.push(`Dockerfile must not weaken the Chrome sandbox with ${forbidden}`)
  }
}

const seccompBytes = await readFile(
  new URL(`../${manifest.container.seccompProfile}`, import.meta.url),
)
const seccompHash = createHash('sha256').update(seccompBytes).digest('hex')
if (seccompHash !== manifest.container.seccompProfileSha256) {
  failures.push(
    `Chrome seccomp profile SHA-256 is ${seccompHash}, expected ${manifest.container.seccompProfileSha256}`,
  )
}

const seccomp = JSON.parse(seccompBytes.toString('utf8'))
if (seccomp.defaultAction !== 'SCMP_ACT_ERRNO') {
  failures.push('Chrome seccomp profile must remain deny-by-default')
}

for (const syscall of manifest.container.chromeNamespaceSyscalls) {
  const matchingRules = seccomp.syscalls.filter((rule) => rule.names.includes(syscall))
  if (
    matchingRules.length !== 1 ||
    matchingRules[0].action !== 'SCMP_ACT_ALLOW' ||
    matchingRules[0].args !== undefined ||
    matchingRules[0].includes !== undefined ||
    matchingRules[0].excludes !== undefined
  ) {
    failures.push(`Chrome namespace syscall ${syscall} must have one unconditional allow rule`)
  }
}

for (const path of [
  'package.json',
  ...['backend', 'gateway', 'portal', 'worker'].map((name) => `apps/${name}/package.json`),
]) {
  const pkg = JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'))
  if (pkg.version !== manifest.releaseVersion)
    failures.push(`${path} is ${pkg.version}, expected ${manifest.releaseVersion}`)
}

const configuration = await readFile(
  new URL('../apps/worker/src/configuration.ts', import.meta.url),
  'utf8',
)
for (const [name, value] of [
  ['Chrome runtime default', manifest.chrome.product.replace('Chrome/', '')],
  ['Remote Tab release default', manifest.remoteTab.releaseVersion],
  ['Remote Tab Extension default', manifest.remoteTab.extension.version],
]) {
  if (!configuration.includes(`defaultValue: '${value}'`)) {
    failures.push(`Worker configuration does not pin ${name} ${value}`)
  }
}

if (
  manifest.remoteTab.extension.artifactName !==
  `browshare-remote-tab-${manifest.remoteTab.extension.version}.crx`
) {
  failures.push('Remote Tab Extension artifact name must match its pinned version')
}

for (const [name, value] of [
  ['Extension release directory', manifest.remoteTab.extension.releaseDirectory],
  ['Managed Policy path', manifest.remoteTab.extension.managedPolicyPath],
]) {
  if (!dockerfile.includes(value)) failures.push(`Dockerfile does not configure ${name} ${value}`)
}

if (failures.length > 0) {
  process.stderr.write(`${JSON.stringify({ status: 'failed', failures }, null, 2)}\n`)
  process.exitCode = 1
} else {
  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'passed',
        releaseVersion: manifest.releaseVersion,
        platform: manifest.platform,
        node: manifest.node.runtimeVersion,
        chrome: manifest.chrome.product,
        seccompProfile: manifest.container.seccompProfile,
        remoteTab: manifest.remoteTab.releaseVersion,
        extension: manifest.remoteTab.extension.version,
      },
      null,
      2,
    )}\n`,
  )
}
