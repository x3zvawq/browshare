import { computed, onScopeDispose, shallowRef } from 'vue'
import { api } from '@/api/client.js'
import { apiFailure, networkFailure, type ApiFailure } from '@/api/errors.js'
import type { ManagedWorker } from '@/api/types.js'

export function useProbeWorkers() {
  const workers = shallowRef<ManagedWorker[]>([])
  const loading = shallowRef(false)
  const error = shallowRef<ApiFailure | null>(null)
  let controller: AbortController | undefined
  const eligible = computed(() =>
    workers.value.filter(
      (worker) => worker.state === 'ONLINE' && worker.controlConnected && worker.controlReady,
    ),
  )
  async function refresh() {
    controller?.abort()
    const current = new AbortController()
    controller = current
    loading.value = true
    error.value = null
    try {
      const items: ManagedWorker[] = []
      let cursor: string | undefined
      do {
        const result = await api.GET('/workers', {
          params: { query: { state: 'ONLINE', limit: 200, ...(cursor ? { cursor } : {}) } },
          signal: current.signal,
        })
        if (!result.data) throw apiFailure(result.error, result.response)
        if (current.signal.aborted) return
        items.push(...result.data.items)
        cursor = result.data.meta.nextCursor ?? undefined
      } while (cursor)
      workers.value = items
    } catch (cause) {
      if (!current.signal.aborted) error.value = networkFailure(cause)
    } finally {
      if (controller === current) loading.value = false
    }
  }
  void refresh()
  onScopeDispose(() => controller?.abort())
  return { workers, eligible, loading, error, refresh }
}
