<script setup lang="ts">
import { NAlert, NButton, NSelect } from 'naive-ui'
import { computed, onBeforeUnmount, onMounted, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/api/client.js'
import { apiFailure, networkFailure } from '@/api/errors.js'
import type { ProfileAccessSubject } from '@/api/types.js'
const props = defineProps<{
  kind: 'USER' | 'PROFILE' | 'GROUP'
  multiple?: boolean
  value: string[]
  selected: (Pick<ProfileAccessSubject, 'id' | 'name'> & {
    status?: ProfileAccessSubject['status']
  })[]
  label: string
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:value': [value: string[]] }>()
const { t } = useI18n()
const known = shallowRef<ProfileAccessSubject[]>([])
const loading = shallowRef(false)
const error = shallowRef('')
let search = '',
  timer: ReturnType<typeof setTimeout> | undefined,
  controller: AbortController | undefined
const options = computed(() =>
  [
    ...new Map(
      [...props.selected, ...known.value].map((subject) => [subject.id, subject]),
    ).values(),
  ].map((subject) => ({
    value: subject.id,
    label:
      subject.name + (subject.status === 'DISABLED' ? ` · ${t('profileGroups.disabled')}` : ''),
  })),
)
async function load() {
  controller?.abort()
  const current = new AbortController()
  controller = current
  loading.value = true
  error.value = ''
  try {
    const result =
      props.kind === 'GROUP'
        ? await api.GET('/profile-groups', {
            params: { query: { limit: 50, ...(search ? { search } : {}) } },
            signal: current.signal,
          })
        : await api.GET('/profile-groups/subjects', {
            params: { query: { kind: props.kind, limit: 50, ...(search ? { search } : {}) } },
            signal: current.signal,
          })
    if (!result.data) throw apiFailure(result.error, result.response)
    if (current.signal.aborted) return
    // Retain selected labels while a later search replaces the visible search results.
    const retained = known.value.filter((subject) => props.value.includes(subject.id))
    known.value = [...retained, ...result.data.items]
  } catch (cause) {
    if (!current.signal.aborted) {
      const failure = networkFailure(cause)
      error.value = `${t('profileGroups.failed')} · ${failure.code}${failure.requestId ? ` · ${failure.requestId}` : ''}`
    }
  } finally {
    if (controller === current) loading.value = false
  }
}
function searchSubjects(value: string) {
  search = value.trim()
  clearTimeout(timer)
  controller?.abort()
  timer = setTimeout(() => void load(), 200)
}
onMounted(() => {
  if (!props.disabled) void load()
})
onBeforeUnmount(() => {
  clearTimeout(timer)
  controller?.abort()
})
</script>
<template>
  <NSelect
    :value="multiple === false ? (value[0] ?? null) : value"
    :options="options"
    :loading="loading"
    :disabled="disabled"
    :input-props="{ 'aria-label': label }"
    :multiple="multiple !== false"
    filterable
    remote
    clearable
    :placeholder="t('profileGroups.searchSubjects')"
    @search="searchSubjects"
    @update:value="emit('update:value', Array.isArray($event) ? $event : $event ? [$event] : [])"
  />
  <p class="picker-hint">{{ t('profileGroups.searchHint') }}</p>
  <NAlert v-if="error" type="error" :title="error"
    ><NButton size="small" @click="load">{{ t('common.retry') }}</NButton></NAlert
  >
</template>
<style scoped>
.picker-hint {
  margin: 8px 0 0;
  color: var(--text-secondary);
  font-size: 12px;
}
</style>
