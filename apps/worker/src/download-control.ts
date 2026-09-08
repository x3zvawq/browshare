import { createPublicId } from '@browshare/common'
import {
  decodeWorkerControlMessage,
  encodeWorkerControlMessage,
  WORKER_CONTROL_PROTOCOL_MAJOR,
  WORKER_CONTROL_PROTOCOL_MINOR,
  WORKER_DOWNLOAD_BATCH_SIZE,
  type WorkerDownloadsMessage,
} from '@browshare/contracts'
import WebSocket, { type RawData } from 'ws'
import type { WorkerRetainedDownloads } from './retained-downloads.js'

/** Metadata uses control WSS; file bytes never enter this channel. */
export class WorkerDownloadReporter {
  #timer: NodeJS.Timeout | undefined
  #running: Promise<void> = Promise.resolve()
  readonly #cancel = new AbortController()

  constructor(
    private readonly socket: WebSocket,
    private readonly workerId: string,
    private readonly instanceId: string,
    private readonly store: WorkerRetainedDownloads,
    private readonly timeoutMilliseconds: number,
    private readonly onFailure: () => void,
  ) {}

  start(): void {
    this.#schedule(0)
  }

  async close(): Promise<void> {
    clearTimeout(this.#timer)
    this.#cancel.abort()
    await this.#running
  }

  #schedule(delay: number): void {
    if (this.#cancel.signal.aborted || this.socket.readyState !== WebSocket.OPEN) return
    this.#timer = setTimeout(() => {
      this.#timer = undefined
      this.#running = this.#report()
        .catch(() => {
          if (!this.#cancel.signal.aborted) this.onFailure()
        })
        .finally(() => this.#schedule(5_000))
    }, delay)
    this.#timer.unref()
  }

  async #report(): Promise<void> {
    const files = this.store.list()
    for (let offset = 0; offset < files.length; offset += WORKER_DOWNLOAD_BATCH_SIZE) {
      if (this.#cancel.signal.aborted) return
      const report: WorkerDownloadsMessage = {
        protocolMajor: WORKER_CONTROL_PROTOCOL_MAJOR,
        protocolMinor: WORKER_CONTROL_PROTOCOL_MINOR,
        type: 'worker.downloads',
        messageId: createPublicId(),
        correlationId: null,
        sentAt: Date.now(),
        payload: {
          workerId: this.workerId,
          instanceId: this.instanceId,
          downloads: files.slice(offset, offset + WORKER_DOWNLOAD_BATCH_SIZE),
        },
      }
      const terminalIds = await this.#send(report)
      for (const id of terminalIds) await this.store.acknowledge(id)
    }
  }

  #send(report: WorkerDownloadsMessage): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const finish = (cause?: Error, ids: string[] = []) => {
        clearTimeout(timer)
        this.socket.off('message', message)
        this.socket.off('close', failed)
        this.socket.off('error', failed)
        this.#cancel.signal.removeEventListener('abort', failed)
        if (cause) reject(cause)
        else resolve(ids)
      }
      const failed = () => finish(new Error('Download report interrupted'))
      const message = (raw: RawData, binary: boolean) => {
        try {
          if (!binary) throw new Error('Download acknowledgement must be binary')
          const bytes = Array.isArray(raw)
            ? Buffer.concat(raw)
            : raw instanceof ArrayBuffer
              ? new Uint8Array(raw)
              : raw
          const result = decodeWorkerControlMessage(bytes)
          if (result.type === 'protocol.error' && result.correlationId === report.messageId)
            throw new Error('Download report rejected')
          if (result.type !== 'worker.downloads.accepted') return
          const expected = new Set(
            report.payload.downloads
              .filter((file) => file.status !== 'AVAILABLE')
              .map((file) => file.id),
          )
          if (
            result.protocolMajor !== WORKER_CONTROL_PROTOCOL_MAJOR ||
            result.correlationId !== report.messageId ||
            result.payload.workerId !== this.workerId ||
            result.payload.instanceId !== this.instanceId ||
            result.payload.terminalIds.length !== expected.size ||
            new Set(result.payload.terminalIds).size !== expected.size ||
            result.payload.terminalIds.some((id) => !expected.has(id))
          )
            throw new Error('Download acknowledgement does not match the report')
          finish(undefined, result.payload.terminalIds)
        } catch {
          finish(new Error('Invalid download acknowledgement'))
        }
      }
      const timer = setTimeout(
        () => finish(new Error('Download acknowledgement timed out')),
        this.timeoutMilliseconds,
      )
      timer.unref()
      this.socket.on('message', message)
      this.socket.once('close', failed)
      this.socket.once('error', failed)
      this.#cancel.signal.addEventListener('abort', failed, { once: true })
      if (this.#cancel.signal.aborted || this.socket.readyState !== WebSocket.OPEN) failed()
      else {
        try {
          this.socket.send(encodeWorkerControlMessage(report), { binary: true })
        } catch {
          failed()
        }
      }
    })
  }
}
