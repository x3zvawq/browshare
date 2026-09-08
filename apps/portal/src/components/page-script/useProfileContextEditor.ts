import { useAppDialog as useDialog } from '@/composables/useAppDialog.js'
import { computed, onScopeDispose, shallowRef } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { api } from '@/api/client.js'
import { apiFailure, networkFailure, type ApiFailure } from '@/api/errors.js'
import type { UserProfileContext } from '@/api/types.js'
import { profileContextMessages } from './context-messages.js'

export function useProfileContextEditor(props: { profileId: string; canManage: boolean }) {
  const { t: translate, te } = useI18n({ messages: profileContextMessages })
  const t: (key: string) => string = translate
  const dialog = useDialog(),
    message = useMessage()
  const userIds = shallowRef<string[]>([])
  const state = shallowRef<UserProfileContext | null>(null)
  const draft = shallowRef('{}'),
    baseline = shallowRef('{}')
  const loading = shallowRef(false),
    saving = shallowRef(false),
    confirming = shallowRef(false)
  const error = shallowRef<ApiFailure | null>(null),
    showValidation = shallowRef(false)
  const userId = computed(() => userIds.value[0] ?? null)
  const dirty = computed(() => state.value !== null && draft.value !== baseline.value)
  const locked = computed(() => saving.value || confirming.value)
  const parsed = computed(() => {
    let variables: unknown
    try {
      variables = JSON.parse(draft.value)
    } catch {
      return { error: 'invalidJson' as const }
    }
    if (variables === null || typeof variables !== 'object' || Array.isArray(variables))
      return { error: 'invalidJson' as const }
    if (new TextEncoder().encode(JSON.stringify(variables)).byteLength > 32768)
      return { error: 'tooLarge' as const }
    return { variables: variables as Record<string, unknown> }
  })
  const validation = computed(() =>
    showValidation.value && parsed.value.error ? t(`profileContext.${parsed.value.error}`) : null,
  )
  const errorText = computed(() => {
    const key = `profileContext.errors.${error.value?.code}`
    return t(te(key) ? key : 'profileContext.errors.UNKNOWN')
  })
  let controller: AbortController | undefined
  function accept(value: UserProfileContext) {
    state.value = value
    draft.value = JSON.stringify(value.variables, null, 2)
    baseline.value = draft.value
    showValidation.value = false
  }
  async function allowDiscard(): Promise<boolean> {
    if (!dirty.value) return true
    if (confirming.value) return false
    confirming.value = true
    try {
      return await new Promise<boolean>((resolve) =>
        dialog.warning({
          title: t('profileContext.discardTitle'),
          content: t('profileContext.discardHint'),
          positiveText: t('profileContext.discard'),
          negativeText: t('profileContext.keep'),
          onPositiveClick: () => resolve(true),
          onNegativeClick: () => resolve(false),
          onClose: () => resolve(false),
          onMaskClick: () => resolve(false),
        }),
      )
    } finally {
      confirming.value = false
    }
  }
  async function load() {
    const id = userId.value
    if (id === null || !props.canManage || locked.value) return
    controller?.abort()
    const current = new AbortController()
    controller = current
    loading.value = true
    error.value = null
    try {
      const response = await api.GET('/profiles/{profileId}/contexts/{userId}', {
        params: { path: { profileId: props.profileId, userId: id } },
        signal: current.signal,
      })
      if (!response.data) throw apiFailure(response.error, response.response)
      if (!current.signal.aborted && userId.value === id) accept(response.data)
    } catch (cause) {
      if (!current.signal.aborted && userId.value === id) error.value = networkFailure(cause)
    } finally {
      if (controller === current) loading.value = false
    }
  }
  async function selectUsers(ids: string[]) {
    const next = ids[0] ?? null
    if (next === userId.value || locked.value || !props.canManage || !(await allowDiscard())) return
    controller?.abort()
    userIds.value = next === null ? [] : [next]
    state.value = null
    draft.value = baseline.value = '{}'
    error.value = null
    showValidation.value = false
    loading.value = false
    if (next !== null) await load()
  }
  async function refresh() {
    if (locked.value || loading.value || !(await allowDiscard())) return
    await load()
  }
  async function save() {
    const id = userId.value
    if (
      !props.canManage ||
      id === null ||
      state.value === null ||
      locked.value ||
      loading.value ||
      !dirty.value
    )
      return
    showValidation.value = true
    const content = parsed.value
    if (content.error) return
    const current = new AbortController()
    controller?.abort()
    controller = current
    saving.value = true
    error.value = null
    try {
      const response = await api.PUT('/profiles/{profileId}/contexts/{userId}', {
        params: { path: { profileId: props.profileId, userId: id } },
        body: { variables: content.variables },
        signal: current.signal,
      })
      if (!response.data) throw apiFailure(response.error, response.response)
      if (current.signal.aborted || userId.value !== id) return
      accept(response.data)
      message.success(t('profileContext.saved'))
    } catch (cause) {
      if (!current.signal.aborted && userId.value === id) error.value = networkFailure(cause)
    } finally {
      if (controller === current) saving.value = false
    }
  }
  function clear() {
    if (state.value !== null && !locked.value && !loading.value && props.canManage)
      draft.value = '{}'
  }
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (dirty.value || saving.value) {
      event.preventDefault()
      event.returnValue = ''
    }
  }
  window.addEventListener('beforeunload', beforeUnload)
  onBeforeRouteLeave(() => (locked.value ? false : allowDiscard()))
  onBeforeRouteUpdate(() => (locked.value ? false : allowDiscard()))
  onScopeDispose(() => {
    controller?.abort()
    window.removeEventListener('beforeunload', beforeUnload)
  })
  return {
    t,
    userIds,
    userId,
    state,
    draft,
    loading,
    saving,
    locked,
    dirty,
    error,
    errorText,
    validation,
    selectUsers,
    refresh,
    save,
    clear,
  }
}
