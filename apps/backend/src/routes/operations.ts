import { utcNow } from '@browshare/common'
import { BROWSHARE_VERSION, HealthLiveSchema, HealthReadySchema } from '@browshare/contracts'

import type { BackendApp } from '../app.js'
import type { ReadinessProbe } from '../services/readiness.js'

export function registerOperationRoutes(app: BackendApp, readiness: ReadinessProbe): void {
  app.get(
    '/health/live',
    {
      schema: {
        tags: ['Operations'],
        operationId: 'getBackendLiveness',
        response: { 200: HealthLiveSchema },
      },
    },
    async () => ({
      status: 'ok' as const,
      service: 'backend' as const,
      version: BROWSHARE_VERSION,
      time: utcNow(),
    }),
  )

  app.get(
    '/health/ready',
    {
      schema: {
        tags: ['Operations'],
        operationId: 'getBackendReadiness',
        response: { 200: HealthReadySchema, 503: HealthReadySchema },
      },
    },
    async (_request, reply) => {
      const readinessSnapshot = await readiness()
      reply.status(readinessSnapshot.status === 'ready' ? 200 : 503)
      return {
        ...readinessSnapshot,
        service: 'backend' as const,
        version: BROWSHARE_VERSION,
        time: utcNow(),
      }
    },
  )
}
