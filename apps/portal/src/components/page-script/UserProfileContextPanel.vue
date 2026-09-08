<script setup lang="ts">
import { NAlert, NButton, NEmpty, NFormItem, NSkeleton, NTime } from 'naive-ui'
import SubjectPicker from '@/components/profile-groups/SubjectPicker.vue'
import ScriptCode from '@/components/shared/ScriptCode.vue'
import { useProfileContextEditor } from './useProfileContextEditor.js'
const props = defineProps<{ profileId: string; canManage: boolean }>()
const {
  t,
  userIds,
  userId,
  state,
  draft,
  loading,
  saving,
  locked,
  dirty,
  error,
  errorText,
  validation,
  selectUsers,
  refresh,
  save,
  clear,
} = useProfileContextEditor(props)
</script>
<template>
  <section class="user-profile-context">
    <h2>{{ t('profileContext.title') }}</h2>
    <p>{{ t('profileContext.intro') }}</p>
    <p v-if="!canManage" role="status">{{ t('profileContext.readonly') }}</p>
    <template v-else>
      <NAlert type="warning"
        ><p>{{ t('profileContext.publicHint') }}</p>
        <p>{{ t('profileContext.snapshotHint') }}</p></NAlert
      >
      <NFormItem :label="t('profileContext.target')">
        <div class="context-user-picker">
          <SubjectPicker
            kind="USER"
            :multiple="false"
            :value="userIds"
            :selected="[]"
            :label="t('profileContext.target')"
            :disabled="locked"
            @update:value="selectUsers"
          />
          <small v-if="userId">{{ userId }}</small>
        </div>
      </NFormItem>
      <NEmpty v-if="!userId" :description="t('profileContext.empty')" />
      <template v-else>
        <p v-if="loading" role="status">{{ t('profileContext.loading') }}</p>
        <NSkeleton v-if="loading && !state" height="240px" />
        <NAlert v-if="error" type="error" role="alert" :title="t('profileContext.failed')">
          <p>{{ errorText }}</p>
          <small
            >{{ error.code
            }}<template v-if="error.requestId"> · {{ error.requestId }}</template></small
          >
          <NButton v-if="!state" :disabled="locked || loading" @click="refresh">{{
            t('profileContext.retry')
          }}</NButton>
        </NAlert>
        <form v-if="state" :aria-busy="loading || saving" @submit.prevent="save">
          <p>{{ t('profileContext.rules') }}</p>
          <ScriptCode
            v-model="draft"
            :max-length="null"
            :readonly="locked || loading"
            :label="t('profileContext.json')"
          />
          <NAlert v-if="validation" type="error" role="alert">{{ validation }}</NAlert>
          <div class="context-saved-state">
            <span role="status">{{
              t(dirty ? 'profileContext.unsaved' : 'profileContext.clean')
            }}</span>
            <span v-if="state.updatedAt"
              >{{ t('profileContext.savedAt') }} ·
              <NTime :time="new Date(state.updatedAt)" type="datetime"
            /></span>
            <span v-else>{{ t('profileContext.neverSaved') }}</span>
          </div>
          <div class="context-actions">
            <NButton :disabled="locked || loading" @click="refresh">{{
              t('profileContext.refresh')
            }}</NButton>
            <NButton :disabled="locked || loading" @click="clear">{{
              t('profileContext.clear')
            }}</NButton>
            <NButton
              attr-type="submit"
              type="primary"
              :loading="saving"
              :disabled="locked || loading || !dirty"
              >{{ t('profileContext.save') }}</NButton
            >
          </div>
        </form>
      </template>
    </template>
  </section>
</template>
<style scoped>
.user-profile-context {
  display: grid;
  gap: 16px;
  min-width: 0;
  padding: 24px;
  border: 1px solid var(--bs-border);
  border-radius: 10px;
  background: var(--bs-surface);
  color: var(--bs-text);
}
.user-profile-context h2 {
  margin: 0;
  font-size: 18px;
}
p {
  margin: 0;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
small {
  overflow-wrap: anywhere;
}
.context-user-picker {
  width: 100%;
  min-width: 0;
}
form {
  display: grid;
  gap: 14px;
  min-width: 0;
}
.context-saved-state,
.context-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 16px;
}
.context-saved-state {
  color: var(--bs-text-muted);
  font-size: 12px;
}
.context-actions {
  justify-content: flex-end;
}
:deep(.n-alert p + p) {
  margin-top: 10px;
}
:deep(.n-button) {
  height: auto;
  min-height: 34px;
}
:deep(.n-button__content) {
  white-space: normal;
  padding-block: 4px;
}
@media (max-width: 650px) {
  .user-profile-context {
    padding: 16px;
  }
}
</style>
