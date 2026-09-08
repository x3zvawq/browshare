import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { createPublicId, isPublicId } from '@browshare/common'
import {
  StoragePolicySchema,
  ProfileStoragePolicySchema,
  type StoragePolicy,
  type ProfileStoragePolicy,
  type WorkerStorageFact,
  type ProfileStorageUsage,
  type StorageVolumeFact,
  type StorageBlockReason,
} from '@browshare/contracts'
import { Value } from 'typebox/value'
import type { WorkerStorageThresholds } from './configuration.js'
import {
  containsPath,
  independentRoots,
  readStorageFiles,
  readStorageSnapshot,
} from './storage-observation.js'

export class StorageProtectionError extends Error {
  constructor(
    readonly code: StorageBlockReason,
    message: string,
  ) {
    super(message)
    this.name = 'StorageProtectionError'
  }
}
interface Reservation {
  bytes: number
  paths: Set<string>
}
interface PersistedPolicies {
  worker: StoragePolicy | null
  profiles: ProfileStoragePolicy[]
}

/** One owner for disk observations, durable quota policy and in-flight/retained transfer accounting. */
export class StorageProtection {
  #workerPolicy: StoragePolicy | undefined
  readonly #profilePolicies = new Map<string, ProfileStoragePolicy>()
  readonly #reservations = new Map<string, Reservation>()
  #files: Map<string, number> | undefined
  #volumes: StorageVolumeFact[] = []
  #roots: string[] = []
  #rootAliases: { source: string; canonical: string }[] = []
  #profileCursor = 0
  #knownProfileIds = new Set<string>()
  #observedAt = new Date().toISOString()
  #profileRoot: string
  #temporaryRoot: string
  #closed = false
  #ready = false
  #timer: NodeJS.Timeout | undefined
  #scan: Promise<void> | undefined
  #policyQueue: Promise<void> = Promise.resolve()
  readonly #policyPath: string

  constructor(
    identityRoot: string,
    profileRoot: string,
    temporaryRoot: string,
    readonly thresholds: WorkerStorageThresholds,
  ) {
    this.#policyPath = join(identityRoot, 'storage-policy.json')
    this.#profileRoot = resolve(profileRoot)
    this.#temporaryRoot = resolve(temporaryRoot)
  }

  async initialize(): Promise<void> {
    if (this.#ready) throw new Error('Storage protection already initialized')
    await Promise.all(
      [this.#profileRoot, this.#temporaryRoot].map((path) =>
        mkdir(path, { recursive: true, mode: 0o700 }),
      ),
    )
    const sources = [this.#profileRoot, this.#temporaryRoot]
    this.#rootAliases = await Promise.all(
      sources.map(async (source) => ({ source, canonical: await realpath(source) })),
    )
    this.#rootAliases.sort((left, right) => right.source.length - left.source.length)
    this.#profileRoot = await realpath(this.#profileRoot)
    this.#temporaryRoot = await realpath(this.#temporaryRoot)
    this.#roots = await independentRoots([this.#profileRoot, this.#temporaryRoot])
    try {
      const value: unknown = JSON.parse(await readFile(this.#policyPath, 'utf8'))
      if (!value || typeof value !== 'object')
        throw new TypeError('Invalid persisted storage policy')
      const policies = value as PersistedPolicies
      if (
        (policies.worker !== null && !Value.Check(StoragePolicySchema, policies.worker)) ||
        !Array.isArray(policies.profiles) ||
        policies.profiles.some((p) => !Value.Check(ProfileStoragePolicySchema, p)) ||
        new Set(policies.profiles.map((p) => p.profileId)).size !== policies.profiles.length
      )
        throw new TypeError('Invalid persisted storage policy')
      this.#workerPolicy = policies.worker ?? undefined
      for (const policy of policies.profiles) this.#profilePolicies.set(policy.profileId, policy)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    this.#ready = true
    await this.refresh()
    this.#schedule()
  }

  applyPolicy(worker: StoragePolicy, profile?: ProfileStoragePolicy): Promise<void> {
    const operation = this.#policyQueue.then(async () => {
      if (this.#closed) throw new Error('Storage protection closed')
      if (
        !Value.Check(StoragePolicySchema, worker) ||
        (profile && !Value.Check(ProfileStoragePolicySchema, profile))
      )
        throw new TypeError('Invalid storage policy')
      const choose = <T extends StoragePolicy>(current: T | undefined, next: T): T => {
        if (current && current.version === next.version && current.quotaBytes !== next.quotaBytes)
          throw new StorageProtectionError(
            'STORAGE_POLICY_STALE',
            'Storage policy version has conflicting values.',
          )
        return current && current.version >= next.version ? current : { ...next }
      }
      const nextWorker = choose(this.#workerPolicy, worker)
      const profiles = new Map(this.#profilePolicies)
      if (profile) profiles.set(profile.profileId, choose(profiles.get(profile.profileId), profile))
      if (
        nextWorker === this.#workerPolicy &&
        (!profile ||
          profiles.get(profile.profileId) === this.#profilePolicies.get(profile.profileId))
      )
        return
      await this.#persistPolicies(nextWorker, profiles)
      this.#workerPolicy = nextWorker
      this.#profilePolicies.clear()
      for (const [id, policy] of profiles) this.#profilePolicies.set(id, policy)
    })
    this.#policyQueue = operation.catch(() => undefined)
    return operation
  }

  async #persistPolicies(
    worker: StoragePolicy | undefined,
    profiles: ReadonlyMap<string, ProfileStoragePolicy>,
  ): Promise<void> {
    const path = this.#policyPath + '.' + createPublicId()
    try {
      await writeFile(
        path,
        JSON.stringify({ worker: worker ?? null, profiles: [...profiles.values()] }),
        { mode: 0o600, flag: 'wx' },
      )
      await rename(path, this.#policyPath)
    } finally {
      await rm(path, { force: true })
    }
  }

  /** Called only after Profile sessions, transfers and the persistent directory are removed. */
  forgetProfile(profileId: string): Promise<void> {
    const operation = this.#policyQueue.then(async () => {
      if (this.#closed) throw new Error('Storage protection closed')
      const profiles = new Map(this.#profilePolicies)
      if (profiles.delete(profileId)) {
        await this.#persistPolicies(this.#workerPolicy, profiles)
        this.#profilePolicies.delete(profileId)
      }
      await this.refresh()
      this.#knownProfileIds.delete(profileId)
    })
    this.#policyQueue = operation.catch(() => undefined)
    return operation
  }

  refresh(): Promise<void> {
    if (!this.#ready || this.#closed)
      return Promise.reject(new Error('Storage protection is unavailable'))
    this.#scan ??= this.#observe().finally(() => {
      this.#scan = undefined
    })
    return this.#scan
  }

  async #observe(): Promise<void> {
    const volumes = await Promise.all(
      (['profiles', 'temporary'] as const).map(async (purpose) => {
        try {
          const value = await readStorageSnapshot(
            purpose,
            purpose === 'profiles' ? this.#profileRoot : this.#temporaryRoot,
          )
          const low = Math.max(
            this.thresholds.lowBytes,
            Math.ceil((value.totalBytes * this.thresholds.lowPercent) / 100),
          )
          const critical = Math.max(
            this.thresholds.criticalBytes,
            Math.ceil((value.totalBytes * this.thresholds.criticalPercent) / 100),
          )
          const diskState =
            value.availableInodes === 0 || value.availableBytes < critical
              ? 'CRITICAL_DISK'
              : value.availableBytes < low
                ? 'LOW_DISK'
                : 'OK'
          return {
            purpose,
            totalBytes: value.totalBytes,
            availableBytes: value.availableBytes,
            totalInodes: value.totalInodes,
            availableInodes: value.availableInodes,
            lowThresholdBytes: low,
            criticalThresholdBytes: critical,
            diskState,
          } satisfies StorageVolumeFact
        } catch {
          return {
            purpose,
            totalBytes: null,
            availableBytes: null,
            totalInodes: null,
            availableInodes: null,
            lowThresholdBytes: null,
            criticalThresholdBytes: null,
            diskState: 'UNKNOWN',
          } satisfies StorageVolumeFact
        }
      }),
    )
    try {
      this.#knownProfileIds = new Set(
        (await readdir(this.#profileRoot, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory() && isPublicId(entry.name))
          .map((entry) => entry.name),
      )
      this.#files = await readStorageFiles(this.#roots, () => this.#closed)
    } catch {
      this.#files = undefined
    }
    this.#volumes = volumes
    this.#observedAt = new Date().toISOString()
  }

  #usage(replacementKey?: string, replacement?: Reservation): number | null {
    if (!this.#files) return null
    const files = new Map(this.#files)
    let bytes = 0
    const reservations = new Map(this.#reservations)
    if (replacementKey && replacement) reservations.set(replacementKey, replacement)
    for (const reservation of reservations.values()) {
      let actual = 0
      for (const path of reservation.paths) {
        actual += files.get(path) ?? 0
        files.delete(path)
      }
      bytes += Math.max(reservation.bytes, actual)
    }
    for (const size of files.values()) bytes += size
    return Math.min(Number.MAX_SAFE_INTEGER, bytes)
  }

  snapshot(): WorkerStorageFact {
    const policy = this.#workerPolicy ?? { version: 1, quotaBytes: null }
    const usedBytes = this.#usage()
    const states = this.#volumes.map((volume) => volume.diskState)
    const diskState =
      states.length !== 2 || states.includes('UNKNOWN')
        ? 'UNKNOWN'
        : states.includes('CRITICAL_DISK')
          ? 'CRITICAL_DISK'
          : states.includes('LOW_DISK')
            ? 'LOW_DISK'
            : 'OK'
    return {
      observedAt: this.#observedAt,
      usedBytes,
      appliedPolicyVersion: policy.version,
      quotaBytes: policy.quotaBytes,
      quotaState:
        usedBytes === null
          ? 'UNKNOWN'
          : policy.quotaBytes !== null && usedBytes >= policy.quotaBytes
            ? 'EXCEEDED'
            : 'OK',
      diskState,
      thresholds: {
        lowBytes: this.thresholds.lowBytes,
        lowRatio: this.thresholds.lowPercent / 100,
        criticalBytes: this.thresholds.criticalBytes,
        criticalRatio: this.thresholds.criticalPercent / 100,
      },
      volumes: this.#volumes.length
        ? this.#volumes
        : [
            {
              purpose: 'profiles',
              totalBytes: null,
              availableBytes: null,
              totalInodes: null,
              availableInodes: null,
              lowThresholdBytes: null,
              criticalThresholdBytes: null,
              diskState: 'UNKNOWN',
            },
          ],
    }
  }

  profileUsage(profileId: string): ProfileStorageUsage {
    if (!isPublicId(profileId)) throw new TypeError('Invalid Profile storage identity')
    const policy = this.#profilePolicies.get(profileId) ?? { version: 1, quotaBytes: null }
    const path = join(this.#profileRoot, profileId)
    const usedBytes = this.#files
      ? [...this.#files].reduce(
          (sum, [file, size]) => (containsPath(path, file) ? sum + size : sum),
          0,
        )
      : null
    return {
      profileId,
      observedAt: this.#observedAt,
      usedBytes,
      appliedPolicyVersion: policy.version,
      quotaBytes: policy.quotaBytes,
      quotaState:
        usedBytes === null
          ? 'UNKNOWN'
          : policy.quotaBytes !== null && usedBytes >= policy.quotaBytes
            ? 'EXCEEDED'
            : 'OK',
    }
  }

  profileUsages(): ProfileStorageUsage[] {
    const ids = [...new Set([...this.#knownProfileIds, ...this.#profilePolicies.keys()])].sort()
    if (!ids.length) return []
    const count = Math.min(100, ids.length)
    const batch = Array.from({ length: count }, (_, index) =>
      this.profileUsage(ids[(this.#profileCursor + index) % ids.length]!),
    )
    this.#profileCursor = (this.#profileCursor + count) % ids.length
    return batch
  }

  async assertCanStart(
    profileId: string,
    workerPolicy?: StoragePolicy,
    profilePolicy?: ProfileStoragePolicy,
  ): Promise<void> {
    await this.refresh()
    if (
      (workerPolicy && workerPolicy.version < (this.#workerPolicy?.version ?? 1)) ||
      (profilePolicy &&
        profilePolicy.version < (this.#profilePolicies.get(profileId)?.version ?? 1))
    )
      throw new StorageProtectionError(
        'STORAGE_POLICY_STALE',
        'Storage policy changed before this operation. Retry with current policy.',
      )
    this.#assertAdmission(profileId, false)
  }

  #assertAdmission(profileId: string, transfer: boolean): void {
    const fact = this.snapshot()
    const profile = this.profileUsage(profileId)
    if (
      fact.diskState === 'UNKNOWN' ||
      fact.quotaState === 'UNKNOWN' ||
      profile.quotaState === 'UNKNOWN'
    )
      throw new StorageProtectionError(
        'STORAGE_UNAVAILABLE',
        'Worker storage could not be inspected. Retry after storage is available.',
      )
    if (fact.diskState === 'CRITICAL_DISK' || (!transfer && fact.diskState === 'LOW_DISK'))
      throw new StorageProtectionError(
        fact.diskState,
        'Worker disk space is below the safe threshold for this operation.',
      )
    if (fact.quotaState === 'EXCEEDED')
      throw new StorageProtectionError(
        'WORKER_STORAGE_QUOTA_EXCEEDED',
        'Worker storage quota is exhausted.',
      )
    if (profile.quotaState === 'EXCEEDED')
      throw new StorageProtectionError(
        'PROFILE_STORAGE_QUOTA_EXCEEDED',
        'Profile storage quota is exhausted.',
      )
  }

  reserve(key: string, profileId: string, bytes: number, paths: readonly string[]): void {
    paths = paths.map((path) => this.#canonicalPath(path))
    const current = this.#reservations.get(key)
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      paths.some((path) => !this.#roots.some((root) => containsPath(root, path)))
    )
      throw new TypeError('Invalid storage reservation')
    if (!current) this.#assertAdmission(profileId, true)
    const next = { bytes, paths: new Set([...(current?.paths ?? []), ...paths]) }
    const projected = this.#usage(key, next)
    if (projected === null)
      throw new StorageProtectionError(
        'STORAGE_UNAVAILABLE',
        'Worker storage could not be inspected.',
      )
    const quota = this.#workerPolicy?.quotaBytes
    if ((!current || bytes > current.bytes) && quota != null && projected > quota)
      throw new StorageProtectionError(
        'WORKER_STORAGE_QUOTA_EXCEEDED',
        'Worker storage quota cannot accommodate this transfer.',
      )
    this.#reservations.set(key, next)
  }

  /** Retained files already exist: restoration/ownership transfer cannot be rejected as a new write. */
  retain(key: string, bytes: number, paths: readonly string[]): void {
    paths = paths.map((path) => this.#canonicalPath(path))
    const previous = this.#reservations.get(key)
    this.#reservations.set(key, { bytes, paths: new Set([...(previous?.paths ?? []), ...paths]) })
  }

  #canonicalPath(path: string): string {
    const alias = this.#rootAliases.find((root) => containsPath(root.source, path))
    return alias ? join(alias.canonical, relative(alias.source, path)) : path
  }

  async release(key: string): Promise<void> {
    const entry = this.#reservations.get(key)
    if (!entry) return
    // A swallowed Chrome spool removal error must leave its bytes accounted as actual files.
    const actual = await Promise.all(
      [...entry.paths].map(async (path) => {
        try {
          return [path, (await lstat(path)).size] as const
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [path, null] as const
          throw error
        }
      }),
    )
    await this.#scan
    for (const [path, size] of actual) {
      if (size === null) this.#files?.delete(path)
      else this.#files?.set(path, size)
    }
    this.#reservations.delete(key)
  }

  #schedule(): void {
    if (this.#closed) return
    this.#timer = setTimeout(() => {
      void this.refresh()
        .catch(() => undefined)
        .finally(() => this.#schedule())
    }, 5_000)
    this.#timer.unref()
  }

  async close(): Promise<void> {
    this.#closed = true
    clearTimeout(this.#timer)
    await Promise.allSettled([this.#scan, this.#policyQueue])
  }
}
