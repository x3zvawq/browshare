#!/usr/bin/env node
import { registerAdminOverviewRoutes } from './routes/admin-overview.js'
import { registerDiagnosticBundleRoutes } from './routes/diagnostic-bundle.js'
import { registerAuditEventRoutes } from './routes/audit-events.js'
import { registerMaintenanceRoutes } from './routes/maintenance.js'
import { registerPageScriptRoutes } from './routes/page-scripts.js'
import { registerProfileContextRoutes } from './routes/profile-contexts.js'
import { registerNavigationPolicyRoutes } from './routes/navigation-policies.js'
import { registerSystemSettingsRoutes } from './routes/system-settings.js'
import { registerAdminSessionRoutes } from './routes/admin-sessions.js'
import { registerSessionPolicyRoutes } from './routes/session-policies.js'
import { registerSessionRoutes } from './routes/sessions.js'
import { registerSessionDownloadRoutes } from './routes/session-downloads.js'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { createBackendApp } from './app.js'
import type { BackendConfiguration } from './configuration.js'
import { registerProfileGroupRoutes } from './routes/profile-groups.js'
import { registerProxyRoutes } from './routes/proxies.js'
import { registerProfileRoutes } from './routes/profiles.js'
import { registerWorkerRoutes } from './routes/workers.js'
import type { AuthenticationPort } from './services/authentication.js'
import type { AuthorizationPort } from './services/authorization.js'
import type { ProfilePort } from './services/profiles.js'
import type { ProxyPort } from './services/proxies.js'
import { schemaReadinessProbe } from './services/readiness.js'
import type { UserPort } from './services/users.js'
import type { WorkerControlCommandPort } from './services/worker-control-server.js'
import type { WorkerCredentialPort } from './services/worker-credentials.js'
import type { WorkerEnrollmentPort } from './services/worker-enrollments.js'
import type { WorkerRegistrationPort } from './services/worker-registration.js'
import type { WorkerPort } from './services/workers.js'

const schemaOnlyFailure = async (): Promise<never> => {
  throw new Error('Runtime service access is unavailable while generating OpenAPI')
}
const schemaAuthentication: AuthenticationPort = {
  getPublicConfiguration: async () => ({
    registrationOpen: false,
    emailVerificationRequired: false,
  }),
  login: schemaOnlyFailure,
  register: schemaOnlyFailure,
  authenticate: schemaOnlyFailure,
  logout: schemaOnlyFailure,
  changePassword: schemaOnlyFailure,
  resetUserPassword: schemaOnlyFailure,
  listSessions: schemaOnlyFailure,
  revokeSession: schemaOnlyFailure,
  revokeAllSessions: schemaOnlyFailure,
}
const schemaAuthorization: AuthorizationPort = {
  listUserPermissionCodes: schemaOnlyFailure,
  hasPermission: schemaOnlyFailure,
  requirePermission: schemaOnlyFailure,
}
const schemaUsers: UserPort = {
  list: schemaOnlyFailure,
  get: schemaOnlyFailure,
  create: schemaOnlyFailure,
  update: schemaOnlyFailure,
  setState: schemaOnlyFailure,
  delete: schemaOnlyFailure,
  setRoles: schemaOnlyFailure,
  listRoles: schemaOnlyFailure,
}
const schemaWorkerEnrollments: WorkerEnrollmentPort = {
  list: schemaOnlyFailure,
  create: schemaOnlyFailure,
  revoke: schemaOnlyFailure,
}
const schemaWorkerRegistration: WorkerRegistrationPort = {
  register: schemaOnlyFailure,
}
const schemaWorkerControl: WorkerControlCommandPort = {
  runDiagnosticProbe: schemaOnlyFailure,
  runProfileRuntime: schemaOnlyFailure,
}
const schemaWorkerCredentials: WorkerCredentialPort = {
  listCredentials: schemaOnlyFailure,
  listRotations: schemaOnlyFailure,
  createRotation: schemaOnlyFailure,
  revokeRotation: schemaOnlyFailure,
  rotate: schemaOnlyFailure,
  revokeCredential: schemaOnlyFailure,
  retire: schemaOnlyFailure,
}
const schemaWorkers: WorkerPort = {
  list: schemaOnlyFailure,
  get: schemaOnlyFailure,
  getState: schemaOnlyFailure,
  setState: schemaOnlyFailure,
  updateCapacity: schemaOnlyFailure,
}
const schemaProfiles: ProfilePort = {
  listAccessible: schemaOnlyFailure,
  getAccessible: schemaOnlyFailure,
  list: schemaOnlyFailure,
  get: schemaOnlyFailure,
  create: schemaOnlyFailure,
  update: schemaOnlyFailure,
  setState: schemaOnlyFailure,
  requestDeletion: schemaOnlyFailure,
}
const schemaProxies: ProxyPort = {
  probe: schemaOnlyFailure,
  list: schemaOnlyFailure,
  get: schemaOnlyFailure,
  create: schemaOnlyFailure,
  update: schemaOnlyFailure,
  delete: schemaOnlyFailure,
}

const configuration: BackendConfiguration = {
  host: '127.0.0.1',
  port: 0,
  databaseUrl: 'postgresql://openapi:openapi@127.0.0.1/openapi',
  allowedOrigins: ['http://127.0.0.1:5173'],
  sessionSecret: 'openapi-generation-secret-000000000000',
  cookieSecure: true,
  logLevel: 'silent',
  docsEnabled: false,
  gateways: [],
  workerControlUrl: 'wss://127.0.0.1:3400/api/v1/worker-control',
  workerControlListener: {
    host: '127.0.0.1',
    port: 0,
    tlsCertificatePem: 'schema-only',
    tlsPrivateKeyPem: 'schema-only',
    helloTimeoutMilliseconds: 10_000,
    heartbeatIntervalMilliseconds: 10_000,
    offlineAfterMilliseconds: 30_000,
    commandAcknowledgementTimeoutMilliseconds: 3_000,
    commandResultTimeoutMilliseconds: 60_000,
    profileRuntimeCommandTimeoutMilliseconds: 120_000,
    commandMaximumAttempts: 3,
  },
  workerCertificateAuthority: {
    certificatePem: 'schema-only',
    privateKeyPem: 'schema-only',
    certificateValidityDays: 90,
  },
}

const app = await createBackendApp(configuration, {
  bootstrap: { status: schemaOnlyFailure, initialize: schemaOnlyFailure },
  authentication: schemaAuthentication,
  authorization: schemaAuthorization,
  readiness: schemaReadinessProbe,
  users: schemaUsers,
  workerEnrollments: schemaWorkerEnrollments,
  workerRegistration: schemaWorkerRegistration,
})
registerAdminOverviewRoutes(app, configuration, {
  authentication: schemaAuthentication,
  authorization: schemaAuthorization,
  overview: { get: schemaOnlyFailure },
})
registerDiagnosticBundleRoutes(app, configuration, {
  authentication: schemaAuthentication,
  authorization: schemaAuthorization,
  diagnostics: { collect: schemaOnlyFailure },
})
registerSessionDownloadRoutes(app, configuration, {
  authentication: schemaAuthentication,
  downloads: { list: schemaOnlyFailure, prepare: schemaOnlyFailure },
})
registerWorkerRoutes(app, configuration, {
  authentication: schemaAuthentication,
  authorization: schemaAuthorization,
  workerControl: schemaWorkerControl,
  workerCredentials: schemaWorkerCredentials,
  workers: schemaWorkers,
})
registerProfileRoutes(app, configuration, {
  authentication: schemaAuthentication,
  authorization: schemaAuthorization,
  profiles: schemaProfiles,
  profileRuntimes: { setRuntime: schemaOnlyFailure },
})
registerProfileContextRoutes(app, configuration, {
  authentication: schemaAuthentication,
  authorization: schemaAuthorization,
  profileContexts: { get: schemaOnlyFailure, save: schemaOnlyFailure },
})
registerPageScriptRoutes(app, configuration, {
  authentication: schemaAuthentication,
  authorization: schemaAuthorization,
  pageScripts: {
    getState: schemaOnlyFailure,
    getVersion: schemaOnlyFailure,
    listVersions: schemaOnlyFailure,
    saveDraft: schemaOnlyFailure,
    publish: schemaOnlyFailure,
    disable: schemaOnlyFailure,
  },
})
registerNavigationPolicyRoutes(app, configuration, {
  authentication: schemaAuthentication,
  authorization: schemaAuthorization,
  navigationPolicies: {
    getState: schemaOnlyFailure,
    getVersion: schemaOnlyFailure,
    listVersions: schemaOnlyFailure,
    saveDraft: schemaOnlyFailure,
    preview: schemaOnlyFailure,
    publish: schemaOnlyFailure,
    disable: schemaOnlyFailure,
  },
})
registerSystemSettingsRoutes(app, configuration, {
  authentication: schemaAuthentication,
  authorization: schemaAuthorization,
  settings: {
    getRegistration: schemaOnlyFailure,
    saveRegistration: schemaOnlyFailure,
    getTransfers: schemaOnlyFailure,
    getViewerFocus: schemaOnlyFailure,
    getMedia: schemaOnlyFailure,
    saveMedia: schemaOnlyFailure,
    saveViewerFocus: schemaOnlyFailure,
    saveTransfers: schemaOnlyFailure,
  },
})
registerSessionPolicyRoutes(app, configuration, {
  authentication: schemaAuthentication,
  authorization: schemaAuthorization,
  sessionPolicies: {
    list: schemaOnlyFailure,
    get: schemaOnlyFailure,
    save: schemaOnlyFailure,
    delete: schemaOnlyFailure,
    preview: schemaOnlyFailure,
  },
})
registerAuditEventRoutes(app, configuration, {
  authentication: schemaAuthentication,
  authorization: schemaAuthorization,
  auditEvents: { list: schemaOnlyFailure, get: schemaOnlyFailure },
})
registerAdminSessionRoutes(app, configuration, {
  authentication: schemaAuthentication,
  authorization: schemaAuthorization,
  adminSessions: { list: schemaOnlyFailure, get: schemaOnlyFailure, close: schemaOnlyFailure },
})
registerMaintenanceRoutes(app, configuration, {
  authentication: schemaAuthentication,
  authorization: schemaAuthorization,
  sessionCreation: { createMaintenance: schemaOnlyFailure },
  maintenanceProfiles: { list: schemaOnlyFailure, get: schemaOnlyFailure },
})
registerSessionRoutes(app, configuration, {
  authentication: schemaAuthentication,
  authorization: schemaAuthorization,
  sessions: {
    list: schemaOnlyFailure,
    get: schemaOnlyFailure,
    close: schemaOnlyFailure,
    rename: schemaOnlyFailure,
  },
  sessionCreation: { create: schemaOnlyFailure },
  sessionViewers: { connect: schemaOnlyFailure, continue: schemaOnlyFailure },
})
registerProfileGroupRoutes(app, configuration, {
  authentication: schemaAuthentication,
  authorization: schemaAuthorization,
  profiles: schemaProfiles,
  profileGroups: {
    list: schemaOnlyFailure,
    get: schemaOnlyFailure,
    create: schemaOnlyFailure,
    update: schemaOnlyFailure,
    setState: schemaOnlyFailure,
    delete: schemaOnlyFailure,
    getMembers: schemaOnlyFailure,
    setMembers: schemaOnlyFailure,
    getGrants: schemaOnlyFailure,
    setGrants: schemaOnlyFailure,
    subjects: schemaOnlyFailure,
  },
})
registerProxyRoutes(app, configuration, {
  authentication: schemaAuthentication,
  authorization: schemaAuthorization,
  proxies: schemaProxies,
})

try {
  await app.ready()
  const destination = resolve(process.cwd(), 'openapi.json')
  await writeFile(destination, `${JSON.stringify(app.swagger(), null, 2)}\n`)
  process.stdout.write(`${destination}\n`)
} finally {
  await app.close()
}
