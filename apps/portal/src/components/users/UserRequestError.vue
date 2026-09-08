<script setup lang="ts">
import { NAlert } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { ApiFailure } from '@/api/errors.js'
defineProps<{ error: ApiFailure }>()
const { t, te } = useI18n()
</script>
<template>
  <NAlert
    type="error"
    role="alert"
    :title="
      t(te(`users.errors.${error.code}`) ? `users.errors.${error.code}` : 'users.errors.UNKNOWN')
    "
    ><small
      >{{ error.code }}<template v-if="error.requestId"> · {{ error.requestId }}</template></small
    ><slot
  /></NAlert>
</template>
