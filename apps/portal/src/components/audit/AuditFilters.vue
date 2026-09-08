<script setup lang="ts">
import { computed, reactive, shallowRef } from 'vue'
import { NAlert, NButton, NCheckbox, NInput, NSelect } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { AuditEventListQuery } from '@/api/types.js'
const emit = defineEmits<{ apply: [query: AuditEventListQuery] }>()
const { t } = useI18n()
const empty = () => ({
  actorUserId: '',
  action: '',
  targetType: '',
  targetId: '',
  requestId: '',
  from: '',
  to: '',
  withoutActor: false,
  result: null as NonNullable<AuditEventListQuery['result']> | null,
})
const draft = reactive(empty()),
  error = shallowRef('')
const textFields = ['actorUserId', 'action', 'targetType', 'targetId', 'requestId'] as const
const limits = { actorUserId: 36, action: 128, targetType: 96, targetId: 2048, requestId: 128 }
const results = computed(() =>
  ['SUCCEEDED', 'FAILED', 'DENIED'].map((value) => ({ value, label: t(`audit.results.${value}`) })),
)
function apply() {
  error.value = ''
  const query: AuditEventListQuery = {}
  for (const key of textFields) {
    const value = draft[key].trim()
    if (value && !(key === 'actorUserId' && draft.withoutActor)) query[key] = value
  }
  if (
    query.actorUserId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      query.actorUserId,
    )
  ) {
    error.value = 'invalidId'
    return
  }
  if (
    [query.action, query.targetType].some((value) => value && !/^[a-z][a-z0-9_.:-]*$/.test(value))
  ) {
    error.value = 'invalidCode'
    return
  }
  if (draft.from) query.from = new Date(draft.from).toISOString()
  if (draft.to) query.to = new Date(draft.to).toISOString()
  if (query.from && query.to && query.from > query.to) {
    error.value = 'invalidRange'
    return
  }
  if (draft.result) query.result = draft.result
  if (draft.withoutActor) query.withoutActor = true
  emit('apply', query)
}
function reset() {
  Object.assign(draft, empty())
  error.value = ''
  emit('apply', {})
}
</script>
<template>
  <form class="filters" @submit.prevent="apply">
    <label v-for="key in textFields" :key="key"
      ><span>{{ t(`audit.${key}`) }}</span
      ><NInput
        v-model:value="draft[key]"
        :maxlength="limits[key]"
        :disabled="key === 'actorUserId' && draft.withoutActor"
        clearable
        :input-props="{ 'aria-label': t(`audit.${key}`) }"
    /></label>
    <label
      ><span>{{ t('audit.result') }}</span
      ><NSelect
        v-model:value="draft.result"
        clearable
        :options="results"
        :placeholder="t('workspace.allStates')"
        :input-props="{ 'aria-label': t('audit.result') }"
    /></label>
    <label v-for="key in ['from', 'to'] as const" :key="key"
      ><span>{{ t(`audit.${key}`) }}</span
      ><input v-model="draft[key]" type="datetime-local" step="1" :aria-label="t(`audit.${key}`)"
    /></label>
    <div class="full">
      <NCheckbox v-model:checked="draft.withoutActor">{{ t('audit.withoutActor') }}</NCheckbox>
      <p class="hint">{{ t('audit.withoutActorHint') }}</p>
    </div>
    <p class="hint full">{{ t('audit.filterHint') }}</p>
    <NAlert v-if="error" class="full" type="error">{{ t(`audit.${error}`) }}</NAlert>
    <div class="actions full">
      <NButton attr-type="submit" type="primary">{{ t('audit.apply') }}</NButton
      ><NButton @click="reset">{{ t('audit.reset') }}</NButton>
    </div>
  </form>
</template>
<style scoped>
.filters {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}
label {
  display: grid;
  gap: 6px;
  min-width: 0;
}
label > span {
  font-size: 13px;
}
.full {
  grid-column: 1 / -1;
}
.actions {
  display: flex;
  gap: 8px;
}
.hint {
  color: var(--bs-text-muted);
  font-size: 13px;
  line-height: 1.6;
  margin: 4px 0 0;
}

input {
  box-sizing: border-box;
  min-width: 0;
  width: 100%;
  font: inherit;
  padding: 6px 10px;
  border: 1px solid var(--bs-border);
  border-radius: 4px;
  background: var(--bs-surface);
  color: var(--bs-text);
}
input:focus-visible {
  outline: 2px solid var(--bs-primary);
  outline-offset: 2px;
}
@media (max-width: 1100px) {
  .filters {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 560px) {
  .filters {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
