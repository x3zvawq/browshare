<script setup lang="ts">
import FormModal from '@/components/forms/FormModal.vue'
import StorageBlockNotice from '@/components/storage/StorageBlockNotice.vue'
import { shallowRef } from 'vue'
import { NButton, NForm, NFormItem, NInput } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { api } from '@/api/client.js'
import { apiFailure, networkFailure, type ApiFailure } from '@/api/errors.js'
import type { AccessibleProfile, TabSession } from '@/api/types.js'
import RequestError from './RequestError.vue'
const props = defineProps<{ profile: AccessibleProfile }>()
const emit = defineEmits<{ close: []; created: [session: TabSession] }>()
const { t } = useI18n()
const url = shallowRef(''),
  busy = shallowRef(false),
  validation = shallowRef(''),
  error = shallowRef<ApiFailure | null>(null)
async function create() {
  if (busy.value || props.profile.storageBlockedReason) return
  validation.value = ''
  let parsed: URL
  try {
    parsed = new URL(url.value.trim())
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password)
      throw new Error()
  } catch {
    validation.value = t('workspace.invalidUrl')
    return
  }
  busy.value = true
  error.value = null
  try {
    const result = await api.POST('/sessions', {
      body: { profileId: props.profile.id, initialUrl: parsed.href },
    })
    if (!result.data) throw apiFailure(result.error, result.response)
    emit('created', result.data)
  } catch (cause) {
    error.value = networkFailure(cause)
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <FormModal
    :title="t('workspace.createIn', { name: profile.name })"
    :busy="busy"
    :width="520"
    mask-closable
    @close="emit('close')"
  >
    <p>{{ t('workspace.sharedStorage') }}</p>
    <StorageBlockNotice
      :reason="profile.storageBlockedReason"
      :pending="profile.storagePolicyPending"
    />
    <NForm @submit.prevent="create"
      ><NFormItem
        :label="t('workspace.initialUrl')"
        :feedback="validation"
        v-bind="validation ? { validationStatus: 'error' as const } : {}"
        ><NInput
          v-model:value="url"
          placeholder="https://example.com"
          :input-props="{
            type: 'url',
            autofocus: true,
            autocomplete: 'url',
            'aria-label': t('workspace.initialUrl'),
          }"
          :disabled="busy"
          @keydown.enter.prevent="create" /></NFormItem
    ></NForm>
    <RequestError v-if="error" :error="error" />
    <template #footer
      ><div class="actions">
        <NButton :disabled="busy" @click="$emit('close')">{{ t('workspace.cancel') }}</NButton
        ><NButton
          type="primary"
          :disabled="!!profile.storageBlockedReason"
          :loading="busy"
          @click="create"
          >{{ t('workspace.create') }}</NButton
        >
      </div></template
    >
  </FormModal>
</template>
<style scoped>
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>
