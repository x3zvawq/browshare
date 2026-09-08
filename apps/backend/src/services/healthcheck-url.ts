import { BrowShareError } from '@browshare/common'

export function normalizeHealthcheckUrl(value: string | null): string | null {
  if (value === null || value.trim().length === 0) return null
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw invalidUrl()
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.href.length > 2048)
    throw invalidUrl()
  return url.href
}

function invalidUrl(): BrowShareError {
  return new BrowShareError({
    code: 'BAD_REQUEST',
    statusCode: 400,
    message:
      'Healthcheck URL must be an absolute HTTPS URL without credentials, at most 2048 characters.',
  })
}
