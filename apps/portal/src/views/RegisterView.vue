<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { NButton, NResult, NSpin } from 'naive-ui'
import { computed, onMounted, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import { ApiFailure } from '@/api/errors.js'
import AuthShell from '@/components/auth/AuthShell.vue'
import RegisterForm from '@/components/auth/RegisterForm.vue'
import { useSessionStore } from '@/stores/session.js'
import { safeRedirect } from '@/utils/navigation.js'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const { publicConfiguration } = storeToRefs(session)
const { t } = useI18n()
const loadingConfiguration = shallowRef(true)
const configurationUnavailable = shallowRef(false)
const busy = shallowRef(false)
const failure = shallowRef<ApiFailure | null>(null)

const canRegister = computed(() => publicConfiguration.value?.registrationOpen === true)

onMounted(loadConfiguration)

async function loadConfiguration(): Promise<void> {
  loadingConfiguration.value = true
  configurationUnavailable.value = false
  try {
    await session.loadPublicConfiguration({ refresh: true })
  } catch {
    configurationUnavailable.value = true
  } finally {
    loadingConfiguration.value = false
  }
}

async function register(credentials: {
  readonly email: string
  readonly password: string
}): Promise<void> {
  busy.value = true
  failure.value = null
  try {
    await session.register(credentials.email, credentials.password)
    await router.replace(
      safeRedirect(route.query.redirect) ??
        (session.user?.permissions.includes('session.use') ? '/workspace' : '/account/security'),
    )
  } catch (error) {
    failure.value = localizeFailure(error)
    if (failure.value.code === 'REGISTRATION_DISABLED') {
      await session.loadPublicConfiguration({ refresh: true }).catch(() => undefined)
    }
  } finally {
    busy.value = false
  }
}

function localizeFailure(error: unknown): ApiFailure {
  const failure =
    error instanceof ApiFailure ? error : new ApiFailure({ code: 'UNKNOWN', message: '' })
  const messages: Readonly<Record<string, string>> = {
    CONFLICT: t('auth.errors.accountExists'),
    REGISTRATION_DISABLED: t('auth.errors.registrationDisabled'),
    NETWORK_ERROR: t('auth.errors.network'),
    BAD_REQUEST: t('auth.errors.invalidRegistration'),
  }
  return new ApiFailure({
    code: failure.code,
    message: messages[failure.code] ?? t('auth.errors.generic'),
    ...(failure.requestId === undefined ? {} : { requestId: failure.requestId }),
    ...(failure.status === undefined ? {} : { status: failure.status }),
  })
}
</script>

<template>
  <AuthShell
    :eyebrow="$t('auth.registerEyebrow')"
    :title="$t('auth.registerTitle')"
    :description="$t('auth.registerDescription')"
  >
    <div v-if="loadingConfiguration" class="configuration-loading">
      <NSpin size="small" />
      <span>{{ $t('auth.loadingRegistration') }}</span>
    </div>
    <NResult
      v-else-if="configurationUnavailable"
      status="500"
      :title="$t('auth.registrationUnavailableTitle')"
      :description="$t('auth.registrationUnavailableDescription')"
    >
      <template #footer>
        <NButton @click="loadConfiguration">{{ $t('common.retry') }}</NButton>
      </template>
    </NResult>
    <NResult
      v-else-if="!canRegister"
      status="403"
      :title="$t('auth.registrationClosedTitle')"
      :description="$t('auth.registrationClosedDescription')"
    />
    <RegisterForm
      v-else
      :busy="busy"
      :error="failure?.message"
      :request-id="failure?.requestId"
      @submit="register"
    />
    <template #footer>
      {{ $t('auth.haveAccount') }}
      <RouterLink
        class="auth-link"
        :to="{ name: 'login', query: { redirect: route.query.redirect } }"
      >
        {{ $t('auth.goLogin') }}
      </RouterLink>
    </template>
  </AuthShell>
</template>

<style scoped>
.configuration-loading {
  display: flex;
  min-height: 180px;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--bs-text-muted);
  font-size: 13px;
}

.auth-link {
  margin-left: 4px;
  color: var(--bs-primary);
  font-weight: 650;
  text-decoration: none;
}

.auth-link:hover {
  text-decoration: underline;
}
</style>
