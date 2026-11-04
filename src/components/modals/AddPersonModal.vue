<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { useI18n } from 'vue-i18n';
import {
  isValidGedcomXref,
  normalizeGedcomXref,
  type Person,
  type ColumnConfig,
} from '../../composables/usePersons';

export interface AddPersonPayload {
  targetPersonId: string | null;
  relationType: string | null;
  givenName: string;
  surname: string;
  sex: string;
  birthDate: string | null;
  birthPlace: string | null;
  deathDate: string | null;
  deathPlace: string | null;
  customId: string;
  extraAttributes?: Record<string, string>;
}

const props = defineProps<{
  visible: boolean;
  selectedPerson: Person | null;
  persons: Person[];
  columns?: ColumnConfig[];
  getColLabel?: (col: ColumnConfig) => string;
  fallbackNextId: () => string;
  serverError?: string;
}>();

const emit = defineEmits<{
  close: [];
  submit: [payload: AddPersonPayload];
}>();

const { t } = useI18n();

const newRelId = ref<string>('');
const localError = ref<string>('');
const newRelType = ref<string>('none'); // 'none' | 'parent' | 'child' | 'spouse'
const newRelTarget = ref<string | null>(null);
const targetSearchQuery = ref<string>('');
const newRelGiven = ref<string>('');
const newRelSurname = ref<string>('');
const newRelSex = ref<string>('M');
const newRelBirthDate = ref<string>('');
const newRelBirthPlace = ref<string>('');
const newRelDeathDate = ref<string>('');
const newRelDeathPlace = ref<string>('');
const isIdFocused = ref<boolean>(false);
const showAllFields = ref<boolean>(false);

// Dynamische Werte für alle zusätzlichen Tabellen-Felder
const extraFieldValues = ref<Record<string, string>>({});

// Ausschluss der Standard-Felder, die bereits oben im Formular gerendert werden
const standardFieldKeys = new Set([
  'id',
  'henry_code',
  'generation',
  'given_name',
  'surname',
  'sex',
  'birth_date',
  'birth_place',
  'death_date',
  'death_place',
]);

const additionalColumns = computed<ColumnConfig[]>(() => {
  if (!props.columns) return [];
  return props.columns.filter(
    c =>
      !standardFieldKeys.has(c.key) &&
      c.editable !== false &&
      c.key !== 'chan' &&
      c.key !== 'ged__UID' &&
      c.key !== 'ged_UID' &&
      !c.key.toLowerCase().includes('_uid') &&
      !c.key.toLowerCase().includes('chan')
  );
});

const filteredTargetPersons = computed<Person[]>(() => {
  const q = targetSearchQuery.value.trim().toLowerCase();
  if (!q) return props.persons.slice(0, 30);
  return props.persons
    .filter(p => {
      const g = (p.given_name || '').toLowerCase();
      const s = (p.surname || '').toLowerCase();
      const id = (p.id || '').toLowerCase();
      return g.includes(q) || s.includes(q) || id.includes(q);
    })
    .slice(0, 30);
});

const selectedTargetPersonObj = computed<Person | null>(() => {
  if (!newRelTarget.value) return null;
  return props.persons.find(p => p.id === newRelTarget.value) || null;
});

function formatPersonLabel(p: Person): string {
  const g = p.given_name || 'N.N.';
  const s = p.surname || '';
  const dates = p.birth_date || p.death_date ? ` (* ${p.birth_date || '?'}, † ${p.death_date || '?'})` : '';
  return `${s ? s + ', ' : ''}${g} (${p.id})${dates}`;
}

watch(
  () => props.visible,
  async newVal => {
    if (!newVal) return;

    if (props.selectedPerson) {
      newRelTarget.value = props.selectedPerson.id;
      newRelType.value = 'child';
      newRelSurname.value = props.selectedPerson.surname || '';
      targetSearchQuery.value = formatPersonLabel(props.selectedPerson);
    } else {
      newRelTarget.value = null;
      newRelType.value = 'none';
      newRelSurname.value = '';
      targetSearchQuery.value = '';
    }
    newRelGiven.value = '';
    newRelSex.value = 'M';
    newRelBirthDate.value = '';
    newRelBirthPlace.value = '';
    newRelDeathDate.value = '';
    newRelDeathPlace.value = '';
    localError.value = '';
    showAllFields.value = false;
    extraFieldValues.value = {};

    try {
      newRelId.value = await invoke<string>('get_next_person_id');
    } catch {
      newRelId.value = props.fallbackNextId();
    }
  },
  { immediate: true }
);

function onSelectTarget(p: Person) {
  newRelTarget.value = p.id;
  targetSearchQuery.value = formatPersonLabel(p);
  if (!newRelSurname.value && p.surname) {
    newRelSurname.value = p.surname;
  }
}

function handleSubmit() {
  localError.value = '';
  const trimmedId = newRelId.value.trim();
  if (!trimmedId) {
    localError.value = t('id_required');
    return;
  }
  if (!isValidGedcomXref(trimmedId)) {
    localError.value = t('xref_format_error', { id: trimmedId });
    return;
  }
  const normalizedId = normalizeGedcomXref(trimmedId);
  if (!newRelGiven.value.trim() && !newRelSurname.value.trim()) {
    localError.value = t('name_required');
    return;
  }

  const existingPerson = props.persons.find(p => p.id === normalizedId);
  if (existingPerson) {
    const existingName = `${existingPerson.given_name || 'N.N.'} ${existingPerson.surname || ''}`.trim();
    localError.value = t('id_already_used', { id: normalizedId, name: existingName });
    return;
  }

  if (newRelType.value !== 'none' && !newRelTarget.value) {
    localError.value = 'Bitte wählen Sie eine Bezugsperson für das Verwandtschaftsverhältnis aus.';
    return;
  }

  emit('submit', {
    targetPersonId: newRelType.value === 'none' ? null : newRelTarget.value,
    relationType: newRelType.value === 'none' ? null : newRelType.value,
    givenName: newRelGiven.value,
    surname: newRelSurname.value,
    sex: newRelSex.value,
    birthDate: newRelBirthDate.value || null,
    birthPlace: newRelBirthPlace.value || null,
    deathDate: newRelDeathDate.value || null,
    deathPlace: newRelDeathPlace.value || null,
    customId: normalizedId,
    extraAttributes: { ...extraFieldValues.value },
  });
}
</script>

<template>
  <div v-if="visible" class="modal-overlay" @click.self="emit('close')">
    <div class="modal-content add-modal">
      <div class="modal-header">
        <h2>➕ {{ t('add_person_title') || 'Person anlegen' }}</h2>
        <button class="btn-close-icon" @click="emit('close')">✕</button>
      </div>

      <div class="modal-scrollable-body">
        <div v-if="localError || serverError" class="parent-error-alert mb-1">
          ⚠️ {{ localError || serverError }}
        </div>

        <!-- 1. Beziehung & Bezugsperson -->
        <div class="form-section-box mb-2">
          <div class="form-row-grid">
            <div>
              <label><strong>Verhältnis / Rolle:</strong></label>
              <select v-model="newRelType" class="w-100 mt-1">
                <option value="none">{{ t('add_person_rel_none') || 'Keine Bezugsperson / Unabhängige Person' }}</option>
                <option value="parent">👨‍👩‍👧 {{ t('add_person_rel_parent') || 'Vater / Mutter von' }}</option>
                <option value="child">👶 {{ t('add_person_rel_child') || 'Sohn / Tochter von' }}</option>
                <option value="spouse">⚭ {{ t('add_person_rel_spouse') || 'Ehepartner von' }}</option>
              </select>
            </div>

            <div v-if="newRelType !== 'none'">
              <label>
                <strong>{{ t('add_person_target_label') || 'Bezugsperson auswählen:' }} *</strong>
              </label>
              <div class="target-search-container mt-1">
                <input
                  v-model="targetSearchQuery"
                  :placeholder="t('add_person_search_target_placeholder') || 'Bezugsperson suchen...'"
                  class="w-100"
                />
                <select
                  v-if="filteredTargetPersons.length > 0 && (!newRelTarget || targetSearchQuery.length < 3 || targetSearchQuery !== formatPersonLabel(selectedTargetPersonObj || { id: '', given_name: null, surname: null, sex: null, birth_date: null, birth_place: null, death_date: null, death_place: null, proband_data: {}, gedcom_extra: {}, spouses: [], parent_ids: [] }))"
                  size="3"
                  class="w-100 target-quick-select mt-1"
                  @change="onSelectTarget(props.persons.find(p => p.id === ($event.target as HTMLSelectElement).value)!)"
                >
                  <option v-for="p in filteredTargetPersons" :key="p.id" :value="p.id">
                    {{ formatPersonLabel(p) }}
                  </option>
                </select>
                <div v-if="selectedTargetPersonObj" class="selected-target-badge mt-1">
                  ✓ Ausgewählt: <strong>{{ formatPersonLabel(selectedTargetPersonObj) }}</strong>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 2. Stammdaten: ID, Vorname, Nachname, Geschlecht -->
        <div class="form-section-box mb-2">
          <div class="form-row-grid">
            <div>
              <label>
                <strong>ID (XREF-ID) *:</strong>
                <small style="color: #7f8c8d;">({{ t('field_required') }})</small>
              </label>
              <div class="xref-input-wrapper">
                <input
                  v-model="newRelId"
                  @focus="isIdFocused = true"
                  @blur="isIdFocused = false"
                  :class="{ 'input-warning': !isValidGedcomXref(newRelId) }"
                  class="w-100 mt-1"
                  placeholder="z.B. I191143"
                  required
                />
                <div v-if="isIdFocused" class="xref-tooltip" @mousedown.prevent>
                  <div class="xref-tooltip-header">
                    <span>📌 {{ t('xref_tooltip_title') }}</span>
                    <span :class="isValidGedcomXref(newRelId) ? 'xref-badge-valid' : 'xref-badge-invalid'">
                      {{ isValidGedcomXref(newRelId) ? '✓ ' + t('xref_valid') : '⚠️ ' + t('xref_invalid') }}
                    </span>
                  </div>
                  <div class="xref-tooltip-body">
                    {{ t('xref_tooltip_desc') }}
                  </div>
                </div>
              </div>
            </div>
            <div>
              <label><strong>Geschlecht:</strong></label>
              <select v-model="newRelSex" class="w-100 mt-1">
                <option value="M">M (männlich)</option>
                <option value="F">F (weiblich)</option>
                <option value="U">U (unbekannt)</option>
              </select>
            </div>
          </div>

          <div class="form-row-grid mt-1">
            <div>
              <label><strong>Vorname:</strong></label>
              <input v-model="newRelGiven" class="w-100 mt-1" placeholder="Vorname(n)" />
            </div>
            <div>
              <label><strong>Nachname:</strong></label>
              <input v-model="newRelSurname" class="w-100 mt-1" placeholder="Nachname / Geburtsname" />
            </div>
          </div>
        </div>

        <!-- 3. Lebensdaten: Geburt & Tod -->
        <div class="form-section-box mb-2">
          <div class="form-row-grid">
            <div>
              <label><strong>Geburtsdatum:</strong></label>
              <input v-model="newRelBirthDate" class="w-100 mt-1" placeholder="z. B. 12.05.1875 oder 1875-05-12" />
            </div>
            <div>
              <label><strong>Geburtsort:</strong></label>
              <input v-model="newRelBirthPlace" class="w-100 mt-1" placeholder="Geburtsort" />
            </div>
          </div>

          <div class="form-row-grid mt-1">
            <div>
              <label><strong>Todesdatum:</strong></label>
              <input v-model="newRelDeathDate" class="w-100 mt-1" placeholder="z. B. 03.11.1942 oder 1942" />
            </div>
            <div>
              <label><strong>Todesort:</strong></label>
              <input v-model="newRelDeathPlace" class="w-100 mt-1" placeholder="Todesort" />
            </div>
          </div>
        </div>

        <!-- 4. Ausklappbare Option: Alle Tabellenfelder anzeigen und füllen -->
        <div class="all-fields-toggle-area mb-2">
          <button
            type="button"
            class="btn-toggle-all-fields"
            @click="showAllFields = !showAllFields"
          >
            <span>{{ showAllFields ? '▲ ' + (t('add_person_more_fields_hide') || 'Zusätzliche Tabellenfelder ausblenden') : '▼ ' + (t('add_person_more_fields_show') || 'Alle Felder der Tabelle anzeigen und füllen') }}</span>
            <small v-if="!showAllFields" class="field-count-pill">{{ additionalColumns.length }} weitere Spalten</small>
          </button>

          <transition name="fade">
            <div v-if="showAllFields" class="additional-fields-panel mt-1">
              <h4 class="additional-fields-title">
                📋 {{ t('add_person_additional_fields_title') || 'Weitere Attribute (Tabellenspalten)' }}
              </h4>
              <div class="additional-fields-grid">
                <div
                  v-for="col in additionalColumns"
                  :key="'add-col-' + col.key"
                  class="additional-field-item"
                >
                  <label class="field-item-label">
                    <span>{{ getColLabel ? getColLabel(col) : col.labelKey }}</span>
                    <small v-if="col.isDate" class="date-hint">(Datum)</small>
                  </label>
                  <input
                    v-model="extraFieldValues[col.key]"
                    :placeholder="col.isDate ? 'z. B. 1920-04-10' : ''"
                    class="w-100 field-input"
                  />
                </div>
              </div>
            </div>
          </transition>
        </div>
      </div>

      <div class="modal-footer">
        <button
          @click="handleSubmit"
          :disabled="!isValidGedcomXref(newRelId)"
          class="btn-submit"
        >
          ✓ Person anlegen
        </button>
        <button @click="emit('close')" class="btn-cancel">
          {{ t('cancel') || 'Abbrechen' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(15, 23, 42, 0.6);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
  padding: 16px;
  box-sizing: border-box;
}

.modal-content.add-modal {
  background: white;
  border-radius: 10px;
  width: 100%;
  max-width: 680px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.22);
  border: 1px solid #cbd5e1;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 18px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}

.modal-header h2 {
  margin: 0;
  font-size: 1.15rem;
  color: #1e293b;
  font-weight: 700;
}

.btn-close-icon {
  background: none;
  border: none;
  font-size: 1.15rem;
  color: #64748b;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
}

.btn-close-icon:hover {
  background: #e2e8f0;
  color: #0f172a;
}

.modal-scrollable-body {
  padding: 16px 20px;
  overflow-y: auto;
  flex-grow: 1;
}

.form-section-box {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 12px;
}

.form-row-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

@media (max-width: 580px) {
  .form-row-grid {
    grid-template-columns: 1fr;
  }
}

.w-100 {
  width: 100%;
  padding: 0.45rem 0.65rem;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  font-size: 0.88rem;
  box-sizing: border-box;
  outline: none;
  background: white;
}

.w-100:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
}

.mt-1 {
  margin-top: 0.4rem;
}

.mb-1 {
  margin-bottom: 0.5rem;
}

.mb-2 {
  margin-bottom: 1rem;
}

label {
  display: block;
  font-size: 0.82rem;
  color: #334155;
}

.parent-error-alert {
  background: #fef2f2;
  color: #991b1b;
  border: 1px solid #fecaca;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 0.85rem;
  font-weight: 600;
}

.input-warning {
  border: 2px solid #e67e22 !important;
  box-shadow: 0 0 6px rgba(230, 126, 34, 0.3) !important;
  background-color: #fffaf0 !important;
}

.xref-input-wrapper {
  position: relative;
  display: block;
  width: 100%;
}

.xref-tooltip {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 1000;
  min-width: 290px;
  max-width: 350px;
  margin-top: 5px;
  padding: 8px 12px;
  background: #1e293b;
  color: #f8fafc;
  border-radius: 6px;
  font-size: 0.76rem;
  line-height: 1.4;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.28);
}

.xref-tooltip-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  padding-bottom: 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.15);
  font-weight: 600;
}

.xref-tooltip-body {
  color: #cbd5e1;
}

.xref-badge-valid {
  color: #22c55e;
  font-weight: bold;
}

.xref-badge-invalid {
  color: #f97316;
  font-weight: bold;
}

.target-quick-select {
  max-height: 90px;
  overflow-y: auto;
  font-size: 0.8rem;
}

.selected-target-badge {
  font-size: 0.78rem;
  color: #15803d;
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  padding: 3px 6px;
  border-radius: 4px;
}

/* Alle Felder Toggle & Grid */
.all-fields-toggle-area {
  border-top: 1px dashed #cbd5e1;
  padding-top: 0.8rem;
}

.btn-toggle-all-fields {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  color: #1d4ed8;
  border-radius: 6px;
  font-size: 0.84rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.btn-toggle-all-fields:hover {
  background: #dbeafe;
  border-color: #93c5fd;
}

.field-count-pill {
  background: #2563eb;
  color: white;
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 0.72rem;
  font-weight: 500;
}

.additional-fields-panel {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 12px;
}

.additional-fields-title {
  margin: 0 0 10px 0;
  font-size: 0.86rem;
  color: #334155;
  border-bottom: 1px solid #e2e8f0;
  padding-bottom: 5px;
}

.additional-fields-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

@media (max-width: 580px) {
  .additional-fields-grid {
    grid-template-columns: 1fr;
  }
}

.additional-field-item {
  display: flex;
  flex-direction: column;
}

.field-item-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.78rem;
  font-weight: 600;
  color: #475569;
  margin-bottom: 3px;
}

.date-hint {
  color: #94a3b8;
  font-weight: normal;
}

.field-input {
  font-size: 0.82rem;
  padding: 0.35rem 0.55rem;
}

/* Modal Footer */
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  background: #f8fafc;
  border-top: 1px solid #e2e8f0;
}

.btn-submit {
  background: #2563eb;
  color: white;
  border: none;
  padding: 7px 16px;
  border-radius: 5px;
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
}

.btn-submit:hover:not(:disabled) {
  background: #1d4ed8;
}

.btn-submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-cancel {
  background: white;
  color: #64748b;
  border: 1px solid #cbd5e1;
  padding: 7px 14px;
  border-radius: 5px;
  font-size: 0.88rem;
  cursor: pointer;
}

.btn-cancel:hover {
  background: #f1f5f9;
  color: #1e293b;
}
</style>
