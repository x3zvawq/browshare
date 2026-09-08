<script setup lang="ts">
import { onBeforeUnmount, shallowRef, watch } from 'vue'
import { NAlert, NButton, NCard, NForm, NFormItem, NTag } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { api } from '@/api/client.js'
import { apiFailure, networkFailure } from '@/api/errors.js'
import type { SessionPolicyPreview } from '@/api/types.js'
import SubjectPicker from '@/components/profile-groups/SubjectPicker.vue'
import PolicyValuesForm from './PolicyValuesForm.vue'
const { t } = useI18n()
const users = shallowRef<string[]>([]),
  profiles = shallowRef<string[]>([])
const result = shallowRef<SessionPolicyPreview | null>(null),
  error = shallowRef(''),
  loading = shallowRef(false)
let controller: AbortController | undefined
watch([users, profiles], () => {
  controller?.abort()
  result.value = null
  error.value = ''
  loading.value = false
})
async function preview() {
  if (!users.value[0] || !profiles.value[0]) return
  controller?.abort()
  const current = new AbortController()
  controller = current
  loading.value = true
  error.value = ''
  result.value = null
  try {
    const response = await api.GET('/session-policies/effective', {
      params: { query: { userId: users.value[0], profileId: profiles.value[0] } },
      signal: current.signal,
    })
    if (!response.data) throw apiFailure(response.error, response.response)
    if (!current.signal.aborted) result.value = response.data
  } catch (cause) {
    if (!current.signal.aborted) {
      const failure = networkFailure(cause)
      error.value = `${t('sessionPolicies.failed')} · ${failure.code}${failure.requestId ? ` · ${failure.requestId}` : ''}`
    }
  } finally {
    if (controller === current) loading.value = false
  }
}
onBeforeUnmount(() => controller?.abort())
</script>
<template>
  <NCard :title="t('sessionPolicies.previewTitle')" :bordered="false">
    <p>{{ t('sessionPolicies.previewHint') }}</p>
    <NForm label-placement="top" @submit.prevent="preview">
      <div class="preview-targets">
        <NFormItem :label="t('sessionPolicies.user')"
          ><SubjectPicker
            v-model:value="users"
            kind="USER"
            :multiple="false"
            :selected="[]"
            :label="t('sessionPolicies.previewUser')"
        /></NFormItem>
        <NFormItem :label="t('sessionPolicies.profile')"
          ><SubjectPicker
            v-model:value="profiles"
            kind="PROFILE"
            :multiple="false"
            :selected="[]"
            :label="t('sessionPolicies.previewProfile')"
        /></NFormItem>
      </div>
      <NButton :loading="loading" :disabled="!users.length || !profiles.length" @click="preview">{{
        t('sessionPolicies.previewAction')
      }}</NButton>
      <NAlert v-if="error" type="error" :title="error" class="preview-result" />
      <div v-if="result" class="preview-result">
        <NTag :type="result.accessible ? 'success' : 'warning'">{{
          t(result.accessible ? 'sessionPolicies.accessible' : 'sessionPolicies.inaccessible')
        }}</NTag>
        <p>
          {{
            t('sessionPolicies.resolved', {
              scope: t(`sessionPolicies.scope.${result.resolved.scope}`),
            })
          }}
          <span v-if="result.resolved.priority !== null">
            · {{ t('profileGroups.priority') }} {{ result.resolved.priority }}</span
          >
        </p>
        <p v-if="!result.resolved.policyId">{{ t('sessionPolicies.builtIn') }}</p>
        <PolicyValuesForm :value="result.resolved.values" disabled />
      </div>
    </NForm>
  </NCard>
</template>
<style scoped>
.preview-targets {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.preview-result {
  margin-top: 20px;
}
:deep(.n-form-item-blank) {
  display: block;
}
@media (max-width: 640px) {
  .preview-targets {
    grid-template-columns: 1fr;
    gap: 0;
  }
}
</style>
