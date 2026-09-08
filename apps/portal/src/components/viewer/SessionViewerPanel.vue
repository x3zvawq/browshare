<script setup lang="ts">
import StorageBlockNotice from '@/components/storage/StorageBlockNotice.vue'
import { computed, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import { useSessionStore } from '@/stores/session.js'
import { useI18n } from 'vue-i18n'
import { NAlert, NButton, NSpin, NTag } from 'naive-ui'
import PreferenceControls from '@/components/preferences/PreferenceControls.vue'
import RequestError from '@/components/workspace/RequestError.vue'
import SessionRecycleNotice from './SessionRecycleNotice.vue'
import RemoteViewer from './RemoteViewer.vue'
import RuntimeRouteStatus from '@/components/proxies/RuntimeRouteStatus.vue'
import LiveUpdateStatus from '@/components/status/LiveUpdateStatus.vue'
import { useSessionViewer } from '@/composables/useSessionViewer.js'
import { useSessionClose } from '@/composables/useSessionClose.js'
import { isSessionTerminal, sessionName } from '@/utils/tab-session.js'
const props = defineProps<{ id: string }>()
const { t, te, locale } = useI18n()
const {
  continueSession,
  continuing,
  continueError,
  session,
  launch,
  error,
  loading,
  liveState,
  lastReadAt,
  refreshLive,
  refreshing,
  connecting,
  takeover,
  connectable,
  connect,
  refresh,
  reconnect,
  closed,
} = useSessionViewer(props.id)
const { confirm, error: closeError, closing } = useSessionClose(closed)
const route = useRoute(),
  auth = useSessionStore()
const maintenance = computed(() => session.value?.kind === 'MAINTENANCE')
const backToScript = computed(
  () =>
    maintenance.value &&
    route.query.from === 'page-script' &&
    auth.user?.permissions.includes('profile.read'),
)
const backTarget = computed(() =>
  backToScript.value && session.value
    ? { name: 'admin-page-script', params: { profileId: session.value.profileId } }
    : { name: maintenance.value ? 'maintenance' : 'my-sessions' },
)
const backLabel = computed(() =>
  backToScript.value
    ? 'maintenance.backScript'
    : maintenance.value
      ? 'maintenance.title'
      : 'workspace.mySessions',
)

const mediaState = shallowRef('ATTACHING'),
  viewerError = shallowRef('')
const starting = computed(
  () => session.value && ['RESERVED', 'CREATING'].includes(session.value.status),
)
const sessionReason = computed(() => {
  const code = session.value?.failureCode ?? session.value?.closeReason
  if (!code) return t('workspace.notConnected')
  const key = `workspace.${session.value?.failureCode ? 'errors' : 'reasons'}.${code}`
  return te(key) ? t(key) : code
})
const connectedTime = computed(() =>
  takeover.value?.connectedAt
    ? new Date(takeover.value.connectedAt).toLocaleString(locale.value)
    : t('workspace.connectionPending'),
)
function onMediaState(state: string) {
  mediaState.value = state
  if (state === 'CONNECTED') viewerError.value = ''
}
function onViewerError(code: string) {
  // Control actions can fail while streaming remains healthy.
  if (mediaState.value === 'FAILED') viewerError.value = code
}
async function retry(generation?: number) {
  viewerError.value = ''
  mediaState.value = 'ATTACHING'
  await connect(generation)
}
</script>
<template>
  <section class="viewer-page">
    <header class="viewer-header">
      <RouterLink class="back" :to="backTarget">← {{ t(backLabel) }}</RouterLink>
      <div class="session-heading">
        <strong :title="session ? sessionName(session) : undefined">{{
          session ? sessionName(session) : t('workspace.viewer')
        }}</strong
        ><span v-if="session">{{ session.profileName }}</span>
        <span
          v-if="session?.hasCustomDisplayName && session.remoteTitle"
          class="remote-title"
          :title="session.remoteTitle"
          >{{ session.remoteTitle }}</span
        >
      </div>
      <NTag v-if="maintenance" size="small" type="warning">{{ t('maintenance.title') }}</NTag>
      <NTag v-if="session" size="small" :bordered="false">{{
        t(`workspace.sessionState.${session.status}`)
      }}</NTag
      ><PreferenceControls /><NButton
        v-if="session && !isSessionTerminal(session)"
        size="small"
        type="error"
        secondary
        :disabled="session.status === 'CLOSING'"
        :loading="closing"
        @click="confirm(session)"
        >{{ t(maintenance ? 'maintenance.end' : 'workspace.end') }}</NButton
      >
    </header>
    <LiveUpdateStatus
      viewer
      :state="liveState"
      :last-read-at="lastReadAt"
      :busy="refreshing"
      @refresh="refreshLive"
    />
    <div v-if="error || closeError" class="business-message">
      <RequestError :error="(error || closeError)!" /><NButton class="retry" @click="refresh">{{
        t('workspace.refresh')
      }}</NButton>
    </div>
    <div v-if="session && !isSessionTerminal(session)" class="business-message">
      <StorageBlockNotice
        :reason="session.storageBlockedReason"
        :pending="session.storagePolicyPending"
        compact
      />
      <RuntimeRouteStatus
        :route="session"
        :compact="!session.restartRequired && session.runtimeProxyHealth?.status !== 'UNHEALTHY'"
      />
    </div>
    <SessionRecycleNotice
      v-if="session && launch && !isSessionTerminal(session) && session.status !== 'CLOSING'"
      :session="session"
      :busy="continuing"
      :error="continueError"
      :connected="mediaState === 'CONNECTED' || mediaState === 'SUSPENDED'"
      @continue="continueSession"
    />
    <div v-if="takeover" class="center">
      <NAlert type="warning" :title="t('workspace.takeoverTitle')"
        ><p>{{ t('workspace.takeoverHint') }}</p>
        <p>{{ t('workspace.connectedAt', { time: connectedTime }) }}</p>
        <div class="actions">
          <RouterLink v-slot="{ href, navigate }" :to="backTarget" custom
            ><NButton tag="a" :href="href" @click="navigate">{{
              t('workspace.cancel')
            }}</NButton></RouterLink
          ><NButton
            type="warning"
            :loading="connecting"
            @click="retry(takeover.viewerGeneration)"
            >{{ t('workspace.takeover') }}</NButton
          >
        </div></NAlert
      >
    </div>
    <div v-else-if="loading || connecting || starting" class="center status" role="status">
      <NSpin size="large" />
      <h1>{{ t(starting ? 'workspace.startingTitle' : 'workspace.connectingTitle') }}</h1>
      <p>
        {{
          t(
            starting
              ? maintenance
                ? 'maintenance.startingHint'
                : 'workspace.startingHint'
              : 'workspace.connectingHint',
          )
        }}
      </p>
    </div>
    <template v-else-if="launch"
      ><div v-if="mediaState === 'FAILED' && viewerError" class="business-message">
        <NAlert
          :type="viewerError === 'VIEWER_REPLACED' ? 'warning' : 'error'"
          :title="
            t(
              viewerError === 'VIEWER_REPLACED'
                ? 'workspace.replaced'
                : 'workspace.connectionFailed',
            )
          "
          ><small>{{ viewerError }}</small
          ><NButton class="retry" @click="retry()">{{ t('workspace.reconnect') }}</NButton></NAlert
        >
      </div>
      <RemoteViewer
        :key="launch.viewerGeneration"
        :launch="launch"
        :locale="locale"
        :reconnect="reconnect"
        @close="session && confirm(session)"
        @state="onMediaState"
        @error="onViewerError"
      />
      <footer class="viewer-footer">
        <span>{{ t('workspace.connectionLabel') }}: {{ mediaState }}</span
        ><span>{{ t(maintenance ? 'maintenance.leaveHint' : 'workspace.leaveHint') }}</span>
      </footer></template
    >
    <div v-else-if="session" class="center status">
      <h1>{{ t(`workspace.sessionState.${session.status}`) }}</h1>
      <p>{{ sessionReason }}</p>
      <NButton v-if="connectable" type="primary" @click="retry()">{{
        t('workspace.reconnect')
      }}</NButton
      ><RouterLink v-else v-slot="{ href, navigate }" :to="backTarget" custom
        ><NButton tag="a" :href="href" @click="navigate">{{ t(backLabel) }}</NButton></RouterLink
      >
    </div>
  </section>
</template>
<style scoped>
.viewer-page {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  min-height: 540px;
  background: var(--bs-canvas);
  color: var(--bs-text);
}
.viewer-header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 14px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--bs-border);
  background: var(--bs-surface);
}
.back {
  color: var(--bs-primary);
  text-decoration: none;
  font-size: 13px;
}
.session-heading {
  flex: 1;
  min-width: 100px;
  display: flex;
  flex-direction: column;
}
.session-heading strong,
.session-heading .remote-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 40vw;
}
.session-heading span {
  color: var(--bs-text-muted);
  font-size: 11px;
}
.center {
  margin: auto;
  padding: 32px;
  width: min(600px, 100%);
}
.status {
  text-align: center;
}
.status h1 {
  font-size: 22px;
}
.status p {
  color: var(--bs-text-muted);
  overflow-wrap: anywhere;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
.business-message {
  padding: 12px 20px;
}
.retry {
  margin-left: 12px;
}
.viewer-footer {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 8px 20px;
  font-size: 11px;
  color: var(--bs-text-muted);
  background: var(--bs-surface);
}
@media (max-width: 640px) {
  .viewer-header {
    gap: 10px;
    padding: 10px 12px;
  }
  .viewer-header > :first-child {
    width: 100%;
  }
  .viewer-footer {
    flex-wrap: wrap;
  }
  .center {
    padding: 20px;
  }
}
</style>
