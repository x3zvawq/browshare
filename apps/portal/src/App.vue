<script setup lang="ts">
import { storeToRefs } from 'pinia'
import {
  darkTheme,
  dateEnUS,
  dateZhCN,
  enUS,
  NConfigProvider,
  NDialogProvider,
  NGlobalStyle,
  NLoadingBarProvider,
  NMessageProvider,
  NNotificationProvider,
  NSpin,
  zhCN,
} from 'naive-ui'
import { computed, watch } from 'vue'
import { RouterView } from 'vue-router'
import { useI18n } from 'vue-i18n'

import { i18n } from '@/i18n.js'
import { usePreferencesStore } from '@/stores/preferences.js'
import { darkThemeOverrides, lightThemeOverrides } from '@/theme.js'
import { portalStatusMessages } from '@/components/status/messages.js'

const preferences = usePreferencesStore()
const { t } = useI18n({ messages: portalStatusMessages })
const { isDark, locale } = storeToRefs(preferences)

const naiveLocale = computed(() => (locale.value === 'zh-CN' ? zhCN : enUS))
const naiveDateLocale = computed(() => (locale.value === 'zh-CN' ? dateZhCN : dateEnUS))
const themeOverrides = computed(() => (isDark.value ? darkThemeOverrides : lightThemeOverrides))

watch(
  locale,
  (value) => {
    i18n.global.locale.value = value
  },
  { immediate: true },
)
</script>

<template>
  <NConfigProvider
    :theme="isDark ? darkTheme : null"
    :theme-overrides="themeOverrides"
    :locale="naiveLocale"
    :date-locale="naiveDateLocale"
  >
    <NGlobalStyle />
    <NLoadingBarProvider>
      <NDialogProvider>
        <NNotificationProvider>
          <NMessageProvider>
            <RouterView v-slot="{ Component }">
              <component :is="Component" v-if="Component" />
              <div v-else class="initial-loading" role="status">
                <NSpin size="small" />
                <span>{{ t('routeFailure.loading') }}</span>
              </div>
            </RouterView>
          </NMessageProvider>
        </NNotificationProvider>
      </NDialogProvider>
    </NLoadingBarProvider>
  </NConfigProvider>
</template>

<style scoped>
.initial-loading {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--bs-text-muted);
  background: var(--bs-canvas);
}
</style>
