<script setup lang="ts">
import { LockClosedOutline, MailOutline } from '@vicons/ionicons5'
import type { FormInst, FormItemRule, FormRules } from 'naive-ui'
import { NAlert, NButton, NForm, NFormItem, NIcon, NInput } from 'naive-ui'
import { reactive, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

defineProps<{
  readonly busy: boolean
  readonly error: string | undefined
  readonly requestId: string | undefined
}>()

const emit = defineEmits<{
  submit: [credentials: { readonly email: string; readonly password: string }]
}>()

const { t } = useI18n()
const model = reactive({ email: '', password: '', confirmPassword: '' })
const formRef = useTemplateRef<FormInst>('form')

function validateConfirmation(_rule: FormItemRule, value: string): boolean | Error {
  return value === model.password || new Error(t('auth.validation.passwordMismatch'))
}

const rules: FormRules = {
  email: [
    {
      required: true,
      message: () => t('auth.validation.emailRequired'),
      trigger: ['blur', 'input'],
    },
    { type: 'email', message: () => t('auth.validation.emailInvalid'), trigger: ['blur', 'input'] },
  ],
  password: [
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
  emit('submit', { email: model.email.trim(), password: model.password })
}
</script>

<template>
  <NForm ref="form" :model="model" :rules="rules" size="large" @submit.prevent="submit">
    <NAlert v-if="error" class="form-alert" type="error" :title="error">
      <span v-if="requestId" class="request-id">{{ $t('common.requestId') }}: {{ requestId }}</span>
    </NAlert>
    <NFormItem :label="$t('auth.email')" path="email">
      <NInput
        v-model:value="model.email"
        autocomplete="username"
        :input-props="{ 'aria-label': $t('auth.email') }"
        :placeholder="$t('auth.emailPlaceholder')"
        :disabled="busy"
      >
        <template #prefix><NIcon aria-hidden="true" :component="MailOutline" /></template>
      </NInput>
    </NFormItem>
    <NFormItem :label="$t('auth.newPassword')" path="password">
      <NInput
        v-model:value="model.password"
        type="password"
        show-password-on="click"
        autocomplete="new-password"
        :input-props="{ 'aria-label': $t('auth.newPassword') }"
        :placeholder="$t('auth.newPasswordPlaceholder')"
        :disabled="busy"
      >
        <template #prefix><NIcon aria-hidden="true" :component="LockClosedOutline" /></template>
      </NInput>
    </NFormItem>
    <NFormItem :label="$t('auth.confirmPassword')" path="confirmPassword">
      <NInput
        v-model:value="model.confirmPassword"
        type="password"
        show-password-on="click"
        autocomplete="new-password"
        :input-props="{ 'aria-label': $t('auth.confirmPassword') }"
        :placeholder="$t('auth.confirmPasswordPlaceholder')"
        :disabled="busy"
      >
        <template #prefix><NIcon aria-hidden="true" :component="LockClosedOutline" /></template>
      </NInput>
    </NFormItem>
    <NButton class="submit-button" type="primary" attr-type="submit" :loading="busy" block>
      {{ $t('auth.registerAction') }}
    </NButton>
  </NForm>
</template>

<style scoped>
.form-alert {
  margin-bottom: 18px;
}

.request-id {
  font-family: var(--bs-font-mono);
  font-size: 11px;
}

.submit-button {
  margin-top: 4px;
}
</style>
