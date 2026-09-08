import { BrowShareError } from '@browshare/common'
import type { FastifyReply, FastifyRequest } from 'fastify'

import type { BackendConfiguration } from './configuration.js'
import {
  PORTAL_SESSION_COOKIE,
  type AuthenticatedPortalSession,
  type AuthenticationPort,
  type IssuedAuthentication,
} from './services/authentication.js'

const SESSION_COOKIE_PATH = '/'

export async function requirePortalSession(
  request: FastifyRequest,
  reply: FastifyReply,
  configuration: BackendConfiguration,
  authentication: AuthenticationPort,
): Promise<{ readonly token: string; readonly session: AuthenticatedPortalSession }> {
  const token = readPortalSessionToken(request)
  const session = token === undefined ? undefined : await authentication.authenticate(token)
  if (token === undefined || session === undefined) {
    clearPortalSessionCookie(reply, configuration)
    throw new BrowShareError({
      code: 'UNAUTHORIZED',
      message: 'A valid Portal Session is required.',
      statusCode: 401,
    })
  }
  setPortalSessionCookie(reply, configuration, { token, response: session })
  return { token, session }
}

export function readPortalSessionToken(request: FastifyRequest): string | undefined {
  const signedValue = request.cookies[PORTAL_SESSION_COOKIE]
  if (signedValue === undefined) return undefined
  const unsigned = request.unsignCookie(signedValue)
  return unsigned.valid ? unsigned.value : undefined
}

export function setPortalSessionCookie(
  reply: FastifyReply,
  configuration: BackendConfiguration,
  issued: IssuedAuthentication,
): void {
  reply.setCookie(PORTAL_SESSION_COOKIE, issued.token, {
    signed: true,
    httpOnly: true,
    secure: configuration.cookieSecure,
    sameSite: 'lax',
    path: SESSION_COOKIE_PATH,
    expires: new Date(issued.response.expiresAt),
  })
}

export function clearPortalSessionCookie(
  reply: FastifyReply,
  configuration: BackendConfiguration,
): void {
  reply.clearCookie(PORTAL_SESSION_COOKIE, {
    httpOnly: true,
    secure: configuration.cookieSecure,
    sameSite: 'lax',
    path: SESSION_COOKIE_PATH,
  })
}
