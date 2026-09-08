<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import PageScriptPanel from '@/components/page-script/PageScriptPanel.vue'
import { useSessionStore } from '@/stores/session.js'
const session = useSessionStore(),
  route = useRoute()
const id = computed(() => String(route.params.profileId))
const canManage = computed(() => session.user?.permissions.includes('profile.manage') ?? false)
const canMaintain = computed(() => session.user?.permissions.includes('profile.maintain') ?? false)
</script>
<template>
  <PageScriptPanel
    :key="id"
    :profile-id="id"
    :can-manage="canManage"
    :can-maintain="canMaintain"
    embedded
  />
</template>
