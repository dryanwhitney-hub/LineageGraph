<script setup lang="ts">
import { ref, watch } from 'vue';
import { formatDisplayDate, normalizeDateInputToGedcom, useDateFormat } from '../../composables/useDateFormat';

const props = withDefaults(
  defineProps<{
    modelValue: string | null | undefined;
    placeholder?: string;
  }>(),
  {
    placeholder: '',
  }
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const { dateFormat } = useDateFormat();
const isFocused = ref(false);
const localDraft = ref(formatDisplayDate(props.modelValue));

watch(
  () => [props.modelValue, dateFormat.value] as const,
  ([newVal]) => {
    if (!isFocused.value) {
      localDraft.value = formatDisplayDate(newVal);
    }
  }
);

function onFocus() {
  isFocused.value = true;
  localDraft.value = formatDisplayDate(props.modelValue);
}

function onInput(event: Event) {
  const raw = (event.target as HTMLInputElement).value;
  localDraft.value = raw;
  emit('update:modelValue', normalizeDateInputToGedcom(raw));
}

function onBlur() {
  isFocused.value = false;
  const normalized = normalizeDateInputToGedcom(localDraft.value);
  emit('update:modelValue', normalized);
  localDraft.value = formatDisplayDate(normalized);
}
</script>

<template>
  <input
    type="text"
    :value="localDraft"
    :placeholder="placeholder"
    @focus="onFocus"
    @input="onInput"
    @blur="onBlur"
  />
</template>
