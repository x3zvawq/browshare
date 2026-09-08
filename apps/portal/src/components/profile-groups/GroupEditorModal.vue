<script setup lang="ts">
import FormModal from '@/components/forms/FormModal.vue'
import { NAlert, NButton, NForm, NFormItem, NInput, type FormInst, type FormRules } from 'naive-ui'
import { reactive, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ProfileGroup, ProfileGroupInput } from '@/api/types.js'
import AccessibleInputNumber from '@/components/forms/AccessibleInputNumber.vue'
const props = defineProps<{ group: ProfileGroup | null; busy: boolean; error: string }>()
const emit = defineEmits<{ close: []; submit: [input: ProfileGroupInput] }>()
const { t } = useI18n()
const form = useTemplateRef<FormInst>('form')
const model = reactive({
  name: props.group?.name ?? '',
  description: props.group?.description ?? '',
  priority: props.group?.priority ?? (0 as number | null),
})
const rules: FormRules = {
  name: {
    validator: () => model.name.trim().length > 0 || new Error(t('profileGroups.nameRequired')),
    trigger: ['input', 'blur'],
  },
  priority: {
    validator: () =>
      (model.priority !== null && Number.isInteger(model.priority)) ||
      new Error(t('profileGroups.priorityRequired')),
    trigger: ['change', 'blur'],
  },
}
async function submit() {
  try {
    await form.value?.validate()
  } catch {
    return
  }
  if (model.priority === null) return
  emit('submit', {
    name: model.name.trim(),
    description: model.description.trim() || null,
    priority: model.priority,
  })
}
</script>
<template>
  <FormModal
    :title="t(group ? 'profileGroups.edit' : 'profileGroups.create')"
    :busy="busy"
    :width="560"
    @close="emit('close')"
  >
    <NAlert v-if="error" type="error" :title="error" />
    <NForm
      ref="form"
      :model="model"
      :rules="rules"
      label-placement="top"
      :disabled="busy"
      @submit.prevent="submit"
    >
      <NFormItem path="name" :label="t('profileGroups.name')"
        ><NInput
          v-model:value="model.name"
          :maxlength="128"
          :input-props="{ 'aria-label': t('profileGroups.name') }"
      /></NFormItem>
      <NFormItem :label="t('profileGroups.description')"
        ><NInput
          v-model:value="model.description"
          type="textarea"
          :maxlength="4000"
          :input-props="{ 'aria-label': t('profileGroups.description') }"
      /></NFormItem>
      <NFormItem path="priority" :label="t('profileGroups.priority')"
        ><AccessibleInputNumber
          v-model:value="model.priority"
          :min="-2147483648"
          :max="2147483647"
          :precision="0"
          :label="t('profileGroups.priority')"
      /></NFormItem>
      <p class="editor-hint">{{ t('profileGroups.priorityHint') }}</p>
    </NForm>
    <template #footer
      ><div class="editor-actions">
        <NButton :disabled="busy" @click="emit('close')">{{ t('common.cancel') }}</NButton
        ><NButton type="primary" :loading="busy" @click="submit">{{ t('common.save') }}</NButton>
      </div></template
    >
  </FormModal>
</template>
<style scoped>
.editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
.editor-hint {
  color: var(--text-secondary);
  font-size: 13px;
  margin-top: 0;
}
</style>
