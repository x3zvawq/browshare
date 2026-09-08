import { createHash, timingSafeEqual } from 'node:crypto'
import { BrowShareError } from '@browshare/common'
import type { BootstrapRequest, BootstrapStatus } from '@browshare/contracts'
import type { DatabaseConnection } from '@browshare/database'
import { bootstrapDatabase, inspectBootstrapState } from './bootstrap.js'

export interface BootstrapPort {
  status(): Promise<BootstrapStatus>
  initialize(input: BootstrapRequest, requestId: string): Promise<{ initialized: true }>
}

export class BootstrapService implements BootstrapPort {
  constructor(
    private readonly connection: DatabaseConnection,
    private readonly token: string | undefined,
  ) {}

  async status(): Promise<BootstrapStatus> {
    const state = await inspectBootstrapState(this.connection)
    if (!state.completed && state.userCount !== 0) {
      throw new BrowShareError({
        code: 'BOOTSTRAP_STATE_INCONSISTENT',
        message: 'The database initialization state requires operator attention.',
        statusCode: 503,
      })
    }
    return {
      initialized: state.completed,
      interactiveEnabled: !state.completed && this.token !== undefined,
    }
  }

  async initialize(input: BootstrapRequest, requestId: string): Promise<{ initialized: true }> {
    const state = await this.status()
    if (state.initialized) throw alreadyInitialized()
    if (this.token === undefined) {
      throw new BrowShareError({
        code: 'BOOTSTRAP_DISABLED',
        message: 'Interactive initialization has not been configured by the operator.',
        statusCode: 503,
      })
    }
    // Fixed-length digests keep the comparison independent of the supplied secret's length.
    const digest = (value: string) => createHash('sha256').update(value).digest()
    if (!timingSafeEqual(digest(input.token), digest(this.token))) {
      throw new BrowShareError({
        code: 'BOOTSTRAP_TOKEN_INVALID',
        message: 'The initialization token was not accepted.',
        statusCode: 403,
      })
    }
    const displayName = input.displayName.trim()
    if (!displayName) {
      throw new BrowShareError({
        code: 'VALIDATION_FAILED',
        message: 'The administrator display name must not be blank.',
        statusCode: 400,
      })
    }
    const result = await bootstrapDatabase(
      this.connection,
      { email: input.email.trim().toLowerCase(), displayName, password: input.password },
      { method: 'token', requestId },
    )
    // Another Backend or the environment path may win after the initial status read.
    // The database advisory lock and completion marker decide the only successful writer.
    if (result.outcome !== 'initialized') throw alreadyInitialized()
    return { initialized: true }
  }
}

function alreadyInitialized(): BrowShareError {
  return new BrowShareError({
    code: 'BOOTSTRAP_ALREADY_INITIALIZED',
    message: 'BrowShare has already been initialized.',
    statusCode: 409,
  })
}
