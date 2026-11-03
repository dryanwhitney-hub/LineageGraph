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
import {
  generateDesignExportSvg,
  renderSvgToRaster,
  type DesignPersistedState,
  type DesignExportResult,
} from '../utils/designExport';
import { loadBackgroundImageFromDB } from '../utils/designBgStorage';

interface RootAncestorConfig {
  person_id: string;
  starting_code: string;
  given_name: string | null;
  surname: string | null;
}

interface DesignLayoutEntry {
  id: string;
  proband_id: string;
  name: string;
  created_at: string;
  layout_data: string;
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

// Export Modul Tabs (HTML Export und Stammbaum Design Mode Bild-Export)
const activeExportModuleTab = ref<'html' | 'design_image' | 'pdf' | 'csv' | 'gedcom'>('html');

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

  // Pre-fetch saved design layouts so they are immediately available
  fetchSavedDesignLayouts();
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

// ----------------------------------------------------
// Stammbaum Design Mode Bild-Export (PNG, JPG, SVG)
// ----------------------------------------------------
const savedDesignLayouts = ref<DesignLayoutEntry[]>([]);
const isLoadingDesignLayouts = ref<boolean>(false);
const selectedDesignLayoutId = ref<string>('');
const selectedDesignState = ref<DesignPersistedState | null>(null);

const designExportGrid = ref<boolean>(false);
const designExportIncludeBg = ref<boolean>(true);
const designExportOnlyYears = ref<boolean>(false);
const designExportFormat = ref<'png' | 'jpg' | 'svg'>('png');
const designExportScale = ref<number>(2);
const isExportingDesign = ref<boolean>(false);

const designViewportRef = ref<HTMLElement | null>(null);
const designPreviewZoom = ref<number>(1);
const designPreviewPan = ref<{ x: number; y: number }>({ x: 0, y: 0 });
let isDesignPanning = false;
let designPanStartClient = { x: 0, y: 0 };
let designPanOrigin = { x: 0, y: 0 };

function formatLayoutDate(isoStr: string): string {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString(locale.value === 'en' ? 'en-US' : 'de-DE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoStr;
  }
}

async function fetchSavedDesignLayouts() {
  isLoadingDesignLayouts.value = true;
  saveStatusMsg.value = '';
  saveErrorMsg.value = '';
  try {
    const list = await invoke<DesignLayoutEntry[]>('get_design_layouts', { probandId: '' });
    savedDesignLayouts.value = list || [];
    if (savedDesignLayouts.value.length > 0) {
      let chosen = savedDesignLayouts.value[0];
      if (selectedDesignLayoutId.value) {
        const found = savedDesignLayouts.value.find(l => l.id === selectedDesignLayoutId.value);
        if (found) chosen = found;
      } else if (props.activeProbandId) {
        const matching = savedDesignLayouts.value.find(l => l.proband_id === props.activeProbandId);
        if (matching) chosen = matching;
      }
      await selectDesignLayout(chosen);
    } else {
      selectedDesignState.value = null;
      selectedDesignLayoutId.value = '';
    }
  } catch (err) {
    console.error('Failed to load design layouts', err);
    savedDesignLayouts.value = [];
    selectedDesignState.value = null;
  } finally {
    isLoadingDesignLayouts.value = false;
  }
}

async function selectDesignLayout(entry: DesignLayoutEntry) {
  selectedDesignLayoutId.value = entry.id;
  try {
    const parsed = JSON.parse(entry.layout_data) as DesignPersistedState;
    if (!parsed.backgroundImageData && parsed.backgroundConfig) {
      try {
        const pId = parsed.probandId || 'default';
        let stored = await loadBackgroundImageFromDB(`proband_${pId}`);
        if (!stored || !stored.dataUrl) {
          stored = await loadBackgroundImageFromDB(`design_bg_${parsed.probandId}`);
        }
        if (!stored || !stored.dataUrl) {
          stored = await loadBackgroundImageFromDB();
        }
        if (stored && stored.dataUrl) {
          parsed.backgroundImageData = stored.dataUrl;
        }
      } catch {}
    }
    selectedDesignState.value = parsed;
    if (parsed.cardConfig && typeof parsed.cardConfig.showOnlyYears === 'boolean') {
      designExportOnlyYears.value = parsed.cardConfig.showOnlyYears;
    }
    setTimeout(() => {
      fitDesignPreview();
    }, 120);
  } catch (err) {
    console.error('Failed to parse design layout_data', err);
    selectedDesignState.value = null;
  }
}

function onDesignLayoutDropdownChange(id: string) {
  const found = savedDesignLayouts.value.find(l => l.id === id);
  if (found) {
    selectDesignLayout(found);
  }
}

const designExportResult = computed<DesignExportResult | null>(() => {
  if (!selectedDesignState.value) return null;
  return generateDesignExportSvg(selectedDesignState.value, props.persons as any, {
    includeGrid: designExportGrid.value,
    includeBackground: designExportIncludeBg.value,
    format: designExportFormat.value,
    scale: designExportScale.value,
    onlyYears: designExportOnlyYears.value,
    locale: locale.value === 'en' ? 'en' : 'de',
  });
});

watch(
  () => designExportResult.value,
  newVal => {
    if (newVal) {
      setTimeout(fitDesignPreview, 60);
    }
  }
);

function fitDesignPreview() {
  if (!designExportResult.value || !designViewportRef.value) return;
  const viewport = designViewportRef.value;
  const vW = viewport.clientWidth - 48;
  const vH = viewport.clientHeight - 48;
  const sW = designExportResult.value.width;
  const sH = designExportResult.value.height;
  if (sW <= 0 || sH <= 0) return;
  if (vW <= 0 || vH <= 0) {
    setTimeout(fitDesignPreview, 50);
    return;
  }
  const scale = Math.min(1.2, Math.max(0.005, Math.min(vW / sW, vH / sH)));
  designPreviewZoom.value = +scale.toFixed(4);
  designPreviewPan.value = {
    x: Math.round((viewport.clientWidth - sW * scale) / 2),
    y: Math.round((viewport.clientHeight - sH * scale) / 2),
  };
}

function resetDesignZoom() {
  designPreviewZoom.value = 1;
  if (!designExportResult.value || !designViewportRef.value) return;
  const viewport = designViewportRef.value;
  designPreviewPan.value = {
    x: Math.round((viewport.clientWidth - designExportResult.value.width) / 2),
    y: Math.round((viewport.clientHeight - designExportResult.value.height) / 2),
  };
}

function zoomDesignIn() {
  designPreviewZoom.value = Math.min(3.5, +(designPreviewZoom.value * 1.25).toFixed(4));
}

function zoomDesignOut() {
  designPreviewZoom.value = Math.max(0.005, +(designPreviewZoom.value / 1.25).toFixed(4));
}

function onDesignWheel(e: WheelEvent) {
  e.preventDefault();
  const delta = e.deltaY < 0 ? 1.15 : 0.85;
  designPreviewZoom.value = Math.min(3.5, Math.max(0.005, +(designPreviewZoom.value * delta).toFixed(4)));
}

function onDesignMouseDown(e: MouseEvent) {
  if (e.button !== 0) return;
  isDesignPanning = true;
  designPanStartClient = { x: e.clientX, y: e.clientY };
  designPanOrigin = { x: designPreviewPan.value.x, y: designPreviewPan.value.y };
  window.addEventListener('mousemove', onDesignMouseMove);
  window.addEventListener('mouseup', onDesignMouseUp);
}

function onDesignMouseMove(e: MouseEvent) {
  if (!isDesignPanning) return;
  const dx = e.clientX - designPanStartClient.x;
  const dy = e.clientY - designPanStartClient.y;
  designPreviewPan.value = {
    x: designPanOrigin.x + dx,
    y: designPanOrigin.y + dy,
  };
}

function onDesignMouseUp() {
  isDesignPanning = false;
  window.removeEventListener('mousemove', onDesignMouseMove);
  window.removeEventListener('mouseup', onDesignMouseUp);
}

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

async function saveDesignImageFile() {
  if (!designExportResult.value || !selectedDesignState.value) return;
  saveStatusMsg.value = '';
  saveErrorMsg.value = '';
  isExportingDesign.value = true;

  const stateName = selectedDesignState.value.name || 'stammbaum_design';
  const cleanName = stateName.replace(/[^a-zA-Z0-9äöüÄÖÜß_-]+/g, '_').replace(/^_+|_+$/g, '');
  const fmt = designExportFormat.value;
  const defaultFileName = `${cleanName || 'stammbaum_design'}.${fmt}`;

  try {
    let filePath: string | null = null;
    try {
      const res = await save({
        title: t('export_design_save_dialog_title'),
        defaultPath: defaultFileName,
        filters: [
          fmt === 'png'
            ? { name: 'PNG Bild (*.png)', extensions: ['png'] }
            : fmt === 'jpg'
            ? { name: 'JPEG Bild (*.jpg, *.jpeg)', extensions: ['jpg', 'jpeg'] }
            : { name: 'SVG Vektorgrafik (*.svg)', extensions: ['svg'] },
        ],
      });
      if (typeof res === 'string') filePath = res;
    } catch {
      filePath = null;
    }

    if (fmt === 'svg') {
      const svgStr = designExportResult.value.svgString;
      if (filePath) {
        await invoke('save_design_file', { filePath, content: svgStr });
        saveStatusMsg.value = t('export_design_save_success', { path: filePath });
      } else {
        const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
        downloadBlob(blob, defaultFileName);
        saveStatusMsg.value = t('export_design_save_success', { path: defaultFileName });
      }
    } else {
      const { blob } = await renderSvgToRaster(
        designExportResult.value.svgString,
        designExportResult.value.width,
        designExportResult.value.height,
        fmt,
        designExportScale.value
      );

      if (filePath) {
        const buffer = await blob.arrayBuffer();
        const data = Array.from(new Uint8Array(buffer));
        await invoke('save_binary_file', { filePath, data });
        saveStatusMsg.value = t('export_design_save_success', { path: filePath });
      } else {
        downloadBlob(blob, defaultFileName);
        saveStatusMsg.value = t('export_design_save_success', { path: defaultFileName });
      }
    }
  } catch (err: any) {
    saveErrorMsg.value = t('export_design_save_error', { error: String(err) });
  } finally {
    isExportingDesign.value = false;
  }
}

watch(activeExportModuleTab, newTab => {
  if (newTab === 'design_image') {
    fetchSavedDesignLayouts();
  }
});
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
          class="module-tab-btn"
          :class="{ active: activeExportModuleTab === 'design_image' }"
          @click="activeExportModuleTab = 'design_image'"
        >
          🖼️ {{ t('export_tab_design_image') }}
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

    <!-- Modul-Ansicht 2: Stammbaum Design Mode Bild-Export -->
    <div v-else-if="activeExportModuleTab === 'design_image'" class="export-workspace">
      <!-- Linke Seitenleiste: Konfiguration & Zustandsauswahl -->
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
            <h2>🖼️ {{ t('export_design_panel_title') }}</h2>
            <p class="export-panel-subtitle">{{ t('export_design_panel_subtitle') }}</p>
          </div>

          <!-- 1. Gespeicherter Zustand auswählen -->
          <div class="export-section">
            <label class="export-section-label">💾 {{ t('export_design_select_state_label') }}</label>
            <div v-if="savedDesignLayouts.length > 0">
              <select
                class="export-dropdown"
                :value="selectedDesignLayoutId"
                @change="onDesignLayoutDropdownChange(($event.target as HTMLSelectElement).value)"
              >
                <option
                  v-for="l in savedDesignLayouts"
                  :key="'layout-' + l.id"
                  :value="l.id"
                >
                  {{ l.name }} ({{ formatLayoutDate(l.created_at) }})
                </option>
              </select>
            </div>
            <div v-else class="empty-state-notice">
              <p>{{ t('export_design_no_states') }}</p>
            </div>
          </div>

          <!-- 2. Export-Optionen -->
          <template v-if="selectedDesignState">
            <!-- Ebenenraster Checkbox -->
            <div class="export-section">
              <label class="export-section-label">📏 {{ t('export_design_grid_option_title') }}</label>
              <label class="cfg-checkbox-label">
                <input type="checkbox" v-model="designExportGrid" />
                <span class="cfg-label-text">{{ t('export_design_include_grid') }}</span>
              </label>
              <span class="cfg-sub-hint">
                {{ designExportGrid ? t('export_design_include_grid_hint') : t('export_design_boxes_only') }}
              </span>
            </div>

            <!-- Hintergrundbild Checkbox / Info -->
            <div class="export-section">
              <label class="export-section-label">🖼️ {{ t('export_design_bg_option_title') }}</label>
              <div v-if="selectedDesignState.backgroundImageData" class="bg-config-block">
                <label class="cfg-checkbox-label">
                  <input type="checkbox" v-model="designExportIncludeBg" />
                  <span class="cfg-label-text">{{ t('export_design_include_bg') }}</span>
                </label>
                <span class="cfg-sub-hint" :style="{ color: designExportIncludeBg ? '#16a34a' : '#d97706' }">
                  {{ designExportIncludeBg ? t('export_design_bg_present', { name: selectedDesignState.backgroundConfig?.fileName || 'Bild' }) : t('export_design_bg_disabled') }}
                </span>
              </div>
              <div v-else class="bg-none-notice">
                <span>⚪ {{ t('export_design_bg_none_transparent') }}</span>
              </div>
            </div>

            <!-- Datumsanzeige (Jahreszahlen vs. volles Datum) -->
            <div class="export-section">
              <label class="export-section-label">📅 {{ t('design_cfg_only_years') }}</label>
              <label class="cfg-checkbox-label">
                <input type="checkbox" v-model="designExportOnlyYears" />
                <span class="cfg-label-text">{{ t('export_design_only_years') }}</span>
              </label>
            </div>

            <!-- Dateiformat Auswahl (PNG, JPG, SVG) -->
            <div class="export-section">
              <label class="export-section-label">🎨 {{ t('export_design_format_label') }}</label>
              <div class="format-button-group">
                <button
                  type="button"
                  class="format-pill-btn"
                  :class="{ active: designExportFormat === 'png' }"
                  @click="designExportFormat = 'png'"
                >
                  PNG
                </button>
                <button
                  type="button"
                  class="format-pill-btn"
                  :class="{ active: designExportFormat === 'jpg' }"
                  @click="designExportFormat = 'jpg'"
                >
                  JPG
                </button>
                <button
                  type="button"
                  class="format-pill-btn"
                  :class="{ active: designExportFormat === 'svg' }"
                  @click="designExportFormat = 'svg'"
                >
                  SVG
                </button>
              </div>
              <span class="cfg-sub-hint">
                {{ designExportFormat === 'png' ? t('export_design_format_png') : designExportFormat === 'jpg' ? t('export_design_format_jpg') : t('export_design_format_svg') }}
              </span>
              <span v-if="designExportFormat !== 'jpg' && !selectedDesignState.backgroundImageData" class="cfg-transparency-hint">
                💡 {{ t('export_design_transparent_hint') }}
              </span>
            </div>

            <!-- Auflösung / Skalierung bei PNG/JPG -->
            <div v-if="designExportFormat !== 'svg'" class="export-section">
              <label class="export-section-label">🔍 {{ t('export_design_scale_label') }}</label>
              <div class="scale-button-group">
                <button
                  type="button"
                  class="scale-pill-btn"
                  :class="{ active: designExportScale === 1 }"
                  @click="designExportScale = 1"
                >
                  {{ t('export_design_scale_1x') }}
                </button>
                <button
                  type="button"
                  class="scale-pill-btn"
                  :class="{ active: designExportScale === 2 }"
                  @click="designExportScale = 2"
                >
                  {{ t('export_design_scale_2x') }}
                </button>
              </div>
            </div>

            <!-- Details & Statistik -->
            <div v-if="designExportResult" class="export-section stats-section">
              <label class="export-section-label">📊 {{ t('export_design_stats_title') }}</label>
              <div class="design-stats-grid">
                <div class="d-stat-pill">
                  <span class="stat-num">{{ designExportResult.stats.totalLevels }}</span>
                  <span class="stat-lbl">{{ t('export_design_stat_levels') }}</span>
                </div>
                <div class="d-stat-pill">
                  <span class="stat-num">{{ designExportResult.stats.totalPersons }}</span>
                  <span class="stat-lbl">{{ t('export_design_stat_persons') }}</span>
                </div>
                <div class="d-stat-pill">
                  <span class="stat-num">{{ designExportResult.stats.totalGroups }}</span>
                  <span class="stat-lbl">{{ t('export_design_stat_groups') }}</span>
                </div>
              </div>
              <span class="dimension-note">
                📐 {{ t('export_design_dimensions', { width: designExportResult.width * (designExportFormat === 'svg' ? 1 : designExportScale), height: designExportResult.height * (designExportFormat === 'svg' ? 1 : designExportScale) }) }}
              </span>
            </div>

            <!-- Export Action Button -->
            <div class="export-action-box">
              <button
                class="btn-primary-export"
                :disabled="!designExportResult || isExportingDesign"
                @click="saveDesignImageFile"
              >
                💾 {{ isExportingDesign ? 'Exportiere...' : t('export_design_save_btn') }} (.{{ designExportFormat.toUpperCase() }})
              </button>

              <div v-if="saveStatusMsg" class="save-feedback success">
                ✅ {{ saveStatusMsg }}
              </div>
              <div v-if="saveErrorMsg" class="save-feedback error">
                ⚠️ {{ saveErrorMsg }}
              </div>
            </div>
          </template>
        </div>
      </aside>

      <!-- Rechter Bereich: Live-Vorschau -->
      <section class="export-preview-pane">
        <div class="export-preview-topbar">
          <div class="preview-info-left">
            <span class="badge-preview-mode">
              🖼️ {{ t('export_design_preview_badge') }}: {{ selectedDesignState?.name || '-' }}
            </span>
            <span v-if="designExportResult" class="dimensions-badge">
              {{ designExportResult.width }} × {{ designExportResult.height }} px
            </span>
          </div>

          <!-- Zoom Controls -->
          <div class="design-preview-zoom-bar">
            <button class="btn-zoom-step" @click="zoomDesignOut" :title="t('export_design_zoom_out')">➖</button>
            <span class="zoom-value">{{ designPreviewZoom < 0.1 ? (designPreviewZoom * 100).toFixed(1) : Math.round(designPreviewZoom * 100) }}%</span>
            <button class="btn-zoom-step" @click="zoomDesignIn" :title="t('export_design_zoom_in')">➕</button>
            <button class="btn-zoom-action" @click="resetDesignZoom" :title="t('export_design_zoom_reset')">100%</button>
            <button class="btn-zoom-action" @click="fitDesignPreview" :title="t('export_design_fit_screen')">🔄 {{ t('export_design_fit_screen') }}</button>
          </div>

          <div class="preview-info-right">
            <button
              class="btn-topbar-save"
              :disabled="!designExportResult || isExportingDesign"
              @click="saveDesignImageFile"
            >
              💾 {{ t('export_design_save_btn') }}
            </button>
          </div>
        </div>

        <!-- Preview Viewport -->
        <div
          v-if="designExportResult"
          ref="designViewportRef"
          class="design-export-viewport"
          :class="{ 'is-transparent-bg': (!designExportIncludeBg || !selectedDesignState?.backgroundImageData) && designExportFormat !== 'jpg' }"
          @wheel="onDesignWheel"
          @mousedown="onDesignMouseDown"
        >
          <div
            class="design-svg-stage"
            :style="{
              transform: `translate(${designPreviewPan.x}px, ${designPreviewPan.y}px) scale(${designPreviewZoom})`,
              transformOrigin: '0 0',
              width: designExportResult.width + 'px',
              height: designExportResult.height + 'px',
            }"
            v-html="designExportResult.svgString"
          ></div>
        </div>

        <div v-else class="export-empty-state">
          <div class="empty-card">
            <h3>🖼️ {{ t('export_design_panel_title') }}</h3>
            <p>{{ savedDesignLayouts.length === 0 ? t('export_design_no_states') : 'Wählen Sie einen gespeicherten Zustand aus, um die Vorschau anzuzeigen.' }}</p>
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

/* -------------------------------------------------------------------------- */
/* Stammbaum Design Mode Bild-Export Styles                                     */
/* -------------------------------------------------------------------------- */
.cfg-checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.84rem;
  color: #1e293b;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
}

.cfg-checkbox-label input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: #2563eb;
}

.cfg-sub-hint {
  font-size: 0.74rem;
  color: #64748b;
  line-height: 1.35;
  margin-top: 2px;
}

.cfg-transparency-hint {
  font-size: 0.72rem;
  color: #0369a1;
  background: #e0f2fe;
  padding: 4px 8px;
  border-radius: 4px;
  margin-top: 4px;
  line-height: 1.3;
}

.bg-config-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.bg-none-notice {
  font-size: 0.75rem;
  color: #475569;
  background: #f8fafc;
  border: 1px dashed #cbd5e1;
  border-radius: 4px;
  padding: 5px 8px;
}

.empty-state-notice {
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 6px;
  padding: 10px 12px;
  font-size: 0.8rem;
  color: #92400e;
}

.format-button-group,
.scale-button-group {
  display: flex;
  gap: 4px;
  background: #f1f5f9;
  padding: 3px;
  border-radius: 6px;
  border: 1px solid #cbd5e1;
}

.format-pill-btn,
.scale-pill-btn {
  flex: 1;
  padding: 5px 8px;
  font-size: 0.78rem;
  font-weight: 700;
  color: #475569;
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: center;
}

.format-pill-btn.active,
.scale-pill-btn.active {
  background: #2563eb;
  color: #ffffff;
  box-shadow: 0 1px 3px rgba(37, 99, 235, 0.25);
}

.design-stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  margin-top: 4px;
}

.d-stat-pill {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 6px 4px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.d-stat-pill .stat-num {
  font-size: 1.05rem;
  font-weight: 800;
  color: #1e293b;
  line-height: 1;
}

.d-stat-pill .stat-lbl {
  font-size: 0.68rem;
  color: #64748b;
  margin-top: 3px;
  text-transform: uppercase;
}

.dimension-note {
  font-size: 0.74rem;
  color: #475569;
  font-weight: 600;
  margin-top: 4px;
  display: block;
}

.export-action-box {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.btn-primary-export {
  width: 100%;
  padding: 10px 14px;
  background: #2563eb;
  color: #ffffff;
  border: none;
  border-radius: 6px;
  font-size: 0.88rem;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(37, 99, 235, 0.28);
  transition: background 0.15s, transform 0.1s;
}

.btn-primary-export:hover:not(:disabled) {
  background: #1d4ed8;
  transform: translateY(-1px);
}

.btn-primary-export:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.save-feedback {
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 0.78rem;
  line-height: 1.35;
}

.save-feedback.success {
  background: #dcfce7;
  color: #166534;
  border: 1px solid #bbf7d0;
}

.save-feedback.error {
  background: #fee2e2;
  color: #991b1b;
  border: 1px solid #fecaca;
}

.design-preview-zoom-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 2px 6px;
}

.btn-zoom-step,
.btn-zoom-action {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  padding: 3px 6px;
  font-size: 0.75rem;
  color: #334155;
  cursor: pointer;
}

.btn-zoom-step:hover,
.btn-zoom-action:hover {
  background: #e2e8f0;
}

.zoom-value {
  font-size: 0.75rem;
  font-weight: 700;
  color: #1e293b;
  min-width: 42px;
  text-align: center;
}

.design-export-viewport {
  flex: 1;
  position: relative;
  overflow: hidden;
  background: #f8fafc;
  cursor: grab;
  user-select: none;
}

.design-export-viewport:active {
  cursor: grabbing;
}

.design-export-viewport.is-transparent-bg {
  background-color: #f8fafc;
  background-image:
    linear-gradient(45deg, #e2e8f0 25%, transparent 25%),
    linear-gradient(-45deg, #e2e8f0 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #e2e8f0 75%),
    linear-gradient(-45deg, transparent 75%, #e2e8f0 75%);
  background-size: 20px 20px;
  background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
}

.design-svg-stage {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
}

.design-svg-stage :deep(svg) {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
