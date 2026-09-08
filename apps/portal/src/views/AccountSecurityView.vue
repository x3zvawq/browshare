<script setup lang="ts">
import { useAppDialog as useDialog } from '@/composables/useAppDialog.js'
import { ShieldCheckmarkOutline } from '@vicons/ionicons5'
import { NIcon, useMessage } from 'naive-ui'
import { onMounted, shallowRef, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { api } from '@/api/client.js'
import { ApiFailure, apiFailure, networkFailure } from '@/api/errors.js'
import type { PortalSessionDevice } from '@/api/types.js'
import PasswordChangePanel from '@/components/account/PasswordChangePanel.vue'
import SessionDevicePanel from '@/components/account/SessionDevicePanel.vue'
import AppShell from '@/components/layout/AppShell.vue'
import { useSessionStore } from '@/stores/session.js'

const session = useSessionStore()
const router = useRouter()
const dialog = useDialog()
const message = useMessage()
const { t } = useI18n()

const devices = shallowRef<readonly PortalSessionDevice[]>([])
const devicesLoading = shallowRef(false)
const devicesError = shallowRef<string>()
const busySessionId = shallowRef<string>()
const revokingAll = shallowRef(false)
const changingPassword = shallowRef(false)
const passwordError = shallowRef<ApiFailure | null>(null)
const loggingOut = shallowRef(false)
const passwordPanel = useTemplateRef<InstanceType<typeof PasswordChangePanel>>('passwordPanel')

onMounted(loadDevices)

async function loadDevices(): Promise<void> {
  devicesLoading.value = true
  devicesError.value = undefined
  try {
    const { data, error, response } = await api.GET('/auth/sessions')
    if (data === undefined) throw apiFailure(error, response)
    devices.value = data.items
  } catch (error) {
    devicesError.value = localizedError(error)
  } finally {
    devicesLoading.value = false
  }
}

async function changePassword(passwords: {
  readonly currentPassword: string
  readonly newPassword: string
}): Promise<void> {
  changingPassword.value = true
  passwordError.value = null
  try {
    const { error, response } = await api.POST('/auth/change-password', { body: passwords })
    if (!response.ok) throw apiFailure(error, response)
    passwordPanel.value?.reset()
    message.success(t('account.passwordChanged'))
    await loadDevices()
  } catch (error) {
    const failure = error instanceof ApiFailure ? error : networkFailure(error)
    passwordError.value = new ApiFailure({
      code: failure.code,
      message:
        failure.code === 'PASSWORD_MISMATCH'
          ? t('account.errors.passwordMismatch')
          : localizedError(failure, false),
      ...(failure.requestId === undefined ? {} : { requestId: failure.requestId }),
      ...(failure.status === undefined ? {} : { status: failure.status }),
    })
  } finally {
    changingPassword.value = false
  }
}

function confirmRevoke(device: PortalSessionDevice): void {
  dialog.warning({
    title: device.current ? t('account.confirmCurrentTitle') : t('account.confirmRevokeTitle'),
    content: device.current
      ? t('account.confirmCurrentDescription')
      : t('account.confirmRevokeDescription', {
          device: device.deviceName ?? device.userAgentSummary ?? t('account.unknownDevice'),
        }),
    positiveText: device.current ? t('account.signOutHere') : t('account.revokeDevice'),
    negativeText: t('common.cancel'),
    positiveButtonProps: { type: 'error' },
    onPositiveClick: () => revokeDevice(device),
  })
}

async function revokeDevice(device: PortalSessionDevice): Promise<boolean> {
  busySessionId.value = device.id
  try {
    const { error, response } = await api.DELETE('/auth/sessions/{sessionId}', {
      params: { path: { sessionId: device.id } },
    })
    if (!response.ok) throw apiFailure(error, response)
    if (device.current) {
      await finishLocalSignOut()
      return true
    }
    message.success(t('account.deviceRevoked'))
    await loadDevices()
    return true
  } catch (error) {
    message.error(localizedError(error))
    return false
  } finally {
    busySessionId.value = undefined
  }
}

function confirmRevokeAll(): void {
  dialog.error({
    title: t('account.confirmAllTitle'),
    content: t('account.confirmAllDescription'),
    positiveText: t('account.revokeAllAction'),
    negativeText: t('common.cancel'),
    positiveButtonProps: { type: 'error' },
    onPositiveClick: revokeAll,
  })
}

async function revokeAll(): Promise<boolean> {
  revokingAll.value = true
  try {
    const { error, response } = await api.POST('/auth/sessions/revoke-all')
    if (!response.ok) throw apiFailure(error, response)
    await finishLocalSignOut()
    return true
  } catch (error) {
    message.error(localizedError(error))
    return false
  } finally {
    revokingAll.value = false
  }
}

async function logout(): Promise<void> {
  loggingOut.value = true
  try {
    await session.logout()
  } catch {
    message.warning(t('auth.logoutLocalOnly'))
  } finally {
    loggingOut.value = false
    await router.replace({ name: 'login', query: { reason: 'signed-out' } })
  }
}

async function finishLocalSignOut(): Promise<void> {
  session.expire()
  await router.replace({ name: 'login', query: { reason: 'signed-out' } })
}

function localizedError(cause: unknown, includeRequestId = true): string {
  const failure = networkFailure(cause)
  return `${localizedErrorTitle(cause)} · ${failure.code}${includeRequestId && failure.requestId ? ` · ${failure.requestId}` : ''}`
}

function localizedErrorTitle(error: unknown): string {
  const failure = error instanceof ApiFailure ? error : networkFailure(error)
  if (failure.code === 'NETWORK_ERROR') return t('auth.errors.network')
  if (failure.code === 'NOT_FOUND') return t('account.errors.sessionMissing')
  return t('auth.errors.generic')
}
</script>

<template>
  <AppShell
    v-if="session.user"
    :user="session.user"
    :busy="loggingOut"
    :breadcrumb-group="$t('layout.accountGroup')"
    :breadcrumb-title="$t('layout.security')"
    @logout="logout"
  >
    <section class="page-heading">
      <div>
        <p class="page-eyebrow">{{ $t('account.eyebrow') }}</p>
        <h1>{{ $t('account.title') }}</h1>
        <p>{{ $t('account.description') }}</p>
      </div>
      <div class="security-status">
        <NIcon aria-hidden="true" :component="ShieldCheckmarkOutline" :size="20" />
        <div>
          <strong>{{ $t('account.protected') }}</strong>
          <span>{{
            $t('account.sessionExpires', {
              date: new Date(session.current?.expiresAt ?? '').toLocaleDateString(),
            })
          }}</span>
        </div>
      </div>
    </section>

    <div class="security-grid">
      <PasswordChangePanel
        ref="passwordPanel"
        :busy="changingPassword"
        :error="passwordError?.message"
        :request-id="passwordError?.requestId"
        @submit="changePassword"
      />
      <SessionDevicePanel
        :items="devices"
        :loading="devicesLoading"
        :busy-session-id="busySessionId"
        :revoking-all="revokingAll"
        :error="devicesError"
        @refresh="loadDevices"
        @revoke="confirmRevoke"
        @revoke-all="confirmRevokeAll"
      />
    </div>
  </AppShell>
</template>

<style scoped>
.page-heading {
  display: flex;
  max-width: 1280px;
  margin: 0 auto 24px;
  align-items: flex-end;
  justify-content: space-between;
  gap: 32px;
}

.page-eyebrow {
  margin: 0 0 8px;
  color: var(--bs-primary) !important;
  font-size: 11px !important;
  font-weight: 750;
  letter-spacing: 0.14em;
}

.page-heading h1 {
  margin: 0;
  color: var(--bs-text);
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.025em;
}

.page-heading > div > p:last-child {
  max-width: 660px;
  margin: 8px 0 0;
  color: var(--bs-text-muted);
  font-size: 14px;
  line-height: 1.65;
}

.security-status {
  display: flex;
  min-width: 240px;
  align-items: center;
  gap: 10px;
  border: 1px solid rgb(24 160 88 / 20%);
  border-radius: 9px;
  background: rgb(24 160 88 / 7%);
  padding: 11px 13px;
  color: #18a058;
}

.security-status div {
  display: flex;
  flex-direction: column;
}

.security-status strong {
  color: var(--bs-text);
  font-size: 12px;
}

.security-status span {
  color: var(--bs-text);
  font-size: 12px;
}

.security-grid {
  display: grid;
  max-width: 1280px;
  margin: 0 auto;
  grid-template-columns: minmax(340px, 0.8fr) minmax(480px, 1.2fr);
  gap: 20px;
  align-items: stretch;
}

@media (max-width: 1160px) {
  .security-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 680px) {
  .page-heading {
    align-items: stretch;
    flex-direction: column;
    gap: 16px;
  }

  .security-status {
    min-width: 0;
  }
}
</style>
