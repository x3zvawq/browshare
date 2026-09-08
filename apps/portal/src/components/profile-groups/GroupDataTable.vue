<script setup lang="ts">
import { NButton, NDataTable, NEmpty, NSpace, NTag, NTime, type DataTableColumns } from 'naive-ui'
import { computed, h } from 'vue'
import { useI18n } from 'vue-i18n'
import { vAccessibleTableScroll } from '@/directives/accessible-table-scroll.js'
import type { ProfileGroup } from '@/api/types.js'
const props = defineProps<{
  failed?: boolean
  items: ProfileGroup[]
  loading: boolean
  canManage: boolean
  busyId: string | null
}>()
const emit = defineEmits<{
  edit: [group: ProfileGroup]
  members: [group: ProfileGroup]
  state: [group: ProfileGroup]
  delete: [group: ProfileGroup]
}>()
const { t } = useI18n()
const columns = computed<DataTableColumns<ProfileGroup>>(() => [
  {
    title: t('profileGroups.name'),
    key: 'name',
    minWidth: 240,
    render: (group) =>
      h('div', { class: 'group-name' }, [
        h('strong', group.name),
        h('span', group.description || t('profileGroups.noDescription')),
      ]),
  },
  {
    title: t('profileGroups.status'),
    key: 'status',
    width: 100,
    render: (group) =>
      h(NTag, { type: group.status === 'ENABLED' ? 'success' : 'default', bordered: false }, () =>
        t(group.status === 'ENABLED' ? 'profileGroups.enabled' : 'profileGroups.disabled'),
      ),
  },
  { title: t('profileGroups.priority'), key: 'priority', width: 100 },
  { title: t('profileGroups.profiles'), key: 'profileCount', width: 100 },
  { title: t('profileGroups.users'), key: 'userCount', width: 100 },
  {
    title: t('profileGroups.updated'),
    key: 'updatedAt',
    width: 130,
    render: (group) => h(NTime, { time: new Date(group.updatedAt), type: 'relative' }),
  },
  {
    title: t('profileGroups.actions'),
    key: 'actions',
    width: props.canManage ? 300 : 110,
    render: (group) =>
      h(NSpace, { size: 4, wrap: false }, () => [
        h(NButton, { size: 'small', secondary: true, onClick: () => emit('members', group) }, () =>
          t('profileGroups.members'),
        ),
        ...(props.canManage
          ? [
              h(
                NButton,
                { size: 'small', quaternary: true, onClick: () => emit('edit', group) },
                () => t('common.edit'),
              ),
              h(
                NButton,
                {
                  size: 'small',
                  quaternary: true,
                  loading: props.busyId === group.id,
                  onClick: () => emit('state', group),
                },
                () => t(group.status === 'ENABLED' ? 'common.disable' : 'common.enable'),
              ),
              h(
                NButton,
                {
                  size: 'small',
                  quaternary: true,
                  type: 'error',
                  disabled: props.busyId === group.id,
                  onClick: () => emit('delete', group),
                },
                () => t('common.delete'),
              ),
            ]
          : []),
      ]),
  },
])
</script>
<template>
  <div>
    <NDataTable
      v-if="!failed || items.length > 0"
      v-accessible-table-scroll="t('profileGroups.tableLabel')"
      :columns="columns"
      :data="items"
      :loading="loading"
      :row-key="(row) => row.id"
      :scroll-x="1170"
      :bordered="false"
      ><template #empty
        ><NEmpty v-if="!failed && !loading" :description="t('profileGroups.empty')" /></template
    ></NDataTable>
  </div>
</template>
<style scoped>
:deep(.group-name) {
  display: grid;
  gap: 4px;
}
:deep(.group-name span) {
  color: var(--text-secondary);
  font-size: 12px;
  white-space: normal;
  overflow-wrap: anywhere;
}
</style>
