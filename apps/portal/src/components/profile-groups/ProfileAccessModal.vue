<script setup lang="ts">
import RequestError from '@/components/workspace/RequestError.vue'
import FormModal from '@/components/forms/FormModal.vue'
import { NAlert, NButton, NForm, NFormItem, NSkeleton } from 'naive-ui'
import { onBeforeUnmount, onMounted, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/api/client.js'
import { apiFailure, networkFailure, type ApiFailure } from '@/api/errors.js'
import type { ProfileGroupMembers } from '@/api/types.js'
import SubjectPicker from './SubjectPicker.vue'
const props = defineProps<{
  id: string
  name: string
  kind: 'GROUP' | 'PROFILE'
  readonly: boolean
}>()
const emit = defineEmits<{ close: []; saved: [] }>()
const { t } = useI18n()
const initial = shallowRef<ProfileGroupMembers | null>(null),
  userIds = shallowRef<string[]>([]),
  profileIds = shallowRef<string[]>([])
const loading = shallowRef(false),
  saving = shallowRef(false),
  error = shallowRef<ApiFailure | null>(null)
const controller = new AbortController()
async function load() {
  loading.value = true
  error.value = null
  try {
    const options = { params: { path: { id: props.id } }, signal: controller.signal }
    if (props.kind === 'GROUP') {
      const result = await api.GET('/profile-groups/{id}/members', options)
      if (!result.data) throw apiFailure(result.error, result.response)
      initial.value = result.data
    } else {
      const result = await api.GET('/profiles/{id}/grants', options)
      if (!result.data) throw apiFailure(result.error, result.response)
      initial.value = { profiles: [], users: result.data.users }
    }
    profileIds.value = initial.value.profiles.map((p) => p.id)
    userIds.value = initial.value.users.map((u) => u.id)
  } catch (cause) {
    if (!controller.signal.aborted) error.value = networkFailure(cause)
  } finally {
    loading.value = false
  }
}
async function save() {
  saving.value = true
  error.value = null
  try {
    const result =
      props.kind === 'GROUP'
        ? await api.PUT('/profile-groups/{id}/members', {
            params: { path: { id: props.id } },
            body: { profileIds: profileIds.value, userIds: userIds.value },
          })
        : await api.PUT('/profiles/{id}/grants', {
            params: { path: { id: props.id } },
            body: { userIds: userIds.value },
          })
    if (!result.data) throw apiFailure(result.error, result.response)
    emit('saved')
    emit('close')
  } catch (cause) {
    error.value = networkFailure(cause)
  } finally {
    saving.value = false
  }
}
onMounted(() => void load())
onBeforeUnmount(() => controller.abort())
</script>
<template>
  <FormModal
    :title="
      t(kind === 'GROUP' ? 'profileGroups.membersTitle' : 'profileGroups.grantsTitle', { name })
    "
    :busy="saving"
    :width="680"
    @close="emit('close')"
  >
    <NAlert type="info" :bordered="false">{{
      t(kind === 'GROUP' ? 'profileGroups.membersHint' : 'profileGroups.grantsHint')
    }}</NAlert>
    <NSkeleton v-if="loading" text :repeat="4" />
    <RequestError v-if="error" :error="error" class="access-error"
      ><NButton v-if="!initial" @click="load">{{ t('common.retry') }}</NButton></RequestError
    >
    <NForm v-if="initial" label-placement="top" class="access-form" @submit.prevent="save">
      <NFormItem v-if="kind === 'GROUP'" :label="t('profileGroups.profiles')"
        ><SubjectPicker
          v-model:value="profileIds"
          kind="PROFILE"
          :selected="initial.profiles"
          :label="t('profileGroups.profiles')"
          :disabled="readonly || saving"
      /></NFormItem>
      <NFormItem :label="t('profileGroups.users')"
        ><SubjectPicker
          v-model:value="userIds"
          kind="USER"
          :selected="initial.users"
          :label="t('profileGroups.users')"
          :disabled="readonly || saving"
      /></NFormItem>
    </NForm>
    <template #footer
      ><div class="access-actions">
        <NButton :disabled="saving" @click="emit('close')">{{ t('common.cancel') }}</NButton
        ><NButton
          v-if="!readonly"
          type="primary"
          :loading="saving"
          :disabled="!initial || loading"
          @click="save"
          >{{ t('common.save') }}</NButton
        >
      </div></template
    >
  </FormModal>
</template>
<style scoped>
.access-form,
.access-error {
  margin-top: 20px;
}
.access-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
:deep(.n-form-item-blank) {
  display: block;
}
</style>
