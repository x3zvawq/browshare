<script setup lang="ts">
import FormModal from '@/components/forms/FormModal.vue'
import { reactive, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { NAlert, NButton, NForm, NFormItem, NInput, type FormInst, type FormRules } from 'naive-ui'
import type { ManagedUser } from '@/api/types.js'
import type { ApiFailure } from '@/api/errors.js'
import UserRequestError from './UserRequestError.vue'
const props = defineProps<{ user: ManagedUser; busy: boolean; error: ApiFailure | null }>()
const emit = defineEmits<{ close: []; submit: [password: string] }>()
const { t } = useI18n(),
  form = useTemplateRef<FormInst>('form'),
  model = reactive({ password: '', confirm: '' })
const rules: FormRules = {
  password: {
    validator: () =>
      (model.password.length >= 10 && model.password.length <= 1024) ||
      new Error(t('users.invalidPassword')),
    trigger: ['blur', 'input'],
  },
  confirm: {
    validator: () => model.confirm === model.password || new Error(t('users.mismatch')),
    trigger: ['blur', 'input'],
  },
}
async function submit() {
  if (props.busy) return
  try {
    await form.value?.validate()
  } catch {
    return
  }
  emit('submit', model.password)
}
</script>
<template>
  <FormModal :title="t('users.reset')" :busy="busy" :width="560" @close="emit('close')"
    ><NAlert type="warning" :bordered="false">{{
      t('users.resetHint', { name: `${user.displayName} (${user.email})` })
    }}</NAlert
    ><UserRequestError v-if="error" :error="error" /><NForm
      ref="form"
      :model="model"
      :rules="rules"
      :disabled="busy"
      label-placement="top"
      @submit.prevent="submit"
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
          }" /></NFormItem
      ><NButton type="error" attr-type="submit" :loading="busy" block>{{
        t('users.reset')
      }}</NButton></NForm
    ><template #footer
      ><NButton :disabled="busy" @click="emit('close')">{{ t('common.cancel') }}</NButton></template
    ></FormModal
  >
</template>
<style scoped>
.n-form {
  margin-top: 20px;
}
</style>
