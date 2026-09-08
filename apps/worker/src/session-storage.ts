import { mkdir, open, rm, type FileHandle } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import { createPublicId } from '@browshare/common'
import { StorageProtectionError, type StorageProtection } from './storage-protection.js'

/** The subset of Remote Tab's storage contract consumed by the Worker. */
export interface SessionFileRequest {
  sessionId: string
  transferId: string
  direction: 'upload' | 'download'
  displayName: string
  declaredSize: number
  mimeType?: string
}

export interface SessionFileReservation {
  readonly localPath: string
  write(offset: number, chunk: Uint8Array): Promise<void>
  commit(): Promise<{
    storageKey: string
    localPath: string
    displayName: string
    size: number
    mimeType?: string
  }>
  abort(reason?: string): Promise<void>
}

export type SessionStorageErrorFactory = (
  code: 'FILE_LIMIT_EXCEEDED' | 'SESSION_CLOSED',
  message: string,
) => Error

export class SessionStorageError extends Error {
  constructor(
    readonly code: 'FILE_LIMIT_EXCEEDED' | 'SESSION_CLOSED',
    message: string,
  ) {
    super(message)
    this.name = 'SessionStorageError'
  }
}

/** One Session owns this adapter; no caller can address a different Session's files. */
export class WorkerSessionStorage {
  readonly directory: string
  readonly #reservations = new Set<StoredReservation>()
  readonly #storageKeys = new Set<string>()
  readonly #pending = new Set<Promise<SessionFileReservation>>()
  #reservedBytes = 0
  #closed = false
  #cleanup: Promise<void> | undefined

  constructor(
    root: string,
    readonly sessionId: string,
    readonly maxBytes = 200 * 1024 * 1024,
    readonly createError: SessionStorageErrorFactory = (code, message) =>
      new SessionStorageError(code, message),
    readonly externalReservedBytes: () => number = () => 0,
    readonly protection?: { storage: StorageProtection; profileId: string },
  ) {
    if (!isAbsolute(root)) throw new TypeError('Session storage root must be absolute')
    // The enclosing lifecycle validates the UUID. This adapter also supports isolated contract QA.
    if (!/^[a-zA-Z0-9_-]+$/u.test(sessionId)) throw new TypeError('Invalid Session storage ID')
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
      throw new TypeError('Session storage quota must be a positive integer')
    this.directory = join(root, 'sessions', sessionId)
  }

  reserve(request: SessionFileRequest): Promise<SessionFileReservation> {
    this.#assertSession(request.sessionId)
    if (this.#closed) throw this.createError('SESSION_CLOSED', 'Session storage is closed')
    const externalBytes = this.externalReservedBytes()
    if (!Number.isSafeInteger(externalBytes) || externalBytes < 0)
      throw new TypeError('Invalid external Session storage usage')
    if (
      !Number.isSafeInteger(request.declaredSize) ||
      request.declaredSize < 0 ||
      this.#reservedBytes + externalBytes + request.declaredSize > this.maxBytes
    )
      throw this.createError('FILE_LIMIT_EXCEEDED', 'Session storage quota exceeded')
    // Reserve synchronously so concurrent transfers cannot both spend the same capacity.
    const transferDirectory = join(this.directory, createPublicId())
    const path = join(transferDirectory, safeFilename(request.displayName))
    const key = `upload:${this.sessionId}:${transferDirectory}`
    try {
      this.protection?.storage.reserve(key, this.protection.profileId, request.declaredSize, [path])
    } catch (cause) {
      if (cause instanceof StorageProtectionError)
        throw this.createError('FILE_LIMIT_EXCEEDED', cause.message)
      throw cause
    }
    this.#storageKeys.add(key)
    this.#reservedBytes += request.declaredSize
    const operation = this.#open(request, transferDirectory, path, key)
    this.#pending.add(operation)
    void operation.then(
      () => this.#pending.delete(operation),
      () => this.#pending.delete(operation),
    )
    return operation
  }

  get reservedBytes(): number {
    return this.#reservedBytes
  }

  async #open(
    request: SessionFileRequest,
    transferDirectory: string,
    path: string,
    key: string,
  ): Promise<SessionFileReservation> {
    try {
      await mkdir(transferDirectory, { recursive: true, mode: 0o700 })
      const handle = await open(path, 'wx', 0o600)
      const reservation = new StoredReservation(
        handle,
        path,
        request,
        this.createError,
        async () => {
          await rm(transferDirectory, { recursive: true, force: true })
          await this.protection?.storage.release(key)
          this.#storageKeys.delete(key)
          if (this.#reservations.delete(reservation)) this.#reservedBytes -= request.declaredSize
        },
      )
      this.#reservations.add(reservation)
      return reservation
    } catch (cause) {
      await rm(transferDirectory, { recursive: true, force: true })
      await this.protection?.storage.release(key)
      this.#storageKeys.delete(key)
      this.#reservedBytes -= request.declaredSize
      throw cause
    }
  }

  cleanupSession(sessionId: string): Promise<void> {
    this.#assertSession(sessionId)
    this.#closed = true
    this.#cleanup ??= this.#cleanupFiles().catch((cause: unknown) => {
      this.#cleanup = undefined
      throw cause
    })
    return this.#cleanup
  }

  async #cleanupFiles(): Promise<void> {
    await Promise.allSettled([...this.#pending])
    const results = await Promise.allSettled([...this.#reservations].map((item) => item.abort()))
    const failure = results.find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
    await rm(this.directory, { recursive: true, force: true })
    for (const key of this.#storageKeys) {
      await this.protection?.storage.release(key)
      this.#storageKeys.delete(key)
    }
    this.#reservedBytes = 0
  }

  #assertSession(sessionId: string): void {
    if (sessionId !== this.sessionId) throw new TypeError('Session storage ownership mismatch')
  }
}

class StoredReservation implements SessionFileReservation {
  #offset = 0
  #state: 'OPEN' | 'COMMITTED' | 'ABORTED' = 'OPEN'
  #queue: Promise<void> = Promise.resolve()

  constructor(
    readonly handle: FileHandle,
    readonly localPath: string,
    readonly request: SessionFileRequest,
    readonly createError: SessionStorageErrorFactory,
    readonly remove: () => Promise<void>,
  ) {}

  write(offset: number, chunk: Uint8Array): Promise<void> {
    return this.#serialize(async () => {
      this.#assertOpen()
      if (offset !== this.#offset || offset + chunk.byteLength > this.request.declaredSize)
        throw this.createError('FILE_LIMIT_EXCEEDED', 'File chunk is outside its reservation')
      let written = 0
      while (written < chunk.byteLength) {
        const result = await this.handle.write(
          chunk,
          written,
          chunk.byteLength - written,
          offset + written,
        )
        if (result.bytesWritten === 0) throw new Error('Session storage could not write file bytes')
        written += result.bytesWritten
      }
      this.#offset += written
    })
  }

  commit(): ReturnType<SessionFileReservation['commit']> {
    return this.#serialize(async () => {
      this.#assertOpen()
      if (this.#offset !== this.request.declaredSize)
        throw this.createError(
          'FILE_LIMIT_EXCEEDED',
          'Completed file size does not match reservation',
        )
      await this.handle.close()
      this.#state = 'COMMITTED'
      // Chrome File objects read lazily; the pathname must remain usable until Session cleanup.
      return {
        storageKey: this.localPath,
        localPath: this.localPath,
        displayName: this.request.displayName,
        size: this.#offset,
        ...(this.request.mimeType === undefined ? {} : { mimeType: this.request.mimeType }),
      }
    })
  }

  abort(): Promise<void> {
    return this.#serialize(async () => {
      if (this.#state === 'OPEN') await this.handle.close()
      this.#state = 'ABORTED'
      await this.remove()
    })
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.#queue.then(operation)
    this.#queue = pending.then(
      () => undefined,
      () => undefined,
    )
    return pending
  }

  #assertOpen(): void {
    if (this.#state !== 'OPEN')
      throw this.createError('SESSION_CLOSED', 'File reservation is closed')
  }
}

function safeFilename(value: string): string {
  // File picker names may contain characters forbidden in Linux path components.
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001f\u007f/\\]/gu, '_').trim()
  let result = ''
  // NAME_MAX counts UTF-8 bytes on the supported Linux filesystem, not JS code units.
  for (const character of cleaned) {
    if (Buffer.byteLength(result + character) > 240) break
    result += character
  }
  return result === '' || result === '.' || result === '..' ? 'file' : result
}
