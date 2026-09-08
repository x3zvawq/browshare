<script setup lang="ts">
import { AlertCircleOutline, LayersOutline } from '@vicons/ionicons5'
import {
  NAlert,
  NButton,
  NCard,
  NDataTable,
  NEmpty,
  NIcon,
  NProgress,
  NSpace,
  NTag,
  NTime,
  type DataTableColumns,
} from 'naive-ui'
import { computed, h } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import { vAccessibleTableScroll } from '@/directives/accessible-table-scroll.js'
import type { Profile } from '@/api/types.js'
import ProfileStorageStatus from '@/components/storage/ProfileStorageStatus.vue'
import { storageMessages } from '@/components/storage/messages.js'
import RuntimeRouteStatus from '@/components/proxies/RuntimeRouteStatus.vue'
import { proxyRuntimeMessages } from '@/components/proxies/messages.js'
import ProfileActions from './ProfileActions.vue'
import { profileRuntimeMessages } from './runtime-messages.js'

const props = defineProps<{
  readonly items: readonly Profile[]
  readonly loading: boolean
  readonly loadingMore: boolean
  readonly hasMore: boolean
  readonly error: string | null
  readonly requestId: string | undefined
  readonly errorCode: string | undefined
  readonly canManage: boolean
  readonly canMaintain: boolean
  readonly busyProfileId: string | undefined
  readonly runtimePending: ReadonlySet<string>
}>()

const emit = defineEmits<{
  refresh: []
  loadMore: []
  edit: [profile: Profile]
  grants: [profile: Profile]
  setRuntime: [profile: Profile, action: 'START' | 'STOP']
  recoverRuntime: [profile: Profile]
  toggleState: [profile: Profile]
  delete: [profile: Profile]
}>()

const { t } = useI18n({
  messages: {
    'zh-CN': {
      ...proxyRuntimeMessages['zh-CN'],
      ...storageMessages['zh-CN'],
      ...profileRuntimeMessages['zh-CN'],
    },
    'en-US': {
      ...proxyRuntimeMessages['en-US'],
      ...storageMessages['en-US'],
      ...profileRuntimeMessages['en-US'],
    },
  },
})
const tableData = computed(() => [...props.items])

const columns = computed<DataTableColumns<Profile>>(() => {
  const profileColumns: DataTableColumns<Profile> = [
    {
      title: t('profiles.columns.profile'),
      key: 'profile',
      width: 270,
      render: (profile) =>
        h('div', { class: 'profile-cell' }, [
          h('strong', profile.name),
          h('span', profile.description?.trim() || t('profiles.noDescription')),
          h('small', profile.id),
          props.canMaintain
            ? h(RouterLink, { to: { name: 'maintenance', query: { profileId: profile.id } } }, () =>
                t('maintenance.title'),
              )
            : null,
          h(RouterLink, { to: '/admin/profiles/' + profile.id + '/page-script' }, () =>
            t('pageScript.title'),
          ),
          h(RouterLink, { to: '/admin/profiles/' + profile.id + '/navigation-policy' }, () =>
            t('navigationPolicy.title'),
          ),
        ]),
    },
    {
      title: t('profiles.columns.status'),
      key: 'status',
      width: 180,
      render: (profile) =>
        h(NSpace, { size: 6, wrap: true }, () => [
          h(
            NTag,
            {
              size: 'small',
              round: true,
              bordered: false,
              type: profile.businessStatus === 'ENABLED' ? 'success' : 'default',
            },
            () => t(`profiles.businessStatus.${profile.businessStatus}`),
          ),
          h(
            NTag,
            {
              size: 'small',
              round: true,
              bordered: false,
              type: runtimeTagType(profile.runtimeState),
            },
            () => t(`profiles.runtimeState.${profile.runtimeState}`),
          ),
          ...(profile.deleteRequestedAt === null &&
          profile.runtimeErrorCode === 'PROFILE_DATA_MISSING'
            ? [
                h(
                  'small',
                  {
                    style: { maxWidth: '200px', whiteSpace: 'normal' },
                    title: 'PROFILE_DATA_MISSING',
                  },
                  t('runtimeRecovery.dataMissing'),
                ),
              ]
            : []),
          ...(profile.deleteRequestedAt === null &&
          profile.runtimeErrorCode !== 'PROFILE_DATA_MISSING' &&
          profile.runtimeMode === 'ALWAYS_ON' &&
          profile.runtimeState === 'ERROR' &&
          profile.runtimeFailureCount > 0
            ? [
                h(
                  'small',
                  { style: { maxWidth: '160px', whiteSpace: 'normal' } },
                  t(
                    profile.runtimeFailureCount >= 5
                      ? 'profiles.runtime.recoveryStopped'
                      : 'profiles.runtime.recoveryWaiting',
                    { count: profile.runtimeFailureCount },
                  ),
                ),
              ]
            : []),
          ...(profile.deleteRequestedAt === null
            ? []
            : [
                h(NTag, { size: 'small', round: true, bordered: false, type: 'error' }, () =>
                  t('profiles.deletion.pending'),
                ),
                h(
                  'small',
                  {
                    style: { display: 'block', maxWidth: '160px', whiteSpace: 'normal' },
                    title: profile.runtimeErrorCode ?? undefined,
                  },
                  t(
                    `profiles.deletion.${profile.runtimeErrorCode ? 'retrying' : profile.capacity.activeSessions > 0 ? 'closingSessions' : !['ONLINE', 'DRAINING'].includes(profile.worker.state) ? 'waitingWorker' : 'cleaning'}`,
                  ),
                ),
              ]),
        ]),
    },
    {
      title: t('runtimeRoute.title'),
      key: 'runtimeProxyHealth',
      width: 280,
      render: (profile) =>
        h('div', { class: 'route-summary' }, [
          h(
            'small',
            `${t('runtimeRoute.configured')}: ${profile.proxy?.name ?? t('runtimeRoute.direct')}`,
          ),
          h(RuntimeRouteStatus, {
            route: profile,
            runtimeState: profile.runtimeState,
            activeSessions: profile.capacity.activeSessions,
            compact: true,
          }),
        ]),
    },
    {
      title: t('profiles.columns.worker'),
      key: 'worker',
      width: 190,
      render: (profile) =>
        h('div', { class: 'worker-cell' }, [
          h('strong', profile.worker.name),
          h(
            NTag,
            {
              size: 'small',
              bordered: false,
              type: workerTagType(profile.worker.state),
            },
            () => t(`profiles.workerState.${profile.worker.state}`),
          ),
        ]),
    },
    {
      title: t('profiles.columns.groups'),
      key: 'groups',
      width: 230,
      render: (profile) => {
        if (profile.groups.length === 0) {
          return h('span', { class: 'muted-cell' }, t('profiles.noGroups'))
        }
        const visibleGroups = profile.groups.slice(0, 3)
        return h(NSpace, { size: 5, wrap: true }, () => [
          ...visibleGroups.map((group) =>
            h(
              NTag,
              {
                key: group.id,
                size: 'small',
                bordered: false,
                type: group.status === 'ENABLED' ? 'info' : 'default',
              },
              () => group.name,
            ),
          ),
          ...(profile.groups.length > visibleGroups.length
            ? [h(NTag, { size: 'small', bordered: false }, () => `+${profile.groups.length - 3}`)]
            : []),
        ])
      },
    },
    {
      title: t('profiles.columns.access'),
      key: 'access',
      width: 180,
      render: (profile) =>
        h('div', { class: 'stacked-cell' }, [
          h('strong', t(`profiles.runtimeMode.${profile.runtimeMode}`)),
          h('span', t(`profiles.visibility.${profile.visibility}`)),
          h(
            'span',
            profile.proxy === null
              ? t('profiles.directConnection')
              : t('profiles.proxyConnection', { name: profile.proxy.name }),
          ),
        ]),
    },
    {
      title: t('profiles.columns.capacity'),
      key: 'capacity',
      width: 210,
      render: (profile) => {
        const maximum = profile.capacity.maxNormalSessions
        const percentage =
          maximum === null
            ? 0
            : maximum === 0
              ? 100
              : Math.min(100, Math.round((profile.capacity.activeSessions / maximum) * 100))
        return h('div', { class: 'capacity-cell' }, [
          h('div', { class: 'capacity-heading' }, [
            h(
              'strong',
              maximum === null
                ? t('profiles.capacity.unlimitedValue', {
                    active: profile.capacity.activeSessions,
                  })
                : t('profiles.capacity.limitedValue', {
                    active: profile.capacity.activeSessions,
                    maximum,
                  }),
            ),
            h(
              NTag,
              {
                size: 'small',
                round: true,
                bordered: false,
                type: capacityTagType(profile.capacity.state),
              },
              () => t(`profiles.capacityState.${profile.capacity.state}`),
            ),
          ]),
          ...(maximum === null
            ? []
            : [
                h(NProgress, {
                  type: 'line',
                  percentage,
                  height: 5,
                  borderRadius: 3,
                  showIndicator: false,
                  status: capacityProgressStatus(profile.capacity.state),
                  'aria-label': t('profiles.capacity.progressLabel', {
                    name: profile.name,
                    active: profile.capacity.activeSessions,
                    maximum,
                  }),
                }),
              ]),
        ])
      },
    },
    {
      title: t('storage.title'),
      key: 'storage',
      width: 280,
      render: (profile) => h(ProfileStorageStatus, { profile, compact: true }),
    },
    {
      title: t('profiles.columns.updated'),
      key: 'updatedAt',
      width: 150,
      render: (profile) => h(NTime, { time: new Date(profile.updatedAt), type: 'relative' }),
    },
  ]
  if (props.canManage) {
    profileColumns.push({
      title: t('profiles.columns.actions'),
      key: 'actions',
      width: 180,
      render: (profile) =>
        h(ProfileActions, {
          profile,
          busy: props.busyProfileId === profile.id,
          runtimeBusy: props.runtimePending.has(profile.id),
          onEdit: (item) => emit('edit', item),
          onGrants: (item) => emit('grants', item),
          onSetRuntime: (item, action) => emit('setRuntime', item, action),
          onRecoverRuntime: (item) => emit('recoverRuntime', item),
          onToggleState: (item) => emit('toggleState', item),
          onDelete: (item) => emit('delete', item),
        }),
    })
  }
  return profileColumns
})

function runtimeTagType(
  state: Profile['runtimeState'],
): 'default' | 'success' | 'warning' | 'error' | 'info' {
  if (state === 'RUNNING') return 'success'
  if (state === 'MAINTAINING') return 'warning'
  if (state === 'ERROR') return 'error'
  if (state === 'STARTING' || state === 'STOPPING') return 'info'
  return 'default'
}

function workerTagType(
  state: Profile['worker']['state'],
): 'default' | 'success' | 'warning' | 'error' {
  if (state === 'ONLINE') return 'success'
  if (state === 'DRAINING' || state === 'PENDING') return 'warning'
  if (state === 'DISABLED') return 'error'
  return 'default'
}

function capacityTagType(
  state: Profile['capacity']['state'],
): 'default' | 'success' | 'warning' | 'error' {
  if (state === 'AVAILABLE') return 'success'
  if (state === 'FULL') return 'warning'
  if (state === 'OVER_LIMIT') return 'error'
  return 'default'
}

function capacityProgressStatus(
  state: Profile['capacity']['state'],
): 'default' | 'success' | 'warning' | 'error' {
  if (state === 'OVER_LIMIT') return 'error'
  if (state === 'FULL') return 'warning'
  return 'success'
}
</script>

<template>
  <NCard class="profile-table-card" :bordered="true">
    <div class="table-heading">
      <div class="table-heading-icon">
        <NIcon aria-hidden="true" :component="LayersOutline" :size="21" />
      </div>
      <div>
        <div class="table-title-line">
          <h2>{{ $t('profiles.listTitle') }}</h2>
          <NTag v-if="items.length" size="small" round :bordered="false">{{ items.length }}</NTag>
        </div>
        <p>{{ $t('profiles.listDescription') }}</p>
      </div>
    </div>

    <NAlert v-if="error" class="table-alert" type="error" role="alert" :title="error">
      <div class="alert-content">
        <code v-if="errorCode">{{ errorCode }}</code>
        <span v-if="requestId">{{ $t('common.requestId') }}: {{ requestId }}</span>
        <NButton text type="primary" @click="$emit('refresh')">{{ $t('common.retry') }}</NButton>
      </div>
    </NAlert>

    <NDataTable
      v-if="!error || items.length > 0"
      v-accessible-table-scroll="t('profiles.tableScrollLabel')"
      class="profile-table"
      :columns="columns"
      :data="tableData"
      :loading="loading"
      :row-key="(profile: Profile) => profile.id"
      :scroll-x="canManage ? 2150 : 1970"
      striped
    >
      <template #empty>
        <NEmpty v-if="!error && !loading" :description="$t('profiles.empty')">
          <template #icon>
            <NIcon :component="AlertCircleOutline" />
          </template>
        </NEmpty>
      </template>
    </NDataTable>

    <div class="table-footer">
      <span>{{ $t('profiles.loadedCount', { count: items.length }) }}</span>
      <NButton v-if="hasMore" :loading="loadingMore" @click="$emit('loadMore')">
        {{ $t('profiles.loadMore') }}
      </NButton>
    </div>
  </NCard>
</template>

<style scoped>
.profile-table-card {
  width: 100%;
  min-width: 0;
}

.table-heading,
.table-title-line,
.alert-content,
.table-footer,
.profile-table :deep(.worker-cell),
.capacity-heading {
  display: flex;
  align-items: center;
}

.table-heading {
  gap: 13px;
}

.table-heading-icon {
  display: grid;
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 9px;
  background: rgb(15 98 214 / 10%);
  color: var(--bs-primary);
}

.table-title-line {
  gap: 8px;
}

.table-heading h2 {
  margin: 0;
  color: var(--bs-text);
  font-size: 17px;
  font-weight: 680;
}

.table-heading p {
  margin: 5px 0 0;
  color: var(--bs-text-muted);
  font-size: 13px;
}

.table-alert {
  margin-top: 18px;
}

.alert-content {
  justify-content: space-between;
  gap: 16px;
}

.profile-table {
  margin-top: 20px;
}

.profile-table :deep(.profile-cell),
.profile-table :deep(.stacked-cell),
.capacity-cell {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.profile-cell {
  gap: 3px;
}

.profile-table :deep(.profile-cell strong),
.profile-table :deep(.stacked-cell strong),
.profile-table :deep(.worker-cell strong),
.capacity-heading strong {
  color: var(--bs-text);
  font-weight: 650;
}

.profile-table :deep(.profile-cell span),
.profile-table :deep(.stacked-cell span),
.muted-cell {
  overflow: hidden;
  color: var(--bs-text-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-cell small {
  overflow: hidden;
  color: color-mix(in srgb, var(--bs-text-muted) 72%, transparent);
  font-family: var(--bs-font-mono);
  font-size: 9px;
  text-overflow: ellipsis;
}

.worker-cell {
  justify-content: space-between;
  gap: 8px;
}

.stacked-cell {
  gap: 3px;
}

.capacity-cell {
  gap: 8px;
}

.capacity-heading {
  justify-content: space-between;
  gap: 8px;
}

.capacity-heading strong {
  font-variant-numeric: tabular-nums;
  font-size: 12px;
}

.table-footer {
  min-height: 44px;
  justify-content: space-between;
  gap: 16px;
  border-top: 1px solid var(--bs-border);
  margin-top: 8px;
  padding-top: 14px;
  color: var(--bs-text-muted);
  font-size: 11px;
}
</style>
