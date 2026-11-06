<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  DEFAULT_CARD_CONFIG,
  DEFAULT_BACKGROUND_CONFIG,
  type DesignCardConfig,
  type DesignBackgroundConfig,
} from '../types/design';
import {
  saveBackgroundImageToDB,
  loadBackgroundImageFromDB,
  deleteBackgroundImageFromDB,
} from '../utils/designBgStorage';
import { useDesignNavigation } from '../composables/useDesignNavigation';
import {
  useDesignHistory,
  type DesignSiblingGroup,
  type BranchWidthConstraint,
} from '../composables/useDesignHistory';
import {
  useDesignLayout,
  type DesignPerson as Person,
  type RootAncestorConfig,
} from '../composables/useDesignLayout';
import DesignSidebar from './design/DesignSidebar.vue';
import DesignCanvas from './design/DesignCanvas.vue';

const { t, locale } = useI18n();

const props = withDefaults(defineProps<{
  persons: Person[];
  rootAncestors: RootAncestorConfig[];
  activeProbandId: string | null;
  selectedId: string;
  highlightedPathIds?: Set<string>;
  horizontalLaneGap?: number;
  autoSubLanes?: boolean;
  enableLineBridges?: boolean;
  bridgeRadius?: number;
  minimizeBridges?: boolean;
  cardConfig?: DesignCardConfig;
}>(), {
  horizontalLaneGap: 16,
  autoSubLanes: true,
  enableLineBridges: true,
  bridgeRadius: 8,
  minimizeBridges: true,
});

const emit = defineEmits<{
  (e: 'select', person: Person | null): void;
  (e: 'clear-selection'): void;
  (e: 'select-proband', personId: string): void;
  (e: 'open-settings'): void;
  (e: 'update-card-config', config: DesignCardConfig): void;
  (e: 'update-design-config', config: {
    cardConfig?: DesignCardConfig;
    horizontalLaneGap?: number;
    autoSubLanes?: boolean;
    enableLineBridges?: boolean;
    bridgeRadius?: number;
    minimizeBridges?: boolean;
  }): void;
  (e: 'jump-to', personId: string): void;
}>();

const activeCardConfig = computed<DesignCardConfig>(() => props.cardConfig || DEFAULT_CARD_CONFIG);

const siblingGroups = ref<DesignSiblingGroup[]>([]);
const totalLevels = ref<number>(1);
const levelHeights = ref<Record<number, number>>({});
const expandedParentIds = ref<Set<string>>(new Set());
const activeDesignPersonId = ref<string>('');
const branchWidths = ref<Map<string, BranchWidthConstraint>>(new Map());

const bgImageData = ref<string | null>(null);
const bgConfig = ref<DesignBackgroundConfig>({ ...DEFAULT_BACKGROUND_CONFIG });
const isBgPopoverOpen = ref<boolean>(false);
const isBgDraggingOnCanvas = ref<boolean>(false);
const sidebarRef = ref<InstanceType<typeof DesignSidebar> | null>(null);

const personById = computed<Map<string, Person>>(() => {
  const m = new Map<string, Person>();
  props.persons.forEach(p => m.set(p.id, p));
  return m;
});

const {
  viewportRef,
  pan,
  zoom,
  isPanning,
  centerOnOrigin,
  fitToScreen,
  startCanvasPan,
  onCanvasPan,
  stopCanvasPan,
  onViewportClick,
  handleWheelZoom,
  zoomStepCenter,
} = useDesignNavigation({
  siblingGroups,
  activeDesignPersonId,
  getCanvasHeight: () => canvasHeight.value,
  getGroupLayouts: () => groupLayouts.value,
  getRenderedBranchWidths: () => renderedBranchWidths.value,
  isBgDragging: () => isBgDraggingOnCanvas.value,
  closeBgPopover: () => {
    isBgPopoverOpen.value = false;
  },
  onClearSelectionEmit: () => {
    emit('select', null);
    emit('clear-selection');
  },
});

const {
  historyStack,
  canUndo,
  pushHistoryState,
  beginDragSnapshot,
  commitDragSnapshot,
  undoLastAction,
  onGlobalKeyDown,
  showSaveModal,
  saveFileName,
  saveFeedbackMessage,
  isSaving,
  existingPresets,
  saveMode,
  selectedOverwriteId,
  isInitialOffer,
  autoLoadToast,
  isApplyingLoadedState,
  showLoadModal,
  savedLayoutsList,
  isLoadingLayouts,
  loadFeedbackMessage,
  fileInputRef: designFileInputRef,
  activeProbandName,
  isMatchingExistingName,
  onSelectOverwritePreset,
  onSaveModeChange,
  closeSaveModal,
  checkAndLoadLatestStateOrOffer,
  openSaveModal,
  saveCurrentStateToDb,
  exportStateToFile,
  openLoadModal,
  loadStateFromEntry,
  exportEntryToFile,
  deleteStateEntry,
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
  formatDateStr,
} = useDesignHistory({
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
  getProps: () => ({
    personsLength: props.persons.length,
    activeProbandId: props.activeProbandId,
    rootAncestors: props.rootAncestors,
    horizontalLaneGap: props.horizontalLaneGap,
    autoSubLanes: props.autoSubLanes,
    enableLineBridges: props.enableLineBridges,
    bridgeRadius: props.bridgeRadius,
    minimizeBridges: props.minimizeBridges,
  }),
  onBuildInitialDesignLayout: () => buildInitialDesignLayout(),
  onCenterOnOrigin: () => centerOnOrigin(),
  onSelectProband: probandId => emit('select-proband', probandId),
  onUpdateCardConfig: cfg => emit('update-card-config', cfg),
  onUpdateDesignConfig: cfg => emit('update-design-config', cfg),
  saveProbandBg: (probandId, dataUrl, config) => saveProbandBg(probandId, dataUrl, config),
  deleteProbandBg: probandId => deleteProbandBg(probandId),
});

const {
  draggingGroupId,
  draggingClusterGroupIds,
  dragHoverInsertAboveLevel,
  activeSnapGuideX,
  draggingBwId,
  selectedDesignPerson,
  getLevelBandTopY,
  canvasHeight,
  canvasWidth,
  levelsTopToBottom,
  cardDataByPersonId,
  groupLayouts,
  renderedBranchWidths,
  edgeGeometry,
  hasDescendants,
  isParentExpanded,
  toggleDescendants,
  expandAllDescendants,
  collapseAllToOrigin,
  buildInitialDesignLayout,
  isPersonSelected,
  selectCardPerson,
  startGroupDrag,
  startBranchWidthDrag,
  startBranchWidthResize,
  removeBranchWidth,
  groupDescendantsByLevel,
  ungroupAtPerson,
  getSelectedOrAnchorPersonId,
  regroupSelectedOrFirstInGroup,
  groupAllInLevel,
  detachPersonFromGroup,
  canDetachSelectedPerson,
  detachSelectedPerson,
  canRegroupPerson,
  regroupSiblingsForPerson,
  dockToNeighbor,
  moveGroupLevel,
  insertLevelAboveAndMoveGroup,
  movePersonWithinGroup,
  moveSinglePersonLevel,
  insertEmptyLevelAbove,
  removeEmptyLevel,
  cleanupLayoutListeners,
} = useDesignLayout({
  t,
  locale,
  siblingGroups,
  totalLevels,
  levelHeights,
  expandedParentIds,
  activeDesignPersonId,
  branchWidths,
  zoom,
  activeCardConfig,
  personById,
  getProps: () => ({
    persons: props.persons,
    rootAncestors: props.rootAncestors,
    activeProbandId: props.activeProbandId,
    selectedId: props.selectedId,
    highlightedPathIds: props.highlightedPathIds,
    horizontalLaneGap: props.horizontalLaneGap,
    autoSubLanes: props.autoSubLanes,
    enableLineBridges: props.enableLineBridges,
    bridgeRadius: props.bridgeRadius,
    minimizeBridges: props.minimizeBridges,
  }),
  pushHistoryState,
  beginDragSnapshot,
  commitDragSnapshot,
  centerOnOrigin,
  onSelectPerson: person => emit('select', person),
});

let hasInitialized = false;

watch(() => [props.activeProbandId, props.persons.length], () => {
  if (isApplyingLoadedState.value) return;
  loadProbandBackground(props.activeProbandId);
  if (hasInitialized && props.persons.length > 0) {
    checkAndLoadLatestStateOrOffer();
  }
});

onMounted(async () => {
  hasInitialized = true;
  window.addEventListener('keydown', onGlobalKeyDown);
  loadProbandBackground(props.activeProbandId);
  if (props.persons.length > 0) {
    await checkAndLoadLatestStateOrOffer();
  }
});

onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKeyDown);
  cleanupLayoutListeners();
});

function getProbandBgKey(probandId: string | null | undefined): string {
  return `proband_${probandId || 'default'}`;
}

function getProbandConfigKey(probandId: string | null | undefined): string {
  return `stammbaum_design_bg_config_${probandId || 'default'}`;
}

async function loadProbandBackground(probandId: string | null | undefined) {
  if (!probandId) {
    bgImageData.value = null;
    bgConfig.value = { ...DEFAULT_BACKGROUND_CONFIG };
    return;
  }
  try {
    const savedCfg = localStorage.getItem(getProbandConfigKey(probandId));
    bgConfig.value = savedCfg ? { ...DEFAULT_BACKGROUND_CONFIG, ...JSON.parse(savedCfg) } : { ...DEFAULT_BACKGROUND_CONFIG };
  } catch {
    bgConfig.value = { ...DEFAULT_BACKGROUND_CONFIG };
  }
  try {
    const res = await loadBackgroundImageFromDB(getProbandBgKey(probandId));
    if (res && res.dataUrl) {
      bgImageData.value = res.dataUrl;
      if (res.fileName && !bgConfig.value.fileName) {
        bgConfig.value.fileName = res.fileName;
      }
    } else {
      bgImageData.value = null;
      bgConfig.value.fileName = undefined;
    }
  } catch (err) {
    console.warn('Failed to load background image for proband', probandId, err);
    bgImageData.value = null;
  }
}

function saveProbandBg(probandId: string | null | undefined, dataUrl: string, config: DesignBackgroundConfig) {
  const pId = probandId || 'default';
  try {
    localStorage.setItem(getProbandConfigKey(pId), JSON.stringify(config));
  } catch {}
  saveBackgroundImageToDB(dataUrl, config.fileName || 'background_image', 'image/png', 0, getProbandBgKey(pId));
}

function deleteProbandBg(probandId: string | null | undefined) {
  const pId = probandId || 'default';
  try {
    localStorage.removeItem(getProbandConfigKey(pId));
  } catch {}
  deleteBackgroundImageFromDB(getProbandBgKey(pId));
}

watch(
  bgConfig,
  newVal => {
    try {
      if (props.activeProbandId) {
        localStorage.setItem(getProbandConfigKey(props.activeProbandId), JSON.stringify(newVal));
      }
    } catch {}
  },
  { deep: true }
);

function handleDropBgFile(file: File) {
  sidebarRef.value?.processBgFile(file);
  isBgPopoverOpen.value = true;
}
</script>

<template>
  <div class="design-mode-wrapper">
    <DesignSidebar
      ref="sidebarRef"
      :active-proband-id="activeProbandId"
      :root-ancestors="rootAncestors"
      :auto-load-toast="autoLoadToast"
      :can-undo="canUndo"
      :history-length="historyStack.length"
      :bg-image-data="bgImageData"
      :bg-config="bgConfig"
      :is-bg-popover-open="isBgPopoverOpen"
      :is-bg-dragging-on-canvas="isBgDraggingOnCanvas"
      :selected-design-person="selectedDesignPerson"
      :has-selected-descendants="Boolean(selectedDesignPerson && hasDescendants(selectedDesignPerson.id))"
      :can-detach-selected-person="canDetachSelectedPerson"
      :bridges-count="edgeGeometry.totalBridgesCount"
      :enable-line-bridges="props.enableLineBridges"
      :canvas-width="canvasWidth"
      :canvas-height="canvasHeight"
      :show-save-modal="showSaveModal"
      :is-initial-offer="isInitialOffer"
      :active-proband-name="activeProbandName"
      :existing-presets="existingPresets"
      :save-mode="saveMode"
      :selected-overwrite-id="selectedOverwriteId"
      :save-file-name="saveFileName"
      :is-matching-existing-name="isMatchingExistingName"
      :total-levels="totalLevels"
      :sibling-groups-count="siblingGroups.length"
      :branch-widths-count="branchWidths.size"
      :save-feedback-message="saveFeedbackMessage"
      :is-saving="isSaving"
      :show-load-modal="showLoadModal"
      :load-feedback-message="loadFeedbackMessage"
      :is-loading-layouts="isLoadingLayouts"
      :saved-layouts-list="savedLayoutsList"
      :format-date-str="formatDateStr"
      :set-design-file-input-ref="el => { designFileInputRef = el }"
      :show-new-design-modal="showNewDesignModal"
      :new-design-proband-id="newDesignProbandId"
      :new-design-file-name="newDesignFileName"
      :has-unsaved-changes="hasUnsavedChanges"
      @select-proband="id => emit('select-proband', id)"
      @open-settings="emit('open-settings')"
      @undo="undoLastAction"
      @expand-all="expandAllDescendants"
      @collapse-all="collapseAllToOrigin"
      @reset-layout="buildInitialDesignLayout"
      @close-new-design-modal="closeNewDesignModal"
      @update:new-design-proband-id="id => onNewDesignProbandChange(id)"
      @update:new-design-file-name="name => { newDesignFileName = name }"
      @confirm-create-new-design="confirmCreateNewDesign"
      @update:is-bg-popover-open="val => { isBgPopoverOpen = val }"
      @update:is-bg-dragging-on-canvas="val => { isBgDraggingOnCanvas = val }"
      @update:bg-image-data="val => { bgImageData = val }"
      @save-proband-bg="(dataUrl, cfg) => saveProbandBg(activeProbandId, dataUrl, cfg)"
      @delete-proband-bg="deleteProbandBg(activeProbandId)"
      @group-descendants="id => groupDescendantsByLevel(id)"
      @detach-selected="detachSelectedPerson"
      @close-save-modal="closeSaveModal"
      @save-mode-change="mode => onSaveModeChange(mode)"
      @update:selected-overwrite-id="id => { selectedOverwriteId = id }"
      @select-overwrite-preset="onSelectOverwritePreset"
      @update:save-file-name="name => { saveFileName = name }"
      @save-to-db="saveCurrentStateToDb"
      @export-to-file="exportStateToFile"
      @close-load-modal="showLoadModal = false"
      @load-entry="entry => loadStateFromEntry(entry)"
      @export-entry="entry => exportEntryToFile(entry)"
      @delete-entry="id => deleteStateEntry(id)"
      @open-external-file="loadStateFromFile"
      @file-input-change="e => onFileInputChange(e)"
    />

    <DesignCanvas
      v-if="activeProbandId"
      :pan="pan"
      :zoom="zoom"
      :is-panning="isPanning"
      :canvas-width="canvasWidth"
      :canvas-height="canvasHeight"
      :total-levels="totalLevels"
      :levels-top-to-bottom="levelsTopToBottom"
      :group-layouts="groupLayouts"
      :rendered-branch-widths="renderedBranchWidths"
      :edge-geometry="edgeGeometry"
      :card-data-by-person-id="cardDataByPersonId"
      :active-card-config="activeCardConfig"
      :active-design-person-id="activeDesignPersonId"
      :selected-id="selectedId"
      :branch-widths="branchWidths"
      :highlighted-path-ids="highlightedPathIds"
      :dragging-group-id="draggingGroupId"
      :dragging-cluster-group-ids="draggingClusterGroupIds"
      :drag-hover-insert-above-level="dragHoverInsertAboveLevel"
      :active-snap-guide-x="activeSnapGuideX"
      :dragging-bw-id="draggingBwId"
      :bg-image-data="bgImageData"
      :bg-config="bgConfig"
      :is-bg-dragging-on-canvas="isBgDraggingOnCanvas"
      :can-undo="canUndo"
      :set-viewport-ref="el => { viewportRef = el }"
      :start-canvas-pan="startCanvasPan"
      :on-canvas-pan="onCanvasPan"
      :stop-canvas-pan="stopCanvasPan"
      :on-viewport-click="onViewportClick"
      :handle-wheel-zoom="handleWheelZoom"
      :zoom-step-center="zoomStepCenter"
      :center-on-origin="centerOnOrigin"
      :fit-to-screen="fitToScreen"
      :get-level-band-top-y="getLevelBandTopY"
      :has-descendants="hasDescendants"
      :is-parent-expanded="isParentExpanded"
      :toggle-descendants="toggleDescendants"
      :is-person-selected="isPersonSelected"
      :select-card-person="selectCardPerson"
      :start-group-drag="startGroupDrag"
      :start-branch-width-drag="startBranchWidthDrag"
      :start-branch-width-resize="startBranchWidthResize"
      :remove-branch-width="removeBranchWidth"
      :group-descendants-by-level="groupDescendantsByLevel"
      :ungroup-at-person="ungroupAtPerson"
      :get-selected-or-anchor-person-id="getSelectedOrAnchorPersonId"
      :regroup-selected-or-first-in-group="regroupSelectedOrFirstInGroup"
      :group-all-in-level="groupAllInLevel"
      :detach-person-from-group="detachPersonFromGroup"
      :can-regroup-person="canRegroupPerson"
      :regroup-siblings-for-person="regroupSiblingsForPerson"
      :dock-to-neighbor="dockToNeighbor"
      :move-group-level="moveGroupLevel"
      :insert-level-above-and-move-group="insertLevelAboveAndMoveGroup"
      :move-person-within-group="movePersonWithinGroup"
      :move-single-person-level="moveSinglePersonLevel"
      :insert-empty-level-above="insertEmptyLevelAbove"
      :remove-empty-level="removeEmptyLevel"
      @update:is-bg-dragging-on-canvas="val => { isBgDraggingOnCanvas = val }"
      @drop-bg-file="handleDropBgFile"
      @undo="undoLastAction"
      @create-new-design="openNewDesignModal"
      @open-load-modal="openLoadModal"
      @open-save-modal="openSaveModal"
    />
  </div>
</template>

<style scoped>
.design-mode-wrapper {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  position: relative;
  background: #f5f7fa;
}
</style>
