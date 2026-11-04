<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ShortestPathModal from '../modals/ShortestPathModal.vue';
import {
  isValidGedcomXref,
  type Person,
  type PersonDetails,
  type ColumnConfig,
} from '../../composables/usePersons';

defineProps<{
  currentView: 'table' | 'tree' | 'design' | 'export';
  isDetailsOpen: boolean;
  selectedPerson: Person | null;
  personDetails: PersonDetails | null;
  activeDetailColumns: ColumnConfig[];
  isEditing: boolean;
  editedPersons: Map<string, Person>;
  saveErrorAlert: string;
  isLoading: boolean;
  hasInvalidEditedPerson: boolean;
  parentEditError: string;
  selectedFatherId: string;
  selectedMotherId: string;
  malePersons: Person[];
  femalePersons: Person[];
  shortestPathSearchQuery: string;
  shortestPathSearchResults: Person[];
  shortestPathIncludeSpouses: boolean;
  getColLabel: (col: ColumnConfig) => string;
  getCode: (person: Person) => string | null;
  getGen: (person: Person) => number | null;
  getPersonAttr: (person: Person, key: string) => any;
  setPersonAttr: (person: Person, key: string, value: string) => void;
  getRelCode: (personId: string | null) => string | null;
}>();

const emit = defineEmits<{
  'update:isDetailsOpen': [val: boolean];
  'update:selectedFatherId': [val: string];
  'update:selectedMotherId': [val: string];
  'update:shortestPathSearchQuery': [val: string];
  'update:shortestPathIncludeSpouses': [val: boolean];
  'save-changes': [];
  'save-parents': [];
  'jump-to': [personId: string];
  'start-shortest-path': [targetPersonId: string];
}>();

const { t } = useI18n();
const activeIdField = ref<string | null>(null);
</script>

<template>
  <div
    v-if="currentView !== 'design' && currentView !== 'export'"
    class="details-pane"
    :class="{ 'is-open': isDetailsOpen, 'is-tree-mode': currentView === 'tree' }"
  >
    <button
      v-if="currentView === 'tree'"
      class="details-toggle-btn"
      @click="emit('update:isDetailsOpen', !isDetailsOpen)"
      title="Details ein/ausblenden"
    >
      <span class="icon">{{ isDetailsOpen ? '▶' : '◀' }}</span>
      <span class="toggle-text" v-if="!isDetailsOpen">Details</span>
    </button>

    <div class="details-scroll-area">
      <template v-if="selectedPerson">
        <h2>
          {{ t('details_title') }}: {{ selectedPerson.surname }}, {{ selectedPerson.given_name }}
        </h2>

        <div class="detail-section">
          <h3>{{ t('section_life') }}</h3>
          <table class="detail-table">
            <tbody>
              <tr v-for="col in activeDetailColumns" :key="'det-' + col.key">
                <td>
                  <strong>
                    {{ getColLabel(col) }}
                    <span v-if="col.key === 'id'" style="color: #e74c3c;"> *</span>
                  </strong>
                </td>
                <td>
                  <template v-if="!isEditing || !col.editable">
                    <span v-if="col.key === 'henry_code'">
                      <strong>{{ getCode(selectedPerson) || '-' }}</strong>
                    </span>
                    <span v-else-if="col.key === 'generation'">
                      {{ getGen(selectedPerson) ?? '-' }}
                    </span>
                    <span v-else-if="col.key === 'id'">
                      <small><strong>{{ selectedPerson.id }}</strong></small>
                    </span>
                    <span v-else>{{ getPersonAttr(selectedPerson, col.key) || '-' }}</span>
                  </template>
                  <template v-else-if="editedPersons.get(selectedPerson.id)">
                    <select
                      v-if="col.key === 'sex'"
                      :value="editedPersons.get(selectedPerson.id)!.sex || 'U'"
                      @change="
                        setPersonAttr(
                          editedPersons.get(selectedPerson.id)!,
                          'sex',
                          ($event.target as HTMLSelectElement).value
                        )
                      "
                      class="w-100"
                    >
                      <option value="M">M</option>
                      <option value="F">F</option>
                      <option value="U">U</option>
                    </select>
                    <div v-else-if="col.key === 'id'" class="xref-input-wrapper">
                      <input
                        :value="getPersonAttr(editedPersons.get(selectedPerson.id)!, col.key) ?? ''"
                        @input="
                          setPersonAttr(
                            editedPersons.get(selectedPerson.id)!,
                            col.key,
                            ($event.target as HTMLInputElement).value
                          )
                        "
                        @focus="activeIdField = 'detail-' + selectedPerson.id"
                        @blur="activeIdField = null"
                        :class="{
                          'input-warning': !isValidGedcomXref(editedPersons.get(selectedPerson.id)?.id),
                        }"
                        :placeholder="t('field_required')"
                        class="w-100"
                      />
                      <div
                        v-if="activeIdField === 'detail-' + selectedPerson.id"
                        class="xref-tooltip"
                        @mousedown.prevent
                      >
                        <div class="xref-tooltip-header">
                          <span>📌 {{ t('xref_tooltip_title') }}</span>
                          <span
                            :class="
                              isValidGedcomXref(editedPersons.get(selectedPerson.id)?.id)
                                ? 'xref-badge-valid'
                                : 'xref-badge-invalid'
                            "
                          >
                            {{
                              isValidGedcomXref(editedPersons.get(selectedPerson.id)?.id)
                                ? '✓ ' + t('xref_valid')
                                : '⚠️ ' + t('xref_invalid')
                            }}
                          </span>
                        </div>
                        <div class="xref-tooltip-body">
                          {{ t('xref_tooltip_desc') }}
                        </div>
                      </div>
                    </div>
                    <input
                      v-else
                      :value="getPersonAttr(editedPersons.get(selectedPerson.id)!, col.key) ?? ''"
                      @input="
                        setPersonAttr(
                          editedPersons.get(selectedPerson.id)!,
                          col.key,
                          ($event.target as HTMLInputElement).value
                        )
                      "
                      class="w-100"
                    />
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-if="saveErrorAlert" class="parent-error-alert mt-1 mb-1">
            ⚠️ {{ saveErrorAlert }}
          </div>
          <button
            v-if="isEditing"
            class="btn-save w-100 mt-1"
            @click="emit('save-changes')"
            :disabled="isLoading || hasInvalidEditedPerson"
          >
            {{ t('save_changes') }}
          </button>
        </div>

        <div class="detail-section" v-if="personDetails && personDetails.notes.length > 0">
          <h3>{{ t('section_notes') }}</h3>
          <ul class="notes-list">
            <li v-for="(note, idx) in personDetails.notes" :key="idx">{{ note }}</li>
          </ul>
        </div>

        <div class="detail-section" v-if="personDetails">
          <h3>{{ t('section_relations') }}</h3>

          <h4>{{ t('parents') }}</h4>

          <!-- Edit-Modus: Verwandtschaftsverhältnisse editieren -->
          <div v-if="isEditing" class="edit-parents-box">
            <div v-if="parentEditError" class="parent-error-alert">
              ⚠️ {{ parentEditError }}
            </div>
            <div class="form-group mb-1">
              <label><strong>{{ t('father') }}:</strong></label>
              <select
                :value="selectedFatherId"
                @change="emit('update:selectedFatherId', ($event.target as HTMLSelectElement).value)"
                class="w-100"
              >
                <option value="">{{ t('no_parent') }}</option>
                <option v-for="p in malePersons" :key="'f-' + p.id" :value="p.id">
                  {{ p.surname || 'N.N.' }}, {{ p.given_name || 'N.N.' }} ({{ p.id }})
                </option>
              </select>
            </div>
            <div class="form-group mb-1">
              <label><strong>{{ t('mother') }}:</strong></label>
              <select
                :value="selectedMotherId"
                @change="emit('update:selectedMotherId', ($event.target as HTMLSelectElement).value)"
                class="w-100"
              >
                <option value="">{{ t('no_parent') }}</option>
                <option v-for="p in femalePersons" :key="'m-' + p.id" :value="p.id">
                  {{ p.surname || 'N.N.' }}, {{ p.given_name || 'N.N.' }} ({{ p.id }})
                </option>
              </select>
            </div>
            <button class="btn-save-parents" @click="emit('save-parents')" :disabled="isLoading">
              💾 {{ t('save_parents') }}
            </button>
          </div>

          <!-- Lese-Modus: Eltern auflisten -->
          <ul class="relation-list" v-else-if="personDetails.parents.length > 0">
            <li v-for="p in personDetails.parents" :key="p.id">
              <strong>{{ p.surname }}, {{ p.given_name }}</strong>
              <span class="badge ml-1" v-if="getRelCode(p.id)">[{{ getRelCode(p.id) }}]</span>
              <div class="marriage-info">
                (* {{ p.birth_date || '?' }}<span v-if="p.death_date"> - † {{ p.death_date }}</span>)
              </div>
            </li>
          </ul>
          <p v-else class="sub-empty">-</p>

          <h4>{{ t('spouses') }}</h4>
          <ul class="relation-list" v-if="personDetails.spouses.length > 0">
            <li v-for="sp in personDetails.spouses" :key="sp.family_id">
              <strong>{{ sp.partner_name || 'Unbekannt' }}</strong>
              <template v-if="getRelCode(sp.partner_id) || sp.partner_henry">
                <span
                  v-if="sp.partner_id"
                  class="badge ml-1 clickable-henry"
                  :title="t('jump_to_spouse_tooltip')"
                  @click="emit('jump-to', sp.partner_id)"
                >
                  [{{ getRelCode(sp.partner_id) || sp.partner_henry }}] 🔗
                </span>
                <span v-else class="badge ml-1">
                  [{{ getRelCode(sp.partner_id) || sp.partner_henry }}]
                </span>
              </template>
              <span
                v-else-if="sp.partner_id"
                class="badge ml-1 clickable-henry"
                :title="t('jump_to_spouse_tooltip')"
                @click="emit('jump-to', sp.partner_id)"
              >
                🔗
              </span>
              <div class="marriage-info">
                (* {{ sp.partner_birth || '?'
                }}<span v-if="sp.partner_death"> - † {{ sp.partner_death }}</span>)
              </div>
              <div class="marriage-info">
                ⚭ {{ t('wedding_date') }}: {{ sp.marriage_date || '-' }}
                <span v-if="sp.is_divorced || sp.divorce_date">
                  | ⚮ {{ t('divorce_date') }}: {{ sp.divorce_date || 'Ja' }}
                </span>
              </div>
            </li>
          </ul>
          <p v-else class="sub-empty">-</p>

          <h4>{{ t('children') }}</h4>
          <ul class="relation-list" v-if="personDetails.children.length > 0">
            <li v-for="c in personDetails.children" :key="c.id">
              <strong>{{ c.surname }}, {{ c.given_name }}</strong>
              <span class="badge ml-1" v-if="getRelCode(c.id)">[{{ getRelCode(c.id) }}]</span>
              <div class="marriage-info">
                (* {{ c.birth_date || '?' }}<span v-if="c.death_date"> - † {{ c.death_date }}</span>)
              </div>
            </li>
          </ul>
          <p v-else class="sub-empty">-</p>
        </div>
      </template>

      <template v-else>
        <div class="placeholder">
          <p>{{ t('select_prompt') }}</p>
        </div>
      </template>
    </div>

    <!-- Fester Bereich ganz unten im Bereich der Eintragsdetails: Suchfeld für "Kürzesten Pfad" -->
    <ShortestPathModal
      v-if="selectedPerson"
      mode="footer"
      :search-query="shortestPathSearchQuery"
      :include-spouses="shortestPathIncludeSpouses"
      :search-results="shortestPathSearchResults"
      :get-code="getCode"
      @update:search-query="emit('update:shortestPathSearchQuery', $event)"
      @update:include-spouses="emit('update:shortestPathIncludeSpouses', $event)"
      @start-path="emit('start-shortest-path', $event)"
    />
  </div>
</template>

<style scoped>
.details-pane {
  background: white;
  display: flex;
  flex-direction: column;
  position: relative;
}
.details-pane:not(.is-tree-mode) {
  border: 1px solid #dcdde1;
  border-radius: 4px;
  max-height: 70vh;
}
.details-pane.is-tree-mode {
  position: absolute;
  top: 0;
  right: 0;
  height: 100%;
  width: 400px;
  z-index: 100;
  border-left: 1px solid #dcdde1;
  box-shadow: -4px 0 15px rgba(0, 0, 0, 0.1);
  transform: translateX(100%);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  background: rgba(255, 255, 255, 0.98);
}
.details-pane.is-tree-mode.is-open {
  transform: translateX(0);
}
.details-scroll-area {
  padding: 1.2rem;
  overflow-y: auto;
  flex-grow: 1;
  display: flex;
  flex-direction: column;
}
.placeholder {
  margin: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #718093;
  text-align: center;
  height: 100%;
}
.details-toggle-btn {
  position: absolute;
  left: -40px;
  bottom: 20px;
  width: 40px;
  background: white;
  border: 1px solid #dcdde1;
  border-right: none;
  border-radius: 15px 0 0 15px;
  box-shadow: -3px 0 8px rgba(0, 0, 0, 0.08);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #2c3e50;
  z-index: 101;
  padding: 15px 5px;
  transition: background 0.2s ease;
}
.details-toggle-btn:hover {
  background: #f8f9fa;
}
.details-toggle-btn .icon {
  font-size: 0.9rem;
  margin-bottom: 5px;
}
.details-toggle-btn .toggle-text {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  font-size: 0.85rem;
  font-weight: bold;
  letter-spacing: 2px;
  color: #7f8c8d;
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
.btn-save {
  background-color: #2ecc71 !important;
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
.detail-section {
  margin-bottom: 1.5rem;
}
.detail-section h3 {
  font-size: 1.1rem;
  border-bottom: 2px solid #3498db;
  padding-bottom: 0.3rem;
  color: #2c3e50;
  margin-bottom: 0.75rem;
}
.detail-section h4 {
  font-size: 0.95rem;
  margin: 0.5rem 0 0.2rem 0;
  color: #34495e;
}
table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}
.detail-table {
  width: 100%;
  border: 1px solid #e9ecef;
}
.detail-table td {
  padding: 0.4rem 0.6rem;
  border-bottom: 1px solid #e9ecef;
  font-size: 0.85rem;
}
.relation-list {
  margin: 0;
  padding-left: 1.2rem;
  font-size: 0.85rem;
}
.relation-list li {
  margin-bottom: 8px;
}
.badge {
  background: #34495e;
  color: white;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.75rem;
}
.clickable-henry {
  background: #2980b9;
  cursor: pointer;
  transition: background 0.15s, transform 0.1s;
  display: inline-block;
}
.clickable-henry:hover {
  background: #e67e22;
  transform: scale(1.05);
}
.ml-1 {
  margin-left: 5px;
}
.marriage-info {
  font-size: 0.75rem;
  color: #7f8c8d;
  margin-top: 2px;
}
.edit-parents-box {
  background: #fff8e1;
  border: 1px solid #ffe082;
  padding: 12px;
  border-radius: 6px;
  margin-bottom: 12px;
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
.btn-save-parents {
  background-color: #27ae60 !important;
  width: 100%;
  margin-top: 6px;
  padding: 0.5rem;
}
.btn-save-parents:hover:not(:disabled) {
  background-color: #219653 !important;
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

