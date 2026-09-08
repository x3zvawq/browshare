<script setup lang="ts">
import { computed } from 'vue'
import { NButton, NTag } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { TabSession } from '@/api/types.js'
import { canOpenSession, isSessionTerminal, sessionName } from '@/utils/tab-session.js'
const props = defineProps<{ session: TabSession }>()
defineEmits<{
  rename: [session: TabSession]
  close: [session: TabSession]
  downloads: [session: TabSession]
}>()
const { t, te, locale } = useI18n()
const created = computed(() => new Date(props.session.createdAt).toLocaleString(locale.value))
const reason = computed(() => {
  const code = props.session.failureCode ?? props.session.closeReason
  if (!code) return ''
  const key = `workspace.${props.session.failureCode ? 'errors' : 'reasons'}.${code}`
  return te(key) ? t(key) : code
})
</script>
<template>
  <article class="session-card">
    <div class="details">
      <div class="heading">
        <NTag v-if="session.kind === 'MAINTENANCE'" type="warning" size="small">{{
          t('maintenance.title')
        }}</NTag>
        <h2 :title="sessionName(session)">{{ sessionName(session) }}</h2>
        <NTag
          :bordered="false"
          size="small"
          :type="
            session.status === 'CONNECTED'
              ? 'success'
              : session.status === 'FAILED'
                ? 'error'
                : 'default'
          "
          >{{ t(`workspace.sessionState.${session.status}`) }}</NTag
        >
      </div>
      <p>{{ session.profileName }} · {{ created }}</p>
      <p
        v-if="session.hasCustomDisplayName && session.remoteTitle"
        class="remote-title"
        :title="session.remoteTitle"
      >
        {{ session.remoteTitle }}
      </p>
      <small v-if="reason">{{ reason }}</small>
    </div>
    <div class="actions">
      <NButton quaternary @click="$emit('downloads', session)">{{ t('downloads.entry') }}</NButton>
      <RouterLink
        v-if="canOpenSession(session)"
        v-slot="{ href, navigate }"
        custom
        :to="{ name: 'session-viewer', params: { id: session.id } }"
        ><NButton tag="a" :href="href" type="primary" secondary @click="navigate">{{
          t(
            ['RESERVED', 'CREATING'].includes(session.status)
              ? 'workspace.viewProgress'
              : 'workspace.continue',
          )
        }}</NButton></RouterLink
      ><NButton quaternary @click="$emit('rename', session)">{{ t('workspace.rename') }}</NButton
      ><NButton
        v-if="!isSessionTerminal(session)"
        quaternary
        type="error"
        :disabled="session.status === 'CLOSING'"
        @click="$emit('close', session)"
        >{{ t(session.kind === 'MAINTENANCE' ? 'maintenance.end' : 'workspace.end') }}</NButton
      >
    </div>
  </article>
</template>
<style scoped>
.session-card {
  display: flex;
  align-items: center;
  gap: 24px;
  justify-content: space-between;
  background: var(--bs-surface);
  border: 1px solid var(--bs-border);
  border-radius: 12px;
  padding: 22px;
}
.details {
  min-width: 0;
}
.heading {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
.heading h2 {
  margin: 0;
  font-size: 17px;
  overflow-wrap: anywhere;
}
.details p {
  margin: 8px 0 0;
  color: var(--bs-text-muted);
  font-size: 13px;
}
.details small {
  display: block;
  margin-top: 8px;
  color: var(--bs-text-muted);
  overflow-wrap: anywhere;
}
.remote-title {
  overflow-wrap: anywhere;
}
.heading h2,
.remote-title {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}
.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
.actions a {
  text-decoration: none;
}
@media (max-width: 720px) {
  .session-card {
    align-items: stretch;
    flex-direction: column;
    gap: 16px;
  }
  .actions {
    flex-wrap: wrap;
  }
}
</style>
