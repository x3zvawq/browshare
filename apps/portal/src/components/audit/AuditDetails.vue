<script setup lang="ts">
import { computed, onScopeDispose, shallowRef, useId, watch } from 'vue'
import { NButton, NModal, NSkeleton } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { api } from '@/api/client.js'
import { apiFailure, networkFailure, type ApiFailure } from '@/api/errors.js'
import type { AuditEvent } from '@/api/types.js'
import RequestError from '@/components/workspace/RequestError.vue'
const props = defineProps<{ id: string }>()
const emit = defineEmits<{ close: [] }>()
const { t, locale } = useI18n(),
  titleId = useId()
const data = shallowRef<AuditEvent | null>(null),
  error = shallowRef<ApiFailure | null>(null),
  loading = shallowRef(false)
let controller: AbortController | undefined
async function refresh() {
  controller?.abort()
  const current = new AbortController()
  controller = current
  loading.value = true
  try {
    const r = await api.GET('/audit-events/{id}', {
      params: { path: { id: props.id } },
      signal: current.signal,
    })
    if (!r.data) throw apiFailure(r.error, r.response)
    if (!current.signal.aborted) {
      data.value = r.data
      error.value = null
    }
  } catch (cause) {
    if (!current.signal.aborted) error.value = networkFailure(cause)
  } finally {
    if (controller === current) loading.value = false
  }
}
watch(
  () => props.id,
  () => {
    data.value = null
    error.value = null
    void refresh()
  },
  { immediate: true },
)
onScopeDispose(() => controller?.abort())
const fields = computed(() => {
  if (!data.value) return []
  const row = data.value
  return (
    [
      'id',
      'occurredAt',
      'actorName',
      'actorUserId',
      'action',
      'targetType',
      'targetId',
      'result',
      'requestId',
      'sourceIpHash',
    ] as const
  ).map((key) => ({
    key,
    value:
      key === 'occurredAt'
        ? `${new Date(row.occurredAt).toLocaleString(locale.value)} · ${row.occurredAt}`
        : key === 'result'
          ? t(`audit.results.${row.result}`)
          : (row[key] ?? t(key === 'actorName' ? 'audit.noActor' : 'audit.none')),
  }))
})
const sections = computed(() =>
  data.value
    ? [
        { key: 'changes', empty: 'noChanges', entries: Object.entries(data.value.changes) },
        { key: 'metadata', empty: 'noMetadata', entries: Object.entries(data.value.metadata) },
      ]
    : [],
)
function valueText(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}
</script>
<template>
  <NModal :show="true" @update:show="!$event && emit('close')">
    <!-- vueuc discovers a DIV root and buttons with explicit tabindex for focus trapping. -->
    <div class="details" role="dialog" aria-modal="true" :aria-labelledby="titleId" tabindex="-1">
      <header>
        <h2 :id="titleId">{{ t('audit.details') }}</h2>
        <NButton :tabindex="0" @click="emit('close')">{{ t('common.close') }}</NButton>
      </header>
      <p class="hint">{{ t('audit.privacy') }}</p>
      <RequestError v-if="error" :error="error" />
      <NSkeleton v-if="!data && loading" height="200px" />
      <template v-if="data"
        ><dl class="facts">
          <div v-for="field in fields" :key="field.key">
            <dt>{{ t(`audit.${field.key}`) }}</dt>
            <dd>{{ field.value }}</dd>
          </div>
        </dl>
        <section v-for="section in sections" :key="section.key">
          <h3>{{ t(`audit.${section.key}`) }}</h3>
          <p v-if="!section.entries.length" class="hint">{{ t(`audit.${section.empty}`) }}</p>
          <dl v-else class="payload">
            <div v-for="[key, value] in section.entries" :key="key">
              <dt>{{ key }}</dt>
              <dd>
                <pre>{{ valueText(value) }}</pre>
              </dd>
            </div>
          </dl>
        </section>
      </template>
      <footer>
        <NButton :tabindex="0" :loading="loading" @click="refresh">{{
          t('workspace.refresh')
        }}</NButton
        ><NButton :tabindex="0" @click="emit('close')">{{ t('common.close') }}</NButton>
      </footer>
    </div>
  </NModal>
</template>
<style scoped>
.details {
  box-sizing: border-box;
  width: min(780px, calc(100vw - 24px));
  max-height: calc(100dvh - 24px);
  overflow: auto;
  padding: 24px;
  border-radius: 12px;
  background: var(--bs-surface);
  color: var(--bs-text);
  box-shadow: 0 12px 60px #0003;
}
header,
footer {
  display: flex;
  align-items: center;
  gap: 10px;
  justify-content: space-between;
}
footer {
  justify-content: flex-end;
  margin-top: 20px;
}
h2 {
  margin: 0;
  font-size: 21px;
}
h3 {
  font-size: 16px;
}
.hint {
  color: var(--bs-text-muted);
  line-height: 1.65;
  font-size: 13px;
}
dl {
  margin: 0;
}
dl > div {
  padding: 10px 0;
  border-bottom: 1px solid var(--bs-border);
}
dt {
  color: var(--bs-text-muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}
dd {
  margin: 6px 0 0;
  font-size: 13px;
  font-family: var(--bs-font-mono);
  overflow-wrap: anywhere;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 0;
  font: inherit;
}
@media (max-width: 560px) {
  .details {
    padding: 16px;
  }
}
</style>
