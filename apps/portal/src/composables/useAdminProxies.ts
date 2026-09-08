import { onBeforeUnmount, onMounted, readonly, reactive, shallowReadonly, shallowRef } from 'vue'

import { api } from '@/api/client.js'
import { ApiFailure, apiFailure, networkFailure } from '@/api/errors.js'
import type { Proxy, ProxyListQuery } from '@/api/types.js'
import { useInvalidationEvents } from './useInvalidationEvents.js'

export type ProxyTypeFilter = NonNullable<ProxyListQuery['type']>
export type ProxyHealthFilter = NonNullable<ProxyListQuery['healthStatus']>

export interface AdminProxyFilters {
  search: string
  type: ProxyTypeFilter
  healthStatus: ProxyHealthFilter
}

const initialFilters: AdminProxyFilters = {
  search: '',
  type: 'ALL',
  healthStatus: 'ALL',
}

export function useAdminProxies() {
  const filters = reactive<AdminProxyFilters>({ ...initialFilters })
  const items = shallowRef<readonly Proxy[]>([])
  const nextCursor = shallowRef<string | null>(null)
  const loading = shallowRef(false)
  const loadingMore = shallowRef(false)
  const error = shallowRef<ApiFailure | null>(null)
  const lastReadAt = shallowRef<number | null>(null)
  const fetching = shallowRef(false)
  let requestGeneration = 0
  let requestController: AbortController | undefined
  let loadedPages = 1

  const events = useInvalidationEvents('/api/v1/proxies/events', {
    refresh: () => load({ silent: true }),
    isFetching: () => fetching.value,
  })

  onMounted(() => void load())
  onBeforeUnmount(() => {
    requestGeneration += 1
    requestController?.abort()
  })

  async function load(
    options: { readonly append?: boolean; readonly silent?: boolean } = {},
  ): Promise<void> {
    const append = options.append === true
    let cursor = append ? nextCursor.value : null
    if (append && cursor === null) return

    requestController?.abort()
    const controller = new AbortController()
    requestController = controller
    const generation = ++requestGeneration
    const pages = append ? 1 : loadedPages
    loading.value = !append && !options.silent
    loadingMore.value = append
    fetching.value = true
    error.value = null

    try {
      const search = filters.search.trim()
      const loaded: Proxy[] = []
      let pageCount = 0
      for (let page = 0; page < pages; page += 1) {
        const {
          data,
          error: responseError,
          response,
        } = await api.GET('/proxies', {
          params: {
            query: {
              limit: 30,
              type: filters.type,
              healthStatus: filters.healthStatus,
              ...(search.length === 0 ? {} : { search }),
              ...(cursor === null ? {} : { cursor }),
            },
          },
          signal: controller.signal,
        })
        if (data === undefined) throw apiFailure(responseError, response)
        if (generation !== requestGeneration) return
        loaded.push(...data.items)
        pageCount += 1
        cursor = data.meta.nextCursor
        if (cursor === null) break
      }
      items.value = append ? [...items.value, ...loaded] : loaded
      loadedPages = append ? loadedPages + 1 : pageCount
      nextCursor.value = cursor
      lastReadAt.value = Date.now()
    } catch (cause) {
      if (controller.signal.aborted || generation !== requestGeneration) return
      error.value = cause instanceof ApiFailure ? cause : networkFailure(cause)
      if (error.value.status === 401 || error.value.status === 403) {
        items.value = []
        nextCursor.value = null
        lastReadAt.value = null
        loadedPages = 1
      }
    } finally {
      if (generation === requestGeneration) {
        loading.value = false
        loadingMore.value = false
        fetching.value = false
      }
    }
  }

  function reloadAfterFilterChange(): void {
    loadedPages = 1
    lastReadAt.value = null
    items.value = []
    nextCursor.value = null
    void load()
  }

  function setSearch(value: string): void {
    const search = value.trim()
    if (filters.search === search) {
      void load()
      return
    }
    filters.search = search
    reloadAfterFilterChange()
  }

  function setType(value: ProxyTypeFilter): void {
    if (filters.type === value) return
    filters.type = value
    reloadAfterFilterChange()
  }

  function setHealthStatus(value: ProxyHealthFilter): void {
    if (filters.healthStatus === value) return
    filters.healthStatus = value
    reloadAfterFilterChange()
  }

  function clearFilters(): void {
    Object.assign(filters, initialFilters)
    reloadAfterFilterChange()
  }

  return {
    filters: readonly(filters),
    items: shallowReadonly(items),
    nextCursor: shallowReadonly(nextCursor),
    loading: shallowReadonly(loading),
    loadingMore: shallowReadonly(loadingMore),
    error: shallowReadonly(error),
    liveState: events.state,
    lastReadAt: shallowReadonly(lastReadAt),
    refreshing: shallowReadonly(fetching),
    refreshLive: events.refresh,
    refresh: () => load(),
    loadMore: () => load({ append: true }),
    setSearch,
    setType,
    setHealthStatus,
    clearFilters,
  }
}
