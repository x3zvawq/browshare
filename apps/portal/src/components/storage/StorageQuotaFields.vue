<script setup lang="ts">
import { computed } from 'vue'
import { NCheckbox, NFormItem } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import AccessibleInputNumber from '@/components/forms/AccessibleInputNumber.vue'
import { storageMessages } from './messages.js'
import { formatStorageBytes } from './format.js'

const props = withDefaults(
  defineProps<{
    scope: 'worker' | 'profile'
    max: number
    disabled?: boolean
    usedBytes?: number | null
  }>(),
  { disabled: false, usedBytes: null },
)
const value = defineModel<number | null>('value', { required: true })
const unlimited = defineModel<boolean>('unlimited', { required: true })
const { t, locale } = useI18n({ messages: storageMessages })
const rules = computed(() => ({
  trigger: ['blur', 'change'],
  validator: () =>
    unlimited.value ||
    (value.value !== null &&
      Number.isSafeInteger(value.value) &&
      value.value >= 0 &&
      value.value <= props.max),
  message: t('storage.invalidQuota', { maximum: props.max.toLocaleString(locale.value) }),
}))
const belowUsage = computed(
  () =>
    !unlimited.value &&
    value.value !== null &&
    props.usedBytes !== null &&
    value.value <= props.usedBytes,
)
</script>
<template>
  <NFormItem :label="t('storage.quotaLabel')" path="storageQuotaBytes" :rule="rules">
    <div class="storage-quota-fields">
      <NCheckbox v-model:checked="unlimited" :disabled="disabled">{{
        t('storage.unlimited')
      }}</NCheckbox>
      <AccessibleInputNumber
        v-if="!unlimited"
        v-model:value="value"
        :label="t('storage.quotaLabel')"
        :min="0"
        :max="max"
        :precision="0"
        :disabled="disabled"
      />
      <small v-if="!unlimited && value !== null">{{ formatStorageBytes(value, locale) }}</small>
      <p>{{ t(scope === 'worker' ? 'storage.workerScope' : 'storage.profileScope') }}</p>
      <p>{{ t('storage.softHint') }} {{ t('storage.zeroHint') }}</p>
      <p v-if="belowUsage" role="status" class="quota-warning">
        {{ t('storage.quotaBelowUsage') }}
      </p>
    </div>
  </NFormItem>
</template>
<style scoped>
.storage-quota-fields {
  width: 100%;
  display: grid;
  gap: 10px;
  min-width: 0;
}
.storage-quota-fields p,
.storage-quota-fields small {
  margin: 0;
  color: var(--bs-text-muted);
  font-size: 12px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.storage-quota-fields .quota-warning {
  color: var(--bs-text);
  border-left: 3px solid var(--bs-primary);
  padding-left: 10px;
}
</style>
