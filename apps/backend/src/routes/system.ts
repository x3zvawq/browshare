import {
  BROWSHARE_API_VERSION,
  BROWSHARE_VERSION,
  VersionResponseSchema,
} from '@browshare/contracts'

import type { BackendApp } from '../app.js'

export function registerSystemRoutes(app: BackendApp): void {
  app.get(
    `/api/${BROWSHARE_API_VERSION}/version`,
    {
      schema: {
        tags: ['System'],
        operationId: 'getVersion',
        response: { 200: VersionResponseSchema },
      },
    },
    async () => ({
      name: 'BrowShare' as const,
      service: 'backend' as const,
      version: BROWSHARE_VERSION,
      apiVersion: BROWSHARE_API_VERSION,
    }),
  )
}
