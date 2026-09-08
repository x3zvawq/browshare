<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useAppDialog as useDialog } from '@/composables/useAppDialog.js'
import { useProfileRuntimeActions } from '@/composables/useProfileRuntimeActions.js'
import { useSessionStore } from '@/stores/session.js'
import { api } from '@/api/client.js'
import { ApiFailure, apiFailure, networkFailure } from '@/api/errors.js'
import type {
  CreateProfileInput,
  Profile,
  ProfileListFacets,
  UpdateProfileInput,
} from '@/api/types.js'
import { storageMessages } from '@/components/storage/messages.js'
import ProfileRuntimeStopModal from './ProfileRuntimeStopModal.vue'
import ProfileDeletionModal from './ProfileDeletionModal.vue'
import ProfileEditorModal from './ProfileEditorModal.vue'
import ProfileAccessModal from '@/components/profile-groups/ProfileAccessModal.vue'
const props = defineProps<{ facets?: ProfileListFacets; refresh: () => Promise<void> }>()
const session = useSessionStore()
const dialog = useDialog(),
  message = useMessage()
const { t, te } = useI18n({ messages: storageMessages })
const loadedFacets = shallowRef<ProfileListFacets>({ workers: [], groups: [], proxies: [] })
const availableFacets = computed(() => props.facets ?? loadedFacets.value)
const canManage = computed(() => session.user?.permissions.includes('profile.manage') ?? false)
const grantProfile = shallowRef<Profile | null>(null)
const editorOpen = shallowRef(false)
const editingProfile = shallowRef<Profile | null>(null)
const deletionProfile = shallowRef<Profile | null>(null)
const mutationBusy = shallowRef(false)
const mutationError = shallowRef<ApiFailure | null>(null)
const busyProfileId = shallowRef<string>()

const {
  runtimePending,
  stopProfile,
  closeSessions,
  stopError,
  setRuntime,
  recoverRuntime,
  closeStop,
  confirmStop,
} = useProfileRuntimeActions(() => props.refresh())

function openCreate(): void {
  if (availableFacets.value.workers.length === 0) {
    message.warning(t('profiles.editor.noWorkers'))
    return
  }
  editingProfile.value = null
  mutationError.value = null
  editorOpen.value = true
}

async function openEdit(profile: Profile): Promise<void> {
  if (!props.facets) {
    try {
      const result = await api.GET('/profiles', { params: { query: { limit: 1 } } })
      if (!result.data) throw apiFailure(result.error, result.response)
      loadedFacets.value = result.data.facets
    } catch (cause) {
      message.error(localizedMutationError(cause))
      return
    }
  }
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
    await props.refresh()
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
    await props.refresh()
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
    await props.refresh()
  } catch (cause) {
    mutationError.value = cause instanceof ApiFailure ? cause : networkFailure(cause)
  } finally {
    mutationBusy.value = false
  }
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
  <slot
    :open-create="openCreate"
    :open-edit="openEdit"
    :open-grants="(profile: Profile) => (grantProfile = profile)"
    :set-runtime="setRuntime"
    :recover-runtime="recoverRuntime"
    :toggle-state="confirmToggleState"
    :open-deletion="openDeletion"
    :busy-profile-id="busyProfileId"
    :runtime-pending="runtimePending"
  />
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
    @saved="props.refresh"
  />
  <ProfileEditorModal
    :show="editorOpen"
    :profile="editingProfile"
    :workers="availableFacets.workers"
    :proxies="availableFacets.proxies"
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
</template>
