import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { createPublicId, isPublicId } from '@browshare/common'
import { RetainedDownloadSchema, type RetainedDownload } from '@browshare/contracts'
import { Value } from 'typebox/value'
import { StorageProtectionError, type StorageProtection } from './storage-protection.js'

export interface DownloadRetentionPolicy {
  completedMilliseconds: number
  afterSessionMilliseconds: number
}
export interface DownloadSinkRequest {
  sessionId: string
  downloadId: string
  declaredSize: number
}
export interface CompletedDownloadRequest {
  sessionId: string
  downloadId: string
  localPath: string
  displayName: string
  size: number
}
interface Reservation {
  id: string
  sessionId: string
  downloadId: string
  size: number
}

export interface DownloadLease {
  readonly metadata: RetainedDownload
  readonly path: string
  readonly signal: AbortSignal
  /** Must be invoked synchronously from the response finish event. */
  finish(): Promise<void>
  release(): void
}
interface ActiveDownload {
  controller: AbortController
  timer: NodeJS.Timeout | undefined
  finishedAt: number | undefined
}

export class RetainedDownloadError extends Error {
  constructor(
    readonly code: 'FILE_LIMIT_EXCEEDED' | 'FILE_TRANSFER_FAILED' | 'NOT_FOUND' | 'DOWNLOAD_BUSY',
    message: string,
  ) {
    super(message)
    this.name = 'RetainedDownloadError'
  }
}

/** Bytes and manifests live outside Profile/Session temp cleanup, on the same filesystem as Chrome spool. */
export class WorkerRetainedDownloads {
  readonly #files = new Map<string, RetainedDownload>()
  readonly #allocated = new Set<string>()
  readonly #active = new Map<string, ActiveDownload>()
  readonly #reservations = new Map<string, Reservation>()
  #queue: Promise<void> = Promise.resolve()
  #ready = false

  constructor(
    readonly directory: string,
    readonly policy: DownloadRetentionPolicy,
    readonly protection?: { storage: StorageProtection; spoolDirectory: string },
    readonly createTransferError: (
      code: 'FILE_LIMIT_EXCEEDED' | 'FILE_TRANSFER_FAILED',
      message: string,
    ) => Error = (code, message) => new RetainedDownloadError(code, message),
  ) {
    if (!isAbsolute(directory)) throw new TypeError('Retained download directory must be absolute')
    for (const value of Object.values(policy))
      if (!Number.isSafeInteger(value) || value <= 0)
        throw new TypeError('Download retention must be positive milliseconds')
  }

  async initialize(): Promise<void> {
    if (this.#ready) throw new Error('Retained download store is already initialized')
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    for (const entry of await readdir(this.directory, { withFileTypes: true })) {
      const path = join(this.directory, entry.name)
      if (entry.name.startsWith('.staging-') && isPublicId(entry.name.slice(9))) {
        await rm(path, { recursive: true, force: true })
        continue
      }
      if (!entry.isDirectory() || !isPublicId(entry.name))
        throw new Error('Unrecognized retained download entry')
      const value: unknown = JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8'))
      if (
        !Value.Check(RetainedDownloadSchema, value) ||
        value.id !== entry.name ||
        !isPublicId(value.sessionId)
      )
        throw new Error('Invalid retained download manifest')
      this.#files.set(value.id, value)
      if (value.status === 'AVAILABLE') {
        const file = await stat(join(path, 'data'))
        if (!file.isFile() || file.size !== value.size)
          throw new Error('Retained download data is incomplete')
        this.#allocated.add(value.id)
        this.protection?.storage.retain(`download:${value.id}`, value.size, [join(path, 'data')])
      } else {
        await rm(join(path, 'data'), { force: true })
      }
    }
    this.#ready = true
    await this.expire()
  }

  /** Upload adapters use this value too, so committed downloads cannot be bypassed with a new upload. */
  reservedBytes(sessionId: string): number {
    this.#assertReady()
    return (
      [...this.#files.values()].reduce(
        (total, file) =>
          total + (file.sessionId === sessionId && this.#allocated.has(file.id) ? file.size : 0),
        0,
      ) +
      [...this.#reservations.values()].reduce(
        (total, entry) => total + (entry.sessionId === sessionId ? entry.size : 0),
        0,
      )
    )
  }

  sink(sessionId: string, maxBytes: number, uploadReservedBytes: () => number, profileId?: string) {
    if (this.protection && (!profileId || !isPublicId(profileId)))
      throw new TypeError('Download Profile identity is required')
    this.#assertReady()
    if (!isPublicId(sessionId) || !Number.isSafeInteger(maxBytes) || maxBytes <= 0)
      throw new TypeError('Invalid download Session quota')
    const identity = (request: { sessionId: string; downloadId: string }) => {
      if (request.sessionId !== sessionId || !/^[a-zA-Z0-9_-]{1,128}$/.test(request.downloadId))
        throw new TypeError('Download reservation ownership mismatch')
      return `${sessionId}:${request.downloadId}`
    }
    return {
      reserve: (request: DownloadSinkRequest): void => {
        const key = identity(request),
          previous = this.#reservations.get(key)
        const uploadBytes = uploadReservedBytes()
        if (!Number.isSafeInteger(uploadBytes) || uploadBytes < 0)
          throw new TypeError('Invalid upload storage usage')
        if (
          !Number.isSafeInteger(request.declaredSize) ||
          request.declaredSize < 0 ||
          this.reservedBytes(sessionId) -
            (previous?.size ?? 0) +
            request.declaredSize +
            uploadBytes >
            maxBytes
        )
          throw this.createTransferError(
            'FILE_LIMIT_EXCEEDED',
            'Session temporary file quota exceeded',
          )
        const id = previous?.id ?? createPublicId()
        if (this.protection) {
          const source = join(this.protection.spoolDirectory, request.downloadId)
          try {
            this.protection.storage.reserve(`download:${id}`, profileId!, request.declaredSize, [
              source,
              source + '.crdownload',
            ])
          } catch (cause) {
            if (cause instanceof StorageProtectionError)
              throw this.createTransferError('FILE_LIMIT_EXCEEDED', cause.message)
            throw cause
          }
        }
        this.#reservations.set(key, {
          id,
          sessionId,
          downloadId: request.downloadId,
          size: request.declaredSize,
        })
      },
      commit: (request: CompletedDownloadRequest): Promise<void> => {
        const key = identity(request)
        return this.#serialize(async () => {
          const reservation = this.#reservations.get(key)
          if (!reservation || reservation.size !== request.size || !isAbsolute(request.localPath))
            throw new RetainedDownloadError(
              'FILE_TRANSFER_FAILED',
              'Download reservation is missing or changed',
            )
          const source = await stat(request.localPath)
          if (!source.isFile() || source.size !== request.size)
            throw new RetainedDownloadError('FILE_TRANSFER_FAILED', 'Download source is incomplete')
          const now = Date.now(),
            file: RetainedDownload = {
              id: reservation.id,
              sessionId,
              displayName: request.displayName,
              size: request.size,
              status: 'AVAILABLE',
              completedAt: new Date(now).toISOString(),
              expiresAt: new Date(now + this.policy.completedMilliseconds).toISOString(),
              sessionEndedAt: null,
              claimedAt: null,
            }
          if (!Value.Check(RetainedDownloadSchema, file))
            throw new TypeError('Invalid completed download metadata')
          const staging = join(this.directory, '.staging-' + file.id)
          this.protection?.storage.retain(`download:${file.id}`, file.size, [
            request.localPath,
            join(staging, 'data'),
            join(this.directory, file.id, 'data'),
          ])
          try {
            await mkdir(staging, { mode: 0o700 })
            // Same-filesystem rename transfers ownership without a second copy of a large download.
            await rename(request.localPath, join(staging, 'data'))
            await writeFile(join(staging, 'manifest.json'), JSON.stringify(file), { mode: 0o600 })
            await rename(staging, join(this.directory, file.id))
            this.#files.set(file.id, file)
            this.#allocated.add(file.id)
            this.#reservations.delete(key)
          } catch (cause) {
            await rm(staging, { recursive: true, force: true })
            throw cause
          }
        })
      },
      abort: (request: { sessionId: string; downloadId: string }): Promise<void> => {
        const key = identity(request)
        return this.#serialize(async () => {
          const reservation = this.#reservations.get(key)
          if (reservation) await this.protection?.storage.release(`download:${reservation.id}`)
          this.#reservations.delete(key)
        })
      },
    }
  }

  list(): RetainedDownload[] {
    this.#assertReady()
    return [...this.#files.values()].map((file) => ({ ...file }))
  }

  file(id: string): { metadata: RetainedDownload; path: string } {
    this.#assertReady()
    const file = this.#files.get(id)
    if (!file || file.status !== 'AVAILABLE' || Date.parse(file.expiresAt) <= Date.now())
      throw new RetainedDownloadError('NOT_FOUND', 'The download is not available')
    return { metadata: { ...file }, path: join(this.directory, id, 'data') }
  }

  endSession(sessionId: string, endedAt = Date.now()): Promise<void> {
    return this.#serialize(async () => {
      for (const file of this.#files.values()) {
        if (file.sessionId !== sessionId || file.sessionEndedAt !== null) continue
        const updated = {
          ...file,
          sessionEndedAt: new Date(endedAt).toISOString(),
          expiresAt: new Date(
            Math.min(Date.parse(file.expiresAt), endedAt + this.policy.afterSessionMilliseconds),
          ).toISOString(),
        }
        this.#files.set(file.id, updated)
        const active = this.#active.get(file.id)
        if (active) this.#scheduleDeadline(updated, active)
        await this.#persist(updated)
      }
    })
  }

  /** Exclusive byte ownership; consuming a Backend token alone never claims the file. */
  acquire(id: string, sessionId: string): Promise<DownloadLease> {
    return this.#serialize(async () => {
      const { metadata, path } = this.file(id)
      if (metadata.sessionId !== sessionId)
        throw new RetainedDownloadError('NOT_FOUND', 'The download is not available')
      if (this.#active.has(id))
        throw new RetainedDownloadError(
          'DOWNLOAD_BUSY',
          'The download is already being transferred',
        )
      const active: ActiveDownload = {
        controller: new AbortController(),
        timer: undefined,
        finishedAt: undefined,
      }
      this.#active.set(id, active)
      this.#scheduleDeadline(metadata, active)
      const release = () => {
        if (active.finishedAt !== undefined) return
        clearTimeout(active.timer)
        active.controller.abort()
        if (this.#active.get(id) === active) this.#active.delete(id)
      }
      return {
        metadata,
        path,
        signal: active.controller.signal,
        release,
        finish: () => {
          // Capture finish before awaiting the disk queue so expiry cannot overtake a completed response.
          const now = Date.now(),
            current = this.#files.get(id)
          if (
            active.controller.signal.aborted ||
            active.finishedAt !== undefined ||
            !current ||
            Date.parse(current.expiresAt) <= now ||
            this.#active.get(id) !== active
          ) {
            release()
            return Promise.reject(
              new RetainedDownloadError('NOT_FOUND', 'The download lease expired'),
            )
          }
          active.finishedAt = now
          clearTimeout(active.timer)
          return this.#serialize(async () => {
            const latest = this.#files.get(id)!
            await this.#persist({
              ...latest,
              status: 'CLAIMED',
              claimedAt: new Date(now).toISOString(),
            })
            await this.#deleteBytes(id)
          }).finally(() => {
            if (this.#active.get(id) === active) this.#active.delete(id)
          })
        },
      }
    })
  }

  #scheduleDeadline(file: RetainedDownload, active: ActiveDownload): void {
    clearTimeout(active.timer)
    if (active.finishedAt !== undefined || active.controller.signal.aborted) return
    const remaining = Date.parse(file.expiresAt) - Date.now()
    if (remaining <= 0) {
      active.controller.abort()
      return
    }
    active.timer = setTimeout(
      () => this.#scheduleDeadline(this.#files.get(file.id)!, active),
      Math.min(remaining, 2_147_483_647),
    )
    active.timer.unref()
  }

  expire(now = Date.now()): Promise<void> {
    return this.#serialize(async () => {
      for (const file of this.#files.values()) {
        const active = this.#active.get(file.id)
        if (active?.finishedAt !== undefined) continue
        if (file.status === 'AVAILABLE' && Date.parse(file.expiresAt) <= now) {
          active?.controller.abort()
          await this.#persist({ ...file, status: 'EXPIRED' })
        }
        if (this.#files.get(file.id)!.status !== 'AVAILABLE' && this.#allocated.has(file.id))
          await this.#deleteBytes(file.id)
      }
    })
  }

  /** Terminal metadata stays durable until Backend has reconciled it. */
  acknowledge(id: string): Promise<void> {
    return this.#serialize(async () => {
      const file = this.#files.get(id)
      if (!file) return
      if (file.status === 'AVAILABLE')
        throw new TypeError('An available download cannot be acknowledged away')
      await rm(join(this.directory, id), { recursive: true, force: true })
      await this.protection?.storage.release(`download:${id}`)
      this.#files.delete(id)
      this.#allocated.delete(id)
    })
  }

  async #persist(file: RetainedDownload): Promise<void> {
    const path = join(this.directory, file.id)
    await writeFile(join(path, 'manifest.tmp'), JSON.stringify(file), { mode: 0o600 })
    await rename(join(path, 'manifest.tmp'), join(path, 'manifest.json'))
    this.#files.set(file.id, file)
    const active = this.#active.get(file.id)
    if (active) this.#scheduleDeadline(file, active)
  }
  async #deleteBytes(id: string): Promise<void> {
    await rm(join(this.directory, id, 'data'), { force: true })
    await this.protection?.storage.release(`download:${id}`)
    this.#allocated.delete(id)
  }
  #assertReady(): void {
    if (!this.#ready) throw new Error('Retained download store is not initialized')
  }
  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    this.#assertReady()
    const next = this.#queue.then(operation)
    this.#queue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }
}
