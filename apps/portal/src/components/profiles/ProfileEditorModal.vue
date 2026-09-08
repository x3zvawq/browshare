<script setup lang="ts">
import { CloseOutline } from '@vicons/ionicons5'
import type { FormInst, FormRules, SelectOption } from 'naive-ui'
import {
  NAlert,
  NButton,
  NCheckbox,
  NForm,
  NFormItem,
  NIcon,
  NInput,
  NModal,
  NSelect,
  NSwitch,
} from 'naive-ui'
import { computed, reactive, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import type {
  CreateProfileInput,
  Profile,
  ProfileListFacets,
  UpdateProfileInput,
} from '@/api/types.js'
import StorageQuotaFields from '@/components/storage/StorageQuotaFields.vue'
import ProfileStorageStatus from '@/components/storage/ProfileStorageStatus.vue'
import MediaPolicyFields from '@/components/media-settings/MediaPolicyFields.vue'
import ViewerFocusFields from '@/components/viewer-focus/ViewerFocusFields.vue'
import { focusMessages } from '@/components/viewer-focus/messages.js'
import RuntimeRouteStatus from '@/components/proxies/RuntimeRouteStatus.vue'
import { proxyRuntimeMessages } from '@/components/proxies/messages.js'
import type { ViewerFocusPolicy } from '@/api/types.js'
import AccessibleInputNumber from '@/components/forms/AccessibleInputNumber.vue'

const props = defineProps<{
  readonly show: boolean
  readonly profile: Profile | null
  readonly workers: ProfileListFacets['workers']
  readonly proxies: ProfileListFacets['proxies']
  readonly busy: boolean
  readonly error: string | null
  readonly requestId: string | undefined
}>()

const emit = defineEmits<{
  close: []
  submit: [input: CreateProfileInput | UpdateProfileInput]
}>()

const { t } = useI18n({
  messages: {
    'zh-CN': { ...focusMessages['zh-CN'], ...proxyRuntimeMessages['zh-CN'] },
    'en-US': { ...focusMessages['en-US'], ...proxyRuntimeMessages['en-US'] },
  },
})
const formRef = useTemplateRef<FormInst>('form')
const model = reactive({
  storageQuotaBytes: null as number | null,
  unlimitedStorage: true,
  inheritViewerFocus: true,
  focusMode: 'WHEN_UNFOCUSED' as ViewerFocusPolicy['mode'],
  focusGracePeriodMs: 15000 as number | null,
  name: '',
  description: '',
  workerId: '',
  proxyId: null as string | null,
  healthcheckUrl: '',
  visibility: 'RESTRICTED' as Profile['visibility'],
  runtimeMode: 'ON_DEMAND' as Profile['runtimeMode'],
  runtimeIdleTimeoutSeconds: 300 as number | null,
  unlimitedSessions: false,
  maxNormalSessions: 4 as number | null,
  tabAudioEnabled: true,
  maxWidth: 1920 as number | null,
  maxHeight: 1080 as number | null,
  maxFps: 60 as number | null,
  unlimitedBitrate: true,
  maxBitrateKbps: null as number | null,
})

const editing = computed(() => props.profile !== null)
const titleId = 'profile-editor-title'
const workerOptions = computed<SelectOption[]>(() =>
  props.workers.map((worker) => ({
    label: `${worker.name} · ${t(`profiles.workerState.${worker.state}`)}`,
    value: worker.id,
  })),
)
const proxyOptions = computed<SelectOption[]>(() => [
  { label: t('profiles.editor.directConnection'), value: '__direct__' },
  ...props.proxies.map((proxy) => ({
    label: `${proxy.name} · ${t(`proxies.type.${proxy.type}`)} · ${t(`proxies.health.${proxy.healthStatus}`)}`,
    value: proxy.id,
  })),
])
const visibilityOptions = computed<SelectOption[]>(() => [
  { label: t('profiles.visibility.RESTRICTED'), value: 'RESTRICTED' },
  { label: t('profiles.visibility.ALL_ENABLED_USERS'), value: 'ALL_ENABLED_USERS' },
])
const runtimeModeOptions = computed<SelectOption[]>(() => [
  { label: t('profiles.runtimeMode.ALWAYS_ON'), value: 'ALWAYS_ON' },
  { label: t('profiles.runtimeMode.ON_DEMAND'), value: 'ON_DEMAND' },
  { label: t('profiles.runtimeMode.MANUAL'), value: 'MANUAL' },
])

const rules: FormRules = {
  healthcheckUrl: {
    required: true,
    validator: (_rule, value: string) => {
      if (!value.trim()) return new Error(t('profiles.editor.healthcheckRequired'))
      try {
        const url = new URL(value.trim())
        if (url.protocol === 'https:' && !url.username && !url.password) return true
      } catch {
        // The same actionable message covers malformed URLs and unsupported schemes.
      }
      return new Error(t('profiles.editor.validation.healthcheckUrl'))
    },
    trigger: ['blur', 'input'],
  },
  name: {
    required: true,
    validator: (_rule, value: unknown) =>
      typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 128,
    message: () => t('profiles.editor.validation.name'),
    trigger: ['blur', 'input'],
  },
  workerId: {
    required: true,
    message: () => t('profiles.editor.validation.worker'),
    trigger: ['blur', 'change'],
  },
  runtimeIdleTimeoutSeconds: {
    validator: (_rule, value: unknown) => isIntegerInRange(value, 0, 2147483647),
    message: () => t('profiles.editor.idleValidation'),
    trigger: ['blur', 'change'],
  },
  maxNormalSessions: {
    validator: (_rule, value: unknown) =>
      model.unlimitedSessions || isIntegerInRange(value, 0, 1_000_000),
    message: () => t('profiles.editor.validation.maxSessions'),
    trigger: ['blur', 'change'],
  },
}

watch(
  () => props.show,
  (show) => {
    if (!show) return
    const profile = props.profile
    model.storageQuotaBytes = profile?.storageQuotaBytes ?? null
    model.unlimitedStorage = profile?.storageQuotaBytes == null
    model.inheritViewerFocus = !profile?.viewerFocusPolicy
    model.focusMode = profile?.viewerFocusPolicy?.mode ?? 'WHEN_UNFOCUSED'
    model.focusGracePeriodMs = profile?.viewerFocusPolicy?.gracePeriodMs ?? 15000
    model.name = profile?.name ?? ''
    model.description = profile?.description ?? ''
    model.workerId = profile?.worker.id ?? preferredWorkerId(props.workers)
    model.proxyId = profile?.proxy?.id ?? null
    model.healthcheckUrl = profile?.healthcheckUrl ?? ''
    model.visibility = profile?.visibility ?? 'RESTRICTED'
    model.runtimeMode = profile?.runtimeMode ?? 'ON_DEMAND'
    model.runtimeIdleTimeoutSeconds = profile?.runtimeIdleTimeoutSeconds ?? 300
    model.unlimitedSessions = profile?.capacity.maxNormalSessions === null
    model.maxNormalSessions = profile?.capacity.maxNormalSessions ?? 4
    model.tabAudioEnabled = profile?.tabAudioEnabled ?? true
    model.maxWidth = profile?.qualityPolicy.maxWidth ?? 1920
    model.maxHeight = profile?.qualityPolicy.maxHeight ?? 1080
    model.maxFps = profile?.qualityPolicy.maxFps ?? 60
    model.unlimitedBitrate = profile === null || profile.qualityPolicy.maxBitrateKbps === null
    model.maxBitrateKbps = profile?.qualityPolicy.maxBitrateKbps ?? null
    formRef.value?.restoreValidation()
  },
)

async function submit(): Promise<void> {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }
  if (model.maxWidth === null || model.maxHeight === null || model.maxFps === null) return
  if (!model.inheritViewerFocus && model.focusMode !== 'NEVER' && model.focusGracePeriodMs === null)
    return
  if (!model.unlimitedStorage && model.storageQuotaBytes === null) return
  const common = {
    storageQuotaBytes: model.unlimitedStorage ? null : model.storageQuotaBytes,
    viewerFocusPolicy: model.inheritViewerFocus
      ? null
      : { mode: model.focusMode, gracePeriodMs: model.focusGracePeriodMs ?? 0 },
    name: model.name.trim(),
    description: model.description.trim() || null,
    proxyId: model.proxyId,
    healthcheckUrl: model.healthcheckUrl.trim() || null,
    visibility: model.visibility,
    runtimeMode: model.runtimeMode,
    runtimeIdleTimeoutSeconds: model.runtimeIdleTimeoutSeconds ?? 300,
    maxNormalSessions: model.unlimitedSessions ? null : (model.maxNormalSessions ?? 0),
    tabAudioEnabled: model.tabAudioEnabled,
    qualityPolicy: {
      maxWidth: model.maxWidth,
      maxHeight: model.maxHeight,
      maxFps: model.maxFps,
      maxBitrateKbps: model.unlimitedBitrate ? null : (model.maxBitrateKbps ?? 100),
    },
  }
  if (props.profile === null) {
    emit('submit', { ...common, workerId: model.workerId })
  } else {
    emit('submit', common)
  }
}

function preferredWorkerId(workers: ProfileListFacets['workers']): string {
  return workers.find(({ state }) => state === 'ONLINE')?.id ?? workers[0]?.id ?? ''
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): boolean {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum
  )
}
</script>

<template>
  <NModal
    :show="show"
    :mask-closable="!busy"
    :close-on-esc="!busy"
    @mask-click="$emit('close')"
    @esc="$emit('close')"
  >
    <div
      class="n-modal profile-editor modal-surface"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
    >
      <div class="modal-header">
        <div>
          <p class="modal-eyebrow">PROFILE CONFIGURATION</p>
          <h2 :id="titleId">
            {{ editing ? $t('profiles.editor.editTitle') : $t('profiles.editor.createTitle') }}
          </h2>
        </div>
        <NButton
          v-if="!busy"
          quaternary
          circle
          :aria-label="$t('common.close')"
          @click="$emit('close')"
        >
          <template #icon><NIcon aria-hidden="true" :component="CloseOutline" /></template>
        </NButton>
      </div>
      <p class="modal-description">
        {{
          editing ? $t('profiles.editor.editDescription') : $t('profiles.editor.createDescription')
        }}
      </p>

      <NAlert v-if="error" class="form-alert" type="error" :title="error">
        <span v-if="requestId" class="request-id">
          {{ $t('common.requestId') }}: {{ requestId }}
        </span>
      </NAlert>

      <NAlert v-if="editing" type="info" class="modal-description">{{
        t('runtimeRoute.savedHint')
      }}</NAlert>
      <RuntimeRouteStatus
        v-if="profile"
        :route="profile"
        :runtime-state="profile.runtimeState"
        :active-sessions="profile.capacity.activeSessions"
      />
      <NForm ref="form" :model="model" :rules="rules" @submit.prevent="submit">
        <div class="form-grid">
          <NFormItem
            class="span-two"
            :label="$t('profiles.editor.healthcheckUrl')"
            path="healthcheckUrl"
          >
            <div class="field-stack">
              <NInput
                v-model:value="model.healthcheckUrl"
                :disabled="busy"
                :maxlength="2048"
                placeholder="https://example.com/"
                :input-props="{ 'aria-label': $t('profiles.editor.healthcheckUrl') }"
              />
              <p class="field-description">{{ $t('profiles.editor.healthcheckDescription') }}</p>
            </div>
          </NFormItem>

          <NFormItem class="span-two" :label="$t('profiles.editor.name')" path="name">
            <NInput
              v-model:value="model.name"
              :disabled="busy"
              :maxlength="128"
              show-count
              :placeholder="$t('profiles.editor.namePlaceholder')"
              :input-props="{ 'aria-label': $t('profiles.editor.name') }"
            />
          </NFormItem>

          <NFormItem class="span-two" :label="$t('profiles.editor.description')" path="description">
            <NInput
              v-model:value="model.description"
              type="textarea"
              :disabled="busy"
              :maxlength="4000"
              :autosize="{ minRows: 2, maxRows: 5 }"
              show-count
              :placeholder="$t('profiles.editor.descriptionPlaceholder')"
              :input-props="{ 'aria-label': $t('profiles.editor.description') }"
            />
          </NFormItem>

          <NFormItem :label="$t('profiles.editor.worker')" path="workerId">
            <NSelect
              v-model:value="model.workerId"
              :disabled="busy || editing"
              :options="workerOptions"
              filterable
              :placeholder="$t('profiles.editor.workerPlaceholder')"
              :input-props="{ 'aria-label': $t('profiles.editor.worker') }"
            />
            <template v-if="editing" #feedback>
              <span class="field-hint">{{ $t('profiles.editor.workerFixed') }}</span>
            </template>
          </NFormItem>

          <NFormItem :label="$t('profiles.editor.proxy')" path="proxyId">
            <NSelect
              :value="model.proxyId ?? '__direct__'"
              :disabled="busy"
              :options="proxyOptions"
              filterable
              :input-props="{ 'aria-label': $t('profiles.editor.proxy') }"
              @update:value="model.proxyId = $event === '__direct__' ? null : String($event)"
            />
            <template #feedback
              ><span class="field-hint">{{
                $t('profiles.editor.proxyDescription')
              }}</span></template
            >
          </NFormItem>

          <NFormItem :label="$t('profiles.editor.runtimeMode')" path="runtimeMode">
            <NSelect
              v-model:value="model.runtimeMode"
              :disabled="busy"
              :options="runtimeModeOptions"
              :input-props="{ 'aria-label': $t('profiles.editor.runtimeMode') }"
            />
          </NFormItem>

          <NFormItem
            v-if="model.runtimeMode === 'ON_DEMAND'"
            :label="$t('profiles.editor.idleTimeout')"
            path="runtimeIdleTimeoutSeconds"
          >
            <div class="field-stack">
              <AccessibleInputNumber
                v-model:value="model.runtimeIdleTimeoutSeconds"
                :label="$t('profiles.editor.idleTimeout')"
                :disabled="busy"
                :min="0"
                :max="2147483647"
                :precision="0"
              />
              <p class="field-description">{{ $t('profiles.editor.idleHint') }}</p>
            </div>
          </NFormItem>

          <NFormItem :label="$t('profiles.editor.visibility')" path="visibility">
            <NSelect
              v-model:value="model.visibility"
              :disabled="busy"
              :options="visibilityOptions"
              :input-props="{ 'aria-label': $t('profiles.editor.visibility') }"
            />
          </NFormItem>

          <NFormItem :label="$t('profiles.editor.maxSessions')" path="maxNormalSessions">
            <div class="compound-control">
              <AccessibleInputNumber
                v-model:value="model.maxNormalSessions"
                :label="$t('profiles.editor.maxSessions')"
                :disabled="busy || model.unlimitedSessions"
                :min="0"
                :max="1000000"
                :precision="0"
              />
              <NCheckbox v-model:checked="model.unlimitedSessions" :disabled="busy">
                {{ $t('profiles.editor.unlimited') }}
              </NCheckbox>
            </div>
          </NFormItem>

          <section class="span-two" :aria-label="t('focus.title')">
            <div class="section-label">
              <strong>{{ t('focus.title') }}</strong
              ><span>{{ t('focus.inheritHint') }}</span>
            </div>
            <NFormItem :label="t('focus.inherit')"
              ><NSwitch
                v-model:value="model.inheritViewerFocus"
                :disabled="busy"
                :aria-label="t('focus.inherit')"
            /></NFormItem>
            <ViewerFocusFields
              v-if="!model.inheritViewerFocus"
              v-model:mode="model.focusMode"
              v-model:grace-period-ms="model.focusGracePeriodMs"
              :disabled="busy"
            />
          </section>

          <section class="span-two">
            <ProfileStorageStatus v-if="profile" :profile="profile" />
            <StorageQuotaFields
              v-model:value="model.storageQuotaBytes"
              v-model:unlimited="model.unlimitedStorage"
              scope="profile"
              :max="Number.MAX_SAFE_INTEGER"
              :used-bytes="profile?.storageUsage?.usedBytes ?? null"
              :disabled="busy"
            />
          </section>

          <div class="section-label span-two">
            <strong>{{ $t('profiles.editor.qualityTitle') }}</strong>
            <span>{{ $t('profiles.editor.qualityDescription') }}</span>
          </div>

          <MediaPolicyFields
            v-model:max-width="model.maxWidth"
            v-model:max-height="model.maxHeight"
            v-model:max-fps="model.maxFps"
            v-model:max-bitrate-kbps="model.maxBitrateKbps"
            v-model:unlimited-bitrate="model.unlimitedBitrate"
            v-model:tab-audio-enabled="model.tabAudioEnabled"
            class="span-two"
            :disabled="busy"
          />
        </div>

        <div class="modal-actions">
          <NButton :disabled="busy" @click="$emit('close')">{{ $t('common.cancel') }}</NButton>
          <NButton type="primary" attr-type="submit" :loading="busy">
            {{ editing ? $t('common.save') : $t('profiles.createAction') }}
          </NButton>
        </div>
      </NForm>
    </div>
  </NModal>
</template>

<style scoped>
.field-hint {
  color: var(--bs-text-muted);
}
.profile-editor {
  width: min(760px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  overflow: auto;
}

.modal-surface {
  border: 1px solid var(--bs-border);
  border-radius: 12px;
  background: var(--bs-surface);
  box-shadow: 0 18px 60px rgb(0 0 0 / 26%);
  padding: 22px;
}

.modal-header,
.switch-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}

.modal-eyebrow {
  margin: 0 0 5px;
  color: var(--bs-primary);
  font-size: 10px;
  font-weight: 750;
  letter-spacing: 0.12em;
}

.modal-header h2 {
  margin: 0;
  color: var(--bs-text);
  font-size: 20px;
}

.modal-description {
  margin: 10px 0 20px;
  color: var(--bs-text-muted);
  font-size: 13px;
  line-height: 1.6;
}

.form-alert {
  margin-bottom: 18px;
}

.request-id {
  font-family: var(--bs-font-mono);
  font-size: 11px;
}

.field-stack {
  width: 100%;
}
.field-description {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--bs-text-muted);
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 18px;
}

.span-two {
  grid-column: 1 / -1;
}

.section-label {
  display: flex;
  flex-direction: column;
  gap: 3px;
  border-top: 1px solid var(--bs-border);
  margin: 4px 0 16px;
  padding-top: 18px;
}

.section-label strong,
.switch-row strong {
  color: var(--bs-text);
  font-size: 13px;
}

.section-label span,
.switch-row span {
  color: var(--bs-text-muted);
  font-size: 12px;
}

.compound-control {
  display: grid;
  width: 100%;
  gap: 8px;
}

.compound-control :deep(.n-input-number) {
  width: 100%;
}

.switch-row {
  width: 100%;
  align-items: center;
}

.switch-row > div {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  border-top: 1px solid var(--bs-border);
  margin-top: 4px;
  padding-top: 18px;
}

@media (max-width: 680px) {
  .profile-editor {
    width: calc(100vw - 20px);
    max-height: calc(100vh - 20px);
    padding: 18px;
  }

  .form-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .span-two {
    grid-column: 1;
  }
}
</style>
