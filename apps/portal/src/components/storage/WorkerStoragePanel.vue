<script setup lang="ts">
import { onScopeDispose, shallowRef } from 'vue'
import { NButton, NTag, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { api } from '@/api/client.js'
import { apiFailure, networkFailure, type ApiFailure } from '@/api/errors.js'
import type { ManagedWorker } from '@/api/types.js'
import StoragePolicySummary from './StoragePolicySummary.vue'
import StorageQuotaModal from './StorageQuotaModal.vue'
import StorageBlockNotice from './StorageBlockNotice.vue'
import { storageMessages } from './messages.js'
import { formatStorageBytes } from './format.js'
const props = defineProps<{ worker: ManagedWorker; canManage: boolean }>()
const emit = defineEmits<{ refresh: [] }>()
const { t, locale } = useI18n({ messages: storageMessages })
const message = useMessage(),
  editing = shallowRef(false),
  busy = shallowRef(false),
  error = shallowRef<ApiFailure | null>(null)
let controller: AbortController | undefined
const bytes = (value: number | null) =>
  value === null ? t('storage.unknown') : formatStorageBytes(value, locale.value)
const percent = (value: number) =>
  new Intl.NumberFormat(locale.value, { style: 'percent', maximumFractionDigits: 2 }).format(value)
function edit() {
  error.value = null
  editing.value = true
}
async function save(storageQuotaBytes: number | null) {
  if (busy.value || !props.canManage) return
  const current = new AbortController()
  controller = current
  busy.value = true
  error.value = null
  try {
    const result = await api.PATCH('/workers/{workerId}', {
      params: { path: { workerId: props.worker.id } },
      body: { storageQuotaBytes },
      signal: current.signal,
    })
    if (!result.data) throw apiFailure(result.error, result.response)
    if (current.signal.aborted) return
    editing.value = false
    message.success(t('storage.saved'))
    emit('refresh')
  } catch (cause) {
    if (!current.signal.aborted) error.value = networkFailure(cause)
  } finally {
    if (controller === current) busy.value = false
  }
}
onScopeDispose(() => controller?.abort())
</script>
<template>
  <section class="worker-storage">
    <header>
      <h2>{{ t('storage.title') }}</h2>
      <NButton v-if="canManage" @click="edit">{{ t('storage.edit') }}</NButton>
    </header>
    <p>{{ t('storage.workerScope') }} {{ t('storage.softHint') }}</p>
    <p v-if="!canManage">{{ t('storage.permission') }}</p>
    <p v-if="!worker.controlReady" role="status">{{ t('storage.stale') }}</p>
    <StoragePolicySummary
      :quota-bytes="worker.storageQuotaBytes"
      :policy-version="worker.storagePolicyVersion"
      :pending="worker.storagePolicyPending"
      :fact="worker.storageSnapshot"
    />
    <template v-if="worker.storageSnapshot">
      <StorageBlockNotice
        :reason="
          worker.storageSnapshot.diskState === 'LOW_DISK' ||
          worker.storageSnapshot.diskState === 'CRITICAL_DISK'
            ? worker.storageSnapshot.diskState
            : worker.storageSnapshot.quotaState === 'EXCEEDED'
              ? 'WORKER_STORAGE_QUOTA_EXCEEDED'
              : worker.storageSnapshot.diskState === 'UNKNOWN'
                ? 'STORAGE_UNAVAILABLE'
                : null
        "
      />
      <div class="storage-volumes">
        <section
          v-for="volume in worker.storageSnapshot.volumes"
          :key="volume.purpose"
          class="storage-volume"
        >
          <h3>
            {{
              t(
                volume.purpose === 'profiles'
                  ? 'storage.profilesVolume'
                  : 'storage.temporaryVolume',
              )
            }}
          </h3>
          <NTag
            size="small"
            :type="
              volume.diskState === 'CRITICAL_DISK'
                ? 'error'
                : volume.diskState === 'LOW_DISK'
                  ? 'warning'
                  : 'default'
            "
            >{{ t(`storage.diskStates.${volume.diskState}`) }}</NTag
          >
          <dl>
            <div>
              <dt>{{ t('storage.available') }}</dt>
              <dd>{{ bytes(volume.availableBytes) }}</dd>
            </div>
            <div>
              <dt>{{ t('storage.total') }}</dt>
              <dd>{{ bytes(volume.totalBytes) }}</dd>
            </div>
            <div>
              <dt>{{ t('storage.availableInodes') }}</dt>
              <dd>{{ volume.availableInodes?.toLocaleString(locale) ?? t('storage.unknown') }}</dd>
            </div>
            <div>
              <dt>{{ t('storage.totalInodes') }}</dt>
              <dd>{{ volume.totalInodes?.toLocaleString(locale) ?? t('storage.unknown') }}</dd>
            </div>
            <div>
              <dt>{{ t('storage.lowThreshold') }}</dt>
              <dd>{{ bytes(volume.lowThresholdBytes) }}</dd>
            </div>
            <div>
              <dt>{{ t('storage.criticalThreshold') }}</dt>
              <dd>{{ bytes(volume.criticalThresholdBytes) }}</dd>
            </div>
          </dl>
          <p v-if="volume.availableInodes === 0" role="status">
            {{ t('storage.inodesExhausted') }}
          </p>
        </section>
      </div>
      <p>{{ t('storage.diskSettings') }} {{ t('storage.thresholdFormula') }}</p>
      <dl>
        <div>
          <dt>{{ t('storage.lowConfigured') }}</dt>
          <dd>
            {{ bytes(worker.storageSnapshot.thresholds.lowBytes) }} /
            {{ percent(worker.storageSnapshot.thresholds.lowRatio) }}
          </dd>
        </div>
        <div>
          <dt>{{ t('storage.criticalConfigured') }}</dt>
          <dd>
            {{ bytes(worker.storageSnapshot.thresholds.criticalBytes) }} /
            {{ percent(worker.storageSnapshot.thresholds.criticalRatio) }}
          </dd>
        </div>
      </dl>
    </template>
    <StorageBlockNotice v-else reason="STORAGE_UNAVAILABLE" />
    <StorageQuotaModal
      v-if="editing"
      :name="worker.name"
      scope="worker"
      :quota-bytes="worker.storageQuotaBytes"
      :used-bytes="worker.storageSnapshot?.usedBytes ?? null"
      :max="Number.MAX_SAFE_INTEGER"
      :busy="busy"
      :error="error"
      @close="editing = false"
      @submit="save"
    />
  </section>
</template>
<style scoped>
.worker-storage {
  min-width: 0;
  padding: 20px;
  border: 1px solid var(--bs-border);
  border-radius: 12px;
  background: var(--bs-surface);
  color: var(--bs-text);
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
h2 {
  margin: 0;
  font-size: 18px;
}
h3 {
  font-size: 14px;
}
p {
  font-size: 12px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.storage-volumes {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
  gap: 16px;
  margin-top: 16px;
}
.storage-volume {
  min-width: 0;
  border-top: 1px solid var(--bs-border);
}
dl {
  display: grid;
  gap: 8px;
  font-size: 12px;
}
dl > div {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 6px 16px;
}
dt,
dd {
  overflow-wrap: anywhere;
}
dd {
  margin: 0;
  font-weight: 600;
}
</style>
