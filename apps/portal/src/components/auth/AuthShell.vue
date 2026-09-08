<script setup lang="ts">
import PreferenceControls from '@/components/preferences/PreferenceControls.vue'

defineProps<{
  readonly eyebrow: string
  readonly title: string
  readonly description: string
}>()
</script>

<template>
  <main class="auth-page">
    <header class="auth-header">
      <RouterLink class="brand" to="/about" aria-label="BrowShare">
        <img class="brand-mark" src="/browshare-icon.svg" alt="" />
        <span>BrowShare</span>
      </RouterLink>
      <PreferenceControls />
    </header>

    <section class="auth-stage">
      <div class="auth-context" aria-hidden="true">
        <div class="context-mark">
          <img src="/browshare-icon.svg" alt="" />
        </div>
        <p class="context-kicker">REMOTE BROWSER WORKSPACE</p>
        <p class="context-title">BrowShare</p>
        <p class="context-copy">
          {{ $t('auth.context') }}
        </p>
        <div class="context-line"><span></span><span></span><span></span></div>
      </div>

      <div class="auth-card">
        <p class="auth-eyebrow">{{ eyebrow }}</p>
        <h1 class="auth-title">{{ title }}</h1>
        <p class="auth-description">{{ description }}</p>
        <slot />
        <div v-if="$slots.footer" class="auth-footer">
          <slot name="footer" />
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.auth-page {
  min-height: 100vh;
  background:
    radial-gradient(circle at 18% 86%, rgb(15 98 214 / 12%), transparent 32%),
    radial-gradient(circle at 86% 14%, rgb(19 194 194 / 10%), transparent 26%), var(--bs-canvas);
  padding: 24px 32px 40px;
}

.auth-header {
  display: flex;
  max-width: 1240px;
  margin: 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--bs-text);
  font-size: 16px;
  font-weight: 700;
  text-decoration: none;
}

.brand-mark {
  width: 34px;
  height: 34px;
}

.auth-stage {
  display: grid;
  max-width: 1080px;
  min-height: calc(100vh - 112px);
  margin: 0 auto;
  grid-template-columns: minmax(0, 1fr) minmax(380px, 440px);
  align-items: center;
  gap: 88px;
}

.auth-context {
  max-width: 470px;
}

.context-mark {
  display: grid;
  width: 92px;
  height: 92px;
  margin-bottom: 30px;
  place-items: center;
}

.context-mark img {
  width: 84px;
  height: 84px;
}

.context-kicker,
.auth-eyebrow {
  margin: 0;
  color: var(--bs-primary);
  font-size: 11px;
  font-weight: 750;
  letter-spacing: 0.16em;
}

.context-title {
  margin: 12px 0 14px;
  color: var(--bs-text);
  font-size: clamp(42px, 7vw, 68px);
  font-weight: 740;
  letter-spacing: -0.05em;
  line-height: 1;
}

.context-copy {
  max-width: 430px;
  margin: 0;
  color: var(--bs-text-muted);
  font-size: 16px;
  line-height: 1.75;
}

.context-line {
  display: flex;
  width: 184px;
  margin-top: 34px;
  gap: 7px;
}

.context-line span {
  height: 3px;
  flex: 1;
  border-radius: 999px;
  background: var(--bs-border);
}

.context-line span:first-child {
  flex: 2;
  background: var(--bs-primary);
}

.context-line span:last-child {
  background: #13c2c2;
}

.auth-card {
  border: 1px solid var(--bs-border);
  border-radius: 14px;
  background: var(--bs-surface);
  padding: 32px;
  box-shadow: 0 24px 70px rgb(23 32 51 / 8%);
}

.auth-title {
  margin: 10px 0 8px;
  color: var(--bs-text);
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.025em;
}

.auth-description {
  margin: 0 0 26px;
  color: var(--bs-text-muted);
  font-size: 14px;
  line-height: 1.65;
}

.auth-footer {
  margin-top: 22px;
  padding-top: 20px;
  border-top: 1px solid var(--bs-border);
  color: var(--bs-text-muted);
  font-size: 13px;
  text-align: center;
}

@media (max-width: 860px) {
  .auth-stage {
    max-width: 460px;
    grid-template-columns: 1fr;
    gap: 32px;
    padding-top: 52px;
  }

  .auth-context {
    display: none;
  }
}

@media (max-width: 560px) {
  .auth-page {
    padding: 16px;
  }

  .auth-header {
    align-items: flex-start;
  }

  .auth-card {
    padding: 24px 20px;
  }
}
</style>
