<script setup lang="ts">
import { computed, shallowRef } from 'vue'
const model = defineModel<string>({ required: true })
withDefaults(defineProps<{ readonly: boolean; label: string; maxLength?: number | null }>(), {
  maxLength: 65536,
})
const top = shallowRef(0)
const lines = computed(() =>
  Array.from({ length: model.value.split('\n').length }, (_, i) => i + 1).join('\n'),
)
</script>
<template>
  <div class="script-code">
    <div class="gutter" aria-hidden="true">
      <pre :style="{ transform: `translateY(-${top}px)` }">{{ lines }}</pre>
    </div>
    <textarea
      v-model="model"
      :aria-label="label"
      :readonly="readonly"
      :maxlength="maxLength ?? undefined"
      rows="12"
      wrap="off"
      spellcheck="false"
      autocapitalize="off"
      autocomplete="off"
      @scroll="top = ($event.target as HTMLTextAreaElement).scrollTop"
    />
  </div>
</template>
<style scoped>
.script-code {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  width: 100%;
  min-width: 0;
  border: 1px solid var(--bs-border);
  border-radius: 8px;
  background: var(--bs-surface);
  overflow: hidden;
}
.script-code:focus-within {
  outline: 2px solid var(--bs-primary, #0f62d6);
  outline-offset: 1px;
}
.gutter {
  overflow: hidden;
  background: var(--bs-canvas);
  color: var(--bs-text-muted);
  text-align: right;
  border-right: 1px solid var(--bs-border);
  position: relative;
}
.gutter pre {
  position: absolute;
  inset: 0 8px auto 0;
  margin: 0;
  padding-top: 8px;
}
textarea {
  resize: vertical;
  min-height: 200px;
  max-height: 640px;
  border: 0;
  outline: none;
  padding: 8px 12px;
  background: transparent;
  color: var(--bs-text);
  width: 100%;
  box-sizing: border-box;
  tab-size: 2;
}
pre,
textarea {
  font:
    13px/22px 'SFMono-Regular',
    Consolas,
    monospace;
}
</style>
