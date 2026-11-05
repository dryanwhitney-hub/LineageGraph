<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { useI18n } from 'vue-i18n';
import type { ExportPersonInput } from '../../utils/htmlExport';

const props = defineProps<{
  persons: ExportPersonInput[];
  activeProbandId: string | null;
}>();

const { t } = useI18n();

// Layout-Status
const isLeftPanelCollapsed = ref<boolean>(false);
const saveStatusMsg = ref<string>('');
const saveErrorMsg = ref<string>('');
const isExporting = ref<boolean>(false);
const isLoadingPreview = ref<boolean>(false);

// Scope-Auswahl
type ScopeMode = 'all' | 'descendants' | 'ancestors' | 'specific';
const scopeMode = ref<ScopeMode>('all');

// Parameter für Ausschnitte
const targetPersonId = ref<string>('');
const includeSpouses = ref<boolean>(true);
const specificPersonIds = ref<string[]>([]);

// Suchfilter
const targetSearchQuery = ref<string>('');
const specificSearchQuery = ref<string>('');

// Vorschau-Daten
const previewData = ref<{
  total_persons: number;
  total_families: number;
  preview_text: string;
} | null>(null);

// Schneller Map-Zugriff auf Personen nach ID
const personsMap = computed(() => {
  const map = new Map<string, ExportPersonInput>();
  for (const p of props.persons) {
    map.set(p.id, p);
  }
  return map;
});

// Initialisierung der Zielperson
onMounted(() => {
  if (props.activeProbandId && personsMap.value.has(props.activeProbandId)) {
    targetPersonId.value = props.activeProbandId;
  } else if (props.persons.length > 0) {
    targetPersonId.value = props.persons[0].id;
  }
  refreshPreview();
});

watch(
  () => props.activeProbandId,
  newId => {
    if (newId && personsMap.value.has(newId) && !targetPersonId.value) {
      targetPersonId.value = newId;
    }
  }
);

// Gefilterte Personen für Startperson-Suche
const filteredTargetPersons = computed(() => {
  const q = targetSearchQuery.value.trim().toLowerCase();
  if (!q) return props.persons.slice(0, 50);
  return props.persons
    .filter(p => {
      const name = `${p.given_name || ''} ${p.surname || ''} ${p.id}`.toLowerCase();
      return name.includes(q);
    })
    .slice(0, 50);
});

// Gefilterte Personen für Auswahlliste (SpecificList)
const filteredSearchPersons = computed(() => {
  const q = specificSearchQuery.value.trim().toLowerCase();
  if (!q) return [];
  const selectedSet = new Set(specificPersonIds.value);
  return props.persons
    .filter(p => !selectedSet.has(p.id))
    .filter(p => {
      const name = `${p.given_name || ''} ${p.surname || ''} ${p.id}`.toLowerCase();
      return name.includes(q);
    })
    .slice(0, 30);
});

// Ausgewählte Personen-Objekte für SpecificList
const selectedSpecificPersons = computed(() => {
  return specificPersonIds.value
    .map(id => personsMap.value.get(id))
    .filter((p): p is ExportPersonInput => p !== undefined);
});

// Erzeugt das Scope-Objekt für Tauri
function buildScopePayload() {
  switch (scopeMode.value) {
    case 'all':
      return { mode: 'all' };
    case 'descendants':
      return {
        mode: 'descendants',
        person_id: targetPersonId.value || (props.persons[0]?.id ?? ''),
        include_spouses: includeSpouses.value,
      };
    case 'ancestors':
      return {
        mode: 'ancestors',
        person_id: targetPersonId.value || (props.persons[0]?.id ?? ''),
      };
    case 'specific':
      return {
        mode: 'specific_list',
        person_ids: specificPersonIds.value,
      };
  }
}

// Vorschau abrufen
let previewTimeout: ReturnType<typeof setTimeout> | null = null;
function triggerPreviewDebounced() {
  if (previewTimeout) clearTimeout(previewTimeout);
  previewTimeout = setTimeout(() => {
    refreshPreview();
  }, 200);
}

async function refreshPreview() {
  if (isLoadingPreview.value) return;
  isLoadingPreview.value = true;
  saveErrorMsg.value = '';

  try {
    const scope = buildScopePayload();
    const res = await invoke<{
      total_persons: number;
      total_families: number;
      preview_text: string;
    }>('preview_gedcom_export', { scope });
    previewData.value = res;
  } catch (err: any) {
    saveErrorMsg.value = String(err);
  } finally {
    isLoadingPreview.value = false;
  }
}

// Beobachter für automatische Vorschau-Aktualisierung
watch([scopeMode, targetPersonId, includeSpouses], () => {
  triggerPreviewDebounced();
});

watch(
  () => specificPersonIds.value.length,
  () => {
    if (scopeMode.value === 'specific') {
      triggerPreviewDebounced();
    }
  }
);

// Verwaltung der spezifischen Liste
function addSpecificPerson(id: string) {
  if (!specificPersonIds.value.includes(id)) {
    specificPersonIds.value.push(id);
    specificSearchQuery.value = '';
  }
}

function removeSpecificPerson(id: string) {
  specificPersonIds.value = specificPersonIds.value.filter(pid => pid !== id);
}

function addAllVisiblePersons() {
  const set = new Set(specificPersonIds.value);
  for (const p of props.persons) {
    set.add(p.id);
  }
  specificPersonIds.value = Array.from(set);
}

function clearSpecificPersons() {
  specificPersonIds.value = [];
}

// Formatierung von Personennamen für Dropdowns
function formatPersonLabel(p: ExportPersonInput): string {
  const parts = [];
  if (p.surname) parts.push(p.surname.toUpperCase());
  if (p.given_name) parts.push(p.given_name);
  const name = parts.join(', ') || 'N.N.';
  const dates = [];
  if (p.birth_date) dates.push(`* ${p.birth_date}`);
  if (p.death_date) dates.push(`† ${p.death_date}`);
  const dateStr = dates.length > 0 ? ` (${dates.join(', ')})` : '';
  return `[${p.id}] ${name}${dateStr}`;
}

// Datei-Download Fallback im Browser-Modus
function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Haupt-Exportfunktion
async function exportGedcomFile() {
  saveStatusMsg.value = '';
  saveErrorMsg.value = '';
  isExporting.value = true;

  const timestamp = new Date().toISOString().slice(0, 10);
  let defaultFileName = `export_stammbaum_${scopeMode.value}_${timestamp}.ged`;
  if (scopeMode.value === 'descendants' || scopeMode.value === 'ancestors') {
    const target = personsMap.value.get(targetPersonId.value);
    const targetName = target ? `${target.surname || 'Person'}_${target.given_name || target.id}` : targetPersonId.value;
    defaultFileName = `export_${scopeMode.value}_${targetName}_${timestamp}.ged`.replace(/[^a-zA-Z0-9_.-]/g, '_');
  }

  try {
    const scope = buildScopePayload();
    let chosenFilePath: string | null = null;

    try {
      const dialogRes = await save({
        title: t('export_gedcom_save_dialog_title'),
        defaultPath: defaultFileName,
        filters: [{ name: 'GEDCOM Datei (*.ged)', extensions: ['ged'] }],
      });
      if (typeof dialogRes === 'string') {
        chosenFilePath = dialogRes;
      }
    } catch {
      chosenFilePath = null;
    }

    if (chosenFilePath) {
      const result = await invoke<{
        total_persons: number;
        total_families: number;
        file_path: string;
      }>('export_gedcom_to_file', {
        filePath: chosenFilePath,
        scope,
      });

      saveStatusMsg.value = t('export_gedcom_save_success', {
        persons: result.total_persons,
        families: result.total_families,
        path: result.file_path,
      });
    } else {
      // Fallback: Vorschauinhalt holen und im Browser als Blob herunterladen
      const previewRes = await invoke<{
        total_persons: number;
        total_families: number;
        preview_text: string;
        full_content?: string;
      }>('preview_gedcom_export', { scope });

      const content = previewRes.full_content || previewRes.preview_text;
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      downloadBlob(blob, defaultFileName);

      saveStatusMsg.value = t('export_gedcom_save_success', {
        persons: previewRes.total_persons,
        families: previewRes.total_families,
        path: defaultFileName,
      });
    }
  } catch (err: any) {
    saveErrorMsg.value = t('export_gedcom_save_error', { error: String(err) });
  } finally {
    isExporting.value = false;
  }
}
</script>

<template>
  <div class="gedcom-export-pane">
    <!-- Linke Seitenleiste: Konfiguration -->
    <aside class="gedcom-sidebar" :class="{ collapsed: isLeftPanelCollapsed }">
      <button
        type="button"
        class="sidebar-collapse-toggle"
        @click="isLeftPanelCollapsed = !isLeftPanelCollapsed"
        :title="isLeftPanelCollapsed ? t('export_show_panel') : t('export_hide_panel')"
      >
        {{ isLeftPanelCollapsed ? '▶' : '◀' }}
      </button>

      <div v-if="!isLeftPanelCollapsed" class="gedcom-sidebar-inner">
        <div class="export-panel-header">
          <h2>🧬 {{ t('export_gedcom_panel_title') }}</h2>
          <p class="export-panel-subtitle">{{ t('export_gedcom_panel_subtitle') }}</p>
        </div>

        <!-- 1. Export-Umfang auswählen -->
        <div class="export-section">
          <label class="export-section-label">🎯 {{ t('export_scope_title') }}</label>
          <div class="scope-options">
            <label
              class="scope-option-card"
              :class="{ active: scopeMode === 'all' }"
            >
              <input
                type="radio"
                name="gedcomScope"
                value="all"
                v-model="scopeMode"
              />
              <div class="scope-text">
                <span class="scope-title">🌐 {{ t('export_scope_all') }}</span>
                <span class="scope-desc">{{ t('export_scope_all_desc') }}</span>
              </div>
            </label>

            <label
              class="scope-option-card"
              :class="{ active: scopeMode === 'descendants' }"
            >
              <input
                type="radio"
                name="gedcomScope"
                value="descendants"
                v-model="scopeMode"
              />
              <div class="scope-text">
                <span class="scope-title">🌱 {{ t('export_scope_descendants') }}</span>
                <span class="scope-desc">{{ t('export_scope_descendants_desc') }}</span>
              </div>
            </label>

            <label
              class="scope-option-card"
              :class="{ active: scopeMode === 'ancestors' }"
            >
              <input
                type="radio"
                name="gedcomScope"
                value="ancestors"
                v-model="scopeMode"
              />
              <div class="scope-text">
                <span class="scope-title">🌿 {{ t('export_scope_ancestors') }}</span>
                <span class="scope-desc">{{ t('export_scope_ancestors_desc') }}</span>
              </div>
            </label>

            <label
              class="scope-option-card"
              :class="{ active: scopeMode === 'specific' }"
            >
              <input
                type="radio"
                name="gedcomScope"
                value="specific"
                v-model="scopeMode"
              />
              <div class="scope-text">
                <span class="scope-title">📋 {{ t('export_scope_specific') }}</span>
                <span class="scope-desc">{{ t('export_scope_specific_desc') }}</span>
              </div>
            </label>
          </div>
        </div>

        <!-- 2. Spezifische Einstellungen je nach Modus -->

        <!-- Modus: Nachkommen oder Vorfahren (Startperson wählen) -->
        <div
          v-if="scopeMode === 'descendants' || scopeMode === 'ancestors'"
          class="export-section sub-section"
        >
          <label class="export-section-label">👤 {{ t('export_gedcom_target_person') }}</label>
          <div class="search-input-wrap">
            <input
              type="text"
              v-model="targetSearchQuery"
              class="export-input"
              :placeholder="t('export_person_search_placeholder')"
            />
          </div>
          <select
            v-model="targetPersonId"
            class="export-dropdown"
            size="5"
          >
            <option
              v-for="p in filteredTargetPersons"
              :key="'target-' + p.id"
              :value="p.id"
            >
              {{ formatPersonLabel(p) }}
            </option>
          </select>

          <!-- Zusatzoption für Nachkommen: Ehepartner mit einbeziehen -->
          <div v-if="scopeMode === 'descendants'" class="sub-option-row">
            <label class="checkbox-label">
              <input type="checkbox" v-model="includeSpouses" />
              <span>{{ t('export_gedcom_include_spouses') }}</span>
            </label>
          </div>
        </div>

        <!-- Modus: Spezifische Personenliste -->
        <div v-if="scopeMode === 'specific'" class="export-section sub-section">
          <div class="specific-header">
            <label class="export-section-label">
              👥 {{ t('export_gedcom_specific_list_title', { count: specificPersonIds.length }) }}
            </label>
            <div class="specific-actions">
              <button
                type="button"
                class="btn-text-action"
                @click="addAllVisiblePersons"
                :title="t('export_gedcom_add_from_table')"
              >
                + {{ t('all_entries') }}
              </button>
              <button
                type="button"
                class="btn-text-action danger"
                @click="clearSpecificPersons"
                v-if="specificPersonIds.length > 0"
              >
                ✕ {{ t('export_gedcom_clear_list') }}
              </button>
            </div>
          </div>

          <!-- Personensuche zum Hinzufügen -->
          <div class="search-input-wrap">
            <input
              type="text"
              v-model="specificSearchQuery"
              class="export-input"
              :placeholder="t('export_gedcom_add_person_placeholder')"
            />
            <div v-if="filteredSearchPersons.length > 0" class="search-dropdown-results">
              <div
                v-for="p in filteredSearchPersons"
                :key="'search-add-' + p.id"
                class="search-result-item"
                @click="addSpecificPerson(p.id)"
              >
                <span class="add-plus">+</span>
                <span>{{ formatPersonLabel(p) }}</span>
              </div>
            </div>
          </div>

          <!-- Chip-Liste der ausgewählten Personen -->
          <div class="selected-chips-box">
            <div
              v-if="selectedSpecificPersons.length === 0"
              class="empty-chips-msg"
            >
              {{ t('export_gedcom_no_persons_selected') }}
            </div>
            <div
              v-for="p in selectedSpecificPersons"
              :key="'chip-' + p.id"
              class="person-chip"
            >
              <span class="chip-text">{{ formatPersonLabel(p) }}</span>
              <button
                type="button"
                class="chip-remove"
                @click="removeSpecificPerson(p.id)"
                :title="t('export_gedcom_remove_person')"
              >
                ×
              </button>
            </div>
          </div>
        </div>

        <!-- 3. Export-Aktion & Statusmeldungen -->
        <div class="export-sidebar-bottom">
          <button
            type="button"
            class="btn-export-primary"
            :disabled="isExporting || (scopeMode === 'specific' && specificPersonIds.length === 0)"
            @click="exportGedcomFile"
          >
            <span v-if="isExporting">⏳ {{ t('export_gedcom_saving') }}</span>
            <span v-else>💾 {{ t('export_gedcom_btn_save') }}</span>
          </button>

          <div v-if="saveStatusMsg" class="status-msg success">
            {{ saveStatusMsg }}
          </div>
          <div v-if="saveErrorMsg" class="status-msg error">
            {{ saveErrorMsg }}
          </div>
        </div>
      </div>
    </aside>

    <!-- Rechter Hauptbereich: Live-Statistik und Vorschau -->
    <main class="gedcom-main-content">
      <header class="gedcom-preview-header">
        <div class="preview-header-left">
          <span class="preview-badge">📋 {{ t('export_gedcom_preview_title') }}</span>
          <div v-if="previewData" class="stats-pills">
            <span class="stat-pill">
              <strong>{{ previewData.total_persons }}</strong> {{ t('export_gedcom_stat_persons') }}
            </span>
            <span class="stat-pill">
              <strong>{{ previewData.total_families }}</strong> {{ t('export_gedcom_stat_families') }}
            </span>
          </div>
        </div>

        <button
          type="button"
          class="btn-refresh-preview"
          :disabled="isLoadingPreview"
          @click="refreshPreview"
          :title="t('export_gedcom_preview_refresh')"
        >
          🔄 {{ isLoadingPreview ? '...' : t('export_gedcom_preview_refresh') }}
        </button>
      </header>

      <div class="gedcom-preview-body">
        <div v-if="isLoadingPreview" class="loading-overlay">
          <span>⏳ Lade Vorschau...</span>
        </div>
        <pre v-if="previewData" class="gedcom-code-view"><code>{{ previewData.preview_text }}</code></pre>
        <div v-else class="empty-preview-hint">
          {{ t('export_empty_hint') }}
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.gedcom-export-pane {
  display: flex;
  flex: 1;
  min-height: 0;
  height: 100%;
  position: relative;
  overflow: hidden;
  background: #f8fafc;
}

/* Linke Seitenleiste */
.gedcom-sidebar {
  width: 380px;
  min-width: 380px;
  background: #ffffff;
  border-right: 1px solid #cbd5e1;
  display: flex;
  flex-direction: column;
  position: relative;
  transition: width 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
  z-index: 10;
}

.gedcom-sidebar.collapsed {
  width: 24px;
  min-width: 24px;
}

.sidebar-collapse-toggle {
  position: absolute;
  top: 10px;
  right: 4px;
  z-index: 15;
  width: 20px;
  height: 24px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #e2e8f0;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  color: #475569;
  cursor: pointer;
  font-size: 11px;
}

.sidebar-collapse-toggle:hover {
  background: #cbd5e1;
  color: #1e293b;
}

.gedcom-sidebar-inner {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px;
  overflow-y: auto;
  gap: 16px;
}

.export-panel-header h2 {
  font-size: 1.15rem;
  font-weight: 700;
  color: #0f172a;
  margin: 0 0 4px 0;
}

.export-panel-subtitle {
  font-size: 0.8rem;
  color: #64748b;
  margin: 0;
  line-height: 1.35;
}

/* Sektionen */
.export-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sub-section {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 10px;
}

.export-section-label {
  font-size: 0.85rem;
  font-weight: 600;
  color: #1e293b;
}

/* Scope Radio Cards */
.scope-options {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.scope-option-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 10px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.scope-option-card:hover {
  border-color: #94a3b8;
  background: #f1f5f9;
}

.scope-option-card.active {
  border-color: #2563eb;
  background: #eff6ff;
}

.scope-option-card input[type="radio"] {
  margin-top: 3px;
  accent-color: #2563eb;
}

.scope-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.scope-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: #0f172a;
}

.scope-desc {
  font-size: 0.75rem;
  color: #64748b;
  line-height: 1.25;
}

/* Formularelemente */
.export-input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  font-size: 0.85rem;
  box-sizing: border-box;
}

.export-input:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
}

.export-dropdown {
  width: 100%;
  padding: 6px;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  font-size: 0.8rem;
  box-sizing: border-box;
  background: #ffffff;
}

.sub-option-row {
  margin-top: 6px;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8rem;
  color: #334155;
  cursor: pointer;
}

.checkbox-label input {
  accent-color: #2563eb;
}

/* Spezifische Liste */
.specific-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.specific-actions {
  display: flex;
  gap: 8px;
}

.btn-text-action {
  background: transparent;
  border: none;
  font-size: 0.75rem;
  font-weight: 600;
  color: #2563eb;
  cursor: pointer;
  padding: 2px 4px;
}

.btn-text-action:hover {
  text-decoration: underline;
}

.btn-text-action.danger {
  color: #dc2626;
}

.search-input-wrap {
  position: relative;
}

.search-dropdown-results {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  max-height: 160px;
  overflow-y: auto;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  z-index: 20;
}

.search-result-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  font-size: 0.8rem;
  cursor: pointer;
  border-bottom: 1px solid #f1f5f9;
}

.search-result-item:hover {
  background: #f1f5f9;
  color: #2563eb;
}

.add-plus {
  font-weight: bold;
  color: #2563eb;
}

.selected-chips-box {
  max-height: 140px;
  overflow-y: auto;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.empty-chips-msg {
  font-size: 0.75rem;
  color: #94a3b8;
  font-style: italic;
  padding: 4px;
}

.person-chip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  padding: 3px 6px;
  font-size: 0.75rem;
}

.chip-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chip-remove {
  background: transparent;
  border: none;
  color: #64748b;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  padding: 0 2px;
}

.chip-remove:hover {
  color: #ef4444;
}

/* Sidebar Footer */
.export-sidebar-bottom {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.btn-export-primary {
  width: 100%;
  padding: 10px;
  background: #2563eb;
  color: #ffffff;
  border: none;
  border-radius: 6px;
  font-weight: 600;
  font-size: 0.9rem;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  transition: background 0.15s ease;
}

.btn-export-primary:hover:not(:disabled) {
  background: #1d4ed8;
}

.btn-export-primary:disabled {
  background: #94a3b8;
  cursor: not-allowed;
}

.status-msg {
  padding: 8px 10px;
  border-radius: 4px;
  font-size: 0.8rem;
  line-height: 1.35;
}

.status-msg.success {
  background: #ecfdf5;
  color: #065f46;
  border: 1px solid #a7f3d0;
}

.status-msg.error {
  background: #fef2f2;
  color: #991b1b;
  border: 1px solid #fecaca;
}

/* Hauptbereich: Vorschau */
.gedcom-main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  background: #0f172a;
}

.gedcom-preview-header {
  height: 44px;
  min-height: 44px;
  background: #1e293b;
  border-bottom: 1px solid #334155;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
}

.preview-header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.preview-badge {
  font-size: 0.85rem;
  font-weight: 600;
  color: #f8fafc;
}

.stats-pills {
  display: flex;
  gap: 8px;
}

.stat-pill {
  font-size: 0.75rem;
  background: #334155;
  color: #93c5fd;
  padding: 2px 8px;
  border-radius: 12px;
}

.stat-pill strong {
  color: #ffffff;
}

.btn-refresh-preview {
  background: #334155;
  border: 1px solid #475569;
  color: #f1f5f9;
  font-size: 0.75rem;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-refresh-preview:hover:not(:disabled) {
  background: #475569;
}

.gedcom-preview-body {
  flex: 1;
  position: relative;
  overflow: auto;
  padding: 16px;
}

.loading-overlay {
  position: absolute;
  top: 16px;
  right: 16px;
  background: rgba(15, 23, 42, 0.85);
  color: #93c5fd;
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 0.8rem;
  border: 1px solid #334155;
}

.gedcom-code-view {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 0.85rem;
  color: #e2e8f0;
  line-height: 1.5;
  white-space: pre;
}

.empty-preview-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #64748b;
  font-size: 0.9rem;
}
</style>
