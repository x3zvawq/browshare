<script setup lang="ts">
import { computed, h, shallowRef } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  NButton,
  NDataTable,
  NEmpty,
  NInput,
  NSelect,
  NSkeleton,
  NTag,
  NTime,
  type DataTableColumns,
} from 'naive-ui'
import { api } from '@/api/client.js'
import { apiFailure } from '@/api/errors.js'
import type { ManagedWorker, WorkerQuery } from '@/api/types.js'
import { usePagedCollection } from '@/composables/usePagedCollection.js'
import { vAccessibleTableScroll } from '@/directives/accessible-table-scroll.js'
import StoragePolicySummary from '@/components/storage/StoragePolicySummary.vue'
import { storageMessages } from '@/components/storage/messages.js'
import WorkerRequestError from './WorkerRequestError.vue'
defineProps<{ canManage: boolean }>()
const { t, te } = useI18n({ messages: storageMessages }),
  draft = shallowRef(''),
  search = shallowRef(''),
  state = shallowRef<NonNullable<WorkerQuery['state']>>('ALL')
const query = computed(() => ({
  ...(search.value ? { search: search.value } : {}),
  state: state.value,
}))
const { items, error, loading, nextCursor, refresh, more } = usePagedCollection(
  query,
  async (cursor, signal) => {
    const r = await api.GET('/workers', {
      params: { query: { ...query.value, limit: 30, ...(cursor ? { cursor } : {}) } },
      signal,
    })
    if (!r.data) throw apiFailure(r.error, r.response)
    return r.data
  },
)
const states = computed(() =>
  ['ALL', 'PENDING', 'ONLINE', 'DRAINING', 'OFFLINE', 'DISABLED'].map((value) => ({
    value,
    label: t(value === 'ALL' ? 'workerManagement.all' : `workerManagement.${value}`),
  })),
)
const columns = computed<DataTableColumns<ManagedWorker>>(() => [
  {
    key: 'name',
    title: t('workerManagement.name'),
    width: 270,
    render: (w) =>
      h('div', { class: 'identity' }, [
        h(RouterLink, { to: '/admin/workers/' + w.id }, () => w.name),
        h('small', w.reportedHostname ?? t('workerManagement.unknown')),
      ]),
  },
  {
    key: 'state',
    title: t('workerManagement.state'),
    width: 190,
    render: (w) =>
      h(
        NTag,
        {
          size: 'small',
          type: w.state === 'ONLINE' ? 'success' : w.state === 'OFFLINE' ? 'warning' : 'default',
        },
        () => t(`workerManagement.${w.state}`),
      ),
  },
  {
    key: 'capacity',
    title: t('workerManagement.capacity'),
    width: 170,
    render: (w) =>
      `${w.capacity.activeTabs} / ${w.capacity.maxActiveTabs ?? t('workerManagement.unlimited')}`,
  },
  {
    key: 'eligible',
    title: t('workerManagement.eligible'),
    width: 280,
    render: (w) =>
      w.workerEligible
        ? t('workerManagement.eligible')
        : w.schedulingBlockReasons
            .map((r) =>
              t(te(`storage.blocks.${r}`) ? `storage.blocks.${r}` : `workerManagement.${r}`),
            )
            .join(' · '),
  },
  {
    key: 'storage',
    title: t('storage.title'),
    width: 280,
    render: (w) =>
      h(StoragePolicySummary, {
        quotaBytes: w.storageQuotaBytes,
        policyVersion: w.storagePolicyVersion,
        pending: w.storagePolicyPending,
        fact: w.storageSnapshot,
        compact: true,
      }),
  },
  {
    key: 'last',
    title: t('workerManagement.seen'),
    width: 190,
    render: (w) =>
      w.lastSeenAt
        ? h(NTime, { time: new Date(w.lastSeenAt), type: 'datetime' })
        : t('workerManagement.never'),
  },
  {
    key: 'detail',
    title: t('workerManagement.details'),
    width: 110,
    render: (w) =>
      h(RouterLink, { to: '/admin/workers/' + w.id }, () => t('workerManagement.details')),
  },
])
</script>
<template>
  <section class="workers-page">
    <header>
      <div>
        <h1>{{ t('workerManagement.title') }}</h1>
        <p>{{ t('workerManagement.intro') }}</p>
      </div>
      <RouterLink to="/admin/workers/enrollments">{{ t('workerManagement.enroll') }}</RouterLink>
    </header>
    <small v-if="!canManage">{{ t('workerManagement.readonly') }}</small>
    <form class="filters" @submit.prevent="search = draft.trim()">
      <NInput
        v-model:value="draft"
        :placeholder="t('workerManagement.search')"
        :input-props="{ 'aria-label': t('workerManagement.search') }"
        clearable
      /><NButton attr-type="submit">{{ t('workerManagement.searchAction') }}</NButton
      ><NSelect
        v-model:value="state"
        :options="states"
        :aria-label="t('workerManagement.state')"
      /><NButton :loading="loading" @click="refresh">{{ t('workerManagement.refresh') }}</NButton>
    </form>
    <WorkerRequestError v-if="error" :error="error" />
    <NSkeleton v-if="loading && !items.length" height="240px" />
    <NEmpty v-else-if="!items.length && !error" :description="t('workerManagement.empty')" />
    <NDataTable
      v-else-if="items.length"
      v-accessible-table-scroll="t('workerManagement.table')"
      :columns="columns"
      :data="items"
      :row-key="(w: ManagedWorker) => w.id"
      :scroll-x="1490"
      :single-line="false"
    />
    <NButton v-if="nextCursor" :loading="loading" @click="more">{{
      t('workerManagement.more')
    }}</NButton>
  </section>
</template>
<style scoped>
.workers-page {
  grid-template-columns: minmax(0, 1fr);
  display: grid;
  gap: 20px;
  min-width: 0;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
h1 {
  font-size: 24px;
  margin: 0;
}
p {
  color: var(--bs-text-muted);
}
.filters {
  display: grid;
  grid-template-columns: minmax(160px, 1fr) auto 220px auto;
  gap: 12px;
}
:deep(.identity) {
  display: grid;
  gap: 4px;
}
:deep(.identity small) {
  color: var(--bs-text-muted);
}
@media (max-width: 700px) {
  .filters {
    grid-template-columns: minmax(0, 1fr) auto;
  }
}
</style>
