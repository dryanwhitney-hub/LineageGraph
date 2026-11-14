<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  SUPPORTED_LOCALES,
  getLocaleDefinition,
  type SupportedLocale,
} from '../../locales/registry';

export type ExportLocaleSelection = 'auto' | SupportedLocale;

defineProps<{
  modelValue: ExportLocaleSelection;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: ExportLocaleSelection];
}>();

const { t, locale } = useI18n();

const activeAppLocaleDef = computed(() => getLocaleDefinition(locale.value));

function onChange(event: Event) {
  const target = event.target as HTMLSelectElement;
  emit('update:modelValue', target.value as ExportLocaleSelection);
}
</script>

<template>
  <div class="export-lang-field">
    <label class="export-lang-label">
      🌐 {{ t('export_language_label') }}
    </label>
    <select
      class="export-lang-select"
      :value="modelValue"
      :aria-label="t('export_language_label')"
      @change="onChange"
    >
      <option value="auto">
        {{ t('export_language_auto', { lang: activeAppLocaleDef.endonym }) }}
      </option>
      <option
        v-for="item in SUPPORTED_LOCALES"
        :key="item.code"
        :value="item.code"
      >
        {{ item.endonym }} ({{ item.code.toUpperCase() }}){{ 'isBeta' in item && item.isBeta ? ` · ${t('language_beta')}` : '' }}
      </option>
    </select>
  </div>
</template>

<style scoped>
.export-lang-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.export-lang-label {
  font-size: 0.78rem;
  font-weight: 600;
  color: #334155;
}

.export-lang-select {
  width: 100%;
  padding: 0.42rem 0.55rem;
  font-size: 0.82rem;
  color: #0f172a;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  cursor: pointer;
}

.export-lang-select:focus {
  outline: 2px solid #2563eb;
  outline-offset: 1px;
  border-color: #2563eb;
}
</style>
