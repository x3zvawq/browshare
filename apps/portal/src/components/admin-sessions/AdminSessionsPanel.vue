<script setup lang="ts">
import { useAppDialog as useDialog } from '@/composables/useAppDialog.js'
import { computed, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NEmpty, NInput, NSelect, NSkeleton, useMessage } from 'naive-ui'
import { api } from '@/api/client.js'
import { apiFailure, networkFailure, type ApiFailure } from '@/api/errors.js'
import type { AdminTabSession, AdminTabSessionListQuery } from '@/api/types.js'
import { usePagedCollection } from '@/composables/usePagedCollection.js'
import { sessionName } from '@/utils/tab-session.js'
import RequestError from '@/components/workspace/RequestError.vue'
import SessionTable from './SessionTable.vue'
import SessionDetails from './SessionDetails.vue'
const props = defineProps<{ canTerminate: boolean }>()
const { t } = useI18n(),
  dialog = useDialog(),
  message = useMessage()
const draft = shallowRef(''),
  search = shallowRef(''),
  scope = shallowRef<'ACTIVE' | 'ALL'>('ACTIVE'),
  state = shallowRef<AdminTabSessionListQuery['status']>(),
  selected = shallowRef<string | null>(null)
const busy = shallowRef(false),
  mutationError = shallowRef<ApiFailure | null>(null)
const query = computed(() => ({
  scope: scope.value,
  ...(search.value ? { search: search.value } : {}),
  ...(state.value ? { status: state.value } : {}),
}))
const { items, loading, error, nextCursor, refresh, more } = usePagedCollection(
  query,
  async (cursor, signal) => {
    const r = await api.GET('/admin/sessions', {
      params: { query: { ...query.value, limit: 30, ...(cursor ? { cursor } : {}) } },
      signal,
    })
    if (!r.data) throw apiFailure(r.error, r.response)
    return r.data
  },
)
const scopes = computed(() => [
  { value: 'ACTIVE', label: t('adminSessions.active') },
  { value: 'ALL', label: t('adminSessions.all') },
])
const states = computed(() =>
  [
    'RESERVED',
    'CREATING',
    'READY',
    'CONNECTED',
    'SUSPENDED',
    'DISCONNECTED',
    'CLOSING',
    ...(scope.value === 'ALL' ? ['CLOSED', 'FAILED'] : []),
  ].map((value) => ({ value, label: t(`workspace.sessionState.${value}`) })),
)
function setScope(value: 'ACTIVE' | 'ALL') {
  state.value = undefined
  scope.value = value
}
function terminate(session: AdminTabSession) {
  if (!props.canTerminate || busy.value) return
  const modal = dialog.warning({
    title: t('adminSessions.confirmTitle'),
    content: t('adminSessions.confirm', {
      name: sessionName(session),
      user: session.user.name,
      profile: session.profileName,
    }),
    positiveText: t('adminSessions.terminate'),
    negativeText: t('workspace.cancel'),
    onPositiveClick: async () => {
      busy.value = true
      modal.loading = true
      mutationError.value = null
      try {
        const r = await api.POST('/admin/sessions/{id}/close', {
          params: { path: { id: session.id } },
        })
        if (!r.data) throw apiFailure(r.error, r.response)
        message.success(t('adminSessions.accepted'))
        await refresh()
        return true
      } catch (cause) {
        const failure = networkFailure(cause)
        mutationError.value = failure
        message.error(
          `${t('workspace.errors.UNKNOWN')} · ${failure.code}${failure.requestId ? ` · ${failure.requestId}` : ''}`,
        )
        return false
      } finally {
        busy.value = false
        modal.loading = false
      }
    },
  })
}
</script>
<template>
  <section class="session-management">
    <header>
      <p class="eyebrow">SESSION CONTROL</p>
      <h1>{{ t('adminSessions.title') }}</h1>
      <p>{{ t('adminSessions.intro') }}</p>
      <p v-if="!canTerminate" class="hint">{{ t('adminSessions.readOnly') }}</p>
    </header>
    <form class="filters" @submit.prevent="search = draft.trim()">
      <NInput
        v-model:value="draft"
        :maxlength="256"
        clearable
        :placeholder="t('adminSessions.search')"
        :input-props="{ 'aria-label': t('adminSessions.search') }"
      /><NButton attr-type="submit">{{ t('adminSessions.searchAction') }}</NButton
      ><NSelect
        :value="scope"
        :options="scopes"
        :input-props="{ 'aria-label': t('adminSessions.scope') }"
        @update:value="setScope"
      /><NSelect
        :value="state ?? null"
        :options="states"
        clearable
        :placeholder="t('workspace.allStates')"
        :input-props="{ 'aria-label': t('workspace.sessionFilter') }"
        @update:value="state = $event ?? undefined"
      /><NButton :loading="loading" @click="refresh">{{ t('workspace.refresh') }}</NButton>
    </form>
    <p class="hint" role="status">{{ t('adminSessions.live') }}</p>
    <RequestError v-if="error || mutationError" :error="(error || mutationError)!" />
    <NSkeleton v-if="loading && !items.length" height="240px" />
    <NEmpty v-else-if="!items.length && !error" :description="t('workspace.noSessions')" />
    <SessionTable
      v-else-if="items.length"
      :items="items"
      :loading="loading"
      :can-terminate="canTerminate"
      :busy="busy"
      @inspect="selected = $event"
      @terminate="terminate"
    />
    <NButton v-if="nextCursor" :loading="loading" @click="more">{{ t('workspace.more') }}</NButton>
    <SessionDetails
      v-if="selected"
      :id="selected"
      :can-terminate="canTerminate"
      :busy="busy"
      @close="selected = null"
      @terminate="terminate"
    />
  </section>
</template>
<style scoped>
.session-management {
  display: grid;
  gap: 18px;
  min-width: 0;
  max-width: 1440px;
  margin: 0 auto;
}
.session-management > * {
  min-width: 0;
}
h1 {
  margin: 0;
  font-size: 26px;
}
header p {
  color: var(--bs-text-muted);
  line-height: 1.65;
}
.eyebrow {
  color: var(--bs-primary);
  letter-spacing: 0.14em;
  font-size: 11px;
  font-weight: 750;
}
.hint {
  color: var(--bs-text-muted);
  font-size: 13px;
  margin: 0;
}
.filters {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) auto 180px 180px auto;
  gap: 10px;
}
@media (max-width: 1000px) {
  .filters {
    grid-template-columns: minmax(0, 1fr) auto;
  }
}
@media (max-width: 500px) {
  .filters {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
