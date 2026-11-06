import { ref, computed, nextTick, type Ref, type ComputedRef } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import {
  DEFAULT_BACKGROUND_CONFIG,
  type DesignCardConfig,
  type DesignBackgroundConfig,
} from '../types/design';
import type { RootAncestorConfig } from './useDesignLayout';

export interface DesignSiblingGroup {
  id: string;
  parentId: string | null;
  generation: number;
  level: number; // 1 = unterste Ebene (Ursprung/Stammahn), aufsteigend nach oben
  x: number; // Horizontale Mittelposition auf dem Canvas
  memberIds: string[];
  isUngrouped?: boolean; // true wenn Geschwistergruppe in Einzeleinträge aufgelöst wurde
}

export interface BranchWidthConstraint {
  personId: string;
  minX: number;
  maxX: number;
}

export interface HistorySnapshot {
  siblingGroups: DesignSiblingGroup[];
  totalLevels: number;
  levelHeights: Record<number, number>;
  branchWidths: { personId: string; minX: number; maxX: number }[];
  expandedParentIds: string[];
}

export interface DesignPersistedState {
  version: number;
  probandId: string;
  probandName?: string;
  name: string;
  savedAt: string;
  totalLevels: number;
  levelHeights: Record<number, number>;
  siblingGroups: DesignSiblingGroup[];
  branchWidths: { personId: string; minX: number; maxX: number }[];
  expandedParentIds: string[];
  pan?: { x: number; y: number };
  zoom?: number;
  backgroundConfig?: DesignBackgroundConfig | null;
  backgroundImageData?: string | null;
  cardConfig?: DesignCardConfig;
  horizontalLaneGap?: number;
  autoSubLanes?: boolean;
  enableLineBridges?: boolean;
  bridgeRadius?: number;
  minimizeBridges?: boolean;
}

export interface DesignLayoutEntry {
  id: string;
  proband_id: string;
  name: string;
  created_at: string;
  layout_data: string;
}

export interface UseDesignHistoryOptions<TPerson extends { given_name: string | null; surname: string | null }> {
  t: (key: string, named?: Record<string, unknown>) => string;
  siblingGroups: Ref<DesignSiblingGroup[]>;
  totalLevels: Ref<number>;
  levelHeights: Ref<Record<number, number>>;
  branchWidths: Ref<Map<string, BranchWidthConstraint>>;
  expandedParentIds: Ref<Set<string>>;
  activeDesignPersonId: Ref<string>;
  pan: Ref<{ x: number; y: number }>;
  zoom: Ref<number>;
  bgImageData: Ref<string | null>;
  bgConfig: Ref<DesignBackgroundConfig>;
  activeCardConfig: ComputedRef<DesignCardConfig>;
  personById: ComputedRef<Map<string, TPerson>>;
  getProps: () => {
    personsLength: number;
    activeProbandId: string | null;
    rootAncestors?: RootAncestorConfig[];
    horizontalLaneGap?: number;
    autoSubLanes?: boolean;
    enableLineBridges?: boolean;
    bridgeRadius?: number;
    minimizeBridges?: boolean;
  };
  onBuildInitialDesignLayout: () => void;
  onCenterOnOrigin: () => void;
  onSelectProband: (probandId: string) => void;
  onUpdateCardConfig: (cfg: DesignCardConfig) => void;
  onUpdateDesignConfig: (cfg: {
    cardConfig?: DesignCardConfig;
    horizontalLaneGap?: number;
    autoSubLanes?: boolean;
    enableLineBridges?: boolean;
    bridgeRadius?: number;
    minimizeBridges?: boolean;
  }) => void;
  saveProbandBg: (
    probandId: string | null | undefined,
    dataUrl: string,
    config: DesignBackgroundConfig
  ) => void;
  deleteProbandBg: (probandId: string | null | undefined) => void;
}

export function useDesignHistory<
  TPerson extends { given_name: string | null; surname: string | null }
>(options: UseDesignHistoryOptions<TPerson>) {
  const {
    t,
    siblingGroups,
    totalLevels,
    levelHeights,
    branchWidths,
    expandedParentIds,
    activeDesignPersonId,
    pan,
    zoom,
    bgImageData,
    bgConfig,
    activeCardConfig,
    personById,
    getProps,
    onBuildInitialDesignLayout,
    onCenterOnOrigin,
    onSelectProband,
    onUpdateCardConfig,
    onUpdateDesignConfig,
    saveProbandBg,
    deleteProbandBg,
  } = options;

  // ----------------------------------------------------
  // Undo / Redo Funktionalität (Aktionen im Design-Mode zurücksetzen / wiederherstellen)
  // ----------------------------------------------------
  const historyStack = ref<HistorySnapshot[]>([]);
  const redoStack = ref<HistorySnapshot[]>([]);
  const maxHistoryLength = 50;

  let preDragSnapshot: HistorySnapshot | null = null;

  function captureCurrentSnapshot(): HistorySnapshot {
    const bws: { personId: string; minX: number; maxX: number }[] = [];
    branchWidths.value.forEach((v, k) => {
      bws.push({ personId: k, minX: v.minX, maxX: v.maxX });
    });
    return {
      siblingGroups: JSON.parse(JSON.stringify(siblingGroups.value)),
      totalLevels: totalLevels.value,
      levelHeights: { ...levelHeights.value },
      branchWidths: bws,
      expandedParentIds: Array.from(expandedParentIds.value),
    };
  }

  function restoreSnapshot(snap: HistorySnapshot) {
    totalLevels.value = snap.totalLevels;
    levelHeights.value = { ...snap.levelHeights };
    siblingGroups.value = JSON.parse(JSON.stringify(snap.siblingGroups));
    const bwMap = new Map<string, BranchWidthConstraint>();
    snap.branchWidths.forEach(bw => {
      if (bw.personId) bwMap.set(bw.personId, bw);
    });
    branchWidths.value = bwMap;
    expandedParentIds.value = new Set(snap.expandedParentIds);
    activeDesignPersonId.value = '';
  }

  function pushHistorySnapshot(snapshot: HistorySnapshot) {
    historyStack.value.push(snapshot);
    if (historyStack.value.length > maxHistoryLength) {
      historyStack.value.shift();
    }
    redoStack.value = [];
  }

  function pushHistoryState() {
    pushHistorySnapshot(captureCurrentSnapshot());
  }

  const takeSnapshot = pushHistoryState;

  function beginDragSnapshot() {
    preDragSnapshot = captureCurrentSnapshot();
  }

  function commitDragSnapshot(didMove: boolean) {
    if (didMove && preDragSnapshot) {
      pushHistorySnapshot(preDragSnapshot);
    }
    preDragSnapshot = null;
  }

  const canUndo = computed(() => historyStack.value.length > 0);
  const canRedo = computed(() => redoStack.value.length > 0);

  function undoLastAction() {
    if (historyStack.value.length === 0) return;
    const prev = historyStack.value.pop();
    if (!prev) return;
    redoStack.value.push(captureCurrentSnapshot());
    restoreSnapshot(prev);
  }

  function redoLastAction() {
    if (redoStack.value.length === 0) return;
    const next = redoStack.value.pop();
    if (!next) return;
    historyStack.value.push(captureCurrentSnapshot());
    restoreSnapshot(next);
  }

  const undo = undoLastAction;
  const redo = redoLastAction;

  function onGlobalKeyDown(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    ) {
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
      if (canUndo.value) {
        e.preventDefault();
        undoLastAction();
      }
    } else if (
      (e.ctrlKey || e.metaKey) &&
      (e.key === 'y' || e.key === 'Y' || ((e.key === 'z' || e.key === 'Z') && e.shiftKey))
    ) {
      if (canRedo.value) {
        e.preventDefault();
        redoLastAction();
      }
    }
  }

  // ----------------------------------------------------
  // Speichern & Laden von Design-Zuständen (DB & Datei)
  // ----------------------------------------------------
  const showSaveModal = ref(false);
  const saveFileName = ref('');
  const saveFeedbackMessage = ref('');
  const isSaving = ref(false);
  const existingPresets = ref<DesignLayoutEntry[]>([]);
  const saveMode = ref<'new' | 'overwrite'>('new');
  const selectedOverwriteId = ref('');
  const isInitialOffer = ref(false);
  const currentLayoutId = ref<string | null>(null);
  const currentLayoutName = ref<string>('');
  const autoLoadToast = ref<string>('');
  const isApplyingLoadedState = ref(false);
  let isCheckingLayout = false;

  const showNewDesignModal = ref(false);
  const newDesignProbandId = ref('');
  const newDesignFileName = ref('');
  const skipAutoLoadOnce = ref(false);
  const hasUnsavedChanges = computed<boolean>(() => historyStack.value.length > 0);

  const showLoadModal = ref(false);
  const savedLayoutsList = ref<DesignLayoutEntry[]>([]);
  const isLoadingLayouts = ref(false);
  const loadFeedbackMessage = ref('');
  const fileInputRef = ref<HTMLInputElement | null>(null);

  const activeProbandName = computed(() => {
    const { activeProbandId } = getProps();
    if (!activeProbandId) return '';
    const p = personById.value.get(activeProbandId);
    return p ? `${p.given_name || 'N.N.'} ${p.surname || ''}`.trim() : activeProbandId;
  });

  const matchingExistingPreset = computed(() => {
    const nm = saveFileName.value.trim().toLowerCase();
    if (!nm) return null;
    return existingPresets.value.find(p => p.name.trim().toLowerCase() === nm) || null;
  });

  const isMatchingExistingName = computed(() => Boolean(matchingExistingPreset.value));

  function onSelectOverwritePreset() {
    const p = existingPresets.value.find(x => x.id === selectedOverwriteId.value);
    if (p) {
      saveFileName.value = p.name;
    }
  }

  function onSaveModeChange(mode: 'new' | 'overwrite') {
    saveMode.value = mode;
    if (mode === 'overwrite') {
      if (!selectedOverwriteId.value && existingPresets.value.length > 0) {
        selectedOverwriteId.value = existingPresets.value[0].id;
        saveFileName.value = existingPresets.value[0].name;
      }
    }
  }

  function getSerializedDesignState(name: string): DesignPersistedState {
    const bws: { personId: string; minX: number; maxX: number }[] = [];
    branchWidths.value.forEach((v, k) => {
      bws.push({ personId: k, minX: v.minX, maxX: v.maxX });
    });

    const p = getProps();
    return {
      version: 2,
      probandId: p.activeProbandId || '',
      probandName: activeProbandName.value,
      name: name.trim() || 'Design',
      savedAt: new Date().toISOString(),
      totalLevels: totalLevels.value,
      levelHeights: { ...levelHeights.value },
      siblingGroups: JSON.parse(JSON.stringify(siblingGroups.value)),
      branchWidths: bws,
      expandedParentIds: Array.from(expandedParentIds.value),
      pan: { ...pan.value },
      zoom: zoom.value,
      backgroundConfig: bgImageData.value ? { ...bgConfig.value } : null,
      backgroundImageData: bgImageData.value || null,
      cardConfig: { ...activeCardConfig.value },
      horizontalLaneGap: p.horizontalLaneGap,
      autoSubLanes: p.autoSubLanes,
      enableLineBridges: p.enableLineBridges,
      bridgeRadius: p.bridgeRadius,
      minimizeBridges: p.minimizeBridges,
    };
  }

  function closeSaveModal() {
    showSaveModal.value = false;
    isInitialOffer.value = false;
    saveFeedbackMessage.value = '';
  }

  function getProbandDefaultFileName(probandId: string | null | undefined): string {
    const p = probandId ? personById.value.get(probandId) : null;
    const rawName = p
      ? `${p.given_name || ''}_${p.surname || ''}`
          .replace(/\s+/g, '_')
          .replace(/[^a-zA-Z0-9_\-äöüÄÖÜß]/g, '')
      : 'Stammbaum';
    const dateStr = new Date().toISOString().slice(0, 10);
    return `${rawName || 'Design'}_${dateStr}`;
  }

  function openInitialOfferModal() {
    const { activeProbandId } = getProps();
    saveFileName.value = getProbandDefaultFileName(activeProbandId);
    saveFeedbackMessage.value = '';
    saveMode.value = 'new';
    selectedOverwriteId.value = '';
    existingPresets.value = [];
    isInitialOffer.value = true;
    showSaveModal.value = true;
  }

  async function checkAndLoadLatestStateOrOffer() {
    const { personsLength, activeProbandId } = getProps();
    if (personsLength === 0 || isCheckingLayout || !activeProbandId) return;

    if (skipAutoLoadOnce.value) {
      skipAutoLoadOnce.value = false;
      return;
    }

    isCheckingLayout = true;
    isApplyingLoadedState.value = true;
    try {
      let layouts: DesignLayoutEntry[] = [];
      const currentProband = activeProbandId;

      // 1. Zuerst Layouts für aktuellen Probanden abrufen (ausschließlich für diesen Probanden)
      try {
        layouts = await invoke<DesignLayoutEntry[]>('get_design_layouts', {
          probandId: currentProband,
        });
      } catch (err) {
        console.error('Error fetching layouts for proband', err);
      }

      // 2. Wenn für diesen Probanden gespeicherte Stände existieren: den zuletzt bearbeiteten laden!
      if (layouts.length > 0) {
        const lastId = localStorage.getItem('stammbaum_last_design_layout_id');
        const targetLayout = (lastId ? layouts.find(l => l.id === lastId) : null) || layouts[0];

        try {
          const parsed = JSON.parse(targetLayout.layout_data) as DesignPersistedState;
          applyLoadedState(parsed);
          currentLayoutId.value = targetLayout.id;
          currentLayoutName.value = targetLayout.name;
          saveFileName.value = targetLayout.name;
          selectedOverwriteId.value = targetLayout.id;
          saveMode.value = 'overwrite';
          localStorage.setItem('stammbaum_last_design_layout_id', targetLayout.id);

          autoLoadToast.value = t('design_auto_loaded_toast', { name: targetLayout.name });
          setTimeout(() => {
            autoLoadToast.value = '';
          }, 3200);

          nextTick(() => {
            if (!parsed.pan) {
              onCenterOnOrigin();
            }
          });
          return;
        } catch (err) {
          console.error('Failed to parse and apply saved layout', err);
        }
      }

      // 3. Wurde für diesen Stammahn noch kein Stand gespeichert: Ausgangs-Layout erstellen
      currentLayoutId.value = null;
      currentLayoutName.value = '';
      selectedOverwriteId.value = '';
      saveMode.value = 'new';
      saveFileName.value = getProbandDefaultFileName(currentProband);

      onBuildInitialDesignLayout();
      nextTick(() => {
        onCenterOnOrigin();
      });
    } finally {
      isApplyingLoadedState.value = false;
      isCheckingLayout = false;
    }
  }

  async function openSaveModal() {
    isInitialOffer.value = false;
    const { activeProbandId } = getProps();
    const probandPerson = activeProbandId ? personById.value.get(activeProbandId) : null;
    const rawName = probandPerson
      ? `${probandPerson.given_name || ''}_${probandPerson.surname || ''}`
          .replace(/\s+/g, '_')
          .replace(/[^a-zA-Z0-9_\-äöüÄÖÜß]/g, '')
      : 'Stammbaum';
    const dateStr = new Date().toISOString().slice(0, 10);
    if (currentLayoutName.value) {
      saveFileName.value = currentLayoutName.value;
      saveMode.value = 'overwrite';
      selectedOverwriteId.value = currentLayoutId.value || '';
    } else {
      saveFileName.value = `${rawName || 'Design'}_${dateStr}`;
      saveMode.value = 'new';
      selectedOverwriteId.value = '';
    }
    saveFeedbackMessage.value = '';
    showSaveModal.value = true;
    try {
      existingPresets.value = await invoke<DesignLayoutEntry[]>('get_design_layouts', {
        probandId: activeProbandId || '',
      });
    } catch (err) {
      console.error('Failed to load existing presets for save modal', err);
      existingPresets.value = [];
    }
  }

  async function saveCurrentStateToDb() {
    const name = saveFileName.value.trim();
    if (!name) return;
    isSaving.value = true;
    saveFeedbackMessage.value = '';
    try {
      const { activeProbandId } = getProps();
      const stateObj = getSerializedDesignState(name);
      const jsonStr = JSON.stringify(stateObj, null, 2);
      const overwriteId =
        saveMode.value === 'overwrite' && selectedOverwriteId.value
          ? selectedOverwriteId.value
          : matchingExistingPreset.value
            ? matchingExistingPreset.value.id
            : null;
      const savedEntry = await invoke<DesignLayoutEntry>('save_design_layout', {
        probandId: activeProbandId || '',
        name,
        createdAt: new Date().toISOString(),
        layoutData: jsonStr,
        overwriteId,
      });
      if (savedEntry) {
        currentLayoutId.value = savedEntry.id;
        selectedOverwriteId.value = savedEntry.id;
        localStorage.setItem('stammbaum_last_design_layout_id', savedEntry.id);
      }
      currentLayoutName.value = name;
      saveMode.value = 'overwrite';
      isInitialOffer.value = false;
      saveFeedbackMessage.value = overwriteId
        ? t('design_overwrite_success', { name })
        : t('design_save_success', { name });
      setTimeout(() => {
        showSaveModal.value = false;
        saveFeedbackMessage.value = '';
      }, 1200);
    } catch (err) {
      saveFeedbackMessage.value = `Fehler beim Speichern: ${err}`;
    } finally {
      isSaving.value = false;
    }
  }

  async function exportStateToFile() {
    const name = saveFileName.value.trim() || 'Stammbaum_Design';
    const stateObj = getSerializedDesignState(name);
    const jsonStr = JSON.stringify(stateObj, null, 2);

    try {
      let filePath: string | null = null;
      let dialogCancelled = false;
      try {
        const res = await save({
          defaultPath: `${name}.json`,
          filters: [{ name: 'Stammbaum Design (*.json)', extensions: ['json'] }],
        });
        if (typeof res === 'string') {
          filePath = res;
        } else {
          dialogCancelled = true;
        }
      } catch {
        filePath = null;
      }

      if (dialogCancelled) {
        return;
      }

      if (filePath) {
        await invoke('save_design_file', { filePath, content: jsonStr });
        saveFeedbackMessage.value = t('design_export_success', { path: filePath });
      } else {
        downloadJsonInBrowser(`${name}.json`, jsonStr);
        saveFeedbackMessage.value = t('design_save_success', { name });
      }

      const { activeProbandId } = getProps();
      const overwriteId =
        saveMode.value === 'overwrite' && selectedOverwriteId.value
          ? selectedOverwriteId.value
          : matchingExistingPreset.value
            ? matchingExistingPreset.value.id
            : null;
      try {
        const savedEntry = await invoke<DesignLayoutEntry>('save_design_layout', {
          probandId: activeProbandId || '',
          name,
          createdAt: new Date().toISOString(),
          layoutData: jsonStr,
          overwriteId,
        });
        if (savedEntry) {
          currentLayoutId.value = savedEntry.id;
          selectedOverwriteId.value = savedEntry.id;
          localStorage.setItem('stammbaum_last_design_layout_id', savedEntry.id);
        }
        currentLayoutName.value = name;
        saveMode.value = 'overwrite';
        isInitialOffer.value = false;
      } catch {}

      setTimeout(() => {
        showSaveModal.value = false;
        saveFeedbackMessage.value = '';
      }, 1500);
    } catch (err) {
      saveFeedbackMessage.value = `Fehler beim Exportieren: ${err}`;
    }
  }

  function downloadJsonInBrowser(filename: string, content: string) {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function openLoadModal() {
    loadFeedbackMessage.value = '';
    showLoadModal.value = true;
    await fetchSavedLayouts();
  }

  async function fetchSavedLayouts() {
    isLoadingLayouts.value = true;
    try {
      const { activeProbandId } = getProps();
      savedLayoutsList.value = await invoke<DesignLayoutEntry[]>('get_design_layouts', {
        probandId: activeProbandId || '',
      });
    } catch (err) {
      console.error('Failed to load layouts', err);
      savedLayoutsList.value = [];
    } finally {
      isLoadingLayouts.value = false;
    }
  }

  function applyLoadedState(state: DesignPersistedState) {
    if (state.totalLevels && state.totalLevels > 0) {
      totalLevels.value = state.totalLevels;
    }
    if (state.levelHeights && typeof state.levelHeights === 'object') {
      levelHeights.value = { ...state.levelHeights };
    }
    if (state.siblingGroups && Array.isArray(state.siblingGroups)) {
      siblingGroups.value = JSON.parse(JSON.stringify(state.siblingGroups));
    }
    if (state.branchWidths && Array.isArray(state.branchWidths)) {
      const bwMap = new Map<string, BranchWidthConstraint>();
      state.branchWidths.forEach(bw => {
        if (bw.personId) bwMap.set(bw.personId, bw);
      });
      branchWidths.value = bwMap;
    }
    if (state.cardConfig) {
      onUpdateCardConfig(state.cardConfig);
    }
    onUpdateDesignConfig({
      cardConfig: state.cardConfig,
      horizontalLaneGap: state.horizontalLaneGap,
      autoSubLanes: state.autoSubLanes,
      enableLineBridges: state.enableLineBridges,
      bridgeRadius: state.bridgeRadius,
      minimizeBridges: state.minimizeBridges,
    });
    if (state.expandedParentIds && Array.isArray(state.expandedParentIds)) {
      expandedParentIds.value = new Set(state.expandedParentIds);
    }
    if (state.pan && typeof state.pan.x === 'number' && typeof state.pan.y === 'number') {
      pan.value = { x: state.pan.x, y: state.pan.y };
    }
    if (state.zoom && typeof state.zoom === 'number') {
      zoom.value = state.zoom;
    }

    const { activeProbandId } = getProps();
    // Hintergrundbild und Konfiguration für diesen Stand wiederherstellen
    if (state.backgroundImageData && state.backgroundConfig) {
      bgImageData.value = state.backgroundImageData;
      bgConfig.value = { ...DEFAULT_BACKGROUND_CONFIG, ...state.backgroundConfig };
      saveProbandBg(activeProbandId, state.backgroundImageData, bgConfig.value);
    } else {
      bgImageData.value = null;
      bgConfig.value = { ...DEFAULT_BACKGROUND_CONFIG };
      deleteProbandBg(activeProbandId);
    }

    activeDesignPersonId.value = '';
    historyStack.value = [];
    redoStack.value = [];
  }

  function loadStateFromEntry(entry: DesignLayoutEntry) {
    try {
      const parsed = JSON.parse(entry.layout_data) as DesignPersistedState;
      applyLoadedState(parsed);
      currentLayoutId.value = entry.id;
      currentLayoutName.value = entry.name;
      saveFileName.value = entry.name;
      selectedOverwriteId.value = entry.id;
      saveMode.value = 'overwrite';
      localStorage.setItem('stammbaum_last_design_layout_id', entry.id);
      loadFeedbackMessage.value = t('design_save_success', { name: entry.name });
      setTimeout(() => {
        showLoadModal.value = false;
        loadFeedbackMessage.value = '';
      }, 800);
    } catch (err) {
      loadFeedbackMessage.value = t('design_load_error', { error: String(err) });
    }
  }

  async function exportEntryToFile(entry: DesignLayoutEntry) {
    try {
      let filePath: string | null = null;
      try {
        const res = await save({
          defaultPath: `${entry.name}.json`,
          filters: [{ name: 'Stammbaum Design (*.json)', extensions: ['json'] }],
        });
        if (typeof res === 'string') filePath = res;
      } catch {
        filePath = null;
      }

      if (filePath) {
        await invoke('save_design_file', { filePath, content: entry.layout_data });
        loadFeedbackMessage.value = t('design_export_success', { path: filePath });
      } else {
        downloadJsonInBrowser(`${entry.name}.json`, entry.layout_data);
        loadFeedbackMessage.value = t('design_export_success', { path: `${entry.name}.json` });
      }
    } catch (err) {
      loadFeedbackMessage.value = `Fehler beim Exportieren: ${err}`;
    }
  }

  async function deleteStateEntry(id: string) {
    if (!confirm(t('design_delete_preset_confirm'))) return;
    try {
      await invoke('delete_design_layout', { id });
      savedLayoutsList.value = savedLayoutsList.value.filter(e => e.id !== id);
    } catch (err) {
      loadFeedbackMessage.value = `Fehler beim Löschen: ${err}`;
    }
  }

  function openNewDesignModal() {
    const { activeProbandId, rootAncestors } = getProps();
    const currentId = activeProbandId || (rootAncestors && rootAncestors.length > 0 ? rootAncestors[0].person_id : '');
    newDesignProbandId.value = currentId;
    newDesignFileName.value = getProbandDefaultFileName(currentId);
    showNewDesignModal.value = true;
  }

  function closeNewDesignModal() {
    showNewDesignModal.value = false;
  }

  function onNewDesignProbandChange(probandId: string) {
    newDesignProbandId.value = probandId;
    newDesignFileName.value = getProbandDefaultFileName(probandId);
  }

  function confirmCreateNewDesign() {
    const targetProbandId = newDesignProbandId.value;
    const targetName = newDesignFileName.value.trim() || getProbandDefaultFileName(targetProbandId);

    showNewDesignModal.value = false;
    skipAutoLoadOnce.value = true;

    if (targetProbandId && targetProbandId !== getProps().activeProbandId) {
      onSelectProband(targetProbandId);
    }

    currentLayoutId.value = null;
    currentLayoutName.value = '';
    selectedOverwriteId.value = '';
    saveMode.value = 'new';
    localStorage.removeItem('stammbaum_last_design_layout_id');

    bgImageData.value = null;
    bgConfig.value = { ...DEFAULT_BACKGROUND_CONFIG };
    deleteProbandBg(targetProbandId);

    saveFileName.value = targetName;
    historyStack.value = [];
    redoStack.value = [];

    onBuildInitialDesignLayout();
    nextTick(() => {
      onCenterOnOrigin();
    });

    autoLoadToast.value = t('design_new_file_created');
    setTimeout(() => {
      autoLoadToast.value = '';
    }, 2500);
  }

  function createNewDesignFile() {
    openNewDesignModal();
  }

  async function loadStateFromFile() {
    try {
      let selected: string | null = null;
      let dialogCancelled = false;
      try {
        const res = await open({
          multiple: false,
          filters: [{ name: 'Stammbaum Design (*.json)', extensions: ['json'] }],
        });
        if (typeof res === 'string') {
          selected = res;
        } else {
          dialogCancelled = true;
        }
      } catch {
        selected = null;
      }

      if (dialogCancelled) {
        return;
      }

      if (selected) {
        const content = await invoke<string>('read_design_file', { filePath: selected });
        processLoadedJsonString(
          content,
          selected.split(/[\\/]/).pop()?.replace(/\.json$/i, '') || 'Import'
        );
      } else if (fileInputRef.value) {
        fileInputRef.value.click();
      }
    } catch (err) {
      loadFeedbackMessage.value = t('design_load_error', { error: String(err) });
      autoLoadToast.value = t('design_load_error', { error: String(err) });
      setTimeout(() => {
        autoLoadToast.value = '';
      }, 3500);
    }
  }

  function onFileInputChange(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        processLoadedJsonString(reader.result, file.name.replace(/\.json$/i, ''));
      }
    };
    reader.readAsText(file);
    input.value = '';
  }

  async function processLoadedJsonString(content: string, fallbackName: string) {
    try {
      const parsed = JSON.parse(content) as DesignPersistedState;
      if (!parsed.siblingGroups || !Array.isArray(parsed.siblingGroups)) {
        throw new Error('Ungültiges Design-Format: Keine Gruppen vorhanden.');
      }
      applyLoadedState(parsed);
      const entryName = parsed.name || fallbackName;
      const { activeProbandId } = getProps();

      try {
        const savedEntry = await invoke<DesignLayoutEntry>('save_design_layout', {
          probandId: activeProbandId || parsed.probandId || '',
          name: entryName,
          createdAt: new Date().toISOString(),
          layoutData: content,
        });
        if (savedEntry) {
          currentLayoutId.value = savedEntry.id;
          selectedOverwriteId.value = savedEntry.id;
          localStorage.setItem('stammbaum_last_design_layout_id', savedEntry.id);
        }
      } catch {}

      currentLayoutName.value = entryName;
      saveFileName.value = entryName;
      saveMode.value = 'overwrite';

      loadFeedbackMessage.value = t('design_load_file_success');
      autoLoadToast.value = t('design_load_file_success');
      setTimeout(() => {
        showLoadModal.value = false;
        loadFeedbackMessage.value = '';
        autoLoadToast.value = '';
      }, 2000);
    } catch (err) {
      loadFeedbackMessage.value = t('design_load_error', { error: String(err) });
      autoLoadToast.value = t('design_load_error', { error: String(err) });
      setTimeout(() => {
        autoLoadToast.value = '';
      }, 3500);
    }
  }

  function formatDateStr(iso: string): string {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  }

  return {
    historyStack,
    redoStack,
    canUndo,
    canRedo,
    captureCurrentSnapshot,
    pushHistorySnapshot,
    pushHistoryState,
    takeSnapshot,
    beginDragSnapshot,
    commitDragSnapshot,
    undoLastAction,
    redoLastAction,
    undo,
    redo,
    onGlobalKeyDown,
    showSaveModal,
    saveFileName,
    saveFeedbackMessage,
    isSaving,
    existingPresets,
    saveMode,
    selectedOverwriteId,
    isInitialOffer,
    currentLayoutId,
    currentLayoutName,
    autoLoadToast,
    isApplyingLoadedState,
    showLoadModal,
    savedLayoutsList,
    isLoadingLayouts,
    loadFeedbackMessage,
    fileInputRef,
    activeProbandName,
    matchingExistingPreset,
    isMatchingExistingName,
    onSelectOverwritePreset,
    onSaveModeChange,
    getSerializedDesignState,
    closeSaveModal,
    openInitialOfferModal,
    checkAndLoadLatestStateOrOffer,
    openSaveModal,
    saveCurrentStateToDb,
    exportStateToFile,
    openLoadModal,
    fetchSavedLayouts,
    applyLoadedState,
    loadStateFromEntry,
    exportEntryToFile,
    deleteStateEntry,
    createNewDesignFile,
    showNewDesignModal,
    newDesignProbandId,
    newDesignFileName,
    hasUnsavedChanges,
    openNewDesignModal,
    closeNewDesignModal,
    onNewDesignProbandChange,
    confirmCreateNewDesign,
    loadStateFromFile,
    onFileInputChange,
    processLoadedJsonString,
    formatDateStr,
  };
}

