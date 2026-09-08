import { useAppDialog as useDialog } from '@/composables/useAppDialog.js'
import { shallowRef } from 'vue'
import { useMessage } from 'naive-ui'

import { useI18n } from 'vue-i18n'
import { api } from '@/api/client.js'
import { apiFailure, networkFailure, type ApiFailure } from '@/api/errors.js'
import type { TabSession } from '@/api/types.js'
import { sessionName } from '@/utils/tab-session.js'

export function useSessionClose(onAccepted: (session: TabSession) => void | Promise<void>) {
  const { t } = useI18n(),
    dialog = useDialog(),
    message = useMessage()
  const error = shallowRef<ApiFailure | null>(null),
    closing = shallowRef(false)
  function confirm(session: TabSession) {
    if (closing.value) return
    const modal = dialog.warning({
      title: t(session.kind === 'MAINTENANCE' ? 'maintenance.endTitle' : 'workspace.endTitle'),
      content: t(session.kind === 'MAINTENANCE' ? 'maintenance.endHint' : 'workspace.endHint', {
        name: sessionName(session),
      }),
      positiveText: t(session.kind === 'MAINTENANCE' ? 'maintenance.end' : 'workspace.end'),
      negativeText: t('workspace.cancel'),
      onPositiveClick: async () => {
        closing.value = true
        modal.loading = true
        error.value = null
        try {
          const result = await api.POST('/sessions/{id}/close', {
            params: { path: { id: session.id } },
          })
          if (!result.data) throw apiFailure(result.error, result.response)
          await onAccepted(result.data)
          return true
        } catch (cause) {
          const failure = networkFailure(cause)
          error.value = failure
          message.error(
            `${t('workspace.errors.UNKNOWN')} · ${failure.code}${failure.requestId ? ` · ${failure.requestId}` : ''}`,
          )
          return false
        } finally {
          closing.value = false
          modal.loading = false
        }
      },
    })
  }
  return { confirm, closing, error }
}
