<script setup lang="ts">
import { ArrowForwardOutline } from '@vicons/ionicons5'
import { NIcon, NTag } from 'naive-ui'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <section class="architecture-panel">
    <div class="architecture-copy">
      <p class="section-label">ARCHITECTURE</p>
      <h2 class="section-title">{{ t('foundation.architecture') }}</h2>
      <p class="section-description">{{ t('foundation.architectureDescription') }}</p>
      <div class="next-step">
        <NTag type="success" :bordered="false" round>{{ t('foundation.nextLabel') }}</NTag>
        <span class="next-copy">{{ t('foundation.next') }}</span>
      </div>
    </div>

    <div class="architecture-flow" aria-label="BrowShare runtime flow">
      <div class="flow-node flow-node-primary">
        <span class="flow-kicker">REST · SSE</span>
        <strong>{{ t('foundation.controlPlane') }}</strong>
      </div>
      <NIcon class="flow-arrow" aria-hidden="true" :component="ArrowForwardOutline" :size="22" />
      <div class="flow-node">
        <span class="flow-kicker">WSS · mTLS</span>
        <strong>{{ t('foundation.worker') }}</strong>
      </div>
      <NIcon class="flow-arrow" aria-hidden="true" :component="ArrowForwardOutline" :size="22" />
      <div class="flow-node flow-node-accent">
        <span class="flow-kicker">WebRTC · CDP</span>
        <strong>{{ t('foundation.remoteTab') }}</strong>
      </div>
    </div>
  </section>
</template>

<style scoped>
.architecture-panel {
  display: grid;
  grid-template-columns: minmax(260px, 0.8fr) minmax(480px, 1.4fr);
  gap: 40px;
  align-items: center;
  border: 1px solid var(--bs-border);
  border-radius: 14px;
  background: var(--bs-surface);
  padding: 28px;
}

.section-label {
  margin: 0 0 10px;
  color: var(--bs-primary);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
}

.section-title {
  margin: 0;
  color: var(--bs-text);
  font-size: 24px;
  font-weight: 680;
}

.section-description {
  margin: 12px 0 18px;
  color: var(--bs-text-muted);
  line-height: 1.7;
}

.next-step {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: 8px;
}

.next-copy {
  min-width: 0;
  color: var(--bs-text-muted);
  font-size: 13px;
  line-height: 1.6;
}

.architecture-flow {
  display: grid;
  grid-template-columns: 1fr auto 1fr auto 1fr;
  gap: 12px;
  align-items: center;
}

.flow-node {
  display: flex;
  min-height: 108px;
  flex-direction: column;
  justify-content: center;
  border: 1px solid var(--bs-border);
  border-radius: 10px;
  background: var(--bs-canvas);
  padding: 18px;
  color: var(--bs-text);
}

.flow-node-primary {
  border-color: rgb(15 98 214 / 30%);
  background: rgb(15 98 214 / 8%);
}

.flow-node-accent {
  border-color: rgb(255 107 107 / 28%);
  background: rgb(255 107 107 / 8%);
}

.flow-kicker {
  margin-bottom: 8px;
  color: var(--bs-text-muted);
  font-family: var(--bs-font-mono);
  font-size: 11px;
}

.flow-arrow {
  color: var(--bs-text-muted);
}

@media (max-width: 900px) {
  .architecture-panel {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 620px) {
  .architecture-flow {
    grid-template-columns: 1fr;
  }

  .flow-arrow {
    margin: 0 auto;
    transform: rotate(90deg);
  }
}
</style>
