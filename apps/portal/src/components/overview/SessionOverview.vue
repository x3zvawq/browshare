<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SessionOverview } from '@/api/types.js'
import OverviewMetrics from './OverviewMetrics.vue'
const props = defineProps<{ value: SessionOverview }>()
const { t } = useI18n()
const totals = computed(() =>
  (['activeSessions', 'normalSessions', 'maintenanceSessions'] as const).map((key) => ({
    key,
    label: t(`overview.${key}`),
    value: props.value[key],
  })),
)
const states = computed(() =>
  Object.entries(props.value.states).map(([key, value]) => ({
    key: `session-${key}`,
    label: t(`workspace.sessionState.${key.toUpperCase()}`),
    value,
  })),
)
</script>
<template>
  <div class="overview-details">
    <OverviewMetrics :items="totals" />
    <div class="overview-group">
      <h3>{{ t('overview.sessionStates') }}</h3>
      <OverviewMetrics compact :items="states" />
      <p class="overview-hint">{{ t('overview.sessionHint') }}</p>
    </div>
  </div>
</template>
