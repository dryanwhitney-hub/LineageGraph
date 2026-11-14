<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, toRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  DEFAULT_CARD_CONFIG,
  type DesignCardConfig,
} from '../types/design';
import type { Person, RootAncestorConfig } from '../composables/usePersons';
import { useDesignNavigation } from '../composables/useDesignNavigation';
import { useDesignStudioStore } from '../composables/useDesignStudioStore';
import DesignSidebar from './design/DesignSidebar.vue';
import DesignCanvas from './design/DesignCanvas.vue';

const { locale } = useI18n();

const props = withDefaults(defineProps<{
  persons: Person[];
  rootAncestors: RootAncestorConfig[];
  activeProbandId: string | null;
  selectedId: string;
  isDetailsOpen?: boolean;
  highlightedPathIds?: Set<string>;
  horizontalLaneGap?: number;
  autoSubLanes?: boolean;
  enableLineBridges?: boolean;
  bridgeRadius?: number;
  minimizeBridges?: boolean;
  cardConfig?: DesignCardConfig;
  activeTree?: string;
}>(), {
  activeTree: '',
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
  (e: 'open-details', personId: string): void;
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
  (e: 'tree-imported', treeName: string): void;
}>();

const isBgPopoverOpen = ref(false);

const personsRef = toRef(props, 'persons');
const rootAncestorsRef = toRef(props, 'rootAncestors');
const activeProbandIdRef = toRef(props, 'activeProbandId');
const activeTreeRef = toRef(props, 'activeTree');
const initialCardCfgRef = computed<DesignCardConfig>(
  () => props.cardConfig || DEFAULT_CARD_CONFIG
);

const store = useDesignStudioStore({
  persons: personsRef,
  rootAncestors: rootAncestorsRef,
  activeProbandId: activeProbandIdRef,
  initialCardConfig: initialCardCfgRef,
  locale,
  activeTree: activeTreeRef,
});

const navigation = useDesignNavigation({
  sceneGraph: store.sceneGraph,
  activeDesignPersonId: store.selectedPersonId,
  isBgDragging: () => false,
  closeBgPopover: () => {
    isBgPopoverOpen.value = false;
  },
  onClearSelectionEmit: () => {
    store.selectedGroupKey.value = '';
    store.selectedEdgeKey.value = '';
    emit('clear-selection');
  },
});

const {
  viewportRef,
  pan,
  zoom,
  isPanning,
  centerOnOrigin,
  fitToScreen,
  focusCardByPersonId,
  startCanvasPan,
  onCanvasPan,
  stopCanvasPan,
  onViewportClick,
  handleWheelZoom,
  zoomStepCenter,
} = navigation;

const personById = computed(() => {
  const m = new Map<string, Person>();
  for (const p of props.persons) m.set(p.id, p);
  return m;
});

function onSelectPersonFromCanvas(personId: string) {
  const p = personById.value.get(personId) || null;
  emit('select', p);
}

function focusPersonIfVisible(personId: string, rightDrawerOpen: boolean = false): boolean {
  const ok = focusCardByPersonId(personId, rightDrawerOpen);
  if (!ok) return false;
  store.selectedPersonId.value = personId;
  store.selectedGroupKey.value = '';
  store.selectedEdgeKey.value = '';
  onSelectPersonFromCanvas(personId);
  return true;
}

const activeDocumentName = computed(() => store.activeDocument.value?.name || null);

defineExpose({
  focusPersonIfVisible,
  handleExternalDesignSync: store.handleExternalDesignSync,
  activeDocumentId: store.activeDocumentId,
  activeDocumentName,
  isDirty: store.isDirty,
});

watch(
  () => props.selectedId,
  nextId => {
    if (nextId && nextId !== store.selectedPersonId.value) {
      store.selectedPersonId.value = nextId;
    } else if (!nextId && store.selectedPersonId.value) {
      store.selectedPersonId.value = '';
    }
  }
);

watch(
  () => store.activeDocumentId.value,
  () => {
    nextTick(() => {
      fitToScreen();
    });
  }
);

function onCardConfigChanged(cfg: DesignCardConfig) {
  emit('update-card-config', cfg);
  emit('update-design-config', { cardConfig: cfg });
}

function handleKeyDown(e: KeyboardEvent) {
  const target = e.target as HTMLElement | null;
  if (
    target &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable)
  ) {
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) {
      store.redo();
    } else {
      store.undo();
    }
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    store.redo();
  } else if (e.key === 'Escape') {
    isBgPopoverOpen.value = false;
    navigation.clearSelection();
  }
}

onMounted(async () => {
  window.addEventListener('keydown', handleKeyDown);
  await store.initStudioForActiveRoot();
  await nextTick();
  fitToScreen();
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
});
</script>

<template>
  <div class="design-mode-wrapper">
    <DesignSidebar
      :store="store"
      :root-ancestors="rootAncestors"
      :persons="persons"
      :is-bg-popover-open="isBgPopoverOpen"
      :fit-to-screen="fitToScreen"
      :center-on-origin="centerOnOrigin"
      @update:is-bg-popover-open="val => { isBgPopoverOpen = val }"
      @select-proband="pid => emit('select-proband', pid)"
      @open-settings="emit('open-settings')"
      @card-config-changed="onCardConfigChanged"
      @tree-imported="name => emit('tree-imported', name)"
    />

    <DesignCanvas
      :store="store"
      :pan="pan"
      :zoom="zoom"
      :is-panning="isPanning"
      :is-details-open="isDetailsOpen"
      :highlighted-path-ids="highlightedPathIds"
      :saved-subtree-list="store.savedSubtreeList.value"
      :set-viewport-ref="el => { viewportRef = el }"
      :start-canvas-pan="startCanvasPan"
      :on-canvas-pan="onCanvasPan"
      :stop-canvas-pan="stopCanvasPan"
      :on-viewport-click="onViewportClick"
      :handle-wheel-zoom="handleWheelZoom"
      :zoom-step-center="zoomStepCenter"
      :center-on-origin="centerOnOrigin"
      :fit-to-screen="fitToScreen"
      @select-person="onSelectPersonFromCanvas"
      @open-details="pid => emit('open-details', pid)"
    />

    <!-- Status- & Fehlermeldungen -->
    <div v-if="store.statusToast.value" class="studio-toast success">
      ✓ {{ store.statusToast.value }}
    </div>
    <div v-if="store.errorToast.value" class="studio-toast error">
      ⚠ {{ store.errorToast.value }}
    </div>
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
  overflow: hidden;
}

.studio-toast {
  position: absolute;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 150;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 600;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.22);
  pointer-events: none;
}

.studio-toast.success {
  background: #064e3b;
  color: #ecfdf5;
  border: 1px solid #10b981;
}

.studio-toast.error {
  background: #7f1d1d;
  color: #fef2f2;
  border: 1px solid #ef4444;
}
</style>
