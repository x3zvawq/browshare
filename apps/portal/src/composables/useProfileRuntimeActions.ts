import { shallowReadonly, shallowRef } from 'vue'
import { useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { api } from '@/api/client.js'
import { apiFailure, networkFailure, type ApiFailure } from '@/api/errors.js'
import type { Profile } from '@/api/types.js'

export function useProfileRuntimeActions(refresh: () => Promise<void>) {
  const pending = shallowRef<ReadonlySet<string>>(new Set())
  const stopProfile = shallowRef<Profile | null>(null)
  const closeSessions = shallowRef(false)
  const stopError = shallowRef<ApiFailure | null>(null)
  const message = useMessage()
  const { t } = useI18n()

  async function execute(
    profile: Profile,
    action: 'START' | 'STOP',
    endSessions = false,
  ): Promise<boolean> {
    if (pending.value.has(profile.id)) return false
    pending.value = new Set([...pending.value, profile.id])
    try {
      const { data, error, response } = await api.PUT('/profiles/{profileId}/runtime', {
        params: { path: { profileId: profile.id } },
        body: endSessions ? { action: 'STOP', closeSessions: true } : { action },
      })
      if (data === undefined) throw apiFailure(error, response)
      message.success(t('profiles.runtime.accepted', { name: profile.name }))
      await refresh()
      return true
    } catch (cause) {
      if (action === 'STOP') stopError.value = networkFailure(cause)
      else {
        const failure = networkFailure(cause)
        message.error(
          `${t('profiles.runtime.failed')} · ${failure.code}${failure.requestId ? ` · ${failure.requestId}` : ''}`,
        )
      }
      return false
    } finally {
      const remaining = new Set(pending.value)
      remaining.delete(profile.id)
      pending.value = remaining
    }
  }

  function setRuntime(profile: Profile, action: 'START' | 'STOP'): void {
    if (pending.value.has(profile.id)) return
    if (action === 'START') {
      void execute(profile, action)
      return
    }
    stopError.value = null
    closeSessions.value = false
    stopProfile.value = profile
  }

  function recoverRuntime(profile: Profile): void {
    if (pending.value.has(profile.id) || !profile.runtimeRecovery.canRecover) return
    stopError.value = null
    closeSessions.value = true
    stopProfile.value = profile
  }

  function closeStop(): void {
    if (stopProfile.value && pending.value.has(stopProfile.value.id)) return
    stopProfile.value = null
    stopError.value = null
  }

  async function confirmStop(): Promise<void> {
    const profile = stopProfile.value
    if (!profile || pending.value.has(profile.id)) return
    stopError.value = null
    if (await execute(profile, 'STOP', closeSessions.value)) closeStop()
  }

  return {
    runtimePending: shallowReadonly(pending),
    stopProfile: shallowReadonly(stopProfile),
    closeSessions: shallowReadonly(closeSessions),
    stopError: shallowReadonly(stopError),
    setRuntime,
    recoverRuntime,
    closeStop,
    confirmStop,
  }
}
