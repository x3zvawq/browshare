<script setup lang="ts">
import { useAppDialog as useDialog } from '@/composables/useAppDialog.js'
import { computed, onScopeDispose, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NEmpty, NInput, NSelect, NSkeleton, useMessage } from 'naive-ui'
import { api } from '@/api/client.js'
import { apiFailure, networkFailure, type ApiFailure } from '@/api/errors.js'
import type { ManagedRole, ManagedUser, ManagedUserInput, ManagedUserQuery } from '@/api/types.js'
import { usePagedCollection } from '@/composables/usePagedCollection.js'
import UserTable from './UserTable.vue'
import UserEditor from './UserEditor.vue'
import RoleEditor from './RoleEditor.vue'
import PasswordReset from './PasswordReset.vue'
import UserRequestError from './UserRequestError.vue'
const props = defineProps<{ canManage: boolean; currentUserId: string }>()
const emit = defineEmits<{ selfChanged: [revoked: boolean] }>()
const { t } = useI18n(),
  dialog = useDialog(),
  message = useMessage()
const draft = shallowRef(''),
  search = shallowRef(''),
  state = shallowRef<ManagedUserQuery['state']>()
const query = computed(() => ({
  ...(search.value ? { search: search.value } : {}),
  ...(state.value ? { state: state.value } : {}),
}))
const { items, error, loading, nextCursor, refresh, more } = usePagedCollection(
  query,
  async (cursor, signal) => {
    const r = await api.GET('/users', {
      params: { query: { ...query.value, limit: 30, ...(cursor ? { cursor } : {}) } },
      signal,
    })
    if (!r.data) throw apiFailure(r.error, r.response)
    return r.data
  },
)
const roles = shallowRef<ManagedRole[] | null>(null),
  rolesError = shallowRef<ApiFailure | null>(null),
  rolesLoading = shallowRef(false)
let roleRequest: AbortController | undefined
async function loadRoles() {
  roleRequest?.abort()
  const current = new AbortController()
  roleRequest = current
  rolesLoading.value = true
  try {
    const r = await api.GET('/roles', { signal: current.signal })
    if (!r.data) throw apiFailure(r.error, r.response)
    if (!current.signal.aborted) {
      roles.value = r.data.items
      rolesError.value = null
    }
  } catch (cause) {
    if (!current.signal.aborted) rolesError.value = networkFailure(cause)
  } finally {
    if (current === roleRequest) rolesLoading.value = false
  }
}
void loadRoles()
onScopeDispose(() => roleRequest?.abort())
const editor = shallowRef<{ user: ManagedUser | null } | null>(null),
  roleUser = shallowRef<ManagedUser | null>(null),
  resetUser = shallowRef<ManagedUser | null>(null),
  busy = shallowRef(false),
  mutationError = shallowRef<ApiFailure | null>(null)
const states = computed(() => [
  { value: 'CURRENT', label: t('users.current') },
  ...(['ENABLED', 'DISABLED', 'DELETED'] as const).map((value) => ({
    value,
    label: t(`users.${value}`),
  })),
  { value: 'ALL', label: t('users.all') },
])
function close() {
  if (busy.value) return
  editor.value = null
  roleUser.value = null
  resetUser.value = null
  mutationError.value = null
}
function edit(user: ManagedUser | null) {
  mutationError.value = null
  editor.value = { user }
}
function openRoles(user: ManagedUser) {
  mutationError.value = null
  roleUser.value = user
}
function openReset(user: ManagedUser) {
  mutationError.value = null
  resetUser.value = user
}
async function perform(
  operation: () => Promise<void>,
  userId?: string,
  revoked = false,
): Promise<boolean> {
  if (busy.value || !props.canManage) return false
  busy.value = true
  mutationError.value = null
  try {
    await operation()
    if (userId === props.currentUserId) emit('selfChanged', revoked)
    message.success(t('users.saved'))
    await refresh()
    return true
  } catch (cause) {
    const failure = networkFailure(cause)
    mutationError.value = failure
    message.error(
      `${t('users.errors.UNKNOWN')} · ${failure.code}${failure.requestId ? ` · ${failure.requestId}` : ''}`,
    )
    return false
  } finally {
    busy.value = false
  }
}
async function save(input: Omit<ManagedUserInput, 'password'> & { password?: string }) {
  const user = editor.value?.user
  if (
    await perform(async () => {
      const r = user
        ? await api.PATCH('/users/{userId}', {
            params: { path: { userId: user.id } },
            body: {
              email: input.email,
              displayName: input.displayName,
              maxActiveSessions: input.maxActiveSessions ?? null,
            },
          })
        : await api.POST('/users', { body: { ...input, password: input.password! } })
      if (!r.data) throw apiFailure(r.error, r.response)
    }, user?.id)
  )
    editor.value = null
}
async function saveRoles(roleIds: string[]) {
  const user = roleUser.value
  if (!user) return
  if (
    await perform(async () => {
      const r = await api.PUT('/users/{userId}/roles', {
        params: { path: { userId: user.id } },
        body: { roleIds },
      })
      if (!r.data) throw apiFailure(r.error, r.response)
    }, user.id)
  )
    roleUser.value = null
}
async function reset(newPassword: string) {
  const user = resetUser.value
  if (!user) return
  if (
    await perform(
      async () => {
        const r = await api.POST('/users/{userId}/reset-password', {
          params: { path: { userId: user.id } },
          body: { newPassword },
        })
        if (!r.response.ok) throw apiFailure(r.error, r.response)
      },
      user.id,
      true,
    )
  )
    resetUser.value = null
}
function confirm(user: ManagedUser, deleting = false) {
  const action = deleting ? 'delete' : user.state === 'ENABLED' ? 'disable' : 'enable'
  const modal = dialog.warning({
    title: t(`users.${action}Title`),
    content: t(`users.${action}Hint`, { name: `${user.displayName} (${user.email})` }),
    positiveText: t(`common.${action}`),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      modal.loading = true
      try {
        return await perform(
          async () => {
            const r = deleting
              ? await api.DELETE('/users/{userId}', { params: { path: { userId: user.id } } })
              : await api.PUT('/users/{userId}/state', {
                  params: { path: { userId: user.id } },
                  body: { state: user.state === 'ENABLED' ? 'DISABLED' : 'ENABLED' },
                })
            if (!r.response.ok) throw apiFailure(r.error, r.response)
          },
          user.id,
          deleting || user.state === 'ENABLED',
        )
      } finally {
        modal.loading = false
      }
    },
  })
}
</script>
<template>
  <section class="users-page">
    <header>
      <div>
        <p class="eyebrow">ACCOUNT CONTROL</p>
        <h1>{{ t('users.title') }}</h1>
        <p>{{ t('users.intro') }}</p>
        <p v-if="!canManage">{{ t('users.readonly') }}</p>
      </div>
      <NButton v-if="canManage" type="primary" :disabled="busy" @click="edit(null)">{{
        t('users.create')
      }}</NButton>
    </header>
    <form class="filters" @submit.prevent="search = draft.trim()">
      <NInput
        v-model:value="draft"
        clearable
        :maxlength="320"
        :placeholder="t('users.search')"
        :input-props="{ 'aria-label': t('users.search') }"
      /><NButton attr-type="submit">{{ t('users.searchAction') }}</NButton
      ><NSelect
        :value="state ?? 'CURRENT'"
        :options="states"
        :input-props="{ 'aria-label': t('users.filter') }"
        @update:value="state = $event === 'CURRENT' ? undefined : $event"
      /><NButton :loading="loading" @click="refresh">{{ t('common.refresh') }}</NButton>
    </form>
    <UserRequestError
      v-if="error || (!editor && !roleUser && !resetUser && mutationError)"
      :error="(error || mutationError)!"
    />
    <UserRequestError v-if="rolesError" :error="rolesError"
      ><NButton :loading="rolesLoading" @click="loadRoles">{{
        t('common.retry')
      }}</NButton></UserRequestError
    >
    <NSkeleton v-if="loading && !items.length" height="240px" /><NEmpty
      v-else-if="!items.length && !error"
      :description="t('users.empty')"
    /><UserTable
      v-else-if="items.length"
      :items="items"
      :current-user-id="currentUserId"
      :can-manage="canManage"
      :busy="busy"
      :roles-available="roles !== null"
      @edit="edit"
      @roles="openRoles"
      @reset="openReset"
      @state="confirm"
      @delete="confirm($event, true)"
    />
    <NButton v-if="nextCursor" :loading="loading" @click="more">{{ t('workspace.more') }}</NButton>
    <UserEditor
      v-if="editor"
      :user="editor.user"
      :busy="busy"
      :error="mutationError"
      @close="close"
      @submit="save"
    /><RoleEditor
      v-if="roleUser && roles"
      :user="roleUser"
      :roles="roles"
      :readonly="!canManage || roleUser.state === 'DELETED'"
      :busy="busy"
      :error="mutationError"
      @close="close"
      @submit="saveRoles"
    /><PasswordReset
      v-if="resetUser"
      :user="resetUser"
      :busy="busy"
      :error="mutationError"
      @close="close"
      @submit="reset"
    />
  </section>
</template>
<style scoped>
.users-page {
  display: grid;
  gap: 18px;
  min-width: 0;
  max-width: 1440px;
  margin: 0 auto;
}
.users-page > * {
  min-width: 0;
}
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 18px;
}
h1 {
  margin: 0;
  font-size: 26px;
}
header p {
  color: var(--bs-text-muted);
  line-height: 1.65;
}
.eyebrow {
  color: var(--bs-primary);
  letter-spacing: 0.14em;
  font-size: 11px;
  font-weight: 750;
}
.filters {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) auto 200px auto;
  gap: 10px;
}
@media (max-width: 700px) {
  header {
    flex-direction: column;
    align-items: stretch;
  }
  .filters {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
