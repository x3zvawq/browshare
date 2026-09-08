<script setup lang="ts">
import { useAppDialog as useDialog } from '@/composables/useAppDialog.js'
import { computed, onScopeDispose, ref, shallowRef } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, RouterLink } from 'vue-router'
import { NAlert, NButton, NFormItem, NInput, NSkeleton, NTag, NTime, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { api } from '@/api/client.js'
import { apiFailure, networkFailure, type ApiFailure } from '@/api/errors.js'
import type {
  NavigationPolicyContent,
  NavigationPolicyState,
  NavigationPolicyVersion,
} from '@/api/types.js'
import { usePagedCollection } from '@/composables/usePagedCollection.js'
import RuleEditor from './RuleEditor.vue'
import PolicyPreview from './PolicyPreview.vue'
const props = defineProps<{ profileId: string; embedded?: boolean; canManage: boolean }>()
const { t } = useI18n(),
  dialog = useDialog(),
  message = useMessage()
const state = shallowRef<NavigationPolicyState | null>(null),
  selected = shallowRef<NavigationPolicyVersion | null>(null),
  error = shallowRef<ApiFailure | null>(null),
  busy = shallowRef(false),
  initialized = shallowRef(false),
  editing = shallowRef(false)
const content = ref<NavigationPolicyContent>({
    rules: [],
    defaultAction: 'DENY',
    policyScript: null,
  }),
  summary = shallowRef(''),
  baseline = shallowRef('')
const serialized = computed(() =>
  JSON.stringify({ content: content.value, changeSummary: summary.value.trim() || null }),
)
const dirty = computed(
  () => initialized.value && editing.value && serialized.value !== baseline.value,
)
const scriptError = computed(() => {
  const d = error.value?.details
  return d !== null && typeof d === 'object' && 'field' in d && d.field === 'policyScript'
})
const errorRule = computed(() => {
  const details = error.value?.details
  if (!details || typeof details !== 'object' || !('ruleId' in details)) return null
  const index = content.value.rules.findIndex((r) => r.id === details.ruleId)
  return index < 0 ? null : index + 1
})
const controller = new AbortController()
const history = usePagedCollection(
  () => props.profileId,
  async (cursor, signal) => {
    const r = await api.GET('/profiles/{profileId}/navigation-policy/versions', {
      params: {
        path: { profileId: props.profileId },
        query: { limit: 20, ...(cursor ? { cursor } : {}) },
      },
      signal,
    })
    if (!r.data) throw apiFailure(r.error, r.response)
    return r.data
  },
)
async function perform(work: () => Promise<void>) {
  if (busy.value) return false
  busy.value = true
  error.value = null
  try {
    await work()
    return true
  } catch (cause) {
    if (!controller.signal.aborted) {
      const failure = networkFailure(cause)
      error.value = failure
      message.error(
        `${t('navigationPolicy.failed')} · ${failure.code}${failure.requestId ? ` · ${failure.requestId}` : ''}`,
      )
    }
    return false
  } finally {
    busy.value = false
  }
}
async function readState() {
  const r = await api.GET('/profiles/{profileId}/navigation-policy', {
    params: { path: { profileId: props.profileId } },
    signal: controller.signal,
  })
  if (!r.data) throw apiFailure(r.error, r.response)
  state.value = r.data
  return r.data
}
async function readVersion(id: string) {
  const r = await api.GET('/profiles/{profileId}/navigation-policy/versions/{id}', {
    params: { path: { profileId: props.profileId, id } },
    signal: controller.signal,
  })
  if (!r.data) throw apiFailure(r.error, r.response)
  return r.data
}
function accept(
  value: NavigationPolicyVersion | null,
  edit = value === null || value.state === 'DRAFT',
) {
  selected.value = value
  content.value = value
    ? (JSON.parse(JSON.stringify(value.content)) as NavigationPolicyContent)
    : { rules: [], defaultAction: 'DENY', policyScript: null }
  summary.value = value?.changeSummary ?? ''
  editing.value = edit && props.canManage
  initialized.value = true
  baseline.value = serialized.value
}
function allowDiscard(): Promise<boolean> {
  if (!dirty.value) return Promise.resolve(true)
  return new Promise((resolve) =>
    dialog.warning({
      title: t('navigationPolicy.replaceTitle'),
      content: t('navigationPolicy.replaceHint'),
      positiveText: t('navigationPolicy.confirm'),
      negativeText: t('navigationPolicy.cancel'),
      onPositiveClick: () => resolve(true),
      onNegativeClick: () => resolve(false),
      onClose: () => resolve(false),
      onMaskClick: () => resolve(false),
    }),
  )
}
async function selectVersion(id: string) {
  if (busy.value || !(await allowDiscard())) return
  await perform(async () => accept(await readVersion(id)))
}
async function refresh() {
  await perform(async () => {
    const current = await readState()
    await history.refresh()
    if (!initialized.value) {
      const initialId = current.publishedVersionId ?? history.items.value[0]?.id
      accept(current.draft ?? (initialId ? await readVersion(initialId) : null))
    }
  })
}
async function newDraft() {
  if (busy.value || !(await allowDiscard())) return
  await perform(async () => {
    const current = await readState()
    accept(current.draft)
  })
}
function copy() {
  editing.value = true
  selected.value = null
  baseline.value = ''
}
async function save() {
  await perform(async () => {
    const r = await api.PUT('/profiles/{profileId}/navigation-policy/draft', {
      params: { path: { profileId: props.profileId } },
      body: { content: content.value, changeSummary: summary.value.trim() || null },
      signal: controller.signal,
    })
    if (!r.data) throw apiFailure(r.error, r.response)
    accept(r.data)
    message.success(t('navigationPolicy.saved'))
    await readState()
    await history.refresh()
  })
}
function changePublication(action: 'publish' | 'disable') {
  const id = selected.value?.id
  if (!id || busy.value || dirty.value) return
  dialog.warning({
    title: t(`navigationPolicy.${action}Title`),
    content: t(`navigationPolicy.${action}Hint`),
    positiveText: t('navigationPolicy.confirm'),
    negativeText: t('navigationPolicy.cancel'),
    onPositiveClick: () =>
      perform(async () => {
        const r = await api.POST(
          action === 'publish'
            ? '/profiles/{profileId}/navigation-policy/versions/{id}/publish'
            : '/profiles/{profileId}/navigation-policy/versions/{id}/disable',
          { params: { path: { profileId: props.profileId, id } }, signal: controller.signal },
        )
        if (!r.data) throw apiFailure(r.error, r.response)
        accept(r.data)
        message.success(
          t(
            action === 'publish'
              ? 'navigationPolicy.publishedDone'
              : 'navigationPolicy.disabledDone',
          ),
        )
        await readState()
        await history.refresh()
      }),
  })
}
const beforeUnload = (event: BeforeUnloadEvent) => {
  if (dirty.value) {
    event.preventDefault()
    event.returnValue = ''
  }
}
window.addEventListener('beforeunload', beforeUnload)
onBeforeRouteLeave(() => (busy.value ? false : allowDiscard()))
onBeforeRouteUpdate(() => (busy.value ? false : allowDiscard()))
onScopeDispose(() => {
  controller.abort()
  window.removeEventListener('beforeunload', beforeUnload)
})
void refresh()
</script>
<template>
  <section class="navigation-page">
    <header>
      <div>
        <RouterLink v-if="!embedded" to="/admin/profiles">{{
          t('navigationPolicy.back')
        }}</RouterLink>
        <component :is="embedded ? 'h2' : 'h1'">
          {{ t('navigationPolicy.title')
          }}<template v-if="state && !embedded"> · {{ state.profile.name }}</template>
        </component>
        <p>{{ t('navigationPolicy.intro') }}</p>
      </div>
      <NButton :loading="busy" @click="refresh">{{ t('navigationPolicy.refresh') }}</NButton>
    </header>
    <NAlert v-if="error" type="error" role="alert" :title="t('navigationPolicy.failed')"
      ><div v-if="scriptError">{{ t('navigationPolicy.invalidScript') }}</div>
      <div v-if="errorRule">{{ t('navigationPolicy.errorRule', { index: errorRule }) }}</div>
      {{ error.code }}<template v-if="error.requestId"> · {{ error.requestId }}</template></NAlert
    >
    <NSkeleton v-if="!initialized && busy" height="360px" />
    <template v-if="state && initialized">
      <NAlert
        :type="state.publishedVersionId ? 'info' : 'warning'"
        :title="t('navigationPolicy.published')"
        ><NButton
          v-if="state.publishedVersionId"
          text
          :disabled="busy"
          @click="selectVersion(state.publishedVersionId)"
          >{{ t('navigationPolicy.view') }} · {{ state.publishedVersionId }}</NButton
        ><span v-else>{{ t('navigationPolicy.none') }}</span></NAlert
      >
      <p v-if="!canManage">{{ t('navigationPolicy.readonly') }}</p>
      <div class="policy-card editor">
        <header>
          <div>
            <h2>
              {{
                selected
                  ? t('navigationPolicy.version', { version: selected.version })
                  : t('navigationPolicy.newDraft')
              }}
            </h2>
            <NTag v-if="selected" size="small">{{ t(`navigationPolicy.${selected.state}`) }}</NTag>
          </div>
          <div v-if="canManage" class="buttons">
            <NButton :disabled="busy" @click="newDraft">{{ t('navigationPolicy.draft') }}</NButton
            ><NButton v-if="!editing" :disabled="busy" @click="copy">{{
              t('navigationPolicy.copy')
            }}</NButton>
          </div>
        </header>
        <RuleEditor v-model="content" :readonly="!editing" :busy="busy" />
        <NFormItem :label="t('navigationPolicy.summary')"
          ><NInput
            v-model:value="summary"
            :readonly="!editing || busy"
            :maxlength="512"
            :input-props="{ 'aria-label': t('navigationPolicy.summary') }"
        /></NFormItem>
        <footer>
          <span v-if="editing" role="status">{{
            t(dirty ? 'navigationPolicy.unsaved' : 'navigationPolicy.clean')
          }}</span>
          <div v-if="canManage" class="buttons">
            <NButton
              v-if="editing"
              type="primary"
              :loading="busy"
              :disabled="!!selected && !dirty"
              @click="save"
              >{{ t('navigationPolicy.save') }}</NButton
            ><NButton
              v-if="selected && state.publishedVersionId !== selected.id"
              :disabled="busy || dirty"
              @click="changePublication('publish')"
              >{{ t('navigationPolicy.publish') }}</NButton
            ><NButton
              v-if="selected?.state === 'PUBLISHED'"
              type="error"
              secondary
              :disabled="busy || dirty"
              @click="changePublication('disable')"
              >{{ t('navigationPolicy.disable') }}</NButton
            >
          </div>
        </footer>
      </div>
      <div class="policy-card"><PolicyPreview :profile-id="profileId" :content="content" /></div>
      <section class="policy-card">
        <header>
          <h2>{{ t('navigationPolicy.history') }}</h2>
        </header>
        <NAlert v-if="history.error.value" type="error" role="alert"
          >{{ t('navigationPolicy.failed') }} · {{ history.error.value.code
          }}<template v-if="history.error.value.requestId">
            · {{ history.error.value.requestId }}</template
          ></NAlert
        >
        <p v-if="!history.items.value.length && !history.loading.value && !history.error.value">
          {{ t('navigationPolicy.noHistory') }}
        </p>
        <ol class="versions">
          <li v-for="v in history.items.value" :key="v.id">
            <div>
              <strong>{{ t('navigationPolicy.version', { version: v.version }) }}</strong> ·
              {{ t(`navigationPolicy.${v.state}`)
              }}<NTag v-if="v.id === state.publishedVersionId" size="small" type="success">{{
                t('navigationPolicy.published')
              }}</NTag>
              <p>{{ v.changeSummary || '—' }}</p>
              <small
                >{{ t('navigationPolicy.counts', { count: v.ruleCount }) }} ·
                <NTime :time="new Date(v.createdAt)" type="datetime"
              /></small>
            </div>
            <NButton :disabled="busy" @click="selectVersion(v.id)">{{
              t('navigationPolicy.view')
            }}</NButton>
          </li>
        </ol>
        <NButton
          v-if="history.nextCursor.value"
          :loading="history.loading.value"
          @click="history.more"
          >{{ t('navigationPolicy.more') }}</NButton
        >
      </section>
    </template>
  </section>
</template>
<style scoped>
.navigation-page {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 20px;
  min-width: 0;
  max-width: 1100px;
}
header,
footer,
.buttons {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
header,
footer {
  justify-content: space-between;
}
h1 {
  font-size: 24px;
  margin: 12px 0;
}
h2 {
  font-size: 18px;
  margin: 0;
}
p,
small,
footer span {
  color: var(--bs-text-muted);
}
p {
  margin: 8px 0;
  overflow-wrap: anywhere;
}
.policy-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 20px;
  background: var(--bs-surface);
  border: 1px solid var(--bs-border);
  border-radius: 10px;
  padding: 24px;
  min-width: 0;
}
.versions {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 12px;
}
.versions li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-top: 1px solid var(--bs-border);
  padding-top: 12px;
  min-width: 0;
}
.versions li > div {
  min-width: 0;
}
footer span {
  margin-right: auto;
}
:deep(.n-alert-body__content) {
  overflow-wrap: anywhere;
}
:deep(.n-alert .n-button__content) {
  white-space: normal;
  text-align: left;
  overflow-wrap: anywhere;
}
@media (max-width: 650px) {
  .policy-card {
    padding: 16px;
  }
}
</style>
