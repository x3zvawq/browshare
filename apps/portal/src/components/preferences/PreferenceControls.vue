<script setup lang="ts">
import { DesktopOutline, MoonOutline, SunnyOutline } from '@vicons/ionicons5'
import { NButton, NButtonGroup, NIcon } from 'naive-ui'
import { useI18n } from 'vue-i18n'

import { usePreferencesStore, type ThemeMode } from '@/stores/preferences.js'

const preferences = usePreferencesStore()
const { t } = useI18n()

function selectTheme(mode: ThemeMode): void {
  preferences.setThemeMode(mode)
}
</script>

<template>
  <div class="preference-controls" role="group" :aria-label="t('preferences.theme')">
    <NButtonGroup size="small">
      <NButton
        :type="preferences.mode === 'light' ? 'primary' : 'default'"
        :aria-label="t('preferences.light')"
        @click="selectTheme('light')"
      >
        <template #icon><NIcon aria-hidden="true" :component="SunnyOutline" /></template>
      </NButton>
      <NButton
        :type="preferences.mode === 'dark' ? 'primary' : 'default'"
        :aria-label="t('preferences.dark')"
        @click="selectTheme('dark')"
      >
        <template #icon><NIcon aria-hidden="true" :component="MoonOutline" /></template>
      </NButton>
      <NButton
        :type="preferences.mode === 'system' ? 'primary' : 'default'"
        :aria-label="t('preferences.system')"
        @click="selectTheme('system')"
      >
        <template #icon><NIcon aria-hidden="true" :component="DesktopOutline" /></template>
      </NButton>
    </NButtonGroup>
    <NButton
      size="small"
      quaternary
      @click="preferences.setLocale(preferences.locale === 'zh-CN' ? 'en-US' : 'zh-CN')"
    >
      {{ preferences.locale === 'zh-CN' ? 'EN' : '中文' }}
    </NButton>
  </div>
</template>

<style scoped>
.preference-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
