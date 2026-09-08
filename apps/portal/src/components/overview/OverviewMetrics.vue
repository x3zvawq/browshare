<script setup lang="ts">
import { useI18n } from 'vue-i18n'
defineProps<{
  items: readonly { key: string; label: string; value: number }[]
  compact?: boolean
}>()
const { locale } = useI18n()
</script>
<template>
  <dl class="overview-metrics" :class="{ compact }">
    <div v-for="item in items" :key="item.key" class="overview-metric" :data-metric="item.key">
      <dt>{{ item.label }}</dt>
      <dd>{{ item.value.toLocaleString(locale) }}</dd>
    </div>
  </dl>
</template>
<style scoped>
.overview-metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 140px), 1fr));
  gap: 14px;
  margin: 0;
}
.overview-metric {
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--bs-border);
  border-radius: 8px;
  background: var(--bs-canvas);
}
dt {
  color: var(--bs-text-muted);
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
dd {
  margin: 8px 0 0;
  color: var(--bs-text);
  font-size: 28px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
  overflow-wrap: anywhere;
}
.compact {
  gap: 8px;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 120px), 1fr));
}
.compact .overview-metric {
  padding: 10px 12px;
  background: var(--bs-surface);
}
.compact dd {
  font-size: 19px;
  margin-top: 4px;
}
</style>
