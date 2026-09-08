<script setup lang="ts">
import { LockClosedOutline, MailOutline } from '@vicons/ionicons5'
import type { FormInst, FormRules } from 'naive-ui'
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
const model = reactive({ email: '', password: '' })
const formRef = useTemplateRef<FormInst>('form')
const rules: FormRules = {
  email: [
    {
      required: true,
      message: () => t('auth.validation.emailRequired'),
      trigger: ['blur', 'input'],
    },
    { type: 'email', message: () => t('auth.validation.emailInvalid'), trigger: ['blur', 'input'] },
  ],
  password: {
    required: true,
    message: () => t('auth.validation.passwordRequired'),
    trigger: ['blur', 'input'],
  },
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
        type="text"
        autocomplete="username"
        :input-props="{ 'aria-label': $t('auth.email') }"
        :placeholder="$t('auth.emailPlaceholder')"
        :disabled="busy"
      >
        <template #prefix><NIcon aria-hidden="true" :component="MailOutline" /></template>
      </NInput>
    </NFormItem>
    <NFormItem :label="$t('auth.password')" path="password">
      <NInput
        v-model:value="model.password"
        type="password"
        show-password-on="click"
        autocomplete="current-password"
        :input-props="{ 'aria-label': $t('auth.password') }"
        :placeholder="$t('auth.passwordPlaceholder')"
        :disabled="busy"
      >
        <template #prefix><NIcon aria-hidden="true" :component="LockClosedOutline" /></template>
      </NInput>
    </NFormItem>
    <NButton class="submit-button" type="primary" attr-type="submit" :loading="busy" block>
      {{ $t('auth.loginAction') }}
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
