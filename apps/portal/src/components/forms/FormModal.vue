<script setup lang="ts">
import { CloseOutline } from '@vicons/ionicons5'
import { NButton, NIcon, NModal } from 'naive-ui'
import { useId } from 'vue'
import { useI18n } from 'vue-i18n'
withDefaults(
  defineProps<{ title: string; busy: boolean; width?: number; maskClosable?: boolean }>(),
  {
    width: 560,
    maskClosable: false,
  },
)
const emit = defineEmits<{ close: [] }>()
const titleId = useId()
const { t } = useI18n()
</script>

<template>
  <NModal
    show
    :mask-closable="maskClosable && !busy"
    :close-on-esc="!busy"
    @esc="!busy && emit('close')"
    @mask-click="maskClosable && !busy && emit('close')"
  >
    <div
      class="n-modal form-modal"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      :style="{ width: `min(${width}px, calc(100vw - 32px))` }"
    >
      <div class="form-modal-header">
        <h2 :id="titleId">{{ title }}</h2>
        <NButton
          :disabled="busy"
          quaternary
          circle
          :aria-label="t('common.close')"
          @click="emit('close')"
        >
          <template #icon><NIcon :component="CloseOutline" aria-hidden="true" /></template>
        </NButton>
      </div>
      <slot />
      <div v-if="$slots.footer" class="form-modal-footer"><slot name="footer" /></div>
    </div>
  </NModal>
</template>

<style scoped>
.form-modal {
  max-height: calc(100dvh - 32px);
  overflow-y: auto;
  border: 1px solid var(--bs-border);
  border-radius: 12px;
  background: var(--bs-surface);
  color: var(--bs-text);
  box-shadow: 0 18px 60px rgb(0 0 0 / 26%);
  padding: 22px;
}
.form-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}
.form-modal-header h2 {
  margin: 0;
  font-size: 19px;
  overflow-wrap: anywhere;
}
.form-modal-footer {
  margin-top: 22px;
}
</style>
