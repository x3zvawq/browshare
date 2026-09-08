<script setup lang="ts">
import { CheckmarkCircleOutline, CopyOutline, KeyOutline } from '@vicons/ionicons5'
import { NAlert, NButton, NIcon, NModal, useMessage } from 'naive-ui'
import { shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

import type { IssuedWorkerEnrollment } from '@/api/types.js'

const props = defineProps<{
  readonly enrollment: IssuedWorkerEnrollment | null
}>()

defineEmits<{ close: [] }>()

const { t } = useI18n()
const message = useMessage()
const copying = shallowRef(false)

async function copyToken(): Promise<void> {
  if (props.enrollment === null) return
  copying.value = true
  try {
    await navigator.clipboard.writeText(props.enrollment.token)
    message.success(t('workers.tokenCopied'))
  } catch {
    message.error(t('workers.tokenCopyFailed'))
  } finally {
    copying.value = false
  }
}
</script>

<template>
  <NModal :show="enrollment !== null" :mask-closable="false" :close-on-esc="false">
    <div
      v-if="enrollment"
      class="n-modal token-modal modal-surface"
      role="dialog"
      aria-modal="true"
      aria-labelledby="enrollment-token-title"
    >
      <h2 id="enrollment-token-title">{{ $t('workers.tokenTitle') }}</h2>
      <div class="token-content">
        <div class="token-heading">
          <div class="token-icon">
            <NIcon aria-hidden="true" :component="KeyOutline" :size="24" />
          </div>
          <div>
            <strong>{{ enrollment.displayName ?? $t('workers.unnamedEnrollment') }}</strong>
            <span>{{
              $t('workers.tokenExpires', { date: new Date(enrollment.expiresAt).toLocaleString() })
            }}</span>
          </div>
        </div>

        <NAlert type="warning" :title="$t('workers.tokenOnceTitle')">
          {{ $t('workers.tokenOnceDescription') }}
        </NAlert>

        <div class="token-value" data-sensitive="worker-enrollment-token">
          <code>{{ enrollment.token }}</code>
          <NButton type="primary" secondary :loading="copying" @click="copyToken">
            <template #icon><NIcon aria-hidden="true" :component="CopyOutline" /></template>
            {{ $t('workers.copyToken') }}
          </NButton>
        </div>

        <NButton type="primary" block @click="$emit('close')">
          <template #icon>
            <NIcon aria-hidden="true" :component="CheckmarkCircleOutline" />
          </template>
          {{ $t('workers.tokenSavedAction') }}
        </NButton>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
.token-modal {
  width: min(620px, calc(100vw - 32px));
}

.modal-surface {
  border: 1px solid var(--bs-border);
  border-radius: 10px;
  background: var(--bs-surface);
  box-shadow: 0 18px 50px rgb(0 0 0 / 24%);
  padding: 20px;
}

.modal-surface > h2 {
  margin: 0 0 20px;
  color: var(--bs-text);
  font-size: 18px;
  font-weight: 680;
}

.token-content {
  display: grid;
  gap: 20px;
}

.token-heading {
  display: flex;
  align-items: center;
  gap: 13px;
}

.token-icon {
  display: grid;
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 10px;
  background: rgb(15 98 214 / 10%);
  color: var(--bs-primary);
}

.token-heading > div:last-child {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.token-heading strong {
  color: var(--bs-text);
  font-size: 15px;
}

.token-heading span {
  color: var(--bs-text-muted);
  font-size: 12px;
}

.token-value {
  display: flex;
  align-items: center;
  gap: 12px;
  border: 1px solid var(--bs-border);
  border-radius: 9px;
  background: var(--bs-canvas);
  padding: 13px;
}

.token-value code {
  min-width: 0;
  flex: 1;
  overflow-wrap: anywhere;
  color: var(--bs-text);
  font-family: var(--bs-font-mono);
  font-size: 12px;
  line-height: 1.6;
  user-select: all;
}

@media (max-width: 560px) {
  .token-value {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
