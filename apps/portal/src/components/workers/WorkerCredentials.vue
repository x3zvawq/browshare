<script setup lang="ts">
import { useAppDialog as useDialog } from '@/composables/useAppDialog.js'
import { onScopeDispose, shallowRef, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NEmpty, NInput, NModal, NSkeleton, NTag, NTime, useMessage } from 'naive-ui'
import { api } from '@/api/client.js'
import { apiFailure, networkFailure, type ApiFailure } from '@/api/errors.js'
import type {
  ManagedWorker,
  WorkerCredential,
  WorkerRotation,
  IssuedWorkerRotation,
} from '@/api/types.js'
import WorkerRequestError from './WorkerRequestError.vue'
const props = defineProps<{ worker: ManagedWorker; canManage: boolean }>(),
  emit = defineEmits<{ refresh: [] }>(),
  { t } = useI18n(),
  dialog = useDialog(),
  message = useMessage()
const certificates = shallowRef<WorkerCredential[] | null>(null),
  rotations = shallowRef<WorkerRotation[]>([]),
  error = shallowRef<ApiFailure | null>(null),
  loadError = shallowRef<ApiFailure | null>(null),
  loading = shallowRef(false),
  busy = shallowRef(false),
  issued = shallowRef<IssuedWorkerRotation | null>(null)
const tokenTitleId = useId()
let controller: AbortController | undefined
function refresh() {
  error.value = null
  void load()
}
async function load() {
  controller?.abort()
  const current = new AbortController()
  controller = current
  loading.value = true
  try {
    const results = await Promise.all([
      api.GET('/workers/{workerId}/credentials', {
        params: { path: { workerId: props.worker.id } },
        signal: current.signal,
      }),
      api.GET('/workers/{workerId}/credential-rotations', {
        params: { path: { workerId: props.worker.id } },
        signal: current.signal,
      }),
    ])
    const [certs, rotation] = results
    if (!certs.data) throw apiFailure(certs.error, certs.response)
    if (!rotation.data) throw apiFailure(rotation.error, rotation.response)
    if (!current.signal.aborted) {
      certificates.value = certs.data.items
      rotations.value = rotation.data.items
      loadError.value = null
    }
  } catch (cause) {
    if (!current.signal.aborted) loadError.value = networkFailure(cause)
  } finally {
    if (controller === current) loading.value = false
  }
}
async function perform(op: () => Promise<void>) {
  if (busy.value) return false
  busy.value = true
  error.value = null
  try {
    await op()
    await load()
    emit('refresh')
    return true
  } catch (cause) {
    const failure = networkFailure(cause)
    error.value = failure
    message.error(
      `${t('workerManagement.failed')} · ${failure.code}${failure.requestId ? ` · ${failure.requestId}` : ''}`,
    )
    return false
  } finally {
    busy.value = false
  }
}
function revoke(certificate: WorkerCredential) {
  dialog.warning({
    title: t('workerManagement.revokeTitle'),
    content: t('workerManagement.revokeHint'),
    positiveText: t('workerManagement.revoke'),
    negativeText: t('workerManagement.cancel'),
    onPositiveClick: () =>
      perform(async () => {
        const r = await api.POST('/workers/{workerId}/credentials/{credentialId}/revoke', {
          params: { path: { workerId: props.worker.id, credentialId: certificate.id } },
          body: {},
        })
        if (!r.data) throw apiFailure(r.error, r.response)
      }),
  })
}
function rotate() {
  dialog.warning({
    title: t('workerManagement.rotateTitle'),
    content: t('workerManagement.rotateHint'),
    positiveText: t('workerManagement.rotate'),
    negativeText: t('workerManagement.cancel'),
    onPositiveClick: () =>
      perform(async () => {
        const r = await api.POST('/workers/{workerId}/credential-rotations', {
          params: { path: { workerId: props.worker.id } },
          body: {},
        })
        if (!r.data) throw apiFailure(r.error, r.response)
        issued.value = r.data
      }),
  })
}
function revokeRotation(rotation: WorkerRotation) {
  dialog.warning({
    title: t('workerManagement.rotationRevoke'),
    content: t('workerManagement.rotationRevokeHint'),
    positiveText: t('workerManagement.revoke'),
    negativeText: t('workerManagement.cancel'),
    onPositiveClick: () =>
      perform(async () => {
        const r = await api.POST('/workers/{workerId}/credential-rotations/{rotationId}/revoke', {
          params: { path: { workerId: props.worker.id, rotationId: rotation.id } },
        })
        if (!r.data) throw apiFailure(r.error, r.response)
      }),
  })
}
async function copy() {
  if (!issued.value) return
  try {
    await navigator.clipboard.writeText(issued.value.token)
    message.success(t('workerManagement.copied'))
  } catch {
    message.error(t('workers.tokenCopyFailed'))
  }
}
void load()
const timer = window.setInterval(() => {
  if (document.visibilityState === 'visible' && !busy.value && !loading.value && !issued.value)
    void load()
}, 10000)
onScopeDispose(() => {
  controller?.abort()
  clearInterval(timer)
  issued.value = null
})
</script>
<template>
  <section class="credential-card">
    <header>
      <h2>{{ t('workerManagement.credentials') }}</h2>
      <NButton :loading="loading" :disabled="busy" @click="refresh">{{
        t('workerManagement.refresh')
      }}</NButton>
    </header>
    <WorkerRequestError v-if="error" :error="error" /><WorkerRequestError
      v-if="loadError"
      :error="loadError"
    /><NSkeleton v-if="!certificates && loading" height="160px" /><NEmpty
      v-if="certificates?.length === 0"
      :description="t('workerManagement.noCredentials')"
    />
    <ul>
      <li v-for="certificate in certificates" :key="certificate.id">
        <code>{{ certificate.id }}</code>
        <div class="actions">
          <NTag :type="certificate.status === 'ACTIVE' ? 'success' : 'default'" size="small">{{
            t(`workerManagement.${certificate.status}`)
          }}</NTag
          ><NTag v-if="certificate.currentConnection" type="info" size="small">{{
            t('workerManagement.currentCredential')
          }}</NTag
          ><NButton
            v-if="canManage && certificate.status === 'ACTIVE'"
            size="small"
            :disabled="busy"
            @click="revoke(certificate)"
            >{{ t('workerManagement.revoke') }}</NButton
          >
        </div>
        <p>
          {{ t('workerManagement.expires') }}:
          <NTime :time="new Date(certificate.certificateExpiresAt)" type="datetime" />
        </p>
        <small>SHA-256 · {{ certificate.certificateFingerprintSha256 }}</small>
      </li>
    </ul>
    <header>
      <h2>{{ t('workerManagement.rotations') }}</h2>
      <NButton v-if="canManage" :disabled="busy || !worker.controlConnected" @click="rotate">{{
        t('workerManagement.rotate')
      }}</NButton>
    </header>
    <NEmpty
      v-if="certificates && !rotations.length"
      :description="t('workerManagement.noRotations')"
    />
    <ul>
      <li v-for="rotation in rotations" :key="rotation.id">
        <code>{{ rotation.id }}</code>
        <div class="actions">
          <NTag size="small">{{ t(`workerManagement.${rotation.status}`) }}</NTag
          ><NButton
            v-if="canManage && rotation.status === 'ACTIVE'"
            size="small"
            :disabled="busy"
            @click="revokeRotation(rotation)"
            >{{ t('workerManagement.rotationRevoke') }}</NButton
          >
        </div>
        <p>
          {{ t('workerManagement.expires') }}:
          <NTime :time="new Date(rotation.expiresAt)" type="datetime" />
        </p>
      </li>
    </ul>
  </section>
  <NModal v-if="issued" show :close-on-esc="false" :mask-closable="false">
    <div
      class="n-modal token-dialog"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="tokenTitleId"
    >
      <h2 :id="tokenTitleId">{{ t('workerManagement.tokenTitle') }}</h2>
      <p>{{ t('workerManagement.tokenHint') }}</p>
      <p class="token-guidance">{{ t('workerManagement.tokenUse') }}</p>
      <p>
        {{ t('workerManagement.expires') }}:
        <NTime :time="new Date(issued.expiresAt)" type="datetime" />
      </p>
      <NInput
        data-sensitive="worker-rotation-token"
        :value="issued.token"
        readonly
        type="password"
        show-password-on="click"
        :input-props="{
          'aria-label': t('workerManagement.tokenTitle'),
        }"
      />
      <div class="actions token-actions">
        <NButton @click="copy">{{ t('workerManagement.tokenCopy') }}</NButton
        ><NButton type="primary" @click="issued = null">{{
          t('workerManagement.tokenClose')
        }}</NButton>
      </div>
    </div>
  </NModal>
</template>
<style scoped>
.credential-card {
  padding: 20px;
  border: 1px solid var(--bs-border);
  background: var(--bs-surface);
  border-radius: 10px;
  min-width: 0;
}
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
h2 {
  font-size: 18px;
  margin: 0;
}
ul {
  list-style: none;
  padding: 0;
  display: grid;
  gap: 16px;
}
li {
  border-bottom: 1px solid var(--bs-border);
  padding-bottom: 16px;
  overflow-wrap: anywhere;
}
code {
  display: block;
  overflow-wrap: anywhere;
}
.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 8px;
}
p,
small,
.token-guidance {
  overflow-wrap: anywhere;
  color: var(--bs-text-muted);
}
.token-actions {
  margin-top: 20px;
}
.token-dialog {
  width: min(640px, calc(100vw - 32px));
  max-height: calc(100dvh - 32px);
  overflow-y: auto;
  border: 1px solid var(--bs-border);
  border-radius: 12px;
  background: var(--bs-surface);
  color: var(--bs-text);
  box-shadow: 0 18px 60px rgb(0 0 0 / 26%);
  padding: 22px;
}
.token-dialog h2 {
  font-size: 19px;
  overflow-wrap: anywhere;
}
</style>
