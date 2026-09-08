<script setup lang="ts">
import { AlertCircleOutline, AlbumsOutline, FlashOutline, PeopleOutline } from '@vicons/ionicons5'
import { NCard, NGrid, NGridItem, NIcon, NSkeleton, NTag } from 'naive-ui'
import { computed } from 'vue'

import type { ProfileListSummary } from '@/api/types.js'

const props = defineProps<{
  readonly summary: ProfileListSummary | null
  readonly loading: boolean
}>()

const activeRuntimes = computed(() => {
  if (props.summary === null) return 0
  return (
    props.summary.runtime.starting +
    props.summary.runtime.running +
    props.summary.runtime.maintaining +
    props.summary.runtime.stopping
  )
})

const attentionCount = computed(() => {
  if (props.summary === null) return 0
  return props.summary.runtime.error + props.summary.overLimitProfiles
})
</script>

<template>
  <NGrid class="summary-grid" cols="1 s:2 l:4" responsive="screen" :x-gap="14" :y-gap="14">
    <NGridItem>
      <NCard class="summary-card" size="small">
        <div class="summary-card-content">
          <div class="summary-icon summary-icon-blue">
            <NIcon aria-hidden="true" :component="AlbumsOutline" :size="21" />
          </div>
          <div class="summary-copy">
            <span>{{ $t('profiles.summary.total') }}</span>
            <NSkeleton v-if="summary === null && loading" text width="54px" />
            <strong v-else>{{ summary?.totalProfiles ?? '—' }}</strong>
            <small v-if="summary">
              {{
                $t('profiles.summary.enabledDisabled', {
                  enabled: summary.enabledProfiles,
                  disabled: summary.disabledProfiles,
                })
              }}
            </small>
          </div>
        </div>
      </NCard>
    </NGridItem>

    <NGridItem>
      <NCard class="summary-card" size="small">
        <div class="summary-card-content">
          <div class="summary-icon summary-icon-green">
            <NIcon aria-hidden="true" :component="FlashOutline" :size="21" />
          </div>
          <div class="summary-copy">
            <span>{{ $t('profiles.summary.activeRuntimes') }}</span>
            <NSkeleton v-if="summary === null && loading" text width="54px" />
            <strong v-else>{{ summary ? activeRuntimes : '—' }}</strong>
            <small v-if="summary">
              {{
                $t('profiles.summary.runtimeBreakdown', {
                  running: summary.runtime.running,
                  maintaining: summary.runtime.maintaining,
                })
              }}
            </small>
          </div>
        </div>
      </NCard>
    </NGridItem>

    <NGridItem>
      <NCard class="summary-card" size="small">
        <div class="summary-card-content">
          <div class="summary-icon summary-icon-violet">
            <NIcon aria-hidden="true" :component="PeopleOutline" :size="21" />
          </div>
          <div class="summary-copy">
            <span>{{ $t('profiles.summary.activeSessions') }}</span>
            <NSkeleton v-if="summary === null && loading" text width="54px" />
            <strong v-else>{{ summary?.activeSessions ?? '—' }}</strong>
            <small v-if="summary">
              {{
                $t('profiles.summary.capacityBreakdown', {
                  available: summary.availableSessions,
                  unlimited: summary.unlimitedProfiles,
                })
              }}
            </small>
          </div>
        </div>
      </NCard>
    </NGridItem>

    <NGridItem>
      <NCard class="summary-card" size="small">
        <div class="summary-card-content">
          <div
            class="summary-icon"
            :class="attentionCount > 0 ? 'summary-icon-red' : 'summary-icon-muted'"
          >
            <NIcon aria-hidden="true" :component="AlertCircleOutline" :size="21" />
          </div>
          <div class="summary-copy">
            <span>{{ $t('profiles.summary.attention') }}</span>
            <NSkeleton v-if="summary === null && loading" text width="54px" />
            <strong v-else>{{ summary ? attentionCount : '—' }}</strong>
            <small v-if="summary" class="attention-detail">
              {{
                $t('profiles.summary.attentionBreakdown', {
                  errors: summary.runtime.error,
                  overLimit: summary.overLimitProfiles,
                })
              }}
            </small>
          </div>
          <NTag
            v-if="summary && attentionCount === 0"
            size="small"
            round
            :bordered="false"
            type="success"
          >
            {{ $t('profiles.summary.healthy') }}
          </NTag>
        </div>
      </NCard>
    </NGridItem>
  </NGrid>
</template>

<style scoped>
.summary-grid {
  margin-bottom: 18px;
}

.summary-card {
  height: 100%;
}

.summary-card-content {
  display: flex;
  min-height: 80px;
  align-items: center;
  gap: 13px;
}

.summary-icon {
  display: grid;
  width: 42px;
  height: 42px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 11px;
}

.summary-icon-blue {
  background: rgb(15 98 214 / 10%);
  color: var(--bs-primary);
}

.summary-icon-green {
  background: rgb(24 160 88 / 11%);
  color: #17834b;
}

.summary-icon-violet {
  background: rgb(113 77 190 / 11%);
  color: #714dbe;
}

.summary-icon-red {
  background: rgb(208 48 80 / 10%);
  color: #d03050;
}

.summary-icon-muted {
  background: var(--bs-canvas);
  color: var(--bs-text-muted);
}

.summary-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}

.summary-copy > span {
  color: var(--bs-text-muted);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.02em;
}

.summary-copy > strong {
  margin-top: 2px;
  color: var(--bs-text);
  font-size: 24px;
  font-variant-numeric: tabular-nums;
  line-height: 1.15;
}

.summary-copy > small {
  margin-top: 4px;
  color: var(--bs-text-muted);
  font-size: 10px;
  line-height: 1.35;
}
</style>
