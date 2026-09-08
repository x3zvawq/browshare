<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NTag } from 'naive-ui'
import type { WorkerOverview } from '@/api/types.js'
import { storageMessages } from '@/components/storage/messages.js'
import OverviewMetrics from './OverviewMetrics.vue'
const props = defineProps<{ value: WorkerOverview }>()
const { t } = useI18n({ messages: storageMessages })
const storage = computed(() =>
  (
    ['lowDiskWorkers', 'criticalDiskWorkers', 'quotaExceededWorkers', 'unknownWorkers'] as const
  ).map((key) => ({ key, label: t(`storage.${key}`), value: props.value.storage[key] })),
)
const control = computed(() =>
  (['totalWorkers', 'connectedWorkers', 'readyWorkers', 'eligibleWorkers'] as const).map((key) => ({
    key,
    label: t(`overview.${key}`),
    value: props.value[key],
  })),
)
const states = computed(() =>
  Object.entries(props.value.states).map(([key, value]) => ({
    key: `worker-${key}`,
    label: t(`workerManagement.${key.toUpperCase()}`),
    value,
  })),
)
const configured = computed(() => [
  {
    key: 'finiteTabLimit',
    label: t('overview.finiteLimit'),
    value: props.value.capacity.finiteTabLimit,
  },
  {
    key: 'availableTabs',
    label: t('overview.configuredRemaining'),
    value: props.value.capacity.availableTabs,
  },
  {
    key: 'unlimitedWorkers',
    label: t('overview.unlimitedWorkers'),
    value: props.value.capacity.unlimitedWorkers,
  },
])
const schedulable = computed(() => [
  {
    key: 'schedulableAvailableTabs',
    label: t('overview.schedulableRemaining'),
    value: props.value.capacity.schedulableAvailableTabs,
  },
  {
    key: 'schedulableUnlimitedWorkers',
    label: t('overview.schedulableUnlimited'),
    value: props.value.capacity.schedulableUnlimitedWorkers,
  },
])
const occupancy = computed(() =>
  (['activeTabs', 'fullWorkers', 'overLimitWorkers'] as const).map((key) => ({
    key,
    label: t(`overview.${key}`),
    value: props.value.capacity[key],
  })),
)
</script>
<template>
  <div class="overview-details">
    <OverviewMetrics :items="control" />
    <div v-if="value.states.offline || value.capacity.overLimitWorkers" class="overview-attention">
      <NTag v-if="value.states.offline" size="small" type="warning"
        >{{ t('workerManagement.OFFLINE') }} · {{ value.states.offline }}</NTag
      >
      <NTag v-if="value.capacity.overLimitWorkers" size="small" type="error"
        >{{ t('overview.overLimitWorkers') }} · {{ value.capacity.overLimitWorkers }}</NTag
      >
    </div>
    <p class="overview-hint">{{ t('overview.controlHint') }}</p>
    <div class="overview-group">
      <h3>{{ t('storage.title') }}</h3>
      <OverviewMetrics :items="storage" />
      <p class="overview-hint">{{ t('storage.softHint') }}</p>
    </div>
    <div class="overview-group">
      <h3>{{ t('overview.workerStates') }}</h3>
      <OverviewMetrics compact :items="states" />
    </div>
    <div class="overview-group">
      <h3>{{ t('overview.capacity') }}</h3>
      <OverviewMetrics compact :items="occupancy" />
      <p class="overview-hint">{{ t('overview.occupancyHint') }}</p>
      <div class="overview-capacity-box">
        <h4>{{ t('overview.configured') }}</h4>
        <OverviewMetrics compact :items="configured" />
        <p class="overview-hint">{{ t('overview.configuredHint') }}</p>
      </div>
      <div class="overview-capacity-box schedulable">
        <h4>{{ t('overview.schedulable') }}</h4>
        <OverviewMetrics :items="schedulable" />
        <p class="overview-hint">{{ t('overview.schedulingHint') }}</p>
      </div>
    </div>
  </div>
</template>
