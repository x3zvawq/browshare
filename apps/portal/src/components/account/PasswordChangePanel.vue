<script setup lang="ts">
import { KeyOutline } from '@vicons/ionicons5'
import type { FormInst, FormItemRule, FormRules } from 'naive-ui'
import { NAlert, NButton, NCard, NForm, NFormItem, NIcon, NInput } from 'naive-ui'
import { reactive, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  readonly busy: boolean
  readonly error: string | undefined
  readonly requestId: string | undefined
}>()

const emit = defineEmits<{
  submit: [passwords: { readonly currentPassword: string; readonly newPassword: string }]
}>()

const { t } = useI18n()
const model = reactive({ currentPassword: '', newPassword: '', confirmPassword: '' })
const formRef = useTemplateRef<FormInst>('form')

function validateConfirmation(_rule: FormItemRule, value: string): boolean | Error {
  return value === model.newPassword || new Error(t('auth.validation.passwordMismatch'))
}

const rules: FormRules = {
  currentPassword: {
    required: true,
    message: () => t('auth.validation.passwordRequired'),
    trigger: ['blur', 'input'],
  },
  newPassword: [
    {
      required: true,
      message: () => t('auth.validation.passwordRequired'),
      trigger: ['blur', 'input'],
    },
    { min: 10, message: () => t('auth.validation.passwordLength'), trigger: ['blur', 'input'] },
  ],
  confirmPassword: [
    {
      required: true,
      message: () => t('auth.validation.confirmRequired'),
      trigger: ['blur', 'input'],
    },
    { validator: validateConfirmation, trigger: ['blur', 'input'] },
  ],
}

async function submit(): Promise<void> {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }
  emit('submit', { currentPassword: model.currentPassword, newPassword: model.newPassword })
}

function reset(): void {
  model.currentPassword = ''
  model.newPassword = ''
  model.confirmPassword = ''
  formRef.value?.restoreValidation()
}

defineExpose({ reset })
</script>

<template>
  <NCard class="security-card" :bordered="true">
    <div class="section-heading">
      <div class="section-icon">
        <NIcon aria-hidden="true" :component="KeyOutline" :size="21" />
      </div>
      <div>
        <h2>{{ $t('account.passwordTitle') }}</h2>
        <p>{{ $t('account.passwordDescription') }}</p>
      </div>
    </div>

    <NForm ref="form" class="password-form" :model="model" :rules="rules" @submit.prevent="submit">
      <NAlert v-if="props.error" class="form-alert" type="error" :title="props.error">
        <span v-if="props.requestId" class="request-id">
          {{ $t('common.requestId') }}: {{ props.requestId }}
        </span>
      </NAlert>
      <NFormItem :label="$t('account.currentPassword')" path="currentPassword">
        <NInput
          v-model:value="model.currentPassword"
          type="password"
          show-password-on="click"
          autocomplete="current-password"
          :input-props="{ 'aria-label': $t('account.currentPassword') }"
          :disabled="busy"
        />
      </NFormItem>
      <NFormItem :label="$t('account.newPassword')" path="newPassword">
        <NInput
          v-model:value="model.newPassword"
          type="password"
          show-password-on="click"
          autocomplete="new-password"
          :input-props="{ 'aria-label': $t('account.newPassword') }"
          :disabled="busy"
        />
      </NFormItem>
      <NFormItem :label="$t('account.confirmPassword')" path="confirmPassword">
        <NInput
          v-model:value="model.confirmPassword"
          type="password"
          show-password-on="click"
          autocomplete="new-password"
          :input-props="{ 'aria-label': $t('account.confirmPassword') }"
          :disabled="busy"
        />
      </NFormItem>
      <div class="form-actions">
        <p>{{ $t('account.passwordEffect') }}</p>
        <NButton type="primary" attr-type="submit" :loading="busy">
          {{ $t('account.changePasswordAction') }}
        </NButton>
      </div>
    </NForm>
  </NCard>
</template>

<style scoped>
.security-card {
  height: 100%;
}

.section-heading {
  display: flex;
  align-items: flex-start;
  gap: 13px;
}

.section-icon {
  display: grid;
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 9px;
  background: rgb(15 98 214 / 10%);
  color: var(--bs-primary);
}

.section-heading h2 {
  margin: 0;
  color: var(--bs-text);
  font-size: 17px;
  font-weight: 680;
}

.section-heading p {
  margin: 5px 0 0;
  color: var(--bs-text-muted);
  font-size: 13px;
  line-height: 1.55;
}

.password-form {
  max-width: 560px;
  margin-top: 25px;
}

.form-alert {
  margin-bottom: 18px;
}

.request-id {
  font-family: var(--bs-font-mono);
  font-size: 11px;
}

.form-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-top: 4px;
}

.form-actions p {
  margin: 0;
  color: var(--bs-text-muted);
  font-size: 12px;
  line-height: 1.55;
}

@media (max-width: 560px) {
  .form-actions {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
