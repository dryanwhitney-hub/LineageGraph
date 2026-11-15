<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { open } from '@tauri-apps/plugin-dialog';
import type { DesignCardConfig } from '../../types/design';
import { useAppUpdater } from '../../composables/useAppUpdater';
import { useResearchPortals } from '../../composables/useResearchPortals';
import {
  useDateFormat,
  formatDisplayDate,
  type DateFormatOption,
} from '../../composables/useDateFormat';
import { setAppLocale } from '../../i18n';
import {
  SUPPORTED_LOCALES,
  getLocaleDefinition,
  type SupportedLocale,
} from '../../locales/registry';
import type {
  Person,
  ColumnConfig,
  RootAncestorConfig,
} from '../../composables/usePersons';
import thirdPartyLicensesText from '../../../THIRD_PARTY_LICENSES.txt?raw';

const showThirdPartyLicenses = ref(false);

export type SettingsTab = 'general' | 'trees' | 'storage' | 'table_view' | 'research' | 'about';

export interface DesignConfigState {
  horizontalLaneGap: number;
  autoSubLanes: boolean;
  enableLineBridges: boolean;
  bridgeRadius: number;
  minimizeBridges: boolean;
  cardConfig: DesignCardConfig;
}

interface StorageInfoDto {
  current_data_dir: string;
  default_data_dir: string;
  configured_custom_dir: string | null;
  is_custom: boolean;
  is_network_path: boolean;
  is_fallback_active: boolean;
  storage_warning: string | null;
  trees: string[];
  active_tree: string;
}

interface TargetDirInspectionDto {
  path: string;
  exists: boolean;
  is_writable: boolean;
  is_network_path: boolean;
  existing_trees: string[];
  error: string | null;
}

const props = defineProps<{
  visible: boolean;
  activeTab: SettingsTab;
  trees: string[];
  activeTree: string;
  newTreeName: string;
  columns: ColumnConfig[];
  rootAncestors: RootAncestorConfig[];
  filteredPersons: Person[];
  selectedRootId: string;
  newRootCode: string;
  rootSearchQuery: string;
  designConfig: DesignConfigState;
  getColLabel: (col: ColumnConfig) => string;
  moveColumn: (index: number, direction: 'up' | 'down') => void;
}>();

const emit = defineEmits<{
  close: [];
  'update:activeTab': [tab: SettingsTab];
  'update:activeTree': [tree: string];
  'update:newTreeName': [name: string];
  'update:selectedRootId': [id: string];
  'update:newRootCode': [code: string];
  'update:rootSearchQuery': [query: string];
  'switch-tree': [];
  'start-delete-tree': [];
  'create-tree': [];
  'add-root-ancestor': [];
  'remove-root-ancestor': [personId: string];
  'calculate-codes': [];
  'storage-changed': [];
  'backup-restored': [];
}>();

const { t, locale } = useI18n();
const { dateFormat, setDateFormat } = useDateFormat();

const {
  currentVersion,
  isChecking,
  isDownloading,
  newVersion,
  statusMessage,
  statusType,
  checkForUpdates,
  loadCurrentVersion,
} = useAppUpdater();

// --- Auto-save feedback ---
const showSavedFeedback = ref(false);
let savedFeedbackTimer: ReturnType<typeof setTimeout> | null = null;

function triggerSavedFeedback() {
  showSavedFeedback.value = true;
  if (savedFeedbackTimer) clearTimeout(savedFeedbackTimer);
  savedFeedbackTimer = setTimeout(() => {
    showSavedFeedback.value = false;
  }, 2000);
}

// --- Language ---
const currentLocaleCode = computed(() => getLocaleDefinition(locale.value).code);

function onLanguageChange(event: Event) {
  const code = (event.target as HTMLSelectElement).value as SupportedLocale;
  setAppLocale(code);
  triggerSavedFeedback();
}

function onDateFormatChange(event: Event) {
  setDateFormat((event.target as HTMLSelectElement).value as DateFormatOption);
  triggerSavedFeedback();
}

// --- Startup View ---
type StartupViewOption = 'last' | 'table' | 'tree' | 'design' | 'research';
const startupView = ref<StartupViewOption>('last');

function loadStartupView() {
  try {
    const saved = localStorage.getItem('lineagegraph_startup_view');
    if (saved === 'last' || saved === 'table' || saved === 'tree' || saved === 'design' || saved === 'research') {
      startupView.value = saved;
    }
  } catch {}
}

function onStartupViewChange(event: Event) {
  const val = (event.target as HTMLSelectElement).value as StartupViewOption;
  startupView.value = val;
  try {
    localStorage.setItem('lineagegraph_startup_view', val);
  } catch {}
  triggerSavedFeedback();
}

// --- Peer Display Name (Multi-User Sync) ---
const peerDisplayName = ref<string>('');

function loadPeerDisplayName() {
  try {
    peerDisplayName.value = localStorage.getItem('lineagegraph_peer_display_name') || '';
  } catch {}
}

function onPeerDisplayNameChange() {
  const trimmed = peerDisplayName.value.trim();
  peerDisplayName.value = trimmed;
  try {
    if (trimmed) {
      localStorage.setItem('lineagegraph_peer_display_name', trimmed);
    } else {
      localStorage.removeItem('lineagegraph_peer_display_name');
    }
  } catch {}
  triggerSavedFeedback();
}

// --- Tree Backups & Recovery ---
interface TreeBackupInfoDto {
  filename: string;
  action_type: string;
  created_at_ms: number;
  size_bytes: number;
}

const treeBackups = ref<TreeBackupInfoDto[]>([]);
const isLoadingBackups = ref<boolean>(false);
const isBackupActionRunning = ref<boolean>(false);
const backupFeedback = ref<{ type: 'success' | 'error'; text: string } | null>(null);
const confirmRestoreBackupFilename = ref<string | null>(null);
const confirmDeleteBackupFilename = ref<string | null>(null);
const isBackingUpAll = ref<boolean>(false);
const backupAllFeedback = ref<{ type: 'success' | 'error'; text: string } | null>(null);

async function loadTreeBackups() {
  if (!props.activeTree) {
    treeBackups.value = [];
    return;
  }
  isLoadingBackups.value = true;
  try {
    treeBackups.value = await invoke<TreeBackupInfoDto[]>('list_tree_backups');
  } catch (err) {
    console.warn('Could not load tree backups', err);
  } finally {
    isLoadingBackups.value = false;
  }
}

async function createManualBackup() {
  isBackupActionRunning.value = true;
  backupFeedback.value = null;
  try {
    const filename = await invoke<string>('create_tree_backup');
    backupFeedback.value = {
      type: 'success',
      text: t('settings_backup_created_msg', { file: filename }),
    };
    await loadTreeBackups();
  } catch (err) {
    backupFeedback.value = { type: 'error', text: String(err) };
  } finally {
    isBackupActionRunning.value = false;
  }
}

async function confirmRestoreBackup(filename: string) {
  confirmRestoreBackupFilename.value = null;
  isBackupActionRunning.value = true;
  backupFeedback.value = null;
  try {
    const safetyBackup = await invoke<string>('restore_tree_backup', { filename });
    backupFeedback.value = {
      type: 'success',
      text: t('settings_backup_restored_msg', { file: safetyBackup }),
    };
    await loadTreeBackups();
    emit('backup-restored');
  } catch (err) {
    backupFeedback.value = { type: 'error', text: String(err) };
  } finally {
    isBackupActionRunning.value = false;
  }
}

async function confirmDeleteBackup(filename: string) {
  confirmDeleteBackupFilename.value = null;
  isBackupActionRunning.value = true;
  backupFeedback.value = null;
  try {
    await invoke('delete_tree_backup', { filename });
    await loadTreeBackups();
  } catch (err) {
    backupFeedback.value = { type: 'error', text: String(err) };
  } finally {
    isBackupActionRunning.value = false;
  }
}

async function backupAllDatabasesToFolder() {
  backupAllFeedback.value = null;
  try {
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: storageInfo.value?.current_data_dir || undefined,
    });
    if (typeof selected !== 'string' || !selected.trim()) return;
    isBackingUpAll.value = true;
    const count = await invoke<number>('backup_all_databases', { targetDir: selected });
    backupAllFeedback.value = {
      type: 'success',
      text: t('settings_backup_all_success', { count }),
    };
  } catch (err) {
    backupAllFeedback.value = { type: 'error', text: String(err) };
  } finally {
    isBackingUpAll.value = false;
  }
}

function getBackupTypeLabel(actionType: string): string {
  switch (actionType) {
    case 'manual':
      return t('settings_backup_type_manual');
    case 'pre_restore':
      return t('settings_backup_type_pre_restore');
    case 'pre_merge':
      return t('settings_backup_type_pre_merge');
    case 'pre_delete':
    case 'pre_delete_batch':
      return t('settings_backup_type_pre_delete');
    default:
      return t('settings_backup_type_other');
  }
}

function formatBackupDate(ms: number): string {
  if (!ms) return '';
  return new Date(ms).toLocaleString();
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// --- Probands confirmation & lookup ---
const confirmRemoveProbandId = ref<string | null>(null);
const rootAncestorIdSet = computed(() => new Set(props.rootAncestors.map(r => r.person_id)));

function requestRemoveProband(personId: string) {
  confirmRemoveProbandId.value = personId;
}

function cancelRemoveProband() {
  confirmRemoveProbandId.value = null;
}

function confirmRemoveProband(personId: string) {
  confirmRemoveProbandId.value = null;
  emit('remove-root-ancestor', personId);
}

// --- Table Matrix bulk actions ---
function setAllColumnsVisibility(field: 'visible' | 'detailVisible', value: boolean) {
  for (const col of props.columns) {
    col[field] = value;
  }
  triggerSavedFeedback();
}

function onMatrixMoveColumn(index: number, direction: 'up' | 'down') {
  props.moveColumn(index, direction);
  triggerSavedFeedback();
}

// --- Storage ---
const storageInfo = ref<StorageInfoDto | null>(null);
const targetStoragePath = ref<string>('');
const transferMode = ref<'move' | 'copy' | 'switch'>('move');
const overwriteExistingTrees = ref<boolean>(false);
const storageInspection = ref<TargetDirInspectionDto | null>(null);
const isInspectingStorage = ref<boolean>(false);
const isApplyingStorageChange = ref<boolean>(false);
const storageFeedback = ref<{ type: 'success' | 'error'; text: string } | null>(null);
let inspectDebounceTimer: ReturnType<typeof setTimeout> | null = null;

const showOverwriteWarning = computed(
  () =>
    transferMode.value !== 'switch' &&
    overwriteExistingTrees.value &&
    !!storageInspection.value &&
    storageInspection.value.existing_trees.length > 0
);

async function loadStorageInfo() {
  try {
    storageInfo.value = await invoke<StorageInfoDto>('get_storage_info');
  } catch (err) {
    console.warn('Could not load storage info', err);
  }
}

async function inspectTargetDirectory(pathToInspect: string) {
  const trimmed = pathToInspect.trim();
  if (!trimmed) {
    storageInspection.value = null;
    return;
  }
  isInspectingStorage.value = true;
  try {
    storageInspection.value = await invoke<TargetDirInspectionDto>('inspect_storage_directory', {
      path: trimmed,
    });
  } catch (err) {
    storageInspection.value = {
      path: trimmed,
      exists: false,
      is_writable: false,
      is_network_path: false,
      existing_trees: [],
      error: String(err),
    };
  } finally {
    isInspectingStorage.value = false;
  }
}

watch(
  () => props.visible,
  isVisible => {
    if (isVisible) {
      storageFeedback.value = null;
      backupFeedback.value = null;
      backupAllFeedback.value = null;
      confirmRemoveProbandId.value = null;
      confirmRestoreBackupFilename.value = null;
      confirmDeleteBackupFilename.value = null;
      loadStorageInfo();
      loadTreeBackups();
    }
  }
);

watch(
  () => props.activeTree,
  () => {
    if (props.visible) {
      confirmRestoreBackupFilename.value = null;
      confirmDeleteBackupFilename.value = null;
      loadTreeBackups();
    }
  }
);

watch(targetStoragePath, newVal => {
  storageFeedback.value = null;
  if (inspectDebounceTimer) clearTimeout(inspectDebounceTimer);
  if (!newVal.trim()) {
    storageInspection.value = null;
    return;
  }
  inspectDebounceTimer = setTimeout(() => {
    inspectTargetDirectory(newVal);
  }, 300);
});

async function browseStorageDirectory() {
  try {
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: storageInfo.value?.current_data_dir || undefined,
    });
    if (typeof selected === 'string' && selected.trim()) {
      targetStoragePath.value = selected;
      if (inspectDebounceTimer) clearTimeout(inspectDebounceTimer);
      await inspectTargetDirectory(selected);
    }
  } catch (err) {
    storageFeedback.value = { type: 'error', text: String(err) };
  }
}

async function openStorageFolder() {
  try {
    await invoke('open_storage_directory');
  } catch (err) {
    storageFeedback.value = { type: 'error', text: String(err) };
  }
}

async function applyStorageChange() {
  const target = targetStoragePath.value.trim();
  if (!target) return;
  isApplyingStorageChange.value = true;
  storageFeedback.value = null;
  try {
    const updated = await invoke<StorageInfoDto>('change_storage_directory', {
      newPath: target,
      transferMode: transferMode.value,
      overwriteExisting: overwriteExistingTrees.value,
    });
    storageInfo.value = updated;
    storageFeedback.value = {
      type: 'success',
      text: t('storage_change_success', { path: updated.current_data_dir }),
    };
    emit('storage-changed');
  } catch (err) {
    storageFeedback.value = {
      type: 'error',
      text: t('storage_change_error', { error: String(err) }),
    };
  } finally {
    isApplyingStorageChange.value = false;
  }
}

async function resetToDefaultStorage() {
  isApplyingStorageChange.value = true;
  storageFeedback.value = null;
  try {
    const updated = await invoke<StorageInfoDto>('change_storage_directory', {
      newPath: null,
      transferMode: transferMode.value,
      overwriteExisting: overwriteExistingTrees.value,
    });
    storageInfo.value = updated;
    targetStoragePath.value = '';
    storageInspection.value = null;
    storageFeedback.value = {
      type: 'success',
      text: t('storage_reset_success', { path: updated.current_data_dir }),
    };
    emit('storage-changed');
  } catch (err) {
    storageFeedback.value = {
      type: 'error',
      text: t('storage_change_error', { error: String(err) }),
    };
  } finally {
    isApplyingStorageChange.value = false;
  }
}

async function reconnectConfiguredStorage() {
  const customDir = storageInfo.value?.configured_custom_dir;
  if (!customDir) return;
  isApplyingStorageChange.value = true;
  storageFeedback.value = null;
  try {
    const updated = await invoke<StorageInfoDto>('change_storage_directory', {
      newPath: customDir,
      transferMode: 'switch',
      overwriteExisting: false,
    });
    storageInfo.value = updated;
    storageFeedback.value = {
      type: 'success',
      text: t('storage_change_success', { path: updated.current_data_dir }),
    };
    emit('storage-changed');
  } catch (err) {
    storageFeedback.value = {
      type: 'error',
      text: t('storage_change_error', { error: String(err) }),
    };
  } finally {
    isApplyingStorageChange.value = false;
  }
}

// --- Research Assistant & Portals ---
const researchMaxAge = ref<number>(110);
const researchChildGap = ref<number>(3.5);
const portalSearchQuery = ref<string>('');
const portalAccessFilter = ref<'all' | 'free' | 'free_registration' | 'freemium' | 'subscription'>('all');

const {
  portals: researchPortals,
  togglePortal,
  resetToDefaults: resetResearchPortals,
} = useResearchPortals();

const enabledPortalsCount = computed(
  () => researchPortals.value.filter(p => p.enabled).length
);

const filteredResearchPortals = computed(() => {
  const q = portalSearchQuery.value.trim().toLowerCase();
  return researchPortals.value.filter(p => {
    if (portalAccessFilter.value !== 'all' && p.access_type !== portalAccessFilter.value) {
      return false;
    }
    if (!q) return true;
    const desc = locale.value.startsWith('de')
      ? p.description_de || p.description_en || ''
      : p.description_en || p.description_de || '';
    return (
      p.name.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q) ||
      desc.toLowerCase().includes(q)
    );
  });
});

function loadResearchSettings() {
  try {
    const raw = localStorage.getItem('lineagegraph_research_settings');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.max_age_years === 'number') {
        researchMaxAge.value = Math.min(130, Math.max(70, parsed.max_age_years));
      }
      if (typeof parsed.child_gap_years === 'number') {
        researchChildGap.value = Math.min(10, Math.max(1.5, parsed.child_gap_years));
      }
    }
  } catch (e) {
    console.warn('Could not read research settings', e);
  }
}

function updateResearchSettings() {
  const rawMaxAge = Number(researchMaxAge.value);
  const clampedMaxAge = Number.isFinite(rawMaxAge)
    ? Math.min(130, Math.max(70, Math.round(rawMaxAge)))
    : 110;
  researchMaxAge.value = clampedMaxAge;

  const rawChildGap = Number(researchChildGap.value);
  const clampedChildGap = Number.isFinite(rawChildGap)
    ? Math.min(10, Math.max(1.5, Math.round(rawChildGap * 2) / 2))
    : 3.5;
  researchChildGap.value = clampedChildGap;

  try {
    let current: Record<string, unknown> = {};
    const raw = localStorage.getItem('lineagegraph_research_settings');
    if (raw) {
      try {
        current = JSON.parse(raw);
      } catch {}
    }
    current.max_age_years = clampedMaxAge;
    current.child_gap_years = clampedChildGap;
    localStorage.setItem('lineagegraph_research_settings', JSON.stringify(current));
    triggerSavedFeedback();
  } catch (e) {
    console.warn('Could not save research settings', e);
  }
}

function onTogglePortal(portalId: string) {
  togglePortal(portalId);
  triggerSavedFeedback();
}

function onResetResearchPortals() {
  resetResearchPortals();
  triggerSavedFeedback();
}

function getAccessTypeLabel(type: string): string {
  switch (type) {
    case 'free':
      return t('research.accessFree', '🟢 Kostenlos');
    case 'free_registration':
      return t('research.accessFreeReg', '🟡 Kostenlos (Konto)');
    case 'subscription':
      return t('research.accessSubscription', '🔴 Abo erforderlich');
    case 'freemium':
      return t('research.accessFreemium', '🔵 Freemium');
    default:
      return type;
  }
}

async function openExternalUrl(url: string) {
  try {
    await openUrl(url);
  } catch {
    if (url.startsWith('mailto:')) {
      window.location.href = url;
    } else {
      window.open(url, '_blank');
    }
  }
}

async function openUserGuide() {
  try {
    await invoke('open_user_guide');
  } catch {
    await openExternalUrl('https://github.com/dryanwhitney-hub/LineageGraph/blob/main/USER_GUIDE.md');
  }
}

function onTreeSelectChange(event: Event) {
  const val = (event.target as HTMLSelectElement).value;
  emit('update:activeTree', val);
  emit('switch-tree');
}

// --- Keyboard Escape handling ---
function handleKeydown(event: KeyboardEvent) {
  if (!props.visible) return;
  if (event.key === 'Escape') {
    if (confirmRemoveProbandId.value) {
      confirmRemoveProbandId.value = null;
      return;
    }
    if (confirmRestoreBackupFilename.value) {
      confirmRestoreBackupFilename.value = null;
      return;
    }
    if (confirmDeleteBackupFilename.value) {
      confirmDeleteBackupFilename.value = null;
      return;
    }
    emit('close');
  }
}

onMounted(() => {
  loadCurrentVersion();
  loadResearchSettings();
  loadStartupView();
  loadPeerDisplayName();
  loadStorageInfo();
  loadTreeBackups();
  window.addEventListener('keydown', handleKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown);
  if (savedFeedbackTimer) clearTimeout(savedFeedbackTimer);
  if (inspectDebounceTimer) clearTimeout(inspectDebounceTimer);
});
</script>

<template>
  <div v-if="visible" class="modal-overlay" @click.self="emit('close')">
    <div
      class="modal-content settings-modal-content settings-layout-split"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
    >
      <div class="settings-modal-header-row">
        <h2 id="settings-modal-title">⚙️ {{ t('settings') }}</h2>
        <button
          type="button"
          class="btn-close-icon"
          @click="emit('close')"
          :aria-label="t('close')"
          :title="t('close')"
        >
          ✕
        </button>
      </div>

      <div class="settings-split-body">
        <!-- Linke Navigationsleiste -->
        <nav class="settings-nav-sidebar" role="tablist" aria-orientation="vertical">
          <button
            type="button"
            role="tab"
            :aria-selected="activeTab === 'general'"
            class="settings-nav-item"
            :class="{ active: activeTab === 'general' }"
            @click="emit('update:activeTab', 'general')"
          >
            🌐 {{ t('settings_tab_general') }}
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="activeTab === 'trees'"
            class="settings-nav-item"
            :class="{ active: activeTab === 'trees' }"
            @click="emit('update:activeTab', 'trees')"
          >
            🌳 {{ t('settings_tab_trees') }}
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="activeTab === 'storage'"
            class="settings-nav-item"
            :class="{ active: activeTab === 'storage' }"
            @click="emit('update:activeTab', 'storage')"
          >
            💾 {{ t('settings_tab_storage') }}
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="activeTab === 'table_view'"
            class="settings-nav-item"
            :class="{ active: activeTab === 'table_view' }"
            @click="emit('update:activeTab', 'table_view')"
          >
            📋 {{ t('settings_tab_table') }}
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="activeTab === 'research'"
            class="settings-nav-item"
            :class="{ active: activeTab === 'research' }"
            @click="emit('update:activeTab', 'research')"
          >
            🔬 {{ t('settings_tab_research') }}
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="activeTab === 'about'"
            class="settings-nav-item settings-nav-item-bottom"
            :class="{ active: activeTab === 'about' }"
            @click="emit('update:activeTab', 'about')"
          >
            ℹ️ {{ t('settings_tab_about') }}
          </button>
        </nav>

        <!-- Rechter Inhaltsbereich -->
        <div class="settings-main-pane" role="tabpanel">
          <!-- 1. Allgemein (App-weit: Sprache & Datumsformat) -->
          <div v-if="activeTab === 'general'" class="settings-tab-pane">
            <div class="settings-section">
              <h3>🌐 {{ t('settings_language_section_title') }}</h3>
              <p class="section-desc">{{ t('settings_language_section_desc') }}</p>
              <label for="settings-language-select" class="field-label">
                {{ t('settings_language_label') }}:
              </label>
              <select
                id="settings-language-select"
                :value="currentLocaleCode"
                @change="onLanguageChange"
                class="w-100"
              >
                <option
                  v-for="loc in SUPPORTED_LOCALES"
                  :key="loc.code"
                  :value="loc.code"
                >
                  {{ loc.endonym }} ({{ loc.code.toUpperCase() }})
                </option>
              </select>
            </div>

            <div class="settings-section">
              <h3>📅 {{ t('date_format_section_title') }}</h3>
              <p class="section-desc">{{ t('date_format_section_desc') }}</p>
              <label for="settings-date-format-select" class="field-label">
                {{ t('date_format_label') }}:
              </label>
              <select
                id="settings-date-format-select"
                :value="dateFormat"
                @change="onDateFormatChange"
                class="w-100"
              >
                <option value="locale">{{ t('date_format_opt_locale') }}</option>
                <option value="dd.mm.yyyy">{{ t('date_format_opt_dd_mm_yyyy') }}</option>
                <option value="yyyy-mm-dd">{{ t('date_format_opt_yyyy_mm_dd') }}</option>
                <option value="dd/mm/yyyy">{{ t('date_format_opt_dd_slash_mm_yyyy') }}</option>
                <option value="mm/dd/yyyy">{{ t('date_format_opt_mm_slash_dd_yyyy') }}</option>
                <option value="dd_mmm_yyyy">{{ t('date_format_opt_dd_mmm_yyyy') }}</option>
                <option value="gedcom">{{ t('date_format_opt_gedcom') }}</option>
              </select>
              <div class="date-format-preview">
                <strong>{{ t('date_format_preview_label') }}</strong>
                {{ formatDisplayDate('15 MAY 1950') }} ·
                {{ formatDisplayDate('BEF 1890') }} ·
                {{ formatDisplayDate('ABT 03 DEC 1875') }}
              </div>
              <p class="section-hint">{{ t('date_format_input_hint') }}</p>
            </div>

            <div class="settings-section">
              <h3>🚀 {{ t('settings_startup_view_title') }}</h3>
              <p class="section-desc">{{ t('settings_startup_view_desc') }}</p>
              <label for="settings-startup-view-select" class="field-label">
                {{ t('settings_startup_view_label') }}:
              </label>
              <select
                id="settings-startup-view-select"
                :value="startupView"
                @change="onStartupViewChange"
                class="w-100"
              >
                <option value="last">{{ t('settings_startup_view_last') }}</option>
                <option value="table">📋 {{ t('view_table') }}</option>
                <option value="tree">🌳 {{ t('view_tree') }}</option>
                <option value="design">🎨 {{ t('view_design') }}</option>
                <option value="research">🔬 {{ t('view_research') }}</option>
              </select>
            </div>
          </div>

          <!-- 2. Stammbaum & Probanden (baumbezogen) -->
          <div v-if="activeTab === 'trees'" class="settings-tab-pane">
            <div v-if="activeTree" class="scope-banner">
              🌳 {{ t('settings_trees_scope_badge', { name: activeTree }) }}
            </div>

            <div class="settings-section">
              <h3>{{ t('tree_management') }}</h3>
              <label class="field-label">{{ t('active_tree') }}:</label>
              <div v-if="trees.length > 0 && activeTree" class="d-flex align-items-center mb-2">
                <select :value="activeTree" @change="onTreeSelectChange" class="flex-grow">
                  <option v-for="tree in trees" :key="tree" :value="tree">{{ tree }}</option>
                </select>
                <button
                  type="button"
                  class="btn-danger btn-delete-tree"
                  @click="emit('start-delete-tree')"
                  :title="t('delete_tree')"
                >
                  🗑️ {{ t('delete_tree') }}
                </button>
              </div>
              <div v-else class="no-active-tree mb-2">
                {{ t('no_active_tree') }}
              </div>

              <label class="field-label">{{ t('new_tree') }}:</label>
              <div class="d-flex">
                <input
                  :value="newTreeName"
                  @input="emit('update:newTreeName', ($event.target as HTMLInputElement).value)"
                  :placeholder="t('new_tree_placeholder')"
                  class="flex-grow"
                />
                <button type="button" @click="emit('create-tree')">{{ t('create_btn') }}</button>
              </div>
            </div>

            <div class="settings-section">
              <h3>{{ t('root_ancestor_config') }}</h3>
              <div class="proband-list-box mb-2">
                <label class="field-label">{{ t('proband_list') }}:</label>
                <ul v-if="rootAncestors.length > 0" class="proband-list">
                  <li v-for="r in rootAncestors" :key="r.person_id">
                    <span class="proband-info">
                      [{{ r.starting_code }}] {{ r.surname || 'N.N.' }}, {{ r.given_name || 'N.N.' }}
                      <small>({{ r.person_id }})</small>
                    </span>
                    <div v-if="confirmRemoveProbandId === r.person_id" class="inline-confirm-group">
                      <span class="inline-confirm-text">{{ t('settings_confirm_remove_proband') }}</span>
                      <button
                        type="button"
                        class="btn-sm btn-danger"
                        @click="confirmRemoveProband(r.person_id)"
                      >
                        {{ t('settings_confirm_yes') }}
                      </button>
                      <button
                        type="button"
                        class="btn-sm btn-secondary-inline"
                        @click="cancelRemoveProband"
                      >
                        {{ t('settings_confirm_cancel') }}
                      </button>
                    </div>
                    <button
                      v-else
                      type="button"
                      class="btn-sm btn-danger"
                      @click="requestRemoveProband(r.person_id)"
                    >
                      {{ t('remove') }}
                    </button>
                  </li>
                </ul>
                <div v-else class="sub-empty">{{ t('no_probands') }}</div>
              </div>

              <div class="proband-search-header">
                <label class="field-label">{{ t('add_proband') }}:</label>
                <span class="search-count-pill">
                  {{ t('settings_proband_search_count', { count: filteredPersons.length }) }}
                </span>
              </div>
              <input
                :value="rootSearchQuery"
                @input="emit('update:rootSearchQuery', ($event.target as HTMLInputElement).value)"
                :placeholder="t('search_placeholder')"
                class="w-100 mb-2"
              />
              <select
                :value="selectedRootId"
                @change="emit('update:selectedRootId', ($event.target as HTMLSelectElement).value)"
                class="w-100 mb-2"
                size="4"
              >
                <option
                  v-for="p in filteredPersons"
                  :key="p.id"
                  :value="p.id"
                  :disabled="rootAncestorIdSet.has(p.id)"
                >
                  {{ rootAncestorIdSet.has(p.id) ? '✓ ' : '' }}{{ p.surname || 'N.N.' }}, {{ p.given_name || 'N.N.' }} ({{ p.id }}){{ rootAncestorIdSet.has(p.id) ? ' — ' + t('settings_proband_already_added') : '' }}
                </option>
              </select>
              <div class="d-flex align-items-center">
                <input
                  :value="newRootCode"
                  @input="emit('update:newRootCode', ($event.target as HTMLInputElement).value)"
                  :placeholder="t('starting_code')"
                  class="flex-grow"
                />
                <button
                  type="button"
                  @click="emit('add-root-ancestor')"
                  :disabled="!selectedRootId || !newRootCode"
                >
                  {{ t('add_btn') }}
                </button>
              </div>
              <button
                type="button"
                class="mt-2 btn-full btn-calculate"
                @click="emit('calculate-codes')"
                :disabled="rootAncestors.length === 0"
              >
                {{ t('calc_codes_btn') }}
              </button>
              <small class="auto-calc-hint">✨ {{ t('settings_auto_calc_hint') }}</small>
              <small class="auto-calc-hint">🎨 {{ t('settings_design_studio_hint') }}</small>
            </div>

            <div v-if="activeTree" class="settings-section">
              <div class="backup-section-header">
                <div>
                  <h3>🛡️ {{ t('settings_backup_section_title') }}</h3>
                  <p class="section-desc">{{ t('settings_backup_section_desc') }}</p>
                </div>
                <button
                  type="button"
                  :disabled="isBackupActionRunning"
                  @click="createManualBackup"
                >
                  💾 {{ t('settings_backup_create_btn') }}
                </button>
              </div>

              <div
                v-if="backupFeedback"
                class="storage-feedback-banner mb-2"
                :class="backupFeedback.type === 'success' ? 'feedback-ok' : 'feedback-err'"
              >
                {{ backupFeedback.text }}
              </div>

              <div v-if="isLoadingBackups" class="sub-empty">⏳ ...</div>
              <ul v-else-if="treeBackups.length > 0" class="backup-list">
                <li v-for="b in treeBackups" :key="b.filename" class="backup-list-item">
                  <div class="backup-item-meta">
                    <div class="backup-item-top">
                      <span class="backup-type-pill" :class="'type-' + b.action_type">
                        {{ getBackupTypeLabel(b.action_type) }}
                      </span>
                      <span class="backup-date-text">{{ formatBackupDate(b.created_at_ms) }}</span>
                      <span class="backup-size-text">{{ formatFileSize(b.size_bytes) }}</span>
                    </div>
                    <code class="backup-filename-code">{{ b.filename }}</code>
                  </div>

                  <div v-if="confirmRestoreBackupFilename === b.filename" class="inline-confirm-group">
                    <span class="inline-confirm-text">{{ t('settings_backup_confirm_restore') }}</span>
                    <button
                      type="button"
                      class="btn-sm btn-calculate"
                      :disabled="isBackupActionRunning"
                      @click="confirmRestoreBackup(b.filename)"
                    >
                      {{ t('settings_confirm_yes') }}
                    </button>
                    <button
                      type="button"
                      class="btn-sm btn-secondary-inline"
                      @click="confirmRestoreBackupFilename = null"
                    >
                      {{ t('settings_confirm_cancel') }}
                    </button>
                  </div>
                  <div v-else-if="confirmDeleteBackupFilename === b.filename" class="inline-confirm-group">
                    <span class="inline-confirm-text">{{ t('settings_backup_confirm_delete') }}</span>
                    <button
                      type="button"
                      class="btn-sm btn-danger"
                      :disabled="isBackupActionRunning"
                      @click="confirmDeleteBackup(b.filename)"
                    >
                      {{ t('settings_confirm_yes') }}
                    </button>
                    <button
                      type="button"
                      class="btn-sm btn-secondary-inline"
                      @click="confirmDeleteBackupFilename = null"
                    >
                      {{ t('settings_confirm_cancel') }}
                    </button>
                  </div>
                  <div v-else class="backup-item-actions">
                    <button
                      type="button"
                      class="btn-sm"
                      :disabled="isBackupActionRunning"
                      @click="confirmRestoreBackupFilename = b.filename"
                    >
                      ↺ {{ t('settings_backup_restore_btn') }}
                    </button>
                    <button
                      type="button"
                      class="btn-sm btn-danger"
                      :disabled="isBackupActionRunning"
                      @click="confirmDeleteBackupFilename = b.filename"
                      :title="t('delete_btn')"
                    >
                      🗑️
                    </button>
                  </div>
                </li>
              </ul>
              <div v-else class="sub-empty">{{ t('settings_backup_empty') }}</div>
            </div>
          </div>

          <!-- 3. Speicherort & Daten -->
          <div v-if="activeTab === 'storage'" class="settings-tab-pane">
            <div class="settings-section storage-settings-section">
              <h3>💾 {{ t('storage_section_title') }}</h3>
              <p class="section-desc">{{ t('storage_section_desc') }}</p>

              <div v-if="storageInfo" class="storage-status-card">
                <div class="storage-status-header">
                  <span class="storage-status-label">{{ t('storage_current_dir_label') }}</span>
                  <div class="storage-badges">
                    <span v-if="!storageInfo.is_custom" class="storage-badge badge-default">
                      💻 {{ t('storage_badge_default') }}
                    </span>
                    <span v-else-if="storageInfo.is_network_path" class="storage-badge badge-network">
                      🌐 {{ t('storage_badge_network') }}
                    </span>
                    <span v-else class="storage-badge badge-custom">
                      📂 {{ t('storage_badge_custom') }}
                    </span>
                  </div>
                </div>
                <div class="storage-path-row">
                  <code class="storage-path-box" :title="storageInfo.current_data_dir">
                    {{ storageInfo.current_data_dir }}
                  </code>
                  <button
                    type="button"
                    class="btn-secondary-sm"
                    @click="openStorageFolder"
                    :title="t('storage_open_folder')"
                  >
                    📂 {{ t('storage_open_folder') }}
                  </button>
                </div>
              </div>

              <div v-if="storageInfo?.storage_warning" class="storage-warning-banner">
                <div class="storage-warning-text">
                  ⚠️ {{ storageInfo.storage_warning }}
                </div>
                <button
                  v-if="storageInfo.configured_custom_dir"
                  type="button"
                  class="btn-sm btn-reconnect"
                  :disabled="isApplyingStorageChange"
                  @click="reconnectConfiguredStorage"
                >
                  🔄 {{ t('storage_reconnect_btn') }}
                </button>
              </div>

              <div class="storage-target-block">
                <label class="field-label">{{ t('storage_new_dir_label') }}:</label>
                <div class="d-flex">
                  <input
                    v-model="targetStoragePath"
                    :placeholder="t('storage_new_dir_placeholder')"
                    class="flex-grow"
                  />
                  <button
                    type="button"
                    class="btn-browse-dir"
                    @click="browseStorageDirectory"
                  >
                    📁 {{ t('storage_browse_btn') }}
                  </button>
                </div>

                <div v-if="isInspectingStorage" class="storage-inspect-hint">
                  ⏳ {{ t('storage_inspecting') }}
                </div>
                <div v-else-if="storageInspection" class="storage-inspect-box">
                  <div
                    class="storage-inspect-line"
                    :class="storageInspection.is_writable ? 'text-ok' : 'text-err'"
                  >
                    <span v-if="storageInspection.is_writable">
                      ✅ {{ t('storage_inspect_writable') }}
                    </span>
                    <span v-else>
                      ❌ {{ storageInspection.error || t('storage_inspect_not_writable') }}
                    </span>
                  </div>
                  <div v-if="storageInspection.is_network_path" class="storage-inspect-line text-net">
                    🌐 {{ t('storage_inspect_network_notice') }}
                  </div>
                  <div
                    v-if="storageInspection.existing_trees.length > 0"
                    class="storage-inspect-line text-info"
                  >
                    📊 {{
                      t('storage_inspect_existing_trees', {
                        count: storageInspection.existing_trees.length,
                        trees: storageInspection.existing_trees.join(', '),
                      })
                    }}
                  </div>
                </div>
              </div>

              <div class="storage-mode-group">
                <label class="field-label">{{ t('storage_transfer_mode_label') }}:</label>
                <label class="storage-radio-option">
                  <input type="radio" v-model="transferMode" value="move" />
                  <div>
                    <strong>📦 {{ t('storage_mode_move') }}</strong>
                    <div class="storage-radio-desc">{{ t('storage_mode_move_desc') }}</div>
                  </div>
                </label>
                <label class="storage-radio-option">
                  <input type="radio" v-model="transferMode" value="copy" />
                  <div>
                    <strong>📋 {{ t('storage_mode_copy') }}</strong>
                    <div class="storage-radio-desc">{{ t('storage_mode_copy_desc') }}</div>
                  </div>
                </label>
                <label class="storage-radio-option">
                  <input type="radio" v-model="transferMode" value="switch" />
                  <div>
                    <strong>🔗 {{ t('storage_mode_switch') }}</strong>
                    <div class="storage-radio-desc">{{ t('storage_mode_switch_desc') }}</div>
                  </div>
                </label>
              </div>

              <label
                v-if="transferMode !== 'switch' && storageInspection && storageInspection.existing_trees.length > 0"
                class="storage-overwrite-check"
              >
                <input type="checkbox" v-model="overwriteExistingTrees" />
                <span>{{ t('storage_overwrite_existing') }}</span>
              </label>

              <div v-if="showOverwriteWarning" class="storage-warning-banner">
                ⚠️ {{ t('settings_storage_overwrite_warning') }}
              </div>

              <div class="storage-actions-row">
                <button
                  type="button"
                  :disabled="
                    !targetStoragePath.trim() ||
                    isApplyingStorageChange ||
                    (storageInspection !== null && !storageInspection.is_writable)
                  "
                  @click="applyStorageChange"
                >
                  💾 {{ t('storage_apply_btn') }}
                </button>
                <button
                  v-if="storageInfo && (storageInfo.is_custom || storageInfo.configured_custom_dir)"
                  type="button"
                  class="btn-reset-storage"
                  :disabled="isApplyingStorageChange"
                  @click="resetToDefaultStorage"
                >
                  ↺ {{ t('storage_reset_btn') }}
                </button>
              </div>

              <div
                v-if="storageFeedback"
                class="storage-feedback-banner"
                :class="storageFeedback.type === 'success' ? 'feedback-ok' : 'feedback-err'"
              >
                {{ storageFeedback.text }}
              </div>
            </div>

            <div class="settings-section">
              <h3>📦 {{ t('settings_backup_all_title') }}</h3>
              <p class="section-desc">{{ t('settings_backup_all_desc') }}</p>
              <button
                type="button"
                :disabled="isBackingUpAll"
                @click="backupAllDatabasesToFolder"
              >
                📁 {{ t('settings_backup_all_btn') }}
              </button>
              <div
                v-if="backupAllFeedback"
                class="storage-feedback-banner"
                :class="backupAllFeedback.type === 'success' ? 'feedback-ok' : 'feedback-err'"
              >
                {{ backupAllFeedback.text }}
              </div>
            </div>

            <div
              v-if="storageInfo && (storageInfo.is_custom || storageInfo.is_network_path)"
              class="settings-section"
            >
              <h3>👥 {{ t('settings_peer_name_title') }}</h3>
              <p class="section-desc">{{ t('settings_peer_name_desc') }}</p>
              <input
                v-model="peerDisplayName"
                @change="onPeerDisplayNameChange"
                :placeholder="t('settings_peer_name_placeholder')"
                class="w-100"
                maxlength="48"
              />
            </div>
          </div>

          <!-- 4. Tabellarische Ansicht (Spalten-Matrix) -->
          <div v-if="activeTab === 'table_view'" class="settings-tab-pane">
            <div class="settings-section matrix-section">
              <div class="matrix-header-block">
                <h3>📋 {{ t('settings_matrix_title') }}</h3>
                <p class="matrix-subtitle">{{ t('settings_matrix_subtitle') }}</p>
              </div>

              <div class="matrix-table-wrap">
                <table class="settings-matrix-table">
                  <thead>
                    <tr>
                      <th>{{ t('settings_matrix_col_attr') }}</th>
                      <th class="center-col">
                        <div class="matrix-th-stack">
                          <span>
                            {{ t('settings_matrix_col_table') }}
                            <span class="matrix-count-pill">{{ columns.filter(c => c.visible).length }}/{{ columns.length }}</span>
                          </span>
                          <span class="matrix-bulk-actions">
                            <button
                              type="button"
                              class="btn-matrix-bulk"
                              @click="setAllColumnsVisibility('visible', true)"
                            >
                              {{ t('settings_matrix_select_all') }}
                            </button>
                            <button
                              type="button"
                              class="btn-matrix-bulk"
                              @click="setAllColumnsVisibility('visible', false)"
                            >
                              {{ t('settings_matrix_select_none') }}
                            </button>
                          </span>
                        </div>
                      </th>
                      <th class="center-col">
                        <div class="matrix-th-stack">
                          <span>
                            {{ t('settings_matrix_col_details') }}
                            <span class="matrix-count-pill">{{ columns.filter(c => c.detailVisible).length }}/{{ columns.length }}</span>
                          </span>
                          <span class="matrix-bulk-actions">
                            <button
                              type="button"
                              class="btn-matrix-bulk"
                              @click="setAllColumnsVisibility('detailVisible', true)"
                            >
                              {{ t('settings_matrix_select_all') }}
                            </button>
                            <button
                              type="button"
                              class="btn-matrix-bulk"
                              @click="setAllColumnsVisibility('detailVisible', false)"
                            >
                              {{ t('settings_matrix_select_none') }}
                            </button>
                          </span>
                        </div>
                      </th>
                      <th class="center-col matrix-order-col">{{ t('settings_matrix_col_order') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(col, index) in columns" :key="'mat-' + col.key">
                      <td class="attr-name-cell">
                        <strong>{{ getColLabel(col) }}</strong>
                        <small v-if="!col.editable" class="readonly-hint">({{ t('readonly') || 'schreibgeschützt' }})</small>
                      </td>
                      <td class="center-col">
                        <input
                          type="checkbox"
                          v-model="col.visible"
                          @change="triggerSavedFeedback"
                          class="matrix-checkbox"
                          :aria-label="getColLabel(col) + ' — ' + t('settings_matrix_col_table')"
                        />
                      </td>
                      <td class="center-col">
                        <input
                          type="checkbox"
                          v-model="col.detailVisible"
                          @change="triggerSavedFeedback"
                          class="matrix-checkbox"
                          :aria-label="getColLabel(col) + ' — ' + t('settings_matrix_col_details')"
                        />
                      </td>
                      <td class="center-col">
                        <div class="matrix-order-btns">
                          <button
                            type="button"
                            class="btn-matrix-order"
                            @click.stop="onMatrixMoveColumn(index, 'up')"
                            :disabled="index === 0"
                            :title="t('settings_matrix_move_up')"
                            :aria-label="getColLabel(col) + ': ' + t('settings_matrix_move_up')"
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            class="btn-matrix-order"
                            @click.stop="onMatrixMoveColumn(index, 'down')"
                            :disabled="index === columns.length - 1"
                            :title="t('settings_matrix_move_down')"
                            :aria-label="getColLabel(col) + ': ' + t('settings_matrix_move_down')"
                          >
                            ▼
                          </button>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <!-- 5. Forschungsassistent Einstellungen -->
          <div v-if="activeTab === 'research'" class="settings-tab-pane">
            <div class="settings-section">
              <h3>🔬 {{ t('research.settingsTitle', 'Forschungsassistent & Heuristiken') }}</h3>
              <p class="section-desc">
                {{ t('research.settingsDesc', 'Konfiguriere die Schwellenwerte für die automatische Erkennung von genealogischen Lücken.') }}
              </p>

              <div class="research-form-group">
                <label for="research-max-age" class="field-label">
                  {{ t('research.maxAgeLabel', 'Maximales Alter für vermuteten Tod (Jahre)') }}:
                </label>
                <div class="research-input-row">
                  <input
                    id="research-max-age"
                    type="number"
                    min="70"
                    max="130"
                    v-model.number="researchMaxAge"
                    @change="updateResearchSettings"
                    class="research-number-input"
                  />
                  <span class="research-input-hint">
                    {{ t('research.maxAgeHint', 'Liegt die Geburt länger zurück und fehlt das Sterbedatum, wird eine Lücke gemeldet (Standard: 110 Jahre).') }}
                  </span>
                </div>
              </div>

              <div class="research-form-group">
                <label for="research-child-gap" class="field-label">
                  {{ t('research.childGapLabel', 'Mindestabstand für Kinderlücke (Jahre)') }}:
                </label>
                <div class="research-input-row">
                  <input
                    id="research-child-gap"
                    type="number"
                    step="0.5"
                    min="1.5"
                    max="10.0"
                    v-model.number="researchChildGap"
                    @change="updateResearchSettings"
                    class="research-number-input"
                  />
                  <span class="research-input-hint">
                    {{ t('research.childGapHint', 'Spannen zwischen Geschwistern ab diesem Schwellenwert werden als auffällige Kinderlücke gelistet (Standard: 3.5 Jahre).') }}
                  </span>
                </div>
              </div>

              <hr class="section-divider" />

              <!-- Konfigurierbare Recherche-Portale & Bibliotheken -->
              <div class="portals-config-section">
                <div class="portals-header-row">
                  <div>
                    <h4 class="portals-title">
                      <span>🌐</span>
                      {{ t('research.portalsSectionTitle', 'Genealogische Archive & Recherche-Portale') }}
                      <span class="matrix-count-pill">{{ enabledPortalsCount }}/{{ researchPortals.length }}</span>
                    </h4>
                    <p class="section-desc">
                      {{ t('research.portalsSectionDesc', 'Wähle aus, welche Archive im Forschungsassistenten zur 1-Klick-Recherche eingebunden werden sollen. Deaktiviere Portale, für die du kein Abonnement besitzt.') }}
                    </p>
                  </div>
                  <button
                    type="button"
                    class="btn-reset-portals"
                    @click="onResetResearchPortals"
                    :title="t('research.resetPortalsTitle', 'Auf Standardauswahl zurücksetzen')"
                  >
                    ↺ {{ t('research.resetPortals', 'Standard') }}
                  </button>
                </div>

                <div class="portals-toolbar">
                  <input
                    v-model="portalSearchQuery"
                    type="search"
                    :placeholder="t('settings_portals_search_placeholder')"
                    class="portals-search-input"
                  />
                  <div class="portals-filter-pills" role="group">
                    <button
                      type="button"
                      class="filter-pill"
                      :class="{ active: portalAccessFilter === 'all' }"
                      @click="portalAccessFilter = 'all'"
                    >
                      {{ t('settings_portals_filter_all') }}
                    </button>
                    <button
                      type="button"
                      class="filter-pill"
                      :class="{ active: portalAccessFilter === 'free' }"
                      @click="portalAccessFilter = 'free'"
                    >
                      {{ t('settings_portals_filter_free') }}
                    </button>
                    <button
                      type="button"
                      class="filter-pill"
                      :class="{ active: portalAccessFilter === 'free_registration' }"
                      @click="portalAccessFilter = 'free_registration'"
                    >
                      {{ t('settings_portals_filter_free_reg') }}
                    </button>
                    <button
                      type="button"
                      class="filter-pill"
                      :class="{ active: portalAccessFilter === 'freemium' }"
                      @click="portalAccessFilter = 'freemium'"
                    >
                      {{ t('settings_portals_filter_freemium') }}
                    </button>
                    <button
                      type="button"
                      class="filter-pill"
                      :class="{ active: portalAccessFilter === 'subscription' }"
                      @click="portalAccessFilter = 'subscription'"
                    >
                      {{ t('settings_portals_filter_subscription') }}
                    </button>
                  </div>
                </div>

                <div v-if="filteredResearchPortals.length > 0" class="portals-list-grid">
                  <label
                    v-for="portal in filteredResearchPortals"
                    :key="portal.id"
                    class="portal-setting-card"
                    :class="{ 'is-enabled': portal.enabled }"
                  >
                    <div class="portal-card-header">
                      <div class="portal-header-left">
                        <input
                          type="checkbox"
                          :checked="portal.enabled"
                          @change="onTogglePortal(portal.id)"
                          class="portal-checkbox"
                        />
                        <span class="portal-icon">{{ portal.icon || '🌐' }}</span>
                        <strong class="portal-name">{{ portal.name }}</strong>
                      </div>
                      <span
                        class="portal-access-badge"
                        :class="'badge-' + portal.access_type"
                      >
                        {{ getAccessTypeLabel(portal.access_type) }}
                      </span>
                    </div>

                    <div class="portal-category-text">{{ portal.category }}</div>
                    <p class="portal-desc-text">
                      {{ locale.startsWith('de') ? (portal.description_de || portal.description_en) : (portal.description_en || portal.description_de) }}
                    </p>
                  </label>
                </div>
                <div v-else class="portals-empty-state">
                  {{ t('settings_portals_empty_filter') }}
                </div>
              </div>
            </div>
          </div>

          <!-- 6. Über LineageGraph & App-Aktualisierung -->
          <div v-if="activeTab === 'about'" class="settings-tab-pane about-tab-pane">
            <div class="about-container">
              <div class="about-hero">
                <img src="/icon_dark.png" alt="LineageGraph Logo" class="about-logo" />
                <div class="about-hero-info">
                  <h3 class="about-app-title">LineageGraph</h3>
                  <p class="about-app-subtitle">{{ t('about_app_subtitle') }}</p>
                  <span class="about-version-badge">v{{ currentVersion || '0.2.2' }}</span>
                </div>
              </div>

              <div class="about-info-grid">
                <div class="about-info-card about-dev-card">
                  <span class="about-info-label">{{ t('about_developer_contact') }}</span>
                  <span class="about-info-value font-bold">{{ t('about_developer_name') }}</span>
                  <a
                    href="mailto:lineagegraph@gmail.com"
                    class="about-contact-link"
                    @click.prevent="openExternalUrl('mailto:lineagegraph@gmail.com')"
                    :title="t('about_contact_tooltip')"
                  >
                    ✉️ {{ t('about_contact_email') }}
                  </a>
                </div>

                <div class="about-info-card">
                  <span class="about-info-label">{{ t('about_technology') }}</span>
                  <span class="about-info-value">{{ t('about_tech_stack') }}</span>
                </div>

                <div class="about-info-card">
                  <span class="about-info-label">{{ t('about_license') }}</span>
                  <span class="about-info-value">{{ t('about_license_name') }}</span>
                </div>

                <div class="about-info-card">
                  <span class="about-info-label">{{ t('about_storage_privacy') }}</span>
                  <span class="about-info-value">{{ t('about_storage_privacy_desc') }}</span>
                </div>
              </div>

              <div class="about-links-row">
                <button
                  type="button"
                  class="btn-about-link btn-about-guide"
                  @click="openUserGuide"
                  :title="t('about_link_guide_tooltip')"
                >
                  📖 {{ t('about_link_guide') }}
                </button>
                <a
                  href="https://github.com/dryanwhitney-hub/LineageGraph"
                  class="btn-about-link"
                  @click.prevent="openExternalUrl('https://github.com/dryanwhitney-hub/LineageGraph')"
                  :title="t('about_link_repo_tooltip')"
                >
                  🐙 {{ t('about_link_repo') }}
                </a>
                <a
                  href="https://github.com/dryanwhitney-hub/LineageGraph/issues"
                  class="btn-about-link"
                  @click.prevent="openExternalUrl('https://github.com/dryanwhitney-hub/LineageGraph/issues')"
                  :title="t('about_link_issues_tooltip')"
                >
                  🐛 {{ t('about_link_issues') }}
                </a>
                <button
                  type="button"
                  class="btn-about-link"
                  @click="showThirdPartyLicenses = !showThirdPartyLicenses"
                >
                  📜 {{ showThirdPartyLicenses ? t('about_third_party_licenses_hide') : t('about_third_party_licenses_btn') }}
                </button>
              </div>

              <div v-if="showThirdPartyLicenses" class="about-licenses-box">
                <div class="about-licenses-header">
                  <span>{{ t('about_third_party_licenses_title') }}</span>
                  <button
                    type="button"
                    class="about-licenses-close"
                    @click="showThirdPartyLicenses = false"
                    :aria-label="t('about_third_party_licenses_hide')"
                  >
                    ✕
                  </button>
                </div>
                <pre class="about-licenses-pre">{{ thirdPartyLicensesText }}</pre>
              </div>

              <div class="about-update-card">
                <div class="about-update-header">
                  <div class="about-update-text">
                    <h4>🔄 {{ t('about_updates_title') }}</h4>
                    <p class="about-update-hint">
                      {{ t('updater_current_version') }}: <strong>v{{ currentVersion || '0.2.2' }}</strong>
                    </p>
                  </div>
                  <button
                    type="button"
                    class="btn-updater-check"
                    :disabled="isChecking || isDownloading"
                    @click="checkForUpdates(true)"
                  >
                    <span v-if="isChecking">⏳ {{ t('updater_checking') }}</span>
                    <span v-else>🔍 {{ t('updater_check_btn') }}</span>
                  </button>
                </div>

                <div v-if="statusType === 'up-to-date'" class="updater-feedback success">
                  ✅ {{ t('updater_up_to_date') }}
                </div>
                <div v-else-if="statusType === 'offline'" class="updater-feedback warning">
                  ⚠️ {{ t('updater_offline') }}
                </div>
                <div v-else-if="statusType === 'update-available'" class="updater-feedback info">
                  🚀 {{ t('updater_modal_desc', { version: newVersion }) }}
                </div>
                <div
                  v-else-if="statusType === 'error'"
                  class="updater-feedback"
                  :class="statusMessage === 'no_release_manifest' ? 'info' : 'error'"
                >
                  <span v-if="statusMessage === 'no_release_manifest'">
                    ℹ️ {{ t('updater_error_no_release') }}
                  </span>
                  <span v-else>
                    ❌ {{ t('updater_error', { error: statusMessage }) }}
                  </span>
                </div>
              </div>

              <div class="about-footer-meta">
                <p class="about-copyright">{{ t('about_copyright') }}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="settings-footer-row">
        <div class="settings-footer-status">
          <span v-if="showSavedFeedback" class="saved-feedback-pill">
            {{ t('settings_saved_feedback') }}
          </span>
          <span v-else class="auto-save-hint-text">
            {{ t('settings_auto_save_hint') }}
          </span>
        </div>
        <button type="button" class="btn-close" @click="emit('close')">
          {{ t('close') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(15, 23, 42, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: #ffffff;
  border-radius: 10px;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.22);
}

.settings-modal-content.settings-layout-split {
  width: 92vw;
  max-width: 900px;
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
}

.settings-modal-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 20px;
  background: #f8fafc;
  border-bottom: 1px solid #cbd5e1;
}

.settings-modal-header-row h2 {
  margin: 0;
  font-size: 1.15rem;
  color: #0f172a;
}

.btn-close-icon {
  background: none;
  border: none;
  font-size: 1.15rem;
  color: #64748b;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
}

.btn-close-icon:hover {
  background: #e2e8f0;
  color: #0f172a;
}

.settings-split-body {
  display: flex;
  flex-grow: 1;
  min-height: 440px;
  overflow: hidden;
}

.settings-nav-sidebar {
  width: 230px;
  background: #f1f5f9;
  border-right: 1px solid #cbd5e1;
  display: flex;
  flex-direction: column;
  padding: 10px 8px;
  gap: 4px;
  flex-shrink: 0;
}

.settings-nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: #334155;
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
  transition: all 0.15s ease;
}

.settings-nav-item:hover {
  background: #e2e8f0;
  color: #0f172a;
}

.settings-nav-item.active {
  background: #ffffff;
  color: #2563eb;
  border-color: #cbd5e1;
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.06);
}

.settings-nav-item-bottom {
  margin-top: auto;
  border-top: 1px solid #cbd5e1;
  padding-top: 12px;
}

.settings-main-pane {
  flex-grow: 1;
  padding: 20px;
  overflow-y: auto;
  background: #ffffff;
}

.settings-footer-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  background: #f8fafc;
  border-top: 1px solid #cbd5e1;
}

.settings-footer-status {
  display: flex;
  align-items: center;
  min-height: 24px;
}

.auto-save-hint-text {
  font-size: 0.8rem;
  color: #64748b;
}

.saved-feedback-pill {
  display: inline-flex;
  align-items: center;
  font-size: 0.78rem;
  font-weight: 600;
  color: #15803d;
  background: #dcfce7;
  border: 1px solid #bbf7d0;
  padding: 2px 10px;
  border-radius: 12px;
}

/* Shared form & section styles */
.settings-section {
  margin-top: 1.25rem;
  background: #f8fafc;
  padding: 1rem 1.1rem;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
}

.settings-section:first-child {
  margin-top: 0;
}

.settings-section h3 {
  margin: 0 0 8px 0;
  font-size: 1rem;
  color: #0f172a;
}

.section-desc {
  margin: 0 0 12px 0;
  font-size: 0.83rem;
  color: #475569;
  line-height: 1.45;
}

.section-hint {
  margin: 8px 0 0 0;
  font-size: 0.78rem;
  color: #64748b;
  line-height: 1.4;
}

.section-divider {
  border: 0;
  border-top: 1px solid #e2e8f0;
  margin: 22px 0;
}

.field-label {
  display: block;
  font-size: 0.82rem;
  font-weight: 600;
  color: #1e293b;
  margin-bottom: 5px;
}

.w-100 {
  width: 100%;
  padding: 0.45rem 0.55rem;
  border: 1px solid #cbd5e1;
  border-radius: 5px;
  box-sizing: border-box;
  font-size: 0.88rem;
  background: #ffffff;
  color: #0f172a;
}

.mt-2 {
  margin-top: 0.75rem;
}

.mb-2 {
  margin-bottom: 0.65rem;
}

.d-flex {
  display: flex;
  gap: 0.5rem;
}

.align-items-center {
  align-items: center;
}

.flex-grow {
  flex-grow: 1;
  padding: 0.45rem 0.55rem;
  border: 1px solid #cbd5e1;
  border-radius: 5px;
  font-size: 0.88rem;
  background: #ffffff;
  color: #0f172a;
}

button {
  padding: 0.48rem 0.95rem;
  background-color: #2563eb;
  color: #ffffff;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  font-weight: 600;
  font-size: 0.84rem;
  transition: background-color 0.15s ease;
}

button:hover:not(:disabled) {
  background-color: #1d4ed8;
}

button:disabled {
  background-color: #94a3b8;
  cursor: not-allowed;
}

.btn-close {
  background-color: #475569;
  color: #ffffff;
  padding: 0.48rem 1.25rem;
}

.btn-close:hover:not(:disabled) {
  background-color: #334155;
}

.btn-full {
  width: 100%;
}

.btn-calculate {
  background-color: #d97706;
}

.btn-calculate:hover:not(:disabled) {
  background-color: #b45309;
}

.btn-sm {
  padding: 0.25rem 0.6rem;
  font-size: 0.75rem;
}

.btn-danger {
  background-color: #dc2626;
}

.btn-danger:hover:not(:disabled) {
  background-color: #b91c1c;
}

.btn-secondary-inline {
  background-color: #e2e8f0;
  color: #334155;
}

.btn-secondary-inline:hover:not(:disabled) {
  background-color: #cbd5e1;
  color: #0f172a;
}

.btn-delete-tree {
  white-space: nowrap;
}

/* Date Format Preview */
.date-format-preview {
  margin-top: 8px;
  padding: 6px 10px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 5px;
  font-size: 0.84rem;
  color: #334155;
}

/* Trees & Probands */
.scope-banner {
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  color: #1e40af;
  font-size: 0.84rem;
  font-weight: 600;
  padding: 8px 12px;
  border-radius: 6px;
  margin-bottom: 14px;
}

.proband-list-box {
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 0.6rem 0.75rem;
  max-height: 170px;
  overflow-y: auto;
  width: 100%;
  box-sizing: border-box;
}

.proband-list {
  list-style: none;
  padding: 0;
  margin: 0.35rem 0 0 0;
}

.proband-list li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 0.4rem 0;
  border-bottom: 1px solid #f1f5f9;
  font-size: 0.84rem;
  color: #1e293b;
}

.proband-list li:last-child {
  border-bottom: none;
}

.proband-info {
  flex-grow: 1;
}

.inline-confirm-group {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}

.inline-confirm-text {
  font-size: 0.75rem;
  font-weight: 600;
  color: #b91c1c;
}

.proband-search-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.proband-search-header .field-label {
  margin-bottom: 0;
}

.search-count-pill {
  font-size: 0.72rem;
  font-weight: 600;
  color: #475569;
  background: #e2e8f0;
  padding: 1px 8px;
  border-radius: 10px;
}

.sub-empty {
  color: #64748b;
  font-size: 0.82rem;
  font-style: italic;
  padding: 4px 0;
}

.no-active-tree {
  padding: 0.5rem 0.75rem;
  background: #f1f5f9;
  color: #64748b;
  border: 1px dashed #cbd5e1;
  border-radius: 5px;
  font-style: italic;
  font-size: 0.88rem;
}

.auto-calc-hint {
  display: block;
  margin-top: 6px;
  font-size: 0.77rem;
  color: #64748b;
  line-height: 1.35;
}

/* Table View Matrix */
.matrix-section {
  padding: 16px;
}

.matrix-header-block h3 {
  margin: 0 0 4px 0;
  color: #0f172a;
}

.matrix-subtitle {
  margin: 0 0 12px 0;
  font-size: 0.82rem;
  color: #64748b;
}

.matrix-table-wrap {
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  overflow: hidden;
}

.settings-matrix-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.settings-matrix-table th {
  background: #f1f5f9;
  color: #334155;
  font-weight: 700;
  font-size: 0.76rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding: 9px 12px;
  border-bottom: 1px solid #cbd5e1;
  text-align: left;
}

.settings-matrix-table td {
  padding: 7px 12px;
  border-bottom: 1px solid #f1f5f9;
  color: #1e293b;
}

.settings-matrix-table tr:last-child td {
  border-bottom: none;
}

.settings-matrix-table tr:hover td {
  background: #f8fafc;
}

.center-col {
  text-align: center !important;
}

.matrix-order-col {
  width: 90px;
}

.matrix-th-stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.matrix-bulk-actions {
  display: inline-flex;
  gap: 4px;
}

.btn-matrix-bulk {
  background: #ffffff;
  color: #475569;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: none;
  letter-spacing: 0;
}

.btn-matrix-bulk:hover:not(:disabled) {
  background: #e2e8f0;
  color: #0f172a;
}

.matrix-count-pill {
  display: inline-block;
  background: #dbeafe;
  color: #1d4ed8;
  font-size: 0.7rem;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 10px;
  margin-left: 4px;
}

.readonly-hint {
  color: #64748b;
  margin-left: 4px;
  font-style: italic;
}

.matrix-checkbox {
  width: 16px;
  height: 16px;
  accent-color: #2563eb;
  cursor: pointer;
}

.matrix-order-btns {
  display: inline-flex;
  gap: 4px;
}

.btn-matrix-order {
  background: #f1f5f9;
  color: #475569;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  padding: 2px 7px;
  font-size: 0.68rem;
  cursor: pointer;
}

.btn-matrix-order:hover:not(:disabled) {
  background: #2563eb;
  border-color: #1d4ed8;
  color: #ffffff;
}

.btn-matrix-order:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  background: #f1f5f9;
}

/* Research Tab */
.research-form-group {
  margin-bottom: 18px;
}

.research-input-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.research-number-input {
  width: 120px;
  padding: 0.45rem 0.55rem;
  border: 1px solid #cbd5e1;
  border-radius: 5px;
  font-size: 0.88rem;
  background: #ffffff;
  color: #0f172a;
}

.research-input-hint {
  flex: 1;
  min-width: 200px;
  font-size: 0.81rem;
  color: #64748b;
  line-height: 1.35;
}

.portals-header-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 10px;
}

.portals-title {
  margin: 0 0 6px 0;
  color: #0f172a;
  font-size: 0.98rem;
  display: flex;
  align-items: center;
  gap: 6px;
}

.btn-reset-portals {
  padding: 4px 10px;
  font-size: 0.78rem;
  background: #ffffff;
  color: #475569;
  border: 1px solid #cbd5e1;
  border-radius: 5px;
  cursor: pointer;
  font-weight: 600;
  white-space: nowrap;
}

.btn-reset-portals:hover {
  background: #e2e8f0;
  color: #0f172a;
}

.portals-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.portals-search-input {
  flex: 1;
  min-width: 180px;
  padding: 0.4rem 0.6rem;
  border: 1px solid #cbd5e1;
  border-radius: 5px;
  font-size: 0.84rem;
  background: #ffffff;
  color: #0f172a;
}

.portals-filter-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.filter-pill {
  padding: 4px 9px;
  font-size: 0.75rem;
  font-weight: 600;
  background: #ffffff;
  color: #475569;
  border: 1px solid #cbd5e1;
  border-radius: 14px;
}

.filter-pill:hover {
  background: #e2e8f0;
  color: #0f172a;
}

.filter-pill.active {
  background: #2563eb;
  color: #ffffff;
  border-color: #1d4ed8;
}

.portals-list-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
}

.portal-setting-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 10px 12px;
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
  display: flex;
  flex-direction: column;
}

.portal-setting-card:hover {
  border-color: #94a3b8;
  background: #f8fafc;
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.04);
}

.portal-setting-card.is-enabled {
  border-color: #3b82f6;
  background: #f0f7ff;
}

.portal-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.portal-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.portal-checkbox {
  cursor: pointer;
  accent-color: #2563eb;
}

.portal-icon {
  font-size: 1.05rem;
}

.portal-name {
  font-size: 0.88rem;
  color: #1e293b;
}

.portal-access-badge {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 10px;
  white-space: nowrap;
}

.badge-free {
  background: #dcfce7;
  color: #15803d;
}

.badge-free_registration {
  background: #fef9c3;
  color: #854d0e;
}

.badge-subscription {
  background: #fee2e2;
  color: #b91c1c;
}

.badge-freemium {
  background: #e0f2fe;
  color: #0369a1;
}

.portal-category-text {
  font-size: 0.73rem;
  font-weight: 600;
  color: #64748b;
  margin-left: 26px;
  margin-bottom: 4px;
}

.portal-desc-text {
  font-size: 0.76rem;
  color: #475569;
  line-height: 1.35;
  margin: 0 0 0 26px;
}

.portals-empty-state {
  padding: 18px;
  text-align: center;
  color: #64748b;
  font-size: 0.84rem;
  background: #ffffff;
  border: 1px dashed #cbd5e1;
  border-radius: 6px;
}

/* About Tab */
.about-tab-pane {
  display: flex;
  flex-direction: column;
}

.about-container {
  display: flex;
  flex-direction: column;
  gap: 1.35rem;
  max-width: 600px;
  margin: 0 auto;
  width: 100%;
  padding: 6px 0;
}

.about-hero {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  background: linear-gradient(135deg, #f8fafc 0%, #edf2f7 100%);
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 1.35rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.about-logo {
  width: 76px;
  height: 76px;
  border-radius: 16px;
  object-fit: cover;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22);
  background: #1a1d22;
  border: 1px solid #334155;
}

.about-hero-info {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.about-app-title {
  margin: 0;
  font-size: 1.45rem;
  color: #0f172a;
  font-weight: 700;
}

.about-app-subtitle {
  margin: 0;
  font-size: 0.92rem;
  color: #64748b;
}

.about-version-badge {
  display: inline-block;
  align-self: flex-start;
  background: #dbeafe;
  color: #1d4ed8;
  font-family: monospace;
  font-weight: 700;
  font-size: 0.84rem;
  padding: 0.2rem 0.6rem;
  border-radius: 4px;
}

.about-info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 1rem;
}

.about-info-card {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.about-info-label {
  font-size: 0.74rem;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
}

.about-info-value {
  font-size: 0.92rem;
  color: #1e293b;
}

.about-contact-link {
  color: #2563eb;
  text-decoration: none;
  font-weight: 600;
  font-size: 0.86rem;
  word-break: break-all;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}

.about-contact-link:hover {
  color: #1d4ed8;
  text-decoration: underline;
}

.font-bold {
  font-weight: 600;
}

.about-dev-card {
  border-left: 3px solid #2563eb;
}

.about-links-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.btn-about-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0.45rem 0.85rem;
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  color: #334155;
  font-size: 0.82rem;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-about-link:hover {
  background: #e2e8f0;
  color: #0f172a;
  border-color: #94a3b8;
}

.btn-about-guide {
  background: #eff6ff;
  color: #1d4ed8;
  border-color: #bfdbfe;
}

.btn-about-guide:hover {
  background: #dbeafe;
  color: #1e40af;
  border-color: #93c5fd;
}

.about-footer-meta {
  text-align: center;
  padding-top: 0.25rem;
}

.about-copyright {
  margin: 0;
  font-size: 0.78rem;
  color: #64748b;
  line-height: 1.4;
}

.about-licenses-box {
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #f8fafc;
  overflow: hidden;
}

.about-licenses-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  background: #e2e8f0;
  color: #1e293b;
  font-size: 0.8rem;
  font-weight: 600;
}

.about-licenses-close {
  border: none;
  background: transparent;
  color: #475569;
  cursor: pointer;
  font-size: 0.9rem;
  line-height: 1;
  padding: 0.15rem 0.35rem;
  border-radius: 4px;
}

.about-licenses-close:hover {
  background: #cbd5e1;
  color: #0f172a;
}

.about-licenses-pre {
  margin: 0;
  padding: 0.75rem;
  max-height: 260px;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.72rem;
  line-height: 1.45;
  color: #334155;
  white-space: pre-wrap;
  word-break: break-word;
}

.about-update-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 1.15rem;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.03);
}

.about-update-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.about-update-text h4 {
  margin: 0;
  font-size: 1.02rem;
  color: #1e293b;
}

.about-update-hint {
  margin: 0.25rem 0 0 0;
  font-size: 0.84rem;
  color: #64748b;
}

.btn-updater-check {
  padding: 0.45rem 1rem;
  background: #2563eb;
  color: #ffffff;
  border: none;
  border-radius: 5px;
  font-weight: 600;
  font-size: 0.84rem;
  cursor: pointer;
}

.btn-updater-check:hover:not(:disabled) {
  background: #1d4ed8;
}

.updater-feedback {
  margin-top: 0.75rem;
  padding: 0.6rem 0.8rem;
  border-radius: 6px;
  font-size: 0.84rem;
  line-height: 1.4;
}

.updater-feedback.success {
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  color: #166534;
}

.updater-feedback.warning {
  background: #fffbeb;
  border: 1px solid #fde68a;
  color: #92400e;
}

.updater-feedback.info {
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  color: #1e40af;
}

.updater-feedback.error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
}

/* Storage Settings */
.storage-status-card {
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 12px;
}

.storage-status-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}

.storage-status-label {
  font-size: 0.78rem;
  font-weight: 700;
  color: #334155;
}

.storage-badges {
  display: flex;
  gap: 6px;
}

.storage-badge {
  font-size: 0.72rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
}

.badge-default {
  background: #e2e8f0;
  color: #334155;
}

.badge-custom {
  background: #dbeafe;
  color: #1d4ed8;
}

.badge-network {
  background: #dcfce7;
  color: #15803d;
}

.storage-path-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.storage-path-box {
  flex: 1;
  min-width: 0;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  padding: 5px 8px;
  font-size: 0.78rem;
  color: #0f172a;
  overflow-x: auto;
  white-space: nowrap;
}

.btn-secondary-sm {
  background: #f1f5f9;
  color: #334155;
  border: 1px solid #cbd5e1;
  padding: 5px 10px;
  font-size: 0.78rem;
  white-space: nowrap;
}

.btn-secondary-sm:hover:not(:disabled) {
  background: #e2e8f0;
  color: #0f172a;
}

.storage-warning-banner {
  background: #fffbeb;
  border: 1px solid #fde68a;
  color: #92400e;
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 0.8rem;
}

.btn-reconnect {
  background: #d97706;
  white-space: nowrap;
}

.btn-reconnect:hover:not(:disabled) {
  background: #b45309;
}

.storage-target-block {
  margin-bottom: 12px;
}

.btn-browse-dir {
  background: #475569;
  white-space: nowrap;
}

.btn-browse-dir:hover:not(:disabled) {
  background: #334155;
}

.storage-inspect-hint {
  margin-top: 6px;
  font-size: 0.78rem;
  color: #64748b;
}

.storage-inspect-box {
  margin-top: 6px;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 5px;
  padding: 7px 10px;
  font-size: 0.78rem;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.storage-inspect-line.text-ok {
  color: #15803d;
  font-weight: 600;
}

.storage-inspect-line.text-err {
  color: #b91c1c;
  font-weight: 600;
}

.storage-inspect-line.text-net {
  color: #0369a1;
}

.storage-inspect-line.text-info {
  color: #334155;
}

.storage-mode-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
}

.storage-radio-option {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 5px;
  padding: 7px 10px;
  cursor: pointer;
  font-size: 0.8rem;
  color: #1e293b;
}

.storage-radio-option:hover {
  border-color: #94a3b8;
}

.storage-radio-option input {
  margin-top: 2px;
}

.storage-radio-desc {
  font-size: 0.75rem;
  color: #64748b;
  margin-top: 2px;
}

.storage-overwrite-check {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 0.8rem;
  color: #334155;
  margin-bottom: 10px;
  cursor: pointer;
}

.storage-actions-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.btn-reset-storage {
  background: #64748b;
}

.btn-reset-storage:hover:not(:disabled) {
  background: #475569;
}

.storage-feedback-banner {
  margin-top: 10px;
  padding: 7px 10px;
  border-radius: 5px;
  font-size: 0.8rem;
}

.storage-feedback-banner.feedback-ok {
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  color: #166534;
}

.storage-feedback-banner.feedback-err {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
}

/* Backup & Recovery */
.backup-section-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 10px;
}

.backup-section-header .section-desc {
  margin-bottom: 0;
}

.backup-section-header button {
  white-space: nowrap;
  flex-shrink: 0;
}

.backup-list {
  list-style: none;
  padding: 0;
  margin: 0;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  max-height: 220px;
  overflow-y: auto;
}

.backup-list-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-bottom: 1px solid #f1f5f9;
}

.backup-list-item:last-child {
  border-bottom: none;
}

.backup-item-meta {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.backup-item-top {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.backup-type-pill {
  font-size: 0.68rem;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 10px;
  background: #e2e8f0;
  color: #334155;
}

.backup-type-pill.type-manual {
  background: #dbeafe;
  color: #1d4ed8;
}

.backup-type-pill.type-pre_restore {
  background: #fef3c7;
  color: #92400e;
}

.backup-type-pill.type-pre_merge {
  background: #e0f2fe;
  color: #0369a1;
}

.backup-type-pill.type-pre_delete,
.backup-type-pill.type-pre_delete_batch {
  background: #fee2e2;
  color: #b91c1c;
}

.backup-date-text {
  font-size: 0.78rem;
  font-weight: 600;
  color: #1e293b;
}

.backup-size-text {
  font-size: 0.74rem;
  color: #64748b;
}

.backup-filename-code {
  font-size: 0.72rem;
  color: #64748b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.backup-item-actions {
  display: inline-flex;
  gap: 5px;
  flex-shrink: 0;
}

@media (max-width: 680px) {
  .settings-split-body {
    flex-direction: column;
  }

  .settings-nav-sidebar {
    width: 100%;
    flex-direction: row;
    overflow-x: auto;
    border-right: none;
    border-bottom: 1px solid #cbd5e1;
    padding: 8px;
    gap: 6px;
  }

  .settings-nav-item {
    white-space: nowrap;
    padding: 7px 10px;
  }

  .settings-nav-item-bottom {
    margin-top: 0;
    border-top: none;
    padding-top: 7px;
  }
}
</style>
