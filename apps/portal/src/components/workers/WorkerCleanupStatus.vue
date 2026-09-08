<script setup lang="ts">
import { computed } from 'vue'
import { NAlert, NTag, NTime } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { ManagedWorker } from '@/api/types.js'
import { useSessionStore } from '@/stores/session.js'
import { workerCleanupMessages } from './cleanup-messages.js'

defineProps<{ worker: ManagedWorker }>()
const session = useSessionStore()
const { t } = useI18n({ messages: workerCleanupMessages })
const canReadProfiles = computed(() => session.user?.permissions.includes('profile.read') === true)
</script>
<template>
  <section class="cleanup-card">
    <h2>{{ t('workerCleanup.title') }}</h2>
    <NAlert v-if="worker.controlConnected && !worker.controlReady" type="warning">
      {{ t('workerCleanup.connectedNotReady') }}
    </NAlert>
    <NAlert v-else-if="!worker.controlConnected" type="warning">
      {{ t('workerCleanup.disconnected') }}
    </NAlert>
    <template v-if="worker.cleanupFailures.length">
      <p>{{ t('workerCleanup.pending') }}</p>
      <p role="status">{{ t('workerCleanup.count', { count: worker.cleanupFailures.length }) }}</p>
      <ul class="cleanup-list">
        <li
          v-for="(failure, index) in worker.cleanupFailures"
          :key="`${failure.scope}:${failure.runtimeId ?? index}:${failure.generation}:${failure.sessionId}`"
        >
          <div class="cleanup-heading">
            <h3>{{ t(`workerCleanup.${failure.scope}`) }}</h3>
            <NTag size="small" :type="failure.registered ? 'info' : 'warning'">
              {{
                t(failure.registered ? 'workerCleanup.registered' : 'workerCleanup.unregistered')
              }}
            </NTag>
          </div>
          <dl>
            <template v-if="canReadProfiles">
              <div v-if="failure.profileId">
                <dt>{{ t('workerCleanup.profile') }}</dt>
                <dd>
                  <code>{{ failure.profileId }}</code>
                </dd>
              </div>
              <div v-if="failure.sessionId">
                <dt>{{ t('workerCleanup.session') }}</dt>
                <dd>
                  <code>{{ failure.sessionId }}</code>
                </dd>
              </div>
            </template>
            <div v-if="canReadProfiles && failure.runtimeId">
              <dt>{{ t('workerCleanup.runtime') }}</dt>
              <dd>
                <code>{{ failure.runtimeId }}</code>
              </dd>
            </div>
            <div>
              <dt>{{ t('workerCleanup.generation') }}</dt>
              <dd>{{ failure.generation }}</dd>
            </div>
            <div>
              <dt>{{ t('workerCleanup.code') }}</dt>
              <dd>
                <code>{{ failure.error.code }}</code>
              </dd>
            </div>
            <div>
              <dt>{{ t('workerCleanup.occurredAt') }}</dt>
              <dd><NTime :time="new Date(failure.error.occurredAt)" type="datetime" /></dd>
            </div>
          </dl>
        </li>
      </ul>
      <p>{{ t('workerCleanup.recovery') }}</p>
      <div v-if="canReadProfiles" class="cleanup-links" role="group">
        <RouterLink to="/admin/profiles">{{ t('workerCleanup.profiles') }}</RouterLink>
        <RouterLink to="/admin/sessions">{{ t('workerCleanup.sessions') }}</RouterLink>
      </div>
      <p v-else>{{ t('workerCleanup.restricted') }}</p>
    </template>
    <template v-else>
      <p>{{ t('workerCleanup.empty') }}</p>
      <p v-if="!worker.controlReady">{{ t('workerCleanup.waiting') }}</p>
    </template>
  </section>
</template>
<style scoped>
.cleanup-card {
  display: grid;
  gap: 16px;
  min-width: 0;
  padding: 20px;
  border: 1px solid var(--bs-border);
  border-radius: 10px;
  background: var(--bs-surface);
  color: var(--bs-text);
}
h2,
h3,
p {
  margin: 0;
  overflow-wrap: anywhere;
}
h2 {
  font-size: 18px;
}
h3 {
  font-size: 14px;
}
p {
  color: var(--bs-text-muted);
  line-height: 1.7;
}
.cleanup-list {
  display: grid;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.cleanup-list li {
  min-width: 0;
  border: 1px solid var(--bs-border);
  border-radius: 8px;
  padding: 16px;
}
.cleanup-heading {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
}
dl {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
  gap: 12px 20px;
  margin: 12px 0 0;
}
dl > div {
  min-width: 0;
}
dt {
  color: var(--bs-text-muted);
}
dd {
  margin: 4px 0 0;
  overflow-wrap: anywhere;
}
.cleanup-links {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 20px;
}
.cleanup-links a {
  color: var(--bs-primary);
  overflow-wrap: anywhere;
}
@media (max-width: 650px) {
  .cleanup-card {
    padding: 16px;
  }
}
</style>
