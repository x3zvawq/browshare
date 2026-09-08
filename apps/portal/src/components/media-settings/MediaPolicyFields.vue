<script setup lang="ts">
import { computed } from 'vue'
import { NCheckbox, NFormItem, NSwitch, type FormItemRule } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import AccessibleInputNumber from '@/components/forms/AccessibleInputNumber.vue'
defineProps<{ disabled?: boolean }>()
const maxWidth = defineModel<number | null>('maxWidth', { required: true })
const maxHeight = defineModel<number | null>('maxHeight', { required: true })
const maxFps = defineModel<number | null>('maxFps', { required: true })
const maxBitrateKbps = defineModel<number | null>('maxBitrateKbps', { required: true })
const unlimitedBitrate = defineModel<boolean>('unlimitedBitrate', { required: true })
const tabAudioEnabled = defineModel<boolean>('tabAudioEnabled', { required: true })
const { t } = useI18n()
function rule(
  value: number | null,
  min: number,
  max: number,
  key: string,
  optional = false,
): FormItemRule {
  return {
    validator: () =>
      optional || (value !== null && Number.isInteger(value) && value >= min && value <= max),
    message: t('profiles.editor.validation.' + key),
    trigger: ['change', 'blur'],
  }
}
const rules = computed(() => ({
  maxWidth: rule(maxWidth.value, 1, 1920, 'maxWidth'),
  maxHeight: rule(maxHeight.value, 1, 1080, 'maxHeight'),
  maxFps: rule(maxFps.value, 1, 60, 'maxFps'),
  maxBitrateKbps: rule(maxBitrateKbps.value, 100, 20000, 'maxBitrate', unlimitedBitrate.value),
}))
</script>
<template>
  <div class="media-fields">
    <NFormItem :label="t('profiles.editor.maxWidth')" path="maxWidth" :rule="rules.maxWidth">
      <AccessibleInputNumber
        v-model:value="maxWidth"
        :label="t('profiles.editor.maxWidth')"
        :disabled="disabled"
        :min="1"
        :max="1920"
        :precision="0"
      />
    </NFormItem>
    <NFormItem :label="t('profiles.editor.maxHeight')" path="maxHeight" :rule="rules.maxHeight">
      <AccessibleInputNumber
        v-model:value="maxHeight"
        :label="t('profiles.editor.maxHeight')"
        :disabled="disabled"
        :min="1"
        :max="1080"
        :precision="0"
      />
    </NFormItem>
    <NFormItem :label="t('profiles.editor.maxFps')" path="maxFps" :rule="rules.maxFps">
      <AccessibleInputNumber
        v-model:value="maxFps"
        :label="t('profiles.editor.maxFps')"
        :disabled="disabled"
        :min="1"
        :max="60"
        :precision="0"
      />
    </NFormItem>
    <NFormItem
      :label="t('profiles.editor.maxBitrate')"
      path="maxBitrateKbps"
      :rule="rules.maxBitrateKbps"
    >
      <div class="media-bitrate">
        <AccessibleInputNumber
          v-model:value="maxBitrateKbps"
          :label="t('profiles.editor.maxBitrate')"
          :disabled="disabled || unlimitedBitrate"
          :min="100"
          :max="20000"
          :precision="0"
          :placeholder="t('profiles.editor.maxBitratePlaceholder')"
        />
        <NCheckbox v-model:checked="unlimitedBitrate" :disabled="disabled">{{
          t('profiles.editor.useEngineDefault')
        }}</NCheckbox>
      </div>
    </NFormItem>
    <NFormItem class="media-audio" :label="t('profiles.editor.audio')">
      <div class="media-audio-row">
        <span>{{ t('profiles.editor.audioDescription') }}</span
        ><NSwitch
          v-model:value="tabAudioEnabled"
          :disabled="disabled"
          :aria-label="t('profiles.editor.audio')"
        />
      </div>
    </NFormItem>
  </div>
</template>
<style scoped>
.media-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 20px;
}
.media-bitrate {
  display: grid;
  gap: 8px;
  width: 100%;
}
.media-audio {
  grid-column: 1 / -1;
}
.media-audio-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
}
.media-audio-row span {
  color: var(--bs-text-muted);
}
@media (max-width: 540px) {
  .media-fields {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
