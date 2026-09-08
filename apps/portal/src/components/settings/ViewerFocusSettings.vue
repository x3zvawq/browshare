<script setup lang="ts">
import { computed, onScopeDispose, reactive, shallowRef, useTemplateRef } from 'vue'
import { NAlert, NButton, NForm, NSkeleton, useMessage, type FormInst } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { api } from '@/api/client.js'
import { apiFailure, networkFailure, type ApiFailure } from '@/api/errors.js'
import type { ViewerFocusPolicy } from '@/api/types.js'
import ViewerFocusFields from '../viewer-focus/ViewerFocusFields.vue'
import { focusMessages } from '../viewer-focus/messages.js'
const { t } = useI18n({ messages: focusMessages }),
  message = useMessage()
const form = useTemplateRef<FormInst>('form')
const current = shallowRef<ViewerFocusPolicy | null>(null),
  error = shallowRef<ApiFailure | null>(null)
const loading = shallowRef(false),
  saving = shallowRef(false)
const draft = reactive({
  mode: 'WHEN_UNFOCUSED' as ViewerFocusPolicy['mode'],
  focusGracePeriodMs: 15000 as number | null,
})
const value = computed(() => ({
  mode: draft.mode,
  gracePeriodMs: draft.focusGracePeriodMs ?? (draft.mode === 'NEVER' ? 0 : null),
}))
const dirty = computed(
  () =>
    current.value !== null &&
    (value.value.mode !== current.value.mode ||
      value.value.gracePeriodMs !== current.value.gracePeriodMs),
)
let controller: AbortController | undefined
function accept(data: ViewerFocusPolicy) {
  current.value = data
  draft.mode = data.mode
  draft.focusGracePeriodMs = data.gracePeriodMs
  form.value?.restoreValidation()
}
async function load() {
  controller?.abort()
  const request = new AbortController()
  controller = request
  loading.value = true
  try {
    const r = await api.GET('/settings/viewer-focus', { signal: request.signal })
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
  try {
    await form.value?.validate()
  } catch {
    return
  }
  if (value.value.gracePeriodMs === null) return
  saving.value = true
  error.value = null
  try {
    const r = await api.PUT('/settings/viewer-focus', {
      body: { mode: value.value.mode, gracePeriodMs: value.value.gracePeriodMs },
    })
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
  <section class="focus-settings" :aria-label="t('focus.title')">
    <NAlert v-if="error" type="error" role="alert" :title="t('settings.failed')">
      <small
        >{{ error.code }}<template v-if="error.requestId"> · {{ error.requestId }}</template></small
      >
      <NButton v-if="!current" :loading="loading" @click="load">{{ t('settings.reload') }}</NButton>
    </NAlert>
    <NSkeleton v-if="loading && !current" height="240px" />
    <NForm
      v-if="current"
      ref="form"
      :model="draft"
      class="settings-card"
      :disabled="saving || loading"
      @submit.prevent="submit"
    >
      <h2>{{ t('focus.title') }}</h2>
      <p class="intro">{{ t('focus.globalHint') }}</p>
      <ViewerFocusFields
        v-model:mode="draft.mode"
        v-model:grace-period-ms="draft.focusGracePeriodMs"
        :disabled="saving || loading"
      />
      <footer>
        <span role="status">{{ t(dirty ? 'settings.unsaved' : 'settings.current') }}</span>
        <NButton :disabled="saving" :loading="loading" @click="load">{{
          t('settings.reload')
        }}</NButton>
        <NButton
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
.focus-settings {
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
  footer span {
    flex-basis: 100%;
  }
}
</style>
