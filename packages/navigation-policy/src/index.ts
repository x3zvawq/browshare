import type { SessionNavigationPolicy, NavigationScriptContext } from '@browshare/contracts'
import { runPolicyScript } from './script-runtime.js'
export { closeNavigationScriptRuntime } from './script-runtime.js'

export type NavigationPolicyContent = Omit<SessionNavigationPolicy, 'versionId'>
export interface NavigationEvaluation {
  action: Exclude<SessionNavigationPolicy['rules'][number]['action'], 'DEFER_TO_SCRIPT'>
  matchedRuleId: string | null
  normalizedUrl: string | null
  redirectUrl: string | null
  reason:
    | 'RULE'
    | 'DEFAULT'
    | 'UNSAFE_URL'
    | 'SCRIPT'
    | 'SCRIPT_ERROR'
    | 'SCRIPT_TIMEOUT'
    | 'SCRIPT_BUSY'
    | 'SCRIPT_INVALID'
}
export class NavigationPolicyError extends Error {
  constructor(
    message: string,
    readonly ruleId?: string,
  ) {
    super(message)
  }
}

export function normalizeNavigationUrl(input: string | undefined): string | undefined {
  if (input === undefined) return undefined
  try {
    const url = new URL(input)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : undefined
  } catch {
    return undefined
  }
}

/** Compile a publication once; preview and Worker document admission use the same matcher. */
export function compileNavigationPolicy(policy: NavigationPolicyContent) {
  if (!['ALLOW_REMOTE', 'DENY'].includes(policy.defaultAction))
    throw new NavigationPolicyError('Navigation default action must be ALLOW_REMOTE or DENY.')
  const seen = new Set<string>()
  const rules = policy.rules.map((rule) => {
    if (seen.has(rule.id))
      throw new NavigationPolicyError('Navigation rule IDs must be unique.', rule.id)
    seen.add(rule.id)
    let pattern: URLPattern
    try {
      pattern = new URLPattern(rule.pattern)
    } catch {
      throw new NavigationPolicyError('Navigation URL pattern is invalid.', rule.id)
    }
    const redirectUrl = normalizeNavigationUrl(rule.redirectUrl)
    if (rule.action === 'REDIRECT_REMOTE' && redirectUrl === undefined)
      throw new NavigationPolicyError(
        'Navigation redirect must use HTTP or HTTPS without credentials.',
        rule.id,
      )
    return { ...rule, pattern, redirectUrl }
  })
  return async (
    input: string,
    context?: NavigationScriptContext,
  ): Promise<NavigationEvaluation> => {
    const normalizedUrl = normalizeNavigationUrl(input)
    if (normalizedUrl === undefined)
      return {
        action: 'DENY',
        matchedRuleId: null,
        normalizedUrl: null,
        redirectUrl: null,
        reason: 'UNSAFE_URL',
      }
    const rule = rules.find(
      (candidate) => candidate.enabled && candidate.pattern.test(normalizedUrl),
    )
    const base: NavigationEvaluation = {
      action: !rule || rule.action === 'DEFER_TO_SCRIPT' ? policy.defaultAction : rule.action,
      matchedRuleId: rule?.id ?? null,
      normalizedUrl,
      redirectUrl: rule?.action === 'REDIRECT_REMOTE' ? rule.redirectUrl! : null,
      reason: rule ? 'RULE' : 'DEFAULT',
    }
    // Structured decisions are final. Only an explicit defer or no matching rule invokes Script.
    if (rule && rule.action !== 'DEFER_TO_SCRIPT') return base
    if (policy.policyScript === null) return { ...base, reason: 'DEFAULT' }
    const result = await runPolicyScript(policy.policyScript, {
      url: normalizedUrl,
      source: context?.source ?? 'initial',
      currentUrl: normalizeNavigationUrl(context?.currentUrl ?? undefined) ?? null,
      user: context?.user ? { id: context.user.id, displayName: context.user.displayName } : null,
      session: context?.session
        ? { id: context.session.id, profileId: context.session.profileId }
        : null,
      rule: rule ? { id: rule.id, action: rule.action } : null,
    })
    if (!result.ok) return { ...base, action: 'DENY', redirectUrl: null, reason: result.reason }
    let value: unknown
    try {
      value = JSON.parse(result.value)
    } catch {
      return { ...base, action: 'DENY', redirectUrl: null, reason: 'SCRIPT_INVALID' }
    }
    if (value === null) return { ...base, reason: 'DEFAULT' }
    if (
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !('action' in value) ||
      typeof value.action !== 'string' ||
      !['ALLOW_REMOTE', 'DENY', 'REDIRECT_REMOTE', 'PROMPT_REMOTE', 'OPEN_LOCAL_PROMPT'].includes(
        value.action,
      ) ||
      Object.keys(value).some((key) => !['action', 'redirectUrl'].includes(key))
    )
      return { ...base, action: 'DENY', redirectUrl: null, reason: 'SCRIPT_INVALID' }
    const redirectUrl =
      'redirectUrl' in value && typeof value.redirectUrl === 'string'
        ? normalizeNavigationUrl(value.redirectUrl)
        : undefined
    if (
      (value.action === 'REDIRECT_REMOTE' && redirectUrl === undefined) ||
      (value.action !== 'REDIRECT_REMOTE' && 'redirectUrl' in value)
    )
      return { ...base, action: 'DENY', redirectUrl: null, reason: 'SCRIPT_INVALID' }
    return {
      ...base,
      action: value.action as NavigationEvaluation['action'],
      redirectUrl: redirectUrl ?? null,
      reason: 'SCRIPT',
    }
  }
}

export async function validateNavigationPolicyScript(content: NavigationPolicyContent) {
  if (content.policyScript === null) return
  const result = await runPolicyScript(content.policyScript, null, true)
  if (!result.ok)
    throw new NavigationPolicyError(
      'Policy Script could not be compiled within its resource limits.',
    )
}
