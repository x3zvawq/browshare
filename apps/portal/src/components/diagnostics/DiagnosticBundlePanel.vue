<script setup lang="ts">
import { NAlert, NButton, NInput, NTime } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useDiagnosticBundle } from '@/composables/useDiagnosticBundle.js'
const { t } = useI18n()
const { sessionId, loading, data, error, valid, json, truncated, generate, download } =
  useDiagnosticBundle()
</script>
<template>
  <section class="diagnostics" aria-labelledby="diagnostics-title">
    <h2 id="diagnostics-title">{{ t('diagnostics.title') }}</h2>
    <p>{{ t('diagnostics.intro') }}</p>
    <p>{{ t('diagnostics.privacy') }}</p>
    <p>{{ t('diagnostics.limit') }}</p>
    <form class="diagnostics-form" @submit.prevent="generate">
      <label for="diagnostics-session">{{ t('diagnostics.session') }}</label>
      <NInput
        v-model:value="sessionId"
        :input-props="{
          id: 'diagnostics-session',
          'aria-invalid': !valid,
          'aria-describedby': !valid ? 'diagnostics-invalid' : undefined,
        }"
        :placeholder="t('diagnostics.placeholder')"
        :disabled="loading"
        :maxlength="36"
        clearable
      />
      <p v-if="!valid" id="diagnostics-invalid" role="alert">{{ t('diagnostics.invalid') }}</p>
      <NButton attr-type="submit" :loading="loading" :disabled="!valid">{{
        t('diagnostics.generate')
      }}</NButton>
    </form>
    <NAlert
      v-if="error"
      type="error"
      role="alert"
      :title="
        t(
          error.status === 403
            ? 'diagnostics.forbidden'
            : error.status === 404
              ? 'diagnostics.missing'
              : 'diagnostics.failed',
        )
      "
    >
      <span>{{ error.code }}</span
      ><span v-if="error.requestId">
        · {{ t('diagnostics.requestId') }}: {{ error.requestId }}</span
      >
    </NAlert>
    <div v-if="data" class="diagnostics-result">
      <p role="status">
        {{ t('diagnostics.generated') }} · {{ t('diagnostics.observed') }}
        <NTime :time="new Date(data.completedAt)" type="datetime" />
      </p>
      <p>
        {{
          t('diagnostics.counts', {
            workers: data.workers.items.length,
            profiles: data.profiles.items.length,
            sessions: data.sessions.items.length,
            audit: data.audit.items.length,
          })
        }}
      </p>
      <NAlert v-if="truncated" type="warning">{{ t('diagnostics.truncated') }}</NAlert>
      <NButton type="primary" @click="download">{{ t('diagnostics.download') }}</NButton>
      <details>
        <summary>{{ t('diagnostics.preview') }}</summary>
        <pre tabindex="0" :aria-label="t('diagnostics.preview')">{{ json }}</pre>
      </details>
    </div>
  </section>
</template>
<style scoped>
.diagnostics {
  padding: 1.5rem;
  border: 1px solid var(--bs-border);
  border-radius: 12px;
  margin-top: 1rem;
  overflow-wrap: anywhere;
}
.diagnostics p {
  line-height: 1.6;
}
.diagnostics-form {
  display: grid;
  gap: 0.75rem;
  max-width: 36rem;
  margin: 1rem 0;
}
.diagnostics-form .n-button {
  justify-self: start;
}
.diagnostics-result {
  display: grid;
  gap: 0.75rem;
  margin-top: 1rem;
}
.diagnostics-result .n-button {
  justify-self: start;
}
.diagnostics pre {
  max-height: 28rem;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 0.8rem;
}
.diagnostics summary {
  cursor: pointer;
  padding: 0.5rem 0;
}
</style>
