<script setup lang="ts">
import {
  AlertCircleOutline,
  CreateOutline,
  EyeOffOutline,
  EyeOutline,
  GitNetworkOutline,
  TrashOutline,
} from '@vicons/ionicons5'
import {
  NAlert,
  NButton,
  NCard,
  NDataTable,
  NEmpty,
  NIcon,
  NSpace,
  NTag,
  NTime,
  type DataTableColumns,
} from 'naive-ui'
import { computed, h, onMounted, onScopeDispose, shallowRef, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { vAccessibleTableScroll } from '@/directives/accessible-table-scroll.js'
import type { Proxy } from '@/api/types.js'
import ProxyProbeSummary from './ProxyProbeSummary.vue'
import { proxyRuntimeMessages } from './messages.js'

const props = defineProps<{
  readonly items: readonly Proxy[]
  readonly loading: boolean
  readonly loadingMore: boolean
  readonly hasMore: boolean
  readonly error: string | null
  readonly requestId: string | undefined
  readonly errorCode: string | undefined
  readonly canManage: boolean
  readonly canProbe: boolean
  readonly busyProxyId: string | undefined
}>()

const emit = defineEmits<{
  refresh: []
  loadMore: []
  edit: [proxy: Proxy]
  probe: [proxy: Proxy]
  delete: [proxy: Proxy]
}>()

const { t } = useI18n({ messages: proxyRuntimeMessages })
const revealedCredentialIds = shallowRef<ReadonlySet<string>>(new Set())
const tableData = computed(() => [...props.items])
const tableContainer = useTemplateRef<HTMLDivElement>('tableContainer')
const fixedColumns = shallowRef(false)
let resizeObserver: ResizeObserver | undefined

onMounted(() => {
  const container = tableContainer.value
  if (!container) return
  // The sidebar changes the table width independently of the browser viewport.
  const updateWidth = () => {
    fixedColumns.value = container.clientWidth >= 768
  }
  updateWidth()
  resizeObserver = new ResizeObserver(updateWidth)
  resizeObserver.observe(container)
})
onScopeDispose(() => resizeObserver?.disconnect())

const columns = computed<DataTableColumns<Proxy>>(() => {
  const proxyColumns: DataTableColumns<Proxy> = [
    {
      title: t('proxies.columns.proxy'),
      key: 'proxy',
      width: 250,
      ...(fixedColumns.value ? { fixed: 'left' as const } : {}),
      render: (proxy) =>
        h('div', { class: 'proxy-cell' }, [h('strong', proxy.name), h('small', proxy.id)]),
    },
    {
      title: t('proxies.columns.endpoint'),
      key: 'endpoint',
      width: 240,
      render: (proxy) =>
        h('div', { class: 'stacked-cell' }, [
          h(NTag, { size: 'small', bordered: false, type: typeTagType(proxy.type) }, () =>
            t(`proxies.type.${proxy.type}`),
          ),
          h(
            'span',
            proxy.type === 'DIRECT'
              ? t('proxies.directEndpoint')
              : formatEndpoint(proxy.host, proxy.port),
          ),
        ]),
    },
    {
      title: t('proxies.columns.credentials'),
      key: 'credentials',
      width: 280,
      render: (proxy) => renderCredentials(proxy),
    },
    {
      title: t('proxies.columns.health'),
      key: 'health',
      width: 350,
      render: (proxy) => h(ProxyProbeSummary, { proxy }),
    },
    {
      title: t('proxies.columns.profiles'),
      key: 'assignedProfileCount',
      width: 150,
      render: (proxy) =>
        h(
          'strong',
          { class: 'numeric-cell' },
          t('proxies.profileCount', { count: proxy.assignedProfileCount }),
        ),
    },
    {
      title: t('proxies.columns.updated'),
      key: 'updatedAt',
      width: 150,
      render: (proxy) => h(NTime, { time: new Date(proxy.updatedAt), type: 'relative' }),
    },
  ]
  if (props.canManage) {
    proxyColumns.push({
      title: t('proxies.columns.actions'),
      key: 'actions',
      width: props.canProbe ? 260 : 150,
      ...(fixedColumns.value ? { fixed: 'right' as const } : {}),
      render: (proxy) => {
        const busy = props.busyProxyId === proxy.id
        return h(NSpace, { size: 4, wrap: false }, () => [
          ...(props.canProbe
            ? [
                h(
                  NButton,
                  {
                    size: 'small',
                    secondary: true,
                    disabled: busy,
                    'aria-label': `${t('proxyProbe.action')} · ${proxy.name}`,
                    onClick: () => emit('probe', proxy),
                  },
                  () => t('proxyProbe.action'),
                ),
              ]
            : []),
          h(
            NButton,
            {
              size: 'small',
              quaternary: true,
              disabled: busy,
              onClick: () => emit('edit', proxy),
            },
            {
              icon: () => h(NIcon, { component: CreateOutline, 'aria-hidden': true }),
              default: () => t('common.edit'),
            },
          ),
          h(
            NButton,
            {
              size: 'small',
              quaternary: true,
              type: 'error',
              loading: busy,
              disabled: proxy.assignedProfileCount > 0,
              onClick: () => emit('delete', proxy),
            },
            {
              icon: () => h(NIcon, { component: TrashOutline, 'aria-hidden': true }),
              default: () => t('common.delete'),
            },
          ),
        ])
      },
    })
  }
  return proxyColumns
})

function renderCredentials(proxy: Proxy) {
  if (!proxy.credentials.hasUsername && !proxy.credentials.hasPassword) {
    return h('span', { class: 'muted-cell' }, t('proxies.noCredentials'))
  }
  if (!proxy.credentials.readable) {
    return h('div', { class: 'stacked-cell' }, [
      h('strong', t('proxies.credentialsConfigured')),
      h('span', t('proxies.credentialsPermissionRequired')),
    ])
  }
  const revealed = revealedCredentialIds.value.has(proxy.id)
  return h('div', { class: 'credential-cell' }, [
    h('div', { class: 'credential-copy' }, [
      h(
        'strong',
        proxy.credentials.hasUsername
          ? revealed
            ? (proxy.credentials.username ?? '')
            : maskValue(proxy.credentials.username)
          : t('proxies.noUsername'),
      ),
      h(
        'span',
        proxy.credentials.hasPassword
          ? revealed
            ? (proxy.credentials.password ?? '')
            : maskValue(proxy.credentials.password)
          : t('proxies.noPassword'),
      ),
    ]),
    h(
      NButton,
      {
        quaternary: true,
        circle: true,
        size: 'small',
        'aria-label': revealed
          ? t('proxies.hideCredentials', { name: proxy.name })
          : t('proxies.showCredentials', { name: proxy.name }),
        onClick: () => toggleCredentials(proxy.id),
      },
      {
        icon: () =>
          h(NIcon, { component: revealed ? EyeOffOutline : EyeOutline, 'aria-hidden': true }),
      },
    ),
  ])
}

function toggleCredentials(proxyId: string): void {
  const next = new Set(revealedCredentialIds.value)
  if (next.has(proxyId)) next.delete(proxyId)
  else next.add(proxyId)
  revealedCredentialIds.value = next
}

function maskValue(value: string | null): string {
  return value === null ? '' : '•'.repeat(Math.min(Math.max(value.length, 6), 14))
}

function formatEndpoint(host: string | null, port: number | null): string {
  if (host === null || port === null) return t('proxies.invalidEndpoint')
  return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`
}

function typeTagType(type: Proxy['type']): 'default' | 'success' | 'info' | 'warning' {
  if (type === 'DIRECT') return 'default'
  if (type === 'HTTPS') return 'success'
  if (type === 'SOCKS5') return 'info'
  return 'warning'
}
</script>

<template>
  <NCard class="proxy-table-card" :bordered="true">
    <div class="table-heading">
      <div class="table-heading-icon">
        <NIcon aria-hidden="true" :component="GitNetworkOutline" :size="21" />
      </div>
      <div>
        <div class="table-title-line">
          <h2>{{ $t('proxies.listTitle') }}</h2>
          <NTag v-if="items.length" size="small" round :bordered="false">{{ items.length }}</NTag>
        </div>
        <p>{{ $t('proxies.listDescription') }}</p>
      </div>
    </div>

    <NAlert v-if="error" class="table-alert" type="error" role="alert" :title="error">
      <div class="alert-content">
        <code v-if="errorCode">{{ errorCode }}</code>
        <span v-if="requestId">{{ $t('common.requestId') }}: {{ requestId }}</span>
        <NButton text type="primary" @click="$emit('refresh')">{{ $t('common.retry') }}</NButton>
      </div>
    </NAlert>

    <div ref="tableContainer">
      <NDataTable
        v-if="!error || items.length > 0"
        v-accessible-table-scroll="t('proxies.tableScrollLabel')"
        class="proxy-table"
        :columns="columns"
        :data="tableData"
        :loading="loading"
        :row-key="(proxy: Proxy) => proxy.id"
        :scroll-x="canProbe ? 1680 : canManage ? 1570 : 1420"
        striped
      >
        <template #empty>
          <NEmpty v-if="!error && !loading" :description="$t('proxies.empty')">
            <template #icon><NIcon :component="AlertCircleOutline" /></template>
          </NEmpty>
        </template>
      </NDataTable>
    </div>

    <div class="table-footer">
      <span>{{ $t('proxies.loadedCount', { count: items.length }) }}</span>
      <NButton v-if="hasMore" :loading="loadingMore" @click="$emit('loadMore')">
        {{ $t('proxies.loadMore') }}
      </NButton>
    </div>
  </NCard>
</template>

<style scoped>
.proxy-table-card {
  width: 100%;
  min-width: 0;
}

.table-heading,
.table-title-line,
.alert-content,
.table-footer,
.credential-cell {
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

.alert-content,
.table-footer {
  justify-content: space-between;
  gap: 16px;
}

.proxy-table {
  margin-top: 20px;
}

.proxy-table :deep(.proxy-cell),
.proxy-table :deep(.stacked-cell),
.credential-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.proxy-table :deep(.proxy-cell strong),
.proxy-table :deep(.stacked-cell strong),
.proxy-table :deep(.credential-copy strong),
.numeric-cell {
  overflow: hidden;
  color: var(--bs-text);
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.proxy-cell small {
  overflow: hidden;
  color: color-mix(in srgb, var(--bs-text-muted) 72%, transparent);
  font-family: var(--bs-font-mono);
  font-size: 9px;
  text-overflow: ellipsis;
}

.proxy-table :deep(.stacked-cell span),
.proxy-table :deep(.credential-copy span),
.muted-cell {
  overflow: hidden;
  color: var(--bs-text-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.credential-cell {
  min-width: 0;
  justify-content: space-between;
  gap: 8px;
}

.credential-copy {
  flex: 1;
}

.proxy-table :deep(.credential-copy strong),
.credential-copy span {
  font-family: var(--bs-font-mono);
}

.numeric-cell {
  font-variant-numeric: tabular-nums;
  font-size: 12px;
}

.table-footer {
  min-height: 44px;
  border-top: 1px solid var(--bs-border);
  margin-top: 8px;
  padding-top: 14px;
  color: var(--bs-text-muted);
  font-size: 11px;
}
</style>
