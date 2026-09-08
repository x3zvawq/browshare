<script setup lang="ts">
import { computed, h } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NCard, NDataTable, NSpace, NTag, NTime, type DataTableColumns } from 'naive-ui'
import type { ManagedUser } from '@/api/types.js'
import { vAccessibleTableScroll } from '@/directives/accessible-table-scroll.js'
const props = defineProps<{
  items: ManagedUser[]
  currentUserId: string
  canManage: boolean
  busy: boolean
  rolesAvailable: boolean
}>()
const emit = defineEmits<{
  edit: [user: ManagedUser]
  roles: [user: ManagedUser]
  reset: [user: ManagedUser]
  state: [user: ManagedUser]
  delete: [user: ManagedUser]
}>()
const { t } = useI18n()
const columns = computed<DataTableColumns<ManagedUser>>(() => [
  {
    key: 'name',
    title: t('users.name'),
    width: 280,
    render: (u) =>
      h('div', { class: 'user-identity' }, [
        h('strong', u.displayName),
        h('span', u.email),
        h('small', u.id),
        ...(u.id === props.currentUserId
          ? [h(NTag, { size: 'small', type: 'info' }, () => t('users.self'))]
          : []),
      ]),
  },
  {
    key: 'state',
    title: t('users.status'),
    width: 120,
    render: (u) =>
      h(
        NTag,
        { size: 'small', type: u.state === 'ENABLED' ? 'success' : 'default', bordered: false },
        () => t(`users.${u.state}`),
      ),
  },
  {
    key: 'roles',
    title: t('users.roles'),
    width: 230,
    render: (u) => u.roleCodes.join(', ') || t('users.noRoles'),
  },
  {
    key: 'maximum',
    title: t('users.capacity'),
    width: 140,
    render: (u) =>
      u.maxActiveSessions === null ? t('users.unlimited') : String(u.maxActiveSessions),
  },
  {
    key: 'created',
    title: t('users.created'),
    width: 190,
    render: (u) => h(NTime, { time: new Date(u.createdAt), type: 'datetime' }),
  },
  {
    key: 'actions',
    title: t('users.actions'),
    width: props.canManage ? 470 : 160,
    render: (u) =>
      h(NSpace, { wrap: false }, () => [
        h(
          NButton,
          {
            size: 'small',
            disabled: props.busy || !props.rolesAvailable,
            onClick: () => emit('roles', u),
          },
          () => t('users.roles'),
        ),
        ...(props.canManage && u.state !== 'DELETED'
          ? [
              h(
                NButton,
                { size: 'small', disabled: props.busy, onClick: () => emit('edit', u) },
                () => t('common.edit'),
              ),
              h(
                NButton,
                { size: 'small', disabled: props.busy, onClick: () => emit('reset', u) },
                () => t('users.reset'),
              ),
              h(
                NButton,
                { size: 'small', disabled: props.busy, onClick: () => emit('state', u) },
                () => t(u.state === 'ENABLED' ? 'common.disable' : 'common.enable'),
              ),
              h(
                NButton,
                {
                  size: 'small',
                  type: 'error',
                  secondary: true,
                  disabled: props.busy,
                  onClick: () => emit('delete', u),
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
  <NCard :bordered="false"
    ><NDataTable
      v-accessible-table-scroll="t('users.table')"
      :columns="columns"
      :data="items"
      :row-key="(u: ManagedUser) => u.id"
      :scroll-x="canManage ? 1430 : 1120"
      :bordered="false"
      :single-line="false"
  /></NCard>
</template>
<style scoped>
:deep(.user-identity) {
  display: grid;
  gap: 6px;
  overflow-wrap: anywhere;
}
:deep(.user-identity small) {
  color: var(--bs-text-muted);
  font-size: 11px;
  font-family: var(--bs-font-mono);
}
</style>
