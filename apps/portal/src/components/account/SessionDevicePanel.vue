<script setup lang="ts">
import {
  LaptopOutline,
  PhonePortraitOutline,
  RefreshOutline,
  TrashOutline,
} from '@vicons/ionicons5'
import { NAlert, NButton, NCard, NEmpty, NIcon, NSpin, NTag, NTime, NTooltip } from 'naive-ui'
import { computed } from 'vue'

import type { PortalSessionDevice } from '@/api/types.js'

const props = defineProps<{
  readonly items: readonly PortalSessionDevice[]
  readonly loading: boolean
  readonly busySessionId: string | undefined
  readonly revokingAll: boolean
  readonly error: string | undefined
}>()

defineEmits<{
  refresh: []
  revoke: [device: PortalSessionDevice]
  revokeAll: []
}>()

const currentCount = computed(() => props.items.filter((item) => item.current).length)

function isMobile(device: PortalSessionDevice): boolean {
  return /Android|iPhone|iPad|Mobile/iu.test(device.userAgentSummary ?? '')
}

function deviceLabel(device: PortalSessionDevice): string {
  return device.deviceName ?? device.userAgentSummary ?? 'Unknown device'
}
</script>

<template>
  <NCard class="security-card" :bordered="true">
    <div class="section-heading-row">
      <div class="section-heading">
        <div class="section-icon">
          <NIcon aria-hidden="true" :component="LaptopOutline" :size="21" />
        </div>
        <div>
          <div class="title-line">
            <h2>{{ $t('account.devicesTitle') }}</h2>
            <NTag v-if="items.length" size="small" round :bordered="false">{{ items.length }}</NTag>
          </div>
          <p>{{ $t('account.devicesDescription') }}</p>
        </div>
      </div>
      <NTooltip>
        <template #trigger>
          <NButton
            quaternary
            circle
            :loading="loading"
            :aria-label="$t('common.refresh')"
            @click="$emit('refresh')"
          >
            <template #icon><NIcon aria-hidden="true" :component="RefreshOutline" /></template>
          </NButton>
        </template>
        {{ $t('common.refresh') }}
      </NTooltip>
    </div>

    <NAlert v-if="error" class="device-alert" type="error" :title="error">
      <NButton text type="primary" @click="$emit('refresh')">{{ $t('common.retry') }}</NButton>
    </NAlert>

    <div v-if="loading && items.length === 0" class="device-loading">
      <NSpin size="small" />
      <span>{{ $t('account.loadingDevices') }}</span>
    </div>
    <NEmpty
      v-else-if="items.length === 0"
      class="device-empty"
      :description="$t('account.noDevices')"
    />
    <div v-else class="device-list">
      <article v-for="device in items" :key="device.id" class="device-row">
        <div class="device-icon">
          <NIcon
            aria-hidden="true"
            :component="isMobile(device) ? PhonePortraitOutline : LaptopOutline"
            :size="21"
          />
        </div>
        <div class="device-copy">
          <div class="device-title">
            <strong>{{ deviceLabel(device) }}</strong>
            <NTag v-if="device.current" size="small" round :bordered="false" type="success">
              {{ $t('account.currentDevice') }}
            </NTag>
          </div>
          <p>
            {{ $t('account.lastActive') }}
            <NTime :time="new Date(device.lastSeenAt)" type="relative" />
            <span class="dot">·</span>
            {{ $t('account.expires') }}
            <NTime :time="new Date(device.expiresAt)" type="relative" />
          </p>
        </div>
        <NButton
          size="small"
          :type="device.current ? 'error' : 'default'"
          :secondary="device.current"
          :loading="busySessionId === device.id"
          @click="$emit('revoke', device)"
        >
          <template #icon><NIcon aria-hidden="true" :component="TrashOutline" /></template>
          {{ device.current ? $t('account.signOutHere') : $t('account.revokeDevice') }}
        </NButton>
      </article>
    </div>

    <div v-if="items.length > currentCount" class="device-footer">
      <p>{{ $t('account.revokeAllDescription') }}</p>
      <NButton type="error" secondary :loading="revokingAll" @click="$emit('revokeAll')">
        {{ $t('account.revokeAllAction') }}
      </NButton>
    </div>
  </NCard>
</template>

<style scoped>
.security-card {
  height: 100%;
}

.section-heading-row,
.section-heading,
.title-line,
.device-row,
.device-title,
.device-footer {
  display: flex;
  align-items: center;
}

.section-heading-row,
.device-footer {
  justify-content: space-between;
}

.section-heading {
  align-items: flex-start;
  gap: 13px;
}

.section-icon,
.device-icon {
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

.section-heading p,
.device-footer p {
  margin: 5px 0 0;
  color: var(--bs-text-muted);
  font-size: 13px;
  line-height: 1.55;
}

.device-alert {
  margin-top: 20px;
}

.device-loading,
.device-empty {
  margin: 34px 0;
}

.device-loading {
  display: flex;
  min-height: 110px;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--bs-text-muted);
  font-size: 13px;
}

.device-list {
  margin-top: 22px;
  border-top: 1px solid var(--bs-border);
}

.device-row {
  gap: 12px;
  min-height: 82px;
  border-bottom: 1px solid var(--bs-border);
  padding: 13px 0;
}

.device-icon {
  width: 38px;
  height: 38px;
  background: var(--bs-canvas);
}

.device-copy {
  min-width: 0;
  flex: 1;
}

.device-title {
  min-width: 0;
  gap: 8px;
}

.device-title strong {
  overflow: hidden;
  color: var(--bs-text);
  font-size: 13px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.device-copy p {
  margin: 5px 0 0;
  color: var(--bs-text-muted);
  font-size: 11px;
}

.dot {
  margin: 0 4px;
}

.device-footer {
  align-items: flex-start;
  gap: 24px;
  margin-top: 20px;
  border-radius: 8px;
  background: rgb(208 48 80 / 6%);
  padding: 14px;
}

.device-footer p {
  max-width: 520px;
  margin: 0;
}

@media (max-width: 640px) {
  .device-row {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .device-row > :last-child {
    margin-left: 50px;
  }

  .device-footer {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
