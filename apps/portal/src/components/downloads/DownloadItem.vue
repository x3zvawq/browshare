<script setup lang="ts">
import { computed } from 'vue'
import { NAlert, NButton, NTag } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { RetainedDownload } from '@/api/types.js'
const props = defineProps<{
  file: RetainedDownload
  now: number
  enabled: boolean
  delivery?: { busy: boolean; submitted: boolean; error?: string } | undefined
}>()
defineEmits<{ claim: [file: RetainedDownload] }>()
const { t, te, locale } = useI18n()
const expired = computed(
  () =>
    props.file.status === 'EXPIRED' ||
    (props.file.status === 'AVAILABLE' && Date.parse(props.file.expiresAt) <= props.now),
)
const state = computed(() =>
  props.file.status === 'CLAIMED' ? 'claimed' : expired.value ? 'expired' : 'available',
)
const remaining = computed(() =>
  Math.max(0, Math.ceil((Date.parse(props.file.expiresAt) - props.now) / 1000)),
)
const size = computed(() => {
  const bytes = props.file.size,
    unit = bytes >= 1024 ** 3 ? 3 : bytes >= 1024 ** 2 ? 2 : bytes >= 1024 ? 1 : 0
  return `${new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }).format(bytes / 1024 ** unit)} ${['B', 'KiB', 'MiB', 'GiB'][unit]}`
})
const error = computed(() => {
  const key = `downloads.errors.${props.delivery?.error}`
  return te(key) ? t(key) : t('downloads.errors.UNKNOWN')
})
</script>
<template>
  <li class="download-item">
    <div class="file-heading">
      <h3>{{ file.displayName }}</h3>
      <NTag
        :type="state === 'claimed' ? 'success' : state === 'expired' ? 'default' : 'info'"
        size="small"
        >{{ t(`downloads.${state}`) }}</NTag
      >
    </div>
    <p class="metadata">
      {{ size }} ·
      {{ t('downloads.completed', { time: new Date(file.completedAt).toLocaleString(locale) }) }}
    </p>
    <p
      v-if="state === 'available'"
      class="metadata"
      :title="t('downloads.deadline', { time: new Date(file.expiresAt).toLocaleString(locale) })"
    >
      {{
        t('downloads.remaining', { minutes: Math.floor(remaining / 60), seconds: remaining % 60 })
      }}
    </p>
    <NButton
      v-if="state === 'available'"
      type="primary"
      secondary
      :loading="delivery?.busy ?? false"
      :disabled="!enabled"
      @click="$emit('claim', file)"
      >{{
        t(
          delivery?.busy
            ? 'downloads.preparing'
            : delivery?.submitted || delivery?.error
              ? 'downloads.retry'
              : 'downloads.claim',
        )
      }}</NButton
    >
    <NAlert v-if="delivery?.error" type="error" role="alert">{{ error }}</NAlert>
    <p v-else-if="delivery?.submitted" class="metadata" role="status">
      {{ t('downloads.submitted') }}
    </p>
  </li>
</template>
<style scoped>
.download-item {
  padding: 18px 0;
  border-bottom: 1px solid var(--bs-border);
  min-width: 0;
}
.file-heading {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.file-heading h3 {
  margin: 0;
  font-size: 15px;
  overflow-wrap: anywhere;
}
.metadata {
  color: var(--bs-text-muted);
  font-size: 13px;
  margin: 8px 0;
  overflow-wrap: anywhere;
}
</style>
