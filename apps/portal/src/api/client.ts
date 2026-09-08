import { createApiClient } from '@browshare/api-client'

type UnauthorizedHandler = () => void

let unauthorizedHandler: UnauthorizedHandler | undefined

export const api = createApiClient()

api.use({
  onResponse({ response, schemaPath }) {
    // Public deployment probes cannot establish that a user's session has expired.
    if (response.status === 401 && !['/version', '/bootstrap'].includes(schemaPath))
      unauthorizedHandler?.()
  },
})

export function setUnauthorizedHandler(handler: UnauthorizedHandler): void {
  unauthorizedHandler = handler
}
