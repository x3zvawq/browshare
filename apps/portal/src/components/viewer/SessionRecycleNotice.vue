<script setup lang="ts">
import { computed, onScopeDispose, shallowRef, watch } from 'vue'
import { NAlert, NButton } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { TabSession } from '@/api/types.js'
import type { ApiFailure } from '@/api/errors.js'
import RequestError from '@/components/workspace/RequestError.vue'
const props = defineProps<{
  session: TabSession
  busy: boolean
  connected: boolean
  error: ApiFailure | null
}>()
const emit = defineEmits<{ continue: [] }>()
const { t } = useI18n()
const now = shallowRef(0)
let reference = { server: 0, local: 0 }
watch(
  () => props.session.serverTime,
  (value) => {
    reference = { server: Date.parse(value), local: performance.now() }
    now.value = reference.server
  },
  { immediate: true },
)
const timer = window.setInterval(() => {
  now.value = reference.server + performance.now() - reference.local
}, 250)
onScopeDispose(() => clearInterval(timer))
const policy = computed(() => props.session.recycling)
const visible = computed(
  () => policy.value && now.value >= Date.parse(policy.value.countdownStartsAt),
)
const seconds = computed(() =>
  policy.value ? Math.max(0, Math.ceil((Date.parse(policy.value.deadline) - now.value) / 1000)) : 0,
)
</script>
<template>
  <div v-if="visible || error" class="recycle-notice">
    <NAlert v-if="visible && policy" type="warning" :title="t('workspace.recycling.title')">
      <p class="description">{{ t(`workspace.recycling.${policy.reason}`) }}</p>
      <div class="recycle-actions">
        <span role="timer">{{
          t(seconds > 0 ? 'workspace.recycling.remaining' : 'workspace.recycling.waiting', {
            seconds,
          })
        }}</span>
        <NButton
          v-if="policy.canContinue"
          size="small"
          :loading="busy"
          :disabled="seconds === 0 || !connected"
          @click="emit('continue')"
          >{{ t('workspace.recycling.continue') }}</NButton
        >
      </div>
    </NAlert>
    <RequestError v-if="error" :error="error" />
  </div>
</template>
<style scoped>
.recycle-notice {
  flex: 0 0 auto;
  padding: 8px 16px;
}
.description {
  margin: 0 0 6px;
}
.recycle-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  align-items: center;
  justify-content: space-between;
}
</style>
