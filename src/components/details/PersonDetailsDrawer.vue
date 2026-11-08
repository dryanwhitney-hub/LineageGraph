<script setup lang="ts">
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import ShortestPathModal from '../modals/ShortestPathModal.vue';
import {
  isValidGedcomXref,
  type Person,
  type PersonDetails,
  type ColumnConfig,
  type EditableSpouseData,
} from '../../composables/usePersons';

const props = defineProps<{
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
  allPersons?: Person[];
  editedSpouses?: Map<string, EditableSpouseData>;
  marriageEditError?: string;
  relationActionError?: string;
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
  'update-spouse': [payload: { familyId: string; field: 'marriage_date' | 'divorce_date' | 'is_divorced'; value: any }];
  'save-marriage': [familyId: string];
  'link-spouses': [partnerId: string];
  'unlink-family': [familyId: string];
  'add-child-link': [childId: string];
  'remove-child-link': [childId: string];
  'save-changes': [];
  'save-parents': [];
  'jump-to': [personId: string];
  'start-shortest-path': [targetPersonId: string];
}>();

const { t } = useI18n();
const activeIdField = ref<string | null>(null);

const fatherSearchQuery = ref<string>('');
const motherSearchQuery = ref<string>('');
const partnerSearchQuery = ref<string>('');
const childSearchQuery = ref<string>('');

const openPicker = ref<'father' | 'mother' | 'partner' | 'child' | null>(null);

function togglePicker(which: 'father' | 'mother' | 'partner' | 'child') {
  openPicker.value = openPicker.value === which ? null : which;
}

function formatPersonLabel(p: Person | undefined, fallbackId?: string): string {
  if (!p) return fallbackId || '';
  const s = p.surname || 'N.N.';
  const g = p.given_name || 'N.N.';
  const b = p.birth_date ? ` *${p.birth_date}` : '';
  return `${s}, ${g} (${p.id})${b}`;
}

const selectedFatherLabel = computed(() => {
  if (!props.selectedFatherId) return t('no_parent');
  const found = (props.allPersons || props.malePersons).find(p => p.id === props.selectedFatherId);
  return formatPersonLabel(found, props.selectedFatherId);
});

const selectedMotherLabel = computed(() => {
  if (!props.selectedMotherId) return t('no_parent');
  const found = (props.allPersons || props.femalePersons).find(p => p.id === props.selectedMotherId);
  return formatPersonLabel(found, props.selectedMotherId);
});

const filteredFatherList = computed<Person[]>(() => {
  const q = fatherSearchQuery.value.toLowerCase().trim();
  let list = props.malePersons;
  if (q) {
    list = list.filter(
      p =>
        p.id.toLowerCase().includes(q) ||
        (p.surname || '').toLowerCase().includes(q) ||
        (p.given_name || '').toLowerCase().includes(q)
    );
  }
  return list.slice(0, 60);
});

const filteredMotherList = computed<Person[]>(() => {
  const q = motherSearchQuery.value.toLowerCase().trim();
  let list = props.femalePersons;
  if (q) {
    list = list.filter(
      p =>
        p.id.toLowerCase().includes(q) ||
        (p.surname || '').toLowerCase().includes(q) ||
        (p.given_name || '').toLowerCase().includes(q)
    );
  }
  return list.slice(0, 60);
});

const availablePartnerCandidates = computed<Person[]>(() => {
  if (!props.allPersons || !props.selectedPerson) return [];
  const currentSpouseIds = new Set(
    (props.personDetails?.spouses || []).map(s => s.partner_id).filter(Boolean)
  );
  const q = partnerSearchQuery.value.toLowerCase().trim();
  let list = props.allPersons.filter(
    p => p.id !== props.selectedPerson!.id && !currentSpouseIds.has(p.id)
  );
  if (q) {
    list = list.filter(
      p =>
        p.id.toLowerCase().includes(q) ||
        (p.surname || '').toLowerCase().includes(q) ||
        (p.given_name || '').toLowerCase().includes(q)
    );
  }
  return list.slice(0, 60);
});

const availableChildCandidates = computed<Person[]>(() => {
  if (!props.allPersons || !props.selectedPerson) return [];
  const currentChildIds = new Set(
    (props.personDetails?.children || []).map(c => c.id)
  );
  const currentParentIds = new Set(
    (props.personDetails?.parents || []).map(p => p.id)
  );
  const q = childSearchQuery.value.toLowerCase().trim();
  let list = props.allPersons.filter(
    p =>
      p.id !== props.selectedPerson!.id &&
      !currentChildIds.has(p.id) &&
      !currentParentIds.has(p.id)
  );
  if (q) {
    list = list.filter(
      p =>
        p.id.toLowerCase().includes(q) ||
        (p.surname || '').toLowerCase().includes(q) ||
        (p.given_name || '').toLowerCase().includes(q)
    );
  }
  return list.slice(0, 60);
});

function selectFather(id: string) {
  emit('update:selectedFatherId', id);
  openPicker.value = null;
  fatherSearchQuery.value = '';
}

function selectMother(id: string) {
  emit('update:selectedMotherId', id);
  openPicker.value = null;
  motherSearchQuery.value = '';
}

function handleLinkSpouseById(partnerId: string) {
  if (partnerId) {
    emit('link-spouses', partnerId);
    openPicker.value = null;
    partnerSearchQuery.value = '';
  }
}

function handleUnlinkSpouse(familyId: string) {
  if (window.confirm(t('confirm_unlink_spouse'))) {
    emit('unlink-family', familyId);
  }
}

function handleAddChildById(childId: string) {
  if (childId) {
    emit('add-child-link', childId);
    openPicker.value = null;
    childSearchQuery.value = '';
  }
}

function handleRemoveChild(childId: string) {
  if (window.confirm(t('confirm_unlink_child'))) {
    emit('remove-child-link', childId);
  }
}
</script>

<template>
  <aside
    v-if="currentView !== 'design' && currentView !== 'export'"
    class="details-pane"
    :class="{
      'is-open': isDetailsOpen && !!selectedPerson,
      'has-person': !!selectedPerson,
      'is-tree-mode': currentView === 'tree',
    }"
    @click="openPicker = null"
  >
    <button
      v-if="selectedPerson"
      class="details-toggle-btn"
      @click.stop="emit('update:isDetailsOpen', !isDetailsOpen)"
      :title="isDetailsOpen ? t('details_collapse_tooltip') : t('details_expand_tooltip')"
    >
      <span class="icon">{{ isDetailsOpen ? '▶' : '◀' }}</span>
      <span class="toggle-text" v-if="!isDetailsOpen">{{ t('details_title') }}</span>
    </button>

    <div class="details-inner" v-if="isDetailsOpen && selectedPerson">
      <div class="details-header">
        <div class="details-header-titles">
          <span class="details-kicker">{{ t('details_title') }}</span>
          <h2 class="details-person-name">
            {{ selectedPerson.surname || 'N.N.' }}, {{ selectedPerson.given_name || 'N.N.' }}
          </h2>
          <div class="details-badges">
            <span class="meta-badge" v-if="getCode(selectedPerson)">
              {{ t('col_henry') }}: {{ getCode(selectedPerson) }}
            </span>
            <span class="meta-badge" v-if="getGen(selectedPerson) !== null">
              {{ t('col_gen') }} {{ getGen(selectedPerson) }}
            </span>
            <span class="meta-badge id-badge">{{ selectedPerson.id }}</span>
          </div>
        </div>
        <button
          type="button"
          class="btn-drawer-close"
          :title="t('details_collapse_tooltip')"
          @click="emit('update:isDetailsOpen', false)"
        >
          ✕
        </button>
      </div>

      <div class="details-scroll-area">
        <div v-if="saveErrorAlert || parentEditError || marriageEditError || relationActionError" class="parent-error-alert">
          ⚠️ {{ saveErrorAlert || parentEditError || marriageEditError || relationActionError }}
        </div>

        <div class="detail-section">
          <h3>{{ t('section_life') }}</h3>
          <table class="detail-table">
            <tbody>
              <tr v-for="col in activeDetailColumns" :key="'det-' + col.key">
                <td class="attr-label-cell">
                  {{ getColLabel(col) }}
                  <span v-if="col.key === 'id'" style="color: #dc2626;"> *</span>
                </td>
                <td class="attr-val-cell">
                  <template v-if="!isEditing || !col.editable">
                    <span v-if="col.key === 'henry_code'">
                      <strong>{{ getCode(selectedPerson) || '-' }}</strong>
                    </span>
                    <span v-else-if="col.key === 'generation'">
                      {{ getGen(selectedPerson) ?? '-' }}
                    </span>
                    <span v-else-if="col.key === 'id'">
                      <code class="xref-code">{{ selectedPerson.id }}</code>
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
                      <option value="M">{{ t('details_sex_m') }}</option>
                      <option value="F">{{ t('details_sex_f') }}</option>
                      <option value="U">{{ t('details_sex_u') }}</option>
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

          <!-- Edit-Modus: Eltern über suchbares Auswahlfeld zuweisen -->
          <div v-if="isEditing" class="edit-parents-box" @click.stop>
            <!-- Vater -->
            <div class="picker-field">
              <label>{{ t('father') }}:</label>
              <div class="searchable-picker">
                <button
                  type="button"
                  class="picker-trigger-btn"
                  @click.stop="togglePicker('father')"
                >
                  <span class="picker-trigger-text">{{ selectedFatherLabel }}</span>
                  <span class="picker-chevron">▾</span>
                </button>
                <div v-if="openPicker === 'father'" class="picker-dropdown" @click.stop>
                  <input
                    v-model="fatherSearchQuery"
                    type="text"
                    class="picker-search-input"
                    :placeholder="t('details_search_person_placeholder')"
                  />
                  <div class="picker-options-list">
                    <div
                      class="picker-option"
                      :class="{ active: !selectedFatherId }"
                      @click="selectFather('')"
                    >
                      <em>{{ t('no_parent') }}</em>
                    </div>
                    <div
                      v-for="p in filteredFatherList"
                      :key="'f-' + p.id"
                      class="picker-option"
                      :class="{ active: selectedFatherId === p.id }"
                      @click="selectFather(p.id)"
                    >
                      {{ p.surname || 'N.N.' }}, {{ p.given_name || 'N.N.' }}
                      <span class="picker-opt-meta">({{ p.id }})</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Mutter -->
            <div class="picker-field">
              <label>{{ t('mother') }}:</label>
              <div class="searchable-picker">
                <button
                  type="button"
                  class="picker-trigger-btn"
                  @click.stop="togglePicker('mother')"
                >
                  <span class="picker-trigger-text">{{ selectedMotherLabel }}</span>
                  <span class="picker-chevron">▾</span>
                </button>
                <div v-if="openPicker === 'mother'" class="picker-dropdown" @click.stop>
                  <input
                    v-model="motherSearchQuery"
                    type="text"
                    class="picker-search-input"
                    :placeholder="t('details_search_person_placeholder')"
                  />
                  <div class="picker-options-list">
                    <div
                      class="picker-option"
                      :class="{ active: !selectedMotherId }"
                      @click="selectMother('')"
                    >
                      <em>{{ t('no_parent') }}</em>
                    </div>
                    <div
                      v-for="p in filteredMotherList"
                      :key="'m-' + p.id"
                      class="picker-option"
                      :class="{ active: selectedMotherId === p.id }"
                      @click="selectMother(p.id)"
                    >
                      {{ p.surname || 'N.N.' }}, {{ p.given_name || 'N.N.' }}
                      <span class="picker-opt-meta">({{ p.id }})</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Lese-Modus: Eltern auflisten (klickbar zum Springen) -->
          <ul class="relation-cards" v-else-if="personDetails.parents.length > 0">
            <li
              v-for="p in personDetails.parents"
              :key="p.id"
              class="rel-card clickable-rel"
              @click="emit('jump-to', p.id)"
              :title="t('jump_to_spouse_tooltip')"
            >
              <div class="rel-card-top">
                <span class="rel-name">{{ p.surname || 'N.N.' }}, {{ p.given_name || 'N.N.' }}</span>
                <span class="badge clickable-henry" v-if="getRelCode(p.id)">
                  {{ getRelCode(p.id) }} ↪
                </span>
                <span class="badge clickable-henry" v-else>↪</span>
              </div>
              <div class="marriage-info">
                * {{ p.birth_date || '?' }}<span v-if="p.death_date"> · † {{ p.death_date }}</span>
              </div>
            </li>
          </ul>
          <p v-else class="sub-empty">-</p>

          <h4>{{ t('spouses') }}</h4>
          <ul class="relation-cards" v-if="personDetails.spouses.length > 0">
            <li v-for="sp in personDetails.spouses" :key="sp.family_id" class="rel-card">
              <div
                class="rel-card-top"
                :class="{ 'clickable-rel': !!sp.partner_id }"
                @click="sp.partner_id && emit('jump-to', sp.partner_id)"
              >
                <span class="rel-name">⚭ {{ sp.partner_name || '-' }}</span>
                <span
                  v-if="sp.partner_id"
                  class="badge clickable-henry"
                  :title="t('jump_to_spouse_tooltip')"
                >
                  {{ getRelCode(sp.partner_id) || sp.partner_henry || '' }} ↪
                </span>
              </div>
              <div class="marriage-info">
                * {{ sp.partner_birth || '?' }}<span v-if="sp.partner_death"> · † {{ sp.partner_death }}</span>
              </div>

              <!-- Edit-Modus: Eheeintrag bearbeiten (wird zentral über den Footer-Speichern-Button gespeichert) -->
              <div v-if="isEditing" class="edit-spouse-box">
                <div class="picker-field">
                  <label>⚭ {{ t('wedding_date') }}:</label>
                  <input
                    type="text"
                    class="w-100"
                    placeholder="12.05.1950 / 12 MAY 1950"
                    :value="editedSpouses?.get(sp.family_id)?.marriage_date ?? sp.marriage_date ?? ''"
                    @input="emit('update-spouse', { familyId: sp.family_id, field: 'marriage_date', value: ($event.target as HTMLInputElement).value })"
                  />
                </div>
                <div class="picker-field">
                  <label>⚮ {{ t('divorce_date') }}:</label>
                  <input
                    type="text"
                    class="w-100"
                    placeholder="01.06.1970 / 01 JUN 1970"
                    :value="editedSpouses?.get(sp.family_id)?.divorce_date ?? sp.divorce_date ?? ''"
                    @input="emit('update-spouse', { familyId: sp.family_id, field: 'divorce_date', value: ($event.target as HTMLInputElement).value })"
                  />
                </div>
                <div class="spouse-edit-footer">
                  <label class="checkbox-label">
                    <input
                      type="checkbox"
                      :checked="editedSpouses?.get(sp.family_id)?.is_divorced ?? sp.is_divorced"
                      @change="emit('update-spouse', { familyId: sp.family_id, field: 'is_divorced', value: ($event.target as HTMLInputElement).checked })"
                    />
                    <span>{{ t('is_divorced') }}</span>
                  </label>
                  <button
                    type="button"
                    class="btn-unlink-spouse"
                    @click="handleUnlinkSpouse(sp.family_id)"
                    :disabled="isLoading"
                  >
                    🗑️ {{ t('unlink_spouse_btn') }}
                  </button>
                </div>
              </div>

              <!-- Lese-Modus: Ehedaten anzeigen -->
              <div v-else class="marriage-info">
                ⚭ {{ t('wedding_date') }}: {{ sp.marriage_date || '-' }}
                <span v-if="sp.is_divorced || sp.divorce_date">
                  · ⚮ {{ t('divorce_date') }}: {{ sp.divorce_date || '✓' }}
                </span>
              </div>
            </li>
          </ul>
          <p v-else class="sub-empty">-</p>

          <!-- Edit-Modus: Bestehende Person als Ehepartner hinzufügen (Suchbar) -->
          <div v-if="isEditing" class="add-relation-box" @click.stop>
            <div class="searchable-picker">
              <button
                type="button"
                class="picker-trigger-btn add-trigger"
                @click.stop="togglePicker('partner')"
              >
                <span>{{ t('link_spouse_btn') }}</span>
                <span class="picker-chevron">▾</span>
              </button>
              <div v-if="openPicker === 'partner'" class="picker-dropdown" @click.stop>
                <input
                  v-model="partnerSearchQuery"
                  type="text"
                  class="picker-search-input"
                  :placeholder="t('details_search_person_placeholder')"
                />
                <div class="picker-options-list">
                  <div
                    v-for="p in availablePartnerCandidates"
                    :key="'sp-cand-' + p.id"
                    class="picker-option"
                    @click="handleLinkSpouseById(p.id)"
                  >
                    ➕ {{ p.surname || 'N.N.' }}, {{ p.given_name || 'N.N.' }}
                    <span class="picker-opt-meta">({{ p.id }})</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <h4>{{ t('children') }} ({{ personDetails.children.length }})</h4>
          <ul class="relation-cards" v-if="personDetails.children.length > 0">
            <li
              v-for="c in personDetails.children"
              :key="c.id"
              class="rel-card clickable-rel"
              @click="emit('jump-to', c.id)"
            >
              <div class="rel-card-top">
                <span class="rel-name">{{ c.surname || 'N.N.' }}, {{ c.given_name || 'N.N.' }}</span>
                <div class="rel-card-actions">
                  <span class="badge clickable-henry" v-if="getRelCode(c.id)">
                    {{ getRelCode(c.id) }} ↪
                  </span>
                  <span class="badge clickable-henry" v-else>↪</span>
                  <button
                    v-if="isEditing"
                    type="button"
                    class="btn-unlink-child"
                    :title="t('unlink_child_btn')"
                    @click.stop="handleRemoveChild(c.id)"
                    :disabled="isLoading"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div class="marriage-info">
                * {{ c.birth_date || '?' }}<span v-if="c.death_date"> · † {{ c.death_date }}</span>
              </div>
            </li>
          </ul>
          <p v-else class="sub-empty">-</p>

          <!-- Edit-Modus: Bestehendes Kind zuweisen (Suchbar) -->
          <div v-if="isEditing" class="add-relation-box" @click.stop>
            <div class="searchable-picker">
              <button
                type="button"
                class="picker-trigger-btn add-trigger"
                @click.stop="togglePicker('child')"
              >
                <span>{{ t('add_child_btn') }}</span>
                <span class="picker-chevron">▾</span>
              </button>
              <div v-if="openPicker === 'child'" class="picker-dropdown" @click.stop>
                <input
                  v-model="childSearchQuery"
                  type="text"
                  class="picker-search-input"
                  :placeholder="t('details_search_person_placeholder')"
                />
                <div class="picker-options-list">
                  <div
                    v-for="p in availableChildCandidates"
                    :key="'ch-cand-' + p.id"
                    class="picker-option"
                    @click="handleAddChildById(p.id)"
                  >
                    ➕ {{ p.surname || 'N.N.' }}, {{ p.given_name || 'N.N.' }}
                    <span class="picker-opt-meta">({{ p.id }})</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Zentraler Speichern-Footer im Bearbeitungsmodus (1 Button statt 3 Einzel-Buttons) -->
      <div v-if="isEditing" class="drawer-save-footer">
        <button
          type="button"
          class="btn-save-all"
          @click="emit('save-changes')"
          :disabled="isLoading || hasInvalidEditedPerson"
        >
          {{ t('details_save_all_btn') }}
        </button>
      </div>

      <!-- Fester Bereich ganz unten: Kürzester Pfad -->
      <ShortestPathModal
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
  </aside>
</template>

<style scoped>
.details-pane {
  position: relative;
  height: 100%;
  width: 0;
  flex-shrink: 0;
  background: #ffffff;
  border-left: 1px solid transparent;
  transition: width 0.24s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 40;
}

.details-pane.is-open {
  width: 390px;
  border-left-color: #e2e8f0;
  box-shadow: -4px 0 16px rgba(15, 23, 42, 0.05);
}

.details-pane.is-tree-mode {
  position: absolute;
  top: 0;
  right: 0;
  height: 100%;
  width: 390px;
  border-left: 1px solid #e2e8f0;
  box-shadow: -6px 0 24px rgba(15, 23, 42, 0.12);
  transform: translateX(100%);
  transition: transform 0.26s cubic-bezier(0.4, 0, 0.2, 1);
}

.details-pane.is-tree-mode.is-open {
  transform: translateX(0);
}

.details-inner {
  width: 390px;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #ffffff;
}

.details-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.85rem 1.1rem;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
}

.details-kicker {
  display: block;
  font-size: 0.68rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #64748b;
  margin-bottom: 0.15rem;
}

.details-person-name {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 800;
  color: #0f172a;
  line-height: 1.25;
}

.details-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.4rem;
}

.meta-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.14rem 0.5rem;
  font-size: 0.72rem;
  font-weight: 700;
  border-radius: 999px;
  background: #eff6ff;
  color: #1d4ed8;
  border: 1px solid #bfdbfe;
}

.meta-badge.id-badge {
  background: #f1f5f9;
  color: #475569;
  border-color: #cbd5e1;
  font-family: monospace;
}

.btn-drawer-close {
  background: transparent;
  color: #64748b;
  border: 1px solid transparent;
  border-radius: 6px;
  width: 28px;
  height: 28px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85rem;
  cursor: pointer;
  flex-shrink: 0;
}

.btn-drawer-close:hover {
  background: #e2e8f0;
  color: #0f172a;
}

.details-scroll-area {
  padding: 1rem 1.1rem;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 1.15rem;
}

.details-toggle-btn {
  position: absolute;
  left: -34px;
  bottom: 24px;
  width: 34px;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-right: none;
  border-radius: 10px 0 0 10px;
  box-shadow: -3px 0 10px rgba(15, 23, 42, 0.08);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #334155;
  z-index: 45;
  padding: 12px 4px;
  transition: all 0.15s ease;
}

.details-toggle-btn:hover {
  background: #f8fafc;
  color: #2563eb;
}

.details-toggle-btn .icon {
  font-size: 0.78rem;
}

.details-toggle-btn .toggle-text {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #475569;
  margin-top: 6px;
}

.detail-section h3 {
  font-size: 0.78rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #475569;
  border-bottom: 1px solid #e2e8f0;
  padding-bottom: 0.35rem;
  margin: 0 0 0.65rem 0;
}

.detail-section h4 {
  font-size: 0.8rem;
  font-weight: 700;
  margin: 0.75rem 0 0.35rem 0;
  color: #334155;
}

.detail-table {
  width: 100%;
  border-collapse: collapse;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  overflow: hidden;
}

.detail-table td {
  padding: 0.38rem 0.6rem;
  border-bottom: 1px solid #f1f5f9;
  font-size: 0.82rem;
  vertical-align: middle;
}

.attr-label-cell {
  width: 38%;
  font-weight: 600;
  color: #475569;
  background: #f8fafc;
}

.attr-val-cell {
  color: #0f172a;
}

.xref-code {
  font-size: 0.76rem;
  background: #f1f5f9;
  padding: 1px 5px;
  border-radius: 4px;
  color: #334155;
}

.w-100 {
  width: 100%;
  padding: 0.34rem 0.5rem;
  border: 1px solid #cbd5e1;
  border-radius: 5px;
  font-size: 0.8rem;
  color: #0f172a;
  background: #ffffff;
  box-sizing: border-box;
}

.w-100:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
}

.notes-list {
  margin: 0;
  padding-left: 1.1rem;
  font-size: 0.82rem;
  color: #334155;
  line-height: 1.45;
}

/* Relation Cards */
.relation-cards {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.rel-card {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 7px;
  padding: 0.5rem 0.65rem;
  transition: border-color 0.15s, background-color 0.15s;
}

.rel-card.clickable-rel,
.rel-card-top.clickable-rel {
  cursor: pointer;
}

.rel-card.clickable-rel:hover {
  background: #eff6ff;
  border-color: #bfdbfe;
}

.rel-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.rel-card-actions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.rel-name {
  font-size: 0.83rem;
  font-weight: 700;
  color: #0f172a;
}

.badge {
  background: #e2e8f0;
  color: #334155;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.72rem;
  font-weight: 700;
}

.clickable-henry {
  background: #dbeafe;
  color: #1d4ed8;
  cursor: pointer;
  transition: all 0.15s;
}

.clickable-henry:hover {
  background: #2563eb;
  color: #ffffff;
}

.marriage-info {
  font-size: 0.75rem;
  color: #64748b;
  margin-top: 2px;
}

.sub-empty {
  margin: 0.2rem 0 0.5rem 0;
  font-size: 0.8rem;
  color: #94a3b8;
}

/* Searchable Pickers in Edit Mode */
.edit-parents-box {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  padding: 0.65rem;
  border-radius: 7px;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.picker-field {
  display: flex;
  flex-direction: column;
  gap: 0.22rem;
}

.picker-field label {
  font-size: 0.75rem;
  font-weight: 700;
  color: #475569;
}

.searchable-picker {
  position: relative;
}

.picker-trigger-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.38rem 0.6rem;
  background: #ffffff;
  color: #0f172a;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
}

.picker-trigger-btn:hover {
  border-color: #94a3b8;
}

.picker-trigger-btn.add-trigger {
  background: #eff6ff;
  color: #1d4ed8;
  border: 1px dashed #93c5fd;
}

.picker-trigger-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-chevron {
  color: #64748b;
  font-size: 0.75rem;
}

.picker-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 150;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 7px;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.16);
  padding: 0.45rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.picker-search-input {
  width: 100%;
  padding: 0.34rem 0.5rem;
  border: 1px solid #3b82f6;
  border-radius: 5px;
  font-size: 0.78rem;
  box-sizing: border-box;
}

.picker-search-input:focus {
  outline: none;
}

.picker-options-list {
  max-height: 180px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.picker-option {
  padding: 0.35rem 0.5rem;
  font-size: 0.78rem;
  color: #1e293b;
  border-radius: 4px;
  cursor: pointer;
}

.picker-option:hover {
  background: #eff6ff;
}

.picker-option.active {
  background: #2563eb;
  color: #ffffff;
}

.picker-opt-meta {
  font-size: 0.72rem;
  color: #64748b;
  margin-left: 4px;
}

.picker-option.active .picker-opt-meta {
  color: #dbeafe;
}

.edit-spouse-box {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  padding: 0.55rem;
  border-radius: 6px;
  margin-top: 0.45rem;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.spouse-edit-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-top: 0.15rem;
}

.checkbox-label {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.78rem;
  color: #334155;
  cursor: pointer;
}

.btn-unlink-spouse {
  background: #fee2e2;
  color: #b91c1c;
  border: 1px solid #fecaca;
  border-radius: 5px;
  padding: 0.25rem 0.55rem;
  font-size: 0.74rem;
  font-weight: 700;
  cursor: pointer;
}

.btn-unlink-spouse:hover:not(:disabled) {
  background: #fecaca;
}

.btn-unlink-child {
  background: #fee2e2;
  border: 1px solid #fecaca;
  border-radius: 4px;
  cursor: pointer;
  color: #b91c1c;
  font-size: 0.7rem;
  font-weight: 700;
  padding: 1px 5px;
}

.btn-unlink-child:hover:not(:disabled) {
  background: #fecaca;
}

.add-relation-box {
  margin-top: 0.45rem;
}

.parent-error-alert {
  background: #fef2f2;
  color: #b91c1c;
  border: 1px solid #fecaca;
  padding: 0.5rem 0.65rem;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 600;
}

/* Sticky Save All Footer */
.drawer-save-footer {
  padding: 0.65rem 1.1rem;
  background: #f8fafc;
  border-top: 1px solid #e2e8f0;
  flex-shrink: 0;
}

.btn-save-all {
  width: 100%;
  padding: 0.55rem 0.9rem;
  background: #10b981;
  color: #ffffff;
  border: 1px solid #059669;
  border-radius: 7px;
  font-size: 0.84rem;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(16, 185, 129, 0.25);
  transition: background 0.15s;
}

.btn-save-all:hover:not(:disabled) {
  background: #059669;
}

.btn-save-all:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.input-warning {
  border: 2px solid #f59e0b !important;
  background-color: #fffbeb !important;
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
  min-width: 260px;
  max-width: 320px;
  margin-top: 4px;
  padding: 8px 10px;
  background: #0f172a;
  color: #f8fafc;
  border-radius: 6px;
  font-size: 0.75rem;
  line-height: 1.4;
  box-shadow: 0 6px 16px rgba(15, 23, 42, 0.25);
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
  font-size: 0.72rem;
  color: #cbd5e1;
}

.xref-badge-valid {
  color: #34d399;
  font-weight: bold;
}

.xref-badge-invalid {
  color: #fbbf24;
  font-weight: bold;
}
</style>

