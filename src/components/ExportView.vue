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
import {
  generateLatexExport,
  generateSampleLatexPreview,
  BUILTIN_LATEX_TEMPLATES,
  LATEX_VARIABLE_DEFINITIONS,
  type LatexExportMode,
  type LatexExportDirection,
  type AncestorSortPattern,
  type UnknownParentPreset,
  type LatexTemplateConfig,
  type LatexExportResult,
  type GeneratedLatexFile,
} from '../utils/latexExport';

interface LatexTemplateEntry {
  id: string;
  name: string;
  created_at: string;
  config_data: string;
}

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
  const viewport = designViewportRef.value;
  if (!viewport || !designExportResult.value) return;

  const rect = viewport.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  const currentZoom = designPreviewZoom.value;
  const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
  const nextZoom = Math.min(3.5, Math.max(0.005, +(currentZoom * zoomFactor).toFixed(4)));

  if (nextZoom === currentZoom) return;

  // Koordinaten des Inhalts unter dem Mauszeiger vor dem Zoomen
  const contentX = (mouseX - designPreviewPan.value.x) / currentZoom;
  const contentY = (mouseY - designPreviewPan.value.y) / currentZoom;

  // Pan anpassen, sodass die Position unter dem Mauszeiger exakt erhalten bleibt
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

// ----------------------------------------------------
// Druckbares Format (LaTeX Export)
// ----------------------------------------------------
const latexMode = ref<LatexExportMode>('proband');
const latexDirection = ref<LatexExportDirection>('descendants');
const latexMaxGenerations = ref<number>(5);
const latexAncestorSortPattern = ref<AncestorSortPattern>('kekule_patrilineal');
const latexUnknownPreset = ref<UnknownParentPreset>('classic');
const latexCustomUnknownFather = ref<string>('Vater: N.N. (nicht bekannt — Zweig endet hier)');
const latexCustomUnknownMother = ref<string>('Mutter: N.N. (nicht bekannt — Zweig endet hier)');

// Stämme-Aufteilung (bei Probanden-Export)
const latexEnableBranchSplit = ref<boolean>(false);
const latexBranchSplitGen = ref<number>(2);
const latexSelectedBranchIds = ref<string[]>([]);
const latexIncludeBranchInputs = ref<boolean>(true);
const latexCustomDocTitle = ref<string>('');
const latexCustomDocSubtitle = ref<string>('');

// Gespeicherte & eingebaute Erscheinungsbild-/Textmasken-Vorlagen
const savedLatexTemplates = ref<LatexTemplateEntry[]>([]);
const selectedLatexTemplateId = ref<string>(BUILTIN_LATEX_TEMPLATES[0].id);
const latexTemplateSaveName = ref<string>(BUILTIN_LATEX_TEMPLATES[0].name);
const latexActiveTemplate = ref<LatexTemplateConfig>({
  ...BUILTIN_LATEX_TEMPLATES[0],
});

const latexEntryMaskRef = ref<HTMLTextAreaElement | null>(null);
const latexSpouseMaskRef = ref<HTMLTextAreaElement | null>(null);
const latexPreviewMode = ref<'visual' | 'source'>('visual');
const latexActiveFileIdx = ref<number>(0);
const isSavingLatex = ref<boolean>(false);
const showLatexConfigModal = ref<boolean>(false);
const modalPreviewMode = ref<'visual' | 'source'>('visual');

const sampleLatexPreview = computed(() => {
  return generateSampleLatexPreview(
    latexActiveTemplate.value,
    locale.value === 'en' ? 'en' : 'de'
  );
});

// Floating Box States: 'entry-vars' | 'entry-conds' | 'spouse-vars' | 'spouse-conds' | null
const activeFloatingBox = ref<
  'entry-vars' | 'entry-conds' | 'spouse-vars' | 'spouse-conds' | null
>(null);

function toggleFloatingBox(boxId: 'entry-vars' | 'entry-conds' | 'spouse-vars' | 'spouse-conds') {
  activeFloatingBox.value = activeFloatingBox.value === boxId ? null : boxId;
}

function closeFloatingBox() {
  activeFloatingBox.value = null;
}

// Categorized Variables for Entry Mask
const entryVariablesByCategory = computed(() => {
  const identity = LATEX_VARIABLE_DEFINITIONS.filter(v => v.category === 'identity');
  const vital = LATEX_VARIABLE_DEFINITIONS.filter(v => v.category === 'vital');
  const family = LATEX_VARIABLE_DEFINITIONS.filter(v => v.category === 'family');
  const extra = LATEX_VARIABLE_DEFINITIONS.filter(v => v.category === 'extra');
  return { identity, vital, family, extra };
});

// Categorized Spouse Variables (mit mehrsprachigen Tooltip-Beschreibungen)
const spouseVariablesCategorized = [
  {
    category: 'marriage',
    titleKey: 'export_latex_sec_marriage',
    vars: [
      {
        token: '{heiratsinfo}',
        descDe: 'Heiratsangabe komplett (z. B. 1848 in Münster)',
        descEn: 'Complete marriage record (e.g. 1848 in Münster)',
      },
      {
        token: '{heiratsjahr}',
        descDe: 'Heiratsjahr',
        descEn: 'Marriage year',
      },
      {
        token: '{heiratsdatum}',
        descDe: 'Exaktes Heiratsdatum',
        descEn: 'Exact marriage date',
      },
      {
        token: '{heiratsort}',
        descDe: 'Heiratsort',
        descEn: 'Marriage place',
      },
      {
        token: '{ehe_nr}',
        descDe: 'Ehenummer (1, 2, ...)',
        descEn: 'Marriage number (1, 2, ...)',
      },
      {
        token: '{ehen_gesamt}',
        descDe: 'Gesamtzahl aller Ehen',
        descEn: 'Total marriages count',
      },
    ],
  },
  {
    category: 'partner',
    titleKey: 'export_latex_sec_partner',
    vars: [
      {
        token: '{partner_name}',
        descDe: 'Vollständiger Name des Partners',
        descEn: 'Full name of spouse',
      },
      {
        token: '{partner_henry_id}',
        descDe: 'Henry-ID des Partners',
        descEn: 'Henry Code of spouse',
      },
      {
        token: '{partner_lebensdaten}',
        descDe: 'Lebensdaten des Partners (*, †)',
        descEn: 'Vital dates of spouse (*, †)',
      },
      {
        token: '{partner_eltern}',
        descDe: 'Eltern des Partners',
        descEn: 'Parents of spouse',
      },
    ],
  },
  {
    category: 'divorce',
    titleKey: 'export_latex_sec_divorce',
    vars: [
      {
        token: '{scheidung}',
        descDe: 'Scheidungshinweis (⚮ Datum & Ort)',
        descEn: 'Divorce notice (⚮ date & place)',
      },
      {
        token: '{scheidungsdatum}',
        descDe: 'Scheidungsdatum',
        descEn: 'Divorce date',
      },
      {
        token: '{ist_geschieden}',
        descDe: 'Wahrheitswert (Ja/Nein)',
        descEn: 'Boolean value (Yes/No)',
      },
    ],
  },
];

// Entry Mask Conditions (mit mehrsprachigen Tooltip-Beschreibungen)
const entryConditionsCategorized = [
  {
    titleKey: 'export_latex_sec_cond_status',
    conds: [
      {
        label: "{if sohn_tochter == 'Sohn'}",
        code: "{if sohn_tochter == 'Sohn'} (Sohn){else if sohn_tochter == 'Tochter'} (Tochter){endif}",
        descDe: 'Unterscheidung Sohn / Tochter',
        descEn: 'Distinction Son / Daughter',
      },
      {
        label: '{if sohn_tochter}',
        code: '{if sohn_tochter}, {sohn_tochter}{endif}',
        descDe: 'Sohn/Tochter nur bei Nachkommen anhängen (nicht bei Gen. 1)',
        descEn: 'Append Son/Daughter only for descendants (not Gen. 1)',
      },
      {
        label: '{if aus_ehe}',
        code: '{if aus_ehe}, {aus_ehe}{endif}',
        descDe: 'Ehe-Herkunft (aus 1. Ehe / aus 2. Ehe) nur bei Mehrfachehe',
        descEn: 'Marriage origin (from 1st marriage / from 2nd marriage)',
      },
      {
        label: '{if eltern_mehrfachehe}',
        code: '{if eltern_mehrfachehe} (aus {eltern_ehe_nr}. Ehe){endif}',
        descDe: 'Bedingung für Mehrfachehe der Eltern',
        descEn: 'Condition for parents multiple marriages',
      },
      {
        label: '{if eltern_genau}',
        code: '\\newline {eltern_genau}',
        descDe: 'Genaue Eltern inkl. Ehe-Ausweisung',
        descEn: 'Detailed parents with marriage origin',
      },
    ],
  },
  {
    titleKey: 'export_latex_sec_cond_marriage',
    conds: [
      {
        label: '{if ehen_gesamt > 1}',
        code: '{if ehen_gesamt > 1} ({ehen_gesamt} Ehen){endif}',
        descDe: 'Mehrere Ehen kennzeichnen',
        descEn: 'Indicate multiple marriages',
      },
      {
        label: '{if ist_geschieden}',
        code: '{if ist_geschieden} \\textbf{⚮} {scheidung}{endif}',
        descDe: 'Scheidungssymbol und -daten bei geschiedenen Personen',
        descEn: 'Divorce symbol and dates for divorced individuals',
      },
      {
        label: '{if scheidung}',
        code: '{if scheidung} {scheidung}{endif}',
        descDe: 'Scheidungsangabe falls vorhanden',
        descEn: 'Divorce details if present',
      },
      {
        label: '{if kinder_anzahl > 0}',
        code: '{if kinder_anzahl > 0} ({kinder_anzahl}){endif}',
        descDe: 'Kinderanzahl ausgeben',
        descEn: 'Show children count',
      },
      {
        label: '{if implex}',
        code: '{if implex} \\textbf{[Implex: {implex}]}{endif}',
        descDe: 'Ahnenschwund / Implex-Verweis',
        descEn: 'Pedigree collapse / implex reference',
      },
    ],
  },
  {
    titleKey: 'export_latex_sec_cond_details',
    conds: [
      {
        label: '{if lebensdaten}',
        code: '{if lebensdaten} — {lebensdaten}{endif}',
        descDe: 'Lebensdaten nur anhängen, wenn vorhanden',
        descEn: 'Append vital dates only if present',
      },
      {
        label: '{if beruf}',
        code: '{if beruf}, {beruf}{endif}',
        descDe: 'Beruf nur anhängen, wenn dokumentiert',
        descEn: 'Append occupation only if documented',
      },
      {
        label: '{if religion}',
        code: '{if religion}, {religion}{endif}',
        descDe: 'Religion nur anhängen, wenn dokumentiert',
        descEn: 'Append religion only if documented',
      },
      {
        label: '{if wohnort}',
        code: '{if wohnort}, {wohnort}{endif}',
        descDe: 'Wohnort nur anhängen, wenn dokumentiert',
        descEn: 'Append residence only if documented',
      },
      {
        label: '{if notizen}',
        code: '{if notizen}\\newline \\footnotesize{{notizen}}{endif}',
        descDe: 'Notizen als Fußnote ausgeben',
        descEn: 'Output notes as footnote',
      },
    ],
  },
  {
    titleKey: 'export_latex_sec_cond_generic',
    conds: [
      {
        label: '{if ...} ... {endif}',
        code: '{if bedingung} text {endif}',
        descDe: 'Einfache Wenn-Bedingung',
        descEn: 'Simple if-condition',
      },
      {
        label: '{if ...} ... {else} ... {endif}',
        code: '{if bedingung} fall_wahr {else} fall_falsch {endif}',
        descDe: 'Wenn-Dann-Sonst-Bedingung',
        descEn: 'If-then-else condition',
      },
    ],
  },
];

// Spouse Mask Conditions (mit mehrsprachigen Tooltip-Beschreibungen)
const spouseConditionsCategorized = [
  {
    titleKey: 'export_latex_sec_marriage',
    conds: [
      {
        label: '{if heiratsort}',
        code: '{if heiratsort} in {heiratsort}{endif}',
        descDe: 'Heiratsort nur ausgeben, wenn vorhanden',
        descEn: 'Show marriage place only if present',
      },
      {
        label: '{if heiratsdatum}',
        code: '{if heiratsdatum} am {heiratsdatum}{endif}',
        descDe: 'Heiratsdatum nur ausgeben, wenn vorhanden',
        descEn: 'Show marriage date only if present',
      },
      {
        label: '{if heiratsjahr}',
        code: '{if heiratsjahr} ({heiratsjahr}){endif}',
        descDe: 'Heiratsjahr in Klammern',
        descEn: 'Marriage year in parentheses',
      },
    ],
  },
  {
    titleKey: 'export_latex_sec_partner',
    conds: [
      {
        label: '{if partner_lebensdaten}',
        code: '{if partner_lebensdaten} {partner_lebensdaten}{endif}',
        descDe: 'Lebensdaten des Partners',
        descEn: 'Vital dates of spouse',
      },
      {
        label: '{if partner_eltern}',
        code: '{if partner_eltern} {partner_eltern}{endif}',
        descDe: 'Eltern des Partners',
        descEn: 'Parents of spouse',
      },
      {
        label: '{if partner_henry_id}',
        code: '{if partner_henry_id} [{partner_henry_id}]{endif}',
        descDe: 'Henry-Code des Partners',
        descEn: 'Henry Code of spouse',
      },
    ],
  },
  {
    titleKey: 'export_latex_sec_divorce',
    conds: [
      {
        label: '{if ist_geschieden}',
        code: '{if ist_geschieden} \\textbf{⚮} {scheidung}{endif}',
        descDe: 'Scheidungssymbol & Daten',
        descEn: 'Divorce symbol & dates',
      },
      {
        label: '{if scheidungsdatum}',
        code: '{if scheidungsdatum} (⚮ {scheidungsdatum}){endif}',
        descDe: 'Scheidungsdatum in Klammern',
        descEn: 'Divorce date in parentheses',
      },
    ],
  },
];

const LOCAL_STORAGE_LATEX_TEMPLATES_KEY = 'stammbaum_latex_templates_v1';

async function fetchLatexTemplates() {
  try {
    const dbList = await invoke<LatexTemplateEntry[]>('get_latex_templates');
    if (Array.isArray(dbList)) {
      savedLatexTemplates.value = dbList;
      try {
        localStorage.setItem(LOCAL_STORAGE_LATEX_TEMPLATES_KEY, JSON.stringify(dbList));
      } catch {}
      return;
    }
  } catch {
    // Fallback to localStorage if backend not reachable
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_LATEX_TEMPLATES_KEY);
      if (raw) {
        savedLatexTemplates.value = JSON.parse(raw) as LatexTemplateEntry[];
      }
    } catch {}
  }
}

function selectLatexTemplateById(id: string) {
  selectedLatexTemplateId.value = id;
  const builtin = BUILTIN_LATEX_TEMPLATES.find(b => b.id === id);
  if (builtin) {
    latexActiveTemplate.value = { ...builtin };
    latexTemplateSaveName.value = builtin.name;
    return;
  }
  const saved = savedLatexTemplates.value.find(s => s.id === id);
  if (saved) {
    try {
      const parsed = JSON.parse(saved.config_data) as LatexTemplateConfig;
      latexActiveTemplate.value = {
        ...BUILTIN_LATEX_TEMPLATES[0],
        ...parsed,
        id: saved.id,
        name: saved.name,
      };
      latexTemplateSaveName.value = saved.name;
    } catch (e) {
      console.error('Failed to parse saved LaTeX template', e);
    }
  }
}

async function saveCurrentLatexTemplate(asNew = false) {
  const name = latexTemplateSaveName.value.trim();
  if (!name) return;
  saveStatusMsg.value = '';
  saveErrorMsg.value = '';

  const isBuiltinSelected = BUILTIN_LATEX_TEMPLATES.some(b => b.id === selectedLatexTemplateId.value);
  const overwriteId = !asNew && !isBuiltinSelected ? selectedLatexTemplateId.value : undefined;
  const createdAt = new Date().toISOString();
  const payloadConfig: LatexTemplateConfig = {
    ...latexActiveTemplate.value,
    name,
  };
  const configData = JSON.stringify(payloadConfig);

  try {
    const savedEntry = await invoke<LatexTemplateEntry>('save_latex_template', {
      name,
      createdAt,
      configData,
      overwriteId: overwriteId || null,
    });
    await fetchLatexTemplates();
    selectedLatexTemplateId.value = savedEntry.id;
    saveStatusMsg.value =
      locale.value === 'en'
        ? `Template "${savedEntry.name}" saved.`
        : `Konfiguration „${savedEntry.name}“ gespeichert.`;
  } catch (err: any) {
    // LocalStorage fallback
    const fallbackId = overwriteId || `local-${Date.now()}`;
    const entry: LatexTemplateEntry = {
      id: fallbackId,
      name,
      created_at: createdAt,
      config_data: configData,
    };
    const existingIdx = savedLatexTemplates.value.findIndex(x => x.id === fallbackId);
    if (existingIdx >= 0) {
      savedLatexTemplates.value[existingIdx] = entry;
    } else {
      savedLatexTemplates.value.unshift(entry);
    }
    try {
      localStorage.setItem(
        LOCAL_STORAGE_LATEX_TEMPLATES_KEY,
        JSON.stringify(savedLatexTemplates.value)
      );
    } catch {}
    selectedLatexTemplateId.value = fallbackId;
    saveStatusMsg.value =
      locale.value === 'en'
        ? `Template "${name}" saved.`
        : `Konfiguration „${name}“ gespeichert.`;
  }
}

async function deleteSelectedLatexTemplate() {
  const id = selectedLatexTemplateId.value;
  if (!id || BUILTIN_LATEX_TEMPLATES.some(b => b.id === id)) return;
  try {
    await invoke('delete_latex_template', { id });
  } catch {}
  savedLatexTemplates.value = savedLatexTemplates.value.filter(s => s.id !== id);
  try {
    localStorage.setItem(
      LOCAL_STORAGE_LATEX_TEMPLATES_KEY,
      JSON.stringify(savedLatexTemplates.value)
    );
  } catch {}
  selectLatexTemplateById(BUILTIN_LATEX_TEMPLATES[0].id);
}

function insertTokenIntoEntryMask(token: string) {
  const el = latexEntryMaskRef.value;
  if (!el) {
    latexActiveTemplate.value.entryMask += token;
    return;
  }
  const start = el.selectionStart ?? latexActiveTemplate.value.entryMask.length;
  const end = el.selectionEnd ?? start;
  const current = latexActiveTemplate.value.entryMask;
  latexActiveTemplate.value.entryMask = current.slice(0, start) + token + current.slice(end);
  setTimeout(() => {
    el.focus();
    el.setSelectionRange(start + token.length, start + token.length);
  }, 10);
}

function wrapEntryMaskSelection(prefix: string, suffix: string, fallbackInner = 'Text') {
  const el = latexEntryMaskRef.value;
  const current = latexActiveTemplate.value.entryMask;
  if (!el) {
    latexActiveTemplate.value.entryMask = `${current}${prefix}${fallbackInner}${suffix}`;
    return;
  }
  const start = el.selectionStart ?? current.length;
  const end = el.selectionEnd ?? start;
  const selected = current.slice(start, end) || fallbackInner;
  const replacement = `${prefix}${selected}${suffix}`;
  latexActiveTemplate.value.entryMask = current.slice(0, start) + replacement + current.slice(end);
  setTimeout(() => {
    el.focus();
    el.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
  }, 10);
}

function insertTokenIntoSpouseMask(token: string) {
  const el = latexSpouseMaskRef.value;
  if (!el) {
    latexActiveTemplate.value.spouseMask += token;
    return;
  }
  const start = el.selectionStart ?? latexActiveTemplate.value.spouseMask.length;
  const end = el.selectionEnd ?? start;
  const current = latexActiveTemplate.value.spouseMask;
  latexActiveTemplate.value.spouseMask = current.slice(0, start) + token + current.slice(end);
  setTimeout(() => {
    el.focus();
    el.setSelectionRange(start + token.length, start + token.length);
  }, 10);
}

const latexExportResult = computed<LatexExportResult | null>(() => {
  if (!selectedExportRootId.value) return null;
  return generateLatexExport(props.persons, {
    mode: latexMode.value,
    rootPersonId: selectedExportRootId.value,
    startCode: exportStartCode.value || '1',
    direction: latexDirection.value,
    maxGenerations: latexMaxGenerations.value,
    ancestorSortPattern: latexAncestorSortPattern.value,
    unknownParentPreset: latexUnknownPreset.value,
    customUnknownFatherText: latexCustomUnknownFather.value,
    customUnknownMotherText: latexCustomUnknownMother.value,
    enableBranchSplit: latexMode.value === 'proband' && latexEnableBranchSplit.value,
    branchSplitGeneration: latexBranchSplitGen.value,
    selectedBranchIds: latexSelectedBranchIds.value,
    includeBranchInputsInMain: latexIncludeBranchInputs.value,
    customDocumentTitle: latexCustomDocTitle.value,
    customDocumentSubtitle: latexCustomDocSubtitle.value,
    template: latexActiveTemplate.value,
    locale: locale.value === 'en' ? 'en' : 'de',
  });
});

// Synchronize selected branch IDs when generation or root person changes
watch(
  () => latexExportResult.value?.detectedBranchesAtSelectedGen,
  newBranches => {
    if (!newBranches || newBranches.length === 0) {
      latexSelectedBranchIds.value = [];
      return;
    }
    const validSet = new Set(newBranches.map(b => b.personId));
    const filtered = latexSelectedBranchIds.value.filter(id => validSet.has(id));
    if (filtered.length === 0) {
      latexSelectedBranchIds.value = newBranches.map(b => b.personId);
    } else if (filtered.length !== latexSelectedBranchIds.value.length) {
      latexSelectedBranchIds.value = filtered;
    }
  },
  { immediate: true }
);

watch(
  () => latexExportResult.value?.files.length,
  newLen => {
    if (!newLen || latexActiveFileIdx.value >= newLen) {
      latexActiveFileIdx.value = 0;
    }
  }
);

const activeLatexFile = computed<GeneratedLatexFile | null>(() => {
  const res = latexExportResult.value;
  if (!res || res.files.length === 0) return null;
  return res.files[latexActiveFileIdx.value] || res.files[0];
});

function toggleBranchSelection(personId: string) {
  const idx = latexSelectedBranchIds.value.indexOf(personId);
  if (idx >= 0) {
    if (latexSelectedBranchIds.value.length > 1) {
      latexSelectedBranchIds.value.splice(idx, 1);
    }
  } else {
    latexSelectedBranchIds.value.push(personId);
  }
}

function selectAllBranchesAtGen() {
  const branches = latexExportResult.value?.detectedBranchesAtSelectedGen || [];
  latexSelectedBranchIds.value = branches.map(b => b.personId);
}

async function copyLatexSourceToClipboard() {
  if (!activeLatexFile.value) return;
  try {
    await navigator.clipboard.writeText(activeLatexFile.value.texContent);
    saveStatusMsg.value = t('export_latex_copied_msg');
  } catch (err: any) {
    saveErrorMsg.value = String(err);
  }
}

async function saveSingleLatexFile(fileObj?: GeneratedLatexFile) {
  const targetFile = fileObj || activeLatexFile.value;
  if (!targetFile) return;
  saveStatusMsg.value = '';
  saveErrorMsg.value = '';
  isSavingLatex.value = true;

  try {
    let filePath: string | null = null;
    try {
      const res = await save({
        title: t('export_latex_panel_title'),
        defaultPath: targetFile.fileName,
        filters: [{ name: 'LaTeX Dokument (*.tex)', extensions: ['tex'] }],
      });
      if (typeof res === 'string') filePath = res;
    } catch {
      filePath = null;
    }

    if (filePath) {
      await invoke('save_design_file', {
        filePath,
        content: targetFile.texContent,
      });
      saveStatusMsg.value =
        locale.value === 'en'
          ? `LaTeX file saved: ${filePath}`
          : `LaTeX-Datei erfolgreich gespeichert: ${filePath}`;
    } else {
      const blob = new Blob([targetFile.texContent], { type: 'text/x-tex;charset=utf-8' });
      downloadBlob(blob, targetFile.fileName);
      saveStatusMsg.value =
        locale.value === 'en'
          ? `LaTeX file downloaded: ${targetFile.fileName}`
          : `LaTeX-Datei heruntergeladen: ${targetFile.fileName}`;
    }
  } catch (err: any) {
    saveErrorMsg.value = String(err);
  } finally {
    isSavingLatex.value = false;
  }
}

async function saveAllLatexFilesBundle() {
  const res = latexExportResult.value;
  if (!res || res.files.length === 0) return;
  if (res.files.length === 1) {
    await saveSingleLatexFile(res.files[0]);
    return;
  }

  saveStatusMsg.value = '';
  saveErrorMsg.value = '';
  isSavingLatex.value = true;

  const mainFile = res.files[0];

  try {
    let chosenBaseFilePath: string | null = null;
    try {
      const dialogRes = await save({
        title:
          locale.value === 'en'
            ? `Select target folder & base file (${res.files.length} .tex files will be created)`
            : `Zielordner & Hauptdatei wählen (${res.files.length} .tex-Dateien werden angelegt)`,
        defaultPath: mainFile.fileName,
        filters: [{ name: 'LaTeX Hauptdatei + Stämme (*.tex)', extensions: ['tex'] }],
      });
      if (typeof dialogRes === 'string') chosenBaseFilePath = dialogRes;
    } catch {
      chosenBaseFilePath = null;
    }

    if (chosenBaseFilePath) {
      // Extract user-chosen base name if they renamed the main file in the dialog
      const normPath = chosenBaseFilePath.replace(/\\/g, '/');
      const baseFilePart = normPath.split('/').pop() || mainFile.fileName;
      const customStem = baseFilePart.replace(/_gesamt\.tex$/i, '').replace(/\.tex$/i, '').trim() || res.baseSurname;

      const bundlePayload = res.files.map(f => {
        let effectiveName = f.fileName;
        if (f.isMasterFile) {
          effectiveName = `${customStem}_gesamt.tex`;
        } else if (f.isMainFile) {
          effectiveName = `${customStem}.tex`;
        } else if (f.branchHenryCode) {
          effectiveName = `${customStem}-${f.branchHenryCode}.tex`;
        }
        return {
          file_name: effectiveName,
          content: f.texContent,
        };
      });

      const writtenPaths = await invoke<string[]>('save_latex_export_bundle', {
        baseFilePath: chosenBaseFilePath,
        files: bundlePayload,
      });

      saveStatusMsg.value =
        locale.value === 'en'
          ? `${writtenPaths.length} LaTeX files saved (${customStem}.tex + ${writtenPaths.length - 1} branch files).`
          : `${writtenPaths.length} LaTeX-Dateien erfolgreich gespeichert (${customStem}.tex + ${writtenPaths.length - 1} Stamm-Dateien).`;
    } else {
      for (const f of res.files) {
        const blob = new Blob([f.texContent], { type: 'text/x-tex;charset=utf-8' });
        downloadBlob(blob, f.fileName);
      }
      saveStatusMsg.value =
        locale.value === 'en'
          ? `${res.files.length} LaTeX files downloaded.`
          : `${res.files.length} LaTeX-Dateien heruntergeladen.`;
    }
  } catch (err: any) {
    saveErrorMsg.value = String(err);
  } finally {
    isSavingLatex.value = false;
  }
}

watch(activeExportModuleTab, newTab => {
  saveStatusMsg.value = '';
  saveErrorMsg.value = '';
  if (newTab === 'design_image') {
    fetchSavedDesignLayouts();
  } else if (newTab === 'pdf') {
    fetchLatexTemplates();
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
          class="module-tab-btn"
          :class="{ active: activeExportModuleTab === 'pdf' }"
          @click="activeExportModuleTab = 'pdf'"
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

    <!-- Modul-Ansicht 3: Druckbares Format (LaTeX Export) -->
    <div v-else-if="activeExportModuleTab === 'pdf'" class="export-workspace">
      <!-- Linke Seitenleiste: Konfiguration, Modus, Stämme & LaTeX-Maske -->
      <aside class="export-sidebar latex-sidebar" :class="{ collapsed: isLeftPanelCollapsed }">
        <button
          class="sidebar-collapse-toggle"
          @click="isLeftPanelCollapsed = !isLeftPanelCollapsed"
          :title="isLeftPanelCollapsed ? t('export_show_panel') : t('export_hide_panel')"
        >
          {{ isLeftPanelCollapsed ? '▶' : '◀' }}
        </button>

        <div v-if="!isLeftPanelCollapsed" class="export-sidebar-inner">
          <div class="export-panel-header">
            <h2>📄 {{ t('export_latex_panel_title') }}</h2>
            <p class="export-panel-subtitle">{{ t('export_latex_panel_subtitle') }}</p>
          </div>

          <!-- 1. Ausgangspunkt & Modus: Definierter Proband vs. Beliebiger Eintrag -->
          <div class="export-section">
            <label class="export-section-label">🧭 {{ t('export_latex_mode_label') }}</label>
            <div class="latex-mode-pills">
              <button
                type="button"
                class="latex-mode-pill"
                :class="{ active: latexMode === 'proband' }"
                @click="latexMode = 'proband'"
              >
                🌳 {{ t('export_latex_mode_proband') }}
              </button>
              <button
                type="button"
                class="latex-mode-pill"
                :class="{ active: latexMode === 'custom' }"
                @click="latexMode = 'custom'"
              >
                👤 {{ t('export_latex_mode_custom') }}
              </button>
            </div>

            <!-- Modus A: Definierter Proband -->
            <div v-if="latexMode === 'proband'" class="latex-sub-box">
              <label class="sub-field-label">{{ t('export_defined_roots_label') }}</label>
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
                  :key="'ltx-root-' + r.person_id"
                  :value="r.person_id"
                >
                  [{{ r.starting_code }}] {{ r.surname || 'N.N.' }}, {{ r.given_name || 'N.N.' }} ({{ r.person_id }})
                </option>
              </select>

              <div class="export-form-row" style="margin-top: 8px">
                <label>{{ t('export_start_code_label') }}</label>
                <input
                  type="text"
                  v-model="exportStartCode"
                  class="export-input code-inp"
                  placeholder="1"
                />
              </div>
              <span class="cfg-sub-hint">
                {{ t('export_latex_proband_desc_hint') }}
              </span>
            </div>

            <!-- Modus B: Beliebiger Eintrag (mit Richtung & Generationenanzahl) -->
            <div v-else class="latex-sub-box">
              <label class="sub-field-label">Ausgangsperson suchen & auswählen:</label>
              <input
                type="text"
                v-model="personSearchQuery"
                :placeholder="t('export_person_search_placeholder')"
                class="export-input"
              />
              <div class="person-picker-list compact-picker">
                <div
                  v-for="p in filteredPersonsList"
                  :key="'ltx-p-' + p.id"
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
                  </div>
                </div>
              </div>

              <!-- Richtung: Nachkommen oder Vorfahren -->
              <label class="sub-field-label" style="margin-top: 10px">{{ t('export_latex_direction_label') }}</label>
              <div class="latex-mode-pills">
                <button
                  type="button"
                  class="latex-mode-pill"
                  :class="{ active: latexDirection === 'descendants' }"
                  @click="latexDirection = 'descendants'"
                >
                  ⬇️ {{ t('export_latex_dir_descendants') }}
                </button>
                <button
                  type="button"
                  class="latex-mode-pill"
                  :class="{ active: latexDirection === 'ancestors' }"
                  @click="latexDirection = 'ancestors'"
                >
                  ⬆️ {{ t('export_latex_dir_ancestors') }}
                </button>
              </div>

              <!-- Anzahl der Generationen -->
              <div class="export-form-row" style="margin-top: 8px">
                <label>{{ t('export_latex_generations_label') }}:</label>
                <div class="gen-number-control">
                  <input
                    type="number"
                    v-model.number="latexMaxGenerations"
                    min="1"
                    max="25"
                    class="export-input num-inp"
                  />
                  <span class="gen-unit">Gen.</span>
                </div>
              </div>

              <!-- Vorfahren-spezifische Optionen: Sortiermuster & "Nicht bekannt"-Formulierung -->
              <template v-if="latexDirection === 'ancestors'">
                <div class="export-form-row" style="margin-top: 8px">
                  <label>{{ t('export_latex_ancestor_sort_label') }}:</label>
                  <select v-model="latexAncestorSortPattern" class="export-dropdown">
                    <option value="kekule_patrilineal">{{ t('export_latex_sort_kekule_pat') }}</option>
                    <option value="matrilineal_recursive">{{ t('export_latex_sort_mat_rec') }}</option>
                    <option value="generation_kekule">{{ t('export_latex_sort_gen_kekule') }}</option>
                  </select>
                </div>

                <div class="export-form-row" style="margin-top: 8px">
                  <label>{{ t('export_latex_unknown_label') }}:</label>
                  <select v-model="latexUnknownPreset" class="export-dropdown">
                    <option value="classic">{{ t('export_latex_unknown_classic') }}</option>
                    <option value="archival">{{ t('export_latex_unknown_archival') }}</option>
                    <option value="short">{{ t('export_latex_unknown_short') }}</option>
                    <option value="custom">{{ t('export_latex_unknown_custom') }}</option>
                  </select>
                </div>

                <div v-if="latexUnknownPreset === 'custom'" class="custom-unknown-inputs">
                  <div class="export-form-row">
                    <label>{{ t('export_latex_unknown_father_label') }}</label>
                    <input type="text" v-model="latexCustomUnknownFather" class="export-input" />
                  </div>
                  <div class="export-form-row">
                    <label>{{ t('export_latex_unknown_mother_label') }}</label>
                    <input type="text" v-model="latexCustomUnknownMother" class="export-input" />
                  </div>
                </div>
                <span class="cfg-sub-hint">
                  {{ t('export_latex_custom_anc_hint') }}
                </span>
              </template>
              <template v-else>
                <span class="cfg-sub-hint">
                  {{ t('export_latex_custom_desc_hint') }}
                </span>
              </template>
            </div>
          </div>

          <!-- 2. Stämme-Erkennung & Mehrdateien-Export (nur im Probanden-Modus) -->
          <div v-if="latexMode === 'proband' && latexExportResult" class="export-section">
            <label class="export-section-label">🌿 {{ t('export_latex_branches_title') }}</label>
            <label class="cfg-checkbox-label">
              <input type="checkbox" v-model="latexEnableBranchSplit" />
              <span class="cfg-label-text">{{ t('export_latex_branches_enable') }}</span>
            </label>

            <div v-if="latexEnableBranchSplit" class="branch-split-panel">
              <div class="export-form-row">
                <label>{{ t('export_latex_branches_gen_select') }}</label>
                <select v-model.number="latexBranchSplitGen" class="export-dropdown">
                  <option
                    v-for="gInfo in latexExportResult.detectedGenerations.filter(g => g.generation >= 2)"
                    :key="'split-gen-' + gInfo.generation"
                    :value="gInfo.generation"
                  >
                    Generation {{ gInfo.generation }} ({{ gInfo.count }} Einträge, {{ gInfo.branchesWithChildrenCount }} mit Nachfahren)
                  </option>
                </select>
              </div>

              <div class="detected-branches-header">
                <span>{{ t('export_latex_detected_branches', { count: latexExportResult.detectedBranchesAtSelectedGen.length }) }}</span>
                <button type="button" class="btn-mini-link" @click="selectAllBranchesAtGen">{{ t('export_latex_select_all') }}</button>
              </div>

              <div class="detected-branches-list">
                <div class="branch-file-item master-file-item">
                  <span class="branch-file-badge master-badge">{{ t('export_latex_master_badge') }}</span>
                  <strong>{{ latexExportResult.masterFileName }}</strong>
                </div>
                <div class="branch-file-item main-file-item">
                  <span class="branch-file-badge">{{ t('export_latex_main_badge') }}</span>
                  <strong>{{ latexExportResult.baseSurname }}.tex</strong>
                  <span class="branch-meta">Proband + Vorlauf</span>
                </div>
                <label
                  v-for="b in latexExportResult.detectedBranchesAtSelectedGen"
                  :key="'br-' + b.personId"
                  class="branch-file-item"
                >
                  <input
                    type="checkbox"
                    :checked="latexSelectedBranchIds.includes(b.personId)"
                    @change="toggleBranchSelection(b.personId)"
                  />
                  <div class="branch-item-details">
                    <div class="branch-item-top">
                      <span class="branch-code-pill">[{{ b.henryCode }}]</span>
                      <strong>{{ b.name }}</strong>
                    </div>
                    <div class="branch-item-sub">
                      <code>{{ b.fileName }}</code>
                      <span>({{ b.descendantCount + 1 }} Pers.)</span>
                    </div>
                  </div>
                </label>
              </div>

              <label class="cfg-checkbox-label" style="margin-top: 6px">
                <input type="checkbox" v-model="latexIncludeBranchInputs" />
                <span class="cfg-label-text">{{ t('export_latex_branches_include_input') }}</span>
              </label>
            </div>
          </div>

          <!-- 3. Erscheinungsbild & frei gestaltbare Textmaske (Kompaktkarte & Schnellzugriff mit Modal-Trigger) -->
          <div class="export-section">
            <div class="export-section-header-row">
              <label class="export-section-label">🎨 {{ t('export_latex_template_title') }}</label>
            </div>

            <!-- Schnell-Auswahl gespeicherter Speicherzustände / Vorlagen -->
            <div class="export-form-row">
              <label>{{ t('export_latex_template_select') }}</label>
              <select
                class="export-dropdown"
                :value="selectedLatexTemplateId"
                @change="selectLatexTemplateById(($event.target as HTMLSelectElement).value)"
              >
                <optgroup :label="t('export_latex_standard_templates')">
                  <option
                    v-for="bt in BUILTIN_LATEX_TEMPLATES"
                    :key="bt.id"
                    :value="bt.id"
                  >
                    📌 {{ bt.name }}
                  </option>
                </optgroup>
                <optgroup v-if="savedLatexTemplates.length > 0" :label="t('export_latex_saved_templates')">
                  <option
                    v-for="st in savedLatexTemplates"
                    :key="st.id"
                    :value="st.id"
                  >
                    💾 {{ st.name }} ({{ formatLayoutDate(st.created_at) }})
                  </option>
                </optgroup>
              </select>
            </div>

            <!-- Dokument-Titel & Untertitel (direkt greifbar für diesen Export) -->
            <div class="export-form-row">
              <label>{{ t('export_latex_title_label') }}</label>
              <input
                type="text"
                v-model="latexCustomDocTitle"
                class="export-input"
                :placeholder="t('export_latex_title_placeholder')"
              />
            </div>

            <div class="export-form-row">
              <label>{{ t('export_latex_subtitle_label') }}</label>
              <input
                type="text"
                v-model="latexCustomDocSubtitle"
                class="export-input"
                :placeholder="t('export_latex_subtitle_placeholder')"
              />
            </div>

            <!-- Vorlagen-Zusammenfassung & Modal-Öffnen-Button -->
            <div class="template-summary-card">
              <div class="summary-pills">
                <span class="summary-pill">📐 {{ latexActiveTemplate.documentClass }}</span>
                <span class="summary-pill">📄 {{ latexActiveTemplate.paperSize }}</span>
                <span class="summary-pill">🔤 {{ latexActiveTemplate.fontSize }}</span>
                <span class="summary-pill">⇥ {{ latexActiveTemplate.indentStepEm }}em</span>
              </div>
              <p class="summary-hint-text">{{ t('export_latex_config_window_hint') }}</p>
              <button
                type="button"
                class="btn-open-config-window"
                @click="showLatexConfigModal = true"
              >
                ⚙️ {{ t('export_latex_btn_open_config') }}
              </button>
            </div>
          </div>

          <!-- 4. Export-Aktionen -->
          <div class="export-action-box">
            <button
              v-if="latexExportResult && latexExportResult.files.length > 1"
              class="btn-primary-export"
              :disabled="isSavingLatex"
              @click="saveAllLatexFilesBundle"
            >
              💾 {{ t('export_latex_save_bundle_btn', { count: latexExportResult.files.length }) }}
            </button>
            <button
              v-else-if="activeLatexFile"
              class="btn-primary-export"
              :disabled="isSavingLatex"
              @click="saveSingleLatexFile()"
            >
              💾 {{ t('export_latex_save_single_btn', { name: activeLatexFile.fileName }) }}
            </button>

            <div v-if="saveStatusMsg" class="save-feedback success">
              ✅ {{ saveStatusMsg }}
            </div>
            <div v-if="saveErrorMsg" class="save-feedback error">
              ⚠️ {{ saveErrorMsg }}
            </div>
          </div>
        </div>
      </aside>

      <!-- Rechter Hauptbereich: Vorschau (Druck-Vorschau & LaTeX-Quellcode) + Datei-Tabs bei Stämmen -->
      <section class="export-preview-pane">
        <div class="export-preview-topbar" v-if="latexExportResult && activeLatexFile">
          <div class="preview-info-left">
            <span class="preview-badge">📄 {{ activeLatexFile.fileName }}</span>
            <span class="preview-meta">
              ({{ activeLatexFile.entryCount }} {{ t('export_stat_nodes') }},
              max. Gen. {{ activeLatexFile.maxGeneration }}
              <template v-if="latexMode === 'custom' && latexDirection === 'ancestors' && latexExportResult.unknownBranchesStopped > 0">
                {{ t('export_latex_unknown_stopped_meta', { count: latexExportResult.unknownBranchesStopped }) }}
              </template>)
            </span>
          </div>

          <!-- Umschalter: Visuelle Druck-Vorschau vs. LaTeX-Quellcode -->
          <div class="viewport-toggle-area">
            <div class="viewport-btn-group">
              <button
                class="btn-viewport"
                :class="{ active: latexPreviewMode === 'visual' }"
                @click="latexPreviewMode = 'visual'"
              >
                🖨️ {{ t('export_latex_view_visual') }}
              </button>
              <button
                class="btn-viewport"
                :class="{ active: latexPreviewMode === 'source' }"
                @click="latexPreviewMode = 'source'"
              >
                📝 {{ t('export_latex_view_source') }}
              </button>
            </div>
          </div>

          <div class="preview-info-right">
            <button
              class="btn-zoom-action"
              @click="copyLatexSourceToClipboard"
              :title="t('export_latex_copy_code_btn')"
            >
              📋 {{ t('export_latex_copy_code_btn') }}
            </button>
            <button
              v-if="latexExportResult.files.length > 1"
              class="btn-topbar-save"
              @click="saveAllLatexFilesBundle"
            >
              💾 {{ t('export_latex_save_all_btn', { count: latexExportResult.files.length }) }}
            </button>
            <button
              class="btn-topbar-save"
              @click="saveSingleLatexFile()"
            >
              💾 {{ activeLatexFile.fileName }}
            </button>
          </div>
        </div>

        <!-- Datei-Umschalter-Leiste, wenn Stämme in eigene Dateien aufgeteilt werden -->
        <div
          v-if="latexExportResult && latexExportResult.files.length > 1"
          class="latex-files-tabbar"
        >
          <button
            v-for="(f, fIdx) in latexExportResult.files"
            :key="f.fileName"
            type="button"
            class="latex-file-tab"
            :class="{
              active: latexActiveFileIdx === fIdx,
              'is-master': f.isMasterFile,
              'is-main': f.isMainFile
            }"
            @click="latexActiveFileIdx = fIdx"
          >
            <span>{{ f.isMasterFile ? '📕' : (f.isMainFile ? '📘' : '🌿') }}</span>
            <strong>{{ f.fileName }}</strong>
            <span class="file-tab-badge" v-if="f.isMasterFile">{{ t('export_latex_master_badge') }}</span>
            <span class="file-tab-count">{{ f.entryCount }}</span>
          </button>
        </div>

        <!-- Vorschau-Inhalt -->
        <div v-if="activeLatexFile" class="latex-preview-workspace">
          <!-- Visuelle Druck-Vorschau (A4 Blatt) -->
          <div
            v-if="latexPreviewMode === 'visual'"
            class="latex-visual-scroll"
            v-html="activeLatexFile.previewHtml"
          ></div>

          <!-- LaTeX-Quellcode (.tex) -->
          <div v-else class="latex-source-scroll">
            <pre class="latex-source-pre"><code>{{ activeLatexFile.texContent }}</code></pre>
          </div>
        </div>

        <div v-else class="export-empty-state">
          <div class="empty-card">
            <h3>📄 {{ t('export_latex_panel_title') }}</h3>
            <p>{{ t('export_empty_hint') }}</p>
          </div>
        </div>
      </section>
    </div>

    <!-- Platzhalter für zukünftige Ansichten im Export-Modul -->
    <div v-else class="export-module-placeholder">
      <div class="placeholder-card">
        <h3>{{ activeExportModuleTab === 'csv' ? '📊 ' + t('export_tab_csv') : '🧬 ' + t('export_tab_gedcom') }}</h3>
        <p>{{ t('export_module_tab_hint') }}</p>
        <button class="btn-back-to-html" @click="activeExportModuleTab = 'html'">
          ← {{ t('export_back_to_html') }}
        </button>
      </div>
    </div>

    <!-- Dediziertes Konfigurationsfenster: Erscheinungsbild & Textmaske (LaTeX) -->
    <div
      v-if="showLatexConfigModal"
      class="modal-overlay latex-config-overlay"
      @click.self="showLatexConfigModal = false"
    >
      <div class="modal-content latex-config-modal-window">
        <!-- Fenster-Kopfzeile -->
        <div class="latex-config-modal-header">
          <div class="modal-title-wrap">
            <h3 class="modal-title">🎨 {{ t('export_latex_template_title') }}</h3>
            <span class="modal-subtitle">{{ t('export_latex_config_window_hint') }}</span>
          </div>
          <button
            type="button"
            class="btn-modal-close"
            @click="showLatexConfigModal = false"
            title="Schließen"
          >
            ✕
          </button>
        </div>

        <!-- Fenster-Inhalt mit 2-Spalten-Layout (Konfiguration links, Live-Preview rechts) -->
        <div class="latex-config-modal-body">
          <!-- Linke Spalte: Konfiguration (Vorlagen, Layout, Textmasken) -->
          <div class="config-modal-left-col">
            <!-- Bereich 1: Speicherzustände / Vorlagen-Management -->
            <div class="config-modal-section">
              <h4 class="config-sec-title">💾 {{ t('export_latex_template_select') }}</h4>
              <div class="template-mgmt-row">
                <div class="mgmt-select-col">
                  <select
                    class="export-dropdown"
                    :value="selectedLatexTemplateId"
                    @change="selectLatexTemplateById(($event.target as HTMLSelectElement).value)"
                  >
                    <optgroup :label="t('export_latex_standard_templates')">
                      <option
                        v-for="bt in BUILTIN_LATEX_TEMPLATES"
                        :key="bt.id"
                        :value="bt.id"
                      >
                        📌 {{ bt.name }}
                      </option>
                    </optgroup>
                    <optgroup v-if="savedLatexTemplates.length > 0" :label="t('export_latex_saved_templates')">
                      <option
                        v-for="st in savedLatexTemplates"
                        :key="st.id"
                        :value="st.id"
                      >
                        💾 {{ st.name }} ({{ formatLayoutDate(st.created_at) }})
                      </option>
                    </optgroup>
                  </select>
                </div>

                <div class="mgmt-input-col">
                  <input
                    type="text"
                    v-model="latexTemplateSaveName"
                    :placeholder="t('export_latex_template_name_placeholder')"
                    class="export-input"
                  />
                </div>

                <div class="mgmt-btns-col">
                  <button
                    type="button"
                    class="btn-tpl-action primary"
                    @click="saveCurrentLatexTemplate(false)"
                    title="Aktuelle Konfiguration unter diesem Namen speichern / überschreiben"
                  >
                    💾 {{ t('export_latex_template_save_btn') }}
                  </button>
                  <button
                    type="button"
                    class="btn-tpl-action"
                    @click="saveCurrentLatexTemplate(true)"
                    title="Als neuen Speicherzustand anlegen"
                  >
                    ➕ {{ t('export_latex_new_btn') }}
                  </button>
                  <button
                    v-if="!BUILTIN_LATEX_TEMPLATES.some(b => b.id === selectedLatexTemplateId)"
                    type="button"
                    class="btn-tpl-action danger"
                    @click="deleteSelectedLatexTemplate"
                    title="Speicherzustand löschen"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            </div>

            <!-- Bereich 2: Typografie & Seiten-Layout -->
            <div class="config-modal-section">
              <h4 class="config-sec-title">📐 Typografie & Dokument-Layout</h4>
              <div class="doc-layout-grid-modal">
                <div class="layout-params-row">
                  <div class="param-col">
                    <label class="mini-lbl">{{ t('export_latex_class_lbl') }}</label>
                    <select v-model="latexActiveTemplate.documentClass" class="export-dropdown compact">
                      <option value="scrbook">scrbook (KOMA-Script Buch)</option>
                      <option value="scrartcl">scrartcl (KOMA-Script Artikel)</option>
                      <option value="article">article (Standard-Artikel)</option>
                    </select>
                  </div>
                  <div class="param-col">
                    <label class="mini-lbl">{{ t('export_latex_format_lbl') }}</label>
                    <select v-model="latexActiveTemplate.paperSize" class="export-dropdown compact">
                      <option value="a4paper">A4 (210 × 297 mm)</option>
                      <option value="a5paper">A5 (148 × 210 mm)</option>
                      <option value="letterpaper">US-Letter</option>
                    </select>
                  </div>
                  <div class="param-col">
                    <label class="mini-lbl">{{ t('export_latex_font_lbl') }}</label>
                    <select v-model="latexActiveTemplate.fontSize" class="export-dropdown compact">
                      <option value="10pt">10 pt</option>
                      <option value="11pt">11 pt</option>
                      <option value="12pt">12 pt</option>
                    </select>
                  </div>
                </div>

                <div class="layout-params-row">
                  <div class="param-col">
                    <label class="mini-lbl">{{ t('export_latex_indent_step_lbl') }}</label>
                    <input
                      type="number"
                      step="0.05"
                      v-model.number="latexActiveTemplate.indentStepEm"
                      min="0.2"
                      max="5"
                      class="export-input compact"
                    />
                  </div>
                  <div class="param-col">
                    <label class="mini-lbl">{{ t('export_latex_margin_lbl') }}</label>
                    <input
                      type="number"
                      v-model.number="latexActiveTemplate.marginMm"
                      min="10"
                      max="50"
                      class="export-input compact"
                    />
                  </div>
                  <div class="param-col">
                    <label class="mini-lbl">{{ t('export_latex_spacing_lbl') }}</label>
                    <input
                      type="number"
                      step="0.05"
                      v-model.number="latexActiveTemplate.entrySpacingEm"
                      min="0"
                      max="3"
                      class="export-input compact"
                    />
                  </div>
                </div>
              </div>
            </div>

            <!-- Bereich 3: Masken-Editor für Personeneintrag -->
            <div class="config-modal-section mask-editor-block relative-anchor">
              <div class="mask-section-header">
                <h4 class="config-sec-title">👤 {{ t('export_latex_entry_mask_label') }}</h4>
                <span class="mask-hint">{{ t('export_latex_entry_mask_hint') }}</span>
              </div>

              <!-- Toolbar & Floating Box Trigger mit mehrsprachigen Tooltips -->
              <div class="latex-format-toolbar">
                <button type="button" class="fmt-btn" @click="wrapEntryMaskSelection('\\textbf{', '}', 'Fett')" :title="t('export_latex_fmt_bold')">
                  <strong>B</strong>
                </button>
                <button type="button" class="fmt-btn" @click="wrapEntryMaskSelection('\\textit{', '}', 'Kursiv')" :title="t('export_latex_fmt_italic')">
                  <em>I</em>
                </button>
                <button type="button" class="fmt-btn" @click="wrapEntryMaskSelection('\\textsc{', '}', 'Kapitälchen')" :title="t('export_latex_fmt_smallcaps')">
                  ᴀʙᴄ
                </button>
                <button type="button" class="fmt-btn" @click="wrapEntryMaskSelection('\\underline{', '}', 'Unterstrichen')" :title="t('export_latex_fmt_underline')">
                  <u>U</u>
                </button>
                <button type="button" class="fmt-btn" @click="insertTokenIntoEntryMask('\\newline ')" :title="t('export_latex_fmt_newline')">
                  ↵
                </button>
                <button type="button" class="fmt-btn" @click="insertTokenIntoEntryMask('\\quad ')" :title="t('export_latex_fmt_quad')">
                  ⇥
                </button>

                <div class="toolbar-divider"></div>

                <!-- Genealogiezeichen Bar mit mehrsprachigen Tooltips -->
                <button type="button" class="fmt-btn symbol-btn" @click="insertTokenIntoEntryMask('* ')" :title="t('export_latex_sym_birth')">*</button>
                <button type="button" class="fmt-btn symbol-btn" @click="insertTokenIntoEntryMask('≈ ')" :title="t('export_latex_sym_baptism')">≈</button>
                <button type="button" class="fmt-btn symbol-btn" @click="insertTokenIntoEntryMask('⚭ ')" :title="t('export_latex_sym_marriage')">⚭</button>
                <button type="button" class="fmt-btn symbol-btn" @click="insertTokenIntoEntryMask('⚮ ')" :title="t('export_latex_sym_divorce')">⚮</button>
                <button type="button" class="fmt-btn symbol-btn" @click="insertTokenIntoEntryMask('† ')" :title="t('export_latex_sym_death')">†</button>

                <!-- Floating Boxes Triggers -->
                <div class="floating-triggers-group">
                  <button
                    type="button"
                    class="trigger-floating-btn"
                    :class="{ active: activeFloatingBox === 'entry-vars' }"
                    @click="toggleFloatingBox('entry-vars')"
                  >
                    <span>➕ {{ t('export_latex_btn_add_variable') }}</span>
                    <span class="trigger-caret">{{ activeFloatingBox === 'entry-vars' ? '▲' : '▼' }}</span>
                  </button>
                  <button
                    type="button"
                    class="trigger-floating-btn"
                    :class="{ active: activeFloatingBox === 'entry-conds' }"
                    @click="toggleFloatingBox('entry-conds')"
                  >
                    <span>⚡ {{ t('export_latex_btn_add_condition') }}</span>
                    <span class="trigger-caret">{{ activeFloatingBox === 'entry-conds' ? '▲' : '▼' }}</span>
                  </button>
                </div>
              </div>

              <!-- Floating Box: Variablen für Personeneintrag -->
              <div v-if="activeFloatingBox === 'entry-vars'" class="floating-box-popover">
                <div class="floating-box-header">
                  <span class="floating-box-title">➕ {{ t('export_latex_btn_add_variable') }} (Personeneintrag)</span>
                  <button type="button" class="floating-box-close" @click="closeFloatingBox" :title="t('export_latex_floating_close')">✕</button>
                </div>
                <div class="floating-box-content">
                  <!-- Identität & Kennzeichnung -->
                  <div class="floating-section">
                    <div class="floating-sec-header">
                      <span class="sec-dot cat-identity"></span>
                      <span>{{ t('export_latex_sec_identity') }}</span>
                    </div>
                    <div class="variable-chips-wrap">
                      <button
                        v-for="v in entryVariablesByCategory.identity"
                        :key="v.token"
                        type="button"
                        class="var-chip cat-identity"
                        :title="(locale === 'en' ? v.labelEn : v.labelDe) + ' — ' + (locale === 'en' ? 'Ex.: ' : 'Bsp.: ') + v.example"
                        @click="insertTokenIntoEntryMask(v.token)"
                      >
                        {{ v.token }}
                      </button>
                    </div>
                  </div>

                  <!-- Lebensdaten -->
                  <div class="floating-section">
                    <div class="floating-sec-header">
                      <span class="sec-dot cat-vital"></span>
                      <span>{{ t('export_latex_sec_vital') }}</span>
                    </div>
                    <div class="variable-chips-wrap">
                      <button
                        v-for="v in entryVariablesByCategory.vital"
                        :key="v.token"
                        type="button"
                        class="var-chip cat-vital"
                        :title="(locale === 'en' ? v.labelEn : v.labelDe) + ' — ' + (locale === 'en' ? 'Ex.: ' : 'Bsp.: ') + v.example"
                        @click="insertTokenIntoEntryMask(v.token)"
                      >
                        {{ v.token }}
                      </button>
                    </div>
                  </div>

                  <!-- Familie, Eltern & Ehen -->
                  <div class="floating-section">
                    <div class="floating-sec-header">
                      <span class="sec-dot cat-family"></span>
                      <span>{{ t('export_latex_sec_family') }}</span>
                    </div>
                    <div class="variable-chips-wrap">
                      <button
                        v-for="v in entryVariablesByCategory.family"
                        :key="v.token"
                        type="button"
                        class="var-chip cat-family"
                        :title="(locale === 'en' ? v.labelEn : v.labelDe) + ' — ' + (locale === 'en' ? 'Ex.: ' : 'Bsp.: ') + v.example"
                        @click="insertTokenIntoEntryMask(v.token)"
                      >
                        {{ v.token }}
                      </button>
                    </div>
                  </div>

                  <!-- Zusatzangaben & Sonderfälle -->
                  <div class="floating-section">
                    <div class="floating-sec-header">
                      <span class="sec-dot cat-extra"></span>
                      <span>{{ t('export_latex_sec_extra') }}</span>
                    </div>
                    <div class="variable-chips-wrap">
                      <button
                        v-for="v in entryVariablesByCategory.extra"
                        :key="v.token"
                        type="button"
                        class="var-chip cat-extra"
                        :title="(locale === 'en' ? v.labelEn : v.labelDe) + ' — ' + (locale === 'en' ? 'Ex.: ' : 'Bsp.: ') + v.example"
                        @click="insertTokenIntoEntryMask(v.token)"
                      >
                        {{ v.token }}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Floating Box: Bedingungen für Personeneintrag -->
              <div v-if="activeFloatingBox === 'entry-conds'" class="floating-box-popover">
                <div class="floating-box-header">
                  <span class="floating-box-title">⚡ {{ t('export_latex_btn_add_condition') }} (Personeneintrag)</span>
                  <button type="button" class="floating-box-close" @click="closeFloatingBox" :title="t('export_latex_floating_close')">✕</button>
                </div>
                <div class="floating-box-content">
                  <div v-for="sec in entryConditionsCategorized" :key="sec.titleKey" class="floating-section">
                    <div class="floating-sec-header">
                      <span>{{ t(sec.titleKey) }}</span>
                    </div>
                    <div class="variable-chips-wrap">
                      <button
                        v-for="c in sec.conds"
                        :key="c.label"
                        type="button"
                        class="cond-chip"
                        :title="(locale === 'en' ? c.descEn : c.descDe) + ' — Code: ' + c.code"
                        @click="insertTokenIntoEntryMask(c.code)"
                      >
                        {{ c.label }}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <textarea
                ref="latexEntryMaskRef"
                v-model="latexActiveTemplate.entryMask"
                rows="4"
                class="export-textarea mono-textarea modal-mask-textarea"
                placeholder="({generation}{if sohn_tochter}, {sohn_tochter}{endif}) — {lebensdaten}{ehepartner}"
              ></textarea>
            </div>

            <!-- Bereich 4: Masken-Editor für Ehepartner -->
            <div class="config-modal-section mask-editor-block relative-anchor">
              <div class="mask-section-header">
                <h4 class="config-sec-title">⚭ {{ t('export_latex_spouse_mask_label') }}</h4>
                <span class="mask-hint">{{ t('export_latex_spouse_mask_hint') }}</span>
              </div>

              <div class="latex-format-toolbar">
                <button type="button" class="fmt-btn symbol-btn" @click="insertTokenIntoSpouseMask('⚭ ')" :title="t('export_latex_sym_marriage')">⚭</button>
                <button type="button" class="fmt-btn symbol-btn" @click="insertTokenIntoSpouseMask('⚮ ')" :title="t('export_latex_sym_divorce')">⚮</button>
                <button type="button" class="fmt-btn symbol-btn" @click="insertTokenIntoSpouseMask('* ')" :title="t('export_latex_sym_birth')">*</button>
                <button type="button" class="fmt-btn symbol-btn" @click="insertTokenIntoSpouseMask('† ')" :title="t('export_latex_sym_death')">†</button>

                <div class="floating-triggers-group">
                  <button
                    type="button"
                    class="trigger-floating-btn"
                    :class="{ active: activeFloatingBox === 'spouse-vars' }"
                    @click="toggleFloatingBox('spouse-vars')"
                  >
                    <span>➕ {{ t('export_latex_btn_add_variable') }}</span>
                    <span class="trigger-caret">{{ activeFloatingBox === 'spouse-vars' ? '▲' : '▼' }}</span>
                  </button>
                  <button
                    type="button"
                    class="trigger-floating-btn"
                    :class="{ active: activeFloatingBox === 'spouse-conds' }"
                    @click="toggleFloatingBox('spouse-conds')"
                  >
                    <span>⚡ {{ t('export_latex_btn_add_condition') }}</span>
                    <span class="trigger-caret">{{ activeFloatingBox === 'spouse-conds' ? '▲' : '▼' }}</span>
                  </button>
                </div>
              </div>

              <!-- Floating Box: Variablen für Ehepartner -->
              <div v-if="activeFloatingBox === 'spouse-vars'" class="floating-box-popover">
                <div class="floating-box-header">
                  <span class="floating-box-title">➕ {{ t('export_latex_btn_add_variable') }} (Ehepartner)</span>
                  <button type="button" class="floating-box-close" @click="closeFloatingBox" :title="t('export_latex_floating_close')">✕</button>
                </div>
                <div class="floating-box-content">
                  <div v-for="sec in spouseVariablesCategorized" :key="sec.category" class="floating-section">
                    <div class="floating-sec-header">
                      <span class="sec-dot cat-family"></span>
                      <span>{{ t(sec.titleKey) }}</span>
                    </div>
                    <div class="variable-chips-wrap">
                      <button
                        v-for="sv in sec.vars"
                        :key="sv.token"
                        type="button"
                        class="var-chip cat-family"
                        :title="locale === 'en' ? sv.descEn : sv.descDe"
                        @click="insertTokenIntoSpouseMask(sv.token)"
                      >
                        {{ sv.token }}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Floating Box: Bedingungen für Ehepartner -->
              <div v-if="activeFloatingBox === 'spouse-conds'" class="floating-box-popover">
                <div class="floating-box-header">
                  <span class="floating-box-title">⚡ {{ t('export_latex_btn_add_condition') }} (Ehepartner)</span>
                  <button type="button" class="floating-box-close" @click="closeFloatingBox" :title="t('export_latex_floating_close')">✕</button>
                </div>
                <div class="floating-box-content">
                  <div v-for="sec in spouseConditionsCategorized" :key="sec.titleKey" class="floating-section">
                    <div class="floating-sec-header">
                      <span>{{ t(sec.titleKey) }}</span>
                    </div>
                    <div class="variable-chips-wrap">
                      <button
                        v-for="c in sec.conds"
                        :key="c.label"
                        type="button"
                        class="cond-chip"
                        :title="(locale === 'en' ? c.descEn : c.descDe) + ' — Code: ' + c.code"
                        @click="insertTokenIntoSpouseMask(c.code)"
                      >
                        {{ c.label }}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <textarea
                ref="latexSpouseMaskRef"
                v-model="latexActiveTemplate.spouseMask"
                rows="3"
                class="export-textarea mono-textarea modal-mask-textarea"
              ></textarea>
            </div>
          </div>

          <!-- Rechte Spalte: Direkte Live-Preview im Modal mit generischen Beispieldaten -->
          <div class="config-modal-right-col">
            <div class="modal-preview-header">
              <div class="modal-preview-title">
                <span>👁️ {{ t('export_latex_modal_preview_title') }}</span>
                <span class="modal-preview-meta">
                  ({{ t('export_latex_modal_preview_sample_badge') }})
                </span>
              </div>
              <div class="viewport-btn-group compact">
                <button
                  type="button"
                  class="btn-viewport"
                  :class="{ active: modalPreviewMode === 'visual' }"
                  @click="modalPreviewMode = 'visual'"
                >
                  🖨️ {{ t('export_latex_view_visual') }}
                </button>
                <button
                  type="button"
                  class="btn-viewport"
                  :class="{ active: modalPreviewMode === 'source' }"
                  @click="modalPreviewMode = 'source'"
                >
                  📝 {{ t('export_latex_view_source') }}
                </button>
              </div>
            </div>

            <div class="modal-preview-container">
              <div
                v-if="modalPreviewMode === 'visual'"
                class="latex-visual-scroll latex-modal-visual-scroll"
                v-html="sampleLatexPreview.previewHtml"
              ></div>
              <div v-else class="latex-source-scroll latex-modal-source-scroll">
                <pre class="latex-source-pre"><code>{{ sampleLatexPreview.texContent }}</code></pre>
              </div>
            </div>
          </div>
        </div>

        <!-- Fenster-Fußzeile mit Status und Schließen-Button -->
        <div class="latex-config-modal-footer">
          <div class="modal-footer-hint">
            <span class="sync-dot"></span>
            <span>{{ t('export_latex_config_live_synced') }}</span>
          </div>
          <button
            type="button"
            class="btn-modal-apply"
            @click="showLatexConfigModal = false"
          >
            ✓ {{ t('export_latex_btn_apply_close') }}
          </button>
        </div>
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

/* =========================================================
   LaTeX Export (Druckformat) Styles
   ========================================================= */
.latex-sidebar {
  width: 410px;
  min-width: 410px;
}

.latex-mode-pills {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-bottom: 8px;
}

.latex-mode-pill {
  padding: 7px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #f8fafc;
  color: #475569;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.latex-mode-pill:hover {
  background: #eff6ff;
  border-color: #93c5fd;
}

.latex-mode-pill.active {
  background: #2563eb;
  border-color: #1d4ed8;
  color: #ffffff;
}

.latex-sub-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 10px;
}

.sub-field-label {
  font-size: 0.76rem;
  font-weight: 700;
  color: #334155;
  display: block;
}

.compact-picker {
  max-height: 150px;
}

.gen-number-control {
  display: flex;
  align-items: center;
  gap: 8px;
}

.num-inp {
  width: 85px;
}

.gen-unit {
  font-size: 0.8rem;
  font-weight: 600;
  color: #475569;
}

.custom-unknown-inputs {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  background: #ffffff;
  border: 1px dashed #cbd5e1;
  border-radius: 6px;
}

.branch-split-panel {
  margin-top: 8px;
  padding: 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.detected-branches-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.76rem;
  font-weight: 700;
  color: #334155;
}

.btn-mini-link {
  background: none;
  border: none;
  color: #2563eb;
  font-size: 0.74rem;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
}

.btn-mini-link:hover {
  text-decoration: underline;
}

.detected-branches-list {
  max-height: 175px;
  overflow-y: auto;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #ffffff;
  display: flex;
  flex-direction: column;
}

.branch-file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-bottom: 1px solid #f1f5f9;
  font-size: 0.77rem;
  cursor: pointer;
}

.branch-file-item:last-child {
  border-bottom: none;
}

.branch-file-item.main-file-item {
  background: #eff6ff;
  cursor: default;
}

.branch-file-badge {
  background: #1d4ed8;
  color: #ffffff;
  font-size: 0.68rem;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 3px;
}

.branch-meta {
  margin-left: auto;
  color: #64748b;
  font-size: 0.72rem;
}

.branch-item-details {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.branch-item-top {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.branch-code-pill {
  background: #334155;
  color: #ffffff;
  font-size: 0.7rem;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 3px;
}

.branch-item-sub {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.72rem;
  color: #64748b;
}

.template-save-bar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
  margin-bottom: 10px;
  padding: 8px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
}

.template-save-btns {
  display: flex;
  gap: 6px;
}

.btn-tpl-action {
  padding: 5px 10px;
  font-size: 0.76rem;
  font-weight: 600;
  border: 1px solid #cbd5e1;
  border-radius: 5px;
  background: #ffffff;
  color: #334155;
  cursor: pointer;
}

.btn-tpl-action.primary {
  flex: 1;
  background: #0f172a;
  border-color: #0f172a;
  color: #ffffff;
}

.btn-tpl-action.primary:hover {
  background: #1e293b;
}

.btn-tpl-action.danger {
  color: #dc2626;
  border-color: #fecaca;
  background: #fef2f2;
}

.mask-editor-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
}

.mask-editor-block.relative-anchor {
  position: relative;
}

.latex-format-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

.toolbar-divider {
  width: 1px;
  height: 18px;
  background: #cbd5e1;
  margin: 0 2px;
}

.floating-triggers-group {
  display: flex;
  gap: 4px;
  margin-left: auto;
}

.trigger-floating-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  font-size: 0.72rem;
  font-weight: 600;
  color: #2563eb;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.trigger-floating-btn:hover {
  background: #dbeafe;
  border-color: #93c5fd;
}

.trigger-floating-btn.active {
  background: #2563eb;
  color: #ffffff;
  border-color: #1d4ed8;
  box-shadow: 0 1px 3px rgba(37, 99, 235, 0.3);
}

.trigger-caret {
  font-size: 0.6rem;
  opacity: 0.8;
}

.floating-box-popover {
  position: absolute;
  top: 64px;
  left: 6px;
  right: 6px;
  z-index: 80;
  background: #ffffff;
  border: 1.5px solid #cbd5e1;
  border-radius: 8px;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.18), 0 4px 10px rgba(15, 23, 42, 0.08);
  display: flex;
  flex-direction: column;
  max-height: 290px;
  animation: fadeInSlide 0.15s ease-out;
}

@keyframes fadeInSlide {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.floating-box-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  border-radius: 7px 7px 0 0;
}

.floating-box-title {
  font-size: 0.75rem;
  font-weight: 700;
  color: #1e293b;
}

.floating-box-close {
  background: none;
  border: none;
  font-size: 0.85rem;
  color: #64748b;
  cursor: pointer;
  padding: 0 4px;
  border-radius: 3px;
}

.floating-box-close:hover {
  color: #0f172a;
  background: #e2e8f0;
}

.floating-box-content {
  padding: 8px 10px;
  overflow-y: auto;
  flex: 1;
}

.floating-section {
  margin-bottom: 10px;
}

.floating-section:last-child {
  margin-bottom: 2px;
}

.floating-sec-header {
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #64748b;
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.sec-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}

.sec-dot.cat-identity { background: #3b82f6; }
.sec-dot.cat-vital { background: #10b981; }
.sec-dot.cat-family { background: #d946ef; }
.sec-dot.cat-extra { background: #f59e0b; }

.cond-chip {
  padding: 2px 7px;
  border-radius: 4px;
  border: 1px solid #e2e8f0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.72rem;
  background: #f8fafc;
  color: #334155;
  cursor: pointer;
  transition: all 0.12s ease;
}

.cond-chip:hover {
  background: #eff6ff;
  border-color: #93c5fd;
  color: #1d4ed8;
  transform: translateY(-1px);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}

.fmt-btn {
  padding: 3px 7px;
  font-size: 0.74rem;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  background: #ffffff;
  color: #1e293b;
  cursor: pointer;
}

.fmt-btn:hover {
  background: #eff6ff;
  border-color: #93c5fd;
}

.mini-lbl-inline {
  display: block;
  width: 100%;
  font-size: 0.68rem;
  font-weight: 700;
  color: #64748b;
  margin-bottom: 2px;
}

.symbol-btn {
  font-weight: bold;
  padding: 2px 8px;
  background: #f1f5f9;
  border-color: #cbd5e1;
  font-size: 0.82rem;
}

.symbol-btn:hover {
  background: #e2e8f0;
  border-color: #94a3b8;
}

.cond-btn {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.7rem;
  background: #fdf4ff;
  border-color: #f5d0fe;
  color: #701a75;
  padding: 2px 6px;
}

.cond-btn:hover {
  background: #fae8ff;
  border-color: #e879f9;
}

.file-tab-badge {
  font-size: 0.65rem;
  background: #fef08a;
  color: #854d0e;
  padding: 1px 4px;
  border-radius: 4px;
  font-weight: 600;
}

.latex-file-tab.is-master {
  border-color: #f59e0b;
}

.latex-file-tab.is-master.active {
  background: #78350f;
  border-color: #451a03;
}

.branch-file-item.master-file-item {
  border-left: 3px solid #f59e0b;
  background: #fefce8;
}

.branch-file-badge.master-badge {
  background: #fef08a;
  color: #854d0e;
}

.export-textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 9px;
  border: 1px solid #cbd5e1;
  border-radius: 5px;
  font-size: 0.8rem;
  line-height: 1.4;
  resize: vertical;
  background: #ffffff;
  color: #0f172a;
}

.mono-textarea {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.variables-caption {
  font-size: 0.72rem;
  color: #64748b;
  font-weight: 600;
}

.variable-chips-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.var-chip {
  padding: 2px 6px;
  font-size: 0.71rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  border-radius: 4px;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #1e293b;
  cursor: pointer;
  transition: all 0.12s ease;
}

.var-chip:hover {
  transform: translateY(-1px);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}

.var-chip.cat-identity {
  background: #eff6ff;
  border-color: #bfdbfe;
  color: #1e40af;
}

.var-chip.cat-vital {
  background: #f0fdf4;
  border-color: #bbf7d0;
  color: #166534;
}

.var-chip.cat-family {
  background: #fdf4ff;
  border-color: #f5d0fe;
  color: #86198f;
}

.var-chip.cat-extra {
  background: #fffbeb;
  border-color: #fde68a;
  color: #92400e;
}

.doc-layout-grid {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.layout-three-cols {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 6px;
}

.mini-lbl {
  display: block;
  font-size: 0.7rem;
  font-weight: 600;
  color: #475569;
  margin-bottom: 2px;
}

.export-dropdown.compact,
.export-input.compact {
  padding: 4px 6px;
  font-size: 0.76rem;
}

.latex-files-tabbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  overflow-x: auto;
}

.latex-file-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #ffffff;
  color: #334155;
  font-size: 0.76rem;
  cursor: pointer;
  white-space: nowrap;
}

.latex-file-tab.active {
  background: #1e293b;
  border-color: #0f172a;
  color: #ffffff;
}

.file-tab-count {
  background: rgba(148, 163, 184, 0.25);
  padding: 1px 5px;
  border-radius: 10px;
  font-size: 0.7rem;
}

.latex-preview-workspace {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.latex-visual-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 28px;
  display: flex;
  justify-content: center;
  background: #e2e8f0;
}

.latex-Visual-scroll :deep(.latex-sheet-page),
.latex-visual-scroll :deep(.latex-sheet-page) {
  width: 100%;
  max-width: 794px;
  min-height: 980px;
  background: #ffffff;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.14);
  border-radius: 4px;
  padding: 48px 54px;
  box-sizing: border-box;
  font-family: 'Georgia', 'Times New Roman', serif;
  color: #0f172a;
  line-height: 1.5;
}

.latex-visual-scroll :deep(.latex-sheet-header h1) {
  margin: 0 0 6px 0;
  font-size: 1.35rem;
  color: #0f172a;
}

.latex-visual-scroll :deep(.latex-sheet-subtitle) {
  margin: 0 0 10px 0;
  font-size: 0.86rem;
  color: #475569;
  font-weight: 600;
}

.latex-visual-scroll :deep(.latex-sheet-header hr) {
  border: none;
  border-top: 1.5px solid #334155;
  margin-bottom: 18px;
}

.latex-visual-scroll :deep(.latex-preview-entry) {
  position: relative;
  margin-left: calc(var(--indent-step, 0) * 0.35cm);
  text-indent: -1.1cm;
  padding-left: 1.1cm;
  font-size: 0.92rem;
  line-height: 1.45;
}

.latex-visual-scroll :deep(.latex-preview-entry.sep-deeper) {
  margin-top: 0.30em;
}

.latex-visual-scroll :deep(.latex-preview-entry.sep-same) {
  margin-top: 0.20em;
}

.latex-visual-scroll :deep(.latex-preview-entry.sep-shallower) {
  margin-top: 0.55em;
}

.latex-visual-scroll :deep(.latex-preview-marriage) {
  position: relative;
  margin-left: calc(var(--indent-step, 0) * 0.35cm + 0.3cm);
  text-indent: -1.0cm;
  padding-left: 1.0cm;
  margin-top: 0.15em;
  font-size: 0.88rem;
  line-height: 1.4;
  color: #334155;
}

.latex-visual-scroll :deep(.latex-preview-marriage .ehe-nr) {
  font-weight: 600;
  color: #475569;
  margin-right: 4px;
}

.latex-visual-scroll :deep(.latex-preview-entry.is-unknown-entry) {
  border-left-color: #f59e0b;
  background: #fffbeb;
  padding: 4px 10px;
  border-radius: 0 4px 4px 0;
  color: #92400e;
}

.latex-visual-scroll :deep(.latex-preview-level-marker) {
  display: inline-block;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.65rem;
  color: #94a3b8;
  margin-right: 6px;
  vertical-align: middle;
}

.latex-visual-scroll :deep(.latex-preview-entry-body) {
  display: inline;
}

.latex-source-scroll {
  flex: 1;
  overflow: auto;
  padding: 20px;
  background: #0f172a;
}

.latex-source-pre {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.82rem;
  line-height: 1.55;
  color: #e2e8f0;
  white-space: pre-wrap;
  word-break: break-word;
}

/* ========================================================
   LaTeX Erscheinungsbild & Textmasken Konfigurations-Modal
   ======================================================== */
.template-summary-card {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 10px 12px;
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.summary-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.summary-pill {
  font-size: 0.72rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-weight: 600;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  padding: 2px 6px;
  color: #475569;
}

.summary-hint-text {
  font-size: 0.76rem;
  color: #64748b;
  margin: 0;
  line-height: 1.35;
}

.btn-open-config-window {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 8px 12px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 6px;
  font-size: 0.82rem;
  font-weight: 600;
  color: #1d4ed8;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-open-config-window:hover {
  background: #dbeafe;
  border-color: #93c5fd;
  transform: translateY(-1px);
}

.latex-config-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(15, 23, 42, 0.65);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.latex-config-modal-window {
  width: 1380px;
  max-width: 96vw;
  height: 92vh;
  max-height: 92vh;
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 20px 45px rgba(15, 23, 42, 0.3), 0 4px 12px rgba(15, 23, 42, 0.15);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: modalFadeIn 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes modalFadeIn {
  from {
    opacity: 0;
    transform: scale(0.96) translateY(8px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.latex-config-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}

.modal-title-wrap {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.modal-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  color: #0f172a;
}

.modal-subtitle {
  font-size: 0.78rem;
  color: #64748b;
}

.btn-modal-close {
  background: none;
  border: none;
  font-size: 1.2rem;
  color: #94a3b8;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  transition: all 0.15s ease;
}

.btn-modal-close:hover {
  background: #e2e8f0;
  color: #0f172a;
}

.latex-config-modal-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: row;
  overflow: hidden;
  padding: 0;
  gap: 0;
}

.config-modal-left-col {
  flex: 1.15;
  min-width: 0;
  overflow-y: auto;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: #ffffff;
}

.config-modal-right-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border-left: 1px solid #cbd5e1;
  background: #f1f5f9;
}

.modal-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: #f8fafc;
  border-bottom: 1px solid #cbd5e1;
}

.modal-preview-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.86rem;
  font-weight: 700;
  color: #1e293b;
}

.modal-preview-meta {
  font-size: 0.74rem;
  font-weight: 500;
  color: #64748b;
}

.modal-preview-container {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.latex-modal-visual-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 18px;
  display: flex;
  justify-content: center;
  background: #cbd5e1;
}

.latex-modal-visual-scroll :deep(.latex-sheet-page) {
  width: 100%;
  max-width: 100%;
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.15);
  padding: 32px 36px;
}

.latex-modal-source-scroll {
  flex: 1;
  overflow: auto;
  padding: 16px;
  background: #0f172a;
}

.modal-preview-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  color: #64748b;
  font-size: 0.88rem;
  text-align: center;
}

.config-modal-section {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.config-sec-title {
  margin: 0;
  font-size: 0.88rem;
  font-weight: 700;
  color: #1e293b;
}

.template-mgmt-row {
  display: flex;
  gap: 10px;
  align-items: center;
}

.mgmt-select-col {
  flex: 1.2;
}

.mgmt-input-col {
  flex: 1;
}

.mgmt-btns-col {
  display: flex;
  gap: 6px;
}

.doc-layout-grid-modal {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.layout-params-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.param-col {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mask-section-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.mask-hint {
  font-size: 0.75rem;
  color: #64748b;
}

.modal-mask-textarea {
  min-height: 85px;
  resize: vertical;
}

.latex-config-modal-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: #f8fafc;
  border-top: 1px solid #e2e8f0;
}

.modal-footer-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
  color: #475569;
}

.sync-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #10b981;
  display: inline-block;
  box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.2);
}

.btn-modal-apply {
  padding: 8px 18px;
  background: #2563eb;
  border: 1px solid #1d4ed8;
  border-radius: 6px;
  color: #ffffff;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-modal-apply:hover {
  background: #1d4ed8;
}
</style>
