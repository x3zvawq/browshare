<script setup lang="ts">
import { computed, onScopeDispose, reactive, shallowRef, useTemplateRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { NAlert, NButton, NForm, NFormItem, NInput, type FormInst, type FormRules } from 'naive-ui'
import { api } from '@/api/client.js'
import { ApiFailure, apiFailure, networkFailure } from '@/api/errors.js'
import AuthShell from '@/components/auth/AuthShell.vue'
import { setupMessages } from '@/components/auth/setup-messages.js'
import { useSessionStore } from '@/stores/session.js'
import { safeRedirect } from '@/utils/navigation.js'

const { t, te } = useI18n({ messages: setupMessages })
const session = useSessionStore(),
  route = useRoute(),
  router = useRouter()
const form = useTemplateRef<FormInst>('form')
const model = reactive({ token: '', email: '', displayName: '', password: '', confirmation: '' })
const busy = shallowRef(false),
  failure = shallowRef<ApiFailure | null>(null)
const completion = shallowRef<'created' | 'already' | null>(null)
let disposed = false
const controller = new AbortController()
onScopeDispose(() => {
  disposed = true
  controller.abort()
  clearSecrets()
})
const loginTarget = computed(() => ({
  name: 'login',
  query: { redirect: safeRedirect(route.query.redirect) ?? '/workspace' },
}))
const errorMessage = computed(() => {
  const key = `setup.errors.${failure.value?.code ?? 'UNKNOWN'}`
  return t(te(key) ? key : 'setup.errors.UNKNOWN')
})
const rules = computed<FormRules>(() => ({
  token: [{ required: true, message: t('setup.required'), trigger: ['blur', 'input'] }],
  displayName: [
    { required: true, whitespace: true, message: t('setup.required'), trigger: ['blur', 'input'] },
  ],
  email: [
    { required: true, message: t('setup.required'), trigger: ['blur', 'input'] },
    { type: 'email', message: t('setup.emailInvalid'), trigger: ['blur', 'input'] },
  ],
  password: [
    { required: true, message: t('setup.required'), trigger: ['blur', 'input'] },
    { min: 10, message: t('setup.passwordLength'), trigger: ['blur', 'input'] },
  ],
  confirmation: [
    { required: true, message: t('setup.required'), trigger: ['blur', 'input'] },
    {
      validator: (_rule, value: string) =>
        value === model.password || new Error(t('setup.mismatch')),
      trigger: ['blur', 'input'],
    },
  ],
}))

function clearSecrets() {
  model.token = ''
  model.password = ''
  model.confirmation = ''
}

async function submit() {
  if (busy.value || completion.value || !session.initialization?.interactiveEnabled) return
  busy.value = true
  try {
    await form.value?.validate()
  } catch {
    busy.value = false
    return
  }
  failure.value = null
  try {
    const result = await api.POST('/bootstrap', {
      body: {
        token: model.token,
        email: model.email.trim(),
        displayName: model.displayName.trim(),
        password: model.password,
      },
      signal: controller.signal,
    })
    if (result.data === undefined) throw apiFailure(result.error, result.response)
    if (result.data?.initialized !== true) {
      throw new ApiFailure({
        code: 'UNEXPECTED_RESPONSE',
        message: 'Invalid Backend initialization response.',
        status: result.response.status,
        ...(result.response.headers.get('x-request-id')
          ? { requestId: result.response.headers.get('x-request-id')! }
          : {}),
      })
    }
    if (disposed) return
    completion.value = 'created'
    clearSecrets()
  } catch (cause) {
    if (disposed) return
    const error = networkFailure(cause)
    if (error.code === 'BOOTSTRAP_ALREADY_INITIALIZED') {
      completion.value = 'already'
      clearSecrets()
    } else failure.value = error
  } finally {
    busy.value = false
  }
}

async function recheck() {
  if (busy.value) return
  busy.value = true
  failure.value = null
  try {
    await session.restore({ refresh: true })
    if (!disposed && session.initialization?.initialized) {
      clearSecrets()
      await router.replace(loginTarget.value)
    }
  } catch (cause) {
    if (!disposed) failure.value = networkFailure(cause)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <AuthShell eyebrow="BROWSHARE" :title="t('setup.title')" :description="t('setup.description')">
    <NAlert
      v-if="completion"
      type="success"
      :title="t(completion === 'created' ? 'setup.completeTitle' : 'setup.alreadyTitle')"
    >
      {{ t(completion === 'created' ? 'setup.complete' : 'setup.already') }}
    </NAlert>
    <NButton
      v-if="completion"
      class="setup-action"
      type="primary"
      block
      @click="router.replace(loginTarget)"
    >
      {{ t('setup.login') }}
    </NButton>
    <template v-else>
      <NAlert v-if="failure" class="setup-error" type="error" :title="errorMessage" role="alert">
        <div>{{ failure.code }}</div>
        <div v-if="failure.requestId" class="request-id">
          {{ t('setup.requestId') }}: {{ failure.requestId }}
        </div>
      </NAlert>
      <NAlert
        v-if="!session.initialization?.interactiveEnabled"
        type="info"
        :title="t('setup.disabledTitle')"
      >
        {{ t('setup.disabled') }}
      </NAlert>
      <NForm v-else ref="form" :model="model" :rules="rules" size="large" @submit.prevent="submit">
        <NFormItem :label="t('setup.token')" path="token">
          <NInput
            v-model:value="model.token"
            type="password"
            show-password-on="click"
            autocomplete="off"
            :maxlength="1024"
            :disabled="busy"
            :input-props="{ 'aria-label': t('setup.token') }"
          />
        </NFormItem>
        <p class="token-hint">{{ t('setup.tokenHint') }}</p>
        <NFormItem :label="t('setup.displayName')" path="displayName">
          <NInput
            v-model:value="model.displayName"
            autocomplete="name"
            :maxlength="128"
            :disabled="busy"
            :input-props="{ 'aria-label': t('setup.displayName') }"
          />
        </NFormItem>
        <NFormItem :label="t('setup.email')" path="email">
          <NInput
            v-model:value="model.email"
            autocomplete="username"
            :maxlength="320"
            :disabled="busy"
            :input-props="{ 'aria-label': t('setup.email') }"
          />
        </NFormItem>
        <NFormItem :label="t('setup.password')" path="password">
          <NInput
            v-model:value="model.password"
            type="password"
            show-password-on="click"
            autocomplete="new-password"
            :maxlength="1024"
            :disabled="busy"
            :input-props="{ 'aria-label': t('setup.password') }"
          />
        </NFormItem>
        <NFormItem :label="t('setup.confirmation')" path="confirmation">
          <NInput
            v-model:value="model.confirmation"
            type="password"
            show-password-on="click"
            autocomplete="new-password"
            :maxlength="1024"
            :disabled="busy"
            :input-props="{ 'aria-label': t('setup.confirmation') }"
          />
        </NFormItem>
        <NButton type="primary" attr-type="submit" :loading="busy" :disabled="busy" block>{{
          t('setup.create')
        }}</NButton>
      </NForm>
      <NButton class="setup-action" :disabled="busy" block @click="recheck">{{
        t('setup.recheck')
      }}</NButton>
    </template>
  </AuthShell>
</template>

<style scoped>
.setup-action {
  margin-top: 18px;
}
.setup-error {
  margin-bottom: 18px;
}
.token-hint {
  margin: -6px 0 20px;
  color: var(--bs-text-muted);
  line-height: 1.6;
}
.request-id {
  font-family: var(--bs-font-mono);
  overflow-wrap: anywhere;
}
</style>
