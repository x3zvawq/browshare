<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NAlert, NEmpty, NTag, NTime } from 'naive-ui'
import type { ManagedWorker } from '@/api/types.js'
const props = defineProps<{ worker: ManagedWorker }>(),
  { t } = useI18n()
const snapshot = computed(() => props.worker.metricsSnapshot),
  metrics = computed(() => snapshot.value?.metrics)
function bytes(n: number | null) {
  if (n === null) return t('workerManagement.unknown')
  const unit = n >= 1073741824 ? 'GiB' : n >= 1048576 ? 'MiB' : 'KiB'
  const d = unit === 'GiB' ? 1073741824 : unit === 'MiB' ? 1048576 : 1024
  return `${(n / d).toFixed(1)} ${unit}`
}
</script>
<template>
  <section class="metric-card">
    <h2>{{ t('workerManagement.metrics') }}</h2>
    <p v-if="snapshot">
      {{ t('workerManagement.observed') }}:
      <NTime :time="new Date(snapshot.observedAt)" type="datetime" />
    </p>
    <NAlert
      v-if="!worker.controlReady || worker.state === 'OFFLINE' || worker.state === 'DISABLED'"
      type="warning"
      >{{ t('workerManagement.stale') }}</NAlert
    >
    <NEmpty v-if="!metrics" :description="t('workerManagement.noMetrics')" />
    <template v-else
      ><dl class="grid">
        <div>
          <dt>{{ t('workerManagement.cpu') }}</dt>
          <dd>{{ metrics.cpu.utilizationPercent.toFixed(1) }}%</dd>
        </div>
        <div>
          <dt>{{ t('workerManagement.load') }}</dt>
          <dd>
            {{
              [metrics.cpu.loadAverage1, metrics.cpu.loadAverage5, metrics.cpu.loadAverage15]
                .map((v) => v.toFixed(2))
                .join(' / ')
            }}
          </dd>
        </div>
        <div>
          <dt>{{ t('workerManagement.memory') }}</dt>
          <dd>
            {{ bytes(metrics.memory.availableBytes) }} / {{ bytes(metrics.memory.totalBytes) }}
          </dd>
        </div>
        <div>
          <dt>{{ t('workerManagement.rss') }}</dt>
          <dd>{{ bytes(metrics.memory.workerRssBytes) }}</dd>
        </div>
        <div>
          <dt>{{ t('workerManagement.runtime') }}</dt>
          <dd>
            {{ metrics.runtime.chromeInstances }} / {{ metrics.runtime.tabs }} /
            {{ metrics.runtime.activeSessions }}
          </dd>
        </div>
        <div>
          <dt>{{ t('workerManagement.network') }}</dt>
          <dd>
            {{ bytes(metrics.network.receivedBytes) }} /
            {{ bytes(metrics.network.transmittedBytes) }}
          </dd>
        </div>
      </dl>
      <dl class="grid">
        <div v-for="volume in metrics.storage" :key="volume.purpose">
          <dt>{{ t(`workerManagement.${volume.purpose}`) }}</dt>
          <dd>
            {{ t('workerManagement.storage') }}<br />{{ bytes(volume.availableBytes) }} /
            {{ bytes(volume.totalBytes) }}
          </dd>
          <dd>
            {{ t('workerManagement.inode') }}<br />{{
              volume.availableInodes ?? t('workerManagement.unknown')
            }}
            / {{ volume.totalInodes ?? t('workerManagement.unknown') }}
          </dd>
        </div>
      </dl></template
    >
  </section>
  <section class="metric-card">
    <h2>{{ t('workerManagement.versions') }}</h2>
    <p>
      {{ worker.platform ?? '—' }} / {{ worker.architecture ?? '—' }} ·
      {{ worker.reportedHostname ?? '—' }}
    </p>
    <dl class="grid">
      <div v-for="(value, key) in worker.versions" :key="key">
        <dt>{{ key }}</dt>
        <dd>{{ value }}</dd>
      </div>
    </dl>
  </section>
  <section class="metric-card">
    <h2>{{ t('workerManagement.report') }}</h2>
    <NAlert v-if="worker.lastProbeErrorCode" type="error"
      >{{ worker.lastProbeErrorCode }} · {{ worker.lastProbeErrorSummary }}</NAlert
    ><NEmpty
      v-if="!worker.capabilityReport"
      :description="t('workerManagement.noProbe')"
    /><template v-else
      ><p>
        <NTag :type="worker.capabilityReport.status === 'READY' ? 'success' : 'error'">{{
          t(`workerManagement.${worker.capabilityReport.status}`)
        }}</NTag>
        · <NTime :time="new Date(worker.capabilityReport.completedAt)" type="datetime" />
      </p>
      <ul class="checks">
        <li v-for="check in worker.capabilityReport.checks" :key="check.name">
          <strong>{{ check.name }}</strong
          ><NTag
            size="small"
            :type="
              check.status === 'PASS' ? 'success' : check.status === 'FAIL' ? 'error' : 'default'
            "
            >{{ t(`workerManagement.${check.status}`) }}</NTag
          >
          <p v-if="check.code || check.summary">{{ check.code }} · {{ check.summary }}</p>
          <p v-if="check.guidance">{{ check.guidance }}</p>
        </li>
      </ul></template
    >
  </section>
</template>
<style scoped>
.metric-card {
  border: 1px solid var(--bs-border);
  border-radius: 10px;
  padding: 20px;
  background: var(--bs-surface);
  min-width: 0;
}
h2 {
  font-size: 18px;
  margin: 0 0 12px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
  gap: 20px;
}
dt,
p {
  color: var(--bs-text-muted);
}
dd {
  margin: 6px 0 0;
  overflow-wrap: anywhere;
}
.checks {
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr));
  gap: 16px;
}
.checks li {
  min-width: 0;
  overflow-wrap: anywhere;
}
.checks strong {
  margin-right: 12px;
}
.checks p {
  margin: 6px 0 0;
}
</style>
