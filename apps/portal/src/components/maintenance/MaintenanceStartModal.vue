<script setup lang="ts">
import FormModal from '@/components/forms/FormModal.vue'
import { NAlert, NButton, NForm, NFormItem, NInput, NSkeleton } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { TabSession } from '@/api/types.js'
import RequestError from '@/components/workspace/RequestError.vue'
import MaintenanceProfileCard from './MaintenanceProfileCard.vue'
import { useMaintenanceStart } from './useMaintenanceStart.js'
const props = defineProps<{ profileId: string; pageScriptVersionId?: string }>()
const emit = defineEmits<{ close: []; created: [session: TabSession] }>()
const { t } = useI18n()
const {
  profile,
  url,
  updateUrl,
  busy,
  loading,
  validation,
  error,
  contextError,
  canStart,
  refresh,
  create,
} = useMaintenanceStart(props, (session) => emit('created', session))
</script>
<template>
  <FormModal
    :title="t(pageScriptVersionId ? 'maintenance.testTitle' : 'maintenance.start')"
    :busy="busy"
    :width="600"
    mask-closable
    @close="emit('close')"
  >
    <div class="content">
      <NSkeleton v-if="loading && !profile" height="90px" />
      <MaintenanceProfileCard v-if="profile" :profile="profile" compact />
      <RequestError v-if="contextError" :error="contextError" />
      <NAlert type="warning">{{ t('maintenance.startHint') }}</NAlert>
      <p v-if="pageScriptVersionId">{{ t('maintenance.testSnapshot') }}</p>
      <NForm @submit.prevent="create"
        ><NFormItem
          :label="t('workspace.initialUrl')"
          :feedback="validation"
          v-bind="validation ? { validationStatus: 'error' as const } : {}"
        >
          <NInput
            :value="url"
            placeholder="https://example.com"
            :disabled="busy"
            :input-props="{
              type: 'url',
              autofocus: true,
              autocomplete: 'url',
              'aria-label': t('workspace.initialUrl'),
            }"
            @update:value="updateUrl"
            @keydown.enter.prevent="create"
          /> </NFormItem
      ></NForm>
      <RequestError v-if="error" :error="error" />
    </div>
    <template #footer
      ><div class="actions">
        <NButton :disabled="busy" @click="$emit('close')">{{ t('workspace.cancel') }}</NButton>
        <NButton :disabled="busy" :loading="loading" @click="refresh">{{
          t('workspace.refresh')
        }}</NButton>
        <NButton type="warning" :disabled="!canStart" :loading="busy" @click="create">{{
          t(profile?.activeNormalSessions ? 'maintenance.drainAndStart' : 'maintenance.start')
        }}</NButton>
      </div></template
    >
  </FormModal>
</template>
<style scoped>
.content {
  display: grid;
  gap: 20px;
  min-width: 0;
}
p {
  color: var(--bs-text-muted);
  margin: 0;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 12px;
}
.actions :deep(.n-button) {
  height: auto;
  min-height: 34px;
}
.actions :deep(.n-button__content) {
  white-space: normal;
  padding: 4px 0;
}
</style>
