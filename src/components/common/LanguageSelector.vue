<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { setAppLocale } from '../../i18n';
import {
  SUPPORTED_LOCALES,
  getLocaleDefinition,
  type SupportedLocale,
} from '../../locales/registry';

const emit = defineEmits<{
  change: [locale: SupportedLocale];
}>();

const { t, locale } = useI18n();

const isOpen = ref(false);
const highlightedIndex = ref(0);
const containerRef = ref<HTMLElement | null>(null);
const triggerRef = ref<HTMLButtonElement | null>(null);
const optionRefs = ref<HTMLButtonElement[]>([]);

const activeDefinition = computed(() => getLocaleDefinition(locale.value));

function openMenu() {
  const currentIdx = SUPPORTED_LOCALES.findIndex((item) => item.code === activeDefinition.value.code);
  highlightedIndex.value = currentIdx >= 0 ? currentIdx : 0;
  isOpen.value = true;
  nextTick(() => {
    optionRefs.value[highlightedIndex.value]?.focus();
  });
}

function closeMenu(restoreFocus = false) {
  isOpen.value = false;
  if (restoreFocus) {
    nextTick(() => triggerRef.value?.focus());
  }
}

function toggleMenu() {
  if (isOpen.value) {
    closeMenu(false);
  } else {
    openMenu();
  }
}

function selectLocale(code: SupportedLocale) {
  const next = setAppLocale(code);
  emit('change', next);
  closeMenu(true);
}

function onTriggerKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (!isOpen.value) {
      openMenu();
    }
  }
}

function onMenuKeydown(event: KeyboardEvent) {
  const count = SUPPORTED_LOCALES.length;

  if (event.key === 'Escape') {
    event.preventDefault();
    closeMenu(true);
    return;
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    highlightedIndex.value = (highlightedIndex.value + 1) % count;
    optionRefs.value[highlightedIndex.value]?.focus();
    return;
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    highlightedIndex.value = (highlightedIndex.value - 1 + count) % count;
    optionRefs.value[highlightedIndex.value]?.focus();
    return;
  }

  if (event.key === 'Home') {
    event.preventDefault();
    highlightedIndex.value = 0;
    optionRefs.value[0]?.focus();
    return;
  }

  if (event.key === 'End') {
    event.preventDefault();
    highlightedIndex.value = count - 1;
    optionRefs.value[count - 1]?.focus();
    return;
  }

  if (event.key === 'Tab') {
    closeMenu(false);
  }
}

function onPointerDownOutside(event: PointerEvent) {
  if (!isOpen.value) return;
  const target = event.target as Node | null;
  if (containerRef.value && target && !containerRef.value.contains(target)) {
    closeMenu(false);
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', onPointerDownOutside);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDownOutside);
});
</script>

<template>
  <div ref="containerRef" class="lang-dropdown">
    <button
      ref="triggerRef"
      type="button"
      class="lang-trigger"
      :aria-label="t('language_selector_aria')"
      :title="`${t('language_selector_aria')}: ${activeDefinition.endonym}`"
      aria-haspopup="listbox"
      :aria-expanded="isOpen"
      @click="toggleMenu"
      @keydown="onTriggerKeydown"
    >
      <svg
        class="lang-globe"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
      <span class="lang-code">{{ activeDefinition.code.toUpperCase() }}</span>
      <span class="lang-caret" :class="{ open: isOpen }" aria-hidden="true">▾</span>
    </button>

    <div
      v-if="isOpen"
      class="lang-menu"
      role="listbox"
      :aria-label="t('language_selector_aria')"
      @keydown="onMenuKeydown"
    >
      <button
        v-for="(item, idx) in SUPPORTED_LOCALES"
        :key="item.code"
        :ref="(el) => { if (el) optionRefs[idx] = el as HTMLButtonElement; }"
        type="button"
        role="option"
        class="lang-option"
        :class="{ active: item.code === activeDefinition.code }"
        :aria-selected="item.code === activeDefinition.code"
        @click="selectLocale(item.code)"
      >
        <span class="lang-option-main">
          <span class="lang-endonym">{{ item.endonym }}</span>
          <span class="lang-iso">{{ item.code.toUpperCase() }}</span>
          <span v-if="'isBeta' in item && item.isBeta" class="lang-beta-badge">
            {{ t('language_beta') }}
          </span>
        </span>
        <span v-if="item.code === activeDefinition.code" class="lang-check" aria-hidden="true">✓</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.lang-dropdown {
  position: relative;
  display: inline-flex;
}

.lang-trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  background: #1e293b;
  color: #cbd5e1;
  border: 1px solid #334155;
  border-radius: 6px;
  padding: 0.34rem 0.6rem;
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  white-space: nowrap;
}

.lang-trigger:hover,
.lang-trigger[aria-expanded='true'] {
  background: #334155;
  color: #ffffff;
  border-color: #475569;
}

.lang-trigger:focus-visible {
  outline: 2px solid #3b82f6;
  outline-offset: 2px;
}

.lang-globe {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  opacity: 0.9;
}

.lang-code {
  letter-spacing: 0.03em;
}

.lang-caret {
  font-size: 0.65rem;
  opacity: 0.8;
  transition: transform 0.15s;
}

.lang-caret.open {
  transform: rotate(180deg);
}

.lang-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 195px;
  background: #0f172a;
  border: 1px solid #334155;
  border-radius: 8px;
  padding: 0.3rem;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.35);
  z-index: 2000;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.lang-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  width: 100%;
  background: transparent;
  color: #e2e8f0;
  border: none;
  border-radius: 6px;
  padding: 0.45rem 0.6rem;
  font-size: 0.82rem;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}

.lang-option:hover,
.lang-option:focus-visible {
  background: #1e293b;
  color: #ffffff;
  outline: none;
}

.lang-option.active {
  background: rgba(37, 99, 235, 0.22);
  color: #ffffff;
  font-weight: 600;
}

.lang-option-main {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}

.lang-iso {
  font-size: 0.68rem;
  font-weight: 700;
  color: #94a3b8;
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 4px;
  padding: 0.05rem 0.32rem;
}

.lang-beta-badge {
  font-size: 0.65rem;
  font-weight: 700;
  color: #fbbf24;
  background: rgba(245, 158, 11, 0.14);
  border: 1px solid rgba(245, 158, 11, 0.35);
  border-radius: 999px;
  padding: 0.04rem 0.38rem;
}

.lang-check {
  color: #60a5fa;
  font-weight: 700;
  font-size: 0.85rem;
}
</style>
