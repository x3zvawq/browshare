import { computed, onMounted, onScopeDispose, shallowReadonly, shallowRef } from 'vue'

export type InvalidationEndpoint =
  '/api/v1/profiles/events' | '/api/v1/proxies/events' | '/api/v1/workspace/events'

export type InvalidationState =
  'connecting' | 'connected' | 'reconnecting' | 'paused' | 'unauthorized'

/** Events invalidate REST snapshots; they never carry a second copy of business state. */
export function useInvalidationEvents(
  endpoint: InvalidationEndpoint,
  options: {
    refresh: () => Promise<void>
    isFetching: () => boolean
  },
) {
  const state = shallowRef<InvalidationState>('connecting')
  const liveConnected = computed(() => state.value === 'connected')
  let source: EventSource | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  function queueRefresh(): void {
    if (disposed || document.hidden || timer !== undefined) return
    timer = setTimeout(() => {
      timer = undefined
      if (disposed || document.hidden) return
      // Preserve a notification received during a fetch without aborting pagination.
      if (options.isFetching()) queueRefresh()
      else void options.refresh()
    }, 200)
  }

  function close(): void {
    source?.close()
    source = undefined
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    if (reconnectTimer !== undefined) clearTimeout(reconnectTimer)
    reconnectTimer = undefined
  }

  function connect(): void {
    close()
    if (disposed) return
    if (document.hidden) {
      state.value = 'paused'
      return
    }
    state.value = 'connecting'
    const current = new EventSource(endpoint)
    source = current
    current.onopen = () => {
      if (source === current) state.value = 'connected'
    }
    current.onerror = () => {
      if (source !== current) return
      state.value = 'reconnecting'
      // A rejected initial connection cannot send authentication-required.
      if (current.readyState === EventSource.CLOSED) {
        queueRefresh()
        // HTTP failures can permanently close EventSource. Native reconnect only
        // covers CONNECTING; recreate a closed stream after a bounded delay.
        if (reconnectTimer === undefined) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = undefined
            if (source === current) connect()
          }, 3000)
        }
      }
    }
    current.addEventListener('profiles-changed', () => {
      if (source === current) queueRefresh()
    })
    current.addEventListener('authentication-required', () => {
      if (source !== current) return
      close()
      state.value = 'unauthorized'
      queueRefresh() // REST uses the existing authorization error and login path.
    })
  }

  onMounted(() => {
    connect()
    document.addEventListener('visibilitychange', connect)
  })
  onScopeDispose(() => {
    disposed = true
    close()
    document.removeEventListener('visibilitychange', connect)
  })

  async function refresh(): Promise<void> {
    if (disposed || options.isFetching()) return
    if (source === undefined || source.readyState === EventSource.CLOSED) connect()
    await options.refresh()
  }

  return { liveConnected, state: shallowReadonly(state), refresh }
}
