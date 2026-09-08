<script setup lang="ts">
import { CloseCircleOutline, RefreshOutline, SearchOutline } from '@vicons/ionicons5'
import { NButton, NIcon, NInput, NSelect, type SelectOption } from 'naive-ui'
import { computed, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import type { ProxyHealthFilter, ProxyTypeFilter } from '@/composables/useAdminProxies.js'

const props = defineProps<{
  readonly search: string
  readonly type: ProxyTypeFilter
  readonly healthStatus: ProxyHealthFilter
  readonly loading: boolean
}>()

const emit = defineEmits<{
  search: [value: string]
  type: [value: ProxyTypeFilter]
  healthStatus: [value: ProxyHealthFilter]
  clear: []
  refresh: []
}>()

const { t } = useI18n()
const searchDraft = shallowRef(props.search)

watch(
  () => props.search,
  (value) => {
    searchDraft.value = value
  },
)

const typeOptions = computed<SelectOption[]>(() => [
  { label: t('proxies.filters.typeAll'), value: 'ALL' },
  ...(['DIRECT', 'HTTP', 'HTTPS', 'SOCKS5'] as const).map((value) => ({
    label: t(`proxies.type.${value}`),
    value,
  })),
])

const healthOptions = computed<SelectOption[]>(() => [
  { label: t('proxies.filters.healthAll'), value: 'ALL' },
  ...(['UNKNOWN', 'HEALTHY', 'UNHEALTHY'] as const).map((value) => ({
    label: t(`proxies.health.${value}`),
    value,
  })),
])

const hasActiveFilters = computed(
  () => props.search.length > 0 || props.type !== 'ALL' || props.healthStatus !== 'ALL',
)

function submitSearch(): void {
  emit('search', searchDraft.value)
}

function clearSearch(): void {
  if (searchDraft.value.length === 0) emit('search', '')
}
</script>

<template>
  <form class="proxy-toolbar" role="search" @submit.prevent="submitSearch">
    <div class="search-control">
      <NInput
        v-model:value="searchDraft"
        clearable
        :maxlength="256"
        :placeholder="$t('proxies.filters.searchPlaceholder')"
        :input-props="{ 'aria-label': $t('proxies.filters.searchLabel') }"
        @clear="clearSearch"
      >
        <template #prefix><NIcon aria-hidden="true" :component="SearchOutline" /></template>
      </NInput>
      <NButton attr-type="submit" :disabled="loading">
        {{ $t('proxies.filters.searchAction') }}
      </NButton>
    </div>

    <NSelect
      class="filter-control"
      :value="type"
      :options="typeOptions"
      :input-props="{ 'aria-label': $t('proxies.filters.typeLabel') }"
      @update:value="$emit('type', $event as ProxyTypeFilter)"
    />
    <NSelect
      class="filter-control"
      :value="healthStatus"
      :options="healthOptions"
      :input-props="{ 'aria-label': $t('proxies.filters.healthLabel') }"
      @update:value="$emit('healthStatus', $event as ProxyHealthFilter)"
    />

    <div class="toolbar-actions">
      <NButton v-if="hasActiveFilters" quaternary @click="$emit('clear')">
        <template #icon><NIcon aria-hidden="true" :component="CloseCircleOutline" /></template>
        {{ $t('proxies.filters.clearAction') }}
      </NButton>
      <NButton :loading="loading" @click="$emit('refresh')">
        <template #icon><NIcon aria-hidden="true" :component="RefreshOutline" /></template>
        {{ $t('common.refresh') }}
      </NButton>
    </div>
  </form>
</template>

<style scoped>
.proxy-toolbar {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(280px, 1.7fr) repeat(2, minmax(170px, 0.8fr));
  gap: 12px;
  align-items: center;
}

.search-control,
.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.search-control :deep(.n-input),
.filter-control {
  min-width: 0;
}

.toolbar-actions {
  grid-column: 1 / -1;
  justify-content: flex-end;
}

@media (max-width: 900px) {
  .proxy-toolbar {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .search-control {
    grid-column: 1 / -1;
  }
}

@media (max-width: 680px) {
  .proxy-toolbar {
    grid-template-columns: 1fr;
  }

  .search-control,
  .toolbar-actions {
    grid-column: 1;
  }

  .toolbar-actions {
    justify-content: stretch;
  }

  .toolbar-actions :deep(.n-button) {
    flex: 1;
  }
}
</style>
