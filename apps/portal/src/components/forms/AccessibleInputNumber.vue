<script setup lang="ts">
import { AddOutline, RemoveOutline } from '@vicons/ionicons5'
import { NIcon, NInputNumber } from 'naive-ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = withDefaults(
  defineProps<{
    readonly label: string
    readonly disabled?: boolean
    readonly min: number
    readonly max: number
    readonly precision: number
    readonly placeholder?: string
  }>(),
  {
    disabled: false,
    placeholder: '',
  },
)

const value = defineModel<number | null>('value', { required: true })
const { t } = useI18n()
const decreaseLabel = computed(() => t('common.decreaseField', { field: props.label }))
const increaseLabel = computed(() => t('common.increaseField', { field: props.label }))
</script>

<template>
  <NInputNumber
    v-model:value="value"
    :disabled="disabled"
    :min="min"
    :max="max"
    :precision="precision"
    :placeholder="placeholder"
    :input-props="{ 'aria-label': label }"
  >
    <template #minus-icon>
      <NIcon aria-hidden="true" :component="RemoveOutline" />
      <span class="visually-hidden">{{ decreaseLabel }}</span>
    </template>
    <template #add-icon>
      <NIcon aria-hidden="true" :component="AddOutline" />
      <span class="visually-hidden">{{ increaseLabel }}</span>
    </template>
  </NInputNumber>
</template>

<style scoped>
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
