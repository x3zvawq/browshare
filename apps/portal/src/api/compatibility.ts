import type { paths } from '@browshare/api-client'
import { api } from './client.js'
import { ApiFailure, apiFailure } from './errors.js'

type SupportedApiVersion =
  paths['/version']['get']['responses'][200]['content']['application/json']['apiVersion']
const supportedApiVersion: SupportedApiVersion = 'v1'

export async function verifyBackendCompatibility(): Promise<void> {
  const { data, error, response } = await api.GET('/version', {
    parseAs: 'text',
    cache: 'no-store',
  })
  if (!response.ok || data === undefined) throw apiFailure(error, response)
  let value: unknown
  try {
    value = JSON.parse(data)
  } catch {
    /* A proxy HTML page is a service error, not an API version. */
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    !('name' in value) ||
    value.name !== 'BrowShare' ||
    !('service' in value) ||
    value.service !== 'backend' ||
    !('version' in value) ||
    typeof value.version !== 'string' ||
    !value.version.trim() ||
    value.version.length > 64 ||
    !('apiVersion' in value) ||
    typeof value.apiVersion !== 'string' ||
    !/^v[1-9]\d*$/.test(value.apiVersion)
  ) {
    throw new ApiFailure({
      code: 'UNEXPECTED_RESPONSE',
      message: 'Invalid Backend version response.',
      status: response.status,
      ...(response.headers.get('x-request-id')
        ? { requestId: response.headers.get('x-request-id')! }
        : {}),
    })
  }
  if (value.apiVersion !== supportedApiVersion) {
    throw new ApiFailure({
      code: 'API_VERSION_UNSUPPORTED',
      message: 'The Backend API version is not supported by this Portal.',
      details: {
        supportedApiVersion,
        backendApiVersion: value.apiVersion,
        backendVersion: value.version,
      },
      ...(response.headers.get('x-request-id')
        ? { requestId: response.headers.get('x-request-id')! }
        : {}),
    })
  }
}
