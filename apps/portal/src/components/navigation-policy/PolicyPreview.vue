<script setup lang="ts">
import { computed, onScopeDispose, shallowRef, reactive, watch } from 'vue'
import { NAlert, NButton, NFormItem, NInput, NSelect } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useSessionStore } from '@/stores/session.js'
import { api } from '@/api/client.js'
import { apiFailure, networkFailure, type ApiFailure } from '@/api/errors.js'
import type {
  NavigationPolicyContent,
  NavigationPolicyPreview,
  NavigationPolicyPreviewRequest,
} from '@/api/types.js'
const props = defineProps<{ profileId: string; content: NavigationPolicyContent }>()
const { t } = useI18n()
const url = shallowRef(''),
  result = shallowRef<NavigationPolicyPreview | null>(null),
  error = shallowRef<ApiFailure | null>(null),
  loading = shallowRef(false)
const session = useSessionStore()
const context = reactive({
  source: 'initial',
  currentUrl: '',
  userId: session.user?.id ?? '',
  userName: session.user?.displayName ?? '',
  sessionId: '',
})
const sources = computed(() =>
  ['initial', 'viewer', 'document', 'local-open'].map((value) => ({
    value,
    label: t(`navigationPolicy.${value}`),
  })),
)
const input = computed(() =>
  JSON.stringify({
    content: props.content,
    url: url.value,
    context: {
      source: context.source,
      currentUrl: context.currentUrl || null,
      user: context.userId ? { id: context.userId, displayName: context.userName } : null,
      session: context.sessionId ? { id: context.sessionId, profileId: props.profileId } : null,
    },
  }),
)
let controller: AbortController | undefined
watch(input, () => {
  controller?.abort()
  result.value = null
  error.value = null
  loading.value = false
})
async function run() {
  controller?.abort()
  const request = new AbortController()
  controller = request
  loading.value = true
  error.value = null
  result.value = null
  try {
    const r = await api.POST('/profiles/{profileId}/navigation-policy/preview', {
      params: { path: { profileId: props.profileId } },
      body: JSON.parse(input.value) as NavigationPolicyPreviewRequest,
      signal: request.signal,
    })
    if (!r.data) throw apiFailure(r.error, r.response)
    if (!request.signal.aborted) result.value = r.data
  } catch (cause) {
    if (!request.signal.aborted) error.value = networkFailure(cause)
  } finally {
    if (controller === request) loading.value = false
  }
}
onScopeDispose(() => controller?.abort())
</script>
<template>
  <section class="preview">
    <h2>{{ t('navigationPolicy.preview') }}</h2>
    <p>{{ t('navigationPolicy.previewHint') }}</p>
    <details v-if="content.policyScript !== null">
      <summary>{{ t('navigationPolicy.context') }}</summary>
      <p>{{ t('navigationPolicy.contextHint') }}</p>
      <div class="context-fields">
        <NFormItem :label="t('navigationPolicy.sourceLabel')"
          ><NSelect
            v-model:value="context.source"
            :options="sources"
            :aria-label="t('navigationPolicy.sourceLabel')" /></NFormItem
        ><NFormItem
          v-for="field in ['currentUrl', 'userId', 'userName', 'sessionId'] as const"
          :key="field"
          :label="t(`navigationPolicy.${field}`)"
          ><NInput
            v-model:value="context[field]"
            :maxlength="field === 'currentUrl' ? 16384 : field === 'userName' ? 256 : 36"
            :input-props="{ 'aria-label': t(`navigationPolicy.${field}`) }"
        /></NFormItem>
      </div>
    </details>
    <form @submit.prevent="run">
      <NFormItem :label="t('navigationPolicy.previewUrl')"
        ><NInput
          v-model:value="url"
          :maxlength="16384"
          :input-props="{ 'aria-label': t('navigationPolicy.previewUrl') }" /></NFormItem
      ><NButton attr-type="submit" :loading="loading" :disabled="!url.trim()">{{
        t('navigationPolicy.run')
      }}</NButton>
    </form>
    <NAlert v-if="error" type="error" role="alert" :title="t('navigationPolicy.failed')"
      >{{ error.code }} · {{ error.requestId }}</NAlert
    >
    <NAlert
      v-if="result"
      :type="result.action === 'DENY' ? 'warning' : 'info'"
      role="status"
      :title="t('navigationPolicy.result')"
      ><strong>{{ t(`navigationPolicy.${result.action}`) }}</strong>
      <p>{{ t(`navigationPolicy.${result.reason}`) }}</p>
      <dl>
        <dt>{{ t('navigationPolicy.matched') }}</dt>
        <dd>
          {{
            result.matchedRuleId
              ? '#' + (content.rules.findIndex((r) => r.id === result!.matchedRuleId) + 1)
              : '—'
          }}
        </dd>
        <dt>{{ t('navigationPolicy.normalized') }}</dt>
        <dd>{{ result.normalizedUrl ?? '—' }}</dd>
        <template v-if="result.redirectUrl"
          ><dt>{{ t('navigationPolicy.redirect') }}</dt>
          <dd>{{ result.redirectUrl }}</dd></template
        >
      </dl></NAlert
    >
  </section>
</template>
<style scoped>
.context-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 16px;
}
summary {
  cursor: pointer;
}
@media (max-width: 600px) {
  .context-fields {
    grid-template-columns: minmax(0, 1fr);
  }
}
.preview {
  display: grid;
  gap: 12px;
  min-width: 0;
}
h2,
p {
  margin: 0;
}
h2 {
  font-size: 18px;
}
p {
  color: var(--bs-text-muted);
}
form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
}
dl {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px;
}
dd {
  margin: 0;
  overflow-wrap: anywhere;
}
</style>
