<script setup lang="ts">
import { computed, onScopeDispose, reactive, shallowRef, useId, useTemplateRef } from 'vue'
import {
  NAlert,
  NButton,
  NForm,
  NFormItem,
  NInput,
  NModal,
  NRadio,
  NRadioGroup,
  NSelect,
  NTag,
  type FormInst,
  type FormRules,
} from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { api } from '@/api/client.js'
import { apiFailure, networkFailure, type ApiFailure } from '@/api/errors.js'
import type { Proxy, ProxyProbeResult } from '@/api/types.js'
import { useProbeWorkers } from '@/composables/useProbeWorkers.js'
import { proxyRuntimeMessages } from './messages.js'
const props = defineProps<{ proxy: Proxy }>()
const emit = defineEmits<{ close: []; completed: []; edit: [proxy: Proxy] }>()
const { t, te, locale } = useI18n({ messages: proxyRuntimeMessages })
const titleId = useId()
const modeName = useId()
const {
  workers,
  eligible,
  loading: workersLoading,
  error: workersError,
  refresh: refreshWorkers,
} = useProbeWorkers()
const form = useTemplateRef<FormInst>('form')
const draft = reactive({
  workerId: null as string | null,
  mode: 'health' as 'health' | 'exit-ip',
  exitIpUrl: '',
})
const pending = shallowRef(false),
  error = shallowRef<ApiFailure | null>(null),
  result = shallowRef<ProxyProbeResult | null>(null)
const controller = new AbortController()
const workerOptions = computed(() =>
  workers.value.map((worker) => ({
    value: worker.id,
    label: `${worker.name} · ${worker.id}${eligible.value.some((item) => item.id === worker.id) ? '' : ` · ${t('proxyProbe.workerUnavailable')}`}`,
    disabled: !eligible.value.some((item) => item.id === worker.id),
  })),
)
const missingHealthUrl = computed(() => draft.mode === 'health' && !props.proxy.healthcheckUrl)
const rules = computed<FormRules>(() => ({
  workerId: {
    required: true,
    trigger: ['change', 'blur'],
    validator: (_rule, value) =>
      eligible.value.some((worker) => worker.id === value) ||
      new Error(t('proxyProbe.workerRequired')),
  },
  exitIpUrl: {
    trigger: ['input', 'blur'],
    validator: (_rule, value) => {
      if (draft.mode !== 'exit-ip') return true
      try {
        const url = new URL(String(value).trim())
        if (
          url.protocol === 'https:' &&
          !url.username &&
          !url.password &&
          url.hostname &&
          String(value).trim().length <= 2048
        )
          return true
      } catch {
        /* Invalid draft remains editable. */
      }
      return new Error(t('proxyProbe.invalidUrl'))
    },
  },
}))
async function submit() {
  if (pending.value || missingHealthUrl.value || workersLoading.value) return
  try {
    await form.value?.validate()
  } catch {
    return
  }
  if (!draft.workerId) return
  pending.value = true
  error.value = null
  result.value = null
  try {
    const response = await api.POST('/proxies/{proxyId}/probe', {
      params: { path: { proxyId: props.proxy.id } },
      body:
        draft.mode === 'health'
          ? { mode: 'health', workerId: draft.workerId }
          : {
              mode: 'exit-ip',
              workerId: draft.workerId,
              exitIpUrl: new URL(draft.exitIpUrl.trim()).href,
            },
      signal: controller.signal,
    })
    if (!response.data) throw apiFailure(response.error, response.response)
    if (controller.signal.aborted) return
    result.value = response.data
    emit('completed')
  } catch (cause) {
    if (!controller.signal.aborted) error.value = networkFailure(cause)
  } finally {
    pending.value = false
  }
}
function close() {
  if (!pending.value) emit('close')
}
function time(value: string) {
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  )
}
onScopeDispose(() => controller.abort())
function errorText(code: string) {
  const key = `proxyErrors.${code}`
  return te(key) ? `${t(key)} (${code})` : code
}
</script>
<template>
  <NModal
    :show="true"
    :mask-closable="!pending"
    :close-on-esc="!pending"
    @mask-click="close"
    @esc="close"
  >
    <div
      class="n-modal proxy-probe-modal"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
    >
      <div class="modal-header">
        <h2 :id="titleId">{{ t('proxyProbe.title') }} · {{ proxy.name }}</h2>
        <NButton quaternary :disabled="pending" @click="close">{{ t('proxyProbe.close') }}</NButton>
      </div>
      <p class="intro">{{ t('proxyProbe.intro') }}</p>
      <NAlert v-if="workersError" type="error" :title="t('proxyProbe.requestFailed')"
        ><small
          >{{ workersError.code
          }}<template v-if="workersError.requestId">
            · {{ workersError.requestId }}</template
          ></small
        ><NButton :loading="workersLoading" :disabled="pending" @click="refreshWorkers">{{
          t('common.retry')
        }}</NButton></NAlert
      >
      <NForm
        ref="form"
        :model="draft"
        :rules="rules"
        :disabled="pending"
        :aria-busy="pending"
        @submit.prevent="submit"
      >
        <NFormItem :label="t('proxyProbe.worker')" path="workerId">
          <NSelect
            v-model:value="draft.workerId"
            filterable
            :options="workerOptions"
            :loading="workersLoading"
            :disabled="pending || workersLoading"
            :placeholder="t('proxyProbe.workerPlaceholder')"
            :input-props="{ 'aria-label': t('proxyProbe.worker') }"
          />
        </NFormItem>
        <div class="worker-help">
          <span v-if="!workersLoading && !workersError && !eligible.length">{{
            t('proxyProbe.noWorkers')
          }}</span
          ><NButton
            text
            type="primary"
            :loading="workersLoading"
            :disabled="pending"
            @click="refreshWorkers"
            >{{ t('proxyProbe.refreshWorkers') }}</NButton
          >
        </div>
        <NFormItem :label="t('proxyProbe.mode')" path="mode"
          ><NRadioGroup
            v-model:value="draft.mode"
            :name="modeName"
            :disabled="pending"
            role="radiogroup"
            :aria-label="t('proxyProbe.mode')"
            class="mode-options"
          >
            <NRadio value="health" :label="t('proxyProbe.health')" />
            <NRadio value="exit-ip" :label="t('proxyProbe.exit-ip')" /> </NRadioGroup
        ></NFormItem>
        <NAlert v-if="missingHealthUrl" type="warning"
          >{{ t('proxyProbe.missingHealthUrl')
          }}<NButton text type="primary" @click="emit('edit', proxy)">{{
            t('proxyProbe.edit')
          }}</NButton></NAlert
        >
        <div v-else-if="draft.mode === 'health'" class="health-destination">
          <p>{{ t('proxyProbe.healthHint') }}</p>
          <strong>{{ t('proxyProbe.savedHealthUrl') }}</strong>
          <p class="url">{{ proxy.healthcheckUrl }}</p>
        </div>
        <template v-else>
          <NFormItem :label="t('proxyProbe.exitIpUrl')" path="exitIpUrl"
            ><NInput
              v-model:value="draft.exitIpUrl"
              :maxlength="2048"
              :placeholder="t('proxyProbe.exitIpPlaceholder')"
              :input-props="{
                'aria-label': t('proxyProbe.exitIpUrl'),
                autocomplete: 'off',
                spellcheck: false,
              }"
          /></NFormItem>
          <p class="intro">{{ t('proxyProbe.externalHint') }}</p>
        </template>
        <NAlert v-if="error" type="error" :title="t('proxyProbe.requestFailed')" role="alert"
          ><p>{{ t('proxyProbe.requestHint') }}</p>
          <small
            >{{ error.code
            }}<template v-if="error.requestId"> · {{ error.requestId }}</template></small
          ></NAlert
        >
        <section
          v-if="result"
          class="probe-result"
          :aria-label="t('proxyProbe.result')"
          role="status"
        >
          <NTag :type="result.status === 'HEALTHY' ? 'success' : 'error'">{{
            t(result.status === 'HEALTHY' ? 'proxyProbe.succeeded' : 'proxyProbe.failed')
          }}</NTag>
          <dl>
            <dt>{{ t('proxyProbe.testedWorker') }}</dt>
            <dd>{{ result.workerId }}</dd>
            <dt>{{ t('proxyProbe.modeLabel') }}</dt>
            <dd>{{ t(`proxyProbe.${result.mode}`) }}</dd>
            <dt>{{ t('proxyProbe.checked') }}</dt>
            <dd>{{ time(result.checkedAt) }}</dd>
            <template v-if="result.latencyMilliseconds !== null"
              ><dt>{{ t('proxyProbe.elapsed') }}</dt>
              <dd>
                {{ t('proxyProbe.milliseconds', { value: result.latencyMilliseconds }) }}
              </dd></template
            ><template v-if="result.exitIp"
              ><dt>{{ t('proxyProbe.exitIp') }}</dt>
              <dd>{{ result.exitIp }}</dd></template
            ><template v-if="result.errorCode"
              ><dt>{{ t('proxyProbe.error') }}</dt>
              <dd>{{ errorText(result.errorCode) }}</dd></template
            >
          </dl>
          <p v-if="result.configurationVersion !== proxy.configurationVersion">
            {{ t('proxyProbe.configurationChanged') }}
          </p>
        </section>
        <footer>
          <span v-if="pending" role="status">{{ t('proxyProbe.pending') }}</span
          ><NButton :disabled="pending" @click="close">{{ t('proxyProbe.close') }}</NButton
          ><NButton
            type="primary"
            attr-type="submit"
            :loading="pending"
            :disabled="missingHealthUrl || workersLoading || !eligible.length"
            >{{ t(result || error ? 'proxyProbe.retry' : 'proxyProbe.submit') }}</NButton
          >
        </footer>
      </NForm>
    </div>
  </NModal>
</template>
<style scoped>
.proxy-probe-modal {
  box-sizing: border-box;
  width: min(620px, calc(100vw - 32px));
  max-height: calc(100dvh - 32px);
  overflow-y: auto;
  padding: 24px;
  border: 1px solid var(--bs-border);
  border-radius: 12px;
  background: var(--bs-surface);
  box-shadow: 0 18px 60px rgb(0 0 0 / 26%);
}
.modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}
.modal-header h2 {
  margin: 0;
  color: var(--bs-text);
  font-size: 20px;
  overflow-wrap: anywhere;
}
.modal-header :deep(.n-button) {
  flex-shrink: 0;
}
.mode-options {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.intro,
.worker-help,
.health-destination {
  color: var(--bs-text-muted);
  overflow-wrap: anywhere;
}
.intro {
  margin: 0 0 20px;
}
.worker-help {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: space-between;
  margin: -12px 0 20px;
  font-size: 12px;
}
.url,
dd {
  overflow-wrap: anywhere;
}
.health-destination {
  margin-bottom: 18px;
}
.probe-result {
  margin-top: 18px;
  padding: 16px;
  border: 1px solid var(--bs-border);
  border-radius: 10px;
}
dl {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px 16px;
  font-size: 12px;
}
dt {
  color: var(--bs-text-muted);
}
dd {
  margin: 0;
}
footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 22px;
}
footer > span {
  margin-right: auto;
  color: var(--bs-text-muted);
}
@media (max-width: 480px) {
  dl {
    grid-template-columns: minmax(0, 1fr);
    gap: 4px;
  }
  dd {
    margin-bottom: 8px;
  }
}
</style>
