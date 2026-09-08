<script setup lang="ts">
import { useAppDialog as useDialog } from '@/composables/useAppDialog.js'
import { AddOutline, KeyOutline } from '@vicons/ionicons5'
import { NButton, NIcon, useMessage } from 'naive-ui'
import { computed, onMounted, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { api } from '@/api/client.js'
import { ApiFailure, apiFailure, networkFailure } from '@/api/errors.js'
import type { IssuedWorkerEnrollment, WorkerEnrollment } from '@/api/types.js'
import AppShell from '@/components/layout/AppShell.vue'
import CreateEnrollmentModal from '@/components/workers/CreateEnrollmentModal.vue'
import EnrollmentList from '@/components/workers/EnrollmentList.vue'
import EnrollmentTokenModal from '@/components/workers/EnrollmentTokenModal.vue'
import { useSessionStore } from '@/stores/session.js'

type EnrollmentStatus = WorkerEnrollment['status'] | 'ALL'

const session = useSessionStore()
const router = useRouter()
const dialog = useDialog()
const message = useMessage()
const { t } = useI18n()

const items = shallowRef<readonly WorkerEnrollment[]>([])
const status = shallowRef<EnrollmentStatus>('ALL')
const nextCursor = shallowRef<string | null>(null)
const loading = shallowRef(false)
const loadingMore = shallowRef(false)
const listError = shallowRef<string>()
const creating = shallowRef(false)
const createModalOpen = shallowRef(false)
const createError = shallowRef<ApiFailure | null>(null)
const issuedEnrollment = shallowRef<IssuedWorkerEnrollment | null>(null)
const busyEnrollmentId = shallowRef<string>()
const loggingOut = shallowRef(false)
let listRequestGeneration = 0

const canManage = computed(() => session.user?.permissions.includes('worker.manage') ?? false)

onMounted(() => loadEnrollments())

async function loadEnrollments(options: { readonly append?: boolean } = {}): Promise<void> {
  const append = options.append === true
  const cursor = append ? nextCursor.value : null
  if (append && cursor === null) return

  const generation = append ? listRequestGeneration : ++listRequestGeneration
  if (append) loadingMore.value = true
  else loading.value = true
  listError.value = undefined

  try {
    const { data, error, response } = await api.GET('/workers/enrollments', {
      params: {
        query: {
          limit: 30,
          status: status.value,
          ...(cursor === null ? {} : { cursor }),
        },
      },
    })
    if (data === undefined) throw apiFailure(error, response)
    if (generation !== listRequestGeneration) return
    items.value = append ? [...items.value, ...data.items] : data.items
    nextCursor.value = data.meta.nextCursor
  } catch (error) {
    if (generation !== listRequestGeneration) return
    listError.value = localizedError(error)
    const failure = networkFailure(error)
    if (failure.status === 401 || failure.status === 403) {
      items.value = []
      nextCursor.value = null
    }
  } finally {
    if (generation === listRequestGeneration) {
      if (append) loadingMore.value = false
      else loading.value = false
    }
  }
}

function changeStatus(value: EnrollmentStatus): void {
  status.value = value
  nextCursor.value = null
  items.value = []
  void loadEnrollments()
}

function openCreateModal(): void {
  createError.value = null
  createModalOpen.value = true
}

function closeCreateModal(): void {
  if (creating.value) return
  createModalOpen.value = false
  createError.value = null
}

async function createEnrollment(input: {
  readonly displayName?: string
  readonly expiresInSeconds: number
}): Promise<void> {
  creating.value = true
  createError.value = null
  try {
    const { data, error, response } = await api.POST('/workers/enrollments', { body: input })
    if (data === undefined) throw apiFailure(error, response)
    createModalOpen.value = false
    issuedEnrollment.value = data
    await loadEnrollments()
  } catch (error) {
    const failure = error instanceof ApiFailure ? error : networkFailure(error)
    createError.value = failure
  } finally {
    creating.value = false
  }
}

function closeTokenModal(): void {
  issuedEnrollment.value = null
}

function confirmRevoke(enrollment: WorkerEnrollment): void {
  dialog.warning({
    title: t('workers.confirmRevokeTitle'),
    content: t('workers.confirmRevokeDescription', {
      name: enrollment.displayName ?? t('workers.unnamedEnrollment'),
    }),
    positiveText: t('workers.revokeAction'),
    negativeText: t('common.cancel'),
    positiveButtonProps: { type: 'error' },
    onPositiveClick: () => revokeEnrollment(enrollment),
  })
}

async function revokeEnrollment(enrollment: WorkerEnrollment): Promise<boolean> {
  busyEnrollmentId.value = enrollment.id
  try {
    const { error, response } = await api.POST('/workers/enrollments/{enrollmentId}/revoke', {
      params: { path: { enrollmentId: enrollment.id } },
    })
    if (!response.ok) throw apiFailure(error, response)
    message.success(t('workers.revoked'))
    await loadEnrollments()
    return true
  } catch (error) {
    message.error(localizedError(error))
    return false
  } finally {
    busyEnrollmentId.value = undefined
  }
}

async function logout(): Promise<void> {
  loggingOut.value = true
  try {
    await session.logout()
  } catch {
    message.warning(t('auth.logoutLocalOnly'))
  } finally {
    loggingOut.value = false
    await router.replace({ name: 'login', query: { reason: 'signed-out' } })
  }
}

function localizedError(error: unknown, includeRequestId = true): string {
  const failure = error instanceof ApiFailure ? error : networkFailure(error)
  const key =
    failure.code === 'NETWORK_ERROR'
      ? 'auth.errors.network'
      : failure.code === 'CONFLICT'
        ? 'workers.errors.notActive'
        : failure.code === 'NOT_FOUND'
          ? 'workers.errors.notFound'
          : failure.code === 'FORBIDDEN'
            ? 'workers.errors.forbidden'
            : 'auth.errors.generic'
  return `${t(key)} · ${failure.code}${includeRequestId && failure.requestId ? ` · ${failure.requestId}` : ''}`
}
</script>

<template>
  <AppShell
    v-if="session.user"
    :user="session.user"
    :busy="loggingOut"
    :breadcrumb-group="$t('layout.administrationGroup')"
    :breadcrumb-title="$t('layout.workerEnrollments')"
    @logout="logout"
  >
    <RouterLink to="/admin/workers">{{ $t('workerManagement.back') }}</RouterLink>
    <section class="page-heading">
      <div>
        <p class="page-eyebrow">WORKER ENROLLMENT</p>
        <h1>{{ $t('workers.title') }}</h1>
        <p>{{ $t('workers.description') }}</p>
      </div>
      <NButton v-if="canManage" type="primary" size="large" @click="openCreateModal">
        <template #icon><NIcon aria-hidden="true" :component="AddOutline" /></template>
        {{ $t('workers.createAction') }}
      </NButton>
      <div v-else class="read-only-badge">
        <NIcon aria-hidden="true" :component="KeyOutline" :size="18" />
        <span>{{ $t('workers.readOnly') }}</span>
      </div>
    </section>

    <EnrollmentList
      v-model:status="status"
      :items="items"
      :loading="loading"
      :loading-more="loadingMore"
      :has-more="nextCursor !== null"
      :busy-enrollment-id="busyEnrollmentId"
      :can-manage="canManage"
      :error="listError"
      @update:status="changeStatus"
      @refresh="loadEnrollments"
      @load-more="loadEnrollments({ append: true })"
      @revoke="confirmRevoke"
    />

    <CreateEnrollmentModal
      :show="createModalOpen"
      :busy="creating"
      :error="createError ? localizedError(createError, false) : undefined"
      :request-id="createError?.requestId"
      @close="closeCreateModal"
      @submit="createEnrollment"
    />
    <EnrollmentTokenModal :enrollment="issuedEnrollment" @close="closeTokenModal" />
  </AppShell>
</template>

<style scoped>
.page-heading {
  display: flex;
  max-width: 1280px;
  margin: 0 auto 24px;
  align-items: flex-end;
  justify-content: space-between;
  gap: 32px;
}

.page-eyebrow {
  margin: 0 0 8px;
  color: var(--bs-primary) !important;
  font-size: 11px !important;
  font-weight: 750;
  letter-spacing: 0.14em;
}

.page-heading h1 {
  margin: 0;
  color: var(--bs-text);
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.025em;
}

.page-heading > div > p:last-child {
  max-width: 700px;
  margin: 8px 0 0;
  color: var(--bs-text-muted);
  font-size: 14px;
  line-height: 1.65;
}

.read-only-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--bs-border);
  border-radius: 8px;
  background: var(--bs-surface);
  padding: 9px 12px;
  color: var(--bs-text-muted);
  font-size: 12px;
}

@media (max-width: 680px) {
  .page-heading {
    align-items: stretch;
    flex-direction: column;
    gap: 16px;
  }
}
</style>
