<script setup lang="ts">
import { useAppDialog as useDialog } from '@/composables/useAppDialog.js'
import { storageMessages } from '@/components/storage/messages.js'
import { AddOutline, KeyOutline } from '@vicons/ionicons5'
import { NButton, NIcon, useMessage } from 'naive-ui'
import { computed, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { api } from '@/api/client.js'
import { ApiFailure, apiFailure, networkFailure } from '@/api/errors.js'
import type { CreateProfileInput, Profile, UpdateProfileInput } from '@/api/types.js'
import AppShell from '@/components/layout/AppShell.vue'
import LiveUpdateStatus from '@/components/status/LiveUpdateStatus.vue'
import ProfileDataTable from '@/components/profiles/ProfileDataTable.vue'
import ProfileRuntimeStopModal from '@/components/profiles/ProfileRuntimeStopModal.vue'
import ProfileDeletionModal from '@/components/profiles/ProfileDeletionModal.vue'
import ProfileAccessModal from '@/components/profile-groups/ProfileAccessModal.vue'
import ProfileEditorModal from '@/components/profiles/ProfileEditorModal.vue'
import ProfileListToolbar from '@/components/profiles/ProfileListToolbar.vue'
import ProfileSummaryStrip from '@/components/profiles/ProfileSummaryStrip.vue'
import { useProfileRuntimeActions } from '@/composables/useProfileRuntimeActions.js'
import { useAdminProfiles } from '@/composables/useAdminProfiles.js'
import { useSessionStore } from '@/stores/session.js'

const session = useSessionStore()
const router = useRouter()
const dialog = useDialog()
const message = useMessage()
const { t, te } = useI18n({ messages: storageMessages })
const loggingOut = shallowRef(false)
const grantProfile = shallowRef<Profile | null>(null)
const editorOpen = shallowRef(false)
const editingProfile = shallowRef<Profile | null>(null)
const deletionProfile = shallowRef<Profile | null>(null)
const mutationBusy = shallowRef(false)
const mutationError = shallowRef<ApiFailure | null>(null)
const busyProfileId = shallowRef<string>()

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

const {
  runtimePending,
  stopProfile,
  closeSessions,
  stopError,
  setRuntime,
  recoverRuntime,
  closeStop,
  confirmStop,
} = useProfileRuntimeActions(refresh)

const canMaintain = computed(() => session.user?.permissions.includes('profile.maintain') ?? false)
const canManage = computed(() => session.user?.permissions.includes('profile.manage') ?? false)

function openCreate(): void {
  if (facets.value.workers.length === 0) {
    message.warning(t('profiles.editor.noWorkers'))
    return
  }
  editingProfile.value = null
  mutationError.value = null
  editorOpen.value = true
}

function openEdit(profile: Profile): void {
  editingProfile.value = profile
  mutationError.value = null
  editorOpen.value = true
}

function closeEditor(): void {
  if (mutationBusy.value) return
  editorOpen.value = false
  editingProfile.value = null
  mutationError.value = null
}

async function saveProfile(input: CreateProfileInput | UpdateProfileInput): Promise<void> {
  mutationBusy.value = true
  mutationError.value = null
  try {
    const profile = editingProfile.value
    if (profile === null) {
      const {
        data,
        error: responseError,
        response,
      } = await api.POST('/profiles', {
        body: input as CreateProfileInput,
      })
      if (data === undefined) throw apiFailure(responseError, response)
      message.success(t('profiles.editor.created', { name: data.name }))
    } else {
      const {
        data,
        error: responseError,
        response,
      } = await api.PATCH('/profiles/{profileId}', {
        params: { path: { profileId: profile.id } },
        body: input as UpdateProfileInput,
      })
      if (data === undefined) throw apiFailure(responseError, response)
      message.success(t('profiles.editor.updated', { name: data.name }))
    }
    editorOpen.value = false
    editingProfile.value = null
    await refresh()
  } catch (cause) {
    mutationError.value = cause instanceof ApiFailure ? cause : networkFailure(cause)
  } finally {
    mutationBusy.value = false
  }
}

function confirmToggleState(profile: Profile): void {
  const enabling = profile.businessStatus === 'DISABLED'
  dialog.warning({
    title: enabling ? t('profiles.state.enableTitle') : t('profiles.state.disableTitle'),
    content: enabling
      ? t('profiles.state.enableDescription', { name: profile.name })
      : t('profiles.state.disableDescription', { name: profile.name }),
    positiveText: enabling ? t('common.enable') : t('common.disable'),
    negativeText: t('common.cancel'),
    positiveButtonProps: { type: enabling ? 'primary' : 'warning' },
    onPositiveClick: () => setProfileState(profile),
  })
}

async function setProfileState(profile: Profile): Promise<boolean> {
  busyProfileId.value = profile.id
  try {
    const state = profile.businessStatus === 'ENABLED' ? 'DISABLED' : 'ENABLED'
    const {
      data,
      error: responseError,
      response,
    } = await api.PUT('/profiles/{profileId}/state', {
      params: { path: { profileId: profile.id } },
      body: { state },
    })
    if (data === undefined) throw apiFailure(responseError, response)
    message.success(
      state === 'ENABLED'
        ? t('profiles.state.enabled', { name: data.name })
        : t('profiles.state.disabled', { name: data.name }),
    )
    await refresh()
    return true
  } catch (cause) {
    message.error(localizedMutationError(cause))
    return false
  } finally {
    busyProfileId.value = undefined
  }
}

function openDeletion(profile: Profile): void {
  deletionProfile.value = profile
  mutationError.value = null
}

function closeDeletion(): void {
  if (mutationBusy.value) return
  deletionProfile.value = null
  mutationError.value = null
}

async function requestDeletion(expectedName: string): Promise<void> {
  const profile = deletionProfile.value
  if (profile === null) return
  mutationBusy.value = true
  mutationError.value = null
  try {
    const {
      data,
      error: responseError,
      response,
    } = await api.POST('/profiles/{profileId}/deletion', {
      params: { path: { profileId: profile.id } },
      body: { expectedName },
    })
    if (data === undefined) throw apiFailure(responseError, response)
    deletionProfile.value = null
    message.success(t('profiles.deletion.requested', { name: data.name }))
    await refresh()
  } catch (cause) {
    mutationError.value = cause instanceof ApiFailure ? cause : networkFailure(cause)
  } finally {
    mutationBusy.value = false
  }
}

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

function localizedMutationError(cause: unknown, includeRequestId = true): string {
  const failure = networkFailure(cause)
  return `${localizedMutationErrorTitle(cause)} · ${failure.code}${includeRequestId && failure.requestId ? ` · ${failure.requestId}` : ''}`
}

function localizedMutationErrorTitle(cause: unknown): string {
  const failure = cause instanceof ApiFailure ? cause : networkFailure(cause)
  if (te(`storage.blocks.${failure.code}`))
    return `${t(`storage.blocks.${failure.code}`)} ${t('storage.recovery')}`
  if (failure.code === 'NETWORK_ERROR') return t('profiles.errors.network')
  if (failure.code === 'FORBIDDEN') return t('profiles.errors.forbidden')
  if (failure.code === 'NOT_FOUND') return t('profiles.editor.errors.notFound')
  if (failure.code === 'CONFLICT') return t('profiles.editor.errors.conflict')
  if (failure.code === 'BAD_REQUEST' || failure.code === 'VALIDATION_FAILED') {
    return t('profiles.editor.errors.invalid')
  }
  return t('profiles.editor.errors.generic')
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
        @refresh="refresh"
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
        :can-maintain="canMaintain"
        :busy-profile-id="busyProfileId"
        :runtime-pending="runtimePending"
        @set-runtime="setRuntime"
        @recover-runtime="recoverRuntime"
        @refresh="refresh"
        @load-more="loadMore"
        @edit="openEdit"
        @grants="grantProfile = $event"
        @toggle-state="confirmToggleState"
        @delete="openDeletion"
      />
    </section>

    <ProfileRuntimeStopModal
      :profile="stopProfile"
      :close-sessions="closeSessions"
      :busy="stopProfile !== null && runtimePending.has(stopProfile.id)"
      :error="stopError"
      @close="closeStop"
      @submit="confirmStop"
    />
    <ProfileAccessModal
      v-if="grantProfile"
      :id="grantProfile.id"
      :key="grantProfile.id"
      :name="grantProfile.name"
      kind="PROFILE"
      :readonly="!canManage"
      @close="grantProfile = null"
      @saved="refresh"
    />
    <ProfileEditorModal
      :show="editorOpen"
      :profile="editingProfile"
      :workers="facets.workers"
      :proxies="facets.proxies"
      :busy="mutationBusy"
      :error="mutationError ? localizedMutationError(mutationError, false) : null"
      :request-id="mutationError?.requestId"
      @close="closeEditor"
      @submit="saveProfile"
    />
    <ProfileDeletionModal
      :profile="deletionProfile"
      :busy="mutationBusy"
      :error="mutationError ? localizedMutationError(mutationError, false) : null"
      :request-id="mutationError?.requestId"
      @close="closeDeletion"
      @submit="requestDeletion"
    />
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
