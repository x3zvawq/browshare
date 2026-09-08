<script setup lang="ts">
import { computed } from 'vue'
import { NFormItem, NSelect } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { PageScriptContent } from '@/api/types.js'
import ScriptCode from '@/components/shared/ScriptCode.vue'
const model = defineModel<PageScriptContent>({ required: true })
defineProps<{ readonly: boolean }>()
const { t } = useI18n()
const scopes = computed(() =>
  ['NORMAL', 'MAINTENANCE', 'BOTH'].map((value) => ({ value, label: t(`pageScript.${value}`) })),
)
const events = [
  'on_document_start',
  'on_dom_content_loaded',
  'on_load',
  'on_location_changed',
  'on_session_attached',
  'on_session_detached',
]
</script>
<template>
  <div class="script-form">
    <NFormItem :label="t('pageScript.scope')"
      ><NSelect
        v-model:value="model.appliesTo"
        :options="scopes"
        :disabled="readonly"
        :input-props="{ 'aria-label': t('pageScript.scope') }"
    /></NFormItem>
    <p>{{ t('pageScript.scriptHint') }}</p>
    <details>
      <summary>{{ t('pageScript.events') }}</summary>
      <ul>
        <li v-for="event in events" :key="event">
          <code>browshare:{{ event }}</code>
        </li>
      </ul>
      <p>{{ t('pageScript.contextHint') }}</p>
    </details>
    <ScriptCode v-model="model.source" :readonly="readonly" :label="t('pageScript.source')" />
    <p>{{ t('pageScript.testHint') }}</p>
  </div>
</template>
<style scoped>
.script-form {
  display: grid;
  gap: 12px;
  min-width: 0;
}
p {
  margin: 0;
  color: var(--bs-text-muted);
  overflow-wrap: anywhere;
}
details {
  min-width: 0;
}
code {
  overflow-wrap: anywhere;
}
ul {
  padding-left: 20px;
}
summary {
  cursor: pointer;
}
</style>
