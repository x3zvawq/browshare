<script setup lang="ts">
import StorageBlockNotice from '@/components/storage/StorageBlockNotice.vue'
import { computed } from 'vue'
import { NButton, NTag } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { storageMessages } from '@/components/storage/messages.js'
import RuntimeRouteStatus from '@/components/proxies/RuntimeRouteStatus.vue'
import type { MaintenanceProfile } from '@/api/types.js'
const props = defineProps<{ profile: MaintenanceProfile; compact?: boolean }>()
defineEmits<{ start: [] }>()
const { t, te } = useI18n({ messages: storageMessages })
const phase = computed(() => {
  const status = props.profile.maintenance?.status
  if (!status) return null
  if (['RESERVED', 'CREATING'].includes(status)) return 'preparing'
  if (['CLOSING', 'CLOSED', 'FAILED'].includes(status)) return 'cleaning'
  return 'active'
})
</script>
<template>
  <article class="maintenance-card" :class="{ compact }">
    <div class="details">
      <div class="heading">
        <h2>{{ profile.name }}</h2>
        <NTag v-if="phase" type="warning" size="small">{{ t(`maintenance.${phase}`) }}</NTag>
        <NTag v-if="profile.businessStatus !== 'ENABLED'" size="small" type="error">{{
          t('maintenance.disabled')
        }}</NTag>
        <NTag size="small" :bordered="false">{{
          t(`profiles.runtimeState.${profile.runtimeState}`)
        }}</NTag>
      </div>
      <p v-if="profile.description">{{ profile.description }}</p>
      <p>{{ t('maintenance.occupancy', { count: profile.activeNormalSessions }) }}</p>
      <p v-if="profile.maintenance">
        {{ t('maintenance.owner', { name: profile.maintenance.ownerName }) }}
      </p>
      <p v-else-if="profile.blockedReason" role="status">
        {{
          t(
            te(`storage.blocks.${profile.blockedReason}`)
              ? `storage.blocks.${profile.blockedReason}`
              : `maintenance.blocked.${profile.blockedReason}`,
          )
        }}
      </p>
      <StorageBlockNotice
        :reason="profile.storageBlockedReason"
        :pending="profile.storagePolicyPending"
        compact
      />
      <RuntimeRouteStatus :route="profile" :runtime-state="profile.runtimeState" />
      <p v-if="phase === 'cleaning'">{{ t('maintenance.cleaningHint') }}</p>
    </div>
    <div class="actions">
      <RouterLink
        v-if="profile.maintenance?.sessionId"
        v-slot="{ href, navigate }"
        :to="{ name: 'session-viewer', params: { id: profile.maintenance.sessionId } }"
        custom
      >
        <NButton tag="a" :href="href" type="primary" secondary @click="navigate">{{
          t(phase === 'active' ? 'maintenance.continue' : 'workspace.viewProgress')
        }}</NButton>
      </RouterLink>
      <NButton
        v-else-if="!compact"
        type="primary"
        secondary
        :disabled="!!profile.blockedReason || !!profile.storageBlockedReason"
        @click="$emit('start')"
        >{{ t('maintenance.start') }}</NButton
      >
    </div>
  </article>
</template>
<style scoped>
.maintenance-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 22px;
  background: var(--bs-surface);
  border: 1px solid var(--bs-border);
  border-radius: 10px;
}
.compact {
  padding: 0;
  border: 0;
  background: transparent;
}
.details {
  min-width: 0;
}
.heading {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
h2 {
  font-size: 18px;
  margin: 0;
  overflow-wrap: anywhere;
}
p {
  color: var(--bs-text-muted);
  margin: 8px 0 0;
  overflow-wrap: anywhere;
}
.actions {
  flex: none;
}
@media (max-width: 640px) {
  .maintenance-card {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
