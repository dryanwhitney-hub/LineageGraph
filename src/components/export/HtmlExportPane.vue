<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { useI18n } from 'vue-i18n';
import {
  buildInteractiveExportTree,
  generateInteractiveTreeHtml,
  type ExportPersonInput,
} from '../../utils/htmlExport';

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
  selectedExportRootId: string;
  exportStartCode: string;
}>();

const emit = defineEmits<{
  (e: 'update:selectedExportRootId', id: string): void;
  (e: 'update:exportStartCode', code: string): void;
  (e: 'select-proband', personId: string): void;
}>();

const { t, locale } = useI18n();

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

const isSelectedRootInDefinedList = computed<boolean>(() => {
  return props.rootAncestors.some(r => r.person_id === props.selectedExportRootId);
});

const selectedRootPerson = computed<ExportPersonInput | null>(() => {
  if (!props.selectedExportRootId) return null;
  return props.persons.find(p => p.id === props.selectedExportRootId) || null;
});

function selectRootPerson(personId: string, startCode?: string) {
  emit('update:selectedExportRootId', personId);
  const configured = props.rootAncestors.find(r => r.person_id === personId);
  if (startCode !== undefined) {
    emit('update:exportStartCode', startCode);
  } else if (configured) {
    emit('update:exportStartCode', configured.starting_code || '1');
  } else if (!props.exportStartCode.trim()) {
    emit('update:exportStartCode', '1');
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

watch(
  () => props.rootAncestors,
  newRoots => {
    if (newRoots.length === 0) {
      showCustomPersonPicker.value = true;
    }
  }
);

watch(
  () => props.selectedExportRootId,
  newId => {
    if (newId) {
      const p = props.persons.find(x => x.id === newId);
      if (p && !customTitleDe.value) {
        const label = (p.surname || `${p.given_name || ''} ${p.surname || ''}`).trim() || 'Familie';
        customTitleDe.value = `Stammbaum ${label}`;
        customTitleEn.value = `${label} Family Tree`;
      }
    }
  },
  { immediate: true }
);

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
  if (!props.selectedExportRootId) {
    return null;
  }
  return buildInteractiveExportTree(
    props.persons,
    props.selectedExportRootId,
    props.exportStartCode || '1'
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
  <div class="export-workspace">
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
              :value="exportStartCode"
              @input="emit('update:exportStartCode', ($event.target as HTMLInputElement).value)"
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

        <!-- 5. Plattform- & Offline-Kompatibilität -->
        <div class="export-compat-card" v-if="selectedRootPerson && exportTreeResult">
          <div class="compat-badge-header">
            <span class="compat-icon">📱</span>
            <span class="compat-title">{{ t('export_compat_badge_title') }}</span>
          </div>
          <p class="compat-desc">{{ t('export_compat_badge_desc') }}</p>
        </div>

        <!-- 6. Export Aktionen -->
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
          <span class="preview-offline-pill" :title="t('export_compat_badge_desc')">
            ✓ {{ t('export_compat_badge_pill') }}
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
</template>

<style scoped>
.export-workspace {
  display: flex;
  flex: 1;
  min-height: 0;
  height: 100%;
  position: relative;
  overflow: hidden;
}

/* Linke Seitenleiste */
.export-sidebar {
  width: 380px;
  min-width: 380px;
  max-width: 460px;
  height: 100%;
  background: #ffffff;
  border-right: 1px solid #e2e8f0;
  display: flex;
  flex-direction: column;
  position: relative;
  transition: width 0.2s ease, min-width 0.2s ease;
  z-index: 10;
}

.export-sidebar.collapsed {
  width: 36px;
  min-width: 36px;
}

.sidebar-collapse-toggle {
  position: absolute;
  top: 10px;
  right: -14px;
  width: 24px;
  height: 24px;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.65rem;
  color: #64748b;
  cursor: pointer;
  z-index: 20;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
  transition: all 0.15s ease;
}

.sidebar-collapse-toggle:hover {
  background: #f1f5f9;
  color: #1e293b;
  border-color: #94a3b8;
}

.export-sidebar-inner {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
  padding: 16px;
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

.export-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 12px;
}

.export-section-label {
  font-size: 0.82rem;
  font-weight: 700;
  color: #334155;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.export-dropdown {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #ffffff;
  font-size: 0.84rem;
  color: #1e293b;
  cursor: pointer;
}

.export-dropdown:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
}

.btn-toggle-custom-picker {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 6px 10px;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font-size: 0.82rem;
  font-weight: 600;
  color: #475569;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-toggle-custom-picker:hover {
  background: #f1f5f9;
  border-color: #94a3b8;
}

.custom-selected-indicator {
  font-size: 0.76rem;
  color: #2563eb;
  font-weight: 700;
}

.custom-picker-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
}

.export-input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font-size: 0.84rem;
  color: #1e293b;
  background: #ffffff;
  box-sizing: border-box;
}

.export-input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
}

.person-picker-list {
  max-height: 180px;
  overflow-y: auto;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #ffffff;
}

.person-picker-item {
  padding: 6px 10px;
  border-bottom: 1px solid #f1f5f9;
  cursor: pointer;
  transition: background 0.1s ease;
}

.person-picker-item:last-child {
  border-bottom: none;
}

.person-picker-item:hover {
  background: #f8fafc;
}

.person-picker-item.selected {
  background: #eff6ff;
  border-left: 3px solid #3b82f6;
}

.picker-item-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.82rem;
}

.picker-item-id {
  font-size: 0.72rem;
  font-family: monospace;
  color: #64748b;
}

.picker-item-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.72rem;
  color: #94a3b8;
  margin-top: 2px;
}

.picker-kids-badge {
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 1px 6px;
  font-size: 0.68rem;
  color: #475569;
  font-weight: 600;
  margin-left: auto;
}

.picker-empty {
  padding: 12px;
  text-align: center;
  font-size: 0.78rem;
  color: #94a3b8;
}

.export-form-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.export-form-row label {
  font-size: 0.78rem;
  font-weight: 600;
  color: #475569;
}

.code-inp {
  max-width: 110px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-weight: 700;
}

/* Stats Card */
.stats-card {
  background: #ffffff;
}

.stats-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #f1f5f9;
  padding-bottom: 6px;
}

.stats-title {
  font-size: 0.78rem;
  font-weight: 700;
  color: #475569;
  text-transform: uppercase;
}

.stats-root-badge {
  font-size: 0.72rem;
  color: #2563eb;
  font-weight: 600;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
}

.stat-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 6px;
}

.stat-val {
  font-size: 1.1rem;
  font-weight: 700;
  color: #0f172a;
}

.stat-lbl {
  font-size: 0.68rem;
  color: #64748b;
  text-transform: uppercase;
}

/* Actions Footer */
.export-actions-footer {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid #e2e8f0;
}

.btn-export-save {
  width: 100%;
  padding: 10px 14px;
  background: #10b981;
  border: none;
  border-radius: 6px;
  color: #ffffff;
  font-size: 0.88rem;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(16, 185, 129, 0.3);
  transition: all 0.15s ease;
}

.btn-export-save:hover:not(:disabled) {
  background: #059669;
  transform: translateY(-1px);
}

.btn-export-save:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-export-reload {
  width: 100%;
  padding: 8px 12px;
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  color: #475569;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-export-reload:hover:not(:disabled) {
  background: #e2e8f0;
  color: #1e293b;
}

.export-alert {
  font-size: 0.78rem;
  padding: 6px 10px;
  border-radius: 6px;
  line-height: 1.35;
}

.export-alert.success {
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
  color: #065f46;
}

.export-alert.error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
}

/* Rechter Vorschau-Bereich */
.export-preview-pane {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #f1f5f9;
  position: relative;
  overflow: hidden;
}

.export-preview-topbar {
  height: 48px;
  min-height: 48px;
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  gap: 12px;
  z-index: 5;
}

.preview-info-left {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.86rem;
  color: #0f172a;
}

.preview-badge {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  padding: 3px 8px;
  border-radius: 4px;
  color: #334155;
}

.preview-meta {
  font-size: 0.78rem;
  color: #64748b;
}

.preview-offline-pill {
  font-size: 0.72rem;
  font-weight: 600;
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
  padding: 2px 7px;
  border-radius: 4px;
  color: #047857;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.export-compat-card {
  margin: 12px 14px 4px 14px;
  padding: 10px 12px;
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.compat-badge-header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.compat-icon {
  font-size: 0.95rem;
}

.compat-title {
  font-size: 0.78rem;
  font-weight: 700;
  color: #166534;
}

.compat-desc {
  font-size: 0.72rem;
  color: #15803d;
  line-height: 1.35;
  margin: 0;
}

.viewport-toggle-area {
  display: flex;
  align-items: center;
  gap: 8px;
}

.viewport-btn-group {
  display: flex;
  background: #f1f5f9;
  border-radius: 6px;
  padding: 2px;
  border: 1px solid #e2e8f0;
}

.btn-viewport {
  padding: 4px 10px;
  border: none;
  background: transparent;
  font-size: 0.78rem;
  font-weight: 600;
  color: #64748b;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-viewport.active {
  background: #ffffff;
  color: #1e293b;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.btn-viewport-rotate {
  padding: 4px 8px;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font-size: 0.74rem;
  font-weight: 600;
  color: #475569;
  cursor: pointer;
}

.btn-viewport-rotate:hover {
  background: #f8fafc;
  color: #1e293b;
}

.preview-info-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-topbar-save {
  padding: 6px 12px;
  background: #10b981;
  border: none;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 700;
  color: #ffffff;
  cursor: pointer;
}

.btn-topbar-save:hover {
  background: #059669;
}

/* Iframe Workspace */
.iframe-workspace {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
  display: flex;
}

.desktop-frame {
  width: 100%;
  height: 100%;
  display: flex;
}

.export-preview-iframe {
  width: 100%;
  height: 100%;
  border: none;
  background: #ffffff;
}

/* Mobile Smartphone Mockup Frame */
.iframe-workspace.mobile-mode {
  background: #334155;
  align-items: center;
  justify-content: center;
  overflow: auto;
  padding: 24px;
}

.phone-mockup-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.25s ease;
}

.phone-device-frame {
  background: #0f172a;
  border: 10px solid #1e293b;
  border-radius: 40px;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 2px #475569;
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.phone-speaker-notch {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  width: 90px;
  height: 14px;
  background: #0f172a;
  border-radius: 10px;
  z-index: 10;
}

.phone-mockup-wrapper.portrait .phone-device-frame {
  width: 390px;
  height: 780px;
}

.phone-mockup-wrapper.landscape .phone-device-frame {
  width: 780px;
  height: 390px;
}

.phone-mockup-wrapper.landscape .phone-speaker-notch {
  top: 50%;
  left: 8px;
  transform: translateY(-50%);
  width: 14px;
  height: 90px;
}

.mobile-iframe {
  flex: 1;
  width: 100%;
  height: 100%;
}

.export-empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.empty-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 32px 40px;
  text-align: center;
  max-width: 440px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.empty-card h3 {
  font-size: 1.1rem;
  color: #1e293b;
  margin: 0 0 8px 0;
}

.empty-card p {
  font-size: 0.85rem;
  color: #64748b;
  margin: 0;
  line-height: 1.4;
}
</style>
