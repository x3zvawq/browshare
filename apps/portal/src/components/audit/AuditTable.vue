<script setup lang="ts">
import { computed, h } from 'vue'
import { NButton, NCard, NDataTable, NTag, type DataTableColumns } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { AuditEventSummary } from '@/api/types.js'
import { vAccessibleTableScroll } from '@/directives/accessible-table-scroll.js'
defineProps<{ items: AuditEventSummary[] }>()
const emit = defineEmits<{ inspect: [id: string] }>()
const { t, locale } = useI18n()
const columns = computed<DataTableColumns<AuditEventSummary>>(() => [
  {
    title: t('audit.occurredAt'),
    key: 'occurredAt',
    width: 200,
    render: (row) => new Date(row.occurredAt).toLocaleString(locale.value),
  },
  {
    title: t('audit.actorName'),
    key: 'actorName',
    width: 190,
    render: (row) =>
      h(
        'span',
        { title: row.actorUserId ?? undefined },
        row.actorName ?? row.actorUserId ?? t('audit.noActor'),
      ),
  },
  { title: t('audit.action'), key: 'action', width: 240 },
  {
    title: t('audit.targetType'),
    key: 'target',
    width: 300,
    render: (row) =>
      h('div', { class: 'identity' }, [
        h('span', row.targetType),
        h('small', row.targetId ?? t('audit.none')),
      ]),
  },
  {
    title: t('audit.result'),
    key: 'result',
    width: 130,
    render: (row) =>
      h(
        NTag,
        {
          bordered: false,
          type:
            row.result === 'SUCCEEDED' ? 'success' : row.result === 'FAILED' ? 'error' : 'warning',
        },
        () => t(`audit.results.${row.result}`),
      ),
  },
  {
    title: t('audit.actions'),
    key: 'actions',
    width: 125,
    render: (row) =>
      h(NButton, { size: 'small', onClick: () => emit('inspect', row.id) }, () =>
        t('audit.details'),
      ),
  },
])
</script>
<template>
  <NCard :bordered="false"
    ><NDataTable
      v-accessible-table-scroll="t('audit.table')"
      :columns="columns"
      :data="items"
      :row-key="(row: AuditEventSummary) => row.id"
      :scroll-x="1185"
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
  font-family: var(--bs-font-mono);
  color: var(--bs-text-muted);
  font-size: 11px;
}
</style>
