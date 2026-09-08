import { h, onScopeDispose, useId, type VNode } from 'vue'
import { useDialog, type DialogOptions, type DialogReactive } from 'naive-ui'

/** Keep Naive UI's dialog lifecycle while completing its names and async action behavior. */
export function useAppDialog(): ReturnType<typeof useDialog> {
  const dialogs = useDialog()
  const prefix = `bs-dialog-${useId().replaceAll(':', '-')}`
  const owned = new Set<DialogReactive>()
  let sequence = 0
  onScopeDispose(() => {
    for (const dialog of owned) dialog.destroy()
    owned.clear()
  })

  function create(options: DialogOptions): DialogReactive {
    const className = `${prefix}-${++sequence}`
    let pending = false
    const idle = {
      loading: options.loading ?? false,
      closable: options.closable ?? true,
      closeOnEsc: options.closeOnEsc ?? true,
      maskClosable: options.maskClosable ?? true,
      negativeButtonProps: options.negativeButtonProps ?? {},
    }
    const dialog = dialogs.create({
      ...options,
      class: [options.class, className],
      onAfterLeave: () => {
        owned.delete(dialog)
        options.onAfterLeave?.()
      },
      title: () =>
        h(
          'span',
          {
            id: `${className}-title`,
            role: 'heading',
            'aria-level': 2,
            onVnodeMounted: (node: VNode) => {
              // DialogOptions cannot forward ARIA attributes to NDialog. The title
              // mount hook names its provider-owned dialog before focus is announced.
              const element = (node.el as HTMLElement).closest('[role="dialog"]')!
              element.setAttribute('aria-labelledby', `${className}-title`)
              element.setAttribute('aria-modal', 'true')
            },
          },
          [typeof options.title === 'function' ? options.title() : options.title],
        ),
      onPositiveClick: async (event) => {
        if (pending) return false
        pending = true
        Object.assign(dialog, {
          loading: true,
          closable: false,
          closeOnEsc: false,
          maskClosable: false,
          negativeButtonProps: { ...idle.negativeButtonProps, disabled: true },
        })
        try {
          return await options.onPositiveClick?.(event)
        } finally {
          pending = false
          Object.assign(dialog, idle)
        }
      },
    })
    owned.add(dialog)
    return dialog
  }

  return {
    create,
    destroyAll: dialogs.destroyAll,
    success: (options) => create({ ...options, type: 'success' }),
    warning: (options) => create({ ...options, type: 'warning' }),
    error: (options) => create({ ...options, type: 'error' }),
    info: (options) => create({ ...options, type: 'info' }),
  }
}
