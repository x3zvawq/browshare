<script setup lang="ts">
import { shallowRef } from 'vue'
import type { TabSession } from '@/api/types.js'
import MaintenanceStartModal from '@/components/maintenance/MaintenanceStartModal.vue'
import { RouterLink, useRouter } from 'vue-router'
import { NAlert, NButton, NFormItem, NInput, NSkeleton, NTag, NTime } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import PageScriptForm from './PageScriptForm.vue'
import UserProfileContextPanel from './UserProfileContextPanel.vue'
import { usePageScriptEditor } from './usePageScriptEditor.js'
const props = defineProps<{ profileId: string; canManage: boolean; canMaintain: boolean }>()
const { t } = useI18n()
const router = useRouter(),
  testing = shallowRef(false)
function tested(session: TabSession) {
  testing.value = false
  void router.push({
    name: 'session-viewer',
    params: { id: session.id },
    query: { from: 'page-script' },
  })
}
const {
  state,
  selected,
  error,
  busy,
  initialized,
  editing,
  content,
  summary,
  dirty,
  scriptError,
  history,
  refresh,
  newDraft,
  copy,
  save,
  changePublication,
  selectVersion,
} = usePageScriptEditor(props)
</script>
<template>
  <section class="navigation-page">
    <header>
      <div>
        <RouterLink to="/admin/profiles">{{ t('pageScript.back') }}</RouterLink>
        <h1>
          {{ t('pageScript.title') }}<template v-if="state"> · {{ state.profile.name }}</template>
        </h1>
        <p>{{ t('pageScript.intro') }}</p>
      </div>
      <NButton :loading="busy" @click="refresh">{{ t('pageScript.refresh') }}</NButton>
    </header>
    <NAlert v-if="error" type="error" role="alert" :title="t('pageScript.failed')"
      ><div v-if="scriptError">{{ t('pageScript.invalidScript') }}</div>
      {{ error.code }}<template v-if="error.requestId"> · {{ error.requestId }}</template></NAlert
    >
    <NSkeleton v-if="!initialized && busy" height="360px" />
    <template v-if="state && initialized">
      <NAlert
        :type="state.publishedVersionId ? 'info' : 'warning'"
        :title="t('pageScript.published')"
        ><NButton
          v-if="state.publishedVersionId"
          text
          :disabled="busy"
          @click="selectVersion(state.publishedVersionId)"
          >{{ t('pageScript.view') }} · {{ state.publishedVersionId }}</NButton
        ><span v-else>{{ t('pageScript.none') }}</span></NAlert
      >
      <p v-if="!canManage">{{ t('pageScript.readonly') }}</p>
      <div class="policy-card editor">
        <header>
          <div>
            <h2>
              {{
                selected
                  ? t('pageScript.version', { version: selected.version })
                  : t('pageScript.newDraft')
              }}
            </h2>
            <NTag v-if="selected" size="small">{{ t(`pageScript.${selected.state}`) }}</NTag>
          </div>
          <div v-if="canManage" class="buttons">
            <NButton :disabled="busy" @click="newDraft">{{ t('pageScript.draft') }}</NButton
            ><NButton v-if="!editing" :disabled="busy" @click="copy">{{
              t('pageScript.copy')
            }}</NButton>
          </div>
        </header>
        <PageScriptForm v-model="content" :readonly="!editing || busy" />
        <NFormItem :label="t('pageScript.summary')"
          ><NInput
            v-model:value="summary"
            :readonly="!editing || busy"
            :maxlength="512"
            :input-props="{ 'aria-label': t('pageScript.summary') }"
        /></NFormItem>
        <footer>
          <span v-if="editing" role="status">{{
            t(dirty ? 'pageScript.unsaved' : 'pageScript.clean')
          }}</span>
          <div v-if="canManage" class="buttons">
            <NButton
              v-if="editing"
              type="primary"
              :loading="busy"
              :disabled="!!selected && !dirty"
              @click="save"
              >{{ t('pageScript.save') }}</NButton
            ><NButton
              v-if="selected && state.publishedVersionId !== selected.id"
              :disabled="busy || dirty"
              @click="changePublication('publish')"
              >{{ t('pageScript.publish') }}</NButton
            ><NButton
              v-if="selected?.state === 'PUBLISHED'"
              type="error"
              secondary
              :disabled="busy || dirty"
              @click="changePublication('disable')"
              >{{ t('pageScript.disable') }}</NButton
            >
          </div>
        </footer>
      </div>
      <div v-if="canMaintain" class="buttons">
        <NButton :disabled="busy || dirty || !selected" @click="testing = true">{{
          t('maintenance.test')
        }}</NButton>
        <span v-if="dirty || !selected">{{ t('maintenance.saveFirst') }}</span>
      </div>
      <MaintenanceStartModal
        v-if="testing && selected"
        :profile-id="profileId"
        :page-script-version-id="selected.id"
        @close="testing = false"
        @created="tested"
      />
      <UserProfileContextPanel :profile-id="profileId" :can-manage="canManage" />
      <section class="policy-card">
        <header>
          <h2>{{ t('pageScript.history') }}</h2>
        </header>
        <NAlert v-if="history.error.value" type="error" role="alert"
          >{{ t('pageScript.failed') }} · {{ history.error.value.code
          }}<template v-if="history.error.value.requestId">
            · {{ history.error.value.requestId }}</template
          ></NAlert
        >
        <p v-if="!history.items.value.length && !history.loading.value && !history.error.value">
          {{ t('pageScript.noHistory') }}
        </p>
        <ol class="versions">
          <li v-for="v in history.items.value" :key="v.id">
            <div>
              <strong>{{ t('pageScript.version', { version: v.version }) }}</strong> ·
              {{ t(`pageScript.${v.state}`)
              }}<NTag v-if="v.id === state.publishedVersionId" size="small" type="success">{{
                t('pageScript.published')
              }}</NTag>
              <p>{{ v.changeSummary || '—' }}</p>
              <small
                >{{ t(`pageScript.${v.appliesTo}`) }} ·
                <NTime :time="new Date(v.createdAt)" type="datetime"
              /></small>
            </div>
            <NButton :disabled="busy" @click="selectVersion(v.id)">{{
              t('pageScript.view')
            }}</NButton>
          </li>
        </ol>
        <NButton
          v-if="history.nextCursor.value"
          :loading="history.loading.value"
          @click="history.more"
          >{{ t('pageScript.more') }}</NButton
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
