<script setup lang="ts">
import { computed, h } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NCard, NDataTable, NSpace, NTag, NTime, type DataTableColumns } from 'naive-ui'
import type { AdminTabSession } from '@/api/types.js'
import { sessionName } from '@/utils/tab-session.js'
import { vAccessibleTableScroll } from '@/directives/accessible-table-scroll.js'
const props = defineProps<{
  items: AdminTabSession[]
  loading: boolean
  canTerminate: boolean
  busy: boolean
}>()
const emit = defineEmits<{ inspect: [id: string]; terminate: [session: AdminTabSession] }>()
const { t } = useI18n()
const columns = computed<DataTableColumns<AdminTabSession>>(() => [
  {
    title: t('adminSessions.name'),
    key: 'name',
    width: 260,
    render: (s) => h('div', { class: 'identity' }, [h('strong', sessionName(s)), h('small', s.id)]),
  },
  {
    title: t('adminSessions.user'),
    key: 'user',
    width: 170,
    render: (s) => h('span', { title: s.user.id }, s.user.name),
  },
  { title: t('adminSessions.profile'), key: 'profile', width: 190, render: (s) => s.profileName },
  { title: t('adminSessions.worker'), key: 'worker', width: 170, render: (s) => s.worker.name },
  {
    title: t('adminSessions.state'),
    key: 'status',
    width: 150,
    render: (s) =>
      h(
        NTag,
        {
          bordered: false,
          type: s.status === 'FAILED' ? 'error' : s.status === 'CLOSING' ? 'warning' : 'default',
        },
        () => t(`workspace.sessionState.${s.status}`),
      ),
  },
  {
    title: t('adminSessions.created'),
    key: 'createdAt',
    width: 190,
    render: (s) => h(NTime, { time: new Date(s.createdAt), type: 'datetime' }),
  },
  {
    title: t('adminSessions.actions'),
    key: 'actions',
    width: props.canTerminate ? 240 : 140,
    render: (s) =>
      h(NSpace, { wrap: false }, () => [
        h(NButton, { size: 'small', onClick: () => emit('inspect', s.id) }, () =>
          t('adminSessions.details'),
        ),
        ...(props.canTerminate
          ? [
              h(
                NButton,
                {
                  size: 'small',
                  type: 'error',
                  secondary: true,
                  disabled: props.busy || ['CLOSING', 'CLOSED', 'FAILED'].includes(s.status),
                  onClick: () => emit('terminate', s),
                },
                () => t('adminSessions.terminate'),
              ),
            ]
          : []),
      ]),
  },
])
</script>
<template>
  <NCard :bordered="false"
    ><NDataTable
      v-accessible-table-scroll="t('adminSessions.table')"
      :columns="columns"
      :data="items"
      :loading="loading && items.length === 0"
      :row-key="(s: AdminTabSession) => s.id"
      :scroll-x="canTerminate ? 1370 : 1270"
      :bordered="false"
      :single-line="false"
  /></NCard>
</template>
<style scoped>
:deep(.identity) {
  display: grid;
  gap: 6px;
  overflow-wrap: anywhere;
}
:deep(.identity small) {
  color: var(--bs-text-muted);
  font-family: var(--bs-font-mono);
  font-size: 11px;
}
</style>
