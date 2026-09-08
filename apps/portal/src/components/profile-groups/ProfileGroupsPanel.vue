<script setup lang="ts">
import { useAppDialog as useDialog } from '@/composables/useAppDialog.js'
import { NAlert, NButton, NCard, NInput, NSelect, useMessage } from 'naive-ui'
import { computed, onBeforeUnmount, onMounted, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/api/client.js'
import { apiFailure, networkFailure } from '@/api/errors.js'
import type { ProfileGroup, ProfileGroupInput } from '@/api/types.js'
import GroupDataTable from './GroupDataTable.vue'
import GroupEditorModal from './GroupEditorModal.vue'
import ProfileAccessModal from './ProfileAccessModal.vue'
const props = defineProps<{ canManage: boolean }>()
const { t } = useI18n(),
  dialog = useDialog(),
  message = useMessage()
const items = shallowRef<ProfileGroup[]>([]),
  cursor = shallowRef<string | null>(null),
  loading = shallowRef(false),
  loadingMore = shallowRef(false),
  error = shallowRef('')
const search = shallowRef(''),
  status = shallowRef<'ALL' | 'ENABLED' | 'DISABLED'>('ALL')
const editing = shallowRef<ProfileGroup | null>(null),
  editorOpen = shallowRef(false),
  saving = shallowRef(false),
  saveError = shallowRef(''),
  accessGroup = shallowRef<ProfileGroup | null>(null),
  busyId = shallowRef<string | null>(null)
const statuses = computed(() => [
  { label: t('profileGroups.all'), value: 'ALL' },
  { label: t('profileGroups.enabled'), value: 'ENABLED' },
  { label: t('profileGroups.disabled'), value: 'DISABLED' },
])
let controller: AbortController | undefined,
  disposed = false
async function load(append = false) {
  if (append && !cursor.value) return
  controller?.abort()
  const current = new AbortController()
  controller = current
  loading.value = !append
  loadingMore.value = append
  error.value = ''
  try {
    const result = await api.GET('/profile-groups', {
      params: {
        query: {
          limit: 30,
          status: status.value,
          ...(search.value.trim() ? { search: search.value.trim() } : {}),
          ...(append && cursor.value ? { cursor: cursor.value } : {}),
        },
      },
      signal: current.signal,
    })
    if (!result.data) throw apiFailure(result.error, result.response)
    if (current.signal.aborted) return
    items.value = append ? [...items.value, ...result.data.items] : result.data.items
    cursor.value = result.data.meta.nextCursor
  } catch (cause) {
    if (!current.signal.aborted) {
      error.value = failure(cause)
      const status = networkFailure(cause).status
      if (status === 401 || status === 403) {
        items.value = []
        cursor.value = null
      }
    }
  } finally {
    if (controller === current) {
      loading.value = false
      loadingMore.value = false
    }
  }
}
function open(group: ProfileGroup | null) {
  editing.value = group
  saveError.value = ''
  editorOpen.value = true
}
async function save(input: ProfileGroupInput) {
  saving.value = true
  saveError.value = ''
  try {
    const result = editing.value
      ? await api.PATCH('/profile-groups/{id}', {
          params: { path: { id: editing.value.id } },
          body: input,
        })
      : await api.POST('/profile-groups', { body: input })
    if (!result.data) throw apiFailure(result.error, result.response)
    if (disposed) return
    editorOpen.value = false
    message.success(t('profileGroups.saved'))
    await load()
  } catch (cause) {
    if (!disposed) saveError.value = failure(cause)
  } finally {
    saving.value = false
  }
}
function changeState(group: ProfileGroup) {
  dialog.warning({
    title: t('profileGroups.stateTitle', { name: group.name }),
    content: t(
      group.status === 'ENABLED' ? 'profileGroups.disableHint' : 'profileGroups.enableHint',
    ),
    positiveText: t('profileGroups.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      busyId.value = group.id
      try {
        const result = await api.PUT('/profile-groups/{id}/state', {
          params: { path: { id: group.id } },
          body: { state: group.status === 'ENABLED' ? 'DISABLED' : 'ENABLED' },
        })
        if (!result.data) throw apiFailure(result.error, result.response)
        await load()
        return true
      } catch (cause) {
        message.error(failure(cause))
        return false
      } finally {
        busyId.value = null
      }
    },
  })
}
function remove(group: ProfileGroup) {
  dialog.warning({
    title: t('profileGroups.deleteTitle', { name: group.name }),
    content: t('profileGroups.deleteHint'),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    positiveButtonProps: { type: 'error' },
    onPositiveClick: async () => {
      busyId.value = group.id
      try {
        const result = await api.DELETE('/profile-groups/{id}', {
          params: { path: { id: group.id } },
        })
        if (result.error || !result.response.ok) throw apiFailure(result.error, result.response)
        await load()
        return true
      } catch (cause) {
        message.error(failure(cause))
        return false
      } finally {
        busyId.value = null
      }
    },
  })
}
function failure(cause: unknown): string {
  const error = networkFailure(cause)
  const title = t(
    error.code === 'SESSION_POLICY_CONFLICT' ? 'sessionPolicies.conflict' : 'profileGroups.failed',
  )
  return `${title} · ${error.code}${error.requestId ? ` · ${error.requestId}` : ''}`
}
onMounted(() => void load())
onBeforeUnmount(() => {
  disposed = true
  controller?.abort()
})
</script>
<template>
  <section class="group-heading">
    <div>
      <h1>{{ t('profileGroups.title') }}</h1>
      <p>{{ t('profileGroups.intro') }}</p>
    </div>
    <NButton v-if="props.canManage" type="primary" @click="open(null)">{{
      t('profileGroups.create')
    }}</NButton>
  </section>
  <NCard :bordered="false"
    ><form class="group-toolbar" @submit.prevent="load()">
      <NInput
        v-model:value="search"
        clearable
        :placeholder="t('profileGroups.search')"
        :input-props="{ 'aria-label': t('profileGroups.search') }"
      /><NSelect
        v-model:value="status"
        :options="statuses"
        :aria-label="t('profileGroups.status')"
        @update:value="load()"
      /><NButton attr-type="submit" :loading="loading">{{
        t('profileGroups.searchAction')
      }}</NButton
      ><NButton :disabled="loading" @click="load()">{{ t('common.refresh') }}</NButton>
    </form></NCard
  >
  <NAlert v-if="error" type="error" :title="error"
    ><NButton @click="load()">{{ t('common.retry') }}</NButton></NAlert
  >
  <NCard :bordered="false" class="group-list"
    ><GroupDataTable
      :items="items"
      :failed="Boolean(error)"
      :loading="loading"
      :can-manage="canManage"
      :busy-id="busyId"
      @edit="open"
      @members="accessGroup = $event"
      @state="changeState"
      @delete="remove"
    />
    <div class="group-footer">
      <span>{{ t('profileGroups.loaded', { count: items.length }) }}</span
      ><NButton v-if="cursor" :loading="loadingMore" :disabled="loading" @click="load(true)">{{
        t('profileGroups.loadMore')
      }}</NButton>
    </div></NCard
  >
  <GroupEditorModal
    v-if="editorOpen"
    :group="editing"
    :busy="saving"
    :error="saveError"
    @close="editorOpen = false"
    @submit="save"
  />
  <ProfileAccessModal
    v-if="accessGroup"
    :id="accessGroup.id"
    :key="accessGroup.id"
    :name="accessGroup.name"
    kind="GROUP"
    :readonly="!canManage"
    @close="accessGroup = null"
    @saved="load()"
  />
</template>
<style scoped>
.group-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 24px;
}
h1 {
  font-size: 28px;
  margin: 0 0 8px;
}
.group-heading p {
  margin: 0;
  color: var(--text-secondary);
}
.group-toolbar {
  display: grid;
  grid-template-columns: minmax(160px, 1fr) 150px auto auto;
  gap: 12px;
}
.group-list {
  margin-top: 20px;
}
.group-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 18px;
  color: var(--text-secondary);
}
@media (max-width: 640px) {
  .group-heading {
    align-items: flex-start;
    flex-direction: column;
  }
  .group-toolbar {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
