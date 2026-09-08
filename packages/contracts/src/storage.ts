import Type from 'typebox'

export const StorageByteCountSchema = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
export const StorageQuotaBytesSchema = Type.Union([StorageByteCountSchema, Type.Null()])
export const StoragePolicySchema = Type.Object(
  {
    version: Type.Integer({ minimum: 1 }),
    quotaBytes: StorageQuotaBytesSchema,
  },
  { additionalProperties: false },
)
export type StoragePolicy = Type.Static<typeof StoragePolicySchema>
export const ProfileStoragePolicySchema = Type.Object(
  {
    ...StoragePolicySchema.properties,
    profileId: Type.String({ format: 'uuid' }),
  },
  { additionalProperties: false },
)
export type ProfileStoragePolicy = Type.Static<typeof ProfileStoragePolicySchema>
export const StorageDiskStateSchema = Type.Enum([
  'OK',
  'LOW_DISK',
  'CRITICAL_DISK',
  'UNKNOWN',
] as const)
export const StorageQuotaStateSchema = Type.Enum(['OK', 'EXCEEDED', 'UNKNOWN'] as const)
export const StorageBlockReasonSchema = Type.Enum([
  'LOW_DISK',
  'CRITICAL_DISK',
  'WORKER_STORAGE_QUOTA_EXCEEDED',
  'PROFILE_STORAGE_QUOTA_EXCEEDED',
  'STORAGE_UNAVAILABLE',
  'STORAGE_POLICY_STALE',
] as const)
export type StorageBlockReason = Type.Static<typeof StorageBlockReasonSchema>
export const StorageThresholdsSchema = Type.Object(
  {
    lowBytes: StorageByteCountSchema,
    lowRatio: Type.Number({ minimum: 0, maximum: 1 }),
    criticalBytes: StorageByteCountSchema,
    criticalRatio: Type.Number({ minimum: 0, maximum: 1 }),
  },
  { additionalProperties: false },
)
export type StorageThresholds = Type.Static<typeof StorageThresholdsSchema>
export const StorageVolumeFactSchema = Type.Object(
  {
    purpose: Type.Enum(['profiles', 'temporary'] as const),
    totalBytes: StorageQuotaBytesSchema,
    availableBytes: StorageQuotaBytesSchema,
    totalInodes: StorageQuotaBytesSchema,
    availableInodes: StorageQuotaBytesSchema,
    lowThresholdBytes: StorageQuotaBytesSchema,
    criticalThresholdBytes: StorageQuotaBytesSchema,
    diskState: StorageDiskStateSchema,
  },
  { additionalProperties: false },
)
export type StorageVolumeFact = Type.Static<typeof StorageVolumeFactSchema>
export const WorkerStorageFactSchema = Type.Object(
  {
    observedAt: Type.String({ format: 'date-time' }),
    usedBytes: StorageQuotaBytesSchema,
    appliedPolicyVersion: Type.Integer({ minimum: 1 }),
    quotaBytes: StorageQuotaBytesSchema,
    diskState: StorageDiskStateSchema,
    quotaState: StorageQuotaStateSchema,
    thresholds: StorageThresholdsSchema,
    volumes: Type.Array(StorageVolumeFactSchema, { minItems: 1, maxItems: 2 }),
  },
  { additionalProperties: false },
)
export type WorkerStorageFact = Type.Static<typeof WorkerStorageFactSchema>
export const ProfileStorageUsageSchema = Type.Object(
  {
    profileId: Type.String({ format: 'uuid' }),
    observedAt: Type.String({ format: 'date-time' }),
    usedBytes: StorageQuotaBytesSchema,
    appliedPolicyVersion: Type.Integer({ minimum: 1 }),
    quotaBytes: StorageQuotaBytesSchema,
    quotaState: StorageQuotaStateSchema,
  },
  { additionalProperties: false },
)
export type ProfileStorageUsage = Type.Static<typeof ProfileStorageUsageSchema>
export const ProfileStorageSummaryProperties = {
  storageQuotaBytes: StorageQuotaBytesSchema,
  storagePolicyVersion: Type.Integer({ minimum: 1 }),
  storageUsage: Type.Union([ProfileStorageUsageSchema, Type.Null()]),
  storagePolicyPending: Type.Boolean(),
  storageBlockedReason: Type.Union([StorageBlockReasonSchema, Type.Null()]),
}
export function isStorageBlockReason(value: unknown): value is StorageBlockReason {
  return [
    'LOW_DISK',
    'CRITICAL_DISK',
    'WORKER_STORAGE_QUOTA_EXCEEDED',
    'PROFILE_STORAGE_QUOTA_EXCEEDED',
    'STORAGE_UNAVAILABLE',
    'STORAGE_POLICY_STALE',
  ].includes(value as string)
}
