<script setup lang="ts">
import { computed, onScopeDispose, shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { NAlert, NButton } from 'naive-ui'
import AuthShell from '@/components/auth/AuthShell.vue'
import { portalStatusMessages } from '@/components/status/messages.js'
import { networkFailure, type ApiFailure } from '@/api/errors.js'
import { useSessionStore } from '@/stores/session.js'
import { safeRedirect } from '@/utils/navigation.js'

const props = defineProps<{
  kind: 'not-found' | 'forbidden' | 'unavailable' | 'incompatible' | 'page-unavailable'
}>()
const { t } = useI18n({ messages: portalStatusMessages })
const route = useRoute(),
  router = useRouter(),
  session = useSessionStore()
const pending = shallowRef(false)
const failure = shallowRef<ApiFailure | null>(session.restoreError)
const checkedAgain = shallowRef(false)
let disposed = false
onScopeDispose(() => {
  disposed = true
})
const home = computed(() =>
  session.user?.permissions.includes('session.use') ? '/workspace' : '/account/security',
)
const target = computed(() => {
  const path = safeRedirect(route.query.redirect)
  if (!path) return home.value
  const resolved = router.resolve(path)
  // Resource recovery must retain failed login/register destinations too,
  // including the original redirect to a protected page.
  return [
    'forbidden',
    'backend-unavailable',
    'version-incompatible',
    'page-resource-unavailable',
  ].includes(String(resolved.name)) ||
    (props.kind !== 'page-unavailable' && resolved.meta.guestOnly)
    ? home.value
    : path
})

function reloadPage() {
  if (pending.value) return
  pending.value = true
  // A failed module import can stay cached in this document. Only an explicit
  // user action reloads the document and obtains the current deployment assets.
  const destination = new URL(router.resolve(target.value).href, window.location.origin)
  window.location.assign(
    destination.origin === window.location.origin
      ? destination.href
      : router.resolve(home.value).href,
  )
}
const errorDetails = computed(() =>
  ['unavailable', 'incompatible'].includes(props.kind) ? failure.value : null,
)
const versionDetails = computed(() => {
  const details = errorDetails.value?.details
  return props.kind === 'incompatible' &&
    typeof details === 'object' &&
    details !== null &&
    'supportedApiVersion' in details &&
    typeof details.supportedApiVersion === 'string' &&
    'backendApiVersion' in details &&
    typeof details.backendApiVersion === 'string'
    ? details
    : null
})

async function retry() {
  if (pending.value) return
  pending.value = true
  checkedAgain.value = false
  const from = route.fullPath
  const destination = target.value
  try {
    await session.restore({ refresh: true })
    if (disposed || route.fullPath !== from) return
    failure.value = null
    await router.replace(destination)
    if (!disposed && router.currentRoute.value.name === 'forbidden') checkedAgain.value = true
  } catch (cause) {
    if (disposed || route.fullPath !== from) return
    failure.value = networkFailure(cause)
    const name = session.status === 'incompatible' ? 'version-incompatible' : 'backend-unavailable'
    if (router.currentRoute.value.name !== name)
      await router.replace({ name, query: { redirect: destination } })
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <AuthShell
    :eyebrow="kind === 'not-found' ? '404' : kind === 'forbidden' ? '403' : 'BROWSHARE'"
    :title="t(`routeFailure.${kind}.title`)"
    :description="t(`routeFailure.${kind}.description`)"
  >
    <p v-if="kind !== 'not-found' && route.query.redirect" class="recovery-hint">
      {{ t('routeFailure.restoreTarget') }}
    </p>
    <NAlert v-if="checkedAgain" type="warning" role="status" class="recovery-feedback">{{
      t('routeFailure.deniedAgain')
    }}</NAlert>
    <NAlert v-if="errorDetails" type="error" role="alert" class="recovery-feedback">
      <p>
        {{ t(kind === 'incompatible' ? 'routeFailure.upgradeHint' : 'routeFailure.retryFailed') }}
      </p>
      <dl>
        <template v-if="versionDetails"
          ><dt>{{ t('routeFailure.portalApi') }}</dt>
          <dd>{{ versionDetails.supportedApiVersion }}</dd>
          <dt>{{ t('routeFailure.backendApi') }}</dt>
          <dd>{{ versionDetails.backendApiVersion }}</dd></template
        >
        <dt>{{ t('routeFailure.code') }}</dt>
        <dd>{{ errorDetails.code }}</dd>
        <template v-if="errorDetails.requestId"
          ><dt>{{ t('routeFailure.requestId') }}</dt>
          <dd>{{ errorDetails.requestId }}</dd></template
        >
      </dl>
    </NAlert>
    <NAlert v-if="kind === 'page-unavailable'" type="error" role="alert" class="recovery-feedback">
      <p>{{ t('routeFailure.reloadHint') }}</p>
      <dl>
        <dt>{{ t('routeFailure.code') }}</dt>
        <dd>PAGE_RESOURCE_LOAD_FAILED</dd>
      </dl>
    </NAlert>
    <div class="recovery-actions">
      <NButton
        v-if="kind === 'page-unavailable'"
        type="primary"
        :loading="pending"
        @click="reloadPage"
        >{{ t('routeFailure.reloadPage') }}</NButton
      >
      <NButton v-else-if="kind !== 'not-found'" type="primary" :loading="pending" @click="retry">{{
        t(kind === 'forbidden' ? 'routeFailure.checkAccess' : 'routeFailure.retry')
      }}</NButton>
      <RouterLink v-slot="{ href, navigate }" :to="home" custom
        ><NButton tag="a" :href="href" :disabled="pending" @click="navigate">{{
          t('routeFailure.home')
        }}</NButton></RouterLink
      >
    </div>
  </AuthShell>
</template>

<style scoped>
.recovery-hint {
  color: var(--bs-text-muted);
  font-size: 13px;
  line-height: 1.6;
}
.recovery-feedback {
  margin-bottom: 18px;
}
.recovery-feedback p {
  margin-top: 0;
}
.recovery-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
dl {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 6px 12px;
  font-size: 12px;
}
dd {
  margin: 0;
  overflow-wrap: anywhere;
  font-family: var(--bs-font-mono);
}
@media (max-width: 480px) {
  .recovery-actions {
    flex-direction: column;
  }
}
</style>
