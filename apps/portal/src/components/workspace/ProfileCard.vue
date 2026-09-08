<script setup lang="ts">
import StorageBlockNotice from '@/components/storage/StorageBlockNotice.vue'
import { computed } from 'vue'
import { NButton, NTag } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import RuntimeRouteStatus from '@/components/proxies/RuntimeRouteStatus.vue'
import type { AccessibleProfile } from '@/api/types.js'
const props = defineProps<{ profile: AccessibleProfile }>()
defineEmits<{ create: [profile: AccessibleProfile]; group: [id: string, name: string] }>()
const { t } = useI18n()
const available = computed(
  () =>
    !props.profile.storageBlockedReason &&
    props.profile.capacity.availableSessions !== 0 &&
    ((props.profile.runtimeState === 'RUNNING' &&
      props.profile.runtimeProxyHealth?.status === 'HEALTHY') ||
      (['STOPPED', 'STARTING'].includes(props.profile.runtimeState) &&
        props.profile.runtimeMode === 'ON_DEMAND')),
)
</script>
<template>
  <article class="profile-card">
    <div class="card-heading">
      <span class="profile-symbol" aria-hidden="true">{{ profile.name.slice(0, 1) }}</span>
      <div class="identity">
        <h2>{{ profile.name }}</h2>
        <NTag
          size="small"
          :bordered="false"
          :type="profile.runtimeState === 'RUNNING' ? 'success' : 'default'"
          >{{ t(`profiles.runtimeState.${profile.runtimeState}`) }}</NTag
        >
      </div>
    </div>
    <p class="description">{{ profile.description || t('workspace.noDescription') }}</p>
    <div class="groups">
      <button
        v-for="group in profile.groups"
        :key="group.id"
        class="group"
        @click="$emit('group', group.id, group.name)"
      >
        {{ group.name }}</button
      ><span v-if="!profile.groups.length" class="muted">{{ t('workspace.ungrouped') }}</span>
    </div>
    <div class="capacity">
      <strong>{{ profile.capacity.availableSessions ?? '∞' }}</strong
      ><span>{{ t('workspace.available') }}</span
      ><small>{{ t('workspace.active', { count: profile.capacity.activeSessions }) }}</small>
    </div>
    <StorageBlockNotice
      :reason="profile.storageBlockedReason"
      :pending="profile.storagePolicyPending"
      compact
    />
    <RuntimeRouteStatus
      :route="profile"
      :runtime-state="profile.runtimeState"
      :active-sessions="profile.capacity.activeSessions"
    />
    <p class="mode">
      {{ profile.runtimeMode === 'ON_DEMAND' ? t('workspace.onDemand') : t('workspace.managed') }}
    </p>
    <div class="actions">
      <NButton type="primary" :disabled="!available" @click="$emit('create', profile)">{{
        t('workspace.create')
      }}</NButton
      ><RouterLink
        :to="{ name: 'my-sessions', query: { profileId: profile.id, profileName: profile.name } }"
        >{{ t('workspace.mySessions') }}</RouterLink
      >
    </div>
  </article>
</template>
<style scoped>
.profile-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  padding: 24px;
  border: 1px solid var(--bs-border);
  border-radius: 14px;
  background: var(--bs-surface);
}
.card-heading {
  display: flex;
  align-items: center;
  gap: 12px;
}
.identity {
  min-width: 0;
}
.identity h2 {
  margin: 0 0 8px;
  font-size: 18px;
  overflow-wrap: anywhere;
}
.profile-symbol {
  display: grid;
  place-items: center;
  flex: none;
  width: 44px;
  height: 44px;
  background: color-mix(in srgb, var(--bs-primary) 10%, transparent);
  border-radius: 12px;
  color: var(--bs-primary);
  font-weight: 700;
  font-size: 22px;
}
.description {
  color: var(--bs-text-muted);
  min-height: 42px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.groups {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 22px;
}
.group {
  border: 1px solid var(--bs-border);
  border-radius: 6px;
  padding: 3px 8px;
  background: transparent;
  color: var(--bs-text-muted);
  cursor: pointer;
  overflow-wrap: anywhere;
}
.group:hover {
  color: var(--bs-primary);
}
.muted,
.mode {
  color: var(--bs-text-muted);
  font-size: 12px;
}
.capacity {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: auto;
}
.capacity strong {
  font-size: 30px;
}
.capacity small {
  margin-left: auto;
  color: var(--bs-text-muted);
}
.actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  border-top: 1px solid var(--bs-border);
  padding-top: 18px;
}
.actions a {
  color: var(--bs-primary);
  text-decoration: none;
  font-size: 13px;
}
</style>
