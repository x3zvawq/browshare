import type {
  WorkerProfileRuntimeCommandMessage,
  WorkerProfileRuntimeFact,
} from '@browshare/contracts'

import type { StartProfileRuntimeInput } from './remote-tab-runtime.js'
import { ProfileChromeError } from './profile-chrome.js'

export interface ProfileRuntimeCommandPort {
  startProfileRuntime(input: StartProfileRuntimeInput): Promise<unknown>
  stopProfileRuntime(profileId: string, reason?: string): Promise<void>
  deleteProfileRuntime(profileId: string): Promise<void>
  readRuntimeFacts(): Promise<{ profiles: WorkerProfileRuntimeFact[] }>
}

/** Fences stopped generations for the lifetime of this Worker process. */
export class ProfileRuntimeCommands {
  readonly #stoppedGenerations = new Map<string, number>()

  constructor(private readonly runtime: ProfileRuntimeCommandPort) {}

  async execute(
    command: WorkerProfileRuntimeCommandMessage,
  ): Promise<WorkerProfileRuntimeFact | null> {
    const { payload } = command
    const current = (await this.runtime.readRuntimeFacts()).profiles.find(
      (fact) => fact.profileId === payload.profileId,
    )
    const stopped = this.#stoppedGenerations.get(payload.profileId) ?? 0
    if (payload.action !== 'START') {
      if (current !== undefined && current.generation !== payload.generation)
        throw new ProfileChromeError(
          'PROFILE_GENERATION_MISMATCH',
          'The stop command targets another Profile generation',
        )
      if (payload.generation < stopped)
        throw new ProfileChromeError(
          'PROFILE_GENERATION_MISMATCH',
          'The stop command targets an older Profile generation',
        )
      // Record intent before awaiting cleanup so a delayed START cannot resurrect this generation.
      this.#stoppedGenerations.set(payload.profileId, payload.generation)
      if (payload.action === 'DELETE') {
        await this.runtime.deleteProfileRuntime(payload.profileId)
        return null
      }
      await this.runtime.stopProfileRuntime(
        payload.profileId,
        'Control Backend requested Profile stop',
      )
      return null
    }
    if (payload.requireExistingData === undefined)
      throw new ProfileChromeError(
        'WORKER_PROTOCOL_INCOMPATIBLE',
        'Profile startup requires the Control 1.21 persistent data contract',
      )
    if (payload.generation <= stopped)
      throw new ProfileChromeError(
        'PROFILE_GENERATION_STOPPED',
        'This Profile generation has already been stopped',
      )
    if (current !== undefined) {
      if (current.state === 'ERROR' && current.generation < payload.generation) {
        await this.runtime.stopProfileRuntime(
          payload.profileId,
          'Control Backend is replacing a failed Runtime',
        )
      } else if (
        current.generation !== payload.generation ||
        current.runtimeId !== command.messageId
      ) {
        throw new ProfileChromeError(
          'PROFILE_GENERATION_MISMATCH',
          'Stop the current Runtime before starting another generation',
        )
      }
    }
    await this.runtime.startProfileRuntime({
      profileId: payload.profileId,
      requireExistingData: payload.requireExistingData,
      runtimeId: command.messageId,
      generation: payload.generation,
      ...(payload.workerStoragePolicy === undefined
        ? {}
        : { workerStoragePolicy: payload.workerStoragePolicy }),
      ...(payload.profileStoragePolicy === undefined
        ? {}
        : { profileStoragePolicy: payload.profileStoragePolicy }),
      ...(payload.routeVersion === undefined ? {} : { routeVersion: payload.routeVersion }),
      proxy: payload.proxy,
      healthcheckUrl: payload.healthcheckUrl,
    })
    const fact = (await this.runtime.readRuntimeFacts()).profiles.find(
      (fact) => fact.profileId === payload.profileId,
    )
    if (
      fact?.runtimeId !== command.messageId ||
      fact.generation !== payload.generation ||
      fact.state !== 'RUNNING'
    )
      throw new ProfileChromeError(
        'PROFILE_RUNTIME_FAILED',
        'The Profile did not reach its requested running generation',
      )
    return fact
  }
}
