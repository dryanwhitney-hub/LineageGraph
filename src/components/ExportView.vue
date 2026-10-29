<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { useI18n } from 'vue-i18n';
import {
  buildInteractiveExportTree,
  generateInteractiveTreeHtml,
  type ExportPersonInput,
} from '../utils/htmlExport';

interface RootAncestorConfig {
  person_id: string;
  starting_code: string;
  given_name: string | null;
  surname: string | null;
}

const props = defineProps<{
  persons: ExportPersonInput[];
  rootAncestors: RootAncestorConfig[];
  activeProbandId: string | null;
}>();

const emit = defineEmits<{
  (e: 'select-proband', personId: string): void;
}>();

const { t, locale } = useI18n();

// Export Modul Tabs (HTML Export ist die aktive Ansicht im Export-Modul)
const activeExportModuleTab = ref<'html' | 'pdf' | 'csv' | 'gedcom'>('html');

const selectedExportRootId = ref<string>('');
const exportStartCode = ref<string>('1');
const personSearchQuery = ref<string>('');
const showCustomPersonPicker = ref<boolean>(props.rootAncestors.length === 0);
const customTitleDe = ref<string>('');
const customTitleEn = ref<string>('');
const isLeftPanelCollapsed = ref<boolean>(false);
const saveStatusMsg = ref<string>('');
const saveErrorMsg = ref<string>('');
const previewKey = ref<number>(0);

// Viewport-Modus für die Vorschau: Desktop oder Mobile
const previewViewport = ref<'desktop' | 'mobile'>('desktop');
const mobileOrientation = ref<'portrait' | 'landscape'>('portrait');

// Count direct children per person so the selector can show helpful info
const directChildrenCountMap = computed<Map<string, number>>(() => {
  const map = new Map<string, number>();
  for (const p of props.persons) {
    for (const pid of p.parent_ids || []) {
      map.set(pid, (map.get(pid) || 0) + 1);
    }
  }
  return map;
});

function selectRootPerson(personId: string, startCode?: string) {
  selectedExportRootId.value = personId;
  const configured = props.rootAncestors.find(r => r.person_id === personId);
  if (startCode !== undefined) {
    exportStartCode.value = startCode;
  } else if (configured) {
    exportStartCode.value = configured.starting_code || '1';
  } else if (!exportStartCode.value.trim()) {
    exportStartCode.value = '1';
  }

  const p = props.persons.find(x => x.id === personId);
  if (p) {
    const label = (p.surname || `${p.given_name || ''} ${p.surname || ''}`).trim() || 'Familie';
    customTitleDe.value = `Stammbaum ${label}`;
    customTitleEn.value = `${label} Family Tree`;
  }
  saveStatusMsg.value = '';
  saveErrorMsg.value = '';
}

function onDefinedRootDropdownChange(personId: string) {
  if (!personId) return;
  const configured = props.rootAncestors.find(r => r.person_id === personId);
  selectRootPerson(personId, configured?.starting_code);
  emit('select-proband', personId);
}

onMounted(() => {
  if (props.activeProbandId && props.persons.some(p => p.id === props.activeProbandId)) {
    selectRootPerson(props.activeProbandId);
  } else if (props.rootAncestors.length > 0) {
    selectRootPerson(props.rootAncestors[0].person_id, props.rootAncestors[0].starting_code);
  } else if (props.persons.length > 0) {
    let bestId = props.persons[0].id;
    let bestCount = -1;
    for (const p of props.persons) {
      const c = directChildrenCountMap.value.get(p.id) || 0;
      if (c > bestCount) {
        bestCount = c;
        bestId = p.id;
      }
    }
    selectRootPerson(bestId, '1');
  }
});

watch(
  () => props.rootAncestors,
  newRoots => {
    if (newRoots.length === 0) {
      showCustomPersonPicker.value = true;
    }
  }
);

watch(
  () => props.activeProbandId,
  newId => {
    if (newId && newId !== selectedExportRootId.value && props.persons.some(p => p.id === newId)) {
      selectRootPerson(newId);
    }
  }
);

watch(
  () => props.persons,
  newPersons => {
    if (
      newPersons.length > 0 &&
      (!selectedExportRootId.value || !newPersons.some(p => p.id === selectedExportRootId.value))
    ) {
      if (props.activeProbandId && newPersons.some(p => p.id === props.activeProbandId)) {
        selectRootPerson(props.activeProbandId);
      } else if (props.rootAncestors.length > 0) {
        selectRootPerson(props.rootAncestors[0].person_id, props.rootAncestors[0].starting_code);
      } else {
        selectRootPerson(newPersons[0].id, '1');
      }
    }
  }
);

const selectedRootPerson = computed<ExportPersonInput | null>(() => {
  if (!selectedExportRootId.value) return null;
  return props.persons.find(p => p.id === selectedExportRootId.value) || null;
});

const isSelectedRootInDefinedList = computed<boolean>(() => {
  return props.rootAncestors.some(r => r.person_id === selectedExportRootId.value);
});

const filteredPersonsList = computed<ExportPersonInput[]>(() => {
  const q = personSearchQuery.value.trim().toLowerCase();
  const cleanQ = q.replace(/[\[\]]/g, '').trim();

  let list = props.persons;
  if (q) {
    list = props.persons.filter(p => {
      const gn = (p.given_name || '').toLowerCase();
      const sn = (p.surname || '').toLowerCase();
      const full = `${gn} ${sn}`.trim();
      const rev = `${sn}, ${gn}`.trim();
      const idMatch = p.id.toLowerCase().includes(q) || (cleanQ && p.id.toLowerCase().includes(cleanQ));
      const bMatch = (p.birth_date || '').toLowerCase().includes(q);
      return gn.includes(q) || sn.includes(q) || full.includes(q) || rev.includes(q) || idMatch || bMatch;
    });
  }

  return list.slice(0, 80);
});

const exportTreeResult = computed(() => {
  if (!selectedExportRootId.value) {
    return null;
  }
  return buildInteractiveExportTree(
    props.persons,
    selectedExportRootId.value,
    exportStartCode.value || '1'
  );
});

const generatedHtml = computed<string>(() => {
  const res = exportTreeResult.value;
  if (!res || !res.rootNode) return '';
  const lang = locale.value === 'en' ? 'en' : 'de';
  return generateInteractiveTreeHtml(res.rootNode, {
    customTitleDe: customTitleDe.value,
    customTitleEn: customTitleEn.value,
    defaultLang: lang,
  });
});

function reloadPreview() {
  previewKey.value++;
}

async function saveHtmlFile() {
  if (!generatedHtml.value || !selectedRootPerson.value) return;
  saveStatusMsg.value = '';
  saveErrorMsg.value = '';

  const p = selectedRootPerson.value;
  const rawName = `${p.given_name || ''}_${p.surname || p.id}`
    .trim()
    .replace(/[^a-zA-Z0-9äöüÄÖÜß_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const defaultFileName = `interaktiver_stammbaum_${rawName || 'export'}.html`;

  try {
    const filePath = await save({
      title: t('export_save_dialog_title'),
      defaultPath: defaultFileName,
      filters: [{ name: 'HTML-Datei (*.html)', extensions: ['html', 'htm'] }],
    });

    if (!filePath) return;

    await invoke('save_design_file', {
      filePath,
      content: generatedHtml.value,
    });

    saveStatusMsg.value = t('export_save_success', { path: filePath });
  } catch (err: any) {
    saveErrorMsg.value = t('export_save_error', { error: String(err) });
  }
}
</script>

<template>
  <div class="export-module-container">
    <!-- Export Modul Kopfzeile: Ansichten des Export-Moduls -->
    <header class="export-module-header">
      <div class="module-title-area">
        <span class="module-badge">📦 {{ t('export_module_title') }}</span>
      </div>
      <nav class="export-module-tabs">
        <button
          class="module-tab-btn"
          :class="{ active: activeExportModuleTab === 'html' }"
          @click="activeExportModuleTab = 'html'"
        >
          🌐 {{ t('export_tab_html') }}
        </button>
        <button
          class="module-tab-btn disabled-tab"
          :class="{ active: activeExportModuleTab === 'pdf' }"
          @click="activeExportModuleTab = 'pdf'"
          :title="t('export_coming_soon')"
        >
          📄 {{ t('export_tab_pdf') }}
        </button>
        <button
          class="module-tab-btn disabled-tab"
          :class="{ active: activeExportModuleTab === 'csv' }"
          @click="activeExportModuleTab = 'csv'"
          :title="t('export_coming_soon')"
        >
          📊 {{ t('export_tab_csv') }}
        </button>
        <button
          class="module-tab-btn disabled-tab"
          :class="{ active: activeExportModuleTab === 'gedcom' }"
          @click="activeExportModuleTab = 'gedcom'"
          :title="t('export_coming_soon')"
        >
          🧬 {{ t('export_tab_gedcom') }}
        </button>
      </nav>
    </header>

    <!-- Modul-Ansicht 1: Interaktiver HTML-Export -->
    <div v-if="activeExportModuleTab === 'html'" class="export-workspace">
      <!-- Linker Konfigurations- und Stammahnen-Bereich -->
      <aside class="export-sidebar" :class="{ collapsed: isLeftPanelCollapsed }">
        <button
          class="sidebar-collapse-toggle"
          @click="isLeftPanelCollapsed = !isLeftPanelCollapsed"
          :title="isLeftPanelCollapsed ? t('export_show_panel') : t('export_hide_panel')"
        >
          {{ isLeftPanelCollapsed ? '▶' : '◀' }}
        </button>

        <div v-if="!isLeftPanelCollapsed" class="export-sidebar-inner">
          <div class="export-panel-header">
            <h2>{{ t('export_panel_title') }}</h2>
            <p class="export-panel-subtitle">{{ t('export_panel_subtitle') }}</p>
          </div>

          <!-- 1. Stammahnen-Auswahl über Drop Down Menü -->
          <div class="export-section">
            <label class="export-section-label">🌳 {{ t('export_defined_roots_label') }}</label>
            <select
              class="export-dropdown"
              :value="isSelectedRootInDefinedList ? selectedExportRootId : ''"
              @change="onDefinedRootDropdownChange(($event.target as HTMLSelectElement).value)"
            >
              <option value="" :disabled="rootAncestors.length > 0">
                {{ rootAncestors.length === 0 ? t('no_probands') : t('please_select') }}
              </option>
              <option
                v-for="r in rootAncestors"
                :key="r.person_id"
                :value="r.person_id"
              >
                [{{ r.starting_code }}] {{ r.surname || 'N.N.' }}, {{ r.given_name || 'N.N.' }} ({{ r.person_id }})
              </option>
            </select>
          </div>

          <!-- 2. Beliebige andere Person aus der Datenbank als Stammahn wählen (optional ausklappbar) -->
          <div class="export-section custom-picker-section">
            <button
              class="btn-toggle-custom-picker"
              @click="showCustomPersonPicker = !showCustomPersonPicker"
            >
              <span>{{ showCustomPersonPicker ? '▲' : '▼' }} {{ t('export_other_person_toggle') }}</span>
              <span v-if="!isSelectedRootInDefinedList && selectedRootPerson" class="custom-selected-indicator">
                ✓ {{ selectedRootPerson.surname }}
              </span>
            </button>

            <div v-if="showCustomPersonPicker" class="custom-picker-body">
              <input
                type="text"
                v-model="personSearchQuery"
                :placeholder="t('export_person_search_placeholder')"
                class="export-input"
              />
              <div class="person-picker-list">
                <div
                  v-for="p in filteredPersonsList"
                  :key="p.id"
                  class="person-picker-item"
                  :class="{ selected: selectedExportRootId === p.id }"
                  @click="selectRootPerson(p.id)"
                >
                  <div class="picker-item-main">
                    <strong>{{ p.surname || 'N.N.' }}, {{ p.given_name || 'N.N.' }}</strong>
                    <span class="picker-item-id">{{ p.id }}</span>
                  </div>
                  <div class="picker-item-meta">
                    <span v-if="p.birth_date">* {{ p.birth_date }}</span>
                    <span v-if="p.death_date">† {{ p.death_date }}</span>
                    <span
                      v-if="(directChildrenCountMap.get(p.id) || 0) > 0"
                      class="picker-kids-badge"
                    >
                      {{ directChildrenCountMap.get(p.id) }} {{ t('children') }}
                    </span>
                  </div>
                </div>
                <div v-if="filteredPersonsList.length === 0" class="picker-empty">
                  {{ t('export_no_person_found') }}
                </div>
              </div>
            </div>
          </div>

          <!-- 3. Export Optionen: Start-Code, Standard-Ausrichtung & Titel -->
          <div class="export-section" v-if="selectedRootPerson">
            <label class="export-section-label">⚙️ {{ t('export_options_label') }}</label>
            
            <div class="export-form-row">
              <label>{{ t('export_start_code_label') }}</label>
              <input
                type="text"
                v-model="exportStartCode"
                class="export-input code-inp"
                placeholder="1"
              />
            </div>

            <div class="export-form-row">
              <label>{{ t('export_title_de_label') }}</label>
              <input type="text" v-model="customTitleDe" class="export-input" />
            </div>
            <div class="export-form-row">
              <label>{{ t('export_title_en_label') }}</label>
              <input type="text" v-model="customTitleEn" class="export-input" />
            </div>
          </div>

          <!-- 4. Berechnete Henry-Statistik -->
          <div class="export-section stats-card" v-if="selectedRootPerson && exportTreeResult">
            <div class="stats-header">
              <span class="stats-title">📊 {{ t('export_stats_title') }}</span>
              <span class="stats-root-badge">
                [{{ exportStartCode || '1' }}] {{ selectedRootPerson.given_name }} {{ selectedRootPerson.surname }}
              </span>
            </div>
            <div class="stats-grid">
              <div class="stat-box">
                <span class="stat-val">{{ exportTreeResult.stats.totalNodes }}</span>
                <span class="stat-lbl">{{ t('export_stat_nodes') }}</span>
              </div>
              <div class="stat-box">
                <span class="stat-val">{{ exportTreeResult.stats.maxGeneration }}</span>
                <span class="stat-lbl">{{ t('export_stat_generations') }}</span>
              </div>
              <div class="stat-box">
                <span class="stat-val">{{ exportTreeResult.stats.branchCount }}</span>
                <span class="stat-lbl">{{ t('export_stat_branches') }}</span>
              </div>
              <div class="stat-box">
                <span class="stat-val">{{ exportTreeResult.stats.implexCount }}</span>
                <span class="stat-lbl">{{ t('export_stat_implex') }}</span>
              </div>
            </div>
          </div>

          <!-- 5. Export Aktionen -->
          <div class="export-actions-footer">
            <button
              class="btn-export-save"
              :disabled="!generatedHtml"
              @click="saveHtmlFile"
            >
              💾 {{ t('export_save_html_btn') }}
            </button>
            <button
              class="btn-export-reload"
              :disabled="!generatedHtml"
              @click="reloadPreview"
              :title="t('export_reload_preview_tooltip')"
            >
              🔄 {{ t('export_reload_preview_btn') }}
            </button>

            <div v-if="saveStatusMsg" class="export-alert success">
              ✅ {{ saveStatusMsg }}
            </div>
            <div v-if="saveErrorMsg" class="export-alert error">
              ⚠️ {{ saveErrorMsg }}
            </div>
          </div>
        </div>
      </aside>

      <!-- Rechter Hauptbereich: Interaktive Vorschau (Desktop View / Mobile View umschaltbar) -->
      <section class="export-preview-pane">
        <div class="export-preview-topbar" v-if="selectedRootPerson && exportTreeResult">
          <div class="preview-info-left">
            <span class="preview-badge">👁️ {{ t('export_preview_badge') }}</span>
            <strong>
              {{ selectedRootPerson.given_name }} {{ selectedRootPerson.surname }}
            </strong>
            <span class="preview-meta">
              ({{ exportTreeResult.stats.totalNodes }} {{ t('export_stat_nodes') }},
              {{ exportTreeResult.stats.maxGeneration }} {{ t('export_stat_generations') }})
            </span>
          </div>

          <!-- Viewport Umschalter: Desktop View / Mobile View -->
          <div class="viewport-toggle-area">
            <div class="viewport-btn-group">
              <button
                class="btn-viewport"
                :class="{ active: previewViewport === 'desktop' }"
                @click="previewViewport = 'desktop'"
              >
                🖥️ {{ t('export_viewport_desktop') }}
              </button>
              <button
                class="btn-viewport"
                :class="{ active: previewViewport === 'mobile' }"
                @click="previewViewport = 'mobile'"
              >
                📱 {{ t('export_viewport_mobile') }}
              </button>
            </div>

            <button
              v-if="previewViewport === 'mobile'"
              class="btn-viewport-rotate"
              @click="mobileOrientation = mobileOrientation === 'portrait' ? 'landscape' : 'portrait'"
              :title="t('export_viewport_rotate')"
            >
              🔄 {{ mobileOrientation === 'portrait' ? '390 × 844' : '844 × 390' }}
            </button>
          </div>

          <div class="preview-info-right">
            <button class="btn-topbar-save" @click="saveHtmlFile">
              💾 {{ t('export_save_html_btn') }}
            </button>
          </div>
        </div>

        <!-- Vorschau-Inhalt: Normaler Desktop-Vollbildmodus oder Mobile-Smartphone-Rahmen -->
        <div
          v-if="generatedHtml"
          class="iframe-workspace"
          :class="{ 'mobile-mode': previewViewport === 'mobile' }"
        >
          <!-- Desktop Mode: 100% Breite & Höhe -->
          <div v-if="previewViewport === 'desktop'" class="desktop-frame">
            <iframe
              :key="'desk-' + previewKey"
              :srcdoc="generatedHtml"
              class="export-preview-iframe"
              sandbox="allow-scripts allow-same-origin"
              :title="t('export_preview_badge')"
            ></iframe>
          </div>

          <!-- Mobile Mode: Smartphone Device Mockup Rahmen -->
          <div
            v-else
            class="phone-mockup-wrapper"
            :class="mobileOrientation"
          >
            <div class="phone-device-frame">
              <div class="phone-speaker-notch"></div>
              <iframe
                :key="'mob-' + previewKey + '-' + mobileOrientation"
                :srcdoc="generatedHtml"
                class="export-preview-iframe mobile-iframe"
                sandbox="allow-scripts allow-same-origin"
                :title="t('export_preview_badge')"
              ></iframe>
            </div>
          </div>
        </div>

        <div v-else class="export-empty-state">
          <div class="empty-card">
            <h3>🌐 {{ t('export_panel_title') }}</h3>
            <p>{{ t('export_empty_hint') }}</p>
          </div>
        </div>
      </section>
    </div>

    <!-- Platzhalter für zukünftige Ansichten im Export-Modul -->
    <div v-else class="export-module-placeholder">
      <div class="placeholder-card">
        <h3>{{ activeExportModuleTab === 'pdf' ? '📄 ' + t('export_tab_pdf') : activeExportModuleTab === 'csv' ? '📊 ' + t('export_tab_csv') : '🧬 ' + t('export_tab_gedcom') }}</h3>
        <p>{{ t('export_module_tab_hint') }}</p>
        <button class="btn-back-to-html" @click="activeExportModuleTab = 'html'">
          ← {{ t('export_back_to_html') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.export-module-container {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  overflow: hidden;
}

/* Modul-Kopfzeile */
.export-module-header {
  height: 44px;
  min-height: 44px;
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  gap: 16px;
  z-index: 15;
}

.module-badge {
  font-size: 0.92rem;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: 0.2px;
}

.export-module-tabs {
  display: flex;
  gap: 6px;
}

.module-tab-btn {
  padding: 6px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #f8fafc;
  color: #475569;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.module-tab-btn:hover:not(.disabled-tab) {
  background: #eff6ff;
  border-color: #93c5fd;
  color: #1d4ed8;
}

.module-tab-btn.active {
  background: #2563eb;
  border-color: #1d4ed8;
  color: #ffffff;
}

.module-tab-btn.disabled-tab {
  opacity: 0.65;
  cursor: pointer;
  background: #f1f5f9;
}

.export-workspace {
  display: flex;
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
}

.export-sidebar {
  width: 350px;
  min-width: 350px;
  background: #ffffff;
  border-right: 1px solid #cbd5e1;
  display: flex;
  flex-direction: column;
  position: relative;
  transition: width 0.22s ease, min-width 0.22s ease;
  z-index: 10;
}

.export-sidebar.collapsed {
  width: 32px;
  min-width: 32px;
}

.sidebar-collapse-toggle {
  position: absolute;
  top: 10px;
  right: 6px;
  width: 22px;
  height: 26px;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  background: #f8fafc;
  color: #334155;
  font-size: 11px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  z-index: 20;
}

.sidebar-collapse-toggle:hover {
  background: #e2e8f0;
}

.export-sidebar-inner {
  padding: 14px 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
}

.export-panel-header h2 {
  font-size: 1.05rem;
  color: #0f172a;
  margin: 0 24px 4px 0;
}

.export-panel-subtitle {
  font-size: 0.8rem;
  color: #64748b;
  line-height: 1.35;
  margin: 0;
}

.export-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.export-section-label {
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: #475569;
}

.export-dropdown {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font-size: 0.84rem;
  background: #ffffff;
  color: #1e293b;
  outline: none;
  cursor: pointer;
}

.export-dropdown:focus {
  border-color: #2563eb;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
}

.btn-toggle-custom-picker {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding: 6px 10px;
  background: #f8fafc;
  border: 1px dashed #cbd5e1;
  border-radius: 6px;
  font-size: 0.78rem;
  font-weight: 600;
  color: #475569;
  cursor: pointer;
}

.btn-toggle-custom-picker:hover {
  background: #eff6ff;
  border-color: #93c5fd;
  color: #1d4ed8;
}

.custom-selected-indicator {
  font-size: 0.72rem;
  background: #dbeafe;
  color: #1d4ed8;
  padding: 2px 6px;
  border-radius: 4px;
}

.custom-picker-body {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.export-input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font-size: 0.84rem;
  outline: none;
  background: #ffffff;
  color: #1e293b;
}

.export-input:focus {
  border-color: #2563eb;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
}

.person-picker-list {
  max-height: 180px;
  overflow-y: auto;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #f8fafc;
}

.person-picker-item {
  padding: 7px 10px;
  border-bottom: 1px solid #e2e8f0;
  cursor: pointer;
  font-size: 0.82rem;
  transition: background 0.12s;
}

.person-picker-item:last-child {
  border-bottom: none;
}

.person-picker-item:hover {
  background: #eff6ff;
}

.person-picker-item.selected {
  background: #dbeafe;
  border-left: 3px solid #2563eb;
}

.picker-item-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  color: #0f172a;
}

.picker-item-id {
  font-size: 0.73rem;
  color: #64748b;
  font-family: monospace;
}

.picker-item-meta {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 0.75rem;
  color: #64748b;
  margin-top: 2px;
  flex-wrap: wrap;
}

.picker-kids-badge {
  background: #e0f2fe;
  color: #0369a1;
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 0.7rem;
  font-weight: 600;
}

.picker-empty {
  padding: 12px;
  text-align: center;
  color: #64748b;
  font-size: 0.82rem;
}

.export-form-row {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.export-form-row label {
  font-size: 0.76rem;
  color: #475569;
  font-weight: 600;
}

.code-inp {
  max-width: 110px;
  font-weight: 700;
}

.stats-card {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 10px 12px;
}

.stats-header {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-bottom: 6px;
}

.stats-title {
  font-size: 0.78rem;
  font-weight: 700;
  color: #334155;
  text-transform: uppercase;
}

.stats-root-badge {
  font-size: 0.82rem;
  font-weight: 600;
  color: #1d4ed8;
}

.stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.stat-box {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.stat-val {
  font-size: 1.05rem;
  font-weight: 700;
  color: #0f172a;
}

.stat-lbl {
  font-size: 0.72rem;
  color: #64748b;
}

.export-actions-footer {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 6px;
  border-top: 1px solid #e2e8f0;
}

.btn-export-save {
  width: 100%;
  padding: 10px 14px;
  background: #2563eb;
  color: #ffffff;
  border: none;
  border-radius: 6px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}

.btn-export-save:hover:not(:disabled) {
  background: #1d4ed8;
}

.btn-export-save:disabled {
  background: #94a3b8;
  cursor: not-allowed;
}

.btn-export-reload {
  width: 100%;
  padding: 7px 12px;
  background: #f1f5f9;
  color: #334155;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
}

.btn-export-reload:hover:not(:disabled) {
  background: #e2e8f0;
}

.export-alert {
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 0.78rem;
  word-break: break-all;
}

.export-alert.success {
  background: #dcfce7;
  color: #166534;
  border: 1px solid #86efac;
}

.export-alert.error {
  background: #fee2e2;
  color: #991b1b;
  border: 1px solid #fca5a5;
}

/* Rechter Vorschau-Bereich */
.export-preview-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  background: #f1f5f9;
}

.export-preview-topbar {
  height: 44px;
  min-height: 44px;
  padding: 0 14px;
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 0.85rem;
  z-index: 5;
}

.preview-info-left {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  white-space: nowrap;
}

.preview-badge {
  background: #eff6ff;
  color: #1d4ed8;
  font-weight: 700;
  font-size: 0.76rem;
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px solid #bfdbfe;
}

.preview-meta {
  color: #64748b;
  font-size: 0.8rem;
}

/* Viewport Toggle Switcher */
.viewport-toggle-area {
  display: flex;
  align-items: center;
  gap: 8px;
}

.viewport-btn-group {
  display: flex;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  overflow: hidden;
}

.btn-viewport {
  padding: 4px 10px;
  background: #f8fafc;
  border: none;
  font-size: 0.78rem;
  font-weight: 600;
  color: #64748b;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-viewport:not(:last-child) {
  border-right: 1px solid #cbd5e1;
}

.btn-viewport.active {
  background: #2563eb;
  color: #ffffff;
}

.btn-viewport-rotate {
  padding: 4px 8px;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font-size: 0.76rem;
  font-weight: 600;
  color: #334155;
  cursor: pointer;
}

.btn-viewport-rotate:hover {
  background: #f1f5f9;
}

.btn-topbar-save {
  padding: 5px 12px;
  background: #16a34a;
  color: #ffffff;
  border: none;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
}

.btn-topbar-save:hover {
  background: #15803d;
}

/* Iframe Workspace */
.iframe-workspace {
  flex: 1;
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
}

.desktop-frame {
  width: 100%;
  height: 100%;
}

.export-preview-iframe {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
}

/* Mobile Smartphone Mockup Frame */
.iframe-workspace.mobile-mode {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: #cbd5e1;
  overflow: auto;
}

.phone-mockup-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.25s ease;
}

.phone-mockup-wrapper.portrait .phone-device-frame {
  width: 390px;
  height: 780px;
  max-height: calc(100vh - 170px);
}

.phone-mockup-wrapper.landscape .phone-device-frame {
  width: 780px;
  max-width: calc(100vw - 420px);
  height: 390px;
}

.phone-device-frame {
  background: #0f172a;
  border: 10px solid #1e293b;
  border-radius: 36px;
  box-shadow: 0 20px 45px rgba(15, 23, 42, 0.35);
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.phone-speaker-notch {
  width: 90px;
  height: 5px;
  background: #334155;
  border-radius: 4px;
  margin: 6px auto 4px auto;
  flex-shrink: 0;
}

.mobile-iframe {
  flex: 1;
  width: 100%;
  height: 100%;
  border-radius: 0 0 26px 26px;
  background: #ffffff;
}

/* Empty & Placeholder States */
.export-empty-state,
.export-module-placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.empty-card,
.placeholder-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 28px 36px;
  text-align: center;
  max-width: 440px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.05);
}

.placeholder-card h3,
.empty-card h3 {
  margin: 0 0 8px 0;
  color: #0f172a;
}

.placeholder-card p,
.empty-card p {
  margin: 0 0 16px 0;
  color: #64748b;
  font-size: 0.9rem;
  line-height: 1.4;
}

.btn-back-to-html {
  padding: 7px 14px;
  background: #2563eb;
  color: #ffffff;
  border: none;
  border-radius: 6px;
  font-size: 0.84rem;
  font-weight: 600;
  cursor: pointer;
}
</style>
