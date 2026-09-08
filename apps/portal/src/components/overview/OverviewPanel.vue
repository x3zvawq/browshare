<script setup lang="ts">
import { NAlert, NEmpty, NSkeleton, NTime } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import LiveUpdateStatus from '@/components/status/LiveUpdateStatus.vue'
import { useAdminOverview } from '@/composables/useAdminOverview.js'
import WorkerOverview from './WorkerOverview.vue'
import ProfileOverview from './ProfileOverview.vue'
import SessionOverview from './SessionOverview.vue'
import './overview.css'

const { t } = useI18n()
const { data, error, loading, initialLoading, lastReadAt, liveState, refresh } = useAdminOverview()
</script>
<template>
  <section class="overview-panel">
    <div class="overview-heading">
      <p class="overview-eyebrow">BROWSHARE</p>
      <h1>{{ t('overview.title') }}</h1>
      <p>{{ t('overview.intro') }}</p>
    </div>
    <LiveUpdateStatus
      :state="liveState"
      :last-read-at="lastReadAt"
      :busy="loading"
      @refresh="refresh"
    />
    <NAlert
      v-if="error"
      type="error"
      :title="t(error.status === 403 ? 'overview.forbidden' : 'overview.failed')"
      role="alert"
    >
      <p>{{ t(data ? 'overview.retained' : 'overview.noData') }}</p>
      <p class="overview-error-code">
        {{ error.code
        }}<template v-if="error.requestId">
          · {{ t('overview.requestId') }}: {{ error.requestId }}</template
        >
      </p>
      <RouterLink
        v-if="error.status === 403"
        :to="{ name: 'forbidden', query: { redirect: '/admin/overview' } }"
        >{{ t('overview.checkAccess') }}</RouterLink
      >
    </NAlert>
    <div
      v-if="initialLoading"
      class="overview-grid"
      role="status"
      :aria-label="t('overview.title')"
      aria-busy="true"
    >
      <NSkeleton v-for="n in 3" :key="n" height="240px" :sharp="false" />
    </div>
    <template v-if="data">
      <div class="overview-sample">
        <p>
          {{ t('overview.observed') }} · <NTime :time="new Date(data.observedAt)" type="datetime" />
        </p>
        <p>{{ t('overview.sampleHint') }}</p>
      </div>
      <div class="overview-grid">
        <section
          class="overview-section"
          data-section="workers"
          :aria-label="t('overview.workers')"
        >
          <div class="overview-section-heading">
            <h2>{{ t('overview.workers') }}</h2>
            <RouterLink v-if="data.workers" to="/admin/workers"
              >{{ t('overview.workerLink') }} →</RouterLink
            >
          </div>
          <template v-if="data.workers">
            <NEmpty
              v-if="data.workers.totalWorkers === 0"
              :description="t('overview.workerEmpty')"
              class="overview-empty"
            />
            <WorkerOverview :value="data.workers" />
          </template>
          <div v-else class="overview-restricted">
            <strong>{{ t('overview.restricted') }}</strong>
            <p>{{ t('overview.permissionWorkers') }}</p>
          </div>
        </section>
        <section
          class="overview-section"
          data-section="profiles"
          :aria-label="t('overview.profiles')"
        >
          <div class="overview-section-heading">
            <h2>{{ t('overview.profiles') }}</h2>
            <RouterLink v-if="data.profiles" to="/admin/profiles"
              >{{ t('overview.profileLink') }} →</RouterLink
            >
          </div>
          <template v-if="data.profiles">
            <NEmpty
              v-if="data.profiles.totalProfiles === 0"
              :description="t('overview.profileEmpty')"
              class="overview-empty"
            />
            <ProfileOverview :value="data.profiles" />
          </template>
          <div v-else class="overview-restricted">
            <strong>{{ t('overview.restricted') }}</strong>
            <p>{{ t('overview.permissionProfiles') }}</p>
          </div>
        </section>
        <section
          class="overview-section overview-sessions"
          data-section="sessions"
          :aria-label="t('overview.sessions')"
        >
          <div class="overview-section-heading">
            <h2>{{ t('overview.sessions') }}</h2>
            <RouterLink v-if="data.sessions" to="/admin/sessions"
              >{{ t('overview.sessionLink') }} →</RouterLink
            >
          </div>
          <template v-if="data.sessions">
            <NEmpty
              v-if="data.sessions.activeSessions === 0"
              :description="t('overview.sessionEmpty')"
              class="overview-empty"
            />
            <SessionOverview :value="data.sessions" />
          </template>
          <div v-else class="overview-restricted">
            <strong>{{ t('overview.restricted') }}</strong>
            <p>{{ t('overview.permissionProfiles') }}</p>
          </div>
        </section>
      </div>
    </template>
  </section>
</template>
