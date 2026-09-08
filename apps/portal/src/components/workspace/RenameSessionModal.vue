<script setup lang="ts">
import FormModal from '@/components/forms/FormModal.vue'
import { shallowRef } from 'vue'
import { NButton, NInput } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { api } from '@/api/client.js'
import { apiFailure, networkFailure, type ApiFailure } from '@/api/errors.js'
import type { TabSession } from '@/api/types.js'
import RequestError from './RequestError.vue'
const props = defineProps<{ session: TabSession }>()
const emit = defineEmits<{ close: []; saved: [] }>()
const { t } = useI18n()
const name = shallowRef(props.session.displayName ?? ''),
  busy = shallowRef(false),
  error = shallowRef<ApiFailure | null>(null)
async function save() {
  if (busy.value) return
  busy.value = true
  error.value = null
  try {
    const result = await api.PATCH('/sessions/{id}', {
      params: { path: { id: props.session.id } },
      body: { displayName: name.value.trim() || null },
    })
    if (!result.data) throw apiFailure(result.error, result.response)
    emit('saved')
  } catch (cause) {
    error.value = networkFailure(cause)
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <FormModal
    :title="t('workspace.rename')"
    :busy="busy"
    :width="480"
    mask-closable
    @close="emit('close')"
  >
    <p>{{ t('workspace.renameHint') }}</p>
    <NInput
      v-model:value="name"
      :maxlength="256"
      show-count
      :disabled="busy"
      :input-props="{ 'aria-label': t('workspace.sessionName'), autofocus: true }"
      @keydown.enter.prevent="save"
    /><RequestError v-if="error" :error="error" />
    <template #footer
      ><div class="actions">
        <NButton :disabled="busy" @click="$emit('close')">{{ t('workspace.cancel') }}</NButton
        ><NButton type="primary" :loading="busy" @click="save">{{ t('workspace.save') }}</NButton>
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
