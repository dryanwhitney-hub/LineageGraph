<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { Person } from '../../composables/usePersons';

withDefaults(
  defineProps<{
    mode?: 'footer' | 'banner';
    searchQuery?: string;
    searchResults?: Person[];
    includeSpouses?: boolean;
    activePartnerPath?: Person[];
    selectedPersonId?: string;
    getCode: (person: Person) => string | null;
  }>(),
  {
    mode: 'footer',
    searchQuery: '',
    searchResults: () => [],
    includeSpouses: true,
    activePartnerPath: () => [],
    selectedPersonId: '',
  }
);

const emit = defineEmits<{
  'update:searchQuery': [query: string];
  'update:includeSpouses': [include: boolean];
  'start-path': [targetPersonId: string];
  'clear-path': [];
  'jump-to': [personId: string];
}>();

const { t } = useI18n();
</script>

<template>
  <!-- Modus 1: Pfad-Banner in der Stammbaum-Werkzeugleiste -->
  <div
    v-if="mode === 'banner' && activePartnerPath && activePartnerPath.length > 0"
    class="partner-path-banner"
  >
    <div class="partner-path-header">
      <strong>🔗 {{ t('partner_path_title') }}:</strong>
      <button class="btn-clear-path" @click="emit('clear-path')">✖ {{ t('clear_path') }}</button>
    </div>
    <div class="partner-path-steps">
      <template v-for="(stepPerson, idx) in activePartnerPath" :key="'path-' + stepPerson.id">
        <span
          class="path-step-chip"
          :class="{ 'is-selected': selectedPersonId === stepPerson.id }"
          @click="emit('jump-to', stepPerson.id)"
        >
          {{ stepPerson.given_name || 'N.N.' }} {{ stepPerson.surname || '' }}
          <strong v-if="getCode(stepPerson)">[{{ getCode(stepPerson) }}]</strong>
        </span>
        <span v-if="idx < activePartnerPath.length - 1" class="path-arrow">↔</span>
      </template>
    </div>
  </div>

  <!-- Modus 2: Suchfeld & Ehepartner-Schalter im Footer der Detailansicht -->
  <div v-else-if="mode !== 'banner'" class="details-shortest-path-footer">
    <label class="shortest-path-label">
      🔗 <strong>{{ t('shortest_path_search_label') }}:</strong>
    </label>
    <div class="shortest-path-controls-row">
      <div class="shortest-path-search-box">
        <input
          :value="searchQuery"
          @input="emit('update:searchQuery', ($event.target as HTMLInputElement).value)"
          :placeholder="t('shortest_path_search_placeholder')"
          class="shortest-path-input"
        />
        <ul
          v-if="searchQuery && searchResults && searchResults.length > 0"
          class="shortest-path-dropdown"
        >
          <li
            v-for="res in searchResults"
            :key="'sp-search-' + res.id"
            @click="emit('start-path', res.id)"
          >
            <span>{{ res.surname || 'N.N.' }}, {{ res.given_name || 'N.N.' }}</span>
            <strong v-if="getCode(res)" class="sp-code"> [{{ getCode(res) }}]</strong>
            <small v-else class="sp-id"> ({{ res.id }})</small>
          </li>
        </ul>
      </div>
      <label class="spouse-path-slider-wrap" :title="t('shortest_path_spouse_slider_tooltip')">
        <input
          type="checkbox"
          :checked="includeSpouses"
          @change="emit('update:includeSpouses', ($event.target as HTMLInputElement).checked)"
          class="spouse-path-checkbox"
        />
        <span class="spouse-path-slider"></span>
        <span class="spouse-path-slider-text">{{ t('shortest_path_spouse_slider') }}</span>
      </label>
    </div>
  </div>
</template>

<style scoped>
/* Partner Path Banner */
.partner-path-banner {
  flex: 1;
  min-width: 300px;
  background: #fff8e1;
  border: 1px solid #ffe082;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 0.82rem;
}
.partner-path-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
  color: #b7791f;
}
button {
  padding: 0.5rem 1rem;
  background-color: #3498db;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-weight: bold;
}
.btn-clear-path {
  background: #e67e22 !important;
  color: white !important;
  padding: 2px 8px !important;
  font-size: 0.75rem !important;
  border-radius: 4px;
}
.partner-path-steps {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}
.path-step-chip {
  background: white;
  border: 1px solid #f39c12;
  border-radius: 4px;
  padding: 2px 6px;
  cursor: pointer;
  color: #2c3e50;
  transition: background 0.15s;
}
.path-step-chip:hover,
.path-step-chip.is-selected {
  background: #fef5e7;
  border-color: #d35400;
  font-weight: bold;
}
.path-arrow {
  color: #e67e22;
  font-weight: bold;
}

/* Fester Bereich ganz unten in den Eintragsdetails für "Kürzester Pfad" */
.details-shortest-path-footer {
  flex-shrink: 0;
  border-top: 2px solid #e9ecef;
  background: #f8f9fa;
  padding: 0.75rem 1.2rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.shortest-path-label {
  font-size: 0.85rem;
  color: #2c3e50;
}
.shortest-path-controls-row {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}
.shortest-path-search-box {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
}
.shortest-path-input {
  width: 100%;
  padding: 0.45rem 0.65rem;
  border: 1px solid #bdc3c7;
  border-radius: 4px;
  box-sizing: border-box;
  font-size: 0.85rem;
  background: white;
}
.shortest-path-input:focus {
  outline: 2px solid rgba(230, 126, 34, 0.35);
  border-color: #e67e22;
}
.spouse-path-slider-wrap {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  cursor: pointer;
  user-select: none;
  flex-shrink: 0;
  font-size: 0.78rem;
  color: #2c3e50;
}
.spouse-path-checkbox {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
  pointer-events: none;
}
.spouse-path-slider {
  position: relative;
  display: inline-block;
  width: 34px;
  height: 18px;
  background-color: #bdc3c7;
  border-radius: 18px;
  transition: background-color 0.2s ease;
  flex-shrink: 0;
}
.spouse-path-slider::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  background-color: white;
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  transition: transform 0.2s ease;
}
.spouse-path-checkbox:checked + .spouse-path-slider {
  background-color: #e67e22;
}
.spouse-path-checkbox:checked + .spouse-path-slider::after {
  transform: translateX(16px);
}
.spouse-path-slider-text {
  white-space: nowrap;
  font-weight: 600;
}
.shortest-path-dropdown {
  position: absolute;
  bottom: 100%;
  left: 0;
  width: 100%;
  background: white;
  border: 1px solid #bdc3c7;
  border-radius: 4px;
  max-height: 220px;
  overflow-y: auto;
  z-index: 120;
  list-style: none;
  padding: 0;
  margin: 0 0 4px 0;
  box-shadow: 0 -4px 10px rgba(0, 0, 0, 0.12);
}
.shortest-path-dropdown li {
  padding: 0.55rem 0.75rem;
  cursor: pointer;
  border-bottom: 1px solid #ecf0f1;
  font-size: 0.84rem;
  color: #2c3e50;
}
.shortest-path-dropdown li:last-child {
  border-bottom: none;
}
.shortest-path-dropdown li:hover {
  background: #fff8e1;
}
.sp-code {
  color: #d35400;
}
.sp-id {
  color: #7f8c8d;
}
</style>
