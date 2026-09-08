<script setup lang="ts">
import { CloseOutline } from '@vicons/ionicons5'
import { NAlert, NButton, NIcon, NModal } from 'naive-ui'
import { shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ApiFailure } from '@/api/errors.js'
import type { Profile } from '@/api/types.js'
import { profileRuntimeMessages } from './runtime-messages.js'

const props = defineProps<{
  profile: Profile | null
  closeSessions: boolean
  busy: boolean
  error: ApiFailure | null
}>()
defineEmits<{ close: []; submit: [] }>()
const { t, te } = useI18n({ messages: profileRuntimeMessages })
const displayed = shallowRef(props.profile)
watch(
  () => props.profile,
  (profile) => {
    if (profile) displayed.value = profile
  },
)
</script>

<template>
  <NModal
    :show="profile !== null"
    :mask-closable="!busy"
    :close-on-esc="!busy"
    @mask-click="$emit('close')"
    @esc="$emit('close')"
  >
    <div
      v-if="displayed"
      class="n-modal stop-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-runtime-stop-title"
    >
      <div class="stop-header">
        <h2 id="profile-runtime-stop-title">
          {{ t(closeSessions ? 'runtimeRecovery.title' : 'profiles.runtime.stopTitle') }}
        </h2>
        <NButton
          v-if="!busy"
          quaternary
          circle
          :aria-label="t('common.close')"
          @click="$emit('close')"
        >
          <template #icon><NIcon :component="CloseOutline" aria-hidden="true" /></template>
        </NButton>
      </div>
      <div class="stop-content">
        <p>
          {{
            t(closeSessions ? 'runtimeRecovery.description' : 'profiles.runtime.stopDescription', {
              name: displayed.name,
            })
          }}
        </p>
        <NAlert v-if="closeSessions && displayed.runtimeMode === 'ALWAYS_ON'" type="warning">
          {{ t('runtimeRecovery.alwaysOnHint') }}
        </NAlert>
        <p v-if="closeSessions">{{ t('runtimeRecovery.cleanupHint') }}</p>
        <NAlert
          v-if="error"
          type="error"
          role="alert"
          :title="
            t(
              te(`runtimeRecovery.errors.${error.code}`)
                ? `runtimeRecovery.errors.${error.code}`
                : 'runtimeRecovery.failed',
            )
          "
        >
          <code>{{ error.code }}</code>
          <div v-if="error.requestId">{{ t('common.requestId') }}: {{ error.requestId }}</div>
        </NAlert>
      </div>
      <div class="stop-actions">
        <NButton :disabled="busy" @click="$emit('close')">{{ t('common.cancel') }}</NButton>
        <NButton type="error" :loading="busy" :disabled="busy" @click="$emit('submit')">
          {{ t(closeSessions ? 'runtimeRecovery.action' : 'profiles.runtime.stop') }}
        </NButton>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
.stop-modal {
  width: min(560px, calc(100vw - 32px));
  border: 1px solid var(--bs-border);
  border-radius: 12px;
  background: var(--bs-surface);
  color: var(--bs-text);
  box-shadow: 0 18px 60px rgb(0 0 0 / 26%);
  padding: 22px;
}
.stop-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}
.stop-header h2 {
  margin: 0;
  font-size: 19px;
  overflow-wrap: anywhere;
}
.stop-content {
  display: grid;
  gap: 16px;
  overflow-wrap: anywhere;
}
.stop-content p {
  margin: 0;
}
.stop-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 22px;
}
</style>
