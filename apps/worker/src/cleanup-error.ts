import type { WorkerCleanupError } from '@browshare/contracts'

export function cleanupError(cause: unknown): WorkerCleanupError {
  const code =
    typeof cause === 'object' && cause !== null && 'code' in cause ? cause.code : undefined
  return {
    code:
      typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/.test(code) ? code : 'CLEANUP_FAILED',
    occurredAt: new Date().toISOString(),
  }
}
