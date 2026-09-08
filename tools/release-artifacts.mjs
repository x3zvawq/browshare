import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const [mode, directory] = process.argv.slice(2)
if (!['finalize', 'verify'].includes(mode) || !directory)
  throw new Error('Usage: node tools/release-artifacts.mjs finalize|verify <artifact-directory>')
const output = resolve(directory)
const entries = await readdir(output, { withFileTypes: true })
// .sources is a build input only. Upload the flat, finalized files, never the staging directory.
const files = entries
  .filter((entry) => entry.isFile() && entry.name !== 'SHA256SUMS')
  .map((entry) => entry.name)
  .sort()
if (!files.length) throw new Error('Artifact directory is empty')
for (const file of files)
  if (/[\r\n\\]/.test(file)) throw new Error('Unsupported artifact filename')
const sums = []
for (const file of files) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(resolve(output, file))) hash.update(chunk)
  sums.push(`${hash.digest('hex')}  ${file}`)
}
const expected = `${sums.join('\n')}\n`
if (mode === 'verify' && (await readFile(resolve(output, 'SHA256SUMS'), 'utf8')) !== expected)
  throw new Error('Artifact file set or checksum mismatch')

if (files.includes('source-record.json')) {
  const record = JSON.parse(await readFile(resolve(output, 'source-record.json'), 'utf8'))
  if (record.kind !== 'release-candidate' || record.sources.length !== 2)
    throw new Error('Invalid paired source record')
  for (const source of record.sources) {
    if (!files.includes(source.archive) || !source.files)
      throw new Error(`Missing source archive: ${source.name}`)
    if (!sums.includes(`${source.sha256}  ${source.archive}`))
      throw new Error(`Source archive differs from recorded snapshot: ${source.name}`)
    for (const format of ['cdx', 'spdx']) {
      const sbom = JSON.parse(
        await readFile(resolve(output, `sbom-${source.name}.${format}.json`), 'utf8'),
      )
      if (
        format === 'cdx'
          ? sbom.bomFormat !== 'CycloneDX' || !sbom.components?.length
          : sbom.spdxVersion !== 'SPDX-2.3' || !sbom.packages?.length
      )
        throw new Error(`Invalid ${format} source SBOM: ${source.name}`)
    }
  }
}
if (mode === 'finalize') await writeFile(resolve(output, 'SHA256SUMS'), expected, { flag: 'wx' })
console.log(JSON.stringify({ status: 'passed', mode, files: files.length }))
