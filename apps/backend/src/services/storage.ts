import { BrowShareError } from '@browshare/common'
import type {
  ProfileStorageUsage,
  StorageBlockReason,
  WorkerStorageFact,
} from '@browshare/contracts'
import { profiles } from '@browshare/database/schema'
import { sql } from 'drizzle-orm'

type QuotaRecord = { storageQuotaBytes: number | null; storagePolicyVersion: number }
export function storageBlockReason(
  worker: QuotaRecord & { storageSnapshot: WorkerStorageFact | null },
  profile?: QuotaRecord & { storageUsage: ProfileStorageUsage | null },
): StorageBlockReason | null {
  const fact = worker.storageSnapshot
  if (worker.storageQuotaBytes === 0) return 'WORKER_STORAGE_QUOTA_EXCEEDED'
  if (profile?.storageQuotaBytes === 0) return 'PROFILE_STORAGE_QUOTA_EXCEEDED'
  if (fact?.diskState === 'CRITICAL_DISK' || fact?.diskState === 'LOW_DISK') return fact.diskState
  if (fact && (fact.diskState === 'UNKNOWN' || fact.quotaState === 'UNKNOWN'))
    return 'STORAGE_UNAVAILABLE'
  if (fact?.appliedPolicyVersion === worker.storagePolicyVersion && fact.quotaState === 'EXCEEDED')
    return 'WORKER_STORAGE_QUOTA_EXCEEDED'
  if (
    profile &&
    profile.storageUsage &&
    profile.storageUsage.appliedPolicyVersion === profile.storagePolicyVersion
  ) {
    if (profile.storageUsage.quotaState === 'EXCEEDED') return 'PROFILE_STORAGE_QUOTA_EXCEEDED'
    if (profile.storageUsage.quotaState === 'UNKNOWN') return 'STORAGE_UNAVAILABLE'
  }
  return null
}
export function assertStorageAdmission(
  worker: Parameters<typeof storageBlockReason>[0],
  profile?: Parameters<typeof storageBlockReason>[1],
): void {
  const reason = storageBlockReason(worker, profile)
  if (reason)
    throw new BrowShareError({
      code: reason,
      statusCode: 409,
      message: 'Storage protection currently blocks new Runtime and Session creation.',
    })
}
const workerFact = sql`(select storage_snapshot from workers where id=${profiles.workerId})`
const workerQuota = sql`(select storage_quota_bytes from workers where id=${profiles.workerId})`
const workerVersion = sql`(select storage_policy_version from workers where id=${profiles.workerId})`
export const profileStorageColumns = {
  storageQuotaBytes: profiles.storageQuotaBytes,
  storagePolicyVersion: profiles.storagePolicyVersion,
  storageUsage: profiles.storageUsage,
  storagePolicyPending: sql<boolean>`coalesce((${profiles.storageUsage}->>'appliedPolicyVersion')::integer <> ${profiles.storagePolicyVersion}, true)`,
  storageBlockedReason: sql<StorageBlockReason | null>`case
    when ${workerQuota}=0 then 'WORKER_STORAGE_QUOTA_EXCEEDED'
    when ${profiles.storageQuotaBytes}=0 then 'PROFILE_STORAGE_QUOTA_EXCEEDED'
    when ${workerFact}->>'diskState' in ('LOW_DISK','CRITICAL_DISK') then ${workerFact}->>'diskState'
    when ${workerFact}->>'diskState'='UNKNOWN' or ${workerFact}->>'quotaState'='UNKNOWN' then 'STORAGE_UNAVAILABLE'
    when (${workerFact}->>'appliedPolicyVersion')::integer=${workerVersion} and ${workerFact}->>'quotaState'='EXCEEDED' then 'WORKER_STORAGE_QUOTA_EXCEEDED'
    when (${profiles.storageUsage}->>'appliedPolicyVersion')::integer=${profiles.storagePolicyVersion} and ${profiles.storageUsage}->>'quotaState'='EXCEEDED' then 'PROFILE_STORAGE_QUOTA_EXCEEDED'
    when (${profiles.storageUsage}->>'appliedPolicyVersion')::integer=${profiles.storagePolicyVersion} and ${profiles.storageUsage}->>'quotaState'='UNKNOWN' then 'STORAGE_UNAVAILABLE'
    else null end`,
}
export function profileStorageSummary(row: {
  storageQuotaBytes: number | null
  storagePolicyVersion: number
  storageUsage: ProfileStorageUsage | null
  storagePolicyPending: boolean
  storageBlockedReason: StorageBlockReason | null
}) {
  return {
    storageQuotaBytes: row.storageQuotaBytes,
    storagePolicyVersion: row.storagePolicyVersion,
    storageUsage: row.storageUsage,
    storagePolicyPending: row.storagePolicyPending,
    storageBlockedReason: row.storageBlockedReason,
  }
}
