<script setup lang="ts">
import { NFormItem, NSwitch } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { SessionPolicyValues } from '@/api/types.js'
import AccessibleInputNumber from '@/components/forms/AccessibleInputNumber.vue'
const props = defineProps<{ value: SessionPolicyValues; disabled?: boolean }>()
const emit = defineEmits<{ 'update:value': [value: SessionPolicyValues] }>()
const { t } = useI18n()
const timeouts = [
  'viewerDisconnectTimeoutSeconds',
  'noInputTimeoutSeconds',
  'noFrameChangeTimeoutSeconds',
  'maxDurationSeconds',
  'proxyFailureTimeoutSeconds',
] as const
function update(key: keyof SessionPolicyValues, value: number | boolean | null) {
  emit('update:value', { ...props.value, [key]: value })
}
</script>
<template>
  <NFormItem :label="t('sessionPolicies.recycleDisabled')">
    <NSwitch
      :value="value.recycleDisabled"
      :disabled="disabled"
      :aria-label="t('sessionPolicies.recycleDisabled')"
      @update:value="update('recycleDisabled', $event)"
    />
  </NFormItem>
  <p class="policy-hint">{{ t('sessionPolicies.timeoutHint') }}</p>
  <div class="policy-fields">
    <NFormItem v-for="key in timeouts" :key="key" :label="t(`sessionPolicies.${key}`)">
      <AccessibleInputNumber
        :value="value[key]"
        :label="t(`sessionPolicies.${key}`)"
        :min="1"
        :max="2147483647"
        :precision="0"
        :disabled="disabled || value.recycleDisabled"
        :placeholder="t('sessionPolicies.off')"
        @update:value="update(key, $event)"
      />
    </NFormItem>
    <NFormItem :label="t('sessionPolicies.countdownSeconds')">
      <AccessibleInputNumber
        :value="value.countdownSeconds"
        :label="t('sessionPolicies.countdownSeconds')"
        :min="0"
        :max="2147483647"
        :precision="0"
        :disabled="disabled || value.recycleDisabled"
        @update:value="update('countdownSeconds', $event)"
      />
    </NFormItem>
  </div>
</template>
<style scoped>
.policy-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 16px;
}
.policy-hint {
  color: var(--text-secondary);
  font-size: 13px;
  margin: 0 0 16px;
}
@media (max-width: 560px) {
  .policy-fields {
    grid-template-columns: 1fr;
  }
}
</style>
