<script setup lang="ts">
import { onScopeDispose, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { NButton, NSkeleton, NTag, NTime, useMessage } from 'naive-ui'
import { api } from '@/api/client.js'
import { apiFailure, networkFailure, type ApiFailure } from '@/api/errors.js'
import type { ManagedWorker } from '@/api/types.js'
import WorkerStoragePanel from '@/components/storage/WorkerStoragePanel.vue'
import { storageMessages } from '@/components/storage/messages.js'
import WorkerMetrics from './WorkerMetrics.vue'
import WorkerControls from './WorkerControls.vue'
import WorkerCredentials from './WorkerCredentials.vue'
import WorkerRequestError from './WorkerRequestError.vue'
import WorkerCleanupStatus from './WorkerCleanupStatus.vue'
const props = defineProps<{ id: string; canManage: boolean }>(),
  { t, te } = useI18n({ messages: storageMessages }),
  router = useRouter(),
  message = useMessage()
const worker = shallowRef<ManagedWorker | null>(null),
  error = shallowRef<ApiFailure | null>(null),
  loading = shallowRef(false)
let controller: AbortController | undefined
async function load() {
  controller?.abort()
  const current = new AbortController()
  controller = current
  loading.value = true
  try {
    const r = await api.GET('/workers/{workerId}', {
      params: { path: { workerId: props.id } },
      signal: current.signal,
    })
    if (!r.data) throw apiFailure(r.error, r.response)
    if (!current.signal.aborted) {
      worker.value = r.data
      error.value = null
    }
  } catch (cause) {
    if (!current.signal.aborted) error.value = networkFailure(cause)
  } finally {
    if (controller === current) loading.value = false
  }
}
async function copy() {
  try {
    await navigator.clipboard.writeText(props.id)
    message.success(t('workerManagement.copied'))
  } catch {
    message.error(t('workerManagement.failed'))
  }
}
void load()
const timer = window.setInterval(() => {
  if (document.visibilityState === 'visible' && !loading.value) void load()
}, 5000)
onScopeDispose(() => {
  controller?.abort()
  clearInterval(timer)
})
</script>
<template>
  <section class="worker-detail">
    <header>
      <RouterLink to="/admin/workers">{{ t('workerManagement.back') }}</RouterLink
      ><NButton :loading="loading" @click="load">{{ t('workerManagement.refresh') }}</NButton>
    </header>
    <WorkerRequestError v-if="error" :error="error" /><NSkeleton
      v-if="!worker && loading"
      height="240px"
    />
    <template v-if="worker"
      ><div class="identity">
        <h1>{{ worker.name }}</h1>
        <code>{{ worker.id }}</code
        ><NButton size="small" @click="copy">{{ t('workerManagement.copy') }}</NButton>
      </div>
      <div class="facts">
        <NTag :type="worker.state === 'ONLINE' ? 'success' : 'default'">{{
          t(`workerManagement.${worker.state}`)
        }}</NTag
        ><span>{{
          t(
            worker.controlConnected
              ? 'workerManagement.connected'
              : 'workerManagement.disconnected',
          )
        }}</span
        ><span>{{
          t(worker.controlReady ? 'workerManagement.ready' : 'workerManagement.notReady')
        }}</span
        ><strong
          >{{ t('workerManagement.capacity') }}: {{ worker.capacity.activeTabs }} /
          {{ worker.capacity.maxActiveTabs ?? t('workerManagement.unlimited') }}</strong
        >
      </div>
      <p>
        {{ t(worker.workerEligible ? 'workerManagement.eligible' : 'workerManagement.blocked')
        }}<template v-if="worker.schedulingBlockReasons.length">
          ·
          {{
            worker.schedulingBlockReasons
              .map((r) =>
                t(te(`storage.blocks.${r}`) ? `storage.blocks.${r}` : `workerManagement.${r}`),
              )
              .join(' · ')
          }}</template
        >
      </p>
      <p>
        {{ t('workerManagement.seen') }}:
        <NTime
          v-if="worker.lastSeenAt"
          :time="new Date(worker.lastSeenAt)"
          type="datetime"
        /><template v-else>{{ t('workerManagement.never') }}</template>
      </p>
      <WorkerCleanupStatus :worker="worker" />
      <WorkerStoragePanel :worker="worker" :can-manage="canManage" @refresh="load" />
      <WorkerControls
        v-if="canManage"
        :worker="worker"
        @refresh="load"
        @retired="router.replace('/admin/workers')" /><WorkerMetrics
        :worker="worker" /><WorkerCredentials
        :worker="worker"
        :can-manage="canManage"
        @refresh="load"
    /></template>
  </section>
</template>
<style scoped>
.worker-detail {
  grid-template-columns: minmax(0, 1fr);
  display: grid;
  gap: 20px;
  min-width: 0;
}
header,
.facts,
.identity {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
header {
  justify-content: space-between;
}
h1 {
  margin: 0;
  font-size: 24px;
  overflow-wrap: anywhere;
}
.identity code {
  overflow-wrap: anywhere;
  color: var(--bs-text-muted);
}
p {
  margin: 0;
  color: var(--bs-text-muted);
}
</style>
