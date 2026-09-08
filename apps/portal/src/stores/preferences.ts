import { defineStore } from 'pinia'
import { computed, shallowRef, watch } from 'vue'

import type { AppLocale } from '@/i18n.js'

export type ThemeMode = 'light' | 'dark' | 'system'

const THEME_STORAGE_KEY = 'browshare.theme'
const LOCALE_STORAGE_KEY = 'browshare.locale'

export const usePreferencesStore = defineStore('preferences', () => {
  const mode = shallowRef<ThemeMode>(readThemeMode())
  const locale = shallowRef<AppLocale>(readLocale())
  const systemDark = shallowRef(readSystemDark())

  const isDark = computed(
    () => mode.value === 'dark' || (mode.value === 'system' && systemDark.value),
  )

  if (typeof window !== 'undefined') {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', (event) => {
      systemDark.value = event.matches
    })
  }

  watch(
    mode,
    (value) => {
      if (typeof window !== 'undefined') window.localStorage.setItem(THEME_STORAGE_KEY, value)
    },
    { immediate: true },
  )
  watch(
    isDark,
    (value) => {
      if (typeof document !== 'undefined') {
        document.documentElement.dataset.theme = value ? 'dark' : 'light'
      }
    },
    { immediate: true },
  )
  watch(
    locale,
    (value) => {
      if (typeof window !== 'undefined') window.localStorage.setItem(LOCALE_STORAGE_KEY, value)
      if (typeof document !== 'undefined') document.documentElement.lang = value
    },
    { immediate: true },
  )

  function setThemeMode(value: ThemeMode): void {
    mode.value = value
  }

  function setLocale(value: AppLocale): void {
    locale.value = value
  }

  return { mode, locale, isDark, setThemeMode, setLocale }
})

function readThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system'
  const value = window.localStorage.getItem(THEME_STORAGE_KEY)
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
}

function readLocale(): AppLocale {
  if (typeof window === 'undefined') return 'zh-CN'
  const value = window.localStorage.getItem(LOCALE_STORAGE_KEY)
  if (value === 'en-US' || value === 'zh-CN') return value
  return window.navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
}

function readSystemDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}
