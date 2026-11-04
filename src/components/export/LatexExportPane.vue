<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { useI18n } from 'vue-i18n';
import type { ExportPersonInput } from '../../utils/htmlExport';
import LatexConfigModal from './LatexConfigModal.vue';
import {
  generateLatexExport,
  BUILTIN_LATEX_TEMPLATES,
  type LatexExportMode,
  type LatexExportDirection,
  type AncestorSortPattern,
  type UnknownParentPreset,
  type LatexTemplateConfig,
  type LatexExportResult,
  type GeneratedLatexFile,
  type LatexTemplateEntry,
} from '../../utils/latexExport';

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

const isLeftPanelCollapsed = ref<boolean>(false);
const saveStatusMsg = ref<string>('');
const saveErrorMsg = ref<string>('');
const personSearchQuery = ref<string>('');

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

// Gespeicherte & eingebaute Vorlagen
const savedLatexTemplates = ref<LatexTemplateEntry[]>([]);
const selectedLatexTemplateId = ref<string>(BUILTIN_LATEX_TEMPLATES[0].id);
const latexTemplateSaveName = ref<string>(BUILTIN_LATEX_TEMPLATES[0].name);
const latexActiveTemplate = ref<LatexTemplateConfig>({
  ...BUILTIN_LATEX_TEMPLATES[0],
});

const latexPreviewMode = ref<'visual' | 'source'>('visual');
const latexActiveFileIdx = ref<number>(0);
const isSavingLatex = ref<boolean>(false);
const showLatexConfigModal = ref<boolean>(false);

const LOCAL_STORAGE_LATEX_TEMPLATES_KEY = 'stammbaum_latex_templates_v1';

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

const isSelectedRootInDefinedList = computed<boolean>(() => {
  return props.rootAncestors.some(r => r.person_id === props.selectedExportRootId);
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
  saveStatusMsg.value = '';
  saveErrorMsg.value = '';
}

function onDefinedRootDropdownChange(personId: string) {
  if (!personId) return;
  const configured = props.rootAncestors.find(r => r.person_id === personId);
  selectRootPerson(personId, configured?.starting_code);
  emit('select-proband', personId);
}

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

const latexExportResult = computed<LatexExportResult | null>(() => {
  if (!props.selectedExportRootId) return null;
  return generateLatexExport(props.persons, {
    mode: latexMode.value,
    rootPersonId: props.selectedExportRootId,
    startCode: props.exportStartCode || '1',
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

onMounted(() => {
  fetchLatexTemplates();
});
</script>

<template>
  <div class="export-workspace">
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
                :value="exportStartCode"
                @input="emit('update:exportStartCode', ($event.target as HTMLInputElement).value)"
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

    <!-- Dediziertes Konfigurationsfenster: Erscheinungsbild & Textmaske (LaTeX) -->
    <LatexConfigModal
      :show="showLatexConfigModal"
      :template="latexActiveTemplate"
      :selected-template-id="selectedLatexTemplateId"
      :saved-templates="savedLatexTemplates"
      :builtin-templates="BUILTIN_LATEX_TEMPLATES"
      @close="showLatexConfigModal = false"
      @select-template="selectLatexTemplateById"
      @save-template="(asNew, name) => { latexTemplateSaveName = name; saveCurrentLatexTemplate(asNew); }"
      @delete-template="deleteSelectedLatexTemplate"
    />
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

.export-section-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
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

.cfg-sub-hint {
  font-size: 0.74rem;
  color: #64748b;
  line-height: 1.35;
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

/* Person Picker */
.person-picker-list {
  max-height: 180px;
  overflow-y: auto;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #ffffff;
  margin-top: 6px;
}

.compact-picker {
  max-height: 140px;
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
  font-size: 0.72rem;
  color: #94a3b8;
  margin-top: 2px;
}

/* LaTeX Mode Pills */
.latex-mode-pills {
  display: flex;
  gap: 6px;
  margin-bottom: 4px;
}

.latex-mode-pill {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  border-radius: 6px;
  font-size: 0.78rem;
  font-weight: 600;
  color: #475569;
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: center;
}

.latex-mode-pill:hover {
  background: #f1f5f9;
  border-color: #94a3b8;
}

.latex-mode-pill.active {
  background: #eff6ff;
  border-color: #3b82f6;
  color: #1d4ed8;
}

.latex-sub-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 10px;
}

.sub-field-label {
  font-size: 0.76rem;
  font-weight: 700;
  color: #475569;
}

.gen-number-control {
  display: flex;
  align-items: center;
  gap: 8px;
}

.num-inp {
  max-width: 90px;
  font-weight: 600;
}

.gen-unit {
  font-size: 0.8rem;
  color: #64748b;
}

.custom-unknown-inputs {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
  background: #f8fafc;
  padding: 8px;
  border-radius: 6px;
  border: 1px dashed #cbd5e1;
}

/* Branch split panel */
.branch-split-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 10px;
  margin-top: 4px;
}

.detected-branches-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.76rem;
  font-weight: 700;
  color: #475569;
}

.btn-mini-link {
  background: none;
  border: none;
  font-size: 0.72rem;
  color: #3b82f6;
  font-weight: 600;
  cursor: pointer;
  text-decoration: underline;
  padding: 0;
}

.detected-branches-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 180px;
  overflow-y: auto;
  border: 1px solid #f1f5f9;
  border-radius: 4px;
  padding: 4px;
}

.branch-file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 4px;
  font-size: 0.78rem;
  background: #f8fafc;
  cursor: pointer;
}

.branch-file-item:hover {
  background: #f1f5f9;
}

.master-file-item,
.main-file-item {
  cursor: default;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
}

.branch-file-badge {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  padding: 1px 4px;
  border-radius: 3px;
  background: #dbeafe;
  color: #1e40af;
}

.master-badge {
  background: #fee2e2;
  color: #991b1b;
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
}

.branch-code-pill {
  font-size: 0.68rem;
  font-family: monospace;
  color: #2563eb;
  font-weight: 700;
}

.branch-item-sub {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.7rem;
  color: #64748b;
}

.branch-meta {
  font-size: 0.7rem;
  color: #64748b;
  margin-left: auto;
}

/* Template summary card */
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

.preview-info-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-zoom-action {
  padding: 5px 10px;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font-size: 0.78rem;
  font-weight: 600;
  color: #475569;
  cursor: pointer;
}

.btn-zoom-action:hover {
  background: #f8fafc;
  color: #1e293b;
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

/* File Tabbar */
.latex-files-tabbar {
  display: flex;
  gap: 4px;
  padding: 6px 12px;
  background: #e2e8f0;
  border-bottom: 1px solid #cbd5e1;
  overflow-x: auto;
}

.latex-file-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font-size: 0.78rem;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;
}

.latex-file-tab:hover {
  background: #f8fafc;
}

.latex-file-tab.active {
  background: #eff6ff;
  border-color: #3b82f6;
  color: #1d4ed8;
  font-weight: 700;
}

.file-tab-badge {
  font-size: 0.62rem;
  font-weight: 700;
  text-transform: uppercase;
  background: #fee2e2;
  color: #991b1b;
  padding: 1px 4px;
  border-radius: 3px;
}

.file-tab-count {
  font-size: 0.7rem;
  background: #e2e8f0;
  color: #475569;
  padding: 1px 5px;
  border-radius: 10px;
}

/* LaTeX Preview Workspace */
.latex-preview-workspace {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 24px;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  background: #cbd5e1;
}

.latex-visual-scroll {
  background: #ffffff;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.15);
  border-radius: 2px;
  width: 210mm;
  min-height: 297mm;
  padding: 25mm;
  box-sizing: border-box;
  font-family: 'Latin Modern Roman', 'Computer Modern', 'Times New Roman', serif;
  font-size: 11pt;
  line-height: 1.45;
  color: #0f172a;
}

.latex-source-scroll {
  width: 100%;
  height: 100%;
  background: #1e293b;
  border-radius: 8px;
  padding: 16px;
  overflow: auto;
  box-sizing: border-box;
}

.latex-source-pre {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.85rem;
  color: #f8fafc;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
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

