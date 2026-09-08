import type { DatabaseConnection } from '@browshare/database'
import { profiles, workers } from '@browshare/database/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type {
  ProfileStorageUsage,
  WorkerStorageFact,
  WorkerStoragePolicyCommandMessage,
  WorkerStoragePolicyResultMessage,
} from '@browshare/contracts'

/** Desired quotas live in rows. Commands apply them; later bounded observations replay any missed update. */
export class StorageControlService {
  readonly #pending = new Map<string, Promise<void>>()
  #unlisten: (() => Promise<void>) | undefined
  constructor(
    private readonly connection: DatabaseConnection,
    private readonly send: (
      workerId: string,
      policy: Pick<WorkerStoragePolicyCommandMessage['payload'], 'workerPolicy' | 'profilePolicy'>,
    ) => Promise<WorkerStoragePolicyResultMessage>,
    private readonly failed: () => void,
  ) {}

  async start() {
    const listener = await this.connection.client.listen(
      'browshare_storage_policy_changed',
      (payload) => {
        const scope = JSON.parse(payload) as { workerId: string; profileId?: string }
        this.schedule(scope.workerId, scope.profileId)
      },
    )
    this.#unlisten = listener.unlisten
  }
  async close() {
    await this.#unlisten?.()
    await Promise.allSettled(this.#pending.values())
  }
  schedule(workerId: string, profileId?: string) {
    const key = workerId + ':' + (profileId ?? '')
    if (this.#pending.has(key)) return
    const pending = this.synchronize(workerId, profileId)
      .catch(this.failed)
      .finally(() => this.#pending.delete(key))
    this.#pending.set(key, pending)
  }
  private async synchronize(workerId: string, profileId?: string) {
    const [worker] = await this.connection.db
      .select()
      .from(workers)
      .where(and(eq(workers.id, workerId), isNull(workers.deletedAt)))
    if (!worker) return
    const [profile] =
      profileId === undefined
        ? []
        : await this.connection.db
            .select()
            .from(profiles)
            .where(
              and(
                eq(profiles.id, profileId),
                eq(profiles.workerId, workerId),
                isNull(profiles.deletedAt),
              ),
            )
    if (profileId !== undefined && (!profile || profile.storageUsage === null)) return
    const result = await this.send(workerId, {
      workerPolicy: { version: worker.storagePolicyVersion, quotaBytes: worker.storageQuotaBytes },
      ...(profile
        ? {
            profilePolicy: {
              profileId: profile.id,
              version: profile.storagePolicyVersion,
              quotaBytes: profile.storageQuotaBytes,
            },
          }
        : {}),
    })
    await this.observe(
      workerId,
      result.payload.storage,
      result.payload.profileUsage ? [result.payload.profileUsage] : [],
    )
  }
  async observe(workerId: string, fact: WorkerStorageFact, usages: readonly ProfileStorageUsage[]) {
    validateStorageObservation(fact)
    for (const usage of usages) validateQuotaObservation(usage)
    const [worker] = await this.connection.db.select().from(workers).where(eq(workers.id, workerId))
    if (!worker) throw new Error('Storage observation Worker missing')
    if (
      fact.appliedPolicyVersion > worker.storagePolicyVersion ||
      (fact.appliedPolicyVersion === worker.storagePolicyVersion &&
        fact.quotaBytes !== worker.storageQuotaBytes)
    )
      throw new Error('Storage observation does not match Worker quota policy')
    if (
      !worker.storageSnapshot ||
      Date.parse(fact.observedAt) >= Date.parse(worker.storageSnapshot.observedAt)
    )
      await this.connection.db
        .update(workers)
        .set({ storageSnapshot: fact })
        .where(
          and(
            eq(workers.id, workerId),
            sql`(${workers.storageSnapshot} is null or ((${workers.storageSnapshot}->>'observedAt')::timestamptz <= ${fact.observedAt}::timestamptz and (${workers.storageSnapshot}->>'appliedPolicyVersion')::integer <= ${fact.appliedPolicyVersion}))`,
          ),
        )
    if (fact.appliedPolicyVersion !== worker.storagePolicyVersion) this.schedule(workerId)
    for (const usage of usages) {
      const [profile] = await this.connection.db
        .select()
        .from(profiles)
        .where(
          and(
            eq(profiles.id, usage.profileId),
            eq(profiles.workerId, workerId),
            isNull(profiles.deletedAt),
          ),
        )
      if (!profile) continue // Deletion can finish while a bounded directory observation is in flight.
      if (
        usage.appliedPolicyVersion > profile.storagePolicyVersion ||
        (usage.appliedPolicyVersion === profile.storagePolicyVersion &&
          usage.quotaBytes !== profile.storageQuotaBytes)
      )
        throw new Error('Storage observation does not match Profile quota policy')
      await this.connection.db
        .update(profiles)
        .set({ storageUsage: usage })
        .where(
          and(
            eq(profiles.id, profile.id),
            sql`(${profiles.storageUsage} is null or ((${profiles.storageUsage}->>'observedAt')::timestamptz <= ${usage.observedAt}::timestamptz and (${profiles.storageUsage}->>'appliedPolicyVersion')::integer <= ${usage.appliedPolicyVersion}))`,
          ),
        )
      if (usage.appliedPolicyVersion !== profile.storagePolicyVersion)
        this.schedule(workerId, profile.id)
    }
  }
}

function validateQuotaObservation(
  fact: Pick<ProfileStorageUsage, 'usedBytes' | 'quotaBytes' | 'quotaState'>,
): void {
  const expected =
    fact.usedBytes === null
      ? 'UNKNOWN'
      : fact.quotaBytes !== null && fact.usedBytes >= fact.quotaBytes
        ? 'EXCEEDED'
        : 'OK'
  if (fact.quotaState !== expected) throw new Error('Storage quota observation is inconsistent')
}
function validateStorageObservation(fact: WorkerStorageFact): void {
  validateQuotaObservation(fact)
  if (
    fact.thresholds.criticalBytes > fact.thresholds.lowBytes ||
    fact.thresholds.criticalRatio > fact.thresholds.lowRatio
  )
    throw new Error('Storage threshold order is invalid')
  if (new Set(fact.volumes.map((volume) => volume.purpose)).size !== fact.volumes.length)
    throw new Error('Storage volume purposes are duplicated')
  for (const volume of fact.volumes) {
    if (volume.diskState === 'UNKNOWN') continue
    if (
      volume.totalBytes === null ||
      volume.availableBytes === null ||
      volume.availableBytes > volume.totalBytes ||
      volume.lowThresholdBytes === null ||
      volume.criticalThresholdBytes === null ||
      volume.criticalThresholdBytes > volume.lowThresholdBytes
    )
      throw new Error('Storage volume observation is inconsistent')
    if (
      (volume.totalInodes === null) !== (volume.availableInodes === null) ||
      (volume.totalInodes !== null &&
        volume.availableInodes !== null &&
        volume.availableInodes > volume.totalInodes)
    )
      throw new Error('Storage inode observation is inconsistent')
    const expected =
      volume.availableInodes === 0 || volume.availableBytes < volume.criticalThresholdBytes
        ? 'CRITICAL_DISK'
        : volume.availableBytes < volume.lowThresholdBytes
          ? 'LOW_DISK'
          : 'OK'
    if (volume.diskState !== expected) throw new Error('Storage disk state is inconsistent')
  }
  const states = fact.volumes.map((volume) => volume.diskState)
  const expected =
    states.length !== 2 || states.includes('UNKNOWN')
      ? 'UNKNOWN'
      : states.includes('CRITICAL_DISK')
        ? 'CRITICAL_DISK'
        : states.includes('LOW_DISK')
          ? 'LOW_DISK'
          : 'OK'
  if (fact.diskState !== expected) throw new Error('Aggregate storage disk state is inconsistent')
}
