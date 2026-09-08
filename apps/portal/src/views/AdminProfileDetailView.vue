<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { NButton, NSkeleton, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import AppShell from '@/components/layout/AppShell.vue'
import LiveUpdateStatus from '@/components/status/LiveUpdateStatus.vue'
import RequestError from '@/components/workspace/RequestError.vue'
import ProfileManagementController from '@/components/profiles/ProfileManagementController.vue'
import ProfileDetailHeader from '@/components/profiles/ProfileDetailHeader.vue'
import ProfileActions from '@/components/profiles/ProfileActions.vue'
import { profileDetailMessages } from '@/components/profiles/detail-messages.js'
import { useProfileDetail } from '@/components/profiles/useProfileDetail.js'
import { useSessionStore } from '@/stores/session.js'
const route = useRoute(),
  router = useRouter(),
  session = useSessionStore(),
  message = useMessage()
const { t } = useI18n({ messages: profileDetailMessages })
const loggingOut = shallowRef(false)
const id = computed(() => String(route.params.profileId))
const canManage = computed(() => session.user?.permissions.includes('profile.manage') ?? false)
const { profile, error, loading, refresh, liveState, lastReadAt, refreshLive } = useProfileDetail(
  () => id.value,
)
const tabs = computed(() => [
  { name: 'admin-profile-maintenance', label: t('maintenance.title') },
  { name: 'admin-page-script', label: t('pageScript.title') },
  { name: 'admin-navigation-policy', label: t('navigationPolicy.title') },
])
async function logout() {
  loggingOut.value = true
  try {
    await session.logout()
  } catch {
    message.warning(t('auth.logoutLocalOnly'))
  } finally {
    loggingOut.value = false
    await router.replace({ name: 'login', query: { reason: 'signed-out' } })
  }
}
</script>
<template>
  <AppShell
    v-if="session.user"
    :user="session.user"
    :busy="loggingOut"
    :breadcrumb-group="t('layout.administrationGroup')"
    :breadcrumb-title="t('profileDetail.title')"
    @logout="logout"
  >
    <section class="profile-detail">
      <RouterLink :to="{ name: 'admin-profiles' }">← {{ t('profileDetail.back') }}</RouterLink>
      <RequestError v-if="error" :error="error" />
      <NSkeleton v-if="loading && !profile" height="180px" />
      <p v-else-if="error?.status === 404">{{ t('profileDetail.noProfile') }}</p>
      <NButton v-if="error" :loading="loading" @click="refresh">{{ t('common.retry') }}</NButton>
      <template v-if="profile">
        <ProfileManagementController
          :key="profile.id"
          v-slot="{
            openEdit,
            openGrants,
            setRuntime,
            recoverRuntime,
            toggleState,
            openDeletion,
            busyProfileId,
            runtimePending,
          }"
          :refresh="refresh"
        >
          <ProfileDetailHeader :profile="profile">
            <ProfileActions
              v-if="canManage"
              :profile="profile"
              :busy="busyProfileId === profile.id"
              :runtime-busy="runtimePending.has(profile.id)"
              @edit="openEdit"
              @grants="openGrants"
              @set-runtime="setRuntime"
              @recover-runtime="recoverRuntime"
              @toggle-state="toggleState"
              @delete="openDeletion"
            />
          </ProfileDetailHeader>
        </ProfileManagementController>
        <LiveUpdateStatus
          :state="liveState"
          :last-read-at="lastReadAt"
          :busy="loading"
          @refresh="refreshLive"
        />
        <nav class="profile-tabs" :aria-label="t('profileDetail.title')">
          <RouterLink
            v-for="item in tabs"
            :key="item.name"
            :to="{ name: item.name, params: { profileId: id } }"
            >{{ item.label }}</RouterLink
          >
        </nav>
        <RouterView :key="id" />
      </template>
    </section>
  </AppShell>
</template>
<style scoped>
.profile-detail {
  display: grid;
  gap: 16px;
  max-width: 1440px;
  min-width: 0;
  margin: auto;
}
.profile-tabs {
  display: flex;
  flex-wrap: wrap;
  column-gap: 20px;
  border-bottom: 1px solid var(--bs-border);
}
.profile-tabs a {
  padding: 12px 2px;
  white-space: nowrap;
  border-bottom: 2px solid transparent;
  color: var(--bs-text-muted);
}
.profile-tabs a.router-link-exact-active {
  border-bottom-color: var(--bs-primary);
  color: var(--bs-primary);
  font-weight: 650;
}
.profile-tabs a:focus-visible {
  outline: 2px solid var(--bs-primary);
  outline-offset: -2px;
}
.profile-detail > * {
  min-width: 0;
}
</style>
