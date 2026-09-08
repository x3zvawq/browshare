<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import NavigationPolicyPanel from '@/components/navigation-policy/NavigationPolicyPanel.vue'
import { useSessionStore } from '@/stores/session.js'
const session = useSessionStore(),
  route = useRoute()
const id = computed(() => String(route.params.profileId))
const canManage = computed(() => session.user?.permissions.includes('profile.manage') ?? false)
</script>
<template>
  <NavigationPolicyPanel :key="id" :profile-id="id" :can-manage="canManage" embedded />
</template>
