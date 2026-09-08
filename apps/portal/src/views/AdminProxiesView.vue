<script setup lang="ts">
import { useAppDialog as useDialog } from '@/composables/useAppDialog.js'
import { AddOutline, KeyOutline } from '@vicons/ionicons5'
import { NButton, NIcon, useMessage } from 'naive-ui'
import { computed, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { api } from '@/api/client.js'
import { ApiFailure, apiFailure, networkFailure } from '@/api/errors.js'
import type { CreateProxyInput, Proxy, UpdateProxyInput } from '@/api/types.js'
import AppShell from '@/components/layout/AppShell.vue'
import LiveUpdateStatus from '@/components/status/LiveUpdateStatus.vue'
import ProxyDataTable from '@/components/proxies/ProxyDataTable.vue'
import ProxyEditorModal from '@/components/proxies/ProxyEditorModal.vue'
import ProxyProbeModal from '@/components/proxies/ProxyProbeModal.vue'
import ProxyListToolbar from '@/components/proxies/ProxyListToolbar.vue'
import { useAdminProxies } from '@/composables/useAdminProxies.js'
import { useSessionStore } from '@/stores/session.js'

const session = useSessionStore()
const router = useRouter()
const dialog = useDialog()
const message = useMessage()
const { t } = useI18n()
const loggingOut = shallowRef(false)
const editorOpen = shallowRef(false)
const editingProxy = shallowRef<Proxy | null>(null)
const probingProxy = shallowRef<Proxy | null>(null)
const mutationBusy = shallowRef(false)
const mutationError = shallowRef<ApiFailure | null>(null)
const busyProxyId = shallowRef<string>()

const {
  filters,
  items,
  nextCursor,
  loading,
  loadingMore,
  error,
  liveState,
  lastReadAt,
  refreshing,
  refreshLive,
  refresh,
  loadMore,
  setSearch,
  setType,
  setHealthStatus,
  clearFilters,
} = useAdminProxies()

const canManage = computed(() => session.user?.permissions.includes('proxy.manage') ?? false)
const canProbe = computed(
  () => canManage.value && (session.user?.permissions.includes('worker.read') ?? false),
)
const currentProbeProxy = computed(() =>
  probingProxy.value
    ? (items.value.find((item) => item.id === probingProxy.value?.id) ?? probingProxy.value)
    : null,
)
const canReadCredentials = computed(
  () => session.user?.permissions.includes('proxy.credential.read') ?? false,
)

function openCreate(): void {
  editingProxy.value = null
  mutationError.value = null
  editorOpen.value = true
}

function openEdit(proxy: Proxy): void {
  probingProxy.value = null
  editingProxy.value = proxy
  mutationError.value = null
  editorOpen.value = true
}

function closeEditor(): void {
  if (mutationBusy.value) return
  editorOpen.value = false
  editingProxy.value = null
  mutationError.value = null
}

async function saveProxy(input: CreateProxyInput | UpdateProxyInput): Promise<void> {
  mutationBusy.value = true
  mutationError.value = null
  try {
    const proxy = editingProxy.value
    if (proxy === null) {
      const {
        data,
        error: responseError,
        response,
      } = await api.POST('/proxies', {
        body: input as CreateProxyInput,
      })
      if (data === undefined) throw apiFailure(responseError, response)
      message.success(t('proxies.editor.created', { name: data.name }))
    } else {
      const {
        data,
        error: responseError,
        response,
      } = await api.PATCH('/proxies/{proxyId}', {
        params: { path: { proxyId: proxy.id } },
        body: input as UpdateProxyInput,
      })
      if (data === undefined) throw apiFailure(responseError, response)
      message.success(t('proxies.editor.updated', { name: data.name }))
    }
    editorOpen.value = false
    editingProxy.value = null
    await refresh()
  } catch (cause) {
    mutationError.value = cause instanceof ApiFailure ? cause : networkFailure(cause)
  } finally {
    mutationBusy.value = false
  }
}

function confirmDeletion(proxy: Proxy): void {
  dialog.warning({
    title: t('proxies.deletion.title'),
    content: t('proxies.deletion.description', { name: proxy.name }),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    positiveButtonProps: { type: 'error' },
    onPositiveClick: () => deleteProxy(proxy),
  })
}

async function deleteProxy(proxy: Proxy): Promise<boolean> {
  busyProxyId.value = proxy.id
  try {
    const { error: responseError, response } = await api.DELETE('/proxies/{proxyId}', {
      params: { path: { proxyId: proxy.id } },
    })
    if (!response.ok) throw apiFailure(responseError, response)
    message.success(t('proxies.deletion.deleted', { name: proxy.name }))
    await refresh()
    return true
  } catch (cause) {
    message.error(localizedMutationError(cause))
    return false
  } finally {
    busyProxyId.value = undefined
  }
}

async function logout(): Promise<void> {
  loggingOut.value = true
  try {
    await session.logout()
  } catch {
    message.warning(t('auth.logoutLocalOnly'))
  } finally {
    loggingOut.value = false
    await router.replace({ name: 'login', query: { reason: 'signed-out' } })
  }
}

function localizedListError(failure: ApiFailure | null): string | null {
  if (failure === null) return null
  if (failure.code === 'NETWORK_ERROR') return t('proxies.errors.network')
  if (failure.code === 'FORBIDDEN') return t('proxies.errors.forbidden')
  if (failure.code === 'BAD_REQUEST' || failure.code === 'VALIDATION_FAILED') {
    return t('proxies.errors.invalidFilter')
  }
  return t('proxies.errors.generic')
}

function localizedMutationError(cause: unknown, includeRequestId = true): string {
  const failure = networkFailure(cause)
  return `${localizedMutationErrorTitle(cause)} · ${failure.code}${includeRequestId && failure.requestId ? ` · ${failure.requestId}` : ''}`
}

function localizedMutationErrorTitle(cause: unknown): string {
  const failure = cause instanceof ApiFailure ? cause : networkFailure(cause)
  if (failure.code === 'NETWORK_ERROR') return t('proxies.errors.network')
  if (failure.code === 'FORBIDDEN') return t('proxies.errors.forbidden')
  if (failure.code === 'NOT_FOUND') return t('proxies.editor.errors.notFound')
  if (failure.code === 'PROXY_IN_USE') return t('proxies.editor.errors.inUse')
  if (failure.code === 'CONFLICT') return t('proxies.editor.errors.conflict')
  if (failure.code === 'BAD_REQUEST' || failure.code === 'VALIDATION_FAILED') {
    return t('proxies.editor.errors.invalid')
  }
  return t('proxies.editor.errors.generic')
}
</script>

<template>
  <AppShell
    v-if="session.user"
    :user="session.user"
    :busy="loggingOut"
    :breadcrumb-group="$t('layout.administrationGroup')"
    :breadcrumb-title="$t('layout.proxies')"
    @logout="logout"
  >
    <section class="page-heading">
      <div>
        <p class="page-eyebrow">EGRESS CONTROL</p>
        <h1>{{ $t('proxies.title') }}</h1>
        <p>{{ $t('proxies.description') }}</p>
      </div>
      <NButton v-if="canManage" type="primary" size="large" @click="openCreate">
        <template #icon><NIcon aria-hidden="true" :component="AddOutline" /></template>
        {{ $t('proxies.createAction') }}
      </NButton>
      <div v-else class="read-only-badge">
        <NIcon aria-hidden="true" :component="KeyOutline" :size="18" />
        <span>{{ $t('proxies.readOnly') }}</span>
      </div>
    </section>

    <section class="proxy-list-section">
      <LiveUpdateStatus
        :state="liveState"
        :last-read-at="lastReadAt"
        :busy="refreshing"
        @refresh="refreshLive"
      />
      <ProxyListToolbar
        :search="filters.search"
        :type="filters.type"
        :health-status="filters.healthStatus"
        :loading="loading"
        @search="setSearch"
        @type="setType"
        @health-status="setHealthStatus"
        @clear="clearFilters"
        @refresh="refresh"
      />

      <ProxyDataTable
        :items="items"
        :loading="loading"
        :loading-more="loadingMore"
        :has-more="nextCursor !== null"
        :error="localizedListError(error)"
        :request-id="error?.requestId"
        :error-code="error?.code"
        :can-manage="canManage"
        :can-probe="canProbe"
        :busy-proxy-id="busyProxyId"
        @refresh="refresh"
        @load-more="loadMore"
        @edit="openEdit"
        @probe="probingProxy = $event"
        @delete="confirmDeletion"
      />
    </section>

    <ProxyProbeModal
      v-if="currentProbeProxy && canProbe"
      :key="currentProbeProxy.id"
      :proxy="currentProbeProxy"
      @close="probingProxy = null"
      @completed="refresh"
      @edit="openEdit"
    />

    <ProxyEditorModal
      :show="editorOpen"
      :proxy="editingProxy"
      :can-read-credentials="canReadCredentials"
      :busy="mutationBusy"
      :error="mutationError ? localizedMutationError(mutationError, false) : null"
      :request-id="mutationError?.requestId"
      @close="closeEditor"
      @submit="saveProxy"
    />
  </AppShell>
</template>

<style scoped>
.page-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
}

.page-heading h1 {
  margin: 0;
  color: var(--bs-text);
  font-size: clamp(25px, 3vw, 34px);
  letter-spacing: -0.035em;
}

.page-heading > div > p:last-child {
  max-width: 760px;
  margin: 10px 0 0;
  color: var(--bs-text-muted);
  line-height: 1.65;
}

.page-eyebrow {
  margin: 0 0 7px;
  color: var(--bs-primary);
  font-size: 10px;
  font-weight: 760;
  letter-spacing: 0.13em;
}

.read-only-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--bs-border);
  border-radius: 8px;
  background: var(--bs-surface);
  padding: 9px 12px;
  color: var(--bs-text-muted);
  font-size: 12px;
}

.proxy-list-section {
  display: grid;
  min-width: 0;
  gap: 18px;
  margin-top: 28px;
}

@media (max-width: 680px) {
  .page-heading {
    align-items: stretch;
    flex-direction: column;
  }

  .page-heading :deep(.n-button) {
    width: 100%;
  }
}
</style>
