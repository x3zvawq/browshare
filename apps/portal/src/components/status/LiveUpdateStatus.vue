<script setup lang="ts">
import { computed } from 'vue'
import { NButton, NTime } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { InvalidationState } from '@/composables/useInvalidationEvents.js'
import { portalStatusMessages } from './messages.js'

const props = defineProps<{
  state: InvalidationState | null
  lastReadAt: number | null
  busy: boolean
  viewer?: boolean
}>()
defineEmits<{ refresh: [] }>()
const { t } = useI18n({ messages: portalStatusMessages })
const interrupted = computed(() => props.state === 'reconnecting' || props.state === 'unauthorized')
</script>

<template>
  <div v-if="state && (!viewer || interrupted)" class="live-update-status" :class="{ interrupted }">
    <div class="live-copy">
      <span role="status">{{ t(`liveUpdates.${state}`) }}</span>
      <small v-if="lastReadAt !== null"
        >{{ t('liveUpdates.lastRead') }} · <NTime :time="lastReadAt" type="datetime"
      /></small>
      <small v-else>{{ t('liveUpdates.noSnapshot') }}</small>
      <p v-if="interrupted">
        {{
          t(
            state === 'unauthorized'
              ? 'liveUpdates.accessChanged'
              : viewer
                ? 'liveUpdates.viewerRetained'
                : 'liveUpdates.retained',
          )
        }}
      </p>
    </div>
    <NButton size="small" :loading="busy" @click="$emit('refresh')">{{
      t('liveUpdates.refresh')
    }}</NButton>
  </div>
</template>

<style scoped>
.live-update-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px 18px;
  padding: 12px 14px;
  border: 1px solid var(--bs-border);
  border-radius: 8px;
  background: var(--bs-surface);
  color: var(--bs-text-muted);
  font-size: 12px;
}
.live-copy {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 14px;
  min-width: 0;
}
.live-copy > span {
  color: var(--bs-text);
}
.live-copy small {
  font-size: 11px;
}
.live-copy p {
  flex-basis: 100%;
  margin: 4px 0 0;
  line-height: 1.5;
}
.interrupted {
  border-color: var(--bs-primary);
}
</style>
