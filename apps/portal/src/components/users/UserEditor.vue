<script setup lang="ts">
import FormModal from '@/components/forms/FormModal.vue'
import { reactive, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NButton,
  NCheckbox,
  NForm,
  NFormItem,
  NInput,
  type FormInst,
  type FormRules,
} from 'naive-ui'
import type { ApiFailure } from '@/api/errors.js'
import type { ManagedUser, ManagedUserInput } from '@/api/types.js'
import AccessibleInputNumber from '@/components/forms/AccessibleInputNumber.vue'
import UserRequestError from './UserRequestError.vue'
const props = defineProps<{ user: ManagedUser | null; busy: boolean; error: ApiFailure | null }>()
const emit = defineEmits<{
  close: []
  submit: [input: Omit<ManagedUserInput, 'password'> & { password?: string }]
}>()
const { t } = useI18n(),
  form = useTemplateRef<FormInst>('form')
const model = reactive({
  name: props.user?.displayName ?? '',
  email: props.user?.email ?? '',
  password: '',
  confirm: '',
  maximum: (props.user?.maxActiveSessions ?? 2) as number | null,
  unlimited: props.user?.maxActiveSessions === null,
})
const rules: FormRules = {
  name: {
    validator: () =>
      (model.name.trim().length > 0 && model.name.trim().length <= 128) ||
      new Error(t('users.invalidName')),
    trigger: ['input', 'blur'],
  },
  email: {
    validator: () =>
      /^[^\s@]+@[^\s@]+$/u.test(model.email.trim()) || new Error(t('users.invalidEmail')),
    trigger: ['input', 'blur'],
  },
  password: {
    validator: () =>
      !!props.user ||
      (model.password.length >= 10 && model.password.length <= 1024) ||
      new Error(t('users.invalidPassword')),
    trigger: ['input', 'blur'],
  },
  confirm: {
    validator: () =>
      !!props.user || model.password === model.confirm || new Error(t('users.mismatch')),
    trigger: ['input', 'blur'],
  },
  maximum: {
    validator: () =>
      model.unlimited ||
      (model.maximum !== null &&
        Number.isInteger(model.maximum) &&
        model.maximum >= 0 &&
        model.maximum <= 1000000) ||
      new Error(t('users.invalidMaximum')),
    trigger: ['change', 'blur'],
  },
}
async function submit() {
  if (props.busy) return
  try {
    await form.value?.validate()
  } catch {
    return
  }
  emit('submit', {
    displayName: model.name.trim(),
    email: model.email.trim(),
    maxActiveSessions: model.unlimited ? null : model.maximum,
    ...(!props.user ? { password: model.password } : {}),
  })
}
</script>
<template>
  <FormModal
    :title="t(user ? 'users.edit' : 'users.create')"
    :busy="busy"
    :width="580"
    @close="emit('close')"
  >
    <UserRequestError v-if="error" :error="error" />
    <NForm
      ref="form"
      :model="model"
      :rules="rules"
      :disabled="busy"
      label-placement="top"
      @submit.prevent="submit"
    >
      <NFormItem path="name" :label="t('users.name')"
        ><NInput
          v-model:value="model.name"
          :maxlength="128"
          :input-props="{ 'aria-label': t('users.name'), autocomplete: 'off' }"
      /></NFormItem>
      <NFormItem path="email" :label="t('users.email')"
        ><NInput
          v-model:value="model.email"
          :maxlength="320"
          :input-props="{
            'aria-label': t('users.email'),
            autocomplete: 'off',
            inputmode: 'email',
          }"
      /></NFormItem>
      <template v-if="!user"
        ><NFormItem path="password" :label="t('users.password')"
          ><NInput
            v-model:value="model.password"
            type="password"
            show-password-on="click"
            :maxlength="1024"
            :input-props="{
              'aria-label': t('users.password'),
              autocomplete: 'new-password',
            }" /></NFormItem
        ><NFormItem path="confirm" :label="t('users.confirmPassword')"
          ><NInput
            v-model:value="model.confirm"
            type="password"
            show-password-on="click"
            :maxlength="1024"
            :input-props="{
              'aria-label': t('users.confirmPassword'),
              autocomplete: 'new-password',
            }"
        /></NFormItem>
        <p>{{ t('users.defaultRole') }}</p></template
      >
      <NFormItem path="maximum" :label="t('users.maximum')"
        ><div class="limit">
          <AccessibleInputNumber
            v-model:value="model.maximum"
            :label="t('users.maximum')"
            :min="0"
            :max="1000000"
            :precision="0"
            :disabled="busy || model.unlimited"
          /><NCheckbox v-model:checked="model.unlimited">{{ t('users.unlimited') }}</NCheckbox>
          <p>{{ t('users.limitHint') }}</p>
        </div></NFormItem
      >
      <NButton attr-type="submit" type="primary" :loading="busy" block>{{
        t('common.save')
      }}</NButton> </NForm
    ><template #footer
      ><NButton :disabled="busy" @click="emit('close')">{{ t('common.cancel') }}</NButton></template
    >
  </FormModal>
</template>
<style scoped>
.limit {
  display: grid;
  gap: 8px;
  width: 100%;
}
p {
  color: var(--bs-text-muted);
  font-size: 13px;
  line-height: 1.6;
}
</style>
