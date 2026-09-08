import type { paths } from '@browshare/api-client'
export type DiagnosticBundle =
  paths['/admin/diagnostics']['get']['responses'][200]['content']['application/json']

export type AdminOverview =
  paths['/admin/overview']['get']['responses'][200]['content']['application/json']
export type WorkerOverview = NonNullable<AdminOverview['workers']>
export type ProfileOverview = NonNullable<AdminOverview['profiles']>
export type SessionOverview = NonNullable<AdminOverview['sessions']>

export type AuthSession =
  paths['/auth/session']['get']['responses'][200]['content']['application/json']
export type PublicAuthConfiguration =
  paths['/auth/config']['get']['responses'][200]['content']['application/json']
export type BootstrapStatus =
  paths['/bootstrap']['get']['responses'][200]['content']['application/json']
export type PortalSessionDevice =
  paths['/auth/sessions']['get']['responses'][200]['content']['application/json']['items'][number]
export type WorkerEnrollment =
  paths['/workers/enrollments']['get']['responses'][200]['content']['application/json']['items'][number]
export type IssuedWorkerEnrollment =
  paths['/workers/enrollments']['post']['responses'][201]['content']['application/json']
export type ProfileListQuery = NonNullable<paths['/profiles']['get']['parameters']['query']>
export type ProfileListResponse =
  paths['/profiles']['get']['responses'][200]['content']['application/json']
export type Profile = ProfileListResponse['items'][number]
export type ProfileStorageSummary = Pick<
  Profile,
  | 'storageQuotaBytes'
  | 'storagePolicyVersion'
  | 'storageUsage'
  | 'storagePolicyPending'
  | 'storageBlockedReason'
>
export type StorageUsageFact = NonNullable<Profile['storageUsage']>
export type ProfileListSummary = ProfileListResponse['summary']
export type ProfileListFacets = ProfileListResponse['facets']
export type CreateProfileInput =
  paths['/profiles']['post']['requestBody']['content']['application/json']
export type UpdateProfileInput =
  paths['/profiles/{profileId}']['patch']['requestBody']['content']['application/json']
export type ProxyListQuery = NonNullable<paths['/proxies']['get']['parameters']['query']>
export type ProxyListResponse =
  paths['/proxies']['get']['responses'][200]['content']['application/json']
export type Proxy = ProxyListResponse['items'][number]
export type CreateProxyInput =
  paths['/proxies']['post']['requestBody']['content']['application/json']
export type UpdateProxyInput =
  paths['/proxies/{proxyId}']['patch']['requestBody']['content']['application/json']

export interface ApiErrorEnvelope {
  readonly error: {
    readonly code: string
    readonly message: string
    readonly requestId: string
    readonly details?: unknown
  }
}

export type ProfileGroup =
  paths['/profile-groups']['get']['responses'][200]['content']['application/json']['items'][number]
export type ProfileGroupInput =
  paths['/profile-groups']['post']['requestBody']['content']['application/json']
export type ProfileGroupMembers =
  paths['/profile-groups/{id}/members']['get']['responses'][200]['content']['application/json']
export type ProfileAccessSubject = ProfileGroupMembers['users'][number]
export type AccessibleProfile =
  paths['/workspace/profiles']['get']['responses'][200]['content']['application/json']['items'][number]
export type TabSession =
  paths['/sessions/{id}']['get']['responses'][200]['content']['application/json']
export type SessionViewerLaunch =
  paths['/sessions/{id}/viewer']['post']['responses'][200]['content']['application/json']
export type TabSessionListQuery = NonNullable<paths['/sessions']['get']['parameters']['query']>
export type SessionPolicy =
  paths['/session-policies']['get']['responses'][200]['content']['application/json']['items'][number]
export type SaveSessionPolicyInput =
  paths['/session-policies']['put']['requestBody']['content']['application/json']
export type SessionPolicyValues = SaveSessionPolicyInput['values']
export type SessionPolicyPreview =
  paths['/session-policies/effective']['get']['responses'][200]['content']['application/json']

export type AdminTabSession =
  paths['/admin/sessions/{id}']['get']['responses'][200]['content']['application/json']
export type AdminTabSessionListQuery = NonNullable<
  paths['/admin/sessions']['get']['parameters']['query']
>

export type ManagedUser =
  paths['/users/{userId}']['get']['responses'][200]['content']['application/json']
export type ManagedUserInput = paths['/users']['post']['requestBody']['content']['application/json']
export type ManagedUserQuery = NonNullable<paths['/users']['get']['parameters']['query']>
export type ManagedRole =
  paths['/roles']['get']['responses'][200]['content']['application/json']['items'][number]

export type RegistrationSettings =
  paths['/settings/registration']['get']['responses'][200]['content']['application/json']

export type ManagedWorker =
  paths['/workers/{workerId}']['get']['responses'][200]['content']['application/json']
export type WorkerQuery = NonNullable<paths['/workers']['get']['parameters']['query']>
export type WorkerCredential =
  paths['/workers/{workerId}/credentials']['get']['responses'][200]['content']['application/json']['items'][number]
export type WorkerRotation =
  paths['/workers/{workerId}/credential-rotations']['get']['responses'][200]['content']['application/json']['items'][number]
export type IssuedWorkerRotation =
  paths['/workers/{workerId}/credential-rotations']['post']['responses'][201]['content']['application/json']

export type NavigationPolicyVersion =
  paths['/profiles/{profileId}/navigation-policy/versions/{id}']['get']['responses'][200]['content']['application/json']
export type NavigationPolicyState =
  paths['/profiles/{profileId}/navigation-policy']['get']['responses'][200]['content']['application/json']
export type NavigationPolicyContent = NavigationPolicyVersion['content']
export type NavigationPolicyVersionSummary =
  paths['/profiles/{profileId}/navigation-policy/versions']['get']['responses'][200]['content']['application/json']['items'][number]
export type NavigationPolicyPreview =
  paths['/profiles/{profileId}/navigation-policy/preview']['post']['responses'][200]['content']['application/json']

export type NavigationPolicyPreviewRequest =
  paths['/profiles/{profileId}/navigation-policy/preview']['post']['requestBody']['content']['application/json']

export type PageScriptVersion =
  paths['/profiles/{profileId}/page-script/versions/{id}']['get']['responses'][200]['content']['application/json']
export type PageScriptState =
  paths['/profiles/{profileId}/page-script']['get']['responses'][200]['content']['application/json']
export type PageScriptContent = PageScriptVersion['content']
export type PageScriptVersionSummary =
  paths['/profiles/{profileId}/page-script/versions']['get']['responses'][200]['content']['application/json']['items'][number]

export type MaintenanceProfile =
  paths['/profiles/{id}/maintenance']['get']['responses'][200]['content']['application/json']

export type SessionTransferSettings =
  paths['/settings/transfers']['get']['responses'][200]['content']['application/json']

export type RetainedDownload =
  paths['/sessions/{id}/downloads']['get']['responses'][200]['content']['application/json']['items'][number]

export type AuditEvent =
  paths['/audit-events/{id}']['get']['responses'][200]['content']['application/json']
export type AuditEventSummary =
  paths['/audit-events']['get']['responses'][200]['content']['application/json']['items'][number]
export type AuditEventListQuery = NonNullable<paths['/audit-events']['get']['parameters']['query']>

export type ViewerFocusPolicy =
  paths['/settings/viewer-focus']['get']['responses'][200]['content']['application/json']

export type SessionMediaSettings =
  paths['/settings/media']['get']['responses'][200]['content']['application/json']

export type ProfileRouteSummary = Pick<
  Profile,
  'routeVersion' | 'runtimeRouteVersion' | 'runtimeProxyHealth' | 'restartRequired'
>
export type ProxyProbeInput =
  paths['/proxies/{proxyId}/probe']['post']['requestBody']['content']['application/json']
export type ProxyProbeResult =
  paths['/proxies/{proxyId}/probe']['post']['responses'][200]['content']['application/json']

export type UserProfileContext =
  paths['/profiles/{profileId}/contexts/{userId}']['get']['responses'][200]['content']['application/json']
