<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import AppShell from '@/components/layout/AppShell.vue'
import WorkersPanel from '@/components/workers/WorkersPanel.vue'
import WorkerDetail from '@/components/workers/WorkerDetail.vue'
import { useSessionStore } from '@/stores/session.js'
const session = useSessionStore(),
  router = useRouter(),
  message = useMessage(),
  { t } = useI18n()
const loggingOut = shallowRef(false)
const route = useRoute()
const id = computed(() =>
  typeof route.params.workerId === 'string' ? route.params.workerId : undefined,
)
const canManage = computed(() => session.user?.permissions.includes('worker.manage') ?? false)
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
    :breadcrumb-title="t('workerManagement.title')"
    @logout="logout"
    ><WorkerDetail v-if="id" :id="id" :key="id" :can-manage="canManage" /><WorkersPanel
      v-else
      :can-manage="canManage"
  /></AppShell>
</template>
