<script setup lang="ts">
import { shallowRef } from 'vue'
import { NButton, NEmpty, NSkeleton } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { api } from '@/api/client.js'
import { apiFailure } from '@/api/errors.js'
import type { AuditEventListQuery } from '@/api/types.js'
import { usePagedCollection } from '@/composables/usePagedCollection.js'
import RequestError from '@/components/workspace/RequestError.vue'
import AuditFilters from './AuditFilters.vue'
import AuditTable from './AuditTable.vue'
import AuditDetails from './AuditDetails.vue'
const { t } = useI18n()
const query = shallowRef<AuditEventListQuery>({}),
  selected = shallowRef<string | null>(null)
const { items, loading, error, nextCursor, refresh, more } = usePagedCollection(
  query,
  async (cursor, signal) => {
    const r = await api.GET('/audit-events', {
      params: { query: { ...query.value, limit: 30, ...(cursor ? { cursor } : {}) } },
      signal,
    })
    if (!r.data) throw apiFailure(r.error, r.response)
    return r.data
  },
)
</script>
<template>
  <section class="audit">
    <header>
      <h1>{{ t('audit.title') }}</h1>
      <p>{{ t('audit.intro') }}</p>
    </header>
    <AuditFilters @apply="query = $event" />
    <div class="toolbar">
      <p role="status">{{ t('audit.loaded', { count: items.length }) }}</p>
      <NButton :loading="loading" @click="refresh">{{ t('workspace.refresh') }}</NButton>
    </div>
    <RequestError v-if="error" :error="error" />
    <NSkeleton v-if="loading && !items.length" height="200px" />
    <NEmpty v-else-if="!items.length && !error" :description="t('audit.empty')" />
    <AuditTable v-if="items.length" :items="items" @inspect="selected = $event" />
    <NButton v-if="nextCursor" :loading="loading" @click="more">{{ t('workspace.more') }}</NButton>
    <AuditDetails v-if="selected" :id="selected" @close="selected = null" />
  </section>
</template>
<style scoped>
.audit {
  display: grid;
  gap: 20px;
  max-width: 1440px;
  margin: 0 auto;
  min-width: 0;
}
.audit > * {
  min-width: 0;
}
h1 {
  font-size: 26px;
  margin: 0;
}
p {
  color: var(--bs-text-muted);
  line-height: 1.6;
}
.toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
}
.toolbar p {
  margin: 0;
  font-size: 13px;
}
</style>
