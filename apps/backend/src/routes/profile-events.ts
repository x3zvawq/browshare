import type { ServerResponse } from 'node:http'
import type { BackendApp } from '../app.js'
import type { BackendConfiguration } from '../configuration.js'
import { requirePermission } from '../http-authorization.js'
import { readPortalSessionToken, requirePortalSession } from '../http-session.js'
import type { AuthenticationPort } from '../services/authentication.js'
import type { AuthorizationPort } from '../services/authorization.js'
import type { ProfileEvents } from '../services/profile-events.js'

export function registerProfileEventRoutes(
  app: BackendApp,
  configuration: BackendConfiguration,
  services: {
    authentication: AuthenticationPort
    authorization: AuthorizationPort
    profileEvents: ProfileEvents
  },
): void {
  const streams = new Set<ServerResponse>()
  app.addHook('preClose', async () => {
    for (const stream of streams) stream.end()
  })
  for (const [path, permission] of [
    ['/api/v1/profiles/events', 'profile.read'],
    ['/api/v1/proxies/events', 'proxy.read'],
    ['/api/v1/workspace/events', null],
  ] as const) {
    app.get(path, { schema: { hide: true } }, async (request, reply) => {
      if (permission !== null)
        await requirePermission(request, reply, configuration, services, permission)
      else await requirePortalSession(request, reply, configuration, services.authentication)
      const token = readPortalSessionToken(request)!
      reply.hijack()
      const stream = reply.raw
      for (const [key, value] of Object.entries(reply.getHeaders())) {
        if (value !== undefined) stream.setHeader(key, value)
      }
      stream.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        'x-accel-buffering': 'no',
      })
      streams.add(stream)
      const send = () => {
        if (stream.destroyed || stream.writableEnded) return
        if (!stream.write('event: profiles-changed\ndata: {}\n\n')) stream.end()
      }
      const unsubscribe = services.profileEvents.subscribe(send)
      send() // Every connection, including reconnect, starts with a fresh REST snapshot.
      let checking = false
      const heartbeat = setInterval(() => {
        if (checking || stream.destroyed) return
        checking = true
        void (async () => {
          const session = await services.authentication.authenticate(token)
          if (session === undefined) throw new Error('Session expired')
          if (permission !== null)
            await services.authorization.requirePermission(session.user.id, permission)
          if (!stream.destroyed) stream.write(': heartbeat\n\n')
        })()
          .catch(() => {
            if (!stream.destroyed) {
              stream.write('event: authentication-required\ndata: {}\n\n')
              stream.end()
            }
          })
          .finally(() => {
            checking = false
          })
      }, 15000)
      heartbeat.unref()
      stream.once('close', () => {
        clearInterval(heartbeat)
        unsubscribe()
        streams.delete(stream)
      })
    })
  }
}
