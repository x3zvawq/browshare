import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'

import { api } from '@/api/client.js'
import { verifyBackendCompatibility } from '@/api/compatibility.js'
import { ApiFailure, apiFailure, networkFailure } from '@/api/errors.js'
import type { AuthSession, BootstrapStatus, PublicAuthConfiguration } from '@/api/types.js'

export type SessionStatus =
  | 'idle'
  | 'restoring'
  | 'anonymous'
  | 'authenticated'
  | 'uninitialized'
  | 'unavailable'
  | 'incompatible'

export const useSessionStore = defineStore('session', () => {
  const status = shallowRef<SessionStatus>('idle')
  const current = shallowRef<AuthSession | null>(null)
  const restoreError = shallowRef<ApiFailure | null>(null)
  const publicConfiguration = shallowRef<PublicAuthConfiguration | null>(null)
  const initialization = shallowRef<BootstrapStatus | null>(null)
  let restorePromise: Promise<void> | undefined
  let configurationPromise: Promise<PublicAuthConfiguration> | undefined

  const isAuthenticated = computed(() => status.value === 'authenticated' && current.value !== null)
  const user = computed(() => current.value?.user ?? null)

  async function restore(options: { refresh?: boolean } = {}): Promise<void> {
    if (!options.refresh && (status.value === 'authenticated' || status.value === 'anonymous'))
      return
    if (restorePromise !== undefined) return restorePromise
    status.value = 'restoring'
    restorePromise = restoreCurrentSession().finally(() => {
      restorePromise = undefined
    })
    return restorePromise
  }

  async function login(email: string, password: string): Promise<void> {
    try {
      const { data, error, response } = await api.POST('/auth/login', {
        body: { email, password },
      })
      if (data === undefined) throw apiFailure(error, response)
      accept(data)
    } catch (error) {
      throw networkFailure(error)
    }
  }

  async function register(email: string, password: string): Promise<void> {
    try {
      const { data, error, response } = await api.POST('/auth/register', {
        body: { email, password },
      })
      if (data === undefined) throw apiFailure(error, response)
      accept(data)
    } catch (error) {
      throw networkFailure(error)
    }
  }

  async function logout(): Promise<void> {
    try {
      const { error, response } = await api.POST('/auth/logout')
      if (!response.ok) throw apiFailure(error, response)
    } finally {
      expire()
    }
  }

  async function loadPublicConfiguration(
    options: { readonly refresh?: boolean } = {},
  ): Promise<PublicAuthConfiguration> {
    if (!options.refresh && publicConfiguration.value !== null) return publicConfiguration.value
    if (!options.refresh && configurationPromise !== undefined) return configurationPromise
    configurationPromise = fetchPublicConfiguration().finally(() => {
      configurationPromise = undefined
    })
    return configurationPromise
  }

  function accept(session: AuthSession): void {
    current.value = session
    restoreError.value = null
    status.value = 'authenticated'
  }

  function expire(): void {
    current.value = null
    restoreError.value = null
    status.value = 'anonymous'
  }

  async function restoreCurrentSession(): Promise<void> {
    try {
      await verifyBackendCompatibility()
      const bootstrap = await api.GET('/bootstrap', { cache: 'no-store' })
      if (bootstrap.data === undefined) throw apiFailure(bootstrap.error, bootstrap.response)
      if (
        typeof bootstrap.data !== 'object' ||
        bootstrap.data === null ||
        typeof bootstrap.data.initialized !== 'boolean' ||
        typeof bootstrap.data.interactiveEnabled !== 'boolean' ||
        (bootstrap.data.initialized && bootstrap.data.interactiveEnabled)
      ) {
        throw new ApiFailure({
          code: 'UNEXPECTED_RESPONSE',
          message: 'Invalid Backend initialization status.',
          status: bootstrap.response.status,
          ...(bootstrap.response.headers.get('x-request-id')
            ? { requestId: bootstrap.response.headers.get('x-request-id')! }
            : {}),
        })
      }
      initialization.value = bootstrap.data
      if (!bootstrap.data.initialized) {
        current.value = null
        restoreError.value = null
        publicConfiguration.value = null
        status.value = 'uninitialized'
        return
      }
      const { data, error, response } = await api.GET('/auth/session')
      if (data !== undefined) {
        accept(data)
        return
      }
      if (response.status === 401) {
        expire()
        return
      }
      throw apiFailure(error, response)
    } catch (error) {
      // A network/server failure says nothing about the validity of the cookie or last identity.
      restoreError.value = networkFailure(error)
      status.value =
        restoreError.value.code === 'API_VERSION_UNSUPPORTED' ? 'incompatible' : 'unavailable'
      throw restoreError.value
    }
  }

  async function fetchPublicConfiguration(): Promise<PublicAuthConfiguration> {
    try {
      const { data, error, response } = await api.GET('/auth/config')
      if (data === undefined) throw apiFailure(error, response)
      publicConfiguration.value = data
      return data
    } catch (error) {
      throw networkFailure(error)
    }
  }

  return {
    status,
    current,
    restoreError,
    publicConfiguration,
    initialization,
    isAuthenticated,
    user,
    restore,
    login,
    register,
    logout,
    loadPublicConfiguration,
    accept,
    expire,
  }
})
