<script setup lang="ts">
import { storageMessages } from '@/components/storage/messages.js'
import StorageBlockNotice from '@/components/storage/StorageBlockNotice.vue'
import { NAlert } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { ApiFailure } from '@/api/errors.js'
defineProps<{ error: ApiFailure }>()
const { t, te } = useI18n({ useScope: 'global' })
const { t: storageT, te: storageTe } = useI18n({ messages: storageMessages })
</script>
<template>
  <NAlert
    type="error"
    role="alert"
    :title="
      storageTe(`storage.blocks.${error.code}`)
        ? storageT(`storage.blocks.${error.code}`)
        : t(
            te(`workerManagement.errors.${error.code}`)
              ? `workerManagement.errors.${error.code}`
              : 'workerManagement.errors.UNKNOWN',
          )
    "
    ><StorageBlockNotice
      v-if="storageTe(`storage.blocks.${error.code}`)"
      :reason="error.code" /><small
      >{{ error.code }}<template v-if="error.requestId"> · {{ error.requestId }}</template></small
    ><slot
  /></NAlert>
</template>
