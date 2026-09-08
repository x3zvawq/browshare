<script setup lang="ts">
import { reactive, shallowRef, useId, useTemplateRef } from 'vue'
import { NAlert, NButton, NForm, NModal, type FormInst } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { ApiFailure } from '@/api/errors.js'
import StorageQuotaFields from './StorageQuotaFields.vue'
import { storageMessages } from './messages.js'

const props = defineProps<{
  name: string
  scope: 'worker' | 'profile'
  quotaBytes: number | null
  usedBytes: number | null
  max: number
  busy: boolean
  error: ApiFailure | null
}>()
const emit = defineEmits<{ close: []; submit: [quotaBytes: number | null] }>()
const { t } = useI18n({ messages: storageMessages })
const titleId = useId(),
  form = useTemplateRef<FormInst>('form')
const draft = reactive({ storageQuotaBytes: props.quotaBytes })
const unlimited = shallowRef(props.quotaBytes === null)
async function submit() {
  if (props.busy) return
  try {
    await form.value?.validate()
  } catch {
    return
  }
  if (!unlimited.value && draft.storageQuotaBytes === null) return
  emit('submit', unlimited.value ? null : draft.storageQuotaBytes)
}
function close() {
  if (!props.busy) emit('close')
}
</script>
<template>
  <NModal
    :show="true"
    :mask-closable="!busy"
    :close-on-esc="!busy"
    @mask-click="close"
    @esc="close"
  >
    <div
      class="n-modal storage-quota-modal"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
    >
      <div class="modal-heading">
        <h2 :id="titleId">{{ t('storage.edit') }} · {{ name }}</h2>
        <NButton quaternary :disabled="busy" @click="close">{{ t('storage.close') }}</NButton>
      </div>
      <NAlert
        v-if="error"
        type="error"
        role="alert"
        :title="t('storage.failed')"
        class="storage-error"
        ><small
          >{{ error.code
          }}<template v-if="error.requestId"> · {{ error.requestId }}</template></small
        ></NAlert
      >
      <NForm ref="form" :model="draft" :disabled="busy" :aria-busy="busy" @submit.prevent="submit">
        <StorageQuotaFields
          v-model:value="draft.storageQuotaBytes"
          v-model:unlimited="unlimited"
          :scope="scope"
          :used-bytes="usedBytes"
          :max="max"
          :disabled="busy"
        />
        <div class="modal-actions">
          <NButton :disabled="busy" @click="close">{{ t('storage.cancel') }}</NButton
          ><NButton attr-type="submit" type="primary" :loading="busy">{{
            t('storage.save')
          }}</NButton>
        </div>
      </NForm>
    </div>
  </NModal>
</template>
<style scoped>
.storage-quota-modal {
  width: min(620px, calc(100vw - 32px));
  max-height: calc(100dvh - 32px);
  overflow-y: auto;
  background: var(--bs-surface);
  border: 1px solid var(--bs-border);
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 18px 60px rgb(0 0 0 / 26%);
}
.modal-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}
.modal-heading h2 {
  margin: 0;
  color: var(--bs-text);
  font-size: 20px;
  overflow-wrap: anywhere;
}
.modal-heading :deep(.n-button) {
  flex-shrink: 0;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 12px;
}
.storage-error {
  margin-bottom: 16px;
  overflow-wrap: anywhere;
}
</style>
