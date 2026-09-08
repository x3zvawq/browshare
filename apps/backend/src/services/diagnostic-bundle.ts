import { BrowShareError, createPublicId, isPublicId } from '@browshare/common'
import {
  ApiErrorCodeSchema,
  BROWSHARE_VERSION,
  WORKER_CONTROL_PROTOCOL_MAJOR,
  WORKER_CONTROL_PROTOCOL_MINOR,
  WorkerCapabilityReportSchema,
  WorkerMetricsSnapshotResponseSchema,
  type DiagnosticBundle,
  type DiagnosticBundleQuery,
} from '@browshare/contracts'
import type { DatabaseConnection } from '@browshare/database'
import { auditEvents, profiles, tabSessions, workers } from '@browshare/database/schema'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { Value } from 'typebox/value'
import type { WorkerControlLifecyclePort } from './workers.js'

const LIMIT = 200
const section = <T>(rows: T[]) => ({ items: rows.slice(0, LIMIT), truncated: rows.length > LIMIT })
const publicId = (value: unknown) => (typeof value === 'string' && isPublicId(value) ? value : null)
// Runtime facts have a small machine-code vocabulary beyond the REST error envelope.
const runtimeFailureCodes = new Set([
  'PROFILE_CHROME_EXITED',
  'PROFILE_DATA_MISSING',
  'REMOTE_TAB_FAILED',
  'WORKER_STATE_MISSING_AFTER_RECONNECT',
])
const errorCode = (value: string | null) =>
  value === null
    ? null
    : Value.Check(ApiErrorCodeSchema, value) || runtimeFailureCodes.has(value)
      ? value
      : 'UNCLASSIFIED_ERROR'
const version = (value: unknown) =>
  typeof value === 'string' && /^[0-9]+(?:\.[0-9]+){1,3}$/.test(value) ? value : null

/** Select a fixed support snapshot, never serialize business objects, logs or audit payloads. */
export class DiagnosticBundleService {
  constructor(
    private readonly connection: DatabaseConnection,
    private readonly control: Pick<WorkerControlLifecyclePort, 'getWorkerControlStatus'>,
  ) {}
  async collect(
    query: DiagnosticBundleQuery,
    context: { actorUserId: string; requestId: string },
  ): Promise<DiagnosticBundle> {
    const startedAt = new Date().toISOString()
    const sessionRows = await this.connection.db
      .select({
        id: tabSessions.id,
        profileId: tabSessions.profileId,
        workerId: tabSessions.workerId,
        gatewayId: tabSessions.gatewayId,
        runtimeId: tabSessions.runtimeId,
        workerInstanceId: tabSessions.workerInstanceId,
        profileGeneration: tabSessions.profileGeneration,
        viewerGeneration: tabSessions.viewerGeneration,
        kind: tabSessions.kind,
        status: tabSessions.status,
        pageScriptVersionId: tabSessions.pageScriptVersionId,
        navigationPolicyVersionId: tabSessions.navigationPolicyVersionId,
        createdAt: tabSessions.createdAt,
        updatedAt: tabSessions.updatedAt,
        closedAt: tabSessions.closedAt,
        failureCode: tabSessions.failureCode,
      })
      .from(tabSessions)
      .where(query.sessionId ? eq(tabSessions.id, query.sessionId) : undefined)
      .orderBy(desc(tabSessions.updatedAt), desc(tabSessions.id))
      .limit(LIMIT + 1)
    if (query.sessionId && !sessionRows[0])
      throw new BrowShareError({
        code: 'NOT_FOUND',
        statusCode: 404,
        message: 'Session does not exist.',
      })
    const scoped = query.sessionId ? sessionRows[0] : undefined
    const [workerRows, profileRows, auditRows] = await Promise.all([
      this.connection.db
        .select({
          id: workers.id,
          status: workers.status,
          lastSeenAt: workers.lastSeenAt,
          lastSnapshotAt: workers.lastSnapshotAt,
          versions: workers.versions,
          capabilities: workers.capabilities,
          metrics: workers.metricsSnapshot,
        })
        .from(workers)
        .where(scoped ? eq(workers.id, scoped.workerId) : isNull(workers.deletedAt))
        .orderBy(desc(workers.updatedAt), desc(workers.id))
        .limit(LIMIT + 1),
      this.connection.db
        .select({
          id: profiles.id,
          workerId: profiles.workerId,
          runtimeId: profiles.runtimeId,
          workerInstanceId: profiles.runtimeWorkerInstanceId,
          generation: profiles.runtimeGeneration,
          state: profiles.runtimeState,
          observedAt: profiles.runtimeObservedAt,
          errorCode: profiles.runtimeErrorCode,
        })
        .from(profiles)
        .where(scoped ? eq(profiles.id, scoped.profileId) : isNull(profiles.deletedAt))
        .orderBy(desc(profiles.updatedAt), desc(profiles.id))
        .limit(LIMIT + 1),
      this.connection.db
        .select({
          id: auditEvents.id,
          action: auditEvents.action,
          targetType: auditEvents.targetType,
          targetId: auditEvents.targetId,
          result: auditEvents.result,
          requestId: auditEvents.requestId,
          commandId: sql<unknown>`${auditEvents.metadata}->>'commandId'`,
          occurredAt: auditEvents.occurredAt,
        })
        .from(auditEvents)
        .where(
          scoped
            ? and(eq(auditEvents.targetType, 'session'), eq(auditEvents.targetId, scoped.id))
            : undefined,
        )
        .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
        .limit(LIMIT + 1),
    ])
    const bundle: DiagnosticBundle = {
      format: 'browshare.diagnostics.v1',
      requestId: context.requestId,
      startedAt,
      completedAt: new Date().toISOString(),
      scope: { sessionId: query.sessionId ?? null },
      backend: {
        version: BROWSHARE_VERSION,
        node: process.versions.node,
        controlProtocol: `${WORKER_CONTROL_PROTOCOL_MAJOR}.${WORKER_CONTROL_PROTOCOL_MINOR}`,
        uptimeSeconds: process.uptime(),
      },
      workers: section(
        workerRows.map((row) => {
          const control = this.control.getWorkerControlStatus(row.id)
          const report = Value.Check(WorkerCapabilityReportSchema, row.capabilities)
            ? row.capabilities
            : null
          return {
            id: row.id,
            status: row.status,
            lastSeenAt: row.lastSeenAt,
            lastSnapshotAt: row.lastSnapshotAt,
            connected: control.connected,
            ready: control.ready,
            recoveryReady: control.recoveryReady,
            instanceId: control.instanceId,
            protocolMinor: control.protocolMinor,
            versions: {
              worker: version(row.versions.worker),
              controlProtocol: version(row.versions.controlProtocol),
              node: version(row.versions.node),
              chrome: version(row.versions.chrome),
              remoteTabCore: version(row.versions.remoteTabCore),
              extension: version(row.versions.extension),
            },
            probe: report
              ? {
                  status: report.status,
                  completedAt: report.completedAt,
                  checks: report.checks.map(({ name, status }) => ({ name, status })),
                }
              : null,
            metrics: Value.Check(WorkerMetricsSnapshotResponseSchema, row.metrics)
              ? row.metrics
              : null,
          }
        }),
      ),
      profiles: section(
        profileRows.map((row) => ({ ...row, errorCode: errorCode(row.errorCode) })),
      ),
      sessions: section(
        sessionRows.map((row) => ({ ...row, failureCode: errorCode(row.failureCode) })),
      ),
      audit: section(
        auditRows.map((row) => ({
          ...row,
          targetId: publicId(row.targetId),
          requestId: publicId(row.requestId),
          commandId: publicId(row.commandId),
        })),
      ),
    }
    await this.connection.db.insert(auditEvents).values({
      id: createPublicId(),
      actorUserId: context.actorUserId,
      requestId: context.requestId,
      action: 'system.diagnostics.generate',
      targetType: 'diagnostic_bundle',
      targetId: context.requestId,
      result: 'SUCCEEDED',
      changes: {},
      metadata: { sessionId: query.sessionId ?? null, format: bundle.format },
    })
    return bundle
  }
}
