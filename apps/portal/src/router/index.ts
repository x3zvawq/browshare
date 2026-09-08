import { createRouter, createWebHistory } from 'vue-router'

import { setUnauthorizedHandler } from '@/api/client.js'
import { pinia } from '@/stores/index.js'
import { useSessionStore } from '@/stores/session.js'
import { safeRedirect } from '@/utils/navigation.js'
import RouteFailureView from '@/views/RouteFailureView.vue'
import { loadPage, PageResourceLoadError } from './page-loader.js'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: '/workspace',
    },
    {
      path: '/workspace',
      name: 'workspace',
      component: loadPage(() => import('@/views/WorkspaceView.vue')),
      meta: { requiresAuth: true, requiredPermission: 'session.use' },
    },
    {
      path: '/sessions',
      name: 'my-sessions',
      component: loadPage(() => import('@/views/WorkspaceView.vue')),
      props: { sessions: true },
      meta: { requiresAuth: true, requiredAnyPermission: ['session.use', 'profile.maintain'] },
    },
    {
      path: '/sessions/:id',
      name: 'session-viewer',
      component: loadPage(() => import('@/views/SessionViewerView.vue')),
      meta: { requiresAuth: true, requiredAnyPermission: ['session.use', 'profile.maintain'] },
    },
    {
      path: '/maintenance',
      name: 'maintenance',
      component: loadPage(() => import('@/views/WorkspaceView.vue')),
      props: { maintenance: true },
      meta: { requiresAuth: true, requiredPermission: 'profile.maintain' },
    },
    {
      path: '/setup',
      name: 'setup',
      component: loadPage(() => import('@/views/SetupView.vue')),
      meta: { public: true, guestOnly: true },
    },
    {
      path: '/login',
      name: 'login',
      component: loadPage(() => import('@/views/LoginView.vue')),
      meta: { public: true, guestOnly: true },
    },
    {
      path: '/register',
      name: 'register',
      component: loadPage(() => import('@/views/RegisterView.vue')),
      meta: { public: true, guestOnly: true },
    },
    {
      path: '/account/security',
      name: 'account-security',
      component: loadPage(() => import('@/views/AccountSecurityView.vue')),
      meta: { requiresAuth: true },
    },
    {
      path: '/admin/overview',
      name: 'admin-overview',
      component: loadPage(() => import('@/views/AdminOverviewView.vue')),
      meta: { requiresAuth: true, requiredAnyPermission: ['worker.read', 'profile.read'] },
    },
    {
      path: '/admin/settings',
      name: 'admin-settings',
      component: loadPage(() => import('@/views/AdminSettingsView.vue')),
      meta: { requiresAuth: true, requiredPermission: 'system.manage' },
    },
    {
      path: '/admin/users',
      name: 'admin-users',
      component: loadPage(() => import('@/views/AdminUsersView.vue')),
      meta: { requiresAuth: true, requiredPermission: 'user.read' },
    },
    {
      path: '/admin/audit',
      name: 'admin-audit',
      component: loadPage(() => import('@/views/AdminAuditView.vue')),
      meta: { requiresAuth: true, requiredPermission: 'audit.read' },
    },
    {
      path: '/admin/sessions',
      name: 'admin-sessions',
      component: loadPage(() => import('@/views/AdminSessionsView.vue')),
      meta: { requiresAuth: true, requiredPermission: 'profile.read' },
    },
    {
      path: '/admin/profiles',
      name: 'admin-profiles',
      component: loadPage(() => import('@/views/AdminProfilesView.vue')),
      meta: { requiresAuth: true, requiredPermission: 'profile.read' },
    },
    {
      path: '/admin/profiles/:profileId',
      component: loadPage(() => import('@/views/AdminProfileDetailView.vue')),
      meta: { requiresAuth: true, requiredPermission: 'profile.read' },
      children: [
        { path: '', redirect: (to) => ({ name: 'admin-profile-maintenance', params: to.params }) },
        {
          path: 'maintenance',
          name: 'admin-profile-maintenance',
          component: loadPage(() => import('@/views/AdminProfileMaintenanceView.vue')),
        },
        {
          path: 'page-script',
          name: 'admin-page-script',
          component: loadPage(() => import('@/views/AdminPageScriptView.vue')),
        },
        {
          path: 'navigation-policy',
          name: 'admin-navigation-policy',
          component: loadPage(() => import('@/views/AdminNavigationPolicyView.vue')),
        },
      ],
    },
    {
      path: '/admin/session-policies',
      name: 'admin-session-policies',
      component: loadPage(() => import('@/views/AdminSessionPoliciesView.vue')),
      meta: { requiresAuth: true, requiredPermission: 'profile.read' },
    },
    {
      path: '/admin/profile-groups',
      name: 'admin-profile-groups',
      component: loadPage(() => import('@/views/AdminProfileGroupsView.vue')),
      meta: { requiresAuth: true, requiredPermission: 'profile.read' },
    },
    {
      path: '/admin/proxies',
      name: 'admin-proxies',
      component: loadPage(() => import('@/views/AdminProxiesView.vue')),
      meta: { requiresAuth: true, requiredPermission: 'proxy.read' },
    },
    {
      path: '/admin/workers',
      name: 'admin-workers',
      component: loadPage(() => import('@/views/AdminWorkersView.vue')),
      meta: { requiresAuth: true, requiredPermission: 'worker.read' },
    },
    {
      path: '/admin/workers/:workerId',
      name: 'admin-worker',
      component: loadPage(() => import('@/views/AdminWorkersView.vue')),
      meta: { requiresAuth: true, requiredPermission: 'worker.read' },
    },
    {
      path: '/admin/workers/enrollments',
      name: 'worker-enrollments',
      component: loadPage(() => import('@/views/WorkerEnrollmentsView.vue')),
      meta: { requiresAuth: true, requiredPermission: 'worker.read' },
    },
    {
      path: '/about',
      name: 'foundation',
      component: loadPage(() => import('@/views/FoundationView.vue')),
      meta: { public: true },
    },
    {
      path: '/forbidden',
      name: 'forbidden',
      component: RouteFailureView,
      props: { kind: 'forbidden' },
      meta: { public: true },
    },
    {
      path: '/unavailable',
      name: 'backend-unavailable',
      component: RouteFailureView,
      props: { kind: 'unavailable' },
      meta: { public: true },
    },
    {
      path: '/incompatible',
      name: 'version-incompatible',
      component: RouteFailureView,
      props: { kind: 'incompatible' },
      meta: { public: true },
    },
    {
      path: '/page-unavailable',
      name: 'page-resource-unavailable',
      component: RouteFailureView,
      props: { kind: 'page-unavailable' },
      meta: { public: true },
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: RouteFailureView,
      props: { kind: 'not-found' },
      meta: { public: true },
    },
  ],
  scrollBehavior: () => ({ top: 0 }),
})

router.beforeEach(async (to) => {
  // Recovery pages must remain reachable when the session endpoint itself is unavailable.
  if (
    [
      'forbidden',
      'backend-unavailable',
      'version-incompatible',
      'page-resource-unavailable',
      'not-found',
    ].includes(String(to.name))
  )
    return
  const session = useSessionStore(pinia)
  try {
    await session.restore()
  } catch {
    if (to.meta.requiresAuth || to.meta.guestOnly) {
      return {
        name: session.status === 'incompatible' ? 'version-incompatible' : 'backend-unavailable',
        query: {
          redirect: to.meta.guestOnly
            ? (safeRedirect(to.query.redirect) ?? to.fullPath)
            : to.fullPath,
        },
      }
    }
    return
  }

  if (session.status === 'uninitialized') {
    if (to.name === 'setup') return
    return {
      name: 'setup',
      query: { redirect: safeRedirect(to.query.redirect) ?? to.fullPath },
    }
  }
  if (to.name === 'setup') {
    return { name: 'login', query: { redirect: safeRedirect(to.query.redirect) ?? '/workspace' } }
  }
  if (to.meta.requiresAuth && !session.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (
    typeof to.meta.requiredPermission === 'string' &&
    !session.user?.permissions.includes(to.meta.requiredPermission)
  ) {
    return { name: 'forbidden', query: { redirect: to.fullPath } }
  }
  if (
    Array.isArray(to.meta.requiredAnyPermission) &&
    !to.meta.requiredAnyPermission.some((permission: string) =>
      session.user?.permissions.includes(permission),
    )
  )
    return { name: 'forbidden', query: { redirect: to.fullPath } }
  if (to.meta.guestOnly && session.isAuthenticated) {
    const redirect = safeRedirect(to.query.redirect)
    return (
      (redirect && !router.resolve(redirect).meta.guestOnly ? redirect : undefined) ?? {
        name: session.user?.permissions.includes('session.use') ? 'workspace' : 'account-security',
      }
    )
  }
  return
})

router.onError((error, to) => {
  if (!(error instanceof PageResourceLoadError)) return
  void router.replace({
    name: 'page-resource-unavailable',
    query: { redirect: to.fullPath },
  })
})

setUnauthorizedHandler(() => {
  const session = useSessionStore(pinia)
  if (session.current === null) return
  session.expire()
  const route = router.currentRoute.value
  if (route.meta.requiresAuth) {
    void router.replace({
      name: 'login',
      query: { redirect: route.fullPath, reason: 'session-expired' },
    })
  }
})
