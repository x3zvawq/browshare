import { EventEmitter } from 'node:events'
import type { DatabaseConnection } from '@browshare/database'

/** A single database subscription feeds all Portal invalidation streams. No row data is broadcast. */
export class ProfileEvents {
  readonly #events = new EventEmitter()
  #pendingChange: ReturnType<typeof setTimeout> | undefined
  #unlisten: (() => Promise<void>) | undefined

  constructor(private readonly connection: DatabaseConnection) {
    this.#events.setMaxListeners(0)
  }

  async start(): Promise<void> {
    const listener = await this.connection.client.listen(
      'browshare_profiles_changed',
      () => this.invalidate(),
      () => this.invalidate(),
    )
    this.#unlisten = listener.unlisten
  }

  invalidate(): void {
    if (this.#pendingChange !== undefined) return
    // One route edit can update a Proxy and many bound Profiles in a single burst.
    this.#pendingChange = setTimeout(() => {
      this.#pendingChange = undefined
      this.#events.emit('change')
    }, 100)
    this.#pendingChange.unref()
  }

  subscribe(listener: () => void): () => void {
    this.#events.on('change', listener)
    return () => {
      this.#events.off('change', listener)
    }
  }

  async close(): Promise<void> {
    clearTimeout(this.#pendingChange)
    this.#pendingChange = undefined
    this.#events.removeAllListeners()
    await this.#unlisten?.()
  }
}
