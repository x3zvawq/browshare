import { compileNavigationPolicy, NavigationPolicyError } from '@browshare/navigation-policy'
import type { SessionNavigationPolicy, NavigationScriptContext } from '@browshare/contracts'
import {
  WorkerSessionError,
  type SessionNavigationRequest,
  type SessionNavigationDecision,
} from './tab-sessions.js'

/** Compile one immutable publication, then reuse it for each document request in the Session. */
export function createSessionNavigationAuthorizer(
  policy: Omit<SessionNavigationPolicy, 'versionId'>,
  context?: Pick<NavigationScriptContext, 'user' | 'session'>,
) {
  let evaluate: ReturnType<typeof compileNavigationPolicy>
  try {
    evaluate = compileNavigationPolicy(policy)
  } catch (cause) {
    if (cause instanceof NavigationPolicyError)
      throw new WorkerSessionError('NAVIGATION_POLICY_INVALID', cause.message)
    throw cause
  }
  return async (request: SessionNavigationRequest): Promise<SessionNavigationDecision> => {
    // Toolbar history/reload commands have no URL; Core checks the resulting Document separately.
    if (request.url === undefined)
      return { allowed: ['back', 'forward', 'reload'].includes(request.action) }
    const result = await evaluate(request.url, {
      source: request.action === 'local-open' ? 'local-open' : (request.source ?? 'initial'),
      currentUrl: request.currentUrl ?? null,
      user: context?.user ?? null,
      session: context?.session ?? null,
    })
    const url = result.normalizedUrl
    if (url === null) return { allowed: false, reason: 'Only HTTP and HTTPS navigation is allowed' }
    const action = result.action
    if (action === 'DENY')
      return { allowed: false, reason: 'Navigation is denied by the Session policy' }
    if (action === 'OPEN_LOCAL_PROMPT')
      return {
        allowed: request.action === 'local-open',
        url,
        reason: 'This address requires local-open confirmation',
      }
    if (request.action === 'local-open')
      return { allowed: false, reason: 'This address is only allowed remotely' }
    if (action === 'PROMPT_REMOTE')
      return {
        allowed: true,
        url,
        confirmation: {
          title: '确认远端导航 / Confirm remote navigation',
          body: url.length > 2048 ? url.slice(0, 2047) + '…' : url,
          confirmLabel: '继续 / Continue',
        },
      }
    return { allowed: true, url: action === 'REDIRECT_REMOTE' ? result.redirectUrl! : url }
  }
}
