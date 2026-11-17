<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { useI18n } from 'vue-i18n';
import ExportLanguageSelect, { type ExportLocaleSelection } from '../common/ExportLanguageSelect.vue';
import { FALLBACK_LOCALE, resolveLocale } from '../../locales/registry';
import type { ExportPersonInput } from '../../utils/htmlExport';
import {
  bundleDtoToModel,
  type DesignDocumentSummaryDto,
  type DesignTreeBundleDto,
} from '../../composables/useDesignStudioStore';
import type { DesignTreeBundle, LineagePolicy } from '../../domain/design/sceneTypes';
import {
  DEFAULT_LATEX_TEMPLATES,
  generateLatexExport,
  normalizeLatexTemplateConfig,
  sanitizeLatexFileSlug,
  type AncestorSortPattern,
  type LatexExportDirection,
  type LatexExportResult,
  type LatexSourceMode,
  type LatexTemplateConfig,
  type LatexTemplateEntry,
} from '../../utils/latexExport';
import LatexConfigModal from './LatexConfigModal.vue';

interface RootAncestorConfig {
  person_id: string;
  starting_code: string;
  given_name: string | null;
  surname: string | null;
}

interface LatexBookFileStatusDto {
  file_name: string;
  role: string;
  exists: boolean;
  action: 'create' | 'update' | 'protect' | string;
}

interface LatexDirectoryInspectionDto {
  dir_path: string;
  dir_exists: boolean;
  is_writable: boolean;
  files: LatexBookFileStatusDto[];
  existing_intro_files: string[];
  error: string | null;
}

interface LatexDirectorySyncResultDto {
  written_files: string[];
  skipped_protected_files: string[];
}

const props = defineProps<{
  persons: ExportPersonInput[];
  rootAncestors: RootAncestorConfig[];
  activeProbandId: string | null;
  selectedExportRootId: string;
  exportStartCode: string;
}>();

const emit = defineEmits<{
  (e: 'update:selectedExportRootId', value: string): void;
  (e: 'update:exportStartCode', value: string): void;
  (e: 'select-proband', personId: string): void;
}>();

const { t, locale } = useI18n();

const isLeftPanelCollapsed = ref(false);
const saveStatusMsg = ref('');
const saveErrorMsg = ref('');
const exportLangOverride = ref<ExportLocaleSelection>('auto');

const effectiveExportLocale = computed(
  () =>
    exportLangOverride.value === 'auto'
      ? resolveLocale(locale.value) ?? FALLBACK_LOCALE
      : exportLangOverride.value
);

// Source & Genealogy State
const sourceMode = ref<LatexSourceMode>('root_ancestor');
const lineagePolicy = ref<LineagePolicy>('patrilinear');
const latexDirection = ref<LatexExportDirection>('descendants');
const latexMaxGenerations = ref<number>(12);
const ancestorSortPattern = ref<AncestorSortPattern>('kekule_patrilineal');
const customPersonSearch = ref('');

// Design Studio Bundle State
const savedDesignLayouts = ref<DesignDocumentSummaryDto[]>([]);
const isLoadingDesignLayouts = ref(false);
const selectedDesignLayoutId = ref('');
const selectedDesignBundle = ref<DesignTreeBundle | null>(null);

// Branch Splitting & Book Project State
const enableBranchSplit = ref(true);
const branchSplitGeneration = ref(3);
const selectedBranchIds = ref<string[]>([]);
const branchFilterQuery = ref('');
const baseFileName = ref('');
const treeSubdir = ref('Stammbaum');
const textsSubdir = ref('Texte');
const customDocumentTitle = ref('');
const customDocumentSubtitle = ref('');

// Target Book Directory Sync State
const BOOK_DIR_STORAGE_KEY = 'lg_latex_book_target_dir';
const bookTargetDir = ref<string>(localStorage.getItem(BOOK_DIR_STORAGE_KEY) || '');
const directoryInspection = ref<LatexDirectoryInspectionDto | null>(null);
const isInspectingDir = ref(false);
const isSyncingDir = ref(false);
const forceOverwriteFormat = ref(false);
const forceOverwriteMaster = ref(false);

// Templates & Config Modal
const savedLatexTemplates = ref<LatexTemplateEntry[]>([]);
const selectedLatexTemplateId = ref<string>(DEFAULT_LATEX_TEMPLATES[0].id);
const activeLatexTemplate = ref<LatexTemplateConfig>(
  normalizeLatexTemplateConfig(structuredClone(DEFAULT_LATEX_TEMPLATES[0]))
);
const showLatexConfigModal = ref(false);

// Preview State
const activeLatexFileIndex = ref(0);
const latexViewMode = ref<'visual' | 'source'>('visual');
const latexCopySuccess = ref(false);

const sortedPersons = computed(() =>
  [...props.persons].sort((a, b) => {
    const sa = (a.surname || '').toLowerCase();
    const sb = (b.surname || '').toLowerCase();
    if (sa !== sb) return sa.localeCompare(sb);
    return (a.given_name || '').toLowerCase().localeCompare((b.given_name || '').toLowerCase());
  })
);

const filteredCustomPersons = computed(() => {
  const q = customPersonSearch.value.trim().toLowerCase();
  if (!q) return sortedPersons.value.slice(0, 60);
  return sortedPersons.value
    .filter(p => {
      const full = `${p.given_name || ''} ${p.surname || ''} ${p.birth_date || ''}`.toLowerCase();
      return full.includes(q);
    })
    .slice(0, 60);
});

function formatPersonLabel(p: ExportPersonInput): string {
  const name = [p.given_name, p.surname].filter(Boolean).join(' ') || 'N.N.';
  const dates = [p.birth_date ? `*${p.birth_date}` : '', p.death_date ? `†${p.death_date}` : '']
    .filter(Boolean)
    .join(' ');
  return dates ? `${name} (${dates})` : name;
}

// Effective root person ID depending on sourceMode
const effectiveRootPersonId = computed(() => {
  if (sourceMode.value === 'design_document' && selectedDesignBundle.value) {
    return selectedDesignBundle.value.rootDocument.rootPersonId;
  }
  if (sourceMode.value === 'root_ancestor') {
    if (props.rootAncestors.some(r => r.person_id === props.selectedExportRootId)) {
      return props.selectedExportRootId;
    }
    return props.rootAncestors[0]?.person_id || props.selectedExportRootId || props.persons[0]?.id || '';
  }
  return props.selectedExportRootId || props.persons[0]?.id || '';
});

const effectiveStartCode = computed(() => {
  if (sourceMode.value === 'root_ancestor') {
    const found = props.rootAncestors.find(r => r.person_id === effectiveRootPersonId.value);
    return found?.starting_code || props.exportStartCode || '1';
  }
  return '1';
});

const effectivePolicy = computed<LineagePolicy>(() => {
  if (sourceMode.value === 'design_document' && selectedDesignBundle.value) {
    return selectedDesignBundle.value.rootDocument.lineagePolicy || 'patrilinear';
  }
  return lineagePolicy.value;
});

// Auto-suggest baseFileName when root changes and user hasn't typed a custom one
watch(
  [effectiveRootPersonId, sourceMode],
  () => {
    const p = props.persons.find(x => x.id === effectiveRootPersonId.value);
    const slug = sanitizeLatexFileSlug(p?.surname || p?.given_name || 'Chronik');
    if (!baseFileName.value.trim() || baseFileName.value.startsWith('Chronik_')) {
      baseFileName.value = `Chronik_${slug}`;
    }
  },
  { immediate: true }
);

function formatLineagePolicyLabel(policy: LineagePolicy | string): string {
  if (policy === 'patrilinear') return t('export_latex_policy_short_patri');
  if (policy === 'matrilinear') return t('export_latex_policy_short_matri');
  if (policy === 'oldest_branch') return t('export_latex_policy_short_oldest');
  return policy;
}

// Load Design Studio Documents
async function fetchDesignDocuments() {
  isLoadingDesignLayouts.value = true;
  try {
    const list = await invoke<DesignDocumentSummaryDto[]>('list_design_documents', {
      rootPersonId: null,
      documentKind: null,
    });
    savedDesignLayouts.value = list || [];

    if (savedDesignLayouts.value.length === 0) {
      selectedDesignLayoutId.value = '';
      selectedDesignBundle.value = null;
      return;
    }

    const stillExists =
      Boolean(selectedDesignLayoutId.value) &&
      savedDesignLayouts.value.some(d => d.id === selectedDesignLayoutId.value);

    if (stillExists) {
      if (
        !selectedDesignBundle.value ||
        selectedDesignBundle.value.rootDocument.id !== selectedDesignLayoutId.value
      ) {
        await loadDesignBundle(selectedDesignLayoutId.value);
      }
      return;
    }

    selectedDesignLayoutId.value = '';
    selectedDesignBundle.value = null;

    const preferred =
      savedDesignLayouts.value.find(
        d => d.root_person_id === props.activeProbandId && d.document_kind === 'master'
      ) ||
      savedDesignLayouts.value.find(d => d.document_kind === 'master') ||
      savedDesignLayouts.value[0];
    if (preferred) {
      await loadDesignBundle(preferred.id);
    }
  } catch (err) {
    console.warn('Could not load design documents:', err);
    savedDesignLayouts.value = [];
    selectedDesignLayoutId.value = '';
    selectedDesignBundle.value = null;
  } finally {
    isLoadingDesignLayouts.value = false;
  }
}

async function loadDesignBundle(docId: string) {
  if (!docId) {
    selectedDesignBundle.value = null;
    return;
  }
  selectedDesignLayoutId.value = docId;
  try {
    const dto = await invoke<DesignTreeBundleDto>('load_design_tree_bundle', {
      documentId: docId,
    });
    const model = bundleDtoToModel(dto);
    selectedDesignBundle.value = model;
    // Automatically adopt design subtrees as initial branch split anchors
    const mountAnchors = Object.values(model.rootDocument.subtreeMounts || {}).map(
      m => m.anchorPersonId
    );
    if (sourceMode.value === 'design_document' && mountAnchors.length > 0) {
      selectedBranchIds.value = mountAnchors;
      enableBranchSplit.value = true;
    }
  } catch (err) {
    saveErrorMsg.value = `${t('export_latex_design_load_err')}: ${err}`;
  }
}

watch(selectedDesignLayoutId, newId => {
  if (newId && sourceMode.value === 'design_document') {
    loadDesignBundle(newId);
  }
});

watch(sourceMode, mode => {
  if (mode === 'design_document') {
    void fetchDesignDocuments();
  }
});

watch(
  [() => props.persons, () => props.rootAncestors, () => props.activeProbandId],
  () => {
    void fetchDesignDocuments();
  }
);

// Load saved LaTeX templates
async function loadLatexTemplates() {
  try {
    const list = await invoke<LatexTemplateEntry[]>('get_latex_templates');
    savedLatexTemplates.value = list || [];
  } catch (err) {
    console.warn('Could not load LaTeX templates:', err);
  }
}

function selectLatexTemplate(id: string) {
  selectedLatexTemplateId.value = id;
  const builtin = DEFAULT_LATEX_TEMPLATES.find(t => t.id === id);
  if (builtin) {
    activeLatexTemplate.value = normalizeLatexTemplateConfig(structuredClone(builtin));
    return;
  }
  const saved = savedLatexTemplates.value.find(t => t.id === id);
  if (saved) {
    try {
      const parsed = JSON.parse(saved.config_data) as Partial<LatexTemplateConfig>;
      activeLatexTemplate.value = normalizeLatexTemplateConfig({
        ...parsed,
        id: saved.id,
        name: saved.name,
      });
    } catch {
      // Fallback
    }
  }
}

async function handleSaveLatexTemplate(asNew: boolean, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const overwriteId =
    !asNew && !selectedLatexTemplateId.value.startsWith('builtin_')
      ? selectedLatexTemplateId.value
      : null;
  try {
    const saved = await invoke<LatexTemplateEntry>('save_latex_template', {
      name: trimmed,
      createdAt: new Date().toISOString(),
      configData: JSON.stringify(activeLatexTemplate.value),
      overwriteId,
    });
    await loadLatexTemplates();
    selectLatexTemplate(saved.id);
    saveStatusMsg.value = t('export_latex_template_saved');
  } catch (err) {
    saveErrorMsg.value = String(err);
  }
}

async function handleDeleteLatexTemplate() {
  if (selectedLatexTemplateId.value.startsWith('builtin_')) return;
  try {
    await invoke('delete_latex_template', { id: selectedLatexTemplateId.value });
    await loadLatexTemplates();
    selectLatexTemplate(DEFAULT_LATEX_TEMPLATES[0].id);
  } catch (err) {
    saveErrorMsg.value = String(err);
  }
}

// Compute LaTeX Export Result
const latexExportResult = computed<LatexExportResult | null>(() => {
  if (!effectiveRootPersonId.value || props.persons.length === 0) return null;
  return generateLatexExport(props.persons, {
    sourceMode: sourceMode.value,
    rootPersonId: effectiveRootPersonId.value,
    startCode: effectiveStartCode.value,
    lineagePolicy: effectivePolicy.value,
    designBundle: sourceMode.value === 'design_document' ? selectedDesignBundle.value : null,
    rootAncestors: props.rootAncestors,
    direction: sourceMode.value === 'custom_person' ? latexDirection.value : 'descendants',
    maxGenerations: latexMaxGenerations.value,
    ancestorSortPattern: ancestorSortPattern.value,
    unknownParentPreset: 'classic',
    customUnknownFatherText: 'N.N.',
    customUnknownMotherText: 'N.N.',
    enableBranchSplit:
      enableBranchSplit.value &&
      !(sourceMode.value === 'custom_person' && latexDirection.value === 'ancestors'),
    branchSplitGeneration: branchSplitGeneration.value,
    selectedBranchIds: selectedBranchIds.value,
    baseFileName: baseFileName.value.trim() || 'Chronik',
    treeSubdir: treeSubdir.value.trim() || 'Stammbaum',
    textsSubdir: textsSubdir.value.trim() || 'Texte',
    customDocumentTitle: customDocumentTitle.value,
    customDocumentSubtitle: customDocumentSubtitle.value,
    template: activeLatexTemplate.value,
    locale: effectiveExportLocale.value,
  });
});

// Active preview file
const activeLatexFile = computed(() => {
  const files = latexExportResult.value?.files || [];
  if (files.length === 0) return null;
  return files[activeLatexFileIndex.value] || files[0];
});

watch(
  () => latexExportResult.value?.files.length,
  len => {
    if (len && activeLatexFileIndex.value >= len) {
      activeLatexFileIndex.value = 0;
    }
  }
);

const previewSheetStyle = computed(() => {
  const tpl = activeLatexTemplate.value;
  const fontPt = parseInt(tpl.fontSize || '11pt', 10) || 11;
  return {
    '--sheet-margin-mm': `${Math.max(12, Math.min(45, tpl.marginMm || 22))}px`,
    '--sheet-font-pt': `${fontPt}pt`,
    '--entry-indent-em': `${tpl.indentStepEm ?? 1.15}em`,
    '--entry-spacing-em': `${tpl.entrySpacingEm ?? 0.45}em`,
  };
});

// Branch splitting helpers
const filteredAvailableBranches = computed(() => {
  const all = latexExportResult.value?.allAvailableBranches || [];
  const q = branchFilterQuery.value.trim().toLowerCase();
  if (!q) return all;
  return all.filter(
    b =>
      b.name.toLowerCase().includes(q) ||
      b.code.toLowerCase().includes(q) ||
      `gen. ${b.generation}`.includes(q)
  );
});

function preselectBranchesByGeneration(gen: number) {
  branchSplitGeneration.value = gen;
  const all = latexExportResult.value?.allAvailableBranches || [];
  selectedBranchIds.value = all.filter(b => b.generation === gen).map(b => b.personId);
}

function adoptDesignSubtreesAsBranches() {
  if (!selectedDesignBundle.value) return;
  const ids = Object.values(selectedDesignBundle.value.rootDocument.subtreeMounts || {}).map(
    m => m.anchorPersonId
  );
  selectedBranchIds.value = ids;
}

function toggleBranchSelection(personId: string) {
  if (selectedBranchIds.value.includes(personId)) {
    selectedBranchIds.value = selectedBranchIds.value.filter(id => id !== personId);
  } else {
    selectedBranchIds.value = [...selectedBranchIds.value, personId];
  }
}

// Inspect Target Book Directory
async function inspectBookDirectory() {
  const dir = bookTargetDir.value.trim();
  const res = latexExportResult.value;
  if (!dir || !res) {
    directoryInspection.value = null;
    return;
  }
  isInspectingDir.value = true;
  try {
    const expectedFiles = res.files.map(f => ({
      file_name: f.fileName,
      role: f.role,
    }));
    directoryInspection.value = await invoke<LatexDirectoryInspectionDto>(
      'inspect_latex_book_directory',
      {
        dirPath: dir,
        expectedFiles,
      }
    );
  } catch (err) {
    directoryInspection.value = null;
    saveErrorMsg.value = String(err);
  } finally {
    isInspectingDir.value = false;
  }
}

watch([bookTargetDir, latexExportResult], () => {
  if (bookTargetDir.value.trim()) {
    inspectBookDirectory();
  } else {
    directoryInspection.value = null;
  }
});

async function pickBookTargetDirectory() {
  try {
    const picked = await open({
      directory: true,
      multiple: false,
      defaultPath: bookTargetDir.value || undefined,
    });
    if (typeof picked === 'string' && picked.trim()) {
      bookTargetDir.value = picked.trim();
      localStorage.setItem(BOOK_DIR_STORAGE_KEY, bookTargetDir.value);
      saveErrorMsg.value = '';
    }
  } catch (err) {
    saveErrorMsg.value = String(err);
  }
}

async function syncToBookDirectory() {
  const res = latexExportResult.value;
  if (!res) return;
  if (!bookTargetDir.value.trim()) {
    await pickBookTargetDirectory();
    if (!bookTargetDir.value.trim()) return;
  }

  isSyncingDir.value = true;
  saveStatusMsg.value = '';
  saveErrorMsg.value = '';

  try {
    const payload: Array<{ file_name: string; content: string; protect_if_exists: boolean }> =
      res.files.map(f => ({
        file_name: f.fileName,
        content: f.texContent,
        protect_if_exists: f.role === 'master' || f.role === 'format' || f.role === 'intro',
      }));

    const syncRes = await invoke<LatexDirectorySyncResultDto>('sync_latex_book_directory', {
      dirPath: bookTargetDir.value.trim(),
      files: payload,
      forceOverwriteMaster: forceOverwriteMaster.value,
      forceOverwriteFormat: forceOverwriteFormat.value,
    });

    forceOverwriteMaster.value = false;
    forceOverwriteFormat.value = false;
    await inspectBookDirectory();

    saveStatusMsg.value = t('export_latex_sync_success', {
      written: syncRes.written_files.length,
      protected: syncRes.skipped_protected_files.length,
    });
  } catch (err) {
    saveErrorMsg.value = `${t('export_latex_sync_err')}: ${err}`;
  } finally {
    isSyncingDir.value = false;
  }
}

async function saveSingleOrBundleAs() {
  const res = latexExportResult.value;
  if (!res || res.files.length === 0) return;
  saveStatusMsg.value = '';
  saveErrorMsg.value = '';
  try {
    const pickedPath = await save({
      defaultPath: res.masterFileName,
      filters: [{ name: 'LaTeX', extensions: ['tex'] }],
    });
    if (!pickedPath) return;

    await invoke('save_latex_export_bundle', {
      baseFilePath: pickedPath,
      files: res.files.map(f => ({
        file_name: f.fileName,
        content: f.texContent,
      })),
    });
    saveStatusMsg.value = t('export_latex_save_bundle_success', { count: res.files.length });
  } catch (err) {
    saveErrorMsg.value = String(err);
  }
}

async function copyActiveLatexSource() {
  if (!activeLatexFile.value) return;
  try {
    await navigator.clipboard.writeText(activeLatexFile.value.texContent);
    latexCopySuccess.value = true;
    setTimeout(() => (latexCopySuccess.value = false), 1800);
  } catch (err) {
    saveErrorMsg.value = String(err);
  }
}

function handlePreviewClick(evt: MouseEvent) {
  const target = evt.target as HTMLElement | null;
  const linkEl = target?.closest('.preview-branch-link') as HTMLElement | null;
  if (!linkEl) return;
  const targetFile = linkEl.dataset.targetBranch;
  if (!targetFile || !latexExportResult.value) return;
  const idx = latexExportResult.value.files.findIndex(f => f.fileName === targetFile);
  if (idx !== -1) {
    activeLatexFileIndex.value = idx;
  }
}

onMounted(async () => {
  if (props.rootAncestors.length > 0) {
    sourceMode.value = 'root_ancestor';
  }
  await Promise.all([fetchDesignDocuments(), loadLatexTemplates()]);
  if (bookTargetDir.value.trim()) {
    await inspectBookDirectory();
  }
});
</script>

<template>
  <div class="latex-export-workspace">
    <!-- Linke Steuerungs-Sidebar -->
    <aside class="latex-sidebar" :class="{ collapsed: isLeftPanelCollapsed }">
      <div class="sidebar-top-bar">
        <span v-if="!isLeftPanelCollapsed" class="sidebar-title">📚 {{ t('export_latex_sidebar_title') }}</span>
        <button
          type="button"
          class="btn-collapse-sidebar"
          @click="isLeftPanelCollapsed = !isLeftPanelCollapsed"
          :title="isLeftPanelCollapsed ? 'Sidebar öffnen' : 'Sidebar einklappen'"
        >
          {{ isLeftPanelCollapsed ? '▶' : '◀' }}
        </button>
      </div>

      <div v-if="!isLeftPanelCollapsed" class="sidebar-scroll-content">
        <!-- Karte 1: Datenquelle & Linienführung -->
        <section class="export-card">
          <h4 class="card-title">1. {{ t('export_latex_source_title') }}</h4>

          <div class="source-mode-tabs">
            <button
              type="button"
              class="source-tab-btn"
              :class="{ active: sourceMode === 'design_document' }"
              @click="sourceMode = 'design_document'"
            >
              🎨 {{ t('export_latex_src_design') }}
            </button>
            <button
              type="button"
              class="source-tab-btn"
              :class="{ active: sourceMode === 'root_ancestor' }"
              @click="sourceMode = 'root_ancestor'"
            >
              👑 {{ t('export_latex_src_proband') }}
            </button>
            <button
              type="button"
              class="source-tab-btn"
              :class="{ active: sourceMode === 'custom_person' }"
              @click="sourceMode = 'custom_person'"
            >
              🌿 {{ t('export_latex_src_other') }}
            </button>
          </div>

          <!-- Quelle A: Design Studio Arbeitsstand -->
          <div v-if="sourceMode === 'design_document'" class="source-panel">
            <div class="field-row">
              <label class="field-lbl">{{ t('export_latex_design_doc_lbl') }}</label>
              <select v-model="selectedDesignLayoutId" class="export-select">
                <option value="" disabled>{{ t('export_latex_design_doc_placeholder') }}</option>
                <option v-for="doc in savedDesignLayouts" :key="doc.id" :value="doc.id">
                  {{ doc.name }} ({{ doc.document_kind === 'master' ? t('export_latex_doc_kind_master') : t('export_latex_doc_kind_subtree') }})
                </option>
              </select>
            </div>
            <div v-if="selectedDesignBundle" class="info-pill-row">
              <span class="info-pill">{{ t('export_latex_chip_policy') }}: <strong>{{ formatLineagePolicyLabel(selectedDesignBundle.rootDocument.lineagePolicy) }}</strong></span>
              <span class="info-pill">{{ t('export_latex_chip_subtrees') }}: <strong>{{ Object.keys(selectedDesignBundle.rootDocument.subtreeMounts || {}).length }}</strong></span>
            </div>
            <p v-else-if="!isLoadingDesignLayouts" class="hint-text">
              {{ t('export_latex_design_empty_hint') }}
            </p>
          </div>

          <!-- Quelle B: Definierter Stammahn -->
          <div v-else-if="sourceMode === 'root_ancestor'" class="source-panel">
            <div class="field-row">
              <label class="field-lbl">{{ t('export_latex_proband_lbl') }}</label>
              <select
                :value="effectiveRootPersonId"
                @change="e => emit('update:selectedExportRootId', (e.target as HTMLSelectElement).value)"
                class="export-select"
              >
                <option v-for="ra in rootAncestors" :key="ra.person_id" :value="ra.person_id">
                  [{{ ra.starting_code }}] {{ [ra.given_name, ra.surname].filter(Boolean).join(' ') }}
                </option>
              </select>
            </div>
            <div class="field-row">
              <label class="field-lbl">{{ t('export_latex_policy_lbl') }}</label>
              <select v-model="lineagePolicy" class="export-select">
                <option value="patrilinear">{{ t('export_latex_policy_patri') }}</option>
                <option value="matrilinear">{{ t('export_latex_policy_matri') }}</option>
                <option value="oldest_branch">{{ t('export_latex_policy_oldest') }}</option>
              </select>
            </div>
          </div>

          <!-- Quelle C: Andere Linie / Beliebige Person -->
          <div v-else class="source-panel">
            <div class="field-row">
              <label class="field-lbl">{{ t('export_latex_person_search_lbl') }}</label>
              <input
                type="text"
                v-model="customPersonSearch"
                class="export-input"
                :placeholder="t('export_latex_person_search_ph')"
              />
              <select
                :value="effectiveRootPersonId"
                @change="e => emit('update:selectedExportRootId', (e.target as HTMLSelectElement).value)"
                class="export-select"
              >
                <option v-for="p in filteredCustomPersons" :key="p.id" :value="p.id">
                  {{ formatPersonLabel(p) }}
                </option>
              </select>
            </div>
            <div class="two-col-row">
              <div>
                <label class="field-lbl">{{ t('export_latex_direction_lbl') }}</label>
                <select v-model="latexDirection" class="export-select">
                  <option value="descendants">{{ t('export_latex_dir_descendants') }}</option>
                  <option value="ancestors">{{ t('export_latex_dir_ancestors') }}</option>
                </select>
              </div>
              <div>
                <label class="field-lbl">{{ t('export_latex_max_gen_lbl') }}</label>
                <input type="number" v-model.number="latexMaxGenerations" min="1" max="30" class="export-input" />
              </div>
            </div>
            <div class="bridge-info-box">
              🔗 {{ t('export_latex_bridge_info') }}
              <strong v-if="latexExportResult">({{ latexExportResult.bridgeRefsCount }})</strong>
            </div>
          </div>

          <div class="field-row mt-sm">
            <label class="field-lbl">{{ t('export_language_label') }}</label>
            <ExportLanguageSelect v-model="exportLangOverride" />
          </div>
        </section>

        <!-- Karte 2: Stämme-Zuschnitt & Buchgliederung -->
        <section
          v-if="!(sourceMode === 'custom_person' && latexDirection === 'ancestors')"
          class="export-card"
        >
          <div class="card-header-row">
            <h4 class="card-title">2. {{ t('export_latex_branch_split_title') }}</h4>
            <label class="switch-inline">
              <input type="checkbox" v-model="enableBranchSplit" />
              <span>{{ t('export_latex_split_active') }}</span>
            </label>
          </div>

          <div v-if="enableBranchSplit && latexExportResult" class="branch-split-body">
            <div class="branch-quick-actions">
              <button
                v-if="sourceMode === 'design_document' && selectedDesignBundle"
                type="button"
                class="btn-mini-action"
                @click="adoptDesignSubtreesAsBranches"
              >
                🎨 {{ t('export_latex_adopt_design_subtrees') }}
              </button>
              <div class="gen-preselect-row">
                <span class="mini-lbl">{{ t('export_latex_preselect_gen') }}:</span>
                <button
                  v-for="g in latexExportResult.detectedGenerations.filter(x => x.generation >= 2 && x.branchesWithChildrenCount > 0)"
                  :key="g.generation"
                  type="button"
                  class="gen-chip-btn"
                  :class="{ active: branchSplitGeneration === g.generation && selectedBranchIds.length === 0 }"
                  @click="preselectBranchesByGeneration(g.generation)"
                >
                  Gen. {{ g.generation }} ({{ g.branchesWithChildrenCount }})
                </button>
              </div>
            </div>

            <input
              type="text"
              v-model="branchFilterQuery"
              class="export-input compact mt-xs"
              :placeholder="t('export_latex_branch_filter_ph')"
            />

            <div class="branch-checklist">
              <label
                v-for="b in filteredAvailableBranches"
                :key="b.personId"
                class="branch-check-item"
              >
                <input
                  type="checkbox"
                  :checked="
                    selectedBranchIds.length > 0
                      ? selectedBranchIds.includes(b.personId)
                      : b.isDesignSubtree || b.generation === branchSplitGeneration
                  "
                  @change="toggleBranchSelection(b.personId)"
                />
                <span class="branch-code-badge">[{{ b.code }}]</span>
                <span class="branch-name-txt">{{ b.name }}</span>
                <span class="branch-meta-txt">G{{ b.generation }} · {{ b.descendantCount }}</span>
              </label>
              <div v-if="filteredAvailableBranches.length === 0" class="hint-text">
                {{ t('export_latex_no_branches') }}
              </div>
            </div>
          </div>
        </section>

        <!-- Karte 3: Buchverzeichnis-Sync ("Living Book") -->
        <section class="export-card">
          <h4 class="card-title">3. {{ t('export_latex_book_sync_title') }}</h4>

          <div class="field-row">
            <label class="field-lbl">{{ t('export_latex_base_filename_lbl') }}</label>
            <input type="text" v-model="baseFileName" class="export-input" placeholder="Chronik_Froning" />
          </div>

          <div class="two-col-row equal-cols">
            <div class="field-row">
              <label class="field-lbl">{{ t('export_latex_tree_subdir_lbl') }}</label>
              <input type="text" v-model="treeSubdir" class="export-input" placeholder="Stammbaum" />
            </div>
            <div class="field-row">
              <label class="field-lbl">{{ t('export_latex_texts_subdir_lbl') }}</label>
              <input type="text" v-model="textsSubdir" class="export-input" placeholder="Texte" />
            </div>
          </div>

          <div class="field-row">
            <label class="field-lbl">{{ t('export_latex_target_dir_lbl') }}</label>
            <div class="dir-picker-row">
              <input
                type="text"
                :value="bookTargetDir"
                readonly
                class="export-input dir-readonly"
                :placeholder="t('export_latex_target_dir_ph')"
              />
              <button type="button" class="btn-pick-dir" @click="pickBookTargetDirectory">
                📂 {{ t('export_latex_pick_dir_btn') }}
              </button>
            </div>
          </div>

          <div v-if="directoryInspection" class="sync-status-box">
            <div class="sync-status-title">{{ t('export_latex_sync_plan_title') }}:</div>
            <ul class="sync-file-list">
              <li v-for="f in directoryInspection.files" :key="f.file_name" class="sync-file-row">
                <span class="sync-badge" :class="`badge-${f.action}`">
                  {{
                    f.action === 'protect'
                      ? '🛡️ ' + t('export_latex_act_protect')
                      : f.action === 'update'
                        ? '🔄 ' + t('export_latex_act_update')
                        : '✨ ' + t('export_latex_act_create')
                  }}
                </span>
                <span class="sync-fname">{{ f.file_name }}</span>
              </li>
            </ul>
          </div>

          <div class="sync-options-checks">
            <label class="check-row warn-check">
              <input type="checkbox" v-model="forceOverwriteFormat" />
              <span>{{ t('export_latex_opt_force_format') }}</span>
            </label>
            <label class="check-row warn-check">
              <input type="checkbox" v-model="forceOverwriteMaster" />
              <span>{{ t('export_latex_opt_force_master') }}</span>
            </label>
          </div>

          <div class="export-actions-stack">
            <button
              type="button"
              class="btn-primary-sync"
              :disabled="!latexExportResult || isSyncingDir"
              @click="syncToBookDirectory"
            >
              {{ isSyncingDir ? '⏳ ...' : '🔄 ' + t('export_latex_sync_btn') }}
            </button>
            <button
              type="button"
              class="btn-secondary-save"
              :disabled="!latexExportResult"
              @click="saveSingleOrBundleAs"
            >
              💾 {{ t('export_latex_save_bundle_btn', { count: latexExportResult?.files.length || 0 }) }}
            </button>
          </div>

          <div v-if="saveStatusMsg" class="status-banner ok">{{ saveStatusMsg }}</div>
          <div v-if="saveErrorMsg" class="status-banner err">{{ saveErrorMsg }}</div>
        </section>

        <!-- Karte 4: Vorlage & Buchtitel -->
        <section class="export-card">
          <div class="card-header-row">
            <h4 class="card-title">4. {{ t('export_latex_template_title') }}</h4>
            <button type="button" class="btn-mini-action" @click="showLatexConfigModal = true">
              ⚙️ {{ t('export_latex_open_config_btn') }}
            </button>
          </div>
          <select
            :value="selectedLatexTemplateId"
            @change="e => selectLatexTemplate((e.target as HTMLSelectElement).value)"
            class="export-select"
          >
            <optgroup :label="t('export_latex_builtin_templates')">
              <option v-for="tpl in DEFAULT_LATEX_TEMPLATES" :key="tpl.id" :value="tpl.id">
                {{ tpl.name }}
              </option>
            </optgroup>
            <optgroup v-if="savedLatexTemplates.length > 0" :label="t('export_latex_saved_templates')">
              <option v-for="st in savedLatexTemplates" :key="st.id" :value="st.id">
                {{ st.name }}
              </option>
            </optgroup>
          </select>
          <div class="field-row mt-xs">
            <input
              type="text"
              v-model="customDocumentTitle"
              class="export-input compact"
              :placeholder="t('export_latex_doc_title_ph')"
            />
            <input
              type="text"
              v-model="customDocumentSubtitle"
              class="export-input compact mt-xs"
              :placeholder="t('export_latex_doc_subtitle_ph')"
            />
          </div>
        </section>
      </div>
    </aside>

    <!-- Rechter Vorschau-Bereich -->
    <main class="latex-preview-main">
      <div class="preview-topbar" v-if="latexExportResult && activeLatexFile">
        <div class="preview-stats">
          <span class="stat-pill">👥 {{ latexExportResult.totalEntries }} {{ t('export_latex_entries_lbl') }}</span>
          <span class="stat-pill">🧬 {{ latexExportResult.maxGenerationReached }} {{ t('export_latex_gens_lbl') }}</span>
          <span v-if="latexExportResult.activeSplitBranches.length > 0" class="stat-pill">
            🌿 {{ latexExportResult.activeSplitBranches.length }} {{ t('export_latex_branches_lbl') }}
          </span>
          <span v-if="latexExportResult.bridgeRefsCount > 0" class="stat-pill bridge">
            🔗 {{ latexExportResult.bridgeRefsCount }} {{ t('export_latex_bridges_lbl') }}
          </span>
        </div>

        <div class="preview-mode-controls">
          <button
            type="button"
            class="btn-viewport"
            :class="{ active: latexViewMode === 'visual' }"
            @click="latexViewMode = 'visual'"
          >
            🖨️ {{ t('export_latex_view_visual') }}
          </button>
          <button
            type="button"
            class="btn-viewport"
            :class="{ active: latexViewMode === 'source' }"
            @click="latexViewMode = 'source'"
          >
            💻 {{ t('export_latex_view_source') }}
          </button>
          <button type="button" class="btn-copy-code" @click="copyActiveLatexSource">
            {{ latexCopySuccess ? '✓ ' + t('export_latex_copied') : '📋 ' + t('export_latex_copy_code') }}
          </button>
        </div>
      </div>

      <!-- Datei-Tabs (Master, Gliederung, Vorlauf, Stämme) -->
      <div v-if="latexExportResult && latexExportResult.files.length > 0" class="file-tabs-strip">
        <button
          v-for="(f, idx) in latexExportResult.files"
          :key="f.fileName"
          type="button"
          class="file-tab-btn"
          :class="{ active: activeLatexFileIndex === idx, [`role-${f.role}`]: true }"
          @click="activeLatexFileIndex = idx"
        >
          <span v-if="f.role === 'master'">📘</span>
          <span v-else-if="f.role === 'format'">🎨</span>
          <span v-else-if="f.role === 'structure'">📑</span>
          <span v-else-if="f.role === 'intro'">✍️</span>
          <span v-else-if="f.isMainFile">🌳</span>
          <span v-else>🌿</span>
          <span>{{ f.label }}</span>
        </button>
      </div>

      <!-- Vorschau-Inhalt -->
      <div v-if="activeLatexFile" class="preview-viewport">
        <div
          v-if="latexViewMode === 'visual'"
          class="latex-sheet-paper"
          :style="previewSheetStyle"
          @click="handlePreviewClick"
          v-html="activeLatexFile.previewHtml"
        ></div>
        <div v-else class="latex-source-container">
          <pre class="latex-source-code"><code>{{ activeLatexFile.texContent }}</code></pre>
        </div>
      </div>
      <div v-else class="preview-empty-state">
        <p>{{ t('export_latex_empty_preview') }}</p>
      </div>
    </main>

    <!-- Konfigurations-Modal -->
    <LatexConfigModal
      :show="showLatexConfigModal"
      :template="activeLatexTemplate"
      :selected-template-id="selectedLatexTemplateId"
      :saved-templates="savedLatexTemplates"
      :builtin-templates="DEFAULT_LATEX_TEMPLATES"
      @close="showLatexConfigModal = false"
      @select-template="selectLatexTemplate"
      @save-template="handleSaveLatexTemplate"
      @delete-template="handleDeleteLatexTemplate"
    />
  </div>
</template>

<style scoped>
.latex-export-workspace {
  display: flex;
  flex: 1;
  min-height: 0;
  background: #f1f5f9;
}

.latex-sidebar {
  width: 380px;
  min-width: 340px;
  background: #ffffff;
  border-right: 1px solid #cbd5e1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  transition: width 0.2s ease;
}

.latex-sidebar.collapsed {
  width: 44px;
  min-width: 44px;
}

.sidebar-top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid #e2e8f0;
  background: #f8fafc;
}

.sidebar-title {
  font-size: 0.86rem;
  font-weight: 700;
  color: #0f172a;
}

.btn-collapse-sidebar {
  border: 1px solid #cbd5e1;
  background: #ffffff;
  border-radius: 4px;
  padding: 2px 7px;
  cursor: pointer;
  font-size: 0.75rem;
}

.sidebar-scroll-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.export-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.card-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.card-title {
  margin: 0;
  font-size: 0.82rem;
  font-weight: 700;
  color: #1e293b;
}

.source-mode-tabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  background: #f1f5f9;
  padding: 3px;
  border-radius: 6px;
}

.source-tab-btn {
  border: none;
  background: transparent;
  padding: 6px 4px;
  border-radius: 4px;
  font-size: 0.72rem;
  font-weight: 600;
  color: #475569;
  cursor: pointer;
}

.source-tab-btn.active {
  background: #ffffff;
  color: #0f172a;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}

.field-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-lbl,
.mini-lbl {
  font-size: 0.74rem;
  font-weight: 600;
  color: #475569;
}

.export-select,
.export-input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid #cbd5e1;
  border-radius: 5px;
  font-size: 0.8rem;
  background: #ffffff;
  color: #0f172a;
  box-sizing: border-box;
}

.two-col-row {
  display: grid;
  grid-template-columns: 1fr 80px;
  gap: 8px;
}

.two-col-row.equal-cols {
  grid-template-columns: 1fr 1fr;
}

.info-pill-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.info-pill {
  font-size: 0.72rem;
  background: #eff6ff;
  color: #1d4ed8;
  border: 1px solid #bfdbfe;
  padding: 2px 7px;
  border-radius: 999px;
}

.bridge-info-box {
  font-size: 0.74rem;
  color: #0369a1;
  background: #f0f9ff;
  border: 1px solid #bae6fd;
  padding: 6px 8px;
  border-radius: 5px;
}

.switch-inline {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.75rem;
  cursor: pointer;
}

.gen-preselect-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.gen-chip-btn {
  border: 1px solid #cbd5e1;
  background: #f8fafc;
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 0.71rem;
  cursor: pointer;
}

.gen-chip-btn.active {
  background: #2563eb;
  color: #ffffff;
  border-color: #1d4ed8;
}

.branch-checklist {
  max-height: 165px;
  overflow-y: auto;
  border: 1px solid #e2e8f0;
  border-radius: 5px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.branch-check-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.74rem;
  padding: 3px 5px;
  border-radius: 4px;
  cursor: pointer;
}

.branch-check-item:hover {
  background: #f1f5f9;
}

.branch-code-badge {
  font-family: ui-monospace, monospace;
  font-weight: 700;
  color: #1d4ed8;
}

.branch-name-txt {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.branch-meta-txt {
  font-size: 0.69rem;
  color: #64748b;
}

.dir-picker-row {
  display: flex;
  gap: 6px;
}

.dir-readonly {
  flex: 1;
  background: #f8fafc;
  font-size: 0.73rem;
}

.btn-pick-dir,
.btn-mini-action {
  border: 1px solid #cbd5e1;
  background: #f8fafc;
  border-radius: 5px;
  padding: 5px 9px;
  font-size: 0.74rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.btn-pick-dir:hover,
.btn-mini-action:hover {
  background: #e2e8f0;
}

.sync-status-box {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 7px 9px;
}

.sync-status-title {
  font-size: 0.72rem;
  font-weight: 700;
  color: #334155;
  margin-bottom: 4px;
}

.sync-file-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 130px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.sync-file-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.72rem;
}

.sync-badge {
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 600;
  font-size: 0.68rem;
  white-space: nowrap;
}

.badge-protect {
  background: #ecfdf5;
  color: #047857;
  border: 1px solid #a7f3d0;
}

.badge-update {
  background: #eff6ff;
  color: #1d4ed8;
  border: 1px solid #bfdbfe;
}

.badge-create {
  background: #fefce8;
  color: #a16207;
  border: 1px solid #fde047;
}

.sync-fname {
  font-family: ui-monospace, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sync-options-checks {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.check-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.73rem;
  color: #334155;
  cursor: pointer;
}

.check-row.warn-check {
  color: #9a3412;
}

.export-actions-stack {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.btn-primary-sync {
  padding: 9px 12px;
  background: #2563eb;
  color: #ffffff;
  border: none;
  border-radius: 6px;
  font-size: 0.82rem;
  font-weight: 700;
  cursor: pointer;
}

.btn-primary-sync:hover:not(:disabled) {
  background: #1d4ed8;
}

.btn-primary-sync:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.btn-secondary-save {
  padding: 7px 10px;
  background: #f1f5f9;
  color: #1e293b;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font-size: 0.77rem;
  font-weight: 600;
  cursor: pointer;
}

.status-banner {
  font-size: 0.75rem;
  padding: 6px 8px;
  border-radius: 5px;
}

.status-banner.ok {
  background: #ecfdf5;
  color: #065f46;
  border: 1px solid #a7f3d0;
}

.status-banner.err {
  background: #fef2f2;
  color: #991b1b;
  border: 1px solid #fecaca;
}

.latex-preview-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.preview-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  gap: 12px;
  flex-wrap: wrap;
}

.preview-stats {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.stat-pill {
  font-size: 0.74rem;
  font-weight: 600;
  background: #f1f5f9;
  color: #334155;
  padding: 3px 8px;
  border-radius: 999px;
}

.stat-pill.bridge {
  background: #f0f9ff;
  color: #0369a1;
}

.preview-mode-controls {
  display: flex;
  gap: 6px;
}

.btn-viewport,
.btn-copy-code {
  border: 1px solid #cbd5e1;
  background: #ffffff;
  border-radius: 5px;
  padding: 5px 10px;
  font-size: 0.76rem;
  font-weight: 600;
  cursor: pointer;
}

.btn-viewport.active {
  background: #0f172a;
  color: #ffffff;
  border-color: #0f172a;
}

.file-tabs-strip {
  display: flex;
  gap: 4px;
  padding: 6px 14px;
  background: #e2e8f0;
  overflow-x: auto;
}

.file-tab-btn {
  border: 1px solid transparent;
  background: #f8fafc;
  border-radius: 5px;
  padding: 5px 10px;
  font-size: 0.75rem;
  font-weight: 600;
  color: #475569;
  cursor: pointer;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 5px;
}

.file-tab-btn.active {
  background: #ffffff;
  color: #0f172a;
  border-color: #94a3b8;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}

.preview-viewport {
  flex: 1;
  overflow: auto;
  padding: 20px;
  display: flex;
  justify-content: center;
}

.latex-sheet-paper {
  width: 100%;
  max-width: 820px;
  min-height: 100%;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.08);
  padding: var(--sheet-margin-mm, 22px);
  font-size: var(--sheet-font-pt, 11pt);
  font-family: 'Georgia', 'Times New Roman', serif;
  color: #1e293b;
  height: fit-content;
}

.latex-sheet-paper :deep(.preview-entry) {
  margin-left: calc(var(--entry-indent, 0) * var(--entry-indent-em, 1.15em));
  margin-top: var(--entry-spacing-em, 0.45em);
  line-height: 1.45;
}

.latex-sheet-paper :deep(.preview-code),
.latex-sheet-paper :deep(.preview-name) {
  font-weight: 700;
  color: #0f172a;
  margin-right: 5px;
}

.latex-sheet-paper :deep(.preview-spouse-row) {
  margin-left: 1.4em;
  margin-top: 2px;
  font-size: 0.94em;
  color: #334155;
}

.latex-sheet-paper :deep(.preview-marriage-sym) {
  font-weight: 700;
  margin-right: 4px;
}

.latex-sheet-paper :deep(.preview-small) {
  font-size: 0.85em;
  color: #475569;
}

.latex-sheet-paper :deep(.preview-sc) {
  font-variant: small-caps;
}

.latex-sheet-paper :deep(.preview-branch-link) {
  color: #2563eb;
  text-decoration: underline;
  cursor: pointer;
}

.latex-sheet-paper :deep(.preview-overview-table) {
  width: 100%;
  border-collapse: collapse;
  margin: 12px 0;
  font-size: 0.86rem;
}

.latex-sheet-paper :deep(.preview-overview-table th),
.latex-sheet-paper :deep(.preview-overview-table td) {
  border-bottom: 1px solid #cbd5e1;
  padding: 5px 8px;
  text-align: left;
}

.latex-sheet-paper :deep(.preview-structure-item) {
  padding: 6px 8px;
  border-left: 3px solid #3b82f6;
  background: #f8fafc;
  margin: 6px 0;
  font-size: 0.85rem;
}

.latex-sheet-paper :deep(.intro-hook) {
  margin-left: 8px;
  color: #047857;
  font-size: 0.78rem;
}

.latex-source-container {
  width: 100%;
  max-width: 960px;
  background: #0f172a;
  color: #e2e8f0;
  border-radius: 8px;
  padding: 16px;
  overflow: auto;
  height: fit-content;
}

.latex-source-code {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.82rem;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.hint-text {
  font-size: 0.74rem;
  color: #64748b;
  margin: 0;
}

.mt-xs {
  margin-top: 4px;
}

.mt-sm {
  margin-top: 8px;
}

.preview-empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #64748b;
}
</style>
