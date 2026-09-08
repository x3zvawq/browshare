import { computed, onMounted, onScopeDispose, shallowRef } from 'vue'
import { api } from '@/api/client.js'
import { apiFailure, networkFailure, type ApiFailure } from '@/api/errors.js'
import type { AdminOverview } from '@/api/types.js'
import { useInvalidationEvents } from './useInvalidationEvents.js'

export function useAdminOverview() {
  const data = shallowRef<AdminOverview | null>(null)
  const error = shallowRef<ApiFailure | null>(null)
  const loading = shallowRef(false)
  const lastReadAt = shallowRef<number | null>(null)
  const controller = new AbortController()

  async function load(): Promise<void> {
    if (loading.value || controller.signal.aborted) return
    loading.value = true
    try {
      const result = await api.GET('/admin/overview', {
        signal: controller.signal,
        cache: 'no-store',
      })
      if (!result.data) throw apiFailure(result.error, result.response)
      if (controller.signal.aborted) return
      // Null sections are authoritative permission results, including grants revoked since login.
      data.value = result.data
      error.value = null
      lastReadAt.value = Date.now()
    } catch (cause) {
      if (controller.signal.aborted) return
      error.value = networkFailure(cause)
      if (error.value.status === 401 || error.value.status === 403) {
        data.value = null
        lastReadAt.value = null
      }
    } finally {
      loading.value = false
    }
  }

  const events = useInvalidationEvents('/api/v1/workspace/events', {
    refresh: load,
    isFetching: () => loading.value,
  })
  onMounted(() => void load())
  onScopeDispose(() => controller.abort())

  return {
    data,
    error,
    loading,
    lastReadAt,
    initialLoading: computed(() => loading.value && data.value === null),
    liveState: events.state,
    refresh: events.refresh,
  }
}
