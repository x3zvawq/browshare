<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import AppShell from '@/components/layout/AppShell.vue'
import PageScriptPanel from '@/components/page-script/PageScriptPanel.vue'
import { useSessionStore } from '@/stores/session.js'
const session = useSessionStore(),
  router = useRouter(),
  message = useMessage(),
  { t } = useI18n()
const loggingOut = shallowRef(false)
const route = useRoute()
const id = computed(() =>
  typeof route.params.profileId === 'string' ? route.params.profileId : undefined,
)
const canMaintain = computed(() => session.user?.permissions.includes('profile.maintain') ?? false)
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
    :breadcrumb-title="t('pageScript.title')"
    @logout="logout"
    ><PageScriptPanel
      v-if="id"
      :key="id"
      :profile-id="id"
      :can-manage="canManage"
      :can-maintain="canMaintain"
  /></AppShell>
</template>
