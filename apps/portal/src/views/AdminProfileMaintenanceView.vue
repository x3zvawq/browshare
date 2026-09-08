<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { NAlert } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import MaintenancePanel from '@/components/maintenance/MaintenancePanel.vue'
import { useSessionStore } from '@/stores/session.js'
import { profileDetailMessages } from '@/components/profiles/detail-messages.js'
const route = useRoute(),
  session = useSessionStore()
const { t } = useI18n({ messages: profileDetailMessages })
const id = computed(() => String(route.params.profileId))
const allowed = computed(() => session.user?.permissions.includes('profile.maintain') ?? false)
</script>
<template>
  <MaintenancePanel v-if="allowed" :key="id" :profile-id="id" embedded />
  <NAlert v-else type="info">{{ t('profileDetail.maintenancePermission') }}</NAlert>
</template>
