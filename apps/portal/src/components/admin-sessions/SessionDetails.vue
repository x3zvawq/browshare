<script setup lang="ts">
import FormModal from '@/components/forms/FormModal.vue'
import { computed, onScopeDispose, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NDescriptions, NDescriptionsItem, NSkeleton } from 'naive-ui'
import { api } from '@/api/client.js'
import { apiFailure, networkFailure, type ApiFailure } from '@/api/errors.js'
import type { AdminTabSession } from '@/api/types.js'
import RequestError from '@/components/workspace/RequestError.vue'
import { sessionName } from '@/utils/tab-session.js'
const props = defineProps<{ id: string; canTerminate: boolean; busy: boolean }>()
const emit = defineEmits<{ close: []; terminate: [session: AdminTabSession] }>()
const { t, te } = useI18n()
const data = shallowRef<AdminTabSession | null>(null),
  error = shallowRef<ApiFailure | null>(null),
  loading = shallowRef(false)
let controller: AbortController | undefined
async function refresh() {
  controller?.abort()
  const current = new AbortController()
  controller = current
  loading.value = true
  try {
    const r = await api.GET('/admin/sessions/{id}', {
      params: { path: { id: props.id } },
      signal: current.signal,
    })
    if (!r.data) throw apiFailure(r.error, r.response)
    if (!current.signal.aborted) {
      data.value = r.data
      error.value = null
    }
  } catch (cause) {
    if (!current.signal.aborted) error.value = networkFailure(cause)
  } finally {
    if (current === controller) loading.value = false
  }
}
watch(
  () => props.id,
  () => {
    data.value = null
    void refresh()
  },
  { immediate: true },
)
const timer = window.setInterval(() => {
  if (!loading.value && document.visibilityState === 'visible') void refresh()
}, 5000)
onScopeDispose(() => {
  controller?.abort()
  clearInterval(timer)
})
const fields = computed(() => {
  if (!data.value) return []
  const s = data.value
  const facts = (
    [
      'id',
      'runtimeId',
      'profileGeneration',
      'viewerGeneration',
      'leaseExpiresAt',
      'runtimeObservedAt',
      'viewerConnectedAt',
      'viewerDisconnectedAt',
      'lastInputAt',
      'lastFrameChangedAt',
      'updatedAt',
      'closingAt',
      'closedAt',
      'closeReason',
      'failureCode',
    ] as const
  ).map((key) => {
    const value = s[key]
    return {
      key,
      value:
        value === null
          ? t('adminSessions.none')
          : key === 'closeReason' && te(`workspace.reasons.${value}`)
            ? `${t(`workspace.reasons.${value}`)} (${value})`
            : String(value),
    }
  })
  return [
    { key: 'userId', value: s.user.id },
    { key: 'profileId', value: s.profileId },
    { key: 'workerId', value: s.worker.id },
    ...facts,
  ]
})
</script>
<template>
  <FormModal
    :title="t('adminSessions.details')"
    :busy="false"
    :width="760"
    mask-closable
    @close="emit('close')"
  >
    <RequestError v-if="error" :error="error" />
    <NSkeleton v-if="!data && loading" height="200px" />
    <template v-if="data"
      ><h3>{{ sessionName(data) }}</h3>
      <p>{{ data.user.name }} · {{ data.profileName }} · {{ data.worker.name }}</p>
      <p>{{ t(`workspace.sessionState.${data.status}`) }}</p>
      <p class="hint">{{ t('adminSessions.diagnosticHint') }}</p>
      <NDescriptions :column="1" label-placement="top" bordered
        ><NDescriptionsItem
          v-for="field in fields"
          :key="field.key"
          :label="t(`adminSessions.${field.key}`)"
          ><span class="value">{{ field.value }}</span></NDescriptionsItem
        ></NDescriptions
      >
    </template>
    <template #footer
      ><div class="actions">
        <NButton :loading="loading" @click="refresh">{{ t('workspace.refresh') }}</NButton
        ><NButton
          v-if="canTerminate && data"
          type="error"
          :disabled="busy || ['CLOSING', 'CLOSED', 'FAILED'].includes(data.status)"
          @click="emit('terminate', data)"
          >{{ t('adminSessions.terminate') }}</NButton
        ><NButton @click="emit('close')">{{ t('common.close') }}</NButton>
      </div></template
    >
  </FormModal>
</template>
<style scoped>
h3 {
  margin: 0;
  overflow-wrap: anywhere;
}
.hint {
  color: var(--bs-text-muted);
  line-height: 1.6;
}
.value {
  overflow-wrap: anywhere;
  font-family: var(--bs-font-mono);
  font-size: 12px;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
</style>
