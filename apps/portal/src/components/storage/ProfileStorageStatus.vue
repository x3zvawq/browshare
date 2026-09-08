<script setup lang="ts">
import type { ProfileStorageSummary } from '@/api/types.js'
import StoragePolicySummary from './StoragePolicySummary.vue'
import StorageBlockNotice from './StorageBlockNotice.vue'
defineProps<{ profile: ProfileStorageSummary; compact?: boolean }>()
</script>
<template>
  <div class="profile-storage-status">
    <StoragePolicySummary
      :quota-bytes="profile.storageQuotaBytes"
      :policy-version="profile.storagePolicyVersion"
      :pending="profile.storagePolicyPending"
      :fact="profile.storageUsage"
      :compact="compact"
    />
    <StorageBlockNotice :reason="profile.storageBlockedReason" :compact="compact" />
  </div>
</template>
