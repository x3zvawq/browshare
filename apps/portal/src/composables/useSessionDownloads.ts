import { computed, onScopeDispose, shallowRef, watch } from 'vue'
import { api } from '@/api/client.js'
import { apiFailure, networkFailure } from '@/api/errors.js'
import type { RetainedDownload } from '@/api/types.js'
import { usePagedCollection } from './usePagedCollection.js'

interface Delivery {
  busy: boolean
  submitted: boolean
  error?: string
}
interface DeliveryHandle {
  controller: AbortController
  frame?: HTMLIFrameElement
  claimId?: string
  origin?: string
  timer?: number
}

export function useSessionDownloads(sessionId: () => string) {
  const workerOnline = shallowRef<boolean | null>(null),
    now = shallowRef(Date.now()),
    offset = shallowRef(0)
  const deliveries = shallowRef<Record<string, Delivery>>({})
  const handles = new Map<string, DeliveryHandle>()
  const collection = usePagedCollection(sessionId, async (cursor, signal) => {
    const result = await api.GET('/sessions/{id}/downloads', {
      params: { path: { id: sessionId() }, query: { limit: 24, ...(cursor ? { cursor } : {}) } },
      signal,
    })
    if (!result.data) throw apiFailure(result.error, result.response)
    if (!signal.aborted) {
      workerOnline.value = result.data.workerOnline
      offset.value = Date.parse(result.data.serverTime) - Date.now()
      now.value = Date.now() + offset.value
    }
    return {
      items: result.data.items,
      meta: { nextCursor: result.data.nextCursor, hasMore: result.data.nextCursor !== null },
    }
  })
  const canClaim = computed(() => workerOnline.value === true && !collection.error.value)
  const update = (id: string, state: Delivery) => {
    deliveries.value = { ...deliveries.value, [id]: state }
  }
  const clear = (id: string) => {
    const handle = handles.get(id)
    handle?.controller.abort()
    handle?.frame?.remove()
    clearTimeout(handle?.timer)
    handles.delete(id)
  }
  const reset = () => {
    for (const id of handles.keys()) clear(id)
    deliveries.value = {}
  }
  watch(sessionId, () => {
    reset()
    workerOnline.value = null
  })
  watch(collection.items, (files) => {
    for (const file of files) {
      if (file.status !== 'AVAILABLE' || Date.parse(file.expiresAt) <= now.value) {
        clear(file.id)
        if (deliveries.value[file.id]) update(file.id, { busy: false, submitted: false })
      }
    }
  })
  watch(collection.error, (failure) => {
    if (failure?.status === 401 || failure?.status === 403 || failure?.status === 404) reset()
  })

  async function claim(file: RetainedDownload): Promise<void> {
    if (
      !canClaim.value ||
      deliveries.value[file.id]?.busy ||
      file.status !== 'AVAILABLE' ||
      Date.parse(file.expiresAt) <= now.value
    )
      return
    clear(file.id)
    const handle: DeliveryHandle = { controller: new AbortController() }
    handles.set(file.id, handle)
    update(file.id, { busy: true, submitted: false })
    try {
      const result = await api.POST('/sessions/{id}/downloads/{downloadId}/claim', {
        params: { path: { id: sessionId(), downloadId: file.id } },
        signal: handle.controller.signal,
      })
      if (!result.data) throw apiFailure(result.error, result.response)
      if (handle.controller.signal.aborted) return
      const credential = result.data,
        endpoint = new URL(credential.endpoint)
      if (
        endpoint.protocol !== 'https:' ||
        endpoint.username ||
        endpoint.password ||
        endpoint.search ||
        endpoint.hash
      )
        throw new Error('Invalid download endpoint')
      handle.claimId = credential.claimId
      handle.origin = endpoint.origin
      const frame = document.createElement('iframe')
      frame.name = `download-${credential.claimId}`
      frame.hidden = true
      frame.title = 'Download delivery'
      handle.frame = frame
      document.body.append(frame)
      const form = document.createElement('form')
      form.method = 'POST'
      form.action = credential.endpoint
      form.target = frame.name
      form.hidden = true
      for (const [name, value] of Object.entries({
        token: credential.token,
        claimId: credential.claimId,
      })) {
        const field = document.createElement('input')
        field.type = 'hidden'
        field.name = name
        field.value = value
        form.append(field)
      }
      document.body.append(form)
      try {
        form.submit()
      } finally {
        form.remove()
      }
      update(file.id, { busy: true, submitted: true })
      // Native downloads provide no completion event to the page. Only Worker metadata marks delivery.
      handle.timer = window.setTimeout(() => {
        if (handles.get(file.id) === handle) update(file.id, { busy: false, submitted: true })
      }, 8000)
    } catch (cause) {
      if (handle.controller.signal.aborted) return
      clear(file.id)
      update(file.id, { busy: false, submitted: false, error: networkFailure(cause).code })
    }
  }
  const onMessage = (event: MessageEvent) => {
    const data: unknown = event.data
    if (
      typeof data !== 'object' ||
      data === null ||
      !('type' in data) ||
      data.type !== 'browshare.download.error' ||
      !('claimId' in data) ||
      !('code' in data) ||
      typeof data.code !== 'string'
    )
      return
    for (const [id, handle] of handles) {
      if (
        event.origin !== handle.origin ||
        event.source !== handle.frame?.contentWindow ||
        data.claimId !== handle.claimId
      )
        continue
      clear(id)
      update(id, { busy: false, submitted: false, error: data.code })
      void collection.refresh()
      break
    }
  }
  window.addEventListener('message', onMessage)
  const clock = window.setInterval(() => {
    now.value = Date.now() + offset.value
  }, 1000)
  onScopeDispose(() => {
    reset()
    clearInterval(clock)
    window.removeEventListener('message', onMessage)
  })
  return { ...collection, workerOnline, canClaim, now, deliveries, claim }
}
