<script setup lang="ts">
import { AlertCircleOutline, CloseOutline, TrashOutline } from '@vicons/ionicons5'
import { NAlert, NButton, NIcon, NInput, NModal } from 'naive-ui'
import { computed, shallowRef, watch } from 'vue'

import type { Profile } from '@/api/types.js'

const props = defineProps<{
  readonly profile: Profile | null
  readonly busy: boolean
  readonly error: string | null
  readonly requestId: string | undefined
}>()

defineEmits<{
  close: []
  submit: [expectedName: string]
}>()

const expectedName = shallowRef('')
const renderedProfile = shallowRef<Profile | null>(props.profile)
const confirmationMatches = computed(
  () => props.profile !== null && expectedName.value === props.profile.name,
)

watch(
  () => props.profile,
  (profile) => {
    if (profile !== null) renderedProfile.value = profile
    expectedName.value = ''
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
      v-if="renderedProfile"
      class="n-modal deletion-modal modal-surface"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-deletion-title"
    >
      <header class="modal-header">
        <div class="title-group">
          <div class="danger-icon">
            <NIcon aria-hidden="true" :component="TrashOutline" :size="22" />
          </div>
          <div>
            <p>{{ $t('profiles.deletion.eyebrow') }}</p>
            <h2 id="profile-deletion-title">{{ $t('profiles.deletion.title') }}</h2>
          </div>
        </div>
        <NButton
          v-if="!busy"
          quaternary
          circle
          :aria-label="$t('common.close')"
          @click="$emit('close')"
        >
          <template #icon><NIcon aria-hidden="true" :component="CloseOutline" /></template>
        </NButton>
      </header>

      <NAlert type="warning" :title="$t('profiles.deletion.warningTitle')">
        {{ $t('profiles.deletion.warningDescription') }}
      </NAlert>

      <div class="confirmation-copy">
        <p>{{ $t('profiles.deletion.confirmInstruction') }}</p>
        <code>{{ renderedProfile.name }}</code>
      </div>

      <NInput
        v-model:value="expectedName"
        :disabled="busy"
        :placeholder="$t('profiles.deletion.confirmPlaceholder')"
        :input-props="{ 'aria-label': $t('profiles.deletion.confirmLabel') }"
        @keyup.enter="confirmationMatches && $emit('submit', expectedName)"
      />

      <NAlert v-if="error" class="form-alert" type="error" :title="error">
        <span v-if="requestId" class="request-id">
          {{ $t('common.requestId') }}: {{ requestId }}
        </span>
      </NAlert>

      <div class="modal-actions">
        <NButton :disabled="busy" @click="$emit('close')">{{ $t('common.cancel') }}</NButton>
        <NButton
          type="error"
          :loading="busy"
          :disabled="!confirmationMatches"
          @click="$emit('submit', expectedName)"
        >
          <template #icon><NIcon aria-hidden="true" :component="AlertCircleOutline" /></template>
          {{ $t('profiles.deletion.submit') }}
        </NButton>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
.deletion-modal {
  width: min(560px, calc(100vw - 32px));
}

.modal-surface {
  border: 1px solid var(--bs-border);
  border-radius: 12px;
  background: var(--bs-surface);
  box-shadow: 0 18px 60px rgb(0 0 0 / 26%);
  padding: 22px;
}

.modal-header,
.title-group,
.modal-actions {
  display: flex;
  align-items: center;
}

.modal-header {
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 18px;
}

.title-group {
  gap: 12px;
}

.danger-icon {
  display: grid;
  width: 42px;
  height: 42px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 10px;
  background: rgb(208 48 80 / 11%);
  color: var(--n-error-color);
}

.title-group p {
  margin: 0 0 3px;
  color: var(--n-error-color);
  font-size: 10px;
  font-weight: 750;
  letter-spacing: 0.12em;
}

.title-group h2 {
  margin: 0;
  color: var(--bs-text);
  font-size: 19px;
}

.confirmation-copy {
  display: grid;
  gap: 8px;
  margin: 20px 0 12px;
}

.confirmation-copy p {
  margin: 0;
  color: var(--bs-text-muted);
  font-size: 13px;
  line-height: 1.55;
}

.confirmation-copy code {
  width: fit-content;
  max-width: 100%;
  overflow-wrap: anywhere;
  border-radius: 6px;
  background: var(--bs-canvas);
  padding: 5px 8px;
  color: var(--bs-text);
  font-family: var(--bs-font-mono);
  font-size: 12px;
}

.form-alert {
  margin-top: 14px;
}

.request-id {
  font-family: var(--bs-font-mono);
  font-size: 11px;
}

.modal-actions {
  justify-content: flex-end;
  gap: 10px;
  border-top: 1px solid var(--bs-border);
  margin-top: 20px;
  padding-top: 18px;
}
</style>
