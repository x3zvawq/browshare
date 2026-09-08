<script setup lang="ts">
import { computed, onScopeDispose, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { NButton, NEmpty, NInput, NSelect, NSkeleton, NTag } from 'naive-ui'
import { api } from '@/api/client.js'
import { apiFailure } from '@/api/errors.js'
import type { AccessibleProfile, ProfileListQuery, TabSession } from '@/api/types.js'
import { usePagedCollection } from '@/composables/usePagedCollection.js'
import LiveUpdateStatus from '@/components/status/LiveUpdateStatus.vue'
import ProfileCard from './ProfileCard.vue'
import CreateSessionModal from './CreateSessionModal.vue'
import RequestError from './RequestError.vue'
const { t } = useI18n(),
  router = useRouter()
const search = shallowRef(''),
  submittedSearch = shallowRef('')
const state = shallowRef<NonNullable<ProfileListQuery['runtimeState']>>('ALL'),
  group = shallowRef<{ id: string; name: string } | null>(null)
const selected = shallowRef<AccessibleProfile | null>(null)
let debounce: number | undefined
watch(search, (value) => {
  clearTimeout(debounce)
  debounce = window.setTimeout(() => {
    submittedSearch.value = value.trim()
  }, 250)
})
onScopeDispose(() => clearTimeout(debounce))
const query = computed(() => ({
  ...(submittedSearch.value ? { search: submittedSearch.value } : {}),
  runtimeState: state.value,
  ...(group.value ? { groupId: group.value.id } : {}),
}))
const { items, loading, error, nextCursor, refresh, more, liveState, lastReadAt, refreshLive } =
  usePagedCollection(
    query,
    async (cursor, signal) => {
      const result = await api.GET('/workspace/profiles', {
        params: { query: { ...query.value, limit: 24, ...(cursor ? { cursor } : {}) } },
        signal,
      })
      if (!result.data) throw apiFailure(result.error, result.response)
      return result.data
    },
    { events: '/api/v1/workspace/events' },
  )
const states = computed(() =>
  ['ALL', 'RUNNING', 'STOPPED', 'STARTING', 'MAINTAINING', 'STOPPING', 'ERROR'].map((value) => ({
    value,
    label: value === 'ALL' ? t('workspace.allStates') : t(`profiles.runtimeState.${value}`),
  })),
)
function created(session: TabSession) {
  selected.value = null
  void router.push({ name: 'session-viewer', params: { id: session.id } })
}
</script>
<template>
  <section class="workspace-panel">
    <header>
      <p class="eyebrow">BROWSHARE WORKSPACE</p>
      <h1>{{ t('workspace.title') }}</h1>
      <p class="intro">{{ t('workspace.intro') }}</p>
    </header>
    <div class="toolbar">
      <NInput
        v-model:value="search"
        clearable
        :placeholder="t('workspace.search')"
        :input-props="{ 'aria-label': t('workspace.search'), maxlength: 256 }"
      /><NSelect
        v-model:value="state"
        :options="states"
        :aria-label="t('workspace.runtimeFilter')"
      /><NButton :loading="loading" @click="refresh">{{ t('workspace.refresh') }}</NButton>
    </div>
    <NTag v-if="group" closable @close="group = null">{{ group.name }}</NTag>
    <RequestError v-if="error" :error="error" />
    <LiveUpdateStatus
      :state="liveState"
      :last-read-at="lastReadAt"
      :busy="loading"
      @refresh="refreshLive"
    />
    <div v-if="loading && !items.length" class="cards">
      <NSkeleton v-for="n in 3" :key="n" height="320px" :sharp="false" />
    </div>
    <NEmpty
      v-else-if="!items.length && !error"
      :description="
        t(search || group || state !== 'ALL' ? 'workspace.noMatches' : 'workspace.empty')
      "
    />
    <div class="cards">
      <ProfileCard
        v-for="profile in items"
        :key="profile.id"
        :profile="profile"
        @create="selected = $event"
        @group="(id, name) => (group = { id, name })"
      />
    </div>
    <NButton v-if="nextCursor" :loading="loading" @click="more">{{ t('workspace.more') }}</NButton>
    <CreateSessionModal
      v-if="selected"
      :profile="selected"
      @close="selected = null"
      @created="created"
    />
  </section>
</template>
<style scoped>
.workspace-panel {
  display: grid;
  gap: 24px;
  max-width: 1440px;
  margin: auto;
  color: var(--bs-text);
}
.workspace-panel > * {
  min-width: 0;
}
.eyebrow {
  margin: 0 0 8px;
  color: var(--bs-primary);
  font-size: 11px;
  letter-spacing: 0.14em;
  font-weight: 700;
}
h1 {
  margin: 0;
  font-size: 28px;
  letter-spacing: -0.03em;
}
.intro {
  margin: 10px 0 0;
  color: var(--bs-text-muted);
}
.toolbar {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) 180px auto;
  gap: 12px;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
  gap: 20px;
}
@media (max-width: 640px) {
  .toolbar {
    grid-template-columns: 1fr auto;
  }
  .toolbar > :first-child {
    grid-column: 1/-1;
  }
}
</style>
