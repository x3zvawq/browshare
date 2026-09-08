<script setup lang="ts">
import { computed, onScopeDispose, reactive, shallowRef } from 'vue'
import {
  NAlert,
  NButton,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NSkeleton,
  NSwitch,
  useMessage,
} from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { api } from '@/api/client.js'
import { apiFailure, networkFailure, type ApiFailure } from '@/api/errors.js'
import type { SessionTransferSettings } from '@/api/types.js'

const { t, locale } = useI18n(),
  message = useMessage()
const current = shallowRef<SessionTransferSettings | null>(null)
const error = shallowRef<ApiFailure | null>(null)
const loading = shallowRef(false),
  saving = shallowRef(false),
  invalid = shallowRef(false)
const draft = reactive({
  uploadEnabled: true,
  downloadEnabled: true,
  clipboardTextEnabled: true,
  clipboardImageEnabled: true,
  maxFileBytes: 52428800 as number | null,
  maxTemporaryBytes: 209715200 as number | null,
  maxFiles: 10 as number | null,
  extensions: '',
})
const flags = [
  'uploadEnabled',
  'downloadEnabled',
  'clipboardTextEnabled',
  'clipboardImageEnabled',
] as const
let controller: AbortController | undefined
const extensions = computed(() =>
  draft.extensions
    .split(/[,，\s]+/)
    .filter(Boolean)
    .map((item) => item.toLowerCase()),
)
const value = computed(() => ({
  uploadEnabled: draft.uploadEnabled,
  downloadEnabled: draft.downloadEnabled,
  clipboardTextEnabled: draft.clipboardTextEnabled,
  clipboardImageEnabled: draft.clipboardImageEnabled,
  maxFileBytes: draft.maxFileBytes,
  maxTemporaryBytes: draft.maxTemporaryBytes,
  maxFiles: draft.maxFiles,
  allowedExtensions: extensions.value,
}))
const dirty = computed(
  () =>
    current.value !== null &&
    Object.entries(value.value).some(
      ([key, entry]) =>
        JSON.stringify(entry) !==
        JSON.stringify(current.value![key as keyof SessionTransferSettings]),
    ),
)
const valid = computed(() => {
  const v = value.value
  return (
    Number.isInteger(v.maxFileBytes) &&
    v.maxFileBytes !== null &&
    v.maxFileBytes >= 1 &&
    v.maxFileBytes <= 536870912 &&
    Number.isInteger(v.maxTemporaryBytes) &&
    v.maxTemporaryBytes !== null &&
    v.maxTemporaryBytes >= v.maxFileBytes &&
    v.maxTemporaryBytes <= 2147483648 &&
    Number.isInteger(v.maxFiles) &&
    v.maxFiles !== null &&
    v.maxFiles >= 1 &&
    v.maxFiles <= 64 &&
    v.allowedExtensions.length <= 64 &&
    new Set(v.allowedExtensions).size === v.allowedExtensions.length &&
    v.allowedExtensions.every((item) => /^\.[a-z0-9][a-z0-9._+-]{0,31}$/.test(item))
  )
})
function sizeHint(bytes: number | null) {
  return bytes === null
    ? ''
    : `${new Intl.NumberFormat(locale.value, { maximumFractionDigits: 8 }).format(bytes / 1048576)} MiB`
}
function accept(data: SessionTransferSettings) {
  current.value = data
  Object.assign(draft, data, { extensions: data.allowedExtensions.join(', ') })
  invalid.value = false
}
async function load() {
  controller?.abort()
  const request = new AbortController()
  controller = request
  loading.value = true
  try {
    const r = await api.GET('/settings/transfers', { signal: request.signal })
    if (!r.data) throw apiFailure(r.error, r.response)
    if (!request.signal.aborted) {
      accept(r.data)
      error.value = null
    }
  } catch (cause) {
    if (!request.signal.aborted) error.value = networkFailure(cause)
  } finally {
    if (controller === request) loading.value = false
  }
}
async function submit() {
  if (saving.value || loading.value || !dirty.value) return
  invalid.value = !valid.value
  if (invalid.value) return
  saving.value = true
  error.value = null
  try {
    const r = await api.PUT('/settings/transfers', { body: value.value as SessionTransferSettings })
    if (!r.data) throw apiFailure(r.error, r.response)
    accept(r.data)
    message.success(t('settings.saved'))
  } catch (cause) {
    error.value = networkFailure(cause)
  } finally {
    saving.value = false
  }
}
void load()
onScopeDispose(() => controller?.abort())
</script>
<template>
  <section class="transfer-settings" :aria-label="t('settings.transfers')">
    <NAlert v-if="error" type="error" role="alert" :title="t('settings.failed')">
      <small
        >{{ error.code }}<template v-if="error.requestId"> · {{ error.requestId }}</template></small
      >
      <NButton v-if="!current" :loading="loading" @click="load">{{ t('settings.reload') }}</NButton>
    </NAlert>
    <NSkeleton v-if="loading && !current" height="400px" />
    <NForm
      v-if="current"
      class="settings-card"
      :disabled="saving || loading"
      @submit.prevent="submit"
    >
      <h2>{{ t('settings.transfers') }}</h2>
      <p class="intro">{{ t('settings.transferHint') }}</p>
      <div class="flags">
        <NFormItem v-for="flag in flags" :key="flag" :label="t(`settings.${flag}`)">
          <NSwitch v-model:value="draft[flag]" :aria-label="t(`settings.${flag}`)" />
        </NFormItem>
      </div>
      <NFormItem :label="t('settings.maxFileBytes')">
        <div class="field">
          <NInputNumber
            v-model:value="draft.maxFileBytes"
            :min="1"
            :max="536870912"
            :precision="0"
            :input-props="{ 'aria-label': t('settings.maxFileBytes') }"
          /><small>{{ sizeHint(draft.maxFileBytes) }}</small>
        </div>
      </NFormItem>
      <NFormItem :label="t('settings.maxTemporaryBytes')">
        <div class="field">
          <NInputNumber
            v-model:value="draft.maxTemporaryBytes"
            :min="1"
            :max="2147483648"
            :precision="0"
            :input-props="{ 'aria-label': t('settings.maxTemporaryBytes') }"
          /><small>{{ sizeHint(draft.maxTemporaryBytes) }} · {{ t('settings.quotaHint') }}</small>
        </div>
      </NFormItem>
      <NFormItem :label="t('settings.maxFiles')"
        ><NInputNumber
          v-model:value="draft.maxFiles"
          :min="1"
          :max="64"
          :precision="0"
          :input-props="{ 'aria-label': t('settings.maxFiles') }"
      /></NFormItem>
      <NFormItem :label="t('settings.extensions')">
        <div class="field">
          <NInput
            v-model:value="draft.extensions"
            placeholder=".txt, .pdf, .png"
            :input-props="{ 'aria-label': t('settings.extensions') }"
          /><small>{{ t('settings.extensionsHint') }}</small>
        </div>
      </NFormItem>
      <NAlert v-if="invalid" type="error" role="alert">{{ t('settings.transferInvalid') }}</NAlert>
      <footer>
        <span role="status">{{ t(dirty ? 'settings.unsaved' : 'settings.current') }}</span
        ><NButton :disabled="saving" :loading="loading" @click="load">{{
          t('settings.reload')
        }}</NButton
        ><NButton
          type="primary"
          attr-type="submit"
          :loading="saving"
          :disabled="!dirty || loading"
          >{{ t('settings.save') }}</NButton
        >
      </footer>
    </NForm>
  </section>
</template>
<style scoped>
.transfer-settings {
  display: grid;
  gap: 20px;
  max-width: 760px;
  margin-top: 24px;
}
.settings-card {
  background: var(--bs-surface);
  border: 1px solid var(--bs-border);
  border-radius: 10px;
  padding: 24px;
  min-width: 0;
}
h2 {
  margin: 0;
  font-size: 18px;
}
.intro {
  margin: 8px 0 24px;
  color: var(--bs-text-muted);
}
.flags {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 24px;
}
.field {
  width: 100%;
  display: grid;
  gap: 8px;
}
small,
footer span {
  color: var(--bs-text-muted);
}
footer {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 24px;
}
footer span {
  flex: 1 1 auto;
}
@media (max-width: 540px) {
  .settings-card {
    padding: 16px;
  }
  .flags {
    grid-template-columns: 1fr;
  }
  footer span {
    flex-basis: 100%;
  }
}
</style>
