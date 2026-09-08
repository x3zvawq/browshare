import {
  WorkerRuntimeSnapshotSchema,
  type ProfileRuntimeRecovery,
  type WorkerRuntimeSnapshot,
} from '@browshare/contracts'
import type { profiles } from '@browshare/database/schema'
import { Value } from 'typebox/value'
import type { WorkerControlStatus } from './workers.js'

export function readWorkerRuntimeSnapshot(value: unknown): WorkerRuntimeSnapshot | null {
  return Value.Check(WorkerRuntimeSnapshotSchema, value) ? value : null
}

/** Recovery targets the authenticated connection's observed original Runtime only. */
export function profileRuntimeRecovery(
  profile: Pick<
    typeof profiles.$inferSelect,
    | 'id'
    | 'deletedAt'
    | 'runtimeState'
    | 'runtimeId'
    | 'runtimeGeneration'
    | 'runtimeWorkerInstanceId'
  >,
  worker: { status: string; deletedAt: string | null; runtimeSnapshot: unknown } | undefined,
  control: WorkerControlStatus,
): ProfileRuntimeRecovery {
  const blocked = (
    blockedReason: ProfileRuntimeRecovery['blockedReason'],
  ): ProfileRuntimeRecovery => ({ canRecover: false, blockedReason })
  if (profile.deletedAt !== null || profile.runtimeState === 'STOPPED')
    return blocked('RUNTIME_STOPPED')
  if (!worker || worker.deletedAt !== null || worker.status === 'DISABLED' || !control.connected)
    return blocked('WORKER_UNAVAILABLE')
  if ((control.protocolMinor ?? 0) < 20) return blocked('WORKER_PROTOCOL_INCOMPATIBLE')
  const snapshot = readWorkerRuntimeSnapshot(worker.runtimeSnapshot)
  if (
    !control.recoveryReady ||
    !snapshot ||
    snapshot.instanceId !== control.instanceId ||
    snapshot.instanceId !== profile.runtimeWorkerInstanceId ||
    !snapshot.profiles.some(
      (fact) =>
        fact.profileId === profile.id &&
        fact.runtimeId === profile.runtimeId &&
        fact.generation === profile.runtimeGeneration,
    )
  )
    return blocked('RUNTIME_UNOBSERVED')
  return { canRecover: true, blockedReason: null }
}
