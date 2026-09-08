import { computed, onScopeDispose, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/api/client.js'
import { apiFailure, networkFailure, type ApiFailure } from '@/api/errors.js'
import type { MaintenanceProfile, TabSession } from '@/api/types.js'

export function useMaintenanceStart(
  input: { profileId: string; pageScriptVersionId?: string | undefined },
  onCreated: (session: TabSession) => void,
) {
  const { t } = useI18n()
  const profile = shallowRef<MaintenanceProfile | null>(null)
  const url = shallowRef(''),
    busy = shallowRef(false),
    loading = shallowRef(false)
  const validation = shallowRef(''),
    error = shallowRef<ApiFailure | null>(null)
  const contextError = shallowRef<ApiFailure | null>(null)
  const controller = new AbortController()
  const canStart = computed(
    () =>
      !!profile.value &&
      !profile.value.blockedReason &&
      !profile.value.storageBlockedReason &&
      !contextError.value &&
      !loading.value &&
      !busy.value,
  )
  async function refresh() {
    if (loading.value) return
    loading.value = true
    try {
      const result = await api.GET('/profiles/{id}/maintenance', {
        params: { path: { id: input.profileId } },
        signal: controller.signal,
      })
      if (!result.data) throw apiFailure(result.error, result.response)
      profile.value = result.data
      contextError.value = null
    } catch (cause) {
      if (!controller.signal.aborted) contextError.value = networkFailure(cause)
    } finally {
      loading.value = false
    }
  }
  async function create() {
    if (!canStart.value) return
    validation.value = ''
    let parsed: URL
    try {
      parsed = new URL(url.value.trim())
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
        throw new Error()
    } catch {
      validation.value = t('workspace.invalidUrl')
      return
    }
    busy.value = true
    error.value = null
    try {
      const result = await api.POST('/profiles/{id}/maintenance', {
        params: { path: { id: input.profileId } },
        body: {
          initialUrl: parsed.href,
          ...(input.pageScriptVersionId ? { pageScriptVersionId: input.pageScriptVersionId } : {}),
        },
        signal: controller.signal,
      })
      if (!result.data) throw apiFailure(result.error, result.response)
      if (!controller.signal.aborted) onCreated(result.data)
    } catch (cause) {
      if (!controller.signal.aborted) {
        error.value = networkFailure(cause)
        // A lost response may still have created a Session. Show its actual ownership before retrying.
        await refresh()
      }
    } finally {
      busy.value = false
    }
  }
  void refresh()
  onScopeDispose(() => controller.abort())
  return { profile, url, busy, loading, validation, error, contextError, canStart, refresh, create }
}
