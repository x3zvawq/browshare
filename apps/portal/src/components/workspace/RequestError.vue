<script setup lang="ts">
import { storageMessages } from '@/components/storage/messages.js'
import StorageBlockNotice from '@/components/storage/StorageBlockNotice.vue'
import { computed } from 'vue'
import { NAlert } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { ApiFailure } from '@/api/errors.js'
const props = defineProps<{ error: ApiFailure; title?: string }>()
const { t, te } = useI18n({ useScope: 'global' })
const { t: storageT, te: storageTe } = useI18n({ messages: storageMessages })
const explanation = computed(() => {
  if (props.title) return props.title
  if (storageTe(`storage.blocks.${props.error.code}`))
    return storageT(`storage.blocks.${props.error.code}`)
  const key = `workspace.errors.${props.error.code}`
  return te(key) ? t(key) : t('workspace.errors.UNKNOWN')
})
const capacityScope = computed(() => {
  const details = props.error.details
  return props.error.code === 'SESSION_CAPACITY_EXCEEDED' &&
    typeof details === 'object' &&
    details !== null &&
    'scope' in details &&
    ['USER', 'PROFILE', 'WORKER'].includes(String(details.scope))
    ? t(`workspace.capacityScope.${String(details.scope)}`)
    : null
})
</script>
<template>
  <NAlert type="error" :title="explanation" role="alert">
    <StorageBlockNotice v-if="storageTe(`storage.blocks.${error.code}`)" :reason="error.code" />
    <p v-if="capacityScope">{{ capacityScope }}</p>
    <small
      >{{ error.code }}<template v-if="error.requestId"> · {{ error.requestId }}</template></small
    >
    <slot />
  </NAlert>
</template>
