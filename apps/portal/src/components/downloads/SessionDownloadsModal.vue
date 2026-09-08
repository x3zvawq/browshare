<script setup lang="ts">
import { useId } from 'vue'
import { NAlert, NButton, NEmpty, NModal, NSkeleton } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { TabSession } from '@/api/types.js'
import { useSessionDownloads } from '@/composables/useSessionDownloads.js'
import { sessionName } from '@/utils/tab-session.js'
import DownloadItem from './DownloadItem.vue'
const props = defineProps<{ session: TabSession }>()
defineEmits<{ close: [] }>()
const { t } = useI18n()
const titleId = useId()
const {
  items,
  error,
  loading,
  workerOnline,
  canClaim,
  now,
  deliveries,
  nextCursor,
  refresh,
  more,
  claim,
} = useSessionDownloads(() => props.session.id)
</script>
<template>
  <NModal :show="true" @mask-click="$emit('close')" @esc="$emit('close')">
    <div class="n-modal download-modal" role="dialog" aria-modal="true" :aria-labelledby="titleId">
      <header class="modal-header">
        <h2 :id="titleId">{{ t('downloads.title') }}</h2>
        <NButton quaternary @click="$emit('close')">{{ t('downloads.close') }}</NButton>
      </header>
      <div class="downloads-panel">
        <p class="session-name">{{ sessionName(session) }}</p>
        <p class="hint">{{ t('downloads.intro') }}</p>
        <NAlert v-if="error" type="error" role="alert">{{ t('downloads.unavailable') }}</NAlert>
        <NAlert v-else-if="workerOnline === false" type="warning" role="status">{{
          t('downloads.offline')
        }}</NAlert>
        <div>
          <NButton :loading="loading" @click="refresh">{{ t('downloads.refresh') }}</NButton>
        </div>
        <NSkeleton v-if="loading && !items.length" height="120px" :sharp="false" />
        <NEmpty v-else-if="!items.length && !error" :description="t('downloads.empty')" />
        <ul v-else class="file-list" :aria-label="t('downloads.title')">
          <DownloadItem
            v-for="file in items"
            :key="file.id"
            :file="file"
            :now="now"
            :enabled="canClaim"
            :delivery="deliveries[file.id]"
            @claim="claim"
          />
        </ul>
        <NButton v-if="nextCursor" :loading="loading" @click="more">{{
          t('downloads.more')
        }}</NButton>
        <p v-if="Object.values(deliveries).some((delivery) => delivery.submitted)" class="hint">
          {{ t('downloads.closeHint') }}
        </p>
      </div>
    </div>
  </NModal>
</template>
<style scoped>
.download-modal {
  width: min(760px, calc(100vw - 32px));
  max-height: calc(100dvh - 32px);
  display: flex;
  flex-direction: column;
  background: var(--bs-surface);
  color: var(--bs-text);
  border: 1px solid var(--bs-border);
  border-radius: 16px;
  box-shadow: var(--bs-shadow-lg);
  padding: 22px;
  box-sizing: border-box;
}
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex: none;
  padding-bottom: 16px;
}
.modal-header h2 {
  margin: 0;
  font-size: 20px;
}

.downloads-panel {
  display: grid;
  gap: 14px;
  min-width: 0;
  min-height: 0;
  overflow: auto;
}
.session-name {
  font-weight: 600;
  margin: 0;
  overflow-wrap: anywhere;
}
.hint {
  color: var(--bs-text-muted);
  margin: 0;
}
.file-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
</style>
