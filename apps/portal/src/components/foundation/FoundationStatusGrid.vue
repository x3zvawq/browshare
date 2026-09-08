<script setup lang="ts">
import {
  CodeSlashOutline,
  GitNetworkOutline,
  PulseOutline,
  ShieldCheckmarkOutline,
} from '@vicons/ionicons5'
import { NCard, NIcon } from 'naive-ui'
import { computed, type Component } from 'vue'
import { useI18n } from 'vue-i18n'

interface StatusItem {
  readonly icon: Component
  readonly title: string
  readonly description: string
  readonly accent: string
}

const { t } = useI18n()

const items = computed<readonly StatusItem[]>(() => [
  {
    icon: GitNetworkOutline,
    title: t('foundation.architecture'),
    description: t('foundation.architectureDescription'),
    accent: 'cyan',
  },
  {
    icon: CodeSlashOutline,
    title: t('foundation.api'),
    description: t('foundation.apiDescription'),
    accent: 'blue',
  },
  {
    icon: ShieldCheckmarkOutline,
    title: t('foundation.configuration'),
    description: t('foundation.configurationDescription'),
    accent: 'green',
  },
  {
    icon: PulseOutline,
    title: t('foundation.runtime'),
    description: t('foundation.runtimeDescription'),
    accent: 'coral',
  },
])
</script>

<template>
  <section class="status-grid">
    <NCard v-for="item in items" :key="item.title" class="status-card" :bordered="true">
      <div class="status-icon" :data-accent="item.accent">
        <NIcon aria-hidden="true" :component="item.icon" :size="22" />
      </div>
      <h2 class="status-title">{{ item.title }}</h2>
      <p class="status-description">{{ item.description }}</p>
    </NCard>
  </section>
</template>

<style scoped>
.status-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.status-card {
  min-height: 184px;
  transition:
    border-color 160ms ease,
    transform 160ms ease;
}

.status-card:hover {
  border-color: rgb(15 98 214 / 36%);
  transform: translateY(-2px);
}

.status-icon {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border-radius: 10px;
  background: rgb(15 98 214 / 10%);
  color: var(--bs-primary);
}

.status-icon[data-accent='cyan'] {
  background: rgb(19 194 194 / 12%);
  color: #0e9f9f;
}

.status-icon[data-accent='green'] {
  background: rgb(24 160 88 / 12%);
  color: #18a058;
}

.status-icon[data-accent='coral'] {
  background: rgb(255 107 107 / 12%);
  color: #e95858;
}

.status-title {
  margin: 22px 0 8px;
  color: var(--bs-text);
  font-size: 16px;
  font-weight: 650;
}

.status-description {
  margin: 0;
  color: var(--bs-text-muted);
  font-size: 13px;
  line-height: 1.7;
}

@media (max-width: 980px) {
  .status-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 560px) {
  .status-grid {
    grid-template-columns: 1fr;
  }
}
</style>
