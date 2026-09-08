<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onMounted, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import { ApiFailure } from '@/api/errors.js'
import AuthShell from '@/components/auth/AuthShell.vue'
import LoginForm from '@/components/auth/LoginForm.vue'
import { useSessionStore } from '@/stores/session.js'
import { safeRedirect } from '@/utils/navigation.js'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const { publicConfiguration } = storeToRefs(session)
const { t } = useI18n()
const busy = shallowRef(false)
const failure = shallowRef<ApiFailure | null>(null)

const notice = computed(() => {
  if (route.query.reason === 'session-expired') return t('auth.sessionExpired')
  if (route.query.reason === 'signed-out') return t('auth.signedOut')
  if (route.query.reason === 'backend-unavailable') return t('auth.backendUnavailable')
  return undefined
})

onMounted(() => {
  void session.loadPublicConfiguration().catch(() => undefined)
})

async function login(credentials: {
  readonly email: string
  readonly password: string
}): Promise<void> {
  busy.value = true
  failure.value = null
  try {
    await session.login(credentials.email, credentials.password)
    await router.replace(
      safeRedirect(route.query.redirect) ??
        (session.user?.permissions.includes('session.use') ? '/workspace' : '/account/security'),
    )
  } catch (error) {
    failure.value = localizeFailure(error)
  } finally {
    busy.value = false
  }
}

function localizeFailure(error: unknown): ApiFailure {
  const failure =
    error instanceof ApiFailure ? error : new ApiFailure({ code: 'UNKNOWN', message: '' })
  const message =
    failure.code === 'AUTHENTICATION_FAILED'
      ? t('auth.errors.authenticationFailed')
      : failure.code === 'NETWORK_ERROR'
        ? t('auth.errors.network')
        : t('auth.errors.generic')
  return new ApiFailure({
    code: failure.code,
    message,
    ...(failure.requestId === undefined ? {} : { requestId: failure.requestId }),
    ...(failure.status === undefined ? {} : { status: failure.status }),
  })
}
</script>

<template>
  <AuthShell
    :eyebrow="$t('auth.loginEyebrow')"
    :title="$t('auth.loginTitle')"
    :description="$t('auth.loginDescription')"
  >
    <div v-if="notice" class="route-notice" role="status">{{ notice }}</div>
    <LoginForm
      :busy="busy"
      :error="failure?.message"
      :request-id="failure?.requestId"
      @submit="login"
    />
    <template v-if="publicConfiguration?.registrationOpen" #footer>
      {{ $t('auth.noAccount') }}
      <RouterLink
        class="auth-link"
        :to="{ name: 'register', query: { redirect: route.query.redirect } }"
      >
        {{ $t('auth.goRegister') }}
      </RouterLink>
    </template>
  </AuthShell>
</template>

<style scoped>
.route-notice {
  margin-bottom: 18px;
  border: 1px solid rgb(32 128 240 / 22%);
  border-radius: 6px;
  background: rgb(32 128 240 / 8%);
  padding: 10px 12px;
  color: var(--bs-text);
  font-size: 13px;
  line-height: 1.55;
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
