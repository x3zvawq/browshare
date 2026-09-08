<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { api } from '@/api/client.js'
import { apiFailure } from '@/api/errors.js'
import AppShell from '@/components/layout/AppShell.vue'
import UsersPanel from '@/components/users/UsersPanel.vue'
import { useSessionStore } from '@/stores/session.js'
const session = useSessionStore(),
  router = useRouter(),
  message = useMessage(),
  { t } = useI18n()
const loggingOut = shallowRef(false)
const canManage = computed(() => session.user?.permissions.includes('user.manage') ?? false)
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
async function selfChanged(revoked: boolean) {
  if (revoked) {
    session.expire()
    await router.replace({ name: 'login', query: { reason: 'session-expired' } })
    return
  }
  try {
    const r = await api.GET('/auth/session')
    if (!r.data) throw apiFailure(r.error, r.response)
    session.accept(r.data)
    if (!r.data.user.permissions.includes('user.read'))
      await router.replace({ name: 'account-security' })
  } catch {
    session.expire()
    await router.replace({ name: 'login' })
  }
}
</script>
<template>
  <AppShell
    v-if="session.user"
    :user="session.user"
    :busy="loggingOut"
    :breadcrumb-group="t('layout.administrationGroup')"
    :breadcrumb-title="t('users.title')"
    @logout="logout"
    ><UsersPanel
      :can-manage="canManage"
      :current-user-id="session.user.id"
      @self-changed="selfChanged"
  /></AppShell>
</template>
