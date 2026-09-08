<script setup lang="ts">
import { NTag, NTime } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { StorageUsageFact } from '@/api/types.js'
import { storageMessages } from './messages.js'
import { formatStorageBytes } from './format.js'
defineProps<{
  quotaBytes: number | null
  policyVersion: number
  pending: boolean
  fact: Omit<StorageUsageFact, 'profileId'> | null
  compact?: boolean
}>()
const { t, locale } = useI18n({ messages: storageMessages })
const quota = (bytes: number | null) =>
  bytes === null ? t('storage.unlimited') : formatStorageBytes(bytes, locale.value)
</script>
<template>
  <div role="group" class="storage-policy" :class="{ compact }" :aria-label="t('storage.title')">
    <div class="storage-tags">
      <NTag size="small" :type="pending ? 'warning' : 'default'">{{
        t(pending ? 'storage.pending' : fact ? 'storage.applied' : 'storage.unknown')
      }}</NTag>
      <NTag size="small" :type="fact?.quotaState === 'EXCEEDED' ? 'error' : 'default'">{{
        t(`storage.quotaStates.${fact?.quotaState ?? 'UNKNOWN'}`)
      }}</NTag>
    </div>
    <dl>
      <div>
        <dt>{{ t('storage.used') }}</dt>
        <dd>
          {{
            fact?.usedBytes == null
              ? t('storage.unknown')
              : formatStorageBytes(fact.usedBytes, locale)
          }}
        </dd>
      </div>
      <div>
        <dt>{{ t('storage.expectedQuota') }}</dt>
        <dd>{{ quota(quotaBytes) }}</dd>
      </div>
      <div v-if="!compact || pending">
        <dt>{{ t('storage.appliedQuota') }}</dt>
        <dd>{{ fact ? quota(fact.quotaBytes) : t('storage.unknown') }}</dd>
      </div>
      <template v-if="!compact || pending">
        <div>
          <dt>{{ t('storage.expectedVersion') }}</dt>
          <dd>{{ policyVersion }}</dd>
        </div>
        <div>
          <dt>{{ t('storage.appliedVersion') }}</dt>
          <dd>{{ fact?.appliedPolicyVersion ?? t('storage.unknown') }}</dd>
        </div>
      </template>
      <div v-if="!compact && fact">
        <dt>{{ t('storage.observed') }}</dt>
        <dd><NTime :time="new Date(fact.observedAt)" type="datetime" /></dd>
      </div>
    </dl>
    <p v-if="!compact && pending">{{ t('storage.pendingHint') }}</p>
  </div>
</template>
<style scoped>
.storage-policy {
  min-width: 0;
  color: var(--bs-text);
  font-size: 12px;
}
.storage-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.storage-tags :deep(.n-tag) {
  max-width: 100%;
  height: auto;
  min-height: 24px;
  padding-block: 3px;
}
.storage-tags :deep(.n-tag__content) {
  white-space: normal;
  overflow-wrap: anywhere;
}
dl {
  display: grid;
  gap: 8px;
  margin: 12px 0;
}
dl > div {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 6px 16px;
}
dt,
dd,
p {
  overflow-wrap: anywhere;
}
dd {
  margin: 0;
  font-weight: 600;
}
p {
  line-height: 1.6;
}
.compact dl {
  gap: 5px;
}
</style>
