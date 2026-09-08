<script setup lang="ts">
import { CloseCircleOutline, SearchOutline } from '@vicons/ionicons5'
import { NButton, NIcon, NInput, NSelect, type SelectOption } from 'naive-ui'
import { computed, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import type { ProfileListFacets } from '@/api/types.js'
import type {
  ProfileBusinessStatusFilter,
  ProfileRuntimeStateFilter,
} from '@/composables/useAdminProfiles.js'

const props = defineProps<{
  readonly search: string
  readonly businessStatus: ProfileBusinessStatusFilter
  readonly runtimeState: ProfileRuntimeStateFilter
  readonly workerId: string | null
  readonly groupId: string | null
  readonly facets: ProfileListFacets
  readonly loading: boolean
}>()

const emit = defineEmits<{
  search: [value: string]
  businessStatus: [value: ProfileBusinessStatusFilter]
  runtimeState: [value: ProfileRuntimeStateFilter]
  workerId: [value: string | null]
  groupId: [value: string | null]
  clear: []
}>()

const { t } = useI18n()
const searchDraft = shallowRef(props.search)

watch(
  () => props.search,
  (value) => {
    searchDraft.value = value
  },
)

const businessStatusOptions = computed<SelectOption[]>(() => [
  { label: t('profiles.filters.businessAll'), value: 'ALL' },
  { label: t('profiles.businessStatus.ENABLED'), value: 'ENABLED' },
  { label: t('profiles.businessStatus.DISABLED'), value: 'DISABLED' },
])

const runtimeStateOptions = computed<SelectOption[]>(() => [
  { label: t('profiles.filters.runtimeAll'), value: 'ALL' },
  ...(['STOPPED', 'STARTING', 'RUNNING', 'MAINTAINING', 'STOPPING', 'ERROR'] as const).map(
    (value) => ({ label: t(`profiles.runtimeState.${value}`), value }),
  ),
])

const workerOptions = computed<SelectOption[]>(() =>
  props.facets.workers.map((worker) => ({
    label: `${worker.name} · ${t(`profiles.workerState.${worker.state}`)}`,
    value: worker.id,
  })),
)

const groupOptions = computed<SelectOption[]>(() =>
  props.facets.groups.map((group) => ({
    label: group.name,
    value: group.id,
  })),
)

const hasActiveFilters = computed(
  () =>
    props.search.length > 0 ||
    props.businessStatus !== 'ALL' ||
    props.runtimeState !== 'ALL' ||
    props.workerId !== null ||
    props.groupId !== null,
)

function submitSearch(): void {
  emit('search', searchDraft.value)
}

function clearSearch(): void {
  if (searchDraft.value.length !== 0) return
  emit('search', '')
}
</script>

<template>
  <form class="profile-toolbar" role="search" @submit.prevent="submitSearch">
    <div class="search-control">
      <NInput
        v-model:value="searchDraft"
        clearable
        :maxlength="256"
        :placeholder="$t('profiles.filters.searchPlaceholder')"
        :input-props="{ 'aria-label': $t('profiles.filters.searchLabel') }"
        @clear="clearSearch"
      >
        <template #prefix>
          <NIcon aria-hidden="true" :component="SearchOutline" />
        </template>
      </NInput>
      <NButton attr-type="submit" :disabled="loading">
        {{ $t('profiles.filters.searchAction') }}
      </NButton>
    </div>

    <NSelect
      class="filter-control"
      :value="businessStatus"
      :options="businessStatusOptions"
      :input-props="{ 'aria-label': $t('profiles.filters.businessLabel') }"
      @update:value="$emit('businessStatus', $event as ProfileBusinessStatusFilter)"
    />
    <NSelect
      class="filter-control"
      :value="runtimeState"
      :options="runtimeStateOptions"
      :input-props="{ 'aria-label': $t('profiles.filters.runtimeLabel') }"
      @update:value="$emit('runtimeState', $event as ProfileRuntimeStateFilter)"
    />
    <NSelect
      class="filter-control filter-control-wide"
      :value="workerId"
      :options="workerOptions"
      :placeholder="$t('profiles.filters.workerAll')"
      :input-props="{ 'aria-label': $t('profiles.filters.workerLabel') }"
      filterable
      clearable
      @update:value="$emit('workerId', $event as string | null)"
    />
    <NSelect
      class="filter-control filter-control-wide"
      :value="groupId"
      :options="groupOptions"
      :placeholder="$t('profiles.filters.groupAll')"
      :input-props="{ 'aria-label': $t('profiles.filters.groupLabel') }"
      filterable
      clearable
      @update:value="$emit('groupId', $event as string | null)"
    />

    <div v-if="hasActiveFilters" class="toolbar-actions">
      <NButton v-if="hasActiveFilters" quaternary @click="$emit('clear')">
        <template #icon><NIcon aria-hidden="true" :component="CloseCircleOutline" /></template>
        {{ $t('profiles.filters.clearAction') }}
      </NButton>
    </div>
  </form>
</template>

<style scoped>
.profile-toolbar {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(280px, 1.7fr) repeat(2, minmax(150px, 0.8fr)) repeat(
      2,
      minmax(180px, 1fr)
    );
  gap: 12px;
  align-items: center;
}

.search-control,
.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.search-control :deep(.n-input) {
  min-width: 0;
}

.filter-control {
  min-width: 0;
}

.toolbar-actions {
  grid-column: 1 / -1;
  justify-content: flex-end;
}

@media (max-width: 1500px) {
  .profile-toolbar {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .search-control {
    grid-column: 1 / -1;
  }
}

@media (max-width: 680px) {
  .profile-toolbar {
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
