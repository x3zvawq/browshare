<script setup lang="ts">
import { ArrowForwardOutline, BookOutline } from '@vicons/ionicons5'
import { NButton, NIcon, NTag } from 'naive-ui'
import { useI18n } from 'vue-i18n'

import PreferenceControls from '@/components/preferences/PreferenceControls.vue'

defineProps<{ version: string }>()

const { t } = useI18n()
</script>

<template>
  <section class="hero-panel">
    <div class="hero-topline">
      <NTag type="info" size="small" round :bordered="false">
        {{ t('foundation.badge') }} · v{{ version }}
      </NTag>
      <PreferenceControls />
    </div>

    <div class="hero-copy">
      <p class="eyebrow">BROWSHARE CONTROL PLANE</p>
      <h1 class="hero-title">{{ t('foundation.title') }}</h1>
      <p class="hero-description">{{ t('foundation.description') }}</p>
      <div class="hero-actions">
        <NButton type="primary" tag="a" href="/documentation" target="_blank">
          <template #icon><NIcon aria-hidden="true" :component="BookOutline" /></template>
          {{ t('foundation.inspectApi') }}
        </NButton>
        <NButton tag="a" href="/api/v1/version" target="_blank" secondary>
          {{ t('foundation.viewVersion') }}
          <template #icon><NIcon aria-hidden="true" :component="ArrowForwardOutline" /></template>
        </NButton>
      </div>
    </div>

    <div class="hero-orbit" aria-hidden="true">
      <div class="orbit-ring orbit-ring-outer"></div>
      <div class="orbit-ring orbit-ring-inner"></div>
      <img class="hero-mark" src="/browshare-icon.png" alt="" />
    </div>
  </section>
</template>

<style scoped>
.hero-panel {
  position: relative;
  min-height: 430px;
  overflow: hidden;
  border: 1px solid var(--bs-border);
  border-radius: 20px;
  background:
    radial-gradient(circle at 78% 20%, rgb(19 194 194 / 16%), transparent 30%),
    radial-gradient(circle at 12% 100%, rgb(15 98 214 / 14%), transparent 34%), var(--bs-surface);
  padding: 28px;
}

.hero-topline {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.hero-copy {
  position: relative;
  z-index: 2;
  max-width: 660px;
  padding-top: 80px;
}

.eyebrow {
  margin: 0 0 16px;
  color: var(--bs-primary);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.16em;
}

.hero-title {
  max-width: 640px;
  margin: 0;
  color: var(--bs-text);
  font-size: clamp(36px, 5vw, 64px);
  font-weight: 720;
  letter-spacing: -0.045em;
  line-height: 1.08;
}

.hero-description {
  max-width: 620px;
  margin: 24px 0 0;
  color: var(--bs-text-muted);
  font-size: 16px;
  line-height: 1.8;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 32px;
}

.hero-orbit {
  position: absolute;
  right: -40px;
  bottom: -80px;
  width: 360px;
  height: 360px;
  opacity: 0.9;
}

.orbit-ring {
  position: absolute;
  border: 1px solid rgb(15 98 214 / 18%);
  border-radius: 50%;
}

.orbit-ring-outer {
  inset: 0;
}

.orbit-ring-inner {
  inset: 58px;
  border-color: rgb(19 194 194 / 24%);
}

.hero-mark {
  position: absolute;
  inset: 110px;
  width: 140px;
  height: 140px;
  filter: drop-shadow(0 24px 40px rgb(15 98 214 / 24%));
}

@media (max-width: 760px) {
  .hero-panel {
    min-height: 560px;
    padding: 20px;
  }

  .hero-topline {
    align-items: flex-start;
    flex-direction: column;
  }

  .hero-copy {
    padding-top: 52px;
  }

  .hero-orbit {
    right: -100px;
    bottom: -170px;
  }
}
</style>
