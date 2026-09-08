import { onBeforeUnmount, onMounted, readonly, reactive, shallowReadonly, shallowRef } from 'vue'

import { api } from '@/api/client.js'
import { ApiFailure, apiFailure, networkFailure } from '@/api/errors.js'
import { useInvalidationEvents } from './useInvalidationEvents.js'
import type {
  Profile,
  ProfileListFacets,
  ProfileListQuery,
  ProfileListSummary,
} from '@/api/types.js'

export type ProfileBusinessStatusFilter = NonNullable<ProfileListQuery['businessStatus']>
export type ProfileRuntimeStateFilter = NonNullable<ProfileListQuery['runtimeState']>

export interface AdminProfileFilters {
  search: string
  businessStatus: ProfileBusinessStatusFilter
  runtimeState: ProfileRuntimeStateFilter
  workerId: string | null
  groupId: string | null
}

const initialFilters: AdminProfileFilters = {
  search: '',
  businessStatus: 'ALL',
  runtimeState: 'ALL',
  workerId: null,
  groupId: null,
}

export function useAdminProfiles() {
  const filters = reactive<AdminProfileFilters>({ ...initialFilters })
  const items = shallowRef<readonly Profile[]>([])
  const summary = shallowRef<ProfileListSummary | null>(null)
  const facets = shallowRef<ProfileListFacets>({ workers: [], groups: [], proxies: [] })
  const nextCursor = shallowRef<string | null>(null)
  const loading = shallowRef(false)
  const loadingMore = shallowRef(false)
  const error = shallowRef<ApiFailure | null>(null)
  let requestGeneration = 0
  let requestController: AbortController | undefined

  const fetching = shallowRef(false)
  const lastReadAt = shallowRef<number | null>(null)
  let loadedPages = 1
  const events = useInvalidationEvents('/api/v1/profiles/events', {
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
    const loaded: Profile[] = []
    let loadedSummary: ProfileListSummary | null = null
    let loadedFacets: ProfileListFacets | undefined
    let pageCount = 0
    try {
      const search = filters.search.trim()
      for (let page = 0; page < pages; page += 1) {
        const {
          data,
          error: responseError,
          response,
        } = await api.GET('/profiles', {
          params: {
            query: {
              limit: 30,
              businessStatus: filters.businessStatus,
              runtimeState: filters.runtimeState,
              ...(search.length === 0 ? {} : { search }),
              ...(filters.workerId === null ? {} : { workerId: filters.workerId }),
              ...(filters.groupId === null ? {} : { groupId: filters.groupId }),
              ...(cursor === null ? {} : { cursor }),
            },
          },
          signal: controller.signal,
        })
        if (data === undefined) throw apiFailure(responseError, response)
        if (generation !== requestGeneration) return
        loaded.push(...data.items)
        loadedSummary = data.summary
        loadedFacets = data.facets
        pageCount += 1
        cursor = data.meta.nextCursor
        if (cursor === null) break
      }
      items.value = append ? [...items.value, ...loaded] : loaded
      summary.value = loadedSummary
      if (loadedFacets) facets.value = loadedFacets
      loadedPages = append ? loadedPages + 1 : pageCount
      lastReadAt.value = Date.now()
      nextCursor.value = cursor
    } catch (cause) {
      if (controller.signal.aborted || generation !== requestGeneration) return
      error.value = cause instanceof ApiFailure ? cause : networkFailure(cause)
      if (error.value.status === 401 || error.value.status === 403) {
        resetResults()
        facets.value = { workers: [], groups: [], proxies: [] }
      }
    } finally {
      if (generation === requestGeneration) {
        loading.value = false
        loadingMore.value = false
        fetching.value = false
      }
    }
  }

  function resetResults(): void {
    loadedPages = 1
    lastReadAt.value = null
    items.value = []
    summary.value = null
    nextCursor.value = null
  }

  function reloadAfterFilterChange(): void {
    resetResults()
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

  function setBusinessStatus(value: ProfileBusinessStatusFilter): void {
    if (filters.businessStatus === value) return
    filters.businessStatus = value
    reloadAfterFilterChange()
  }

  function setRuntimeState(value: ProfileRuntimeStateFilter): void {
    if (filters.runtimeState === value) return
    filters.runtimeState = value
    reloadAfterFilterChange()
  }

  function setWorkerId(value: string | null): void {
    if (filters.workerId === value) return
    filters.workerId = value
    reloadAfterFilterChange()
  }

  function setGroupId(value: string | null): void {
    if (filters.groupId === value) return
    filters.groupId = value
    reloadAfterFilterChange()
  }

  function clearFilters(): void {
    Object.assign(filters, initialFilters)
    reloadAfterFilterChange()
  }

  return {
    filters: readonly(filters),
    items: shallowReadonly(items),
    summary: shallowReadonly(summary),
    facets: shallowReadonly(facets),
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
    setBusinessStatus,
    setRuntimeState,
    setWorkerId,
    setGroupId,
    clearFilters,
  }
}
