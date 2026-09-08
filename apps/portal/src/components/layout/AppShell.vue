<script setup lang="ts">
import {
  SettingsOutline,
  GridOutline,
  BuildOutline,
  AlbumsOutline,
  GitNetworkOutline,
  InformationCircleOutline,
  LogOutOutline,
  MenuOutline,
  ServerOutline,
  ShieldCheckmarkOutline,
} from '@vicons/ionicons5'
import { NAvatar, NButton, NDrawer, NDrawerContent, NIcon, NTag } from 'naive-ui'
import { computed, shallowRef, type Component } from 'vue'

import type { AuthSession } from '@/api/types.js'
import PreferenceControls from '@/components/preferences/PreferenceControls.vue'

const props = defineProps<{
  readonly user: AuthSession['user']
  readonly busy: boolean
  readonly breadcrumbGroup: string
  readonly breadcrumbTitle: string
}>()

const emit = defineEmits<{ logout: [] }>()

const mobileNavigationOpen = shallowRef(false)
const initials = computed(() => props.user.displayName.trim().slice(0, 2).toUpperCase())

interface NavigationItem {
  readonly label: string
  readonly to: string
  readonly icon: Component
}

interface NavigationGroup {
  readonly label: string
  readonly items: readonly NavigationItem[]
}

const navigationGroups = computed<readonly NavigationGroup[]>(() => {
  const groups: NavigationGroup[] = [
    {
      label: 'layout.accountGroup',
      items: [
        {
          label: 'layout.security',
          to: '/account/security',
          icon: ShieldCheckmarkOutline,
        },
      ],
    },
  ]
  if (
    props.user.permissions.includes('session.use') ||
    props.user.permissions.includes('profile.maintain')
  ) {
    const items: NavigationItem[] = []
    if (props.user.permissions.includes('session.use'))
      items.push({ label: 'workspace.title', to: '/workspace', icon: AlbumsOutline })
    if (props.user.permissions.includes('profile.maintain'))
      items.push({ label: 'maintenance.title', to: '/maintenance', icon: BuildOutline })
    items.push({ label: 'workspace.mySessions', to: '/sessions', icon: ServerOutline })
    groups.unshift({ label: 'workspace.useGroup', items })
  }
  if (
    props.user.permissions.includes('system.manage') ||
    props.user.permissions.includes('user.read') ||
    props.user.permissions.includes('profile.read') ||
    props.user.permissions.includes('proxy.read') ||
    props.user.permissions.includes('worker.read') ||
    props.user.permissions.includes('audit.read')
  ) {
    const administrationItems: NavigationItem[] = []
    if (
      props.user.permissions.includes('worker.read') ||
      props.user.permissions.includes('profile.read')
    )
      administrationItems.push({
        label: 'overview.title',
        to: '/admin/overview',
        icon: GridOutline,
      })
    if (props.user.permissions.includes('audit.read'))
      administrationItems.push({
        label: 'audit.title',
        to: '/admin/audit',
        icon: ShieldCheckmarkOutline,
      })
    if (props.user.permissions.includes('system.manage'))
      administrationItems.push({
        label: 'settings.title',
        to: '/admin/settings',
        icon: SettingsOutline,
      })
    if (props.user.permissions.includes('user.read'))
      administrationItems.push({
        label: 'users.title',
        to: '/admin/users',
        icon: ShieldCheckmarkOutline,
      })
    if (props.user.permissions.includes('profile.read')) {
      administrationItems.push({
        label: 'adminSessions.title',
        to: '/admin/sessions',
        icon: ServerOutline,
      })
      administrationItems.push({
        label: 'sessionPolicies.title',
        to: '/admin/session-policies',
        icon: ShieldCheckmarkOutline,
      })
      administrationItems.push({
        label: 'profileGroups.title',
        to: '/admin/profile-groups',
        icon: AlbumsOutline,
      })
      administrationItems.push({
        label: 'layout.profiles',
        to: '/admin/profiles',
        icon: AlbumsOutline,
      })
    }
    if (props.user.permissions.includes('proxy.read')) {
      administrationItems.push({
        label: 'layout.proxies',
        to: '/admin/proxies',
        icon: GitNetworkOutline,
      })
    }
    if (props.user.permissions.includes('worker.read')) {
      administrationItems.push({
        label: 'workerManagement.title',
        to: '/admin/workers',
        icon: ServerOutline,
      })
    }
    groups.push({
      label: 'layout.administrationGroup',
      items: administrationItems,
    })
  }
  groups.push({
    label: 'layout.productGroup',
    items: [
      {
        label: 'layout.about',
        to: '/about',
        icon: InformationCircleOutline,
      },
    ],
  })
  return groups
})

function logoutFromDrawer(): void {
  mobileNavigationOpen.value = false
  emit('logout')
}
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <RouterLink class="brand" to="/account/security">
        <img class="brand-mark" src="/browshare-icon.svg" alt="" />
        <span>BrowShare</span>
      </RouterLink>

      <nav class="navigation" :aria-label="$t('layout.primaryNavigation')">
        <div v-for="(group, groupIndex) in navigationGroups" :key="group.label">
          <p class="navigation-label" :class="{ 'navigation-label-secondary': groupIndex > 0 }">
            {{ $t(group.label) }}
          </p>
          <RouterLink
            v-for="item in group.items"
            :key="item.to"
            class="navigation-link"
            :to="item.to"
          >
            <NIcon aria-hidden="true" :component="item.icon" :size="19" />
            <span>{{ $t(item.label) }}</span>
          </RouterLink>
        </div>
      </nav>

      <div class="sidebar-account">
        <div class="account-identity">
          <NAvatar round color="#0f62d6">{{ initials }}</NAvatar>
          <div class="account-copy">
            <strong>{{ user.displayName }}</strong>
            <span>{{ user.email }}</span>
          </div>
        </div>
        <NButton quaternary block :loading="busy" @click="$emit('logout')">
          <template #icon><NIcon aria-hidden="true" :component="LogOutOutline" /></template>
          {{ $t('auth.logoutAction') }}
        </NButton>
      </div>
    </aside>

    <div class="workspace">
      <header class="topbar">
        <div class="topbar-leading">
          <NButton
            class="mobile-menu"
            quaternary
            circle
            :aria-label="$t('layout.openNavigation')"
            @click="mobileNavigationOpen = true"
          >
            <template #icon><NIcon aria-hidden="true" :component="MenuOutline" /></template>
          </NButton>
          <div class="breadcrumb">
            <span>{{ breadcrumbGroup }}</span>
            <span class="breadcrumb-separator">/</span>
            <strong>{{ breadcrumbTitle }}</strong>
          </div>
        </div>
        <div class="topbar-actions">
          <NTag size="small" round :bordered="false" type="success">
            {{ $t('layout.signedIn') }}
          </NTag>
          <PreferenceControls />
        </div>
      </header>
      <main class="workspace-content"><slot /></main>
    </div>

    <NDrawer v-model:show="mobileNavigationOpen" placement="left" :width="286">
      <NDrawerContent :title="$t('layout.navigation')" closable>
        <nav class="drawer-navigation">
          <div v-for="group in navigationGroups" :key="group.label" class="drawer-group">
            <p class="navigation-label">{{ $t(group.label) }}</p>
            <RouterLink
              v-for="item in group.items"
              :key="item.to"
              class="navigation-link"
              :to="item.to"
              @click="mobileNavigationOpen = false"
            >
              <NIcon aria-hidden="true" :component="item.icon" :size="19" />
              <span>{{ $t(item.label) }}</span>
            </RouterLink>
          </div>
        </nav>
        <template #footer>
          <div class="drawer-account">
            <div class="account-identity">
              <NAvatar round color="#0f62d6">{{ initials }}</NAvatar>
              <div class="account-copy">
                <strong>{{ user.displayName }}</strong>
                <span>{{ user.email }}</span>
              </div>
            </div>
            <NButton type="error" secondary block :loading="busy" @click="logoutFromDrawer">
              <template #icon><NIcon aria-hidden="true" :component="LogOutOutline" /></template>
              {{ $t('auth.logoutAction') }}
            </NButton>
          </div>
        </template>
      </NDrawerContent>
    </NDrawer>
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  background: var(--bs-canvas);
}

.sidebar {
  position: fixed;
  z-index: 10;
  top: 0;
  bottom: 0;
  left: 0;
  display: flex;
  width: 240px;
  flex-direction: column;
  border-right: 1px solid var(--bs-border);
  background: var(--bs-surface);
  padding: 20px 16px 16px;
}

.brand {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 11px;
  padding: 0 8px;
  color: var(--bs-text);
  font-size: 17px;
  font-weight: 720;
  text-decoration: none;
}

.brand-mark {
  width: 36px;
  height: 36px;
}

.navigation {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  margin-top: 34px;
  margin-bottom: 16px;
}

.navigation-label {
  margin: 0 10px 8px;
  color: var(--bs-text-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.navigation-label-secondary {
  margin-top: 26px;
}

.navigation-link {
  display: flex;
  min-height: 42px;
  align-items: center;
  gap: 11px;
  border-radius: 7px;
  padding: 0 11px;
  color: var(--bs-text-muted);
  font-size: 14px;
  font-weight: 560;
  text-decoration: none;
  transition:
    color 140ms ease,
    background-color 140ms ease;
}

.navigation-link:hover {
  background: rgb(15 98 214 / 6%);
  color: var(--bs-text);
}

.navigation-link.router-link-active {
  background: rgb(15 98 214 / 10%);
  color: var(--bs-primary);
}

.sidebar-account {
  flex-shrink: 0;
  margin-top: auto;
  border-top: 1px solid var(--bs-border);
  padding-top: 15px;
}

.account-identity {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
  padding: 0 7px 12px;
}

.account-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}

.account-copy strong,
.account-copy span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-copy strong {
  color: var(--bs-text);
  font-size: 13px;
}

.account-copy span {
  color: var(--bs-text-muted);
  font-size: 11px;
}

.workspace {
  min-height: 100vh;
  margin-left: 240px;
}

.topbar {
  position: sticky;
  z-index: 8;
  top: 0;
  display: flex;
  min-height: 66px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid var(--bs-border);
  background: color-mix(in srgb, var(--bs-surface) 92%, transparent);
  padding: 0 28px;
  backdrop-filter: blur(14px);
}

.topbar-leading,
.topbar-actions,
.breadcrumb {
  display: flex;
  align-items: center;
}

.topbar-leading,
.topbar-actions {
  gap: 14px;
}

.breadcrumb {
  gap: 8px;
  color: var(--bs-text-muted);
  font-size: 13px;
}

.breadcrumb strong {
  color: var(--bs-text);
}

.breadcrumb-separator {
  color: var(--bs-border);
}

.mobile-menu {
  display: none;
}

.workspace-content {
  padding: 30px 32px 52px;
}

.drawer-navigation {
  display: grid;
  gap: 6px;
}

.drawer-group + .drawer-group {
  margin-top: 20px;
}

.drawer-account {
  width: 100%;
}

@media (max-width: 900px) {
  .sidebar {
    display: none;
  }

  .workspace {
    margin-left: 0;
  }

  .mobile-menu {
    display: inline-flex;
  }
}

@media (max-width: 640px) {
  .topbar {
    padding: 0 16px;
  }

  .topbar-actions > :first-child {
    display: none;
  }

  .breadcrumb > span:first-child,
  .breadcrumb-separator {
    display: none;
  }

  .workspace-content {
    padding: 22px 16px 40px;
  }
}
</style>
