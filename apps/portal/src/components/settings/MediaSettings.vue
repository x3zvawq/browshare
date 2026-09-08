<script setup lang="ts">
import { computed, onScopeDispose, reactive, shallowRef, useTemplateRef } from 'vue'
import { NAlert, NButton, NForm, NSkeleton, useMessage, type FormInst } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { api } from '@/api/client.js'
import { apiFailure, networkFailure, type ApiFailure } from '@/api/errors.js'
import type { SessionMediaSettings } from '@/api/types.js'
import MediaPolicyFields from '../media-settings/MediaPolicyFields.vue'
import { mediaMessages } from '../media-settings/messages.js'

const { t } = useI18n({ messages: mediaMessages })
const message = useMessage()
const form = useTemplateRef<FormInst>('form')
const current = shallowRef<SessionMediaSettings | null>(null)
const error = shallowRef<ApiFailure | null>(null)
const loading = shallowRef(false)
const saving = shallowRef(false)
const draft = reactive({
  maxWidth: 1920 as number | null,
  maxHeight: 1080 as number | null,
  maxFps: 60 as number | null,
  maxBitrateKbps: null as number | null,
  unlimitedBitrate: true,
  tabAudioEnabled: true,
})
const dirty = computed(() => {
  if (!current.value) return false
  const saved = current.value.qualityPolicy
  return (
    draft.maxWidth !== saved.maxWidth ||
    draft.maxHeight !== saved.maxHeight ||
    draft.maxFps !== saved.maxFps ||
    draft.unlimitedBitrate !== (saved.maxBitrateKbps === null) ||
    (!draft.unlimitedBitrate && draft.maxBitrateKbps !== saved.maxBitrateKbps) ||
    draft.tabAudioEnabled !== current.value.tabAudioEnabled
  )
})
let controller: AbortController | undefined

function accept(data: SessionMediaSettings) {
  current.value = data
  Object.assign(draft, data.qualityPolicy, {
    unlimitedBitrate: data.qualityPolicy.maxBitrateKbps === null,
    tabAudioEnabled: data.tabAudioEnabled,
  })
  form.value?.restoreValidation()
}

async function load() {
  if (saving.value) return
  controller?.abort()
  const request = new AbortController()
  controller = request
  loading.value = true
  error.value = null
  try {
    const r = await api.GET('/settings/media', { signal: request.signal })
    if (!r.data) throw apiFailure(r.error, r.response)
    if (!request.signal.aborted) accept(r.data)
  } catch (cause) {
    if (!request.signal.aborted) error.value = networkFailure(cause)
  } finally {
    if (controller === request) loading.value = false
  }
}

async function submit() {
  if (saving.value || loading.value || !dirty.value || !form.value) return
  controller?.abort()
  const request = new AbortController()
  controller = request
  saving.value = true
  error.value = null
  try {
    try {
      await form.value.validate()
    } catch {
      return
    }
    if (
      request.signal.aborted ||
      draft.maxWidth === null ||
      draft.maxHeight === null ||
      draft.maxFps === null ||
      (!draft.unlimitedBitrate && draft.maxBitrateKbps === null)
    )
      return
    const r = await api.PUT('/settings/media', {
      signal: request.signal,
      body: {
        qualityPolicy: {
          maxWidth: draft.maxWidth,
          maxHeight: draft.maxHeight,
          maxFps: draft.maxFps,
          maxBitrateKbps: draft.unlimitedBitrate ? null : draft.maxBitrateKbps,
        },
        tabAudioEnabled: draft.tabAudioEnabled,
      },
    })
    if (!r.data) throw apiFailure(r.error, r.response)
    if (!request.signal.aborted) {
      accept(r.data)
      message.success(t('settings.saved'))
    }
  } catch (cause) {
    if (!request.signal.aborted) error.value = networkFailure(cause)
  } finally {
    if (controller === request) saving.value = false
  }
}

void load()
onScopeDispose(() => controller?.abort())
</script>

<template>
  <section class="media-settings" :aria-label="t('mediaSettings.title')">
    <NAlert v-if="error" type="error" role="alert" :title="t('settings.failed')">
      <small class="error-details">
        {{ error.code }}<template v-if="error.requestId"> · {{ error.requestId }}</template>
      </small>
      <NButton v-if="!current" :loading="loading" @click="load">
        {{ t('settings.reload') }}
      </NButton>
    </NAlert>
    <NSkeleton v-if="loading && !current" height="360px" />
    <NForm
      v-if="current"
      ref="form"
      :model="draft"
      class="settings-card"
      :disabled="saving || loading"
      @submit.prevent="submit"
    >
      <h2 class="card-title">{{ t('mediaSettings.title') }}</h2>
      <p class="intro">{{ t('mediaSettings.globalHint') }}</p>
      <p class="effect-hint">{{ t('mediaSettings.appliesToNewSessions') }}</p>
      <MediaPolicyFields
        v-model:max-width="draft.maxWidth"
        v-model:max-height="draft.maxHeight"
        v-model:max-fps="draft.maxFps"
        v-model:max-bitrate-kbps="draft.maxBitrateKbps"
        v-model:unlimited-bitrate="draft.unlimitedBitrate"
        v-model:tab-audio-enabled="draft.tabAudioEnabled"
        :disabled="saving || loading"
      />
      <footer class="card-footer">
        <span class="save-status" role="status">
          {{ t(dirty ? 'settings.unsaved' : 'settings.current') }}
        </span>
        <NButton :disabled="saving || loading" :loading="loading" @click="load">
          {{ t('settings.reload') }}
        </NButton>
        <NButton
          type="primary"
          attr-type="submit"
          :loading="saving"
          :disabled="!dirty || saving || loading"
        >
          {{ t('settings.save') }}
        </NButton>
      </footer>
    </NForm>
  </section>
</template>

<style scoped>
.media-settings {
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
.card-title {
  margin: 0;
  font-size: 18px;
}
.intro {
  margin: 8px 0;
  color: var(--bs-text-muted);
}
.effect-hint {
  margin: 8px 0 24px;
  color: var(--bs-text-muted);
}
.error-details,
.save-status {
  color: var(--bs-text-muted);
}
.card-footer {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 24px;
}
.save-status {
  flex: 1 1 auto;
}
@media (max-width: 540px) {
  .settings-card {
    padding: 16px;
  }
  .save-status {
    flex-basis: 100%;
  }
}
</style>
