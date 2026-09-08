<script setup lang="ts">
import { useAppDialog as useDialog } from '@/composables/useAppDialog.js'
import { computed, onScopeDispose, reactive, shallowRef } from 'vue'
import {
  NAlert,
  NButton,
  NCheckbox,
  NForm,
  NFormItem,
  NInputNumber,
  NSkeleton,
  NSwitch,
  useMessage,
} from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { api } from '@/api/client.js'
import { apiFailure, networkFailure, type ApiFailure } from '@/api/errors.js'
import type { RegistrationSettings } from '@/api/types.js'
const { t } = useI18n(),
  dialog = useDialog(),
  message = useMessage()
const current = shallowRef<RegistrationSettings | null>(null),
  error = shallowRef<ApiFailure | null>(null),
  loading = shallowRef(false),
  saving = shallowRef(false),
  invalid = shallowRef(false)
const draft = reactive({ open: false, unlimited: false, maximum: 1 as number | null })
let controller: AbortController | undefined
const value = computed<RegistrationSettings>(() => ({
  registrationOpen: draft.open,
  emailVerificationRequired: false,
  defaultMaxActiveSessions: draft.unlimited ? null : draft.maximum,
}))
const dirty = computed(
  () =>
    current.value !== null &&
    (current.value.registrationOpen !== draft.open ||
      current.value.defaultMaxActiveSessions !== value.value.defaultMaxActiveSessions ||
      current.value.emailVerificationRequired),
)
function accept(data: RegistrationSettings) {
  current.value = data
  draft.open = data.registrationOpen
  draft.unlimited = data.defaultMaxActiveSessions === null
  draft.maximum = data.defaultMaxActiveSessions ?? 1
  invalid.value = false
}
async function load() {
  controller?.abort()
  const request = new AbortController()
  controller = request
  loading.value = true
  try {
    const r = await api.GET('/settings/registration', { signal: request.signal })
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
async function save() {
  saving.value = true
  error.value = null
  try {
    const r = await api.PUT('/settings/registration', { body: value.value })
    if (!r.data) throw apiFailure(r.error, r.response)
    accept(r.data)
    message.success(t('settings.saved'))
    return true
  } catch (cause) {
    const failure = networkFailure(cause)
    error.value = failure
    message.error(
      `${t('settings.failed')} · ${failure.code}${failure.requestId ? ` · ${failure.requestId}` : ''}`,
    )
    return false
  } finally {
    saving.value = false
  }
}
function submit() {
  if (saving.value || loading.value || !dirty.value) return
  invalid.value =
    !draft.unlimited &&
    (draft.maximum === null ||
      !Number.isInteger(draft.maximum) ||
      draft.maximum < 0 ||
      draft.maximum > 1000000)
  if (invalid.value) return
  if (draft.open && !current.value?.registrationOpen) {
    dialog.warning({
      title: t('settings.openTitle'),
      content: t('settings.openConfirm'),
      positiveText: t('settings.confirm'),
      negativeText: t('settings.cancel'),
      onPositiveClick: save,
    })
  } else void save()
}
void load()
onScopeDispose(() => controller?.abort())
</script>
<template>
  <section class="settings-page">
    <header>
      <h1>{{ t('settings.title') }}</h1>
      <p>{{ t('settings.intro') }}</p>
    </header>
    <NAlert v-if="error" type="error" role="alert" :title="t('settings.failed')"
      ><small
        >{{ error.code }}<template v-if="error.requestId"> · {{ error.requestId }}</template></small
      >
      <NButton v-if="!current" :loading="loading" @click="load">{{ t('settings.reload') }}</NButton>
    </NAlert>
    <NSkeleton v-if="loading && !current" height="300px" />
    <NForm
      v-if="current"
      class="settings-card"
      :disabled="saving || loading"
      @submit.prevent="submit"
    >
      <h2>{{ t('settings.registration') }}</h2>
      <NFormItem :label="t('settings.open')"
        ><div>
          <NSwitch v-model:value="draft.open" :aria-label="t('settings.open')" />
          <p>{{ t('settings.openHint') }}</p>
        </div></NFormItem
      >
      <NFormItem
        :label="t('settings.maximum')"
        v-bind="
          invalid ? { validationStatus: 'error' as const, feedback: t('settings.invalid') } : {}
        "
      >
        <div class="limit">
          <NCheckbox v-model:checked="draft.unlimited">{{ t('settings.unlimited') }}</NCheckbox
          ><NInputNumber
            v-if="!draft.unlimited"
            v-model:value="draft.maximum"
            :min="0"
            :max="1000000"
            :precision="0"
            :input-props="{ 'aria-label': t('settings.maximum') }"
          />
          <p>{{ t('settings.maximumHint') }}</p>
        </div>
      </NFormItem>
      <NFormItem :label="t('settings.email')"
        ><div>
          <NSwitch :value="false" disabled :aria-label="t('settings.email')" />
          <p>{{ t('settings.unavailable') }}</p>
        </div></NFormItem
      >
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
.settings-page {
  display: grid;
  gap: 20px;
  max-width: 760px;
}
h1,
h2 {
  margin: 0;
}
h1 {
  font-size: 24px;
}
h2 {
  font-size: 18px;
  margin-bottom: 24px;
}
p {
  color: var(--bs-text-muted);
  margin: 8px 0 0;
}
.settings-card {
  background: var(--bs-surface);
  border: 1px solid var(--bs-border);
  border-radius: 10px;
  padding: 24px;
  min-width: 0;
}
.limit {
  display: grid;
  gap: 12px;
  width: 100%;
}
footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 12px;
}
footer span {
  color: var(--bs-text-muted);
  margin-right: auto;
}
@media (max-width: 600px) {
  .settings-card {
    padding: 16px;
  }
}
</style>
