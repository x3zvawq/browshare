<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { shallowRef } from 'vue'
import AppShell from '@/components/layout/AppShell.vue'
import MaintenancePanel from '@/components/maintenance/MaintenancePanel.vue'
import WorkspacePanel from '@/components/workspace/WorkspacePanel.vue'
import MySessionsPanel from '@/components/workspace/MySessionsPanel.vue'
import { useSessionStore } from '@/stores/session.js'
defineProps<{ sessions?: boolean; maintenance?: boolean }>()
const session = useSessionStore(),
  router = useRouter(),
  { t } = useI18n(),
  busy = shallowRef(false)
async function logout() {
  busy.value = true
  try {
    await session.logout()
  } finally {
    busy.value = false
    await router.replace({ name: 'login' })
  }
}
</script>
<template>
  <AppShell
    v-if="session.user"
    :user="session.user"
    :busy="busy"
    :breadcrumb-group="t('workspace.useGroup')"
    :breadcrumb-title="
      t(maintenance ? 'maintenance.title' : sessions ? 'workspace.mySessions' : 'workspace.title')
    "
    @logout="logout"
    ><MaintenancePanel v-if="maintenance" /><MySessionsPanel v-else-if="sessions" /><WorkspacePanel
      v-else
  /></AppShell>
</template>
