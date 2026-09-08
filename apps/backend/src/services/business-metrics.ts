import type { DatabaseConnection } from '@browshare/database'
import {
  proxies,
  tabSessions,
  sessionKindEnum,
  sessionStatusEnum,
  proxyHealthStatusEnum,
} from '@browshare/database/schema'
import { count, isNull } from 'drizzle-orm'
import { AdminOverviewService } from './admin-overview.js'
import type { WorkerControlServer } from './worker-control-server.js'

/** No business IDs, names, addresses, credentials or page data enter metric labels. */
export class BusinessMetrics {
  #collection: Promise<string[]> | undefined
  constructor(
    private readonly connection: DatabaseConnection,
    private readonly control: WorkerControlServer,
  ) {}
  collect(): Promise<string[]> {
    this.#collection ??= this.#collect().finally(() => {
      this.#collection = undefined
    })
    return this.#collection
  }
  async #collect(): Promise<string[]> {
    const [overview, sessions, proxyStates] = await Promise.all([
      new AdminOverviewService(this.connection, this.control).get(['worker.read', 'profile.read']),
      this.connection.db
        .select({ kind: tabSessions.kind, state: tabSessions.status, count: count() })
        .from(tabSessions)
        .groupBy(tabSessions.kind, tabSessions.status),
      this.connection.db
        .select({ state: proxies.healthStatus, count: count() })
        .from(proxies)
        .where(isNull(proxies.deletedAt))
        .groupBy(proxies.healthStatus),
    ])
    const lines = this.control.getCommandMetrics()
    const gauge = (name: string, help: string, samples: { value: number; labels?: string }[]) => {
      lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`)
      for (const s of samples) lines.push(`${name}${s.labels ? `{${s.labels}}` : ''} ${s.value}`)
    }
    const workers = overview.workers!,
      profiles = overview.profiles!
    gauge(
      'browshare_business_observed_timestamp_seconds',
      'Completion time of the successful database and control-state scrape.',
      [{ value: Date.now() / 1000 }],
    )
    gauge(
      'browshare_workers',
      'Non-retired Workers by persisted state.',
      Object.entries(workers.states).map(([state, value]) => ({
        value,
        labels: `state="${state}"`,
      })),
    )
    gauge(
      'browshare_workers_connected',
      'Workers with a current authenticated control connection.',
      [{ value: workers.connectedWorkers }],
    )
    gauge('browshare_workers_ready', 'Workers with accepted capabilities and reconciliation.', [
      { value: workers.readyWorkers },
    ])
    gauge('browshare_workers_eligible', 'Workers currently eligible for scheduling.', [
      { value: workers.eligibleWorkers },
    ])
    gauge(
      'browshare_worker_capacity_available_tabs',
      'Available finite tab capacity on schedulable Workers.',
      [{ value: workers.capacity.schedulableAvailableTabs }],
    )
    gauge(
      'browshare_worker_capacity_unlimited_nodes',
      'Schedulable Workers without a finite tab cap.',
      [{ value: workers.capacity.schedulableUnlimitedWorkers }],
    )
    gauge(
      'browshare_sessions',
      'Persisted Sessions by kind and state; retention can decrease terminal rows.',
      sessionKindEnum.enumValues.flatMap((kind) =>
        sessionStatusEnum.enumValues.map((state) => ({
          value: sessions.find((s) => s.kind === kind && s.state === state)?.count ?? 0,
          labels: `kind="${kind}",state="${state}"`,
        })),
      ),
    )
    gauge(
      'browshare_proxies',
      'Non-deleted Proxies by latest explicit probe health.',
      proxyHealthStatusEnum.enumValues.map((state) => ({
        value: proxyStates.find((s) => s.state === state)?.count ?? 0,
        labels: `health="${state}"`,
      })),
    )
    gauge(
      'browshare_profile_runtimes_unhealthy',
      'Running or maintaining Profiles with unhealthy route observations.',
      [{ value: profiles.unhealthyRuntimes }],
    )
    gauge(
      'browshare_profile_runtimes_health_unknown',
      'Running or maintaining Profiles without route-health observations.',
      [{ value: profiles.unknownRuntimeHealth }],
    )
    gauge(
      'browshare_profiles_restart_required',
      'Profiles whose configured route differs from their running route.',
      [{ value: profiles.restartRequiredProfiles }],
    )
    gauge(
      'browshare_workers_storage_blocked',
      'Workers with storage blocks by category; categories may overlap.',
      Object.entries(workers.storage).map(([reason, value]) => ({
        value,
        labels: `reason="${reason}"`,
      })),
    )
    return lines
  }
}
