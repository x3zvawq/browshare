<script setup lang="ts">
import { computed } from 'vue'
import { NTag } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { storageMessages } from './messages.js'

const props = defineProps<{ reason: string | null; pending?: boolean; compact?: boolean }>()
const { t, te } = useI18n({ messages: storageMessages })
const title = computed(() =>
  props.reason
    ? te(`storage.blocks.${props.reason}`)
      ? t(`storage.blocks.${props.reason}`)
      : props.reason
    : t('storage.pending'),
)
const hint = computed(() => {
  if (props.reason === 'LOW_DISK') return t('storage.lowHint')
  if (props.reason === 'CRITICAL_DISK') return t('storage.criticalHint')
  if (
    props.reason === 'WORKER_STORAGE_QUOTA_EXCEEDED' ||
    props.reason === 'PROFILE_STORAGE_QUOTA_EXCEEDED'
  )
    return t('storage.quotaHint')
  if (props.reason === 'STORAGE_UNAVAILABLE') return t('storage.unavailableHint')
  return props.pending || props.reason === 'STORAGE_POLICY_STALE' ? t('storage.pendingHint') : null
})
</script>
<template>
  <div v-if="reason || pending" class="storage-block-notice" :class="{ compact }" role="status">
    <NTag :type="reason === 'CRITICAL_DISK' ? 'error' : 'warning'" size="small">{{ title }}</NTag>
    <p v-if="hint">{{ hint }}</p>
    <p v-if="!compact && reason && reason !== 'STORAGE_POLICY_STALE'">
      {{ t('storage.recovery') }}
    </p>
    <slot />
  </div>
</template>
<style scoped>
.storage-block-notice {
  display: grid;
  gap: 8px;
  min-width: 0;
  font-size: 12px;
  color: var(--bs-text);
}
.storage-block-notice p {
  margin: 0;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.storage-block-notice :deep(.n-tag) {
  justify-self: start;
  max-width: 100%;
  height: auto;
  min-height: 24px;
  padding-block: 3px;
}
.storage-block-notice :deep(.n-tag__content) {
  white-space: normal;
  overflow-wrap: anywhere;
}
.compact {
  gap: 5px;
  font-size: 11px;
}
</style>
