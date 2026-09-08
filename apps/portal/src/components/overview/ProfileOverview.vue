<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NTag } from 'naive-ui'
import type { ProfileOverview } from '@/api/types.js'
import { storageMessages } from '@/components/storage/messages.js'
import OverviewMetrics from './OverviewMetrics.vue'
const props = defineProps<{ value: ProfileOverview }>()
const { t } = useI18n({ messages: storageMessages })
const storage = computed(() => [
  {
    key: 'storageQuotaExceededProfiles',
    label: t('storage.quotaExceededProfiles'),
    value: props.value.storageQuotaExceededProfiles,
  },
  {
    key: 'storageUnknownProfiles',
    label: t('storage.unknownProfiles'),
    value: props.value.storageUnknownProfiles,
  },
])
const profiles = computed(() =>
  (['totalProfiles', 'enabledProfiles', 'disabledProfiles', 'deletingProfiles'] as const).map(
    (key) => ({ key, label: t(`overview.${key}`), value: props.value[key] }),
  ),
)
const runtime = computed(() =>
  Object.entries(props.value.runtime).map(([key, value]) => ({
    key: `runtime-${key}`,
    label: t(`profiles.runtimeState.${key.toUpperCase()}`),
    value,
  })),
)
const route = computed(() =>
  (['restartRequiredProfiles', 'unhealthyRuntimes', 'unknownRuntimeHealth'] as const).map(
    (key) => ({ key, label: t(`overview.${key}`), value: props.value[key] }),
  ),
)
const capacity = computed(() => [
  { key: 'activeSessions', label: t('overview.activeNormal'), value: props.value.activeSessions },
  {
    key: 'finiteSessionLimit',
    label: t('overview.finiteProfileLimit'),
    value: props.value.finiteSessionLimit,
  },
  {
    key: 'availableSessions',
    label: t('overview.profileRemaining'),
    value: props.value.availableSessions,
  },
  ...(['unlimitedProfiles', 'fullProfiles', 'overLimitProfiles'] as const).map((key) => ({
    key,
    label: t(`overview.${key}`),
    value: props.value[key],
  })),
])
</script>
<template>
  <div class="overview-details">
    <OverviewMetrics :items="profiles" />
    <div
      v-if="value.unhealthyRuntimes || value.restartRequiredProfiles || value.runtime.error"
      class="overview-attention"
    >
      <NTag v-if="value.unhealthyRuntimes" size="small" type="error"
        >{{ t('overview.unhealthyRuntimes') }} · {{ value.unhealthyRuntimes }}</NTag
      >
      <NTag v-if="value.restartRequiredProfiles" size="small" type="warning"
        >{{ t('overview.restartRequiredProfiles') }} · {{ value.restartRequiredProfiles }}</NTag
      >
      <NTag v-if="value.runtime.error" size="small" type="error"
        >{{ t('profiles.runtimeState.ERROR') }} · {{ value.runtime.error }}</NTag
      >
    </div>
    <div class="overview-group">
      <h3>{{ t('storage.title') }}</h3>
      <OverviewMetrics :items="storage" />
      <p class="overview-hint">{{ t('storage.profileScope') }}</p>
    </div>
    <div class="overview-group">
      <h3>{{ t('overview.runtimeStates') }}</h3>
      <OverviewMetrics compact :items="runtime" />
    </div>
    <div class="overview-group">
      <h3>{{ t('overview.routeHealth') }}</h3>
      <OverviewMetrics :items="route" />
      <p class="overview-hint">{{ t('overview.routeHint') }}</p>
    </div>
    <div class="overview-group">
      <h3>{{ t('overview.profileCapacity') }}</h3>
      <OverviewMetrics compact :items="capacity" />
      <p class="overview-hint">{{ t('overview.profileCapacityHint') }}</p>
    </div>
  </div>
</template>
