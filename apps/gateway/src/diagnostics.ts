import { isPublicId, type createServiceLogger } from '@browshare/common'

type DiagnosticLogger = Pick<ReturnType<typeof createServiceLogger>, 'info' | 'warn'>
const events = new Set([
  'peer.connected',
  'connection.rejected',
  'peer.rate-limited',
  'peer.bound',
  'pair.completed',
  'description.relayed',
  'ice.relayed',
  'ice-restart.relayed',
  'error.relayed',
  'peer.disconnected',
  'pair.expired',
  'peer.rejected',
])
const warningEvents = new Set([
  'connection.rejected',
  'peer.rate-limited',
  'error.relayed',
  'pair.expired',
  'peer.rejected',
])

/** The engine hook is public; the log sink never spreads its arbitrary fields. */
export function createGatewayDiagnosticSink(
  gatewayId: string,
  logger: DiagnosticLogger,
  errorCodes: readonly string[],
): (event: unknown) => void {
  const codes = new Set(errorCodes)
  return (event) => {
    if (typeof event !== 'object' || event === null) return
    const input = event as Readonly<Record<string, unknown>>
    if (typeof input.type !== 'string' || !events.has(input.type)) return
    const fields: Record<string, string | number> = {
      event: input.type,
      gatewayId,
      occurredAt: new Date().toISOString(),
    }
    if (
      typeof input.sessionId === 'string' &&
      isPublicId(input.sessionId) &&
      typeof input.viewerGeneration === 'number' &&
      Number.isSafeInteger(input.viewerGeneration) &&
      input.viewerGeneration >= 0
    ) {
      fields.sessionId = input.sessionId
      fields.viewerGeneration = input.viewerGeneration
    }
    if (typeof input.code === 'string' && codes.has(input.code)) fields.code = input.code
    if (input.role === 'core' || input.role === 'viewer') fields.role = input.role
    if (input.fromRole === 'core' || input.fromRole === 'viewer') fields.fromRole = input.fromRole
    if (input.reason === 'gateway-capacity' || input.reason === 'ip-capacity')
      fields.reason = input.reason
    if (warningEvents.has(input.type)) logger.warn(fields, 'Gateway signaling diagnostic')
    else logger.info(fields, 'Gateway signaling diagnostic')
  }
}
