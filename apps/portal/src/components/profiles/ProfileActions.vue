<script setup lang="ts">
import { computed, h } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NDropdown, NIcon, type DropdownOption } from 'naive-ui'
import {
  CreateOutline,
  EllipsisHorizontal,
  KeyOutline,
  PowerOutline,
  StopCircleOutline,
  TrashOutline,
} from '@vicons/ionicons5'
import type { Profile } from '@/api/types.js'
import { profileRuntimeMessages } from './runtime-messages.js'

const props = defineProps<{ profile: Profile; busy: boolean; runtimeBusy: boolean }>()
const emit = defineEmits<{
  edit: [profile: Profile]
  grants: [profile: Profile]
  setRuntime: [profile: Profile, action: 'START' | 'STOP']
  recoverRuntime: [profile: Profile]
  toggleState: [profile: Profile]
  delete: [profile: Profile]
}>()
const { t } = useI18n({ messages: profileRuntimeMessages })
const deletionPending = computed(() => props.profile.deleteRequestedAt !== null)
const start = computed(() => ['STOPPED', 'ERROR'].includes(props.profile.runtimeState))
const blocked = computed(() => {
  const p = props.profile
  if (props.busy || props.runtimeBusy || deletionPending.value) return true
  return start.value
    ? !!p.storageBlockedReason ||
        p.businessStatus !== 'ENABLED' ||
        p.worker.state !== 'ONLINE' ||
        !p.healthcheckUrl ||
        p.capacity.activeSessions > 0
    : (p.runtimeMode === 'ALWAYS_ON' && p.businessStatus === 'ENABLED') ||
        !['ONLINE', 'DRAINING'].includes(p.worker.state) ||
        ['STOPPED', 'STOPPING', 'MAINTAINING'].includes(p.runtimeState) ||
        p.capacity.activeSessions > 0
})
const hint = computed(() => {
  if (start.value && !props.profile.healthcheckUrl)
    return t('profiles.runtime.configureHealthcheck')
  if (
    !start.value &&
    props.profile.runtimeMode === 'ALWAYS_ON' &&
    props.profile.businessStatus === 'ENABLED'
  )
    return t('profiles.runtime.alwaysOnStop')
  return undefined
})
const icon = (component: typeof CreateOutline) => () => h(NIcon, { component, 'aria-hidden': true })
const options = computed<DropdownOption[]>(() => [
  {
    key: 'edit',
    label: t('common.edit'),
    icon: icon(CreateOutline),
    disabled: deletionPending.value || props.busy,
  },
  {
    key: 'grants',
    label: t('profileGroups.grants'),
    icon: icon(KeyOutline),
    disabled: deletionPending.value || props.busy,
  },
  {
    key: 'toggleState',
    label: t(props.profile.businessStatus === 'ENABLED' ? 'common.disable' : 'common.enable'),
    icon: icon(PowerOutline),
    disabled: deletionPending.value || props.busy,
  },
  { type: 'divider', key: 'divider' },
  {
    key: 'recoverRuntime',
    label: t('runtimeRecovery.action'),
    icon: icon(StopCircleOutline),
    disabled: !props.profile.runtimeRecovery.canRecover || props.busy || props.runtimeBusy,
  },
  {
    key: 'delete',
    label: t('common.delete'),
    icon: icon(TrashOutline),
    disabled: deletionPending.value || props.busy,
  },
])
function select(key: string) {
  if (options.value.find((option) => option.key === key)?.disabled !== false) return
  switch (key) {
    case 'edit':
      emit('edit', props.profile)
      break
    case 'grants':
      emit('grants', props.profile)
      break
    case 'toggleState':
      emit('toggleState', props.profile)
      break
    case 'recoverRuntime':
      emit('recoverRuntime', props.profile)
      break
    case 'delete':
      emit('delete', props.profile)
      break
  }
}
</script>
<template>
  <div class="profile-actions">
    <NButton
      size="small"
      :type="start ? 'primary' : 'default'"
      secondary
      :loading="runtimeBusy"
      :disabled="blocked"
      :title="hint"
      :aria-label="
        t(start ? 'profiles.runtime.startLabel' : 'profiles.runtime.stopLabel', {
          name: profile.name,
        })
      "
      @click="emit('setRuntime', profile, start ? 'START' : 'STOP')"
    >
      {{ t(start ? 'profiles.runtime.start' : 'profiles.runtime.stop') }}
    </NButton>
    <NDropdown trigger="click" placement="bottom-end" :options="options" @select="select">
      <NButton
        size="small"
        quaternary
        :aria-label="t('profiles.moreLabel', { name: profile.name })"
      >
        <template #icon><NIcon :component="EllipsisHorizontal" aria-hidden="true" /></template>
        {{ t('profiles.more') }}
      </NButton>
    </NDropdown>
  </div>
</template>
<style scoped>
.profile-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
</style>
