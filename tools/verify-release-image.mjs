import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const [archive, destination] = process.argv.slice(2)
if (!archive || !destination)
  throw new Error('Usage: verify-release-image.mjs image.oci.tar output-directory')
const output = resolve(destination)
const extract = (path) =>
  execFileSync('tar', ['-xOf', resolve(archive), path], { maxBuffer: 128 * 1024 * 1024 })
const blob = (digest) => {
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error('Unsupported OCI digest')
  const bytes = extract(`blobs/sha256/${digest.slice(7)}`)
  if (createHash('sha256').update(bytes).digest('hex') !== digest.slice(7))
    throw new Error('OCI metadata digest mismatch')
  return JSON.parse(bytes)
}
let index = JSON.parse(extract('index.json').toString())
// OCI export may wrap BuildKit's multi-platform index in an outer layout index.
if (index.manifests.length === 1 && index.manifests[0].mediaType.endsWith('image.index.v1+json'))
  index = blob(index.manifests[0].digest)
const images = index.manifests.filter(
  (manifest) => manifest.platform?.os === 'linux' && manifest.platform?.architecture === 'amd64',
)
if (images.length !== 1) throw new Error('Expected exactly one linux/amd64 image')
const image = images[0]
const manifest = blob(image.digest)
const config = blob(manifest.config.digest)
if (config.os !== 'linux' || config.architecture !== 'amd64')
  throw new Error('OCI runtime platform mismatch')
const statements = []
for (const entry of index.manifests.filter(
  (item) => item.annotations?.['vnd.docker.reference.type'] === 'attestation-manifest',
)) {
  if (entry.annotations['vnd.docker.reference.digest'] !== image.digest) continue
  for (const layer of blob(entry.digest).layers) {
    const statement = blob(layer.digest)
    if (!statement.subject?.some((subject) => subject.digest?.sha256 === image.digest.slice(7)))
      throw new Error('Attestation is not bound to runtime manifest')
    statements.push(statement)
  }
}
const sbom = statements.find((statement) => statement.predicateType === 'https://spdx.dev/Document')
const provenance = statements.find((statement) =>
  /^https:\/\/slsa.dev\/provenance\/v(?:0\.2|1)$/.test(statement.predicateType),
)
if (!sbom?.predicate?.packages?.length || !provenance)
  throw new Error('Missing image SBOM or build provenance')
const metadata = JSON.parse(await readFile(resolve(output, 'build-metadata.json'), 'utf8'))
const exportedDigest = metadata['containerimage.digest']
if (!/^sha256:[a-f0-9]{64}$/.test(exportedDigest ?? ''))
  throw new Error('Build metadata is missing image index digest')
// Verify that the builder's reported index is actually present in this OCI archive.
blob(exportedDigest)
await writeFile(
  resolve(output, 'sbom-image.spdx.json'),
  `${JSON.stringify(sbom.predicate, null, 2)}\n`,
)
await writeFile(
  resolve(output, 'provenance.intoto.json'),
  `${JSON.stringify(provenance, null, 2)}\n`,
)
const result = {
  status: 'passed',
  platform: 'linux/amd64',
  indexDigest: exportedDigest,
  runtimeManifestDigest: image.digest,
  configDigest: manifest.config.digest,
  sbomPackages: sbom.predicate.packages.length,
  predicateType: provenance.predicateType,
  authenticity: 'Unsigned BuildKit attestation; not publisher identity verification.',
}
await writeFile(resolve(output, 'image-record.json'), `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify(result))
