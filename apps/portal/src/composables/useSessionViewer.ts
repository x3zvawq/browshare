import { computed, onScopeDispose, shallowRef } from 'vue'
import { api } from '@/api/client.js'
import { apiFailure, networkFailure, type ApiFailure } from '@/api/errors.js'
import type { TabSession, SessionViewerLaunch } from '@/api/types.js'
import { useInvalidationEvents } from './useInvalidationEvents.js'

// A new browser page is a separate Viewer. Reconnects and route revisits within this page retain identity.
const clientId = crypto.randomUUID()
interface Takeover {
  viewerGeneration: number
  connectedAt: string | null
}
export function useSessionViewer(id: string) {
  const session = shallowRef<TabSession | null>(null),
    launch = shallowRef<SessionViewerLaunch | null>(null)
  const queryError = shallowRef<ApiFailure | null>(null),
    connectionError = shallowRef<ApiFailure | null>(null)
  const error = computed(() => queryError.value ?? connectionError.value)
  const loading = shallowRef(true),
    connecting = shallowRef(false)
  const lastReadAt = shallowRef<number | null>(null)
  const refreshing = shallowRef(false)
  const takeover = shallowRef<Takeover | null>(null)
  const continueError = shallowRef<ApiFailure | null>(null),
    continuing = shallowRef(false)
  let activeGeneration = 0
  const signal = new AbortController()
  let attempted = false
  const connectable = computed(() =>
    Boolean(
      session.value &&
      ['READY', 'CONNECTED', 'SUSPENDED', 'DISCONNECTED'].includes(session.value.status),
    ),
  )
  async function credentials(generation?: number): Promise<SessionViewerLaunch> {
    const result = await api.POST('/sessions/{id}/viewer', {
      params: { path: { id } },
      body: { clientId, ...(generation === undefined ? {} : { takeoverGeneration: generation }) },
      signal: signal.signal,
    })
    if (!result.data) throw apiFailure(result.error, result.response)
    if (signal.signal.aborted) throw new DOMException('Viewer was closed', 'AbortError')
    activeGeneration = result.data.viewerGeneration
    return result.data
  }
  async function connect(generation?: number) {
    if (connecting.value || !connectable.value) return
    attempted = true
    connecting.value = true
    connectionError.value = null
    takeover.value = null
    launch.value = null
    try {
      launch.value = await credentials(generation)
    } catch (cause) {
      if (signal.signal.aborted) return
      const failure = networkFailure(cause),
        details = failure.details
      if (
        failure.code === 'VIEWER_TAKEOVER_REQUIRED' &&
        typeof details === 'object' &&
        details !== null &&
        'viewerGeneration' in details &&
        Number.isSafeInteger(details.viewerGeneration)
      ) {
        takeover.value = {
          viewerGeneration: Number(details.viewerGeneration),
          connectedAt:
            'connectedAt' in details && typeof details.connectedAt === 'string'
              ? details.connectedAt
              : null,
        }
      } else connectionError.value = failure
    } finally {
      connecting.value = false
    }
  }
  async function refresh() {
    if (refreshing.value || signal.signal.aborted) return
    refreshing.value = true
    try {
      const result = await api.GET('/sessions/{id}', {
        params: { path: { id } },
        signal: signal.signal,
      })
      if (!result.data) throw apiFailure(result.error, result.response)
      if (signal.signal.aborted) return
      session.value = result.data
      queryError.value = null
      lastReadAt.value = Date.now()
      if (!connectable.value) launch.value = null
      if (!attempted && connectable.value) void connect()
    } catch (cause) {
      if (!signal.signal.aborted) {
        queryError.value = networkFailure(cause)
        if ([401, 403, 404].includes(queryError.value.status ?? 0)) launch.value = null
      }
    } finally {
      refreshing.value = false
      loading.value = false
    }
  }
  async function continueSession() {
    if (continuing.value || !launch.value || !session.value) return
    continuing.value = true
    continueError.value = null
    try {
      const result = await api.POST('/sessions/{id}/continue', {
        params: { path: { id } },
        body: { clientId, viewerGeneration: activeGeneration },
        signal: signal.signal,
      })
      if (!result.data) throw apiFailure(result.error, result.response)
      if (!signal.signal.aborted && session.value)
        session.value = { ...session.value, ...result.data }
    } catch (cause) {
      if (!signal.signal.aborted) continueError.value = networkFailure(cause)
    } finally {
      continuing.value = false
    }
  }
  async function reconnect() {
    const result = await credentials()
    return { ticket: result.ticket, endpoint: result.signalingUrl, focusPolicy: result.focusPolicy }
  }
  function closed(value: TabSession) {
    session.value = value
    launch.value = null
    takeover.value = null
  }
  const events = useInvalidationEvents('/api/v1/workspace/events', {
    refresh,
    isFetching: () => refreshing.value,
  })
  // Session deadlines and Viewer ownership still need their existing REST refresh.
  const timer = window.setInterval(() => {
    void refresh()
  }, 3000)
  void refresh()
  onScopeDispose(() => {
    signal.abort()
    clearInterval(timer)
    launch.value = null
  })
  return {
    continueSession,
    continuing,
    continueError,
    session,
    launch,
    error,
    loading,
    lastReadAt,
    liveState: events.state,
    refreshLive: events.refresh,
    refreshing,
    connecting,
    takeover,
    connectable,
    connect,
    refresh,
    reconnect,
    closed,
  }
}
