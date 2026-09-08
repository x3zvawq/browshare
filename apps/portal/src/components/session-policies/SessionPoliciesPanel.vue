<script setup lang="ts">
import { useAppDialog as useDialog } from '@/composables/useAppDialog.js'
import RequestError from '@/components/workspace/RequestError.vue'
import { computed, h, onBeforeUnmount, onMounted, shallowRef } from 'vue'
import {
  NButton,
  NCard,
  NDataTable,
  NEmpty,
  NSelect,
  NSpace,
  NTag,
  NTime,
  useMessage,
  type DataTableColumns,
} from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { api } from '@/api/client.js'
import { apiFailure, networkFailure, type ApiFailure } from '@/api/errors.js'
import type { SessionPolicy, SessionPolicyValues } from '@/api/types.js'
import { vAccessibleTableScroll } from '@/directives/accessible-table-scroll.js'
import PolicyEditorModal from './PolicyEditorModal.vue'
import PolicyPreview from './PolicyPreview.vue'
const props = defineProps<{ canManage: boolean; canGlobal: boolean }>()
const { t } = useI18n(),
  dialog = useDialog(),
  message = useMessage()
const items = shallowRef<SessionPolicy[]>([]),
  defaults = shallowRef<SessionPolicyValues | null>(null)
const scope = shallowRef<SessionPolicy['scope'] | 'ALL'>('ALL'),
  nextCursor = shallowRef<string | null>(null)
const loading = shallowRef(false),
  moreLoading = shallowRef(false),
  error = shallowRef<ApiFailure | null>(null),
  editing = shallowRef<SessionPolicy | null>(null),
  editorOpen = shallowRef(false),
  busyId = shallowRef<string | null>(null)
let controller: AbortController | undefined,
  disposed = false
const scopes = computed(() => [
  { value: 'ALL', label: t('sessionPolicies.allScopes') },
  ...['GLOBAL', 'USER_PROFILE', 'USER_PROFILE_GROUP'].map((value) => ({
    value,
    label: t(`sessionPolicies.scope.${value}`),
  })),
])
const columns = computed<DataTableColumns<SessionPolicy>>(() => [
  {
    title: t('sessionPolicies.scopeLabel'),
    key: 'scope',
    width: 170,
    render: (row) => t(`sessionPolicies.scope.${row.scope}`),
  },
  {
    title: t('sessionPolicies.user'),
    key: 'userName',
    minWidth: 150,
    render: (row) => row.userName ?? '—',
  },
  {
    title: t('sessionPolicies.target'),
    key: 'target',
    minWidth: 180,
    render: (row) => row.profileName ?? row.profileGroupName ?? t('sessionPolicies.allProfiles'),
  },
  {
    title: t('sessionPolicies.summary'),
    key: 'values',
    minWidth: 250,
    render: (row) =>
      row.values.recycleDisabled
        ? h(NTag, { type: 'warning' }, () => t('sessionPolicies.recycleDisabled'))
        : [
            'viewerDisconnectTimeoutSeconds',
            'noInputTimeoutSeconds',
            'noFrameChangeTimeoutSeconds',
            'maxDurationSeconds',
            'proxyFailureTimeoutSeconds',
          ]
            .filter((key) => row.values[key as keyof SessionPolicyValues] !== null)
            .map(
              (key) =>
                `${t(`sessionPolicies.${key}`)}: ${row.values[key as keyof SessionPolicyValues]}`,
            )
            .join(' · ') || t('sessionPolicies.off'),
  },
  {
    title: t('profileGroups.updated'),
    key: 'updatedAt',
    width: 110,
    render: (row) => h(NTime, { time: new Date(row.updatedAt), type: 'relative' }),
  },
  {
    title: t('profileGroups.actions'),
    key: 'actions',
    width: 150,
    render: (row) =>
      (row.scope === 'GLOBAL' ? props.canGlobal : props.canManage)
        ? h(NSpace, { size: 4, wrap: false }, () => [
            h(
              NButton,
              { size: 'small', disabled: busyId.value === row.id, onClick: () => open(row) },
              () => t('common.edit'),
            ),
            h(
              NButton,
              {
                size: 'small',
                type: 'error',
                quaternary: true,
                loading: busyId.value === row.id,
                onClick: () => remove(row),
              },
              () => t('common.delete'),
            ),
          ])
        : '—',
  },
])
async function load(append = false) {
  if (append && !nextCursor.value) return
  controller?.abort()
  const current = new AbortController()
  controller = current
  loading.value = !append
  moreLoading.value = append
  error.value = null
  try {
    const [list, base] = await Promise.all([
      api.GET('/session-policies', {
        params: {
          query: {
            limit: 30,
            ...(scope.value === 'ALL' ? {} : { scope: scope.value }),
            ...(append && nextCursor.value ? { cursor: nextCursor.value } : {}),
          },
        },
        signal: current.signal,
      }),
      defaults.value
        ? Promise.resolve(null)
        : api.GET('/session-policies/defaults', { signal: current.signal }),
    ])
    if (!list.data) throw apiFailure(list.error, list.response)
    if (base && !base.data) throw apiFailure(base.error, base.response)
    if (current.signal.aborted) return
    if (base?.data) defaults.value = base.data
    items.value = append ? [...items.value, ...list.data.items] : list.data.items
    nextCursor.value = list.data.meta.nextCursor
  } catch (cause) {
    if (!current.signal.aborted) {
      error.value = networkFailure(cause)
      if (error.value.status === 401 || error.value.status === 403) {
        items.value = []
        defaults.value = null
        nextCursor.value = null
      }
    }
  } finally {
    if (controller === current) {
      loading.value = false
      moreLoading.value = false
    }
  }
}
function open(policy: SessionPolicy | null) {
  editing.value = policy
  editorOpen.value = true
}
function saved() {
  message.success(t('sessionPolicies.saved'))
  void load()
}
function remove(policy: SessionPolicy) {
  dialog.warning({
    title: t('sessionPolicies.deleteTitle'),
    content: t(
      policy.scope === 'GLOBAL' ? 'sessionPolicies.deleteGlobalHint' : 'sessionPolicies.deleteHint',
    ),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      busyId.value = policy.id
      try {
        const result = await api.DELETE('/session-policies/{id}', {
          params: { path: { id: policy.id } },
        })
        if (result.error) throw apiFailure(result.error, result.response)
        if (!disposed) await load()
        return true
      } catch (cause) {
        if (disposed) return false
        error.value = networkFailure(cause)
        message.error(
          `${t('sessionPolicies.failed')} · ${error.value.code}${error.value.requestId ? ` · ${error.value.requestId}` : ''}`,
        )
        return false
      } finally {
        busyId.value = null
      }
    },
  })
}
onMounted(() => void load())
onBeforeUnmount(() => {
  disposed = true
  controller?.abort()
})
</script>
<template>
  <section class="policy-page">
    <header>
      <div>
        <h1>{{ t('sessionPolicies.title') }}</h1>
        <p>{{ t('sessionPolicies.intro') }}</p>
      </div>
      <NButton
        v-if="canManage || canGlobal"
        type="primary"
        :disabled="!defaults"
        @click="open(null)"
        >{{ t('sessionPolicies.create') }}</NButton
      >
    </header>
    <NCard :bordered="false"
      ><div class="policy-toolbar">
        <NSelect
          v-model:value="scope"
          :options="scopes"
          :aria-label="t('sessionPolicies.scopeLabel')"
          @update:value="load()"
        /><NButton @click="load()">{{ t('common.refresh') }}</NButton>
      </div>
      <RequestError v-if="error" :error="error"
        ><NButton @click="load()">{{ t('common.retry') }}</NButton></RequestError
      ></NCard
    >
    <NCard :bordered="false"
      ><NDataTable
        v-if="!error || items.length > 0"
        v-accessible-table-scroll="t('sessionPolicies.tableLabel')"
        :columns="columns"
        :data="items"
        :loading="loading"
        :row-key="(row) => row.id"
        :scroll-x="1010"
        :bordered="false"
        ><template #empty
          ><NEmpty
            v-if="!error && !loading"
            :description="t('sessionPolicies.empty')" /></template></NDataTable
      ><NButton v-if="nextCursor" class="load-more" :loading="moreLoading" @click="load(true)">{{
        t('profileGroups.loadMore')
      }}</NButton></NCard
    >
    <PolicyPreview />
    <PolicyEditorModal
      v-if="editorOpen && defaults"
      :policy="editing"
      :defaults="defaults"
      :can-manage="canManage"
      :can-global="canGlobal"
      @close="editorOpen = false"
      @saved="saved"
    />
  </section>
</template>
<style scoped>
.policy-page > * {
  min-width: 0;
}
.policy-page {
  display: grid;
  gap: 24px;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}
h1 {
  margin: 0;
  font-size: 28px;
}
header p {
  color: var(--text-secondary);
}
.policy-toolbar {
  display: grid;
  grid-template-columns: minmax(180px, 320px) auto;
  gap: 12px;
  justify-content: start;
}
.load-more {
  margin-top: 16px;
}
@media (max-width: 640px) {
  header {
    flex-direction: column;
    align-items: flex-start;
  }
  .policy-toolbar {
    grid-template-columns: 1fr auto;
  }
}
</style>
