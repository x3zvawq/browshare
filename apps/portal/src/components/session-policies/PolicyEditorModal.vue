<script setup lang="ts">
import FormModal from '@/components/forms/FormModal.vue'
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue'
import { NAlert, NButton, NForm, NFormItem, NSelect, NSkeleton } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { api } from '@/api/client.js'
import { apiFailure, networkFailure } from '@/api/errors.js'
import type { SessionPolicy, SessionPolicyValues, SaveSessionPolicyInput } from '@/api/types.js'
import SubjectPicker from '@/components/profile-groups/SubjectPicker.vue'
import PolicyValuesForm from './PolicyValuesForm.vue'
const props = defineProps<{
  policy: SessionPolicy | null
  defaults: SessionPolicyValues
  canGlobal: boolean
  canManage: boolean
}>()
const emit = defineEmits<{ close: []; saved: [] }>()
const { t } = useI18n()
const scope = shallowRef<SaveSessionPolicyInput['scope']>(
  props.policy?.scope ?? (props.canGlobal ? 'GLOBAL' : 'USER_PROFILE'),
)
const userIds = shallowRef<string[]>(props.policy?.userId ? [props.policy.userId] : [])
const targetIds = shallowRef<string[]>(
  props.policy?.profileId
    ? [props.policy.profileId]
    : props.policy?.profileGroupId
      ? [props.policy.profileGroupId]
      : [],
)
const values = shallowRef<SessionPolicyValues>({ ...(props.policy?.values ?? props.defaults) })
const loading = shallowRef(false),
  saving = shallowRef(false),
  error = shallowRef(''),
  lookupFailed = shallowRef(false)
const existing = shallowRef(Boolean(props.policy))
const scopes = computed(() =>
  ['GLOBAL', 'USER_PROFILE', 'USER_PROFILE_GROUP']
    .filter((s) => (s === 'GLOBAL' ? props.canGlobal : props.canManage))
    .map((value) => ({ value, label: t(`sessionPolicies.scope.${value}`) })),
)
const ready = computed(
  () => scope.value === 'GLOBAL' || Boolean(userIds.value[0] && targetIds.value[0]),
)
const userLabels = computed(() =>
  props.policy?.userId
    ? [{ id: props.policy.userId, name: props.policy.userName ?? props.policy.userId }]
    : [],
)
const targetLabels = computed(() =>
  props.policy?.profileId
    ? [{ id: props.policy.profileId, name: props.policy.profileName ?? props.policy.profileId }]
    : props.policy?.profileGroupId
      ? [
          {
            id: props.policy.profileGroupId,
            name: props.policy.profileGroupName ?? props.policy.profileGroupId,
          },
        ]
      : [],
)
let controller: AbortController | undefined
watch(scope, () => {
  targetIds.value = []
})
async function loadScope() {
  controller?.abort()
  if (props.policy || !ready.value) {
    loading.value = false
    return
  }
  const current = new AbortController()
  controller = current
  loading.value = true
  error.value = ''
  lookupFailed.value = false
  try {
    const result = await api.GET('/session-policies', {
      params: {
        query: {
          scope: scope.value,
          ...(scope.value !== 'GLOBAL'
            ? {
                userId: userIds.value[0]!,
                ...(scope.value === 'USER_PROFILE'
                  ? { profileId: targetIds.value[0]! }
                  : { profileGroupId: targetIds.value[0]! }),
              }
            : {}),
        },
      },
      signal: current.signal,
    })
    if (!result.data) throw apiFailure(result.error, result.response)
    if (current.signal.aborted) return
    existing.value = Boolean(result.data.items[0])
    values.value = { ...(result.data.items[0]?.values ?? props.defaults) }
  } catch (cause) {
    if (!current.signal.aborted) {
      error.value = failure(cause)
      lookupFailed.value = true
    }
  } finally {
    if (controller === current) loading.value = false
  }
}
watch([scope, userIds, targetIds], () => void loadScope(), { immediate: true })
async function save() {
  if (!ready.value || loading.value || lookupFailed.value || saving.value) return
  if (!Number.isInteger(values.value.countdownSeconds) || values.value.countdownSeconds < 0) {
    error.value = t('sessionPolicies.invalidCountdown')
    return
  }
  saving.value = true
  error.value = ''
  try {
    const result = await api.PUT('/session-policies', {
      body: {
        scope: scope.value,
        userId: scope.value === 'GLOBAL' ? null : userIds.value[0]!,
        profileId: scope.value === 'USER_PROFILE' ? targetIds.value[0]! : null,
        profileGroupId: scope.value === 'USER_PROFILE_GROUP' ? targetIds.value[0]! : null,
        values: values.value,
      },
    })
    if (!result.data) throw apiFailure(result.error, result.response)
    emit('saved')
    emit('close')
  } catch (cause) {
    error.value = failure(cause)
  } finally {
    saving.value = false
  }
}
function failure(cause: unknown): string {
  const error = networkFailure(cause)
  const title = t(
    error.code === 'SESSION_POLICY_CONFLICT'
      ? 'sessionPolicies.conflict'
      : 'sessionPolicies.failed',
  )
  return `${title} · ${error.code}${error.requestId ? ` · ${error.requestId}` : ''}`
}
onBeforeUnmount(() => controller?.abort())
</script>
<template>
  <FormModal :title="t('sessionPolicies.edit')" :busy="saving" :width="760" @close="emit('close')">
    <NAlert type="info" :bordered="false">{{ t('sessionPolicies.saveHint') }}</NAlert>
    <NForm label-placement="top" class="policy-editor" @submit.prevent="save">
      <NFormItem :label="t('sessionPolicies.scopeLabel')"
        ><NSelect v-model:value="scope" :options="scopes" :disabled="Boolean(policy) || saving"
      /></NFormItem>
      <NFormItem v-if="scope !== 'GLOBAL'" :label="t('sessionPolicies.user')"
        ><SubjectPicker
          v-model:value="userIds"
          kind="USER"
          :multiple="false"
          :selected="userLabels"
          :label="t('sessionPolicies.user')"
          :disabled="Boolean(policy) || saving"
      /></NFormItem>
      <NFormItem
        v-if="scope !== 'GLOBAL'"
        :label="t(scope === 'USER_PROFILE' ? 'sessionPolicies.profile' : 'sessionPolicies.group')"
        ><SubjectPicker
          :key="scope"
          v-model:value="targetIds"
          :kind="scope === 'USER_PROFILE' ? 'PROFILE' : 'GROUP'"
          :multiple="false"
          :selected="targetLabels"
          :label="t(scope === 'USER_PROFILE' ? 'sessionPolicies.profile' : 'sessionPolicies.group')"
          :disabled="Boolean(policy) || saving"
      /></NFormItem>
      <NAlert v-if="error" type="error" :title="error"
        ><NButton v-if="lookupFailed" @click="loadScope">{{ t('common.retry') }}</NButton></NAlert
      >
      <NSkeleton v-if="loading" text :repeat="5" />
      <template v-else-if="ready && !lookupFailed"
        ><p>{{ t(existing ? 'sessionPolicies.existing' : 'sessionPolicies.newScope') }}</p>
        <PolicyValuesForm v-model:value="values" :disabled="saving"
      /></template>
    </NForm>
    <template #footer
      ><div class="policy-actions">
        <NButton :disabled="saving" @click="emit('close')">{{ t('common.cancel') }}</NButton
        ><NButton
          type="primary"
          :loading="saving"
          :disabled="!ready || loading || lookupFailed"
          @click="save"
          >{{ t('common.save') }}</NButton
        >
      </div></template
    >
  </FormModal>
</template>
<style scoped>
.policy-editor {
  margin-top: 20px;
}
.policy-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
:deep(.n-form-item-blank) {
  display: block;
}
</style>
