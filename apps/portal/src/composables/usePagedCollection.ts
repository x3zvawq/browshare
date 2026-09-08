import { computed, onScopeDispose, shallowRef, watch, type WatchSource } from 'vue'
import { networkFailure, type ApiFailure } from '@/api/errors.js'
import { useInvalidationEvents, type InvalidationEndpoint } from './useInvalidationEvents.js'

interface Page<T> {
  items: T[]
  meta: { nextCursor: string | null; hasMore: boolean }
}

/** Refresh the loaded pages together so live updates never invalidate the visible pagination. */
export function usePagedCollection<T>(
  source: WatchSource,
  fetchPage: (cursor: string | undefined, signal: AbortSignal) => Promise<Page<T>>,
  options: { events?: InvalidationEndpoint } = {},
) {
  const items = shallowRef<T[]>([]),
    error = shallowRef<ApiFailure | null>(null)
  const loading = shallowRef(false),
    nextCursor = shallowRef<string | null>(null)
  const lastReadAt = shallowRef<number | null>(null)
  let controller: AbortController | undefined,
    pages = 1
  async function load(more = false) {
    if (more && (loading.value || !nextCursor.value)) return
    controller?.abort()
    const current = new AbortController()
    controller = current
    loading.value = true
    try {
      const result: T[] = more ? [...items.value] : []
      let cursor = more ? (nextCursor.value ?? undefined) : undefined
      let next: string | null = null
      let loaded = 0
      for (let page = 0; page < (more ? 1 : pages); page++) {
        const data = await fetchPage(cursor, current.signal)
        if (current.signal.aborted) return
        result.push(...data.items)
        loaded++
        next = data.meta.nextCursor
        if (!data.meta.hasMore || next === null) break
        cursor = next
      }
      items.value = result
      nextCursor.value = next
      pages = more ? pages + 1 : loaded
      error.value = null
      lastReadAt.value = Date.now()
    } catch (cause) {
      if (!current.signal.aborted) {
        error.value = networkFailure(cause)
        if (error.value.status === 401 || error.value.status === 403) {
          items.value = []
          nextCursor.value = null
          lastReadAt.value = null
          pages = 1
        }
      }
    } finally {
      if (controller === current) loading.value = false
    }
  }
  watch(
    source,
    () => {
      pages = 1
      lastReadAt.value = null
      items.value = []
      nextCursor.value = null
      void load()
    },
    { immediate: true },
  )
  const events = options.events
    ? useInvalidationEvents(options.events, {
        refresh: () => load(),
        isFetching: () => loading.value,
      })
    : null
  // Polling also refreshes permissions, sessions and other facts without route notifications.
  const timer = window.setInterval(() => {
    if (document.visibilityState === 'visible' && !loading.value) void load()
  }, 5000)
  const refreshOnFocus = () => {
    if (!loading.value) void load()
  }
  window.addEventListener('focus', refreshOnFocus)
  onScopeDispose(() => {
    controller?.abort()
    clearInterval(timer)
    window.removeEventListener('focus', refreshOnFocus)
  })
  return {
    items,
    loading,
    error,
    nextCursor,
    lastReadAt,
    liveState: computed(() => events?.state.value ?? null),
    refreshLive: () => (events ? events.refresh() : load()),
    refresh: () => load(),
    more: () => load(true),
  }
}
