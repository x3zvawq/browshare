<script setup lang="ts">
import FoundationArchitecture from '@/components/foundation/FoundationArchitecture.vue'
import FoundationHero from '@/components/foundation/FoundationHero.vue'
import FoundationStatusGrid from '@/components/foundation/FoundationStatusGrid.vue'

const version = __BROWSHARE_VERSION__
</script>

<template>
  <main class="foundation-page">
    <div class="foundation-content">
      <FoundationHero :version="version" />
      <FoundationStatusGrid />
      <FoundationArchitecture />
    </div>
  </main>
</template>

<style scoped>
.foundation-page {
  min-height: 100vh;
  background: var(--bs-canvas);
  padding: 28px;
}

.foundation-content {
  display: grid;
  max-width: 1320px;
  margin: 0 auto;
  gap: 20px;
}

@media (max-width: 760px) {
  .foundation-page {
    padding: 14px;
  }
}
</style>
