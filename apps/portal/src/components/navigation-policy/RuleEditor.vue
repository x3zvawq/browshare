<script setup lang="ts">
import { computed } from 'vue'
import { NAlert, NButton, NCheckbox, NFormItem, NInput, NSelect } from 'naive-ui'
import ScriptCode from '@/components/shared/ScriptCode.vue'
import { useI18n } from 'vue-i18n'
import type { NavigationPolicyContent } from '@/api/types.js'
const model = defineModel<NavigationPolicyContent>({ required: true }),
  props = defineProps<{ readonly: boolean; busy: boolean }>(),
  { t } = useI18n()
const actions = computed(() =>
    [
      'ALLOW_REMOTE',
      'DENY',
      'REDIRECT_REMOTE',
      'PROMPT_REMOTE',
      'OPEN_LOCAL_PROMPT',
      'DEFER_TO_SCRIPT',
    ].map((value) => ({ value, label: t(`navigationPolicy.${value}`) })),
  ),
  defaults = computed(() => actions.value.filter((a) => ['ALLOW_REMOTE', 'DENY'].includes(a.value)))
function move(index: number, direction: number) {
  if (props.readonly || props.busy) return
  const rows = [...model.value.rules]
  const [item] = rows.splice(index, 1)
  rows.splice(index + direction, 0, item!)
  model.value = { ...model.value, rules: rows }
}
function add() {
  if (props.readonly || props.busy) return
  model.value = {
    ...model.value,
    rules: [
      ...model.value.rules,
      {
        id: crypto.randomUUID(),
        enabled: true,
        pattern: 'https://example.com/*',
        action: 'ALLOW_REMOTE',
      },
    ],
  }
}
</script>
<template>
  <section class="rule-editor">
    <header>
      <h2>{{ t('navigationPolicy.rules') }}</h2>
      <NButton v-if="!readonly" :disabled="busy || model.rules.length >= 256" @click="add">{{
        t('navigationPolicy.add')
      }}</NButton>
    </header>
    <p>{{ t('navigationPolicy.patternHint') }}</p>
    <p v-if="!model.rules.length">{{ t('navigationPolicy.noRules') }}</p>
    <ol>
      <li v-for="(rule, index) in model.rules" :key="rule.id">
        <div class="rule-header">
          <strong>#{{ index + 1 }}</strong
          ><NCheckbox v-model:checked="rule.enabled" :disabled="readonly || busy">{{
            t('navigationPolicy.enabled')
          }}</NCheckbox>
          <div v-if="!readonly" class="buttons">
            <NButton size="small" :disabled="busy || index === 0" @click="move(index, -1)">{{
              t('navigationPolicy.up')
            }}</NButton
            ><NButton
              size="small"
              :disabled="busy || index === model.rules.length - 1"
              @click="move(index, 1)"
              >{{ t('navigationPolicy.down') }}</NButton
            ><NButton
              size="small"
              type="error"
              secondary
              :disabled="busy"
              @click="model.rules.splice(index, 1)"
              >{{ t('navigationPolicy.remove') }}</NButton
            >
          </div>
        </div>
        <div class="rule-fields">
          <NFormItem :label="t('navigationPolicy.pattern')"
            ><NInput
              v-model:value="rule.pattern"
              :readonly="readonly || busy"
              :maxlength="2048"
              :input-props="{
                'aria-label': `${t('navigationPolicy.pattern')} ${index + 1}`,
              }" /></NFormItem
          ><NFormItem :label="t('navigationPolicy.action')"
            ><NSelect
              v-model:value="rule.action"
              :options="actions"
              :disabled="readonly || busy"
              :aria-label="`${t('navigationPolicy.action')} ${index + 1}`"
              @update:value="
                (action) => {
                  if (action !== 'REDIRECT_REMOTE') delete rule.redirectUrl
                }
              "
          /></NFormItem>
        </div>
        <NFormItem v-if="rule.action === 'REDIRECT_REMOTE'" :label="t('navigationPolicy.redirect')"
          ><NInput
            :value="rule.redirectUrl ?? ''"
            :readonly="readonly || busy"
            :maxlength="16384"
            :input-props="{ 'aria-label': `${t('navigationPolicy.redirect')} ${index + 1}` }"
            @update:value="(value) => (rule.redirectUrl = value)"
        /></NFormItem>
      </li>
    </ol>
    <NFormItem :label="t('navigationPolicy.default')"
      ><NSelect
        v-model:value="model.defaultAction"
        :options="defaults"
        :disabled="readonly || busy"
        :aria-label="t('navigationPolicy.default')"
    /></NFormItem>
    <NAlert type="info"
      >{{ t('navigationPolicy.scriptHint') }}
      <p class="script-api">
        <code
          >input.url · input.source · input.currentUrl · input.user?.id · input.user?.displayName ·
          input.session?.id · input.session?.profileId · input.rule?.id · input.rule?.action</code
        >
      </p>
      <code>return { action: 'ALLOW_REMOTE' };</code></NAlert
    ><NCheckbox
      :checked="model.policyScript !== null"
      :disabled="readonly || busy"
      @update:checked="(enabled) => (model.policyScript = enabled ? '' : null)"
      >{{ t('navigationPolicy.scriptEnable') }}</NCheckbox
    ><NFormItem v-if="model.policyScript !== null" :label="t('navigationPolicy.script')"
      ><ScriptCode
        v-model="model.policyScript"
        :readonly="readonly || busy"
        :label="t('navigationPolicy.script')"
    /></NFormItem>
  </section>
</template>
<style scoped>
.script-api {
  overflow-wrap: anywhere;
}
.rule-editor {
  display: grid;
  gap: 16px;
  min-width: 0;
}
header,
.rule-header,
.buttons {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}
header {
  justify-content: space-between;
}
h2 {
  margin: 0;
  font-size: 18px;
}
ol {
  padding: 0;
  list-style: none;
  display: grid;
  gap: 16px;
  margin: 0;
}
li {
  border: 1px solid var(--bs-border);
  border-radius: 10px;
  padding: 16px;
  min-width: 0;
}
.rule-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(160px, 240px);
  gap: 16px;
  margin-top: 16px;
}
.buttons {
  margin-left: auto;
}
p {
  color: var(--bs-text-muted);
  margin: 0;
}
@media (max-width: 650px) {
  .rule-fields {
    grid-template-columns: minmax(0, 1fr);
  }
  .buttons {
    margin-left: 0;
  }
}
</style>
