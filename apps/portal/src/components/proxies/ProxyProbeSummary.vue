<script setup lang="ts">
import { NTag } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { Proxy } from '@/api/types.js'
import { proxyRuntimeMessages } from './messages.js'
defineProps<{ proxy: Proxy }>()
const { t, te, locale } = useI18n({ messages: proxyRuntimeMessages })
function time(value: string | null) {
  return value === null
    ? t('proxyProbe.never')
    : new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(value),
      )
}
function errorText(code: string) {
  const key = `proxyErrors.${code}`
  return te(key) ? `${t(key)} (${code})` : code
}
</script>
<template>
  <section class="probe-summary" :aria-label="t('proxyProbe.result')">
    <NTag
      size="small"
      :bordered="false"
      :type="
        proxy.healthStatus === 'HEALTHY'
          ? 'success'
          : proxy.healthStatus === 'UNHEALTHY'
            ? 'error'
            : 'default'
      "
      >{{ t(`proxies.health.${proxy.healthStatus}`) }}</NTag
    >
    <span>{{ t('proxyProbe.checked') }}: {{ time(proxy.lastCheckedAt) }}</span>
    <span>{{ t('proxyProbe.lastSuccess') }}: {{ time(proxy.lastSucceededAt) }}</span>
    <span v-if="proxy.lastProbeMode"
      >{{ t('proxyProbe.modeLabel') }}: {{ t(`proxyProbe.${proxy.lastProbeMode}`) }}</span
    >
    <span v-if="proxy.lastProbeWorkerId"
      >{{ t('proxyProbe.testedWorker') }}:
      <span class="identifier">{{ proxy.lastProbeWorkerId }}</span></span
    >
    <span v-if="proxy.lastExitIp"
      >{{ t('proxyProbe.exitIp') }}: <span class="identifier">{{ proxy.lastExitIp }}</span></span
    >
    <span v-if="proxy.lastErrorSummary" class="probe-error"
      >{{ t('proxyProbe.error') }}: {{ errorText(proxy.lastErrorSummary) }}</span
    >
  </section>
</template>
<style scoped>
.probe-summary {
  display: grid;
  justify-items: start;
  gap: 4px;
  min-width: 0;
  font-size: 12px;
}
.probe-summary > span {
  color: var(--bs-text-muted);
  overflow-wrap: anywhere;
  white-space: normal;
}
.probe-summary .probe-error {
  color: var(--bs-text);
}
.identifier {
  font-family: var(--bs-font-mono);
  font-size: 11px;
}
</style>
