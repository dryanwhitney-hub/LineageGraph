<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { useI18n } from 'vue-i18n';
import type { Person } from '../../composables/usePersons';

export interface FieldDiff {
  field_name: string;
  db_value: string | null;
  staged_value: string | null;
  diff_type: string; // 'identical' | 'addition' | 'conflict'
  chosen_source: string; // 'db' | 'import'
}

export interface PersonDiffItem {
  staged_xref: string;
  db_person_id: string;
  match_confidence: number;
  match_reason: string;
  db_label: string;
  staged_label: string;
  has_conflicts: boolean;
  has_additions: boolean;
  fields: Record<string, FieldDiff>;
  default_extra_action: string; // 'overwrite' | 'append' | 'db'
}

export interface NewPersonItem {
  staged_xref: string;
  label: string;
  given_name: string | null;
  surname: string | null;
  birth_date: string | null;
  death_date: string | null;
}

export interface GedcomMergePlan {
  file_path: string;
  total_staged_persons: number;
  total_staged_families: number;
  mapped_persons: PersonDiffItem[];
  new_persons: NewPersonItem[];
}

export interface MergeResultStats {
  updated_persons_count: number;
  new_persons_count: number;
  new_families_count: number;
  new_parent_child_count: number;
  preserved_parents_count: number;
}

const props = defineProps<{
  visible: boolean;
  filePath: string;
  activeTree: string;
  persons: Person[];
}>();

const emit = defineEmits<{
  close: [];
  imported: [newActiveTree?: string];
}>();

const { t } = useI18n();

// Phasen: 'mode_select' | 'staging_loading' | 'staging_review' | 'merging' | 'completed'
const phase = ref<'mode_select' | 'staging_loading' | 'staging_review' | 'merging' | 'completed'>('mode_select');

// Modus-Auswahl: 'new' | 'replace' | 'merge'
const importMode = ref<'new' | 'replace' | 'merge'>('new');
const newTreeName = ref<string>('');
const isProcessing = ref<boolean>(false);
const errorMessage = ref<string>('');

// Staging-Daten
const mergePlan = ref<GedcomMergePlan | null>(null);
const mergeStats = ref<MergeResultStats | null>(null);

// Benutzerwahlen für Mappings & Diff
interface PersonWorkingState {
  targetDbId: string;
  fieldChoices: Record<string, 'db' | 'import'>;
  extraAction: 'overwrite' | 'append' | 'db';
  isUnlinked: boolean; // Wenn true -> als Neuanlage behandeln
}

const workingMappings = ref<Map<string, PersonWorkingState>>(new Map());
const excludedNewPersonXrefs = ref<Set<string>>(new Set());

// Filter & Pagination
const activeFilterTab = ref<'all_mapped' | 'conflicts_only' | 'new_persons'>('all_mapped');
const pageSize = ref<number>(50);
const currentPage = ref<number>(1);

// Dateiname ableiten
const fileName = computed(() => {
  if (!props.filePath) return '';
  return props.filePath.split(/[\\/]/).pop() || '';
});

// Initialisierung bei Öffnen
watch(
  () => props.visible,
  newVal => {
    if (newVal) {
      phase.value = 'mode_select';
      errorMessage.value = '';
      mergePlan.value = null;
      mergeStats.value = null;
      workingMappings.value.clear();
      excludedNewPersonXrefs.value.clear();
      activeFilterTab.value = 'all_mapped';
      currentPage.value = 1;

      // Vorschlag für neuen Projektnamen
      const cleanStem = fileName.value.replace(/\.ged$/i, '').trim().replace(/[^a-zA-Z0-9_\-]/g, '_');
      newTreeName.value = cleanStem || 'stammbaum_neu';
      importMode.value = props.activeTree ? 'merge' : 'new';
    }
  },
  { immediate: true }
);

// Mappings initialisieren
function initWorkingMappings(plan: GedcomMergePlan) {
  const map = new Map<string, PersonWorkingState>();
  for (const m of plan.mapped_persons) {
    const choices: Record<string, 'db' | 'import'> = {};
    for (const [fname, fdiff] of Object.entries(m.fields)) {
      choices[fname] = fdiff.chosen_source as 'db' | 'import';
    }
    map.set(m.staged_xref, {
      targetDbId: m.db_person_id,
      fieldChoices: choices,
      extraAction: (m.default_extra_action as any) || 'overwrite',
      isUnlinked: false,
    });
  }
  workingMappings.value = map;
}

// Global: Alle übernehmen
function takeAllImportValues() {
  for (const [xref, state] of workingMappings.value.entries()) {
    const original = mergePlan.value?.mapped_persons.find(p => p.staged_xref === xref);
    if (!original) continue;
    for (const fname of Object.keys(original.fields)) {
      state.fieldChoices[fname] = 'import';
    }
    state.extraAction = 'overwrite';
  }
}

// Global: Keine übernehmen (Nur DB)
function keepAllDbValues() {
  for (const [xref, state] of workingMappings.value.entries()) {
    const original = mergePlan.value?.mapped_persons.find(p => p.staged_xref === xref);
    if (!original) continue;
    for (const fname of Object.keys(original.fields)) {
      state.fieldChoices[fname] = 'db';
    }
    state.extraAction = 'db';
  }
}

// Slider-Toggle pro Feld
function toggleFieldSource(stagedXref: string, fieldName: string) {
  const state = workingMappings.value.get(stagedXref);
  if (!state) return;
  const curr = state.fieldChoices[fieldName] || 'db';
  state.fieldChoices[fieldName] = curr === 'db' ? 'import' : 'db';
}

function setFieldSource(stagedXref: string, fieldName: string, source: 'db' | 'import') {
  const state = workingMappings.value.get(stagedXref);
  if (state) {
    state.fieldChoices[fieldName] = source;
  }
}

// Zuordnung lösen
function unlinkMatch(stagedXref: string) {
  const state = workingMappings.value.get(stagedXref);
  if (state) {
    state.isUnlinked = !state.isUnlinked;
  }
}

// Gefilterte gemappte Personen
const filteredMappedPersons = computed(() => {
  if (!mergePlan.value) return [];
  return mergePlan.value.mapped_persons.filter(p => {
    const state = workingMappings.value.get(p.staged_xref);
    if (state?.isUnlinked) return false;
    if (activeFilterTab.value === 'conflicts_only') {
      return p.has_conflicts;
    }
    return true;
  });
});

// Paginierte gemappte Personen
const totalPages = computed(() => {
  const total = filteredMappedPersons.value.length;
  if (total === 0) return 1;
  return Math.ceil(total / pageSize.value);
});

const paginatedMappedPersons = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return filteredMappedPersons.value.slice(start, start + pageSize.value);
});

watch(activeFilterTab, () => {
  currentPage.value = 1;
});
watch(pageSize, () => {
  currentPage.value = 1;
});

// Anzahl Konflikte & Neuanlagen
const conflictCount = computed(() => {
  if (!mergePlan.value) return 0;
  return mergePlan.value.mapped_persons.filter(p => p.has_conflicts).length;
});

const allNewPersons = computed(() => {
  if (!mergePlan.value) return [];
  const list = [...mergePlan.value.new_persons];
  for (const m of mergePlan.value.mapped_persons) {
    const state = workingMappings.value.get(m.staged_xref);
    if (state?.isUnlinked) {
      list.push({
        staged_xref: m.staged_xref,
        label: m.staged_label,
        given_name: m.fields.given_name?.staged_value || null,
        surname: m.fields.surname?.staged_value || null,
        birth_date: m.fields.birth_date?.staged_value || null,
        death_date: m.fields.death_date?.staged_value || null,
      });
    }
  }
  return list;
});

// Staging ausführen (Wechsel zu Phase 2)
async function startStaging() {
  errorMessage.value = '';
  isProcessing.value = true;
  phase.value = 'staging_loading';

  try {
    const plan = await invoke<GedcomMergePlan>('stage_gedcom_for_merge', {
      filePath: props.filePath,
    });
    mergePlan.value = plan;
    initWorkingMappings(plan);
    phase.value = 'staging_review';
  } catch (err: any) {
    errorMessage.value = String(err);
    phase.value = 'mode_select';
  } finally {
    isProcessing.value = false;
  }
}

// Import als neues Projekt oder Ersetzen
async function runDirectImport() {
  errorMessage.value = '';
  isProcessing.value = true;

  try {
    if (importMode.value === 'new') {
      const validName = newTreeName.value.trim();
      if (!validName) {
        errorMessage.value = 'Bitte einen gültigen Projektnamen angeben.';
        isProcessing.value = false;
        return;
      }
      await invoke<number>('create_tree_and_import', {
        filePath: props.filePath,
        treeName: validName,
      });
      emit('imported', validName);
      emit('close');
    } else if (importMode.value === 'replace') {
      await invoke<number>('import_gedcom_file', {
        filePath: props.filePath,
      });
      emit('imported');
      emit('close');
    }
  } catch (err: any) {
    errorMessage.value = String(err);
  } finally {
    isProcessing.value = false;
  }
}

// Merge anwenden (Phase 3)
async function applyMerge() {
  if (!mergePlan.value) return;
  errorMessage.value = '';
  isProcessing.value = true;
  phase.value = 'merging';

  const mappingsPayload = [];
  const newPersonXrefs = [];
  const ignoredXrefs: string[] = [];

  for (const [stagedXref, state] of workingMappings.value.entries()) {
    if (state.isUnlinked) {
      newPersonXrefs.push(stagedXref);
    } else {
      mappingsPayload.push({
        staged_xref: stagedXref,
        target_db_id: state.targetDbId,
        field_choices: state.fieldChoices,
        extra_action: state.extraAction,
      });
    }
  }

  for (const np of mergePlan.value.new_persons) {
    if (excludedNewPersonXrefs.value.has(np.staged_xref)) {
      ignoredXrefs.push(np.staged_xref);
    } else {
      newPersonXrefs.push(np.staged_xref);
    }
  }

  try {
    const stats = await invoke<MergeResultStats>('apply_gedcom_merge', {
      resolution: {
        file_path: props.filePath,
        mappings: mappingsPayload,
        new_person_xrefs: newPersonXrefs,
        ignored_xrefs: ignoredXrefs,
      },
    });
    mergeStats.value = stats;
    phase.value = 'completed';
    emit('imported');
  } catch (err: any) {
    errorMessage.value = String(err);
    phase.value = 'staging_review';
  } finally {
    isProcessing.value = false;
  }
}

function fieldDisplayName(fname: string): string {
  switch (fname) {
    case 'given_name': return 'Vorname';
    case 'surname': return 'Nachname';
    case 'sex': return 'Geschlecht';
    case 'birth_date': return 'Geburtsdatum';
    case 'birth_place': return 'Geburtsort';
    case 'death_date': return 'Sterbedatum';
    case 'death_place': return 'Sterbeort';
    default: return fname;
  }
}
</script>

<template>
  <div v-if="visible" class="modal-overlay" @click.self="emit('close')">
    <div class="modal-content gedcom-import-modal">
      <!-- Kopfzeile -->
      <header class="modal-header">
        <div class="header-titles">
          <h2>🧬 {{ t('gedcom_import_modal_title') }}</h2>
          <span class="file-badge">📁 {{ fileName }}</span>
        </div>
        <button type="button" class="btn-close-icon" @click="emit('close')" :disabled="isProcessing">
          ✕
        </button>
      </header>

      <!-- Fehleranzeige -->
      <div v-if="errorMessage" class="error-banner">
        ⚠️ {{ errorMessage }}
      </div>

      <!-- PHASE 1: MODUSAUSWAHL -->
      <div v-if="phase === 'mode_select'" class="modal-body mode-select-body">
        <p class="section-intro">{{ t('gedcom_import_mode_title') }}</p>

        <div class="mode-options-grid">
          <!-- Modus 1: Neues Projekt -->
          <label class="mode-card" :class="{ selected: importMode === 'new' }">
            <div class="card-radio">
              <input type="radio" value="new" v-model="importMode" />
            </div>
            <div class="card-content">
              <h3>🆕 {{ t('gedcom_import_mode_new') }}</h3>
              <p>{{ t('gedcom_import_mode_new_desc') }}</p>

              <div v-if="importMode === 'new'" class="sub-input-row" @click.stop>
                <label>{{ t('gedcom_import_new_tree_name_label') }}</label>
                <input
                  type="text"
                  v-model="newTreeName"
                  class="name-input"
                  placeholder="name_des_stammbaums"
                />
              </div>
            </div>
          </label>

          <!-- Modus 2: In bestehenden Stammbaum einpflegen (Update / Merge) -->
          <label class="mode-card" :class="{ selected: importMode === 'merge' }">
            <div class="card-radio">
              <input type="radio" value="merge" v-model="importMode" />
            </div>
            <div class="card-content">
              <h3>🔄 {{ t('gedcom_import_mode_merge') }}</h3>
              <p>{{ t('gedcom_import_mode_merge_desc') }}</p>
              <div v-if="activeTree" class="active-tree-pill">
                {{ t('gedcom_import_db_active') }} <strong>{{ activeTree }}</strong>
              </div>
            </div>
          </label>

          <!-- Modus 3: Komplett ersetzen -->
          <label class="mode-card danger-card" :class="{ selected: importMode === 'replace' }">
            <div class="card-radio">
              <input type="radio" value="replace" v-model="importMode" />
            </div>
            <div class="card-content">
              <h3>⚠️ {{ t('gedcom_import_mode_replace') }}</h3>
              <p>{{ t('gedcom_import_mode_replace_desc') }}</p>
              <div v-if="importMode === 'replace'" class="replace-alert">
                {{ t('gedcom_import_replace_warning') }}
              </div>
            </div>
          </label>
        </div>

        <footer class="modal-footer">
          <button type="button" class="btn-secondary" @click="emit('close')">
            {{ t('gedcom_import_btn_cancel') }}
          </button>
          <button
            v-if="importMode === 'merge'"
            type="button"
            class="btn-primary"
            :disabled="isProcessing"
            @click="startStaging"
          >
            {{ t('gedcom_import_btn_start_merge') }} →
          </button>
          <button
            v-else-if="importMode === 'new'"
            type="button"
            class="btn-primary"
            :disabled="isProcessing || !newTreeName.trim()"
            @click="runDirectImport"
          >
            {{ t('gedcom_import_btn_run_new') }}
          </button>
          <button
            v-else
            type="button"
            class="btn-danger"
            :disabled="isProcessing"
            @click="runDirectImport"
          >
            {{ t('gedcom_import_btn_run_replace') }}
          </button>
        </footer>
      </div>

      <!-- LADEZUSTAND BEIM STAGING -->
      <div v-else-if="phase === 'staging_loading'" class="modal-body loading-body">
        <div class="spinner">⏳</div>
        <p>Analysiere GEDCOM-Datei und gleiche Personen ab...</p>
      </div>

      <!-- PHASE 2: RECONCILIATION & DIFF REVIEW -->
      <div v-else-if="phase === 'staging_review'" class="modal-body staging-body">
        <!-- Übersichts-Leiste mit Statistiken & Global-Aktionen -->
        <div class="staging-toolbar">
          <div class="stats-group">
            <span class="stat-badge mapped">
              <strong>{{ mergePlan?.mapped_persons.length || 0 }}</strong> {{ t('gedcom_import_stats_mapped') }}
            </span>
            <span class="stat-badge conflicts" v-if="conflictCount > 0">
              <strong>{{ conflictCount }}</strong> {{ t('gedcom_import_stats_conflicts') }}
            </span>
            <span class="stat-badge new">
              <strong>{{ allNewPersons.length }}</strong> {{ t('gedcom_import_stats_new') }}
            </span>
          </div>

          <div class="global-actions">
            <button type="button" class="btn-quick-action" @click="takeAllImportValues">
              ✓ {{ t('gedcom_import_btn_take_all') }}
            </button>
            <button type="button" class="btn-quick-action secondary" @click="keepAllDbValues">
              🛡️ {{ t('gedcom_import_btn_take_none') }}
            </button>
          </div>
        </div>

        <!-- Filter-Reiter & Pagination-Kopfzeile -->
        <div class="staging-subbar">
          <div class="filter-tabs">
            <button
              type="button"
              class="tab-btn"
              :class="{ active: activeFilterTab === 'all_mapped' }"
              @click="activeFilterTab = 'all_mapped'"
            >
              {{ t('gedcom_import_filter_all_mapped', { count: mergePlan?.mapped_persons.length || 0 }) }}
            </button>
            <button
              type="button"
              class="tab-btn"
              :class="{ active: activeFilterTab === 'conflicts_only' }"
              @click="activeFilterTab = 'conflicts_only'"
            >
              {{ t('gedcom_import_filter_conflicts_only', { count: conflictCount }) }}
            </button>
            <button
              type="button"
              class="tab-btn"
              :class="{ active: activeFilterTab === 'new_persons' }"
              @click="activeFilterTab = 'new_persons'"
            >
              {{ t('gedcom_import_filter_new_persons', { count: allNewPersons.length }) }}
            </button>
          </div>

          <!-- Pagination Bar bei gemappten Tabs -->
          <div v-if="activeFilterTab !== 'new_persons'" class="pagination-bar">
            <label class="page-size-label">
              <span>Einträge:</span>
              <select v-model.number="pageSize" class="page-size-select">
                <option :value="25">25</option>
                <option :value="50">50</option>
                <option :value="100">100</option>
                <option :value="500">500</option>
              </select>
            </label>

            <div class="page-nav">
              <button
                type="button"
                class="btn-nav"
                :disabled="currentPage <= 1"
                @click="currentPage--"
              >
                ◀
              </button>
              <span class="page-info">{{ currentPage }} / {{ totalPages }}</span>
              <button
                type="button"
                class="btn-nav"
                :disabled="currentPage >= totalPages"
                @click="currentPage++"
              >
                ▶
              </button>
            </div>
          </div>
        </div>

        <!-- INHALT: GEMAPPTE PERSONEN CARDS -->
        <div v-if="activeFilterTab !== 'new_persons'" class="cards-container">
          <div
            v-if="paginatedMappedPersons.length === 0"
            class="empty-tab-hint"
          >
            Keine Personen für diesen Filter gefunden.
          </div>

          <div
            v-for="p in paginatedMappedPersons"
            :key="'diff-' + p.staged_xref"
            class="person-diff-card"
            :class="{ 'has-conflicts': p.has_conflicts }"
          >
            <!-- Card-Header mit Mapping-Info -->
            <div class="diff-card-header">
              <div class="match-info">
                <span class="staged-tag">Import: {{ p.staged_label }}</span>
                <span class="match-arrow">➔</span>
                <span class="db-tag">DB: {{ p.db_label }}</span>
              </div>

              <div class="match-meta">
                <span class="confidence-badge" :class="'conf-' + p.match_confidence">
                  {{ p.match_confidence }}% Match ({{ p.match_reason }})
                </span>
                <button
                  type="button"
                  class="btn-unlink"
                  @click="unlinkMatch(p.staged_xref)"
                  :title="t('gedcom_import_unlink_match')"
                >
                  ⚡ {{ t('gedcom_import_unlink_match') }}
                </button>
              </div>
            </div>

            <!-- Feldvergleichstabelle mit Slidern -->
            <table class="diff-table">
              <thead>
                <tr>
                  <th style="width: 140px">{{ t('gedcom_import_col_field') }}</th>
                  <th style="width: 200px">{{ t('gedcom_import_col_db') }}</th>
                  <th style="width: 130px; text-align: center">{{ t('gedcom_import_slider_title') }}</th>
                  <th>{{ t('gedcom_import_col_import') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(fdiff, fname) in p.fields"
                  :key="fname"
                  :class="'row-' + fdiff.diff_type"
                >
                  <td class="cell-field">{{ fieldDisplayName(fname as string) }}</td>
                  <td class="cell-db">
                    <span :class="{ 'chosen-text': workingMappings.get(p.staged_xref)?.fieldChoices[fname] === 'db' }">
                      {{ fdiff.db_value || '—' }}
                    </span>
                  </td>
                  <td class="cell-slider">
                    <!-- 2-Wege Slider / Umschalter -->
                    <div
                      class="slider-toggle-wrap"
                      :class="{ 'side-import': workingMappings.get(p.staged_xref)?.fieldChoices[fname] === 'import' }"
                      @click="toggleFieldSource(p.staged_xref, fname as string)"
                    >
                      <button
                        type="button"
                        class="toggle-side-btn left"
                        :class="{ active: workingMappings.get(p.staged_xref)?.fieldChoices[fname] === 'db' }"
                        @click.stop="setFieldSource(p.staged_xref, fname as string, 'db')"
                      >
                        DB
                      </button>
                      <div class="toggle-slider-knob"></div>
                      <button
                        type="button"
                        class="toggle-side-btn right"
                        :class="{ active: workingMappings.get(p.staged_xref)?.fieldChoices[fname] === 'import' }"
                        @click.stop="setFieldSource(p.staged_xref, fname as string, 'import')"
                      >
                        Neu
                      </button>
                    </div>
                  </td>
                  <td class="cell-import">
                    <span :class="{ 'chosen-text': workingMappings.get(p.staged_xref)?.fieldChoices[fname] === 'import' }">
                      {{ fdiff.staged_value || '—' }}
                    </span>
                    <span class="status-pill" :class="'pill-' + fdiff.diff_type">
                      {{ fdiff.diff_type === 'conflict' ? t('gedcom_import_diff_type_conflict') : fdiff.diff_type === 'addition' ? t('gedcom_import_diff_type_addition') : t('gedcom_import_diff_type_identical') }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>

            <!-- Zusatzattribute & Notizen (3-Wege Schalter) -->
            <div class="extra-data-row">
              <span class="extra-label">📝 {{ t('gedcom_import_extra_title') }}</span>
              <div class="extra-btn-group" v-if="workingMappings.get(p.staged_xref)">
                <button
                  type="button"
                  class="extra-btn"
                  :class="{ active: workingMappings.get(p.staged_xref)?.extraAction === 'db' }"
                  @click="workingMappings.get(p.staged_xref)!.extraAction = 'db'"
                >
                  {{ t('gedcom_import_extra_db') }}
                </button>
                <button
                  type="button"
                  class="extra-btn"
                  :class="{ active: workingMappings.get(p.staged_xref)?.extraAction === 'overwrite' }"
                  @click="workingMappings.get(p.staged_xref)!.extraAction = 'overwrite'"
                >
                  {{ t('gedcom_import_extra_overwrite') }}
                </button>
                <button
                  type="button"
                  class="extra-btn"
                  :class="{ active: workingMappings.get(p.staged_xref)?.extraAction === 'append' }"
                  @click="workingMappings.get(p.staged_xref)!.extraAction = 'append'"
                >
                  {{ t('gedcom_import_extra_append') }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- INHALT: TAB NEUE PERSONEN -->
        <div v-else class="cards-container">
          <div class="new-persons-box">
            <table class="new-persons-table">
              <thead>
                <tr>
                  <th style="width: 40px">Import?</th>
                  <th style="width: 90px">XREF</th>
                  <th>Name</th>
                  <th>Geburtsdatum</th>
                  <th>Sterbedatum</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="np in allNewPersons" :key="'new-' + np.staged_xref">
                  <td>
                    <input
                      type="checkbox"
                      :checked="!excludedNewPersonXrefs.has(np.staged_xref)"
                      @change="
                        excludedNewPersonXrefs.has(np.staged_xref)
                          ? excludedNewPersonXrefs.delete(np.staged_xref)
                          : excludedNewPersonXrefs.add(np.staged_xref)
                      "
                    />
                  </td>
                  <td><code>{{ np.staged_xref }}</code></td>
                  <td><strong>{{ np.surname || 'N.N.' }}</strong>, {{ np.given_name || 'N.N.' }}</td>
                  <td>{{ np.birth_date || '—' }}</td>
                  <td>{{ np.death_date || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Footer für Phase 2 -->
        <footer class="modal-footer">
          <button type="button" class="btn-secondary" @click="phase = 'mode_select'">
            ← {{ t('gedcom_import_btn_back') }}
          </button>
          <button
            type="button"
            class="btn-primary"
            :disabled="isProcessing"
            @click="applyMerge"
          >
            💾 {{ t('gedcom_import_btn_apply_merge') }}
          </button>
        </footer>
      </div>

      <!-- LADEZUSTAND BEIM MERGEN -->
      <div v-else-if="phase === 'merging'" class="modal-body loading-body">
        <div class="spinner">⏳</div>
        <p>Führe Datenzusammenführung in Datenbank aus...</p>
      </div>

      <!-- PHASE 3: ERFOLGSANZEIGE -->
      <div v-else-if="phase === 'completed'" class="modal-body completed-body">
        <div class="completed-icon">🎉</div>
        <h3>{{ t('gedcom_import_success_title') }}</h3>

        <div class="stats-summary-card" v-if="mergeStats">
          <div class="summary-row">
            <span>{{ t('gedcom_import_success_updated') }}</span>
            <strong>{{ mergeStats.updated_persons_count }}</strong>
          </div>
          <div class="summary-row">
            <span>{{ t('gedcom_import_success_new') }}</span>
            <strong>{{ mergeStats.new_persons_count }}</strong>
          </div>
          <div class="summary-row">
            <span>{{ t('gedcom_import_success_families') }}</span>
            <strong>{{ mergeStats.new_families_count }}</strong>
          </div>
          <div class="summary-row">
            <span>{{ t('gedcom_import_success_parent_child') }}</span>
            <strong>{{ mergeStats.new_parent_child_count }}</strong>
          </div>
          <div class="summary-row" v-if="mergeStats.preserved_parents_count > 0">
            <span>{{ t('gedcom_import_success_preserved_parents') }}</span>
            <strong class="text-safe">{{ mergeStats.preserved_parents_count }}</strong>
          </div>
        </div>

        <footer class="modal-footer">
          <button type="button" class="btn-primary" @click="emit('close')">
            {{ t('gedcom_import_btn_finish') }}
          </button>
        </footer>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.65);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1200;
  padding: 16px;
  box-sizing: border-box;
}

.modal-content.gedcom-import-modal {
  background: #ffffff;
  border-radius: 12px;
  width: 100%;
  max-width: 980px;
  height: 90vh;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
  border: 1px solid #cbd5e1;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 18px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}

.header-titles {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-titles h2 {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
  color: #0f172a;
}

.file-badge {
  font-size: 0.8rem;
  background: #e2e8f0;
  color: #334155;
  padding: 2px 8px;
  border-radius: 4px;
}

.btn-close-icon {
  background: none;
  border: none;
  font-size: 1.15rem;
  color: #64748b;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
}

.btn-close-icon:hover {
  background: #e2e8f0;
  color: #0f172a;
}

.error-banner {
  background: #fef2f2;
  color: #991b1b;
  padding: 8px 16px;
  border-bottom: 1px solid #fecaca;
  font-size: 0.85rem;
}

.modal-body {
  padding: 16px 20px;
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* Modus-Auswahl */
.section-intro {
  margin: 0 0 16px 0;
  font-size: 0.95rem;
  font-weight: 600;
  color: #1e293b;
}

.mode-options-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.mode-card {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 14px 16px;
  background: #ffffff;
  border: 2px solid #e2e8f0;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.mode-card:hover {
  border-color: #94a3b8;
  background: #f8fafc;
}

.mode-card.selected {
  border-color: #2563eb;
  background: #eff6ff;
}

.mode-card.danger-card.selected {
  border-color: #ef4444;
  background: #fef2f2;
}

.card-radio input {
  margin-top: 4px;
  accent-color: #2563eb;
}

.card-content h3 {
  margin: 0 0 4px 0;
  font-size: 0.95rem;
  color: #0f172a;
}

.card-content p {
  margin: 0;
  font-size: 0.85rem;
  color: #64748b;
  line-height: 1.4;
}

.sub-input-row {
  margin-top: 10px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.85rem;
}

.name-input {
  padding: 6px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  font-size: 0.85rem;
  width: 260px;
}

.active-tree-pill {
  margin-top: 8px;
  font-size: 0.8rem;
  color: #1d4ed8;
}

.replace-alert {
  margin-top: 8px;
  font-size: 0.8rem;
  color: #b91c1c;
  font-weight: 600;
}

/* Staging-Toolbar */
.staging-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 12px;
  border-bottom: 1px solid #e2e8f0;
}

.stats-group {
  display: flex;
  gap: 8px;
}

.stat-badge {
  font-size: 0.8rem;
  padding: 4px 10px;
  border-radius: 14px;
  border: 1px solid #cbd5e1;
}

.stat-badge.mapped {
  background: #eff6ff;
  border-color: #bfdbfe;
  color: #1e40af;
}

.stat-badge.conflicts {
  background: #fff7ed;
  border-color: #fed7aa;
  color: #9a3412;
}

.stat-badge.new {
  background: #f0fdf4;
  border-color: #bbf7d0;
  color: #166534;
}

.global-actions {
  display: flex;
  gap: 8px;
}

.btn-quick-action {
  background: #2563eb;
  color: white;
  border: none;
  border-radius: 4px;
  padding: 6px 12px;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
}

.btn-quick-action:hover {
  background: #1d4ed8;
}

.btn-quick-action.secondary {
  background: #e2e8f0;
  color: #334155;
}

.btn-quick-action.secondary:hover {
  background: #cbd5e1;
}

/* Filter & Pagination */
.staging-subbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
}

.filter-tabs {
  display: flex;
  gap: 6px;
}

.tab-btn {
  background: transparent;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 0.8rem;
  font-weight: 600;
  color: #475569;
  cursor: pointer;
}

.tab-btn.active {
  background: #1e293b;
  border-color: #1e293b;
  color: #ffffff;
}

.pagination-bar {
  display: flex;
  align-items: center;
  gap: 12px;
}

.page-size-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: #64748b;
}

.page-size-select {
  padding: 3px 6px;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  font-size: 0.8rem;
}

.page-nav {
  display: flex;
  align-items: center;
  gap: 6px;
}

.btn-nav {
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  padding: 3px 8px;
  cursor: pointer;
  font-size: 0.8rem;
}

.btn-nav:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.page-info {
  font-size: 0.8rem;
  font-weight: 600;
  color: #334155;
}

/* Diff Cards */
.cards-container {
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  flex: 1;
  padding-right: 4px;
}

.empty-tab-hint {
  text-align: center;
  padding: 36px 0;
  color: #94a3b8;
  font-style: italic;
}

.person-diff-card {
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 12px 14px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.person-diff-card.has-conflicts {
  border-left: 4px solid #f97316;
}

.diff-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid #f1f5f9;
}

.match-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
}

.staged-tag {
  font-weight: 600;
  color: #0f172a;
}

.match-arrow {
  color: #94a3b8;
}

.db-tag {
  font-weight: 600;
  color: #2563eb;
}

.match-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.confidence-badge {
  font-size: 0.75rem;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 600;
}

.conf-100, .conf-90, .conf-85 {
  background: #dcfce7;
  color: #166534;
}

.conf-80, .conf-75, .conf-70 {
  background: #fef9c3;
  color: #854d0e;
}

.btn-unlink {
  background: transparent;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 0.7rem;
  color: #64748b;
  cursor: pointer;
}

.btn-unlink:hover {
  background: #f1f5f9;
  color: #0f172a;
}

/* Diff Table */
.diff-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
  margin-bottom: 8px;
}

.diff-table th {
  text-align: left;
  padding: 4px 8px;
  background: #f8fafc;
  color: #64748b;
  font-size: 0.75rem;
  border-bottom: 1px solid #e2e8f0;
}

.diff-table td {
  padding: 6px 8px;
  border-bottom: 1px solid #f1f5f9;
}

.cell-field {
  font-weight: 600;
  color: #334155;
}

.chosen-text {
  font-weight: 700;
  color: #0f172a;
}

.cell-import {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.status-pill {
  font-size: 0.7rem;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 600;
}

.pill-conflict {
  background: #ffedd5;
  color: #c2410c;
}

.pill-addition {
  background: #dcfce7;
  color: #15803d;
}

.pill-identical {
  background: #f1f5f9;
  color: #94a3b8;
}

/* 2-Wege Slider / Toggle Switch */
.slider-toggle-wrap {
  display: flex;
  align-items: center;
  position: relative;
  background: #e2e8f0;
  border-radius: 12px;
  width: 90px;
  height: 22px;
  cursor: pointer;
  padding: 2px;
  box-sizing: border-box;
  margin: 0 auto;
  user-select: none;
}

.toggle-slider-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 42px;
  height: 18px;
  background: #ffffff;
  border-radius: 10px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  transition: transform 0.15s ease;
}

.slider-toggle-wrap.side-import .toggle-slider-knob {
  transform: translateX(44px);
  background: #2563eb;
}

.toggle-side-btn {
  flex: 1;
  background: transparent;
  border: none;
  font-size: 0.65rem;
  font-weight: 700;
  color: #64748b;
  z-index: 2;
  cursor: pointer;
  text-align: center;
  padding: 0;
  line-height: 18px;
}

.toggle-side-btn.active {
  color: #0f172a;
}

.slider-toggle-wrap.side-import .toggle-side-btn.right.active {
  color: #ffffff;
}

/* Zusatzattribute */
.extra-data-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 6px;
  font-size: 0.8rem;
}

.extra-label {
  color: #475569;
}

.extra-btn-group {
  display: flex;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  overflow: hidden;
}

.extra-btn {
  background: #f8fafc;
  border: none;
  border-right: 1px solid #cbd5e1;
  padding: 3px 8px;
  font-size: 0.75rem;
  color: #475569;
  cursor: pointer;
}

.extra-btn:last-child {
  border-right: none;
}

.extra-btn.active {
  background: #2563eb;
  color: #ffffff;
  font-weight: 600;
}

/* Neue Personen Tabelle */
.new-persons-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.new-persons-table th {
  text-align: left;
  padding: 6px 10px;
  background: #f8fafc;
  border-bottom: 2px solid #e2e8f0;
  color: #475569;
}

.new-persons-table td {
  padding: 6px 10px;
  border-bottom: 1px solid #f1f5f9;
}

/* Ladeanzeige */
.loading-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 48px;
  color: #475569;
}

.spinner {
  font-size: 2rem;
  animation: pulse 1s infinite alternate;
}

@keyframes pulse {
  from { transform: scale(0.9); }
  to { transform: scale(1.1); }
}

/* Abschluss-Anzeige */
.completed-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px;
}

.completed-icon {
  font-size: 2.5rem;
  margin-bottom: 8px;
}

.completed-body h3 {
  margin: 0 0 16px 0;
  color: #0f172a;
}

.stats-summary-card {
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 16px 20px;
  width: 100%;
  max-width: 440px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 0.9rem;
}

.summary-row {
  display: flex;
  justify-content: space-between;
}

.text-safe {
  color: #166534;
}

/* Modal-Footer */
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 18px;
  background: #f8fafc;
  border-top: 1px solid #e2e8f0;
}

.btn-primary {
  background: #2563eb;
  color: #ffffff;
  border: none;
  border-radius: 6px;
  padding: 8px 16px;
  font-weight: 600;
  font-size: 0.85rem;
  cursor: pointer;
}

.btn-primary:hover:not(:disabled) {
  background: #1d4ed8;
}

.btn-primary:disabled {
  background: #94a3b8;
  cursor: not-allowed;
}

.btn-secondary {
  background: #f1f5f9;
  color: #334155;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 8px 14px;
  font-size: 0.85rem;
  cursor: pointer;
}

.btn-secondary:hover {
  background: #e2e8f0;
}

.btn-danger {
  background: #dc2626;
  color: #ffffff;
  border: none;
  border-radius: 6px;
  padding: 8px 16px;
  font-weight: 600;
  font-size: 0.85rem;
  cursor: pointer;
}

.btn-danger:hover:not(:disabled) {
  background: #b91c1c;
}
</style>

