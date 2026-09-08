<script setup lang="ts">
import { computed } from 'vue'
import { NFormItem, NSelect } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import AccessibleInputNumber from '@/components/forms/AccessibleInputNumber.vue'
import type { ViewerFocusPolicy } from '@/api/types.js'
import { focusMessages } from './messages.js'
const props = defineProps<{
  mode: ViewerFocusPolicy['mode']
  gracePeriodMs: number | null
  disabled?: boolean
}>()
const emit = defineEmits<{
  'update:mode': [value: ViewerFocusPolicy['mode']]
  'update:gracePeriodMs': [value: number | null]
}>()
const { t } = useI18n({ messages: focusMessages })
const options = computed(() =>
  (['NEVER', 'WHEN_HIDDEN', 'WHEN_UNFOCUSED'] as const).map((value) => ({
    value,
    label: t(`focus.${value}`),
  })),
)
const rule = computed(() => ({
  validator: () =>
    props.mode === 'NEVER' ||
    (props.gracePeriodMs !== null &&
      Number.isInteger(props.gracePeriodMs) &&
      props.gracePeriodMs >= 0 &&
      props.gracePeriodMs <= 300000),
  message: t('focus.invalid'),
  trigger: ['input', 'change', 'blur'],
}))
</script>
<template>
  <NFormItem :label="t('focus.mode')">
    <NSelect
      :value="mode"
      :options="options"
      :disabled="disabled"
      :aria-label="t('focus.mode')"
      @update:value="emit('update:mode', $event)"
    />
  </NFormItem>
  <NFormItem
    v-if="mode !== 'NEVER'"
    :label="t('focus.grace')"
    path="focusGracePeriodMs"
    :rule="rule"
  >
    <div class="focus-field">
      <AccessibleInputNumber
        :value="gracePeriodMs"
        :label="t('focus.grace')"
        :disabled="disabled"
        :min="0"
        :max="300000"
        :precision="0"
        @update:value="emit('update:gracePeriodMs', $event)"
      />
      <small>{{ t('focus.graceHint') }}</small>
    </div>
  </NFormItem>
  <p class="focus-hint">{{ t('focus.behavior') }}</p>
</template>
<style scoped>
.focus-field {
  display: grid;
  gap: 8px;
  width: 100%;
}
.focus-field small,
.focus-hint {
  color: var(--bs-text-muted);
}
.focus-hint {
  margin-top: 0;
}
</style>
