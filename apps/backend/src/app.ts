import { createPublicId, createServiceLogger } from '@browshare/common'
import { ApiErrorEnvelopeSchema, BROWSHARE_VERSION } from '@browshare/contracts'
import AjvCompiler from '@fastify/ajv-compiler'
import Fastify, {
  type FastifyInstance,
  type FastifySchemaCompiler,
  type RawReplyDefaultExpression,
  type RawRequestDefaultExpression,
  type RawServerDefault,
} from 'fastify'

import type { BackendConfiguration } from './configuration.js'
import { installErrorHandlers } from './plugins/errors.js'
import { registerPlatformPlugins } from './plugins/platform.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerBootstrapRoutes } from './routes/bootstrap.js'
import type { BootstrapPort } from './services/bootstrap-access.js'
import { registerOperationRoutes } from './routes/operations.js'
import { registerSystemRoutes } from './routes/system.js'
import { registerUserRoutes } from './routes/users.js'
import { registerWorkerEnrollmentRoutes } from './routes/worker-enrollments.js'
import { registerWorkerRegistrationRoutes } from './routes/worker-registration.js'
import type { AuthenticationPort } from './services/authentication.js'
import type { AuthorizationPort } from './services/authorization.js'
import type { ReadinessProbe } from './services/readiness.js'
import type { UserPort } from './services/users.js'
import type { WorkerEnrollmentPort } from './services/worker-enrollments.js'
import type { WorkerRegistrationPort } from './services/worker-registration.js'

export type BackendApp = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression<RawServerDefault>,
  RawReplyDefaultExpression<RawServerDefault>,
  ReturnType<typeof createServiceLogger>
>

export interface BackendAppDependencies {
  readonly businessMetrics?: () => Promise<readonly string[]>
  readonly bootstrap: BootstrapPort
  readonly authentication: AuthenticationPort
  readonly authorization: AuthorizationPort
  readonly readiness: ReadinessProbe
  readonly users: UserPort
  readonly workerEnrollments: WorkerEnrollmentPort
  readonly workerRegistration: WorkerRegistrationPort
}

export async function createBackendApp(
  configuration: BackendConfiguration,
  dependencies: BackendAppDependencies,
): Promise<BackendApp> {
  const logger = createServiceLogger({
    service: 'backend',
    level: configuration.logLevel,
    base: { version: BROWSHARE_VERSION },
  })
  const app = Fastify({
    loggerInstance: logger,
    requestIdHeader: false,
    genReqId: () => createPublicId(),
    bodyLimit: 1_048_576,
    trustProxy: false,
    // The public schemas use additionalProperties: false as a compatibility
    // boundary. Silently removing a misspelled field would turn a client bug
    // into a successful request with different semantics.
    ajv: { customOptions: { removeAdditional: false } },
    schemaController: {
      compilersFactory: {
        buildValidator(
          externalSchemas: Parameters<ReturnType<typeof AjvCompiler>>[0],
          options: Parameters<ReturnType<typeof AjvCompiler>>[1] = {},
        ) {
          const compile = AjvCompiler()
          const urlValidator = compile(externalSchemas, options)
          // JSON already carries types. Coercion changes null limits into zero
          // and accepts booleans as numbers; only URL/header strings need it.
          const bodyValidator = compile(externalSchemas, {
            customOptions: { removeAdditional: false, coerceTypes: false },
          })
          // ajv-compiler 4.0.6 types this callback as raw AJV compile, but
          // its implementation and Fastify pass a route schema definition.
          return ((definition: Parameters<FastifySchemaCompiler<unknown>>[0]) =>
            (definition.httpPart === 'body' ? bodyValidator : urlValidator)(
              definition,
            )) as typeof urlValidator
        },
      },
    },
  })

  const requestMetrics = {
    started: 0,
    completed: 0,
    failed: 0,
    durationMilliseconds: 0,
    statusCounts: new Map<number, number>(),
  }

  app.addHook('onRequest', async (request, reply) => {
    requestMetrics.started += 1
    reply.header('x-request-id', request.id)
  })

  app.addHook('onResponse', async (_request, reply) => {
    requestMetrics.completed += 1
    // Count only finished responses; pending requests and SSE must not subtract
    // wall-clock timestamps from a cumulative duration counter.
    requestMetrics.durationMilliseconds += reply.elapsedTime
    if (reply.statusCode >= 500) requestMetrics.failed += 1
    requestMetrics.statusCounts.set(
      reply.statusCode,
      (requestMetrics.statusCounts.get(reply.statusCode) ?? 0) + 1,
    )
  })

  app.get('/metrics', async (_request, reply) => {
    const businessMetrics = await dependencies.businessMetrics?.()
    const memory = process.memoryUsage()
    const lines = [
      '# HELP browshare_http_requests_started_total HTTP requests accepted by the Backend.',
      '# TYPE browshare_http_requests_started_total counter',
      `browshare_http_requests_started_total ${requestMetrics.started}`,
      '# HELP browshare_http_requests_completed_total HTTP responses completed by the Backend.',
      '# TYPE browshare_http_requests_completed_total counter',
      `browshare_http_requests_completed_total ${requestMetrics.completed}`,
      '# HELP browshare_http_requests_failed_total HTTP responses with a 5xx status.',
      '# TYPE browshare_http_requests_failed_total counter',
      `browshare_http_requests_failed_total ${requestMetrics.failed}`,
      '# HELP browshare_http_request_duration_milliseconds_total Sum of finished response durations, including ended SSE streams.',
      '# TYPE browshare_http_request_duration_milliseconds_total counter',
      `browshare_http_request_duration_milliseconds_total ${requestMetrics.durationMilliseconds}`,
      '# HELP browshare_process_uptime_seconds Backend process uptime.',
      '# TYPE browshare_process_uptime_seconds gauge',
      `browshare_process_uptime_seconds ${process.uptime()}`,
      '# HELP browshare_process_resident_memory_bytes Backend resident memory.',
      '# TYPE browshare_process_resident_memory_bytes gauge',
      `browshare_process_resident_memory_bytes ${memory.rss}`,
      '# HELP browshare_http_responses_total HTTP responses by status code.',
      '# TYPE browshare_http_responses_total counter',
    ]
    for (const [status, count] of [...requestMetrics.statusCounts].sort((a, b) => a[0] - b[0])) {
      lines.push(`browshare_http_responses_total{status="${status}"} ${count}`)
    }
    if (businessMetrics !== undefined) lines.push(...businessMetrics)
    return reply.type('text/plain; version=0.0.4').send(`${lines.join('\n')}\n`)
  })

  await registerPlatformPlugins(app, configuration)
  registerOperationRoutes(app, dependencies.readiness)
  registerSystemRoutes(app)
  registerBootstrapRoutes(app, dependencies.bootstrap)
  registerAuthRoutes(app, configuration, dependencies.authentication)
  registerUserRoutes(app, configuration, dependencies)
  registerWorkerEnrollmentRoutes(app, configuration, dependencies)
  registerWorkerRegistrationRoutes(app, dependencies.workerRegistration)
  installErrorHandlers(app)

  return app
}

export const backendErrorResponseSchema = ApiErrorEnvelopeSchema
