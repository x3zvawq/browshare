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
} from 'naive-ui'
import { computed, reactive, shallowRef, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { proxyRuntimeMessages } from './messages.js'
import { proxyQuickEntryMessages } from './quick-entry-messages.js'
import { parseProxyUrl } from './parse-proxy-url.js'

import type { CreateProxyInput, Proxy, UpdateProxyInput } from '@/api/types.js'
import AccessibleInputNumber from '@/components/forms/AccessibleInputNumber.vue'

const props = defineProps<{
  readonly show: boolean
  readonly proxy: Proxy | null
  readonly canReadCredentials: boolean
  readonly busy: boolean
  readonly error: string | null
  readonly requestId: string | undefined
}>()

const emit = defineEmits<{
  close: []
  submit: [input: CreateProxyInput | UpdateProxyInput]
}>()

const { t } = useI18n({
  messages: {
    'zh-CN': { ...proxyRuntimeMessages['zh-CN'], ...proxyQuickEntryMessages['zh-CN'] },
    'en-US': { ...proxyRuntimeMessages['en-US'], ...proxyQuickEntryMessages['en-US'] },
  },
})
const quickUrl = shallowRef('')
const quickStatus = shallowRef<'invalid' | 'applied' | null>(null)
function applyQuickUrl(): void {
  if (props.busy) return
  try {
    const parsed = parseProxyUrl(quickUrl.value)
    Object.assign(model, parsed, { clearUsername: false, clearPassword: false })
    quickUrl.value = ''
    quickStatus.value = 'applied'
    formRef.value?.restoreValidation()
  } catch {
    quickStatus.value = 'invalid'
  }
}
const formRef = useTemplateRef<FormInst>('form')
const model = reactive({
  name: '',
  type: 'HTTP' as Proxy['type'],
  host: '',
  port: null as number | null,
  username: '',
  password: '',
  clearUsername: false,
  clearPassword: false,
  healthcheckUrl: '',
})

const editing = computed(() => props.proxy !== null)
const networkProxy = computed(() => model.type !== 'DIRECT')
const hiddenCredentials = computed(
  () => editing.value && !props.canReadCredentials && props.proxy?.credentials.readable === false,
)
const titleId = 'proxy-editor-title'
const typeOptions = computed<SelectOption[]>(() =>
  (['DIRECT', 'HTTP', 'HTTPS', 'SOCKS5'] as const).map((value) => ({
    label: t(`proxies.type.${value}`),
    value,
  })),
)

const credentialError = computed(() => {
  if (!networkProxy.value) return null
  if (model.type !== 'SOCKS5') {
    return !model.clearUsername && model.username.includes(':')
      ? t('proxies.editor.validation.httpUsername')
      : null
  }
  const hasUsername =
    !model.clearUsername &&
    (model.username.length > 0 || (hiddenCredentials.value && props.proxy?.credentials.hasUsername))
  const hasPassword =
    !model.clearPassword &&
    (model.password.length > 0 || (hiddenCredentials.value && props.proxy?.credentials.hasPassword))
  const encoder = new TextEncoder()
  if (
    Boolean(hasUsername) !== Boolean(hasPassword) ||
    (!model.clearUsername && encoder.encode(model.username).length > 255) ||
    (!model.clearPassword && encoder.encode(model.password).length > 255)
  ) {
    return t('proxies.editor.validation.socksCredentials')
  }
  return null
})

const rules: FormRules = {
  name: {
    required: true,
    validator: (_rule, value: unknown) =>
      typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 128,
    message: () => t('proxies.editor.validation.name'),
    trigger: ['blur', 'input'],
  },
  host: {
    validator: (_rule, value: unknown) =>
      !networkProxy.value ||
      (typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 255),
    message: () => t('proxies.editor.validation.host'),
    trigger: ['blur', 'input'],
  },
  port: {
    validator: (_rule, value: unknown) =>
      !networkProxy.value ||
      (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65_535),
    message: () => t('proxies.editor.validation.port'),
    trigger: ['blur', 'change'],
  },
  username: {
    validator: () => credentialError.value === null,
    message: () => credentialError.value ?? '',
    trigger: ['blur', 'input'],
  },
  password: {
    validator: () => credentialError.value === null,
    message: () => credentialError.value ?? '',
    trigger: ['blur', 'input'],
  },
  healthcheckUrl: {
    validator: (_rule, value: unknown) =>
      typeof value === 'string' &&
      (value.trim().length === 0 || isValidHealthcheckUrl(value.trim())),
    message: () => t('proxies.editor.validation.healthcheckUrl'),
    trigger: ['blur', 'input'],
  },
}

watch(
  () => props.show,
  (show) => {
    quickUrl.value = ''
    quickStatus.value = null
    if (!show) {
      model.username = ''
      model.password = ''
      return
    }
    const proxy = props.proxy
    model.name = proxy?.name ?? ''
    model.type = proxy?.type ?? 'HTTP'
    model.host = proxy?.host ?? ''
    model.port = proxy?.port ?? null
    model.username = proxy?.credentials.username ?? ''
    model.password = proxy?.credentials.password ?? ''
    model.clearUsername = false
    model.clearPassword = false
    model.healthcheckUrl = proxy?.healthcheckUrl ?? ''
    formRef.value?.restoreValidation()
  },
)

async function submit(): Promise<void> {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }

  const common = {
    name: model.name.trim(),
    type: model.type,
    healthcheckUrl: model.healthcheckUrl.trim() || null,
    ...(networkProxy.value
      ? {
          host: model.host.trim(),
          port: model.port,
        }
      : {}),
  }
  if (props.proxy === null) {
    emit('submit', {
      ...common,
      ...(networkProxy.value
        ? {
            username: model.username || null,
            password: model.password || null,
          }
        : {}),
    })
    return
  }

  const credentials: Pick<UpdateProxyInput, 'username' | 'password'> = {}
  if (networkProxy.value) {
    if (props.canReadCredentials) {
      credentials.username = model.username || null
      credentials.password = model.password || null
    } else {
      if (model.clearUsername) credentials.username = null
      else if (model.username.length > 0) credentials.username = model.username
      if (model.clearPassword) credentials.password = null
      else if (model.password.length > 0) credentials.password = model.password
    }
  }
  emit('submit', { ...common, ...credentials })
}

function isValidHealthcheckUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.username.length === 0 && url.password.length === 0
  } catch {
    return false
  }
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
      class="n-modal proxy-editor modal-surface"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
    >
      <header class="modal-header">
        <div>
          <p class="modal-eyebrow">EGRESS CONFIGURATION</p>
          <h2 :id="titleId">
            {{ editing ? $t('proxies.editor.editTitle') : $t('proxies.editor.createTitle') }}
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
      </header>
      <p class="modal-description">
        {{
          editing ? $t('proxies.editor.editDescription') : $t('proxies.editor.createDescription')
        }}
      </p>

      <NAlert v-if="error" class="form-alert" type="error" :title="error">
        <span v-if="requestId" class="request-id">
          {{ $t('common.requestId') }}: {{ requestId }}
        </span>
      </NAlert>

      <NAlert v-if="editing && proxy?.assignedProfileCount" type="info" class="modal-description">{{
        t('runtimeRoute.savedHint')
      }}</NAlert>
      <section v-if="!editing" class="quick-entry">
        <label for="proxy-quick-url">{{ t('proxyQuickEntry.title') }}</label>
        <div class="quick-entry-controls">
          <NInput
            v-model:value="quickUrl"
            type="password"
            show-password-on="click"
            :disabled="busy"
            :maxlength="9000"
            :placeholder="t('proxyQuickEntry.placeholder')"
            :input-props="{
              id: 'proxy-quick-url',
              autocomplete: 'off',
              'aria-describedby': 'proxy-quick-hint',
            }"
            @update:value="quickStatus = null"
            @keydown.enter.prevent="applyQuickUrl"
          />
          <NButton :disabled="busy || !quickUrl.trim()" @click="applyQuickUrl">{{
            t('proxyQuickEntry.apply')
          }}</NButton>
        </div>
        <small id="proxy-quick-hint">{{ t('proxyQuickEntry.hint') }}</small>
        <NAlert
          v-if="quickStatus"
          :type="quickStatus === 'invalid' ? 'error' : 'success'"
          :role="quickStatus === 'invalid' ? 'alert' : 'status'"
          >{{ t(`proxyQuickEntry.${quickStatus}`) }}</NAlert
        >
      </section>
      <NForm ref="form" :model="model" :rules="rules" @submit.prevent="submit">
        <div class="form-grid">
          <NFormItem :label="$t('proxies.editor.name')" path="name">
            <NInput
              v-model:value="model.name"
              :disabled="busy"
              :maxlength="128"
              :placeholder="$t('proxies.editor.namePlaceholder')"
              :input-props="{ 'aria-label': $t('proxies.editor.name') }"
            />
          </NFormItem>

          <NFormItem :label="$t('proxies.editor.type')" path="type">
            <NSelect
              v-model:value="model.type"
              :disabled="busy"
              :options="typeOptions"
              :input-props="{ 'aria-label': $t('proxies.editor.type') }"
            />
          </NFormItem>

          <template v-if="networkProxy">
            <NFormItem :label="$t('proxies.editor.host')" path="host">
              <NInput
                v-model:value="model.host"
                :disabled="busy"
                :maxlength="255"
                :placeholder="$t('proxies.editor.hostPlaceholder')"
                :input-props="{ 'aria-label': $t('proxies.editor.host') }"
              />
            </NFormItem>

            <NFormItem :label="$t('proxies.editor.port')" path="port">
              <AccessibleInputNumber
                v-model:value="model.port"
                :label="$t('proxies.editor.port')"
                :disabled="busy"
                :min="1"
                :max="65535"
                :precision="0"
                :placeholder="$t('proxies.editor.portPlaceholder')"
              />
            </NFormItem>

            <div class="span-two section-label">
              <strong>{{ $t('proxies.editor.credentialsTitle') }}</strong>
              <span>{{ $t('proxies.editor.credentialsDescription') }}</span>
            </div>

            <NAlert
              v-if="hiddenCredentials"
              class="span-two credential-alert"
              type="info"
              :title="$t('proxies.editor.credentialsHiddenTitle')"
            >
              {{ $t('proxies.editor.credentialsHiddenDescription') }}
            </NAlert>

            <NFormItem :label="$t('proxies.editor.username')" path="username">
              <div class="credential-control">
                <NInput
                  v-model:value="model.username"
                  :disabled="busy || model.clearUsername"
                  :maxlength="4096"
                  :placeholder="
                    hiddenCredentials && proxy?.credentials.hasUsername
                      ? $t('proxies.editor.storedCredentialPlaceholder')
                      : $t('proxies.editor.usernamePlaceholder')
                  "
                  :input-props="{ 'aria-label': $t('proxies.editor.username') }"
                />
                <NCheckbox
                  v-if="hiddenCredentials && proxy?.credentials.hasUsername"
                  v-model:checked="model.clearUsername"
                  :disabled="busy"
                >
                  {{ $t('proxies.editor.clearStoredUsername') }}
                </NCheckbox>
              </div>
            </NFormItem>

            <NFormItem :label="$t('proxies.editor.password')" path="password">
              <div class="credential-control">
                <NInput
                  v-model:value="model.password"
                  type="password"
                  show-password-on="click"
                  :disabled="busy || model.clearPassword"
                  :maxlength="4096"
                  :placeholder="
                    hiddenCredentials && proxy?.credentials.hasPassword
                      ? $t('proxies.editor.storedCredentialPlaceholder')
                      : $t('proxies.editor.passwordPlaceholder')
                  "
                  :input-props="{ 'aria-label': $t('proxies.editor.password') }"
                />
                <NCheckbox
                  v-if="hiddenCredentials && proxy?.credentials.hasPassword"
                  v-model:checked="model.clearPassword"
                  :disabled="busy"
                >
                  {{ $t('proxies.editor.clearStoredPassword') }}
                </NCheckbox>
              </div>
            </NFormItem>
          </template>

          <NFormItem
            class="span-two"
            :label="$t('proxies.editor.healthcheckUrl')"
            path="healthcheckUrl"
          >
            <NInput
              v-model:value="model.healthcheckUrl"
              :disabled="busy"
              :maxlength="2048"
              :placeholder="$t('proxies.editor.healthcheckUrlPlaceholder')"
              :input-props="{ 'aria-label': $t('proxies.editor.healthcheckUrl') }"
            />
          </NFormItem>
        </div>

        <div class="modal-actions">
          <NButton :disabled="busy" @click="$emit('close')">{{ $t('common.cancel') }}</NButton>
          <NButton type="primary" attr-type="submit" :loading="busy">
            {{ editing ? $t('common.save') : $t('proxies.createAction') }}
          </NButton>
        </div>
      </NForm>
    </div>
  </NModal>
</template>

<style scoped>
.quick-entry {
  display: grid;
  gap: 8px;
  margin-bottom: 20px;
}
.quick-entry-controls {
  display: flex;
  gap: 8px;
}
.quick-entry small {
  color: var(--bs-text-muted);
}
.quick-entry-controls :deep(.n-input) {
  min-width: 0;
}
@media (max-width: 680px) {
  .quick-entry-controls {
    flex-direction: column;
  }
}

.proxy-editor {
  width: min(700px, calc(100vw - 32px));
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

.modal-header {
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

.section-label strong {
  color: var(--bs-text);
  font-size: 13px;
}

.section-label span {
  color: var(--bs-text-muted);
  font-size: 12px;
}

.credential-alert {
  margin-bottom: 16px;
}

.credential-control {
  display: grid;
  width: 100%;
  gap: 8px;
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
  .proxy-editor {
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
