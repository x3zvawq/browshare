<script setup lang="ts">
import { useAppDialog as useDialog } from '@/composables/useAppDialog.js'
import FormModal from '@/components/forms/FormModal.vue'
import AccessibleInputNumber from '@/components/forms/AccessibleInputNumber.vue'
import { shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NCheckbox, NForm, NFormItem, NInput, useMessage } from 'naive-ui'
import { api } from '@/api/client.js'
import { apiFailure, networkFailure, type ApiFailure } from '@/api/errors.js'
import type { ManagedWorker } from '@/api/types.js'
import WorkerRequestError from './WorkerRequestError.vue'
const props = defineProps<{ worker: ManagedWorker }>(),
  emit = defineEmits<{ refresh: []; retired: [] }>(),
  { t } = useI18n(),
  dialog = useDialog(),
  message = useMessage()
const busy = shallowRef(false),
  error = shallowRef<ApiFailure | null>(null),
  modal = shallowRef<'capacity' | 'retire' | null>(null),
  maximum = shallowRef<number | null>(4),
  unlimited = shallowRef(false),
  expectedName = shallowRef(''),
  invalid = shallowRef(false)
function open(kind: 'capacity' | 'retire') {
  error.value = null
  invalid.value = false
  maximum.value = props.worker.capacity.maxActiveTabs ?? 4
  unlimited.value = props.worker.capacity.maxActiveTabs === null
  expectedName.value = ''
  modal.value = kind
}
async function perform(operation: () => Promise<void>) {
  if (busy.value) return false
  busy.value = true
  error.value = null
  try {
    await operation()
    emit('refresh')
    return true
  } catch (cause) {
    const failure = networkFailure(cause)
    error.value = failure
    if (modal.value === null)
      message.error(
        `${t('workerManagement.failed')} · ${failure.code}${failure.requestId ? ` · ${failure.requestId}` : ''}`,
      )
    return false
  } finally {
    busy.value = false
  }
}
function setState(state: 'ACTIVE' | 'DRAINING' | 'DISABLED') {
  dialog.warning({
    title: t('workerManagement.stateTitle'),
    content: t(
      state === 'ACTIVE'
        ? 'workerManagement.activeHint'
        : state === 'DRAINING'
          ? 'workerManagement.drainHint'
          : 'workerManagement.disableHint',
    ),
    positiveText: t(
      state === 'ACTIVE'
        ? 'workerManagement.activate'
        : state === 'DRAINING'
          ? 'workerManagement.drain'
          : 'workerManagement.disable',
    ),
    negativeText: t('workerManagement.cancel'),
    onPositiveClick: () =>
      perform(async () => {
        const r = await api.PUT('/workers/{workerId}/state', {
          params: { path: { workerId: props.worker.id } },
          body: { state },
        })
        if (!r.data) throw apiFailure(r.error, r.response)
        message.success(t('workerManagement.saved'))
      }),
  })
}
function probe() {
  dialog.warning({
    title: t('workerManagement.probeTitle'),
    content: t('workerManagement.probeHint'),
    positiveText: t('workerManagement.probe'),
    negativeText: t('workerManagement.cancel'),
    onPositiveClick: () =>
      perform(async () => {
        const r = await api.POST('/workers/{workerId}/diagnostics/probe', {
          params: { path: { workerId: props.worker.id } },
        })
        emit('refresh')
        if (!r.data) throw apiFailure(r.error, r.response)
        message.success(t('workerManagement.probeDone'))
      }),
  })
}
async function save() {
  invalid.value =
    modal.value === 'capacity' &&
    !unlimited.value &&
    (maximum.value === null ||
      !Number.isInteger(maximum.value) ||
      maximum.value < 0 ||
      maximum.value > 1000000)
  if (invalid.value) return
  const kind = modal.value
  if (kind === 'retire' && expectedName.value !== props.worker.name) return
  const done = await perform(async () => {
    if (kind === 'capacity') {
      const r = await api.PATCH('/workers/{workerId}', {
        params: { path: { workerId: props.worker.id } },
        body: { maxActiveTabs: unlimited.value ? null : maximum.value },
      })
      if (!r.data) throw apiFailure(r.error, r.response)
    } else {
      const r = await api.POST('/workers/{workerId}/retire', {
        params: { path: { workerId: props.worker.id } },
        body: { expectedName: expectedName.value },
      })
      if (!r.data) throw apiFailure(r.error, r.response)
      emit('retired')
    }
    message.success(t('workerManagement.saved'))
  })
  if (done) modal.value = null
}
</script>
<template>
  <div class="control-actions">
    <NButton :disabled="busy" @click="open('capacity')">{{
      t('workerManagement.capacityTitle')
    }}</NButton
    ><NButton v-if="worker.state !== 'ONLINE'" :disabled="busy" @click="setState('ACTIVE')">{{
      t('workerManagement.activate')
    }}</NButton
    ><NButton
      v-if="worker.state !== 'DRAINING' && worker.state !== 'DISABLED'"
      :disabled="busy"
      @click="setState('DRAINING')"
      >{{ t('workerManagement.drain') }}</NButton
    ><NButton
      v-if="worker.state !== 'DISABLED'"
      :disabled="busy"
      type="error"
      secondary
      @click="setState('DISABLED')"
      >{{ t('workerManagement.disable') }}</NButton
    ><NButton
      :disabled="busy || !worker.controlConnected"
      :loading="busy && !modal"
      @click="probe"
      >{{ t('workerManagement.probe') }}</NButton
    ><NButton
      type="error"
      secondary
      :disabled="busy || worker.state !== 'DISABLED'"
      @click="open('retire')"
      >{{ t('workerManagement.retire') }}</NButton
    >
  </div>
  <WorkerRequestError v-if="error && !modal" :error="error" />
  <FormModal
    v-if="modal !== null"
    :title="
      t(modal === 'retire' ? 'workerManagement.retireTitle' : 'workerManagement.capacityTitle')
    "
    :busy="busy"
    :width="580"
    mask-closable
    @close="modal = null"
  >
    <NForm :disabled="busy" @submit.prevent="save"
      ><p>
        {{
          t(modal === 'retire' ? 'workerManagement.retireHint' : 'workerManagement.capacityHint')
        }}
      </p>
      <WorkerRequestError v-if="error" :error="error" /><NFormItem
        v-if="modal === 'retire'"
        :label="t('workerManagement.expectedName')"
        ><div class="input-stack">
          <strong>{{ worker.name }}</strong
          ><NInput
            v-model:value="expectedName"
            :input-props="{ 'aria-label': t('workerManagement.expectedName') }"
          /></div></NFormItem
      ><NFormItem
        v-else
        :label="t('workerManagement.capacity')"
        v-bind="
          invalid
            ? {
                validationStatus: 'error' as const,
                feedback: t('workerManagement.invalidCapacity'),
              }
            : {}
        "
        ><div class="input-stack">
          <NCheckbox v-model:checked="unlimited">{{ t('workerManagement.unlimited') }}</NCheckbox
          ><AccessibleInputNumber
            v-if="!unlimited"
            v-model:value="maximum"
            :precision="0"
            :min="0"
            :max="1000000"
            :label="t('workerManagement.capacity')"
            :disabled="busy"
          /></div
      ></NFormItem>
      <div class="control-actions">
        <NButton :disabled="busy" @click="modal = null">{{ t('workerManagement.cancel') }}</NButton
        ><NButton
          attr-type="submit"
          type="primary"
          :loading="busy"
          :disabled="modal === 'retire' && expectedName !== worker.name"
          >{{
            t(modal === 'retire' ? 'workerManagement.retire' : 'workerManagement.save')
          }}</NButton
        >
      </div></NForm
    >
  </FormModal>
</template>
<style scoped>
.control-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.input-stack {
  display: grid;
  gap: 12px;
  width: 100%;
}
p {
  color: var(--bs-text-muted);
}
</style>
