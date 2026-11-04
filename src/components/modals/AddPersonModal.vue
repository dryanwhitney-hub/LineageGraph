<script setup lang="ts">
import { ref, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { useI18n } from 'vue-i18n';
import {
  isValidGedcomXref,
  normalizeGedcomXref,
  type Person,
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
}

const props = defineProps<{
  visible: boolean;
  selectedPerson: Person | null;
  persons: Person[];
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
const newRelType = ref<string>('none');
const newRelTarget = ref<string | null>(null);
const newRelTargetName = ref<string>('');
const newRelGiven = ref<string>('');
const newRelSurname = ref<string>('');
const newRelSex = ref<string>('M');
const newRelBirthDate = ref<string>('');
const newRelBirthPlace = ref<string>('');
const newRelDeathDate = ref<string>('');
const newRelDeathPlace = ref<string>('');
const isIdFocused = ref<boolean>(false);

watch(
  () => props.visible,
  async newVal => {
    if (!newVal) return;

    if (props.selectedPerson) {
      newRelTarget.value = props.selectedPerson.id;
      newRelTargetName.value = `${props.selectedPerson.given_name || 'N.N.'} ${props.selectedPerson.surname || ''}`;
      newRelType.value = 'child';
      newRelSurname.value = props.selectedPerson.surname || '';
    } else {
      newRelTarget.value = null;
      newRelTargetName.value = '';
      newRelType.value = 'none';
      newRelSurname.value = '';
    }
    newRelGiven.value = '';
    newRelSex.value = 'M';
    newRelBirthDate.value = '';
    newRelBirthPlace.value = '';
    newRelDeathDate.value = '';
    newRelDeathPlace.value = '';
    localError.value = '';

    try {
      newRelId.value = await invoke<string>('get_next_person_id');
    } catch {
      newRelId.value = props.fallbackNextId();
    }
  },
  { immediate: true }
);

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
  });
}
</script>

<template>
  <div v-if="visible" class="modal-overlay" @click.self="emit('close')">
    <div class="modal-content add-modal">
      <h2>{{ newRelTarget ? 'Verwandten anlegen' : 'Neue unabhängige Person anlegen' }}</h2>
      <div v-if="newRelTarget" style="margin-bottom: 10px; font-size: 0.9rem; color: #7f8c8d;">
        Bezugsperson: <strong>{{ newRelTargetName }}</strong>
      </div>

      <div v-if="localError || serverError" class="parent-error-alert mb-1">
        ⚠️ {{ localError || serverError }}
      </div>

      <div style="display: flex; gap: 10px;">
        <div style="flex: 1;">
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
              class="w-100 mt-1 mb-1"
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
        <div style="flex: 1;">
          <label>Verhältnis:</label>
          <select v-model="newRelType" class="w-100 mt-1 mb-1">
            <option value="none">Keine (Unabhängige Person)</option>
            <option v-if="newRelTarget" value="child">Kind</option>
            <option v-if="newRelTarget" value="parent">Elternteil</option>
            <option v-if="newRelTarget" value="spouse">Ehepartner</option>
          </select>
        </div>
      </div>

      <div style="display: flex; gap: 10px;">
        <div style="flex: 1;">
          <label>Vorname:</label>
          <input v-model="newRelGiven" class="w-100 mt-1 mb-1" />
        </div>
        <div style="flex: 1;">
          <label>Nachname:</label>
          <input v-model="newRelSurname" class="w-100 mt-1 mb-1" />
        </div>
      </div>
      <label>Geschlecht:</label>
      <select v-model="newRelSex" class="w-100 mt-1 mb-1">
        <option value="M">M</option>
        <option value="F">F</option>
        <option value="U">U</option>
      </select>

      <div style="display: flex; gap: 10px;">
        <div style="flex: 1;">
          <label>Geburtsdatum:</label>
          <input v-model="newRelBirthDate" class="w-100 mt-1 mb-1" placeholder="z.B. 1990-05-20" />
        </div>
        <div style="flex: 1;">
          <label>Geburtsort:</label>
          <input v-model="newRelBirthPlace" class="w-100 mt-1 mb-1" />
        </div>
      </div>
      <div style="display: flex; gap: 10px;">
        <div style="flex: 1;">
          <label>Todesdatum:</label>
          <input v-model="newRelDeathDate" class="w-100 mt-1 mb-1" placeholder="Optional" />
        </div>
        <div style="flex: 1;">
          <label>Todesort:</label>
          <input v-model="newRelDeathPlace" class="w-100 mt-1 mb-1" />
        </div>
      </div>

      <div class="d-flex mt-1">
        <button @click="handleSubmit" :disabled="!isValidGedcomXref(newRelId)" class="flex-grow">
          Anlegen
        </button>
        <button @click="emit('close')" class="btn-close-modal">Abbrechen</button>
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
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal-content {
  background: white;
  padding: 2rem;
  border-radius: 8px;
  width: 450px;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
}
.add-modal {
  width: 600px;
}
.modal-content h2 {
  margin-top: 0;
  color: #2c3e50;
  border-bottom: 2px solid #ecf0f1;
  padding-bottom: 0.5rem;
  font-size: 1.1rem;
}
.w-100 {
  width: 100%;
  padding: 0.4rem;
  border: 1px solid #bdc3c7;
  border-radius: 3px;
  box-sizing: border-box;
}
.mt-1 {
  margin-top: 1rem;
  display: inline-block;
}
.mb-1 {
  margin-bottom: 0.5rem;
  display: inline-block;
}
.d-flex {
  display: flex;
  gap: 0.5rem;
}
.flex-grow {
  flex-grow: 1;
  padding: 0.4rem;
  border: 1px solid #bdc3c7;
  border-radius: 3px;
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
button:hover:not(:disabled) {
  background-color: #2980b9;
}
button:disabled {
  background-color: #95a5a6;
  cursor: not-allowed;
}
.btn-close-modal {
  background-color: #7f8c8d;
}
.parent-error-alert {
  background: #ffcdd2;
  color: #b71c1c;
  border: 1px solid #e57373;
  padding: 8px 10px;
  border-radius: 4px;
  font-size: 0.85rem;
  margin-bottom: 10px;
  font-weight: bold;
  line-height: 1.4;
}
.input-warning {
  border: 2px solid #e67e22 !important;
  box-shadow: 0 0 6px rgba(230, 126, 34, 0.4) !important;
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
  background: #2c3e50;
  color: #ecf0f1;
  border-radius: 6px;
  font-size: 0.78rem;
  line-height: 1.4;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.28);
  pointer-events: auto;
  text-align: left;
}
.xref-tooltip-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 5px;
  padding-bottom: 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.15);
  font-weight: 600;
}
.xref-tooltip-body {
  font-size: 0.74rem;
  color: #bdc3c7;
}
.xref-badge-valid {
  color: #2ecc71;
  font-weight: bold;
  font-size: 0.75rem;
}
.xref-badge-invalid {
  color: #e67e22;
  font-weight: bold;
  font-size: 0.75rem;
}
</style>

