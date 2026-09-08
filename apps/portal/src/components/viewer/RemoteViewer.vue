<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue'
import {
  defineRemoteTabViewer,
  type RemoteTabViewerElement,
  type RemoteTabViewerEventDetailMap,
} from '@browshare/remote-tab-viewer'
import type { SessionViewerLaunch } from '@/api/types.js'
const props = defineProps<{
  launch: SessionViewerLaunch
  locale: string
  reconnect: () => Promise<{
    ticket: string
    endpoint: string
    focusPolicy: SessionViewerLaunch['focusPolicy']
  }>
}>()
const emit = defineEmits<{ close: []; state: [state: string]; error: [code: string] }>()
const container = useTemplateRef<HTMLDivElement>('container')
let viewer: RemoteTabViewerElement | undefined
const listeners = new AbortController()
onMounted(() => {
  defineRemoteTabViewer()
  viewer = document.createElement('browshare-tab-viewer') as RemoteTabViewerElement
  viewer.setAttribute('ticket', props.launch.ticket)
  viewer.setAttribute('endpoint', props.launch.signalingUrl)
  viewer.setAttribute('locale', props.locale)
  viewer.focusPolicy = props.launch.focusPolicy
  viewer.reconnectOptions = {
    getConnection: async () => {
      const connection = await props.reconnect()
      if (viewer) viewer.focusPolicy = connection.focusPolicy
      return { ticket: connection.ticket, endpoint: connection.endpoint }
    },
  }
  viewer.addEventListener('session-close-request', () => emit('close'), {
    signal: listeners.signal,
  })
  viewer.addEventListener(
    'connection-state-change',
    (event) =>
      emit(
        'state',
        (event as CustomEvent<RemoteTabViewerEventDetailMap['connection-state-change']>).detail
          .state,
      ),
    { signal: listeners.signal },
  )
  viewer.addEventListener(
    'error',
    (event) =>
      emit(
        'error',
        (event as unknown as CustomEvent<RemoteTabViewerEventDetailMap['error']>).detail.error.code,
      ),
    { signal: listeners.signal },
  )
  container.value!.append(viewer)
})
watch(
  () => props.locale,
  (value) => viewer?.setAttribute('locale', value),
)
onBeforeUnmount(() => {
  listeners.abort()
  // The element owns capture controls, PeerConnection and transfer teardown on removal.
  viewer?.remove()
  viewer = undefined
})
</script>
<template><div ref="container" class="remote-viewer" /></template>
<style scoped>
.remote-viewer {
  flex: 1;
  display: flex;
  min-height: 420px;
  min-width: 0;
}
.remote-viewer :deep(browshare-tab-viewer) {
  flex: 1;
  width: 100%;
  min-width: 0;
  height: 100%;
}
</style>
