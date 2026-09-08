<script setup lang="ts">
import { CloseOutline } from '@vicons/ionicons5'
import type { FormInst, FormRules } from 'naive-ui'
import { NAlert, NButton, NForm, NFormItem, NIcon, NInput, NModal } from 'naive-ui'
import { reactive, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  readonly show: boolean
  readonly busy: boolean
  readonly error: string | undefined
  readonly requestId: string | undefined
}>()

const emit = defineEmits<{
  close: []
  submit: [input: { readonly displayName?: string; readonly expiresInSeconds: number }]
}>()

const { t } = useI18n()
const formRef = useTemplateRef<FormInst>('form')
const model = reactive({ displayName: '', expiresInSeconds: 900 })

const lifetimeOptions: readonly { readonly labelKey: string; readonly value: number }[] = [
  { labelKey: 'workers.lifetime15Minutes', value: 900 },
  { labelKey: 'workers.lifetime1Hour', value: 3_600 },
  { labelKey: 'workers.lifetime6Hours', value: 21_600 },
  { labelKey: 'workers.lifetime24Hours', value: 86_400 },
]

const rules: FormRules = {
  displayName: {
    max: 128,
    message: () => t('workers.validation.displayNameLength'),
    trigger: ['blur', 'input'],
  },
}

watch(
  () => props.show,
  (show) => {
    if (!show) return
    model.displayName = ''
    model.expiresInSeconds = 900
    formRef.value?.restoreValidation()
  },
)

async function submit(): Promise<void> {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }
  const displayName = model.displayName.trim()
  emit('submit', {
    ...(displayName.length === 0 ? {} : { displayName }),
    expiresInSeconds: model.expiresInSeconds,
  })
}
</script>

<template>
  <NModal
    :show="show"
    :mask-closable="!busy"
    :close-on-esc="!busy"
    @mask-click="$emit('close')"
    @esc="$emit('close')"
  >
    <div
      class="n-modal enrollment-modal modal-surface"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-enrollment-title"
    >
      <header class="modal-header">
        <h2 id="create-enrollment-title">{{ $t('workers.createTitle') }}</h2>
        <NButton
          v-if="!busy"
          quaternary
          circle
          :aria-label="$t('common.close')"
          @click="$emit('close')"
        >
          <template #icon><NIcon aria-hidden="true" :component="CloseOutline" /></template>
        </NButton>
      </header>
      <p class="modal-description">{{ $t('workers.createDescription') }}</p>
      <NAlert v-if="error" class="form-alert" type="error" :title="error">
        <span v-if="requestId" class="request-id">
          {{ $t('common.requestId') }}: {{ requestId }}
        </span>
      </NAlert>
      <NForm ref="form" :model="model" :rules="rules" @submit.prevent="submit">
        <NFormItem :label="$t('workers.displayName')" path="displayName">
          <NInput
            v-model:value="model.displayName"
            :placeholder="$t('workers.displayNamePlaceholder')"
            :input-props="{ 'aria-label': $t('workers.displayName') }"
            :disabled="busy"
            maxlength="128"
            show-count
          />
        </NFormItem>
        <NFormItem :label="$t('workers.lifetime')" path="expiresInSeconds">
          <select
            v-model.number="model.expiresInSeconds"
            class="lifetime-select"
            :aria-label="$t('workers.lifetime')"
            :disabled="busy"
          >
            <option v-for="option in lifetimeOptions" :key="option.value" :value="option.value">
              {{ $t(option.labelKey) }}
            </option>
          </select>
        </NFormItem>
        <div class="modal-actions">
          <NButton :disabled="busy" @click="$emit('close')">{{ $t('common.cancel') }}</NButton>
          <NButton type="primary" attr-type="submit" :loading="busy">
            {{ $t('workers.createAction') }}
          </NButton>
        </div>
      </NForm>
    </div>
  </NModal>
</template>

<style scoped>
.enrollment-modal {
  width: min(520px, calc(100vw - 32px));
}

.modal-surface {
  border: 1px solid var(--bs-border);
  border-radius: 10px;
  background: var(--bs-surface);
  box-shadow: 0 18px 50px rgb(0 0 0 / 24%);
  padding: 20px;
}

.modal-header {
  display: flex;
  min-height: 34px;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}

.modal-header h2 {
  margin: 3px 0 0;
  color: var(--bs-text);
  font-size: 18px;
  font-weight: 680;
}

.modal-description {
  margin: -2px 0 20px;
  color: var(--bs-text-muted);
  font-size: 13px;
  line-height: 1.65;
}

.form-alert {
  margin-bottom: 18px;
}

.request-id {
  font-family: var(--bs-font-mono);
  font-size: 11px;
}

.lifetime-select {
  width: 100%;
  height: 34px;
  border: 1px solid var(--bs-border);
  border-radius: 6px;
  background: var(--bs-surface);
  padding: 0 10px;
  color: var(--bs-text);
  font: inherit;
  outline: none;
}

.lifetime-select:focus-visible {
  border-color: var(--bs-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--bs-primary) 22%, transparent);
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 8px;
}
</style>
