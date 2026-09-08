<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import AppShell from '@/components/layout/AppShell.vue'
import TransferSettings from '@/components/settings/TransferSettings.vue'
import MediaSettings from '@/components/settings/MediaSettings.vue'
import ViewerFocusSettings from '@/components/settings/ViewerFocusSettings.vue'
import RegistrationSettings from '@/components/settings/RegistrationSettings.vue'
import DiagnosticBundlePanel from '@/components/diagnostics/DiagnosticBundlePanel.vue'
import { useSessionStore } from '@/stores/session.js'
const session = useSessionStore(),
  router = useRouter(),
  message = useMessage(),
  { t } = useI18n()
const loggingOut = shallowRef(false)
const canDiagnose = computed(() =>
  ['system.manage', 'worker.read', 'profile.read', 'audit.read'].every((permission) =>
    session.user?.permissions.includes(permission),
  ),
)
async function logout() {
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
</script>
<template>
  <AppShell
    v-if="session.user"
    :user="session.user"
    :busy="loggingOut"
    :breadcrumb-group="t('layout.administrationGroup')"
    :breadcrumb-title="t('settings.title')"
    @logout="logout"
  >
    <RegistrationSettings />
    <TransferSettings />
    <ViewerFocusSettings />
    <MediaSettings />
    <DiagnosticBundlePanel v-if="canDiagnose" />
    <p v-else>{{ t('diagnostics.permission') }}</p>
  </AppShell>
</template>
