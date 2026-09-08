import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { BROWSHARE_API_VERSION, BROWSHARE_VERSION } from '@browshare/contracts'

import type { BackendApp } from '../app.js'
import type { BackendConfiguration } from '../configuration.js'

export async function registerPlatformPlugins(
  app: BackendApp,
  configuration: BackendConfiguration,
): Promise<void> {
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'BrowShare Control Backend API',
        description: 'Versioned REST API for the BrowShare control plane.',
        version: BROWSHARE_VERSION,
      },
      servers: [{ url: `/api/${BROWSHARE_API_VERSION}` }],
    },
  })
  if (configuration.docsEnabled) {
    await app.register(swaggerUi, {
      routePrefix: '/documentation',
      uiConfig: { docExpansion: 'list', deepLinking: true },
    })
  }
  await app.register(helmet, { contentSecurityPolicy: false })
  await app.register(cookie, {
    secret: configuration.sessionSecret,
    hook: 'onRequest',
  })
  await app.register(cors, {
    origin: [...configuration.allowedOrigins],
    credentials: true,
    exposedHeaders: ['x-request-id'],
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })
}
