import { computed } from 'vue'
import { api } from '@/api/client.js'
import { apiFailure } from '@/api/errors.js'
import { usePagedCollection } from '@/composables/usePagedCollection.js'
export function useProfileDetail(id: () => string) {
  const collection = usePagedCollection(
    id,
    async (_cursor, signal) => {
      const result = await api.GET('/profiles/{profileId}', {
        params: { path: { profileId: id() } },
        signal,
      })
      if (!result.data) throw apiFailure(result.error, result.response)
      return { items: [result.data], meta: { hasMore: false, nextCursor: null } }
    },
    { events: '/api/v1/profiles/events' },
  )
  const profile = computed(() =>
    collection.error.value?.status === 404 ? null : (collection.items.value[0] ?? null),
  )
  return { ...collection, profile }
}
