<script setup lang="ts">
import { NAlert, NTag, NTime } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { Profile } from '@/api/types.js'
import RuntimeRouteStatus from '@/components/proxies/RuntimeRouteStatus.vue'
import ProfileStorageStatus from '@/components/storage/ProfileStorageStatus.vue'
import { profileDetailMessages } from './detail-messages.js'
import { profileRuntimeMessages } from './runtime-messages.js'
const props = defineProps<{ profile: Profile }>()
const { t } = useI18n({
  messages: {
    'zh-CN': { ...profileDetailMessages['zh-CN'], ...profileRuntimeMessages['zh-CN'] },
    'en-US': { ...profileDetailMessages['en-US'], ...profileRuntimeMessages['en-US'] },
  },
})
</script>
<template>
  <section class="profile-detail-header">
    <header>
      <div class="identity">
        <h1>{{ profile.name }}</h1>
        <p>{{ profile.description || t('profiles.noDescription') }}</p>
        <code>{{ profile.id }}</code>
      </div>
      <div class="actions"><slot /></div>
    </header>
    <div class="facts">
      <NTag :type="profile.businessStatus === 'ENABLED' ? 'success' : 'default'">{{
        t(`profiles.businessStatus.${profile.businessStatus}`)
      }}</NTag>
      <NTag
        :type="
          profile.runtimeState === 'ERROR'
            ? 'error'
            : profile.runtimeState === 'RUNNING'
              ? 'success'
              : 'info'
        "
        >{{ t(`profiles.runtimeState.${profile.runtimeState}`) }}</NTag
      >
      <span>{{ t('profiles.columns.worker') }} · {{ profile.worker.name }}</span>
      <span>{{ t(`profiles.runtimeMode.${profile.runtimeMode}`) }}</span>
      <span
        >{{ t('profiles.columns.capacity') }} · {{ profile.capacity.activeSessions }} /
        {{ profile.capacity.maxNormalSessions ?? '∞' }}</span
      >
    </div>
    <NAlert v-if="profile.deleteRequestedAt" type="warning">{{
      t('profiles.deletion.pending')
    }}</NAlert>
    <NAlert v-if="profile.runtimeErrorCode" type="error" :title="t('profileDetail.runtimeError')">
      <code>{{ profile.runtimeErrorCode }}</code>
      <p v-if="profile.runtimeErrorCode === 'PROFILE_DATA_MISSING'">
        {{ t('runtimeRecovery.dataMissing') }}
      </p>
    </NAlert>
    <details>
      <summary>{{ t('profileDetail.details') }}</summary>
      <dl class="detail-grid">
        <div>
          <dt>{{ t('profileDetail.health') }}</dt>
          <dd>{{ profile.healthcheckUrl || '—' }}</dd>
        </div>
        <div>
          <dt>{{ t('profiles.columns.groups') }}</dt>
          <dd>
            {{ profile.groups.map((group) => group.name).join(', ') || t('profiles.noGroups') }}
          </dd>
        </div>
        <div>
          <dt>{{ t('profiles.columns.access') }}</dt>
          <dd>{{ t(`profiles.visibility.${profile.visibility}`) }}</dd>
        </div>
        <div>
          <dt>{{ t('profiles.columns.updated') }}</dt>
          <dd><NTime :time="new Date(props.profile.updatedAt)" type="datetime" /></dd>
        </div>
      </dl>
      <RuntimeRouteStatus :route="profile" :runtime-state="profile.runtimeState" />
      <ProfileStorageStatus :profile="profile" />
    </details>
  </section>
</template>
<style scoped>
.profile-detail-header {
  display: grid;
  gap: 16px;
  padding: 20px;
  border: 1px solid var(--bs-border);
  border-radius: 10px;
  background: var(--bs-surface);
}
header,
.facts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
header {
  justify-content: space-between;
}
.identity {
  min-width: 0;
}
h1 {
  margin: 0;
  font-size: 25px;
  overflow-wrap: anywhere;
}
p {
  margin: 6px 0;
  color: var(--bs-text-muted);
  overflow-wrap: anywhere;
}
code {
  font-size: 11px;
  overflow-wrap: anywhere;
}
.facts {
  font-size: 13px;
}
summary {
  cursor: pointer;
  padding: 4px 0;
}
details[open] summary {
  margin-bottom: 16px;
}
.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin: 0 0 16px;
}
dt {
  color: var(--bs-text-muted);
  font-size: 12px;
}
dd {
  margin: 4px 0 0;
  overflow-wrap: anywhere;
}
@media (max-width: 680px) {
  .detail-grid {
    grid-template-columns: 1fr;
  }
  .profile-detail-header {
    padding: 16px;
  }
}
</style>
