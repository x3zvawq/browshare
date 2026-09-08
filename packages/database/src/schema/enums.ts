import { pgEnum } from 'drizzle-orm/pg-core'

export const enabledStatusEnum = pgEnum('enabled_status', ['ENABLED', 'DISABLED'])

export const workerStatusEnum = pgEnum('worker_status', [
  'PENDING',
  'ONLINE',
  'DRAINING',
  'OFFLINE',
  'DISABLED',
])

export const workerCredentialStatusEnum = pgEnum('worker_credential_status', [
  'ACTIVE',
  'REVOKED',
  'EXPIRED',
])

export const workerCredentialRotationStatusEnum = pgEnum('worker_credential_rotation_status', [
  'ACTIVE',
  'CONSUMED',
  'REVOKED',
  'EXPIRED',
])

export const workerEnrollmentStatusEnum = pgEnum('worker_enrollment_status', [
  'ACTIVE',
  'CONSUMED',
  'REVOKED',
  'EXPIRED',
])

export const profileVisibilityEnum = pgEnum('profile_visibility', [
  'RESTRICTED',
  'ALL_ENABLED_USERS',
])

export const profileRuntimeStateEnum = pgEnum('profile_runtime_state', [
  'STOPPED',
  'STARTING',
  'RUNNING',
  'MAINTAINING',
  'STOPPING',
  'ERROR',
])

export const profileRuntimeModeEnum = pgEnum('profile_runtime_mode', [
  'ALWAYS_ON',
  'ON_DEMAND',
  'MANUAL',
])

export const proxyTypeEnum = pgEnum('proxy_type', ['DIRECT', 'HTTP', 'HTTPS', 'SOCKS5'])
export const proxyHealthStatusEnum = pgEnum('proxy_health_status', [
  'UNKNOWN',
  'HEALTHY',
  'UNHEALTHY',
])

export const sessionStatusEnum = pgEnum('tab_session_status', [
  'RESERVED',
  'CREATING',
  'READY',
  'CONNECTED',
  'SUSPENDED',
  'DISCONNECTED',
  'CLOSING',
  'CLOSED',
  'FAILED',
])

export const reservationStatusEnum = pgEnum('reservation_status', [
  'ACTIVE',
  'CONSUMED',
  'RELEASED',
  'EXPIRED',
])

export const viewerTicketStatusEnum = pgEnum('viewer_ticket_status', [
  'ACTIVE',
  'CONSUMED',
  'REVOKED',
  'EXPIRED',
])

export const viewerTicketPurposeEnum = pgEnum('viewer_ticket_purpose', ['CONNECT', 'TAKEOVER'])

export const sessionPolicyScopeEnum = pgEnum('session_policy_scope', [
  'GLOBAL',
  'USER_PROFILE',
  'USER_PROFILE_GROUP',
])

export const versionStateEnum = pgEnum('version_state', ['DRAFT', 'PUBLISHED', 'DISABLED'])
export const pageScriptScopeEnum = pgEnum('page_script_scope', ['NORMAL', 'MAINTENANCE', 'BOTH'])

export const navigationActionEnum = pgEnum('navigation_action', [
  'ALLOW_REMOTE',
  'DENY',
  'REDIRECT_REMOTE',
  'PROMPT_REMOTE',
  'OPEN_LOCAL_PROMPT',
])

export const auditResultEnum = pgEnum('audit_result', ['SUCCEEDED', 'FAILED', 'DENIED'])

export const sessionKindEnum = pgEnum('session_kind', ['NORMAL', 'MAINTENANCE'])
