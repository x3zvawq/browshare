import { computed, onScopeDispose, shallowRef, watch } from 'vue'
import { api } from '@/api/client.js'
import { apiFailure, networkFailure, type ApiFailure } from '@/api/errors.js'
import type { DiagnosticBundle } from '@/api/types.js'
export function useDiagnosticBundle() {
  const sessionId = shallowRef(''),
    loading = shallowRef(false),
    data = shallowRef<DiagnosticBundle | null>(null),
    error = shallowRef<ApiFailure | null>(null)
  const valid = computed(
    () =>
      !sessionId.value.trim() ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        sessionId.value.trim(),
      ),
  )
  const json = computed(() => (data.value ? JSON.stringify(data.value, null, 2) : ''))
  const truncated = computed(
    () =>
      data.value &&
      (['workers', 'profiles', 'sessions', 'audit'] as const).some(
        (key) => data.value![key].truncated,
      ),
  )
  let controller: AbortController | undefined
  watch(sessionId, () => {
    controller?.abort()
    loading.value = false
    data.value = null
    error.value = null
  })
  async function generate() {
    if (loading.value || !valid.value) return
    const current = new AbortController()
    controller = current
    loading.value = true
    error.value = null
    data.value = null
    try {
      const id = sessionId.value.trim()
      const result = await api.GET('/admin/diagnostics', {
        params: { query: id ? { sessionId: id } : {} },
        signal: current.signal,
        cache: 'no-store',
      })
      if (!result.data) throw apiFailure(result.error, result.response)
      if (!current.signal.aborted) data.value = result.data
    } catch (cause) {
      if (!current.signal.aborted) error.value = networkFailure(cause)
    } finally {
      if (controller === current) loading.value = false
    }
  }
  function download() {
    if (!data.value) return
    const url = URL.createObjectURL(new Blob([json.value + '\n'], { type: 'application/json' })),
      anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `browshare-diagnostics-${data.value.requestId}.json`
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  onScopeDispose(() => {
    controller?.abort()
    data.value = null
  })
  return { sessionId, loading, data, error, valid, json, truncated, generate, download }
}
