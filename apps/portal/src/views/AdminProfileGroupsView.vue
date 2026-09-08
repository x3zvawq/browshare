<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import AppShell from '@/components/layout/AppShell.vue'
import ProfileGroupsPanel from '@/components/profile-groups/ProfileGroupsPanel.vue'
import { useSessionStore } from '@/stores/session.js'
const session = useSessionStore(),
  router = useRouter(),
  message = useMessage(),
  { t } = useI18n()
const loggingOut = shallowRef(false)
const canManage = computed(() => session.user?.permissions.includes('profile.manage') ?? false)
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
    :breadcrumb-title="t('profileGroups.title')"
    @logout="logout"
    ><ProfileGroupsPanel :can-manage="canManage"
  /></AppShell>
</template>
