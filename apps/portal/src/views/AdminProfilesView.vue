<script setup lang="ts">
import { storageMessages } from '@/components/storage/messages.js'
import { AddOutline, KeyOutline } from '@vicons/ionicons5'
import { NButton, NIcon, useMessage } from 'naive-ui'
import { computed, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import type { ApiFailure } from '@/api/errors.js'
import AppShell from '@/components/layout/AppShell.vue'
import LiveUpdateStatus from '@/components/status/LiveUpdateStatus.vue'
import ProfileManagementController from '@/components/profiles/ProfileManagementController.vue'
import ProfileDataTable from '@/components/profiles/ProfileDataTable.vue'
import ProfileListToolbar from '@/components/profiles/ProfileListToolbar.vue'
import ProfileSummaryStrip from '@/components/profiles/ProfileSummaryStrip.vue'
import { useAdminProfiles } from '@/composables/useAdminProfiles.js'
import { useSessionStore } from '@/stores/session.js'

const session = useSessionStore()
const router = useRouter()
const message = useMessage()
const { t } = useI18n({ messages: storageMessages })
const loggingOut = shallowRef(false)

const {
  filters,
  items,
  summary,
  facets,
  nextCursor,
  loading,
  loadingMore,
  liveState,
  lastReadAt,
  refreshing,
  refreshLive,
  error,
  refresh,
  loadMore,
  setSearch,
  setBusinessStatus,
  setRuntimeState,
  setWorkerId,
  setGroupId,
  clearFilters,
} = useAdminProfiles()

const canManage = computed(() => session.user?.permissions.includes('profile.manage') ?? false)

async function logout(): Promise<void> {
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

function localizedListError(failure: ApiFailure | null): string | null {
  if (failure === null) return null
  if (failure.code === 'NETWORK_ERROR') return t('profiles.errors.network')
  if (failure.code === 'FORBIDDEN') return t('profiles.errors.forbidden')
  if (failure.code === 'BAD_REQUEST' || failure.code === 'VALIDATION_FAILED') {
    return t('profiles.errors.invalidFilter')
  }
  return t('profiles.errors.generic')
}
</script>

<template>
  <AppShell
    v-if="session.user"
    :user="session.user"
    :busy="loggingOut"
    :breadcrumb-group="$t('layout.administrationGroup')"
    :breadcrumb-title="$t('layout.profiles')"
    @logout="logout"
  >
    <ProfileManagementController
      v-slot="{
        openCreate,
        openEdit,
        openGrants,
        setRuntime,
        recoverRuntime,
        toggleState,
        openDeletion,
        busyProfileId,
        runtimePending,
      }"
      :facets="facets"
      :refresh="refresh"
    >
      <section class="page-heading">
        <div>
          <p class="page-eyebrow">PROFILE CONTROL</p>
          <h1>{{ $t('profiles.title') }}</h1>
          <p>{{ $t('profiles.description') }}</p>
        </div>
        <NButton
          v-if="canManage"
          type="primary"
          size="large"
          :disabled="facets.workers.length === 0"
          @click="openCreate"
        >
          <template #icon><NIcon aria-hidden="true" :component="AddOutline" /></template>
          {{ $t('profiles.createAction') }}
        </NButton>
        <div v-else class="read-only-badge">
          <NIcon aria-hidden="true" :component="KeyOutline" :size="18" />
          <span>{{ $t('profiles.readOnly') }}</span>
        </div>
      </section>

      <ProfileSummaryStrip :summary="summary" :loading="loading" />

      <section class="profile-list-section">
        <ProfileListToolbar
          :search="filters.search"
          :business-status="filters.businessStatus"
          :runtime-state="filters.runtimeState"
          :worker-id="filters.workerId"
          :group-id="filters.groupId"
          :facets="facets"
          :loading="loading"
          @search="setSearch"
          @business-status="setBusinessStatus"
          @runtime-state="setRuntimeState"
          @worker-id="setWorkerId"
          @group-id="setGroupId"
          @clear="clearFilters"
        />

        <LiveUpdateStatus
          :state="liveState"
          :last-read-at="lastReadAt"
          :busy="refreshing"
          @refresh="refreshLive"
        />
        <ProfileDataTable
          :items="items"
          :loading="loading"
          :loading-more="loadingMore"
          :has-more="nextCursor !== null"
          :error="localizedListError(error)"
          :request-id="error?.requestId"
          :error-code="error?.code"
          :can-manage="canManage"
          :busy-profile-id="busyProfileId"
          :runtime-pending="runtimePending"
          @set-runtime="setRuntime"
          @recover-runtime="recoverRuntime"
          @refresh="refresh"
          @load-more="loadMore"
          @edit="openEdit"
          @grants="openGrants"
          @toggle-state="toggleState"
          @delete="openDeletion"
        />
      </section>
    </ProfileManagementController>
  </AppShell>
</template>

<style scoped>
.page-heading,
.profile-list-section {
  width: 100%;
  max-width: 1440px;
  margin-right: auto;
  margin-left: auto;
}

.page-heading {
  display: flex;
  margin-bottom: 24px;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
}

.page-eyebrow {
  margin: 0 0 8px;
  color: var(--bs-primary) !important;
  font-size: 11px !important;
  font-weight: 750;
  letter-spacing: 0.14em;
}

.page-heading h1 {
  margin: 0;
  color: var(--bs-text);
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.025em;
}

.page-heading > div > p:last-child {
  max-width: 760px;
  margin: 8px 0 0;
  color: var(--bs-text-muted);
  font-size: 14px;
  line-height: 1.65;
}

.profile-list-section {
  display: grid;
  min-width: 0;
  gap: 16px;
}

.read-only-badge {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--bs-border);
  border-radius: 8px;
  background: var(--bs-surface);
  padding: 9px 12px;
  color: var(--bs-text-muted);
  font-size: 12px;
}

@media (max-width: 680px) {
  .page-heading {
    align-items: stretch;
    flex-direction: column;
    gap: 16px;
  }
}
</style>
