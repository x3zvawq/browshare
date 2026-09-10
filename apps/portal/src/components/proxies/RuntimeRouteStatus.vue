<script setup lang="ts">
import { computed } from 'vue'
import { NTag } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { ProfileRouteSummary } from '@/api/types.js'
import { proxyRuntimeMessages } from './messages.js'
const props = defineProps<{
  route: ProfileRouteSummary
  activeSessions?: number
  runtimeState?: string
  compact?: boolean
  inline?: boolean
}>()
const { t, te, locale } = useI18n({ messages: proxyRuntimeMessages })
const health = computed(() => props.route.runtimeProxyHealth)
const inactive = computed(() => props.runtimeState === 'STOPPED')
const healthType = computed(() =>
  inactive.value
    ? 'default'
    : health.value?.status === 'HEALTHY'
      ? 'success'
      : health.value?.status === 'UNHEALTHY'
        ? 'error'
        : 'default',
)
function time(value: string) {
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  )
}
function errorText(code: string) {
  const key = `proxyErrors.${code}`
  return te(key) ? `${t(key)} (${code})` : code
}
</script>
<template>
  <div
    role="group"
    class="runtime-route"
    :class="{ compact, inline }"
    :aria-label="t('runtimeRoute.title')"
    :title="
      inline && health ? t('runtimeRoute.checked', { date: time(health.checkedAt) }) : undefined
    "
  >
    <div class="route-heading">
      <span v-if="!inline">{{ t('runtimeRoute.title') }}</span>
      <NTag size="small" :bordered="false" :type="healthType">
        {{ t(inactive ? 'runtimeRoute.inactive' : `runtimeRoute.${health?.status ?? 'UNKNOWN'}`) }}
      </NTag>
    </div>
    <small v-if="health && !inactive && !inline" :title="time(health.checkedAt)">{{
      t('runtimeRoute.checked', { date: time(health.checkedAt) })
    }}</small>
    <small v-else-if="!inactive && !inline">{{ t('runtimeRoute.never') }}</small>
    <small
      v-if="health?.lastSucceededAt && health.status === 'UNHEALTHY' && !inactive && !inline"
      >{{ t('runtimeRoute.succeeded', { date: time(health.lastSucceededAt) }) }}</small
    >
    <p v-if="health?.errorCode && !inactive" class="health-error">
      {{ t('runtimeRoute.error', { error: errorText(health.errorCode) }) }}
    </p>
    <p v-if="health?.status === 'UNHEALTHY' && !inactive && !compact" class="hint">
      {{ t('runtimeRoute.degraded') }}
    </p>
    <div v-if="route.restartRequired" class="restart-required">
      <NTag size="small" type="warning" :bordered="false">{{ t('runtimeRoute.restart') }}</NTag>
      <span v-if="activeSessions !== undefined">{{
        t('runtimeRoute.sessions', { count: activeSessions })
      }}</span>
      <p v-if="!compact">{{ t('runtimeRoute.restartHint') }}</p>
    </div>
  </div>
</template>
<style scoped>
.runtime-route {
  display: grid;
  gap: 6px;
  min-width: 0;
  font-size: 12px;
  margin-block: 10px;
}
.runtime-route.compact {
  margin: 0;
}
.runtime-route.inline {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  margin: 0;
}
.route-heading,
.restart-required {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.route-heading > span,
small,
.hint {
  color: var(--bs-text-muted);
}
p {
  margin: 0;
  overflow-wrap: anywhere;
  white-space: normal;
}
small {
  font-size: 11px;
  white-space: normal;
}
.health-error {
  color: var(--bs-text);
}
.restart-required > p {
  flex-basis: 100%;
  color: var(--bs-text-muted);
}
</style>
