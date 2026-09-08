<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { NButton, NEmpty, NInput, NSkeleton, NTag } from 'naive-ui'
import { api } from '@/api/client.js'
import { apiFailure } from '@/api/errors.js'
import type { TabSession } from '@/api/types.js'
import { usePagedCollection } from '@/composables/usePagedCollection.js'
import LiveUpdateStatus from '@/components/status/LiveUpdateStatus.vue'
import RequestError from '@/components/workspace/RequestError.vue'
import MaintenanceProfileCard from './MaintenanceProfileCard.vue'
import MaintenanceStartModal from './MaintenanceStartModal.vue'
const { t } = useI18n(),
  route = useRoute(),
  router = useRouter()
const search = shallowRef(''),
  selectedId = shallowRef<string | null>(null)
const query = computed(() => ({
  search: search.value.trim(),
  profileId: typeof route.query.profileId === 'string' ? route.query.profileId : undefined,
}))
const { items, loading, error, nextCursor, refresh, more, liveState, lastReadAt, refreshLive } =
  usePagedCollection(
    query,
    async (cursor, signal) => {
      if (query.value.profileId) {
        const result = await api.GET('/profiles/{id}/maintenance', {
          params: { path: { id: query.value.profileId } },
          signal,
        })
        if (!result.data) throw apiFailure(result.error, result.response)
        return { items: [result.data], meta: { hasMore: false, nextCursor: null } }
      }
      const result = await api.GET('/maintenance/profiles', {
        params: { query: { search: query.value.search, limit: 24, ...(cursor ? { cursor } : {}) } },
        signal,
      })
      if (!result.data) throw apiFailure(result.error, result.response)
      return result.data
    },
    { events: '/api/v1/workspace/events' },
  )
function closeModal() {
  selectedId.value = null
  void refresh()
}
function created(session: TabSession) {
  selectedId.value = null
  void router.push({ name: 'session-viewer', params: { id: session.id } })
}
</script>
<template>
  <section class="maintenance-panel">
    <header>
      <div>
        <h1>{{ t('maintenance.title') }}</h1>
        <p>{{ t('maintenance.intro') }}</p>
      </div>
      <NButton :loading="loading" @click="refresh">{{ t('workspace.refresh') }}</NButton>
    </header>
    <div class="toolbar">
      <NInput
        v-if="!query.profileId"
        v-model:value="search"
        clearable
        :maxlength="200"
        :placeholder="t('workspace.search')"
        :input-props="{ 'aria-label': t('workspace.search') }"
      />
      <NTag v-else closable @close="router.replace({ name: 'maintenance' })">{{
        t('workspace.profileFilter')
      }}</NTag>
    </div>
    <RequestError v-if="error" :error="error" />
    <LiveUpdateStatus
      :state="liveState"
      :last-read-at="lastReadAt"
      :busy="loading"
      @refresh="refreshLive"
    />
    <NSkeleton v-if="loading && !items.length" height="140px" :sharp="false" />
    <NEmpty v-else-if="!error && !items.length" :description="t('maintenance.empty')" />
    <MaintenanceProfileCard
      v-for="profile in items"
      :key="profile.id"
      :profile="profile"
      @start="selectedId = profile.id"
    />
    <NButton v-if="nextCursor" :loading="loading" @click="more">{{ t('workspace.more') }}</NButton>
    <MaintenanceStartModal
      v-if="selectedId"
      :key="selectedId"
      :profile-id="selectedId"
      @close="closeModal"
      @created="created"
    />
  </section>
</template>
<style scoped>
.maintenance-panel {
  display: grid;
  gap: 20px;
  color: var(--bs-text);
  max-width: 1440px;
  margin: auto;
}
.maintenance-panel > * {
  min-width: 0;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
h1 {
  margin: 0;
  font-size: 28px;
}
p {
  color: var(--bs-text-muted);
  margin: 8px 0 0;
}
.toolbar {
  max-width: 520px;
}
@media (max-width: 640px) {
  header {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
