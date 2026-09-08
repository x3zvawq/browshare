<script setup lang="ts">
import { NButton, NCheckbox, NPopover } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { shallowRef } from 'vue'
import { profileDetailMessages } from './detail-messages.js'
const props = defineProps<{
  selected: readonly string[]
  options: readonly { key: string; label: string }[]
}>()
const emit = defineEmits<{ change: [keys: string[]]; reset: [] }>()
const { t } = useI18n({ messages: profileDetailMessages })
const open = shallowRef(false)
const trigger = shallowRef<InstanceType<typeof NButton>>()
function close() {
  open.value = false
  trigger.value?.$el.focus()
}
function toggle(key: string, checked: boolean) {
  emit(
    'change',
    props.options
      .filter((o) => (o.key === key ? checked : props.selected.includes(o.key)))
      .map((o) => o.key),
  )
}
</script>
<template>
  <NPopover v-model:show="open" trigger="click" placement="bottom-end">
    <template #trigger
      ><NButton ref="trigger" size="small" :aria-expanded="open" @keydown.esc="close">{{
        t('profileDetail.columns')
      }}</NButton></template
    >
    <section
      class="column-picker"
      :aria-label="t('profileDetail.columns')"
      @keydown.esc.stop.prevent="close"
    >
      <p>{{ t('profileDetail.columnsHint') }}</p>
      <NCheckbox
        v-for="option in options"
        :key="option.key"
        :checked="selected.includes(option.key)"
        @update:checked="toggle(option.key, $event)"
        >{{ option.label }}</NCheckbox
      >
      <NButton size="small" secondary @click="emit('reset')">{{
        t('profileDetail.resetColumns')
      }}</NButton>
    </section>
  </NPopover>
</template>
<style scoped>
.column-picker {
  display: grid;
  gap: 10px;
  width: min(260px, calc(100vw - 64px));
}
p {
  margin: 0;
  color: var(--bs-text-muted);
  font-size: 12px;
}
</style>
