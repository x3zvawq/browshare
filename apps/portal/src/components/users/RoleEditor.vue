<script setup lang="ts">
import FormModal from '@/components/forms/FormModal.vue'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NCheckbox, NCheckboxGroup, NEmpty, NTag } from 'naive-ui'
import type { ManagedRole, ManagedUser } from '@/api/types.js'
import type { ApiFailure } from '@/api/errors.js'
import UserRequestError from './UserRequestError.vue'
const props = defineProps<{
  user: ManagedUser
  roles: ManagedRole[]
  readonly: boolean
  busy: boolean
  error: ApiFailure | null
}>()
const emit = defineEmits<{ close: []; submit: [ids: string[]] }>()
const { t } = useI18n(),
  selected = ref([...props.user.roleIds])
const permissions = computed(() =>
  [
    ...new Set(
      props.roles.filter((r) => selected.value.includes(r.id)).flatMap((r) => r.permissions),
    ),
  ].sort(),
)
</script>
<template>
  <FormModal :title="t('users.roles')" :busy="busy" :width="640" @close="emit('close')"
    ><p>{{ user.displayName }} · {{ user.email }}</p>
    <UserRequestError v-if="error" :error="error" />
    <p class="hint">{{ t('users.roleHint') }}</p>
    <NCheckboxGroup v-model:value="selected" :disabled="readonly || busy"
      ><div class="roles">
        <NCheckbox
          v-for="role in roles"
          :key="role.id"
          :value="role.id"
          :label="`${role.name} (${role.code})`"
        /></div
    ></NCheckboxGroup>
    <h3>{{ t('users.permissions') }}</h3>
    <div class="permissions">
      <NTag v-for="permission in permissions" :key="permission" size="small" :bordered="false">{{
        permission
      }}</NTag
      ><NEmpty v-if="!permissions.length" :description="t('users.noPermissions')" />
    </div>
    <template #footer
      ><div class="actions">
        <NButton :disabled="busy" @click="emit('close')">{{ t('common.close') }}</NButton
        ><NButton
          v-if="!readonly"
          type="primary"
          :loading="busy"
          @click="emit('submit', [...selected])"
          >{{ t('common.save') }}</NButton
        >
      </div></template
    ></FormModal
  >
</template>
<style scoped>
.roles {
  display: grid;
  gap: 12px;
}
.permissions,
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.actions {
  justify-content: flex-end;
}
.hint {
  color: var(--bs-text-muted);
  line-height: 1.6;
}
.permissions :deep(.n-tag) {
  max-width: 100%;
  overflow-wrap: anywhere;
  white-space: normal;
  height: auto;
}
</style>
