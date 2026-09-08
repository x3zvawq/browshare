<script setup lang="ts">
import { useRoute } from 'vue-router'
import SessionViewerPanel from '@/components/viewer/SessionViewerPanel.vue'
const route = useRoute()
</script>
<template>
  <SessionViewerPanel :id="String(route.params.id)" :key="String(route.params.id)" />
</template>
