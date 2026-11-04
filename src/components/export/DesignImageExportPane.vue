<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { useI18n } from 'vue-i18n';
import type { ExportPersonInput } from '../../utils/htmlExport';
import {
  generateDesignExportSvg,
  renderSvgToRaster,
  type DesignPersistedState,
  type DesignExportResult,
} from '../../utils/designExport';
import { loadBackgroundImageFromDB } from '../../utils/designBgStorage';

interface DesignLayoutEntry {
  id: string;
  proband_id: string;
  name: string;
  created_at: string;
  layout_data: string;
}

const props = defineProps<{
  persons: ExportPersonInput[];
  activeProbandId: string | null;
}>();

const { t, locale } = useI18n();

const isLeftPanelCollapsed = ref<boolean>(false);
const saveStatusMsg = ref<string>('');
const saveErrorMsg = ref<string>('');

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
  const viewport = designViewportRef.value;
  if (!viewport || !designExportResult.value) return;

  const rect = viewport.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  const currentZoom = designPreviewZoom.value;
  const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
  const nextZoom = Math.min(3.5, Math.max(0.005, +(currentZoom * zoomFactor).toFixed(4)));

  if (nextZoom === currentZoom) return;

  const contentX = (mouseX - designPreviewPan.value.x) / currentZoom;
  const contentY = (mouseY - designPreviewPan.value.y) / currentZoom;

  designPreviewPan.value = {
    x: Math.round(mouseX - contentX * nextZoom),
    y: Math.round(mouseY - contentY * nextZoom),
  };
  designPreviewZoom.value = nextZoom;
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

onMounted(() => {
  fetchSavedDesignLayouts();
});
</script>

<template>
  <div class="export-workspace">
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

.cfg-checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}

.cfg-label-text {
  font-size: 0.82rem;
  font-weight: 600;
  color: #334155;
}

.cfg-sub-hint {
  font-size: 0.74rem;
  color: #64748b;
  line-height: 1.35;
}

.cfg-transparency-hint {
  font-size: 0.72rem;
  color: #0284c7;
  line-height: 1.3;
}

.empty-state-notice {
  font-size: 0.8rem;
  color: #64748b;
  font-style: italic;
  padding: 6px 0;
}

.bg-config-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.bg-none-notice {
  font-size: 0.78rem;
  color: #64748b;
}

/* Format & Scale Buttons */
.format-button-group,
.scale-button-group {
  display: flex;
  gap: 6px;
}

.format-pill-btn,
.scale-pill-btn {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 600;
  color: #475569;
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: center;
}

.format-pill-btn:hover,
.scale-pill-btn:hover {
  background: #f1f5f9;
  border-color: #94a3b8;
}

.format-pill-btn.active,
.scale-pill-btn.active {
  background: #eff6ff;
  border-color: #3b82f6;
  color: #1d4ed8;
}

/* Stats */
.stats-section {
  gap: 6px;
}

.design-stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.d-stat-pill {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 6px;
}

.stat-num {
  font-size: 1rem;
  font-weight: 700;
  color: #0f172a;
}

.stat-lbl {
  font-size: 0.68rem;
  color: #64748b;
  text-transform: uppercase;
}

.dimension-note {
  font-size: 0.72rem;
  font-family: monospace;
  color: #64748b;
  margin-top: 4px;
}

/* Action Box */
.export-action-box {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid #e2e8f0;
}

.btn-primary-export {
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

.btn-primary-export:hover:not(:disabled) {
  background: #059669;
  transform: translateY(-1px);
}

.btn-primary-export:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.save-feedback {
  font-size: 0.78rem;
  padding: 6px 10px;
  border-radius: 6px;
  line-height: 1.35;
}

.save-feedback.success {
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
  color: #065f46;
}

.save-feedback.error {
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

.badge-preview-mode {
  font-size: 0.76rem;
  font-weight: 700;
  color: #334155;
}

.dimensions-badge {
  font-size: 0.72rem;
  font-family: monospace;
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  padding: 2px 6px;
  border-radius: 4px;
  color: #64748b;
}

.design-preview-zoom-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 3px 6px;
}

.btn-zoom-step {
  background: none;
  border: none;
  font-size: 0.75rem;
  cursor: pointer;
  padding: 2px 4px;
}

.zoom-value {
  font-size: 0.76rem;
  font-weight: 700;
  font-family: monospace;
  color: #1e293b;
  min-width: 44px;
  text-align: center;
}

.btn-zoom-action {
  padding: 3px 8px;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  font-size: 0.72rem;
  font-weight: 600;
  color: #475569;
  cursor: pointer;
}

.btn-zoom-action:hover {
  background: #f1f5f9;
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

.btn-topbar-save:hover:not(:disabled) {
  background: #059669;
}

.btn-topbar-save:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Viewport */
.design-export-viewport {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
  cursor: grab;
  background: #cbd5e1;
  user-select: none;
}

.design-export-viewport:active {
  cursor: grabbing;
}

.design-export-viewport.is-transparent-bg {
  background-color: #f1f5f9;
  background-image: 
    linear-gradient(45deg, #e2e8f0 25%, transparent 25%),
    linear-gradient(-45deg, #e2e8f0 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #e2e8f0 75%),
    linear-gradient(-45deg, transparent 75%, #e2e8f0 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0px;
}

.design-svg-stage {
  position: absolute;
  top: 0;
  left: 0;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  pointer-events: none;
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

