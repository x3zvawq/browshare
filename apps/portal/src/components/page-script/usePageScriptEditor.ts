import { useAppDialog as useDialog } from '@/composables/useAppDialog.js'
import { computed, onScopeDispose, ref, shallowRef } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { api } from '@/api/client.js'
import { apiFailure, networkFailure, type ApiFailure } from '@/api/errors.js'
import type { PageScriptContent, PageScriptState, PageScriptVersion } from '@/api/types.js'
import { usePagedCollection } from '@/composables/usePagedCollection.js'

export function usePageScriptEditor(props: {
  readonly profileId: string
  readonly canManage: boolean
}) {
  const { t } = useI18n(),
    dialog = useDialog(),
    message = useMessage()
  const state = shallowRef<PageScriptState | null>(null),
    selected = shallowRef<PageScriptVersion | null>(null),
    error = shallowRef<ApiFailure | null>(null),
    busy = shallowRef(false),
    initialized = shallowRef(false),
    editing = shallowRef(false)
  const content = ref<PageScriptContent>({
      source: '',
      appliesTo: 'NORMAL',
    }),
    summary = shallowRef(''),
    baseline = shallowRef('')
  const serialized = computed(() =>
    JSON.stringify({ content: content.value, changeSummary: summary.value.trim() || null }),
  )
  const dirty = computed(
    () => initialized.value && editing.value && serialized.value !== baseline.value,
  )
  const scriptError = computed(() => {
    const d = error.value?.details
    return d !== null && typeof d === 'object' && 'field' in d && d.field === 'source'
  })
  const controller = new AbortController()
  const history = usePagedCollection(
    () => props.profileId,
    async (cursor, signal) => {
      const r = await api.GET('/profiles/{profileId}/page-script/versions', {
        params: {
          path: { profileId: props.profileId },
          query: { limit: 20, ...(cursor ? { cursor } : {}) },
        },
        signal,
      })
      if (!r.data) throw apiFailure(r.error, r.response)
      return r.data
    },
  )
  async function perform(work: () => Promise<void>) {
    if (busy.value) return false
    busy.value = true
    error.value = null
    try {
      await work()
      return true
    } catch (cause) {
      if (!controller.signal.aborted) {
        const failure = networkFailure(cause)
        error.value = failure
        message.error(
          `${t('pageScript.failed')} · ${failure.code}${failure.requestId ? ` · ${failure.requestId}` : ''}`,
        )
      }
      return false
    } finally {
      busy.value = false
    }
  }
  async function readState() {
    const r = await api.GET('/profiles/{profileId}/page-script', {
      params: { path: { profileId: props.profileId } },
      signal: controller.signal,
    })
    if (!r.data) throw apiFailure(r.error, r.response)
    state.value = r.data
    return r.data
  }
  async function readVersion(id: string) {
    const r = await api.GET('/profiles/{profileId}/page-script/versions/{id}', {
      params: { path: { profileId: props.profileId, id } },
      signal: controller.signal,
    })
    if (!r.data) throw apiFailure(r.error, r.response)
    return r.data
  }
  function accept(
    value: PageScriptVersion | null,
    edit = value === null || value.state === 'DRAFT',
  ) {
    selected.value = value
    content.value = value
      ? (JSON.parse(JSON.stringify(value.content)) as PageScriptContent)
      : { source: '', appliesTo: 'NORMAL' }
    summary.value = value?.changeSummary ?? ''
    editing.value = edit && props.canManage
    initialized.value = true
    baseline.value = serialized.value
  }
  function allowDiscard(): Promise<boolean> {
    if (!dirty.value) return Promise.resolve(true)
    return new Promise((resolve) =>
      dialog.warning({
        title: t('pageScript.replaceTitle'),
        content: t('pageScript.replaceHint'),
        positiveText: t('pageScript.confirm'),
        negativeText: t('pageScript.cancel'),
        onPositiveClick: () => resolve(true),
        onNegativeClick: () => resolve(false),
        onClose: () => resolve(false),
        onMaskClick: () => resolve(false),
      }),
    )
  }
  async function selectVersion(id: string) {
    if (busy.value || !(await allowDiscard())) return
    await perform(async () => accept(await readVersion(id)))
  }
  async function refresh() {
    await perform(async () => {
      const current = await readState()
      await history.refresh()
      if (!initialized.value) {
        const initialId = current.publishedVersionId ?? history.items.value[0]?.id
        accept(current.draft ?? (initialId ? await readVersion(initialId) : null))
      }
    })
  }
  async function newDraft() {
    if (busy.value || !(await allowDiscard())) return
    await perform(async () => {
      const current = await readState()
      accept(current.draft)
    })
  }
  function copy() {
    editing.value = true
    selected.value = null
    baseline.value = ''
  }
  async function save() {
    await perform(async () => {
      const r = await api.PUT('/profiles/{profileId}/page-script/draft', {
        params: { path: { profileId: props.profileId } },
        body: { content: content.value, changeSummary: summary.value.trim() || null },
        signal: controller.signal,
      })
      if (!r.data) throw apiFailure(r.error, r.response)
      accept(r.data)
      message.success(t('pageScript.saved'))
      await readState()
      await history.refresh()
    })
  }
  function changePublication(action: 'publish' | 'disable') {
    const id = selected.value?.id
    if (!id || busy.value || dirty.value) return
    dialog.warning({
      title: t(`pageScript.${action}Title`),
      content: t(`pageScript.${action}Hint`),
      positiveText: t('pageScript.confirm'),
      negativeText: t('pageScript.cancel'),
      onPositiveClick: () =>
        perform(async () => {
          const r = await api.POST(
            action === 'publish'
              ? '/profiles/{profileId}/page-script/versions/{id}/publish'
              : '/profiles/{profileId}/page-script/versions/{id}/disable',
            { params: { path: { profileId: props.profileId, id } }, signal: controller.signal },
          )
          if (!r.data) throw apiFailure(r.error, r.response)
          accept(r.data)
          message.success(
            t(action === 'publish' ? 'pageScript.publishedDone' : 'pageScript.disabledDone'),
          )
          await readState()
          await history.refresh()
        }),
    })
  }
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (dirty.value) {
      event.preventDefault()
      event.returnValue = ''
    }
  }
  window.addEventListener('beforeunload', beforeUnload)
  onBeforeRouteLeave(() => (busy.value ? false : allowDiscard()))
  onBeforeRouteUpdate(() => (busy.value ? false : allowDiscard()))
  onScopeDispose(() => {
    controller.abort()
    window.removeEventListener('beforeunload', beforeUnload)
  })
  void refresh()

  return {
    state,
    selected,
    error,
    busy,
    initialized,
    editing,
    content,
    summary,
    dirty,
    scriptError,
    history,
    refresh,
    newDraft,
    copy,
    save,
    changePublication,
    selectVersion,
  }
}
