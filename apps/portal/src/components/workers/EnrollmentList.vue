<script setup lang="ts">
import { KeyOutline, RefreshOutline, ServerOutline, TrashOutline } from '@vicons/ionicons5'
import { NAlert, NButton, NCard, NEmpty, NIcon, NSpin, NTag, NTime } from 'naive-ui'
import { useI18n } from 'vue-i18n'

import type { WorkerEnrollment } from '@/api/types.js'

type EnrollmentStatus = WorkerEnrollment['status'] | 'ALL'

defineProps<{
  readonly items: readonly WorkerEnrollment[]
  readonly status: EnrollmentStatus
  readonly loading: boolean
  readonly loadingMore: boolean
  readonly hasMore: boolean
  readonly busyEnrollmentId: string | undefined
  readonly canManage: boolean
  readonly error: string | undefined
}>()

const emit = defineEmits<{
  'update:status': [status: EnrollmentStatus]
  refresh: []
  loadMore: []
  revoke: [enrollment: WorkerEnrollment]
}>()

const { t } = useI18n()

const statusOptions: readonly { readonly labelKey: string; readonly value: EnrollmentStatus }[] = [
  { labelKey: 'workers.statusAll', value: 'ALL' },
  { labelKey: 'workers.statusActive', value: 'ACTIVE' },
  { labelKey: 'workers.statusConsumed', value: 'CONSUMED' },
  { labelKey: 'workers.statusRevoked', value: 'REVOKED' },
  { labelKey: 'workers.statusExpired', value: 'EXPIRED' },
]

function changeStatus(event: Event): void {
  emit('update:status', (event.currentTarget as HTMLSelectElement).value as EnrollmentStatus)
}

function statusLabel(status: WorkerEnrollment['status']): string {
  return t(`workers.status${status[0]}${status.slice(1).toLowerCase()}`)
}

function statusType(status: WorkerEnrollment['status']): 'success' | 'info' | 'error' | 'warning' {
  if (status === 'ACTIVE') return 'success'
  if (status === 'CONSUMED') return 'info'
  if (status === 'REVOKED') return 'error'
  return 'warning'
}
</script>

<template>
  <NCard class="enrollment-card" :bordered="true">
    <div class="list-toolbar">
      <div class="section-heading">
        <div class="section-icon">
          <NIcon aria-hidden="true" :component="ServerOutline" :size="21" />
        </div>
        <div>
          <div class="title-line">
            <h2>{{ $t('workers.listTitle') }}</h2>
            <NTag v-if="items.length" size="small" round :bordered="false">{{ items.length }}</NTag>
          </div>
          <p>{{ $t('workers.listDescription') }}</p>
        </div>
      </div>
      <div class="toolbar-actions">
        <select
          class="status-filter"
          :aria-label="$t('workers.statusFilter')"
          :value="status"
          @change="changeStatus"
        >
          <option v-for="option in statusOptions" :key="option.value" :value="option.value">
            {{ $t(option.labelKey) }}
          </option>
        </select>
        <NButton :loading="loading" :aria-label="$t('common.refresh')" @click="$emit('refresh')">
          <template #icon><NIcon aria-hidden="true" :component="RefreshOutline" /></template>
          {{ $t('common.refresh') }}
        </NButton>
      </div>
    </div>

    <NAlert v-if="error" class="list-alert" type="error" :title="error">
      <NButton text type="primary" @click="$emit('refresh')">{{ $t('common.retry') }}</NButton>
    </NAlert>

    <div v-if="loading && items.length === 0" class="list-loading">
      <NSpin size="small" />
      <span>{{ $t('workers.loading') }}</span>
    </div>
    <NEmpty
      v-else-if="items.length === 0 && !error"
      class="list-empty"
      :description="$t('workers.empty')"
    />
    <div v-else-if="items.length > 0" class="enrollment-list">
      <article v-for="enrollment in items" :key="enrollment.id" class="enrollment-row">
        <div class="row-icon">
          <NIcon aria-hidden="true" :component="KeyOutline" :size="20" />
        </div>
        <div class="row-main">
          <div class="row-title">
            <strong>{{ enrollment.displayName ?? $t('workers.unnamedEnrollment') }}</strong>
            <NTag size="small" round :bordered="false" :type="statusType(enrollment.status)">
              {{ statusLabel(enrollment.status) }}
            </NTag>
          </div>
          <div class="row-meta">
            <span>
              {{ $t('workers.created') }}
              <NTime :time="new Date(enrollment.createdAt)" type="relative" />
            </span>
            <span>
              {{ $t('workers.expires') }}
              <NTime :time="new Date(enrollment.expiresAt)" type="relative" />
            </span>
            <span v-if="enrollment.consumedByWorkerId" class="worker-id">
              {{ $t('workers.consumedBy') }} {{ enrollment.consumedByWorkerId }}
            </span>
          </div>
        </div>
        <NButton
          v-if="canManage && enrollment.status === 'ACTIVE'"
          size="small"
          type="error"
          secondary
          :loading="busyEnrollmentId === enrollment.id"
          @click="$emit('revoke', enrollment)"
        >
          <template #icon><NIcon aria-hidden="true" :component="TrashOutline" /></template>
          {{ $t('workers.revokeAction') }}
        </NButton>
      </article>
    </div>

    <div v-if="hasMore" class="load-more">
      <NButton :loading="loadingMore" @click="$emit('loadMore')">
        {{ $t('workers.loadMore') }}
      </NButton>
    </div>
  </NCard>
</template>

<style scoped>
.enrollment-card {
  width: 100%;
}

.list-toolbar,
.section-heading,
.title-line,
.toolbar-actions,
.enrollment-row,
.row-title,
.row-meta {
  display: flex;
  align-items: center;
}

.list-toolbar {
  justify-content: space-between;
  gap: 24px;
}

.section-heading {
  align-items: flex-start;
  gap: 13px;
}

.section-icon,
.row-icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 9px;
  color: var(--bs-primary);
}

.section-icon {
  width: 40px;
  height: 40px;
  background: rgb(15 98 214 / 10%);
}

.title-line {
  gap: 8px;
}

.section-heading h2 {
  margin: 0;
  color: var(--bs-text);
  font-size: 17px;
  font-weight: 680;
}

.section-heading p {
  margin: 5px 0 0;
  color: var(--bs-text-muted);
  font-size: 13px;
  line-height: 1.55;
}

.toolbar-actions {
  flex: 0 0 auto;
  gap: 10px;
}

.status-filter {
  width: 148px;
  height: 34px;
  appearance: none;
  border: 1px solid var(--bs-border);
  border-radius: 6px;
  background-color: var(--bs-surface);
  background-image:
    linear-gradient(45deg, transparent 50%, var(--bs-text-muted) 50%),
    linear-gradient(135deg, var(--bs-text-muted) 50%, transparent 50%);
  background-position:
    calc(100% - 15px) 14px,
    calc(100% - 10px) 14px;
  background-repeat: no-repeat;
  background-size: 5px 5px;
  padding: 0 34px 0 11px;
  color: var(--bs-text);
  font: inherit;
  font-size: 13px;
  outline: none;
}

.status-filter:focus-visible {
  border-color: var(--bs-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--bs-primary) 22%, transparent);
}

.list-alert {
  margin-top: 20px;
}

.list-loading,
.list-empty {
  margin: 38px 0;
}

.list-loading {
  display: flex;
  min-height: 140px;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--bs-text-muted);
  font-size: 13px;
}

.enrollment-list {
  margin-top: 22px;
  border-top: 1px solid var(--bs-border);
}

.enrollment-row {
  min-height: 86px;
  gap: 13px;
  border-bottom: 1px solid var(--bs-border);
  padding: 14px 0;
}

.row-icon {
  width: 40px;
  height: 40px;
  background: var(--bs-canvas);
}

.row-main {
  min-width: 0;
  flex: 1;
}

.row-title {
  gap: 9px;
}

.row-title strong {
  overflow: hidden;
  color: var(--bs-text);
  font-size: 14px;
  font-weight: 660;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-meta {
  min-width: 0;
  flex-wrap: wrap;
  gap: 5px 16px;
  margin-top: 7px;
  color: var(--bs-text-muted);
  font-size: 11px;
}

.worker-id {
  max-width: 330px;
  overflow: hidden;
  font-family: var(--bs-font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.load-more {
  display: flex;
  justify-content: center;
  padding-top: 20px;
}

@media (max-width: 760px) {
  .list-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .toolbar-actions,
  .status-filter {
    width: 100%;
  }

  .toolbar-actions > :last-child {
    flex: 0 0 auto;
  }

  .enrollment-row {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .enrollment-row > :last-child:not(.row-main) {
    margin-left: 53px;
  }

  .row-main {
    min-width: calc(100% - 53px);
  }
}
</style>
