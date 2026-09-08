import { lstat, opendir, realpath, statfs } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import type { WorkerStorageSnapshot } from '@browshare/contracts'

export async function readStorageSnapshot(
  purpose: WorkerStorageSnapshot['purpose'],
  path: string,
): Promise<WorkerStorageSnapshot> {
  const value = await statfs(path, { bigint: true })
  const safe = (value: bigint) =>
    Number(
      value > BigInt(Number.MAX_SAFE_INTEGER)
        ? BigInt(Number.MAX_SAFE_INTEGER)
        : value < 0n
          ? 0n
          : value,
    )
  return {
    purpose,
    totalBytes: safe(value.blocks * value.bsize),
    availableBytes: safe(value.bavail * value.bsize),
    totalInodes: value.files === 0n ? null : safe(value.files),
    availableInodes: value.files === 0n ? null : safe(value.ffree),
  }
}

export function containsPath(parent: string, path: string): boolean {
  const child = relative(parent, path)
  return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`))
}

/** Canonical roots avoid counting a nested temporary volume twice against the Worker quota. */
export async function independentRoots(paths: readonly string[]): Promise<string[]> {
  const canonical = [...new Set(await Promise.all(paths.map((path) => realpath(path))))]
  return canonical.filter(
    (path) => !canonical.some((other) => other !== path && containsPath(other, path)),
  )
}

/** Observe file sizes without following Chrome's Singleton symlinks or leaving the owned roots. */
export async function readStorageFiles(
  roots: readonly string[],
  cancelled: () => boolean,
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  const pending = [...roots]
  const deadline = Date.now() + 30_000
  while (pending.length) {
    if (cancelled() || Date.now() > deadline) throw new Error('Storage observation cancelled')
    const path = pending.pop()!
    try {
      const info = await lstat(path)
      if (info.isDirectory()) {
        for await (const entry of await opendir(path)) pending.push(join(path, entry.name))
      } else result.set(path, info.size)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      // Chrome and transfer cleanup can remove a path between directory enumeration and lstat.
    }
  }
  return result
}
