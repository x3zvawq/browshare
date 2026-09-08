<script setup lang="ts">
import { useSessionStore } from '@/stores/session.js'
import { computed, shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { NButton, NEmpty, NSelect, NSkeleton, NTag } from 'naive-ui'
import { api } from '@/api/client.js'
import { apiFailure } from '@/api/errors.js'
import type { TabSession, TabSessionListQuery } from '@/api/types.js'
import { usePagedCollection } from '@/composables/usePagedCollection.js'
import { useSessionClose } from '@/composables/useSessionClose.js'
import SessionDownloadsModal from '@/components/downloads/SessionDownloadsModal.vue'
import SessionCard from './SessionCard.vue'
import RenameSessionModal from './RenameSessionModal.vue'
import RequestError from './RequestError.vue'
const { t } = useI18n(),
  route = useRoute(),
  router = useRouter()
const auth = useSessionStore()
const browseTarget = computed(() =>
  auth.user?.permissions.includes('session.use') ? 'workspace' : 'maintenance',
)
const downloads = shallowRef<TabSession | null>(null)
const selected = shallowRef<TabSession | null>(null),
  state = shallowRef<NonNullable<TabSessionListQuery['status']> | 'ALL'>('ALL')
const query = computed(() => ({
  ...(typeof route.query.profileId === 'string' ? { profileId: route.query.profileId } : {}),
  ...(state.value !== 'ALL' ? { status: state.value } : {}),
}))
const { items, loading, error, nextCursor, refresh, more } = usePagedCollection(
  query,
  async (cursor, signal) => {
    const result = await api.GET('/sessions', {
      params: { query: { ...query.value, limit: 24, ...(cursor ? { cursor } : {}) } },
      signal,
    })
    if (!result.data) throw apiFailure(result.error, result.response)
    return result.data
  },
)
const { confirm, error: closeError } = useSessionClose(async () => {
  await refresh()
})
function renamed() {
  selected.value = null
  void refresh()
}
const states = computed(() =>
  [
    'ALL',
    'RESERVED',
    'CREATING',
    'READY',
    'CONNECTED',
    'SUSPENDED',
    'DISCONNECTED',
    'CLOSING',
    'CLOSED',
    'FAILED',
  ].map((value) => ({
    value,
    label: value === 'ALL' ? t('workspace.allStates') : t(`workspace.sessionState.${value}`),
  })),
)
</script>
<template>
  <section class="sessions-panel">
    <header>
      <div>
        <h1>{{ t('workspace.mySessions') }}</h1>
        <p>{{ t('workspace.sessionsIntro') }}</p>
      </div>
      <RouterLink v-slot="{ href, navigate }" :to="{ name: browseTarget }" custom
        ><NButton tag="a" :href="href" type="primary" @click="navigate">{{
          t(browseTarget === 'maintenance' ? 'maintenance.title' : 'workspace.browse')
        }}</NButton></RouterLink
      >
    </header>
    <div class="toolbar">
      <NSelect
        v-model:value="state"
        :options="states"
        :aria-label="t('workspace.sessionFilter')"
      /><NButton :loading="loading" @click="refresh">{{ t('workspace.refresh') }}</NButton
      ><NTag v-if="query.profileId" closable @close="router.replace({ name: 'my-sessions' })">{{
        route.query.profileName || t('workspace.profileFilter')
      }}</NTag>
    </div>
    <RequestError v-if="error || closeError" :error="(error || closeError)!" />
    <NSkeleton v-if="loading && !items.length" height="120px" :sharp="false" />
    <NEmpty v-else-if="!items.length && !error" :description="t('workspace.noSessions')" />
    <SessionCard
      v-for="session in items"
      :key="session.id"
      :session="session"
      @rename="selected = $event"
      @downloads="downloads = $event"
      @close="confirm"
    />
    <NButton v-if="nextCursor" :loading="loading" @click="more">{{ t('workspace.more') }}</NButton>
    <SessionDownloadsModal
      v-if="downloads"
      :key="downloads.id"
      :session="downloads"
      @close="downloads = null"
    />
    <RenameSessionModal
      v-if="selected"
      :session="selected"
      @close="selected = null"
      @saved="renamed"
    />
  </section>
</template>
<style scoped>
.sessions-panel {
  display: grid;
  gap: 20px;
  max-width: 1440px;
  margin: auto;
  color: var(--bs-text);
}
.sessions-panel > * {
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
header p {
  margin: 8px 0 0;
  color: var(--bs-text-muted);
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.toolbar > :first-child {
  width: 190px;
}
@media (max-width: 640px) {
  header {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
