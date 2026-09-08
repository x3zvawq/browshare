import { AdminOverviewService } from './services/admin-overview.js'
import { BusinessMetrics } from './services/business-metrics.js'
import { DiagnosticBundleService } from './services/diagnostic-bundle.js'
import { registerDiagnosticBundleRoutes } from './routes/diagnostic-bundle.js'
import { registerAdminOverviewRoutes } from './routes/admin-overview.js'
import { AuditEventService } from './services/audit-events.js'
import { registerAuditEventRoutes } from './routes/audit-events.js'
import { registerMaintenanceRoutes } from './routes/maintenance.js'
import { MaintenanceProfileService } from './services/maintenance-profiles.js'
import { PageScriptService } from './services/page-scripts.js'
import { ProfileContextService } from './services/profile-contexts.js'
import { registerProfileContextRoutes } from './routes/profile-contexts.js'
import { registerPageScriptRoutes } from './routes/page-scripts.js'
import { closeNavigationScriptRuntime } from '@browshare/navigation-policy'
import { NavigationPolicyService } from './services/navigation-policies.js'
import { registerNavigationPolicyRoutes } from './routes/navigation-policies.js'
import { SystemSettingsService } from './services/system-settings.js'
import { registerSystemSettingsRoutes } from './routes/system-settings.js'
import { AdminSessionService } from './services/admin-sessions.js'
import { registerAdminSessionRoutes } from './routes/admin-sessions.js'
import { registerSessionPolicyRoutes } from './routes/session-policies.js'
import { SessionPolicyService } from './services/session-policies.js'
import { registerProfileGroupRoutes } from './routes/profile-groups.js'
import { ProfileGroupService } from './services/profile-groups.js'
import { ProfileEvents } from './services/profile-events.js'
import { registerProfileEventRoutes } from './routes/profile-events.js'
import { ProfileRuntimeService } from './services/profile-runtimes.js'
import { SessionReservationService } from './services/session-reservations.js'
import { SessionService } from './services/sessions.js'
import { SessionCreationService } from './services/session-creation.js'
import { SessionViewerService } from './services/session-viewers.js'
import { registerSessionRoutes } from './routes/sessions.js'
import { registerSessionDownloadRoutes } from './routes/session-downloads.js'
import { SessionDownloadService } from './services/session-downloads.js'
import { GatewayService } from './services/gateways.js'
import { registerGatewayRoutes } from './routes/gateways.js'
import {
  assertMigrationsCurrent,
  connectDatabase,
  type DatabaseConnection,
} from '@browshare/database'

import { createBackendApp, type BackendApp } from './app.js'
import type { BackendConfiguration } from './configuration.js'
import { registerProxyRoutes } from './routes/proxies.js'
import { registerProfileRoutes } from './routes/profiles.js'
import { registerWorkerRoutes } from './routes/workers.js'
import { AuthenticationService } from './services/authentication.js'
import { AuthorizationService } from './services/authorization.js'
import { bootstrapDatabase, type BootstrapResult } from './services/bootstrap.js'
import { BootstrapService } from './services/bootstrap-access.js'
import { ProfileService } from './services/profiles.js'
import { ProxyService } from './services/proxies.js'
import { createDatabaseReadinessProbe } from './services/readiness.js'
import { UserService } from './services/users.js'
import { WorkerEnrollmentService } from './services/worker-enrollments.js'
import { WorkerCertificateAuthority } from './services/worker-certificate-authority.js'
import { WorkerRegistrationService } from './services/worker-registration.js'
import { WorkerControlServer } from './services/worker-control-server.js'
import { WorkerCredentialService } from './services/worker-credentials.js'
import { WorkerService } from './services/workers.js'

export interface BackendRuntime {
  readonly app: BackendApp
  readonly database: DatabaseConnection
  readonly bootstrap: BootstrapResult
  readonly workerControl: WorkerControlServer
  readonly sessionReservations: SessionReservationService
  readonly sessions: SessionService
  readonly sessionCreation: SessionCreationService
  readonly sessionViewers: SessionViewerService
  readonly gateways: GatewayService
}

export async function createBackendRuntime(
  configuration: BackendConfiguration,
): Promise<BackendRuntime> {
  const database = connectDatabase(configuration.databaseUrl, {
    applicationName: 'browshare-backend',
    maxConnections: 10,
  })

  try {
    await assertMigrationsCurrent(database)
    const bootstrap = await bootstrapDatabase(database, configuration.bootstrapAdmin)
    const authorization = new AuthorizationService(database)
    const authentication = await AuthenticationService.create({
      connection: database,
      authorization,
      privacySecret: configuration.sessionSecret,
    })
    const workerCertificateAuthority = await WorkerCertificateAuthority.create({
      certificatePem: configuration.workerCertificateAuthority.certificatePem,
      privateKeyPem: configuration.workerCertificateAuthority.privateKeyPem,
      validityDays: configuration.workerCertificateAuthority.certificateValidityDays,
    })
    const app = await createBackendApp(configuration, {
      // Serving starts only after the runtime and its control server are constructed below.
      businessMetrics: () => businessMetrics.collect(),
      bootstrap: new BootstrapService(database, configuration.bootstrapToken),
      authentication,
      authorization,
      readiness: createDatabaseReadinessProbe(database),
      users: new UserService(database),
      workerEnrollments: new WorkerEnrollmentService(database),
      workerRegistration: new WorkerRegistrationService(
        database,
        workerCertificateAuthority,
        configuration.workerControlUrl,
      ),
    })
    const profileEvents = new ProfileEvents(database)
    const workerControl = new WorkerControlServer(database, configuration, app.log, () =>
      profileEvents.invalidate(),
    )
    const gateways = new GatewayService(database, configuration.gateways)
    const businessMetrics = new BusinessMetrics(database, workerControl)
    registerGatewayRoutes(app, gateways)
    const workerCredentials = new WorkerCredentialService(
      database,
      workerCertificateAuthority,
      configuration.workerControlUrl,
      workerControl,
    )
    const workers = new WorkerService(database, workerControl)
    registerDiagnosticBundleRoutes(app, configuration, {
      authentication,
      authorization,
      diagnostics: new DiagnosticBundleService(database, workerControl),
    })
    registerAdminOverviewRoutes(app, configuration, {
      authentication,
      authorization,
      overview: new AdminOverviewService(database, workerControl),
    })
    const sessionReservations = new SessionReservationService(database, workerControl, () =>
      app.log.error('Session reservation expiry processing failed'),
    )
    sessionReservations.start()
    const sessions = new SessionService(database, workerControl, () =>
      app.log.error('Session close outbox processing failed'),
    )
    sessions.start()
    const sessionCreation = new SessionCreationService(
      database,
      workerControl,
      sessionReservations,
      sessions,
      gateways,
      () => app.log.error('Session create outbox processing failed'),
    )
    sessionCreation.start()
    const sessionViewers = new SessionViewerService(database, workerControl, gateways)
    registerAuditEventRoutes(app, configuration, {
      authentication,
      authorization,
      auditEvents: new AuditEventService(database),
    })
    registerAdminSessionRoutes(app, configuration, {
      authentication,
      authorization,
      adminSessions: new AdminSessionService(database),
    })
    registerMaintenanceRoutes(app, configuration, {
      authentication,
      authorization,
      sessionCreation,
      maintenanceProfiles: new MaintenanceProfileService(database, workerControl),
    })
    registerSessionRoutes(app, configuration, {
      authentication,
      authorization,
      sessions,
      sessionCreation,
      sessionViewers,
    })
    registerSessionDownloadRoutes(app, configuration, {
      authentication,
      downloads: new SessionDownloadService(database, workerControl),
    })
    await profileEvents.start()
    registerProfileEventRoutes(app, configuration, { authentication, authorization, profileEvents })
    const profileRuntimes = new ProfileRuntimeService(database, workerControl, () =>
      app.log.error('Profile Runtime outbox processing failed'),
    )
    profileRuntimes.start()
    registerProfileRoutes(app, configuration, {
      profileRuntimes,
      authentication,
      authorization,
      profiles: new ProfileService(database, workerControl),
    })
    registerProfileContextRoutes(app, configuration, {
      authentication,
      authorization,
      profileContexts: new ProfileContextService(database),
    })
    registerPageScriptRoutes(app, configuration, {
      authentication,
      authorization,
      pageScripts: new PageScriptService(database),
    })
    registerNavigationPolicyRoutes(app, configuration, {
      authentication,
      authorization,
      navigationPolicies: new NavigationPolicyService(database),
    })
    registerSystemSettingsRoutes(app, configuration, {
      authentication,
      authorization,
      settings: new SystemSettingsService(database),
    })
    registerSessionPolicyRoutes(app, configuration, {
      authentication,
      authorization,
      sessionPolicies: new SessionPolicyService(database),
    })
    registerProfileGroupRoutes(app, configuration, {
      authentication,
      authorization,
      profiles: new ProfileService(database, workerControl),
      profileGroups: new ProfileGroupService(database),
    })
    registerProxyRoutes(app, configuration, {
      authentication,
      authorization,
      proxies: new ProxyService(database, workerControl),
    })
    registerWorkerRoutes(app, configuration, {
      authentication,
      authorization,
      workerControl,
      workerCredentials,
      workers,
    })
    app.addHook('onClose', async () => {
      await closeNavigationScriptRuntime()
      profileRuntimes.stop()
      sessionReservations.stop()
      sessions.stop()
      sessionCreation.stop()
      await workerControl.close()
      await profileRuntimes.drain()
      await sessionReservations.drain()
      await sessions.drain()
      await sessionCreation.drain()
      await profileEvents.close()
      await database.close()
    })
    return {
      app,
      database,
      bootstrap,
      workerControl,
      sessionReservations,
      sessions,
      sessionCreation,
      sessionViewers,
      gateways,
    }
  } catch (cause) {
    await database.close()
    throw cause
  }
}
