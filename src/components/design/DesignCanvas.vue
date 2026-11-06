<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  DesignCardConfig,
  DesignBackgroundConfig,
  DesignLayoutType,
  SubtreeBackground,
} from '../../types/design';
import type { DesignSiblingGroup, BranchWidthConstraint } from '../../composables/useDesignHistory';
import {
  type DesignPerson,
  type LevelBandInfo,
  type RenderedCardData,
  type GroupLayoutInfo,
  type RenderedBranchWidth,
  type EdgeGeometry,
} from '../../composables/useDesignLayout';
import DesignConnectorLayer from './DesignConnectorLayer.vue';
import DesignPersonCard from './DesignPersonCard.vue';

const { t } = useI18n();

const props = defineProps<{
  pan: { x: number; y: number };
  zoom: number;
  isPanning: boolean;
  canvasWidth: number;
  canvasHeight: number;
  totalLevels: number;
  levelsTopToBottom: LevelBandInfo[];
  groupLayouts: GroupLayoutInfo[];
  renderedBranchWidths: RenderedBranchWidth[];
  edgeGeometry: EdgeGeometry;
  cardDataByPersonId: Map<string, RenderedCardData>;
  activeCardConfig: DesignCardConfig;
  activeDesignPersonId: string;
  selectedId: string;
  branchWidths: Map<string, BranchWidthConstraint>;
  highlightedPathIds?: Set<string>;
  draggingGroupId: string | null;
  draggingClusterGroupIds: Set<string>;
  dragHoverInsertAboveLevel: number | null;
  activeSnapGuideX: number | null;
  draggingBwId: string | null;
  bgImageData: string | null;
  bgConfig: DesignBackgroundConfig;
  isBgDraggingOnCanvas: boolean;
  canUndo: boolean;
  subtreeBackgrounds?: SubtreeBackground[];
  currentLayoutType?: DesignLayoutType;
  currentLayoutName?: string;
  // Navigation & Viewport handlers
  setViewportRef: (el: HTMLElement | null) => void;
  startCanvasPan: (e: MouseEvent) => void;
  onCanvasPan: (e: MouseEvent) => void;
  stopCanvasPan: () => void;
  onViewportClick: (e: MouseEvent) => void;
  handleWheelZoom: (e: WheelEvent) => void;
  zoomStepCenter: (factor: number) => void;
  centerOnOrigin: () => void;
  fitToScreen: () => void;
  // Layout query & action functions
  getLevelBandTopY: (level: number) => number;
  hasDescendants: (personId: string) => boolean;
  isParentExpanded: (personId: string) => boolean;
  toggleDescendants: (personId: string) => void;
  isPersonSelected: (personId: string) => boolean;
  selectCardPerson: (person: DesignPerson) => void;
  startGroupDrag: (e: MouseEvent, grp: DesignSiblingGroup) => void;
  startBranchWidthDrag: (e: MouseEvent, personId: string) => void;
  startBranchWidthResize: (e: MouseEvent, personId: string, side: 'left' | 'right') => void;
  removeBranchWidth: (personId: string) => void;
  groupDescendantsByLevel: (rootPersonId: string) => void;
  ungroupAtPerson: (grp: DesignSiblingGroup, anchorPersonId: string, direction: 'left' | 'right') => void;
  getSelectedOrAnchorPersonId: (gl: GroupLayoutInfo) => string;
  regroupSelectedOrFirstInGroup: (gl: GroupLayoutInfo) => void;
  groupAllInLevel: (level: number) => void;
  detachPersonFromGroup: (grp: DesignSiblingGroup, personId: string) => void;
  canRegroupPerson: (personId: string) => boolean;
  regroupSiblingsForPerson: (personId: string) => void;
  dockToNeighbor: (grp: DesignSiblingGroup, direction: 'left' | 'right') => void;
  moveGroupLevel: (grp: DesignSiblingGroup, delta: number) => void;
  insertLevelAboveAndMoveGroup: (grp: DesignSiblingGroup) => void;
  movePersonWithinGroup: (grp: DesignSiblingGroup, personId: string, dir: -1 | 1) => void;
  moveSinglePersonLevel: (grp: DesignSiblingGroup, personId: string, deltaLevel: number) => void;
  insertEmptyLevelAbove: (targetLevel: number) => void;
  removeEmptyLevel: (levelToRemove: number) => void;
}>();

const emit = defineEmits<{
  (e: 'update:isBgDraggingOnCanvas', val: boolean): void;
  (e: 'drop-bg-file', file: File): void;
  (e: 'undo'): void;
  (e: 'create-new-design'): void;
  (e: 'open-load-modal'): void;
  (e: 'open-save-modal'): void;
  (e: 'open-subtree', layoutId: string): void;
}>();

const localViewportRef = ref<HTMLElement | null>(null);
const isBgMoving = ref<boolean>(false);

watch(localViewportRef, (newEl, oldEl) => {
  if (oldEl) {
    oldEl.removeEventListener('wheel', props.handleWheelZoom);
  }
  props.setViewportRef(newEl);
  if (newEl) {
    newEl.addEventListener('wheel', props.handleWheelZoom, { passive: false });
  }
});

onMounted(() => {
  if (localViewportRef.value) {
    props.setViewportRef(localViewportRef.value);
    localViewportRef.value.addEventListener('wheel', props.handleWheelZoom, { passive: false });
  }
});

onUnmounted(() => {
  if (localViewportRef.value) {
    localViewportRef.value.removeEventListener('wheel', props.handleWheelZoom);
  }
  props.setViewportRef(null);
  window.removeEventListener('mousemove', onBgMouseMove);
  window.removeEventListener('mouseup', onBgMouseUp);
});

const bgDisplayWidth = computed<number>(() => {
  const base = props.bgConfig.naturalWidth || 1200;
  return Math.max(20, Math.round(base * (props.bgConfig.scale / 100)));
});

const bgDisplayHeight = computed<number>(() => {
  const base = props.bgConfig.naturalHeight || 800;
  return Math.max(20, Math.round(base * (props.bgConfig.scale / 100)));
});

const bgContainerStyle = computed(() => {
  return {
    position: 'absolute' as const,
    left: props.bgConfig.x + 'px',
    top: props.bgConfig.y + 'px',
    width: bgDisplayWidth.value + 'px',
    height: bgDisplayHeight.value + 'px',
    opacity: props.isBgDraggingOnCanvas
      ? Math.max(0.4, Math.min(props.bgConfig.opacity / 100, 0.85))
      : props.bgConfig.opacity / 100,
    pointerEvents: props.isBgDraggingOnCanvas ? ('auto' as const) : ('none' as const),
    userSelect: 'none' as const,
    zIndex: props.isBgDraggingOnCanvas ? 70 : 0,
    cursor: props.isBgDraggingOnCanvas ? (isBgMoving.value ? 'grabbing' : 'grab') : 'default',
  };
});

const bgImageStyle = computed(() => {
  return {
    width: '100%',
    height: '100%',
    objectFit: 'contain' as const,
    display: 'block',
    pointerEvents: 'none' as const,
  };
});

function onViewportFileDrop(e: DragEvent) {
  const file = e.dataTransfer?.files?.[0];
  if (file && (file.type.startsWith('image/') || file.name.match(/\.(jpg|jpeg|png|svg|webp)$/i))) {
    emit('drop-bg-file', file);
  }
}

function onBgImageLoaded(e: Event) {
  const img = e.target as HTMLImageElement;
  if (img && img.naturalWidth && (!props.bgConfig.naturalWidth || !props.bgConfig.naturalHeight)) {
    props.bgConfig.naturalWidth = img.naturalWidth;
    props.bgConfig.naturalHeight = img.naturalHeight;
    if (props.bgConfig.x === 0 && props.bgConfig.y === 0) {
      props.bgConfig.x = Math.round((props.canvasWidth - bgDisplayWidth.value) / 2);
      props.bgConfig.y = Math.round((props.canvasHeight - bgDisplayHeight.value) / 2);
    }
  }
}

let bgDragStartMouseX = 0;
let bgDragStartMouseY = 0;
let bgDragInitialX = 0;
let bgDragInitialY = 0;

function onBgMouseDown(e: MouseEvent) {
  if (!props.isBgDraggingOnCanvas) return;
  if (e.button !== 0) return;
  e.stopPropagation();
  e.preventDefault();
  isBgMoving.value = true;
  bgDragStartMouseX = e.clientX;
  bgDragStartMouseY = e.clientY;
  bgDragInitialX = props.bgConfig.x;
  bgDragInitialY = props.bgConfig.y;
  window.addEventListener('mousemove', onBgMouseMove);
  window.addEventListener('mouseup', onBgMouseUp);
}

function onBgMouseMove(e: MouseEvent) {
  const dx = (e.clientX - bgDragStartMouseX) / props.zoom;
  const dy = (e.clientY - bgDragStartMouseY) / props.zoom;
  props.bgConfig.x = Math.round(bgDragInitialX + dx);
  props.bgConfig.y = Math.round(bgDragInitialY + dy);
}

function onBgMouseUp() {
  isBgMoving.value = false;
  window.removeEventListener('mousemove', onBgMouseMove);
  window.removeEventListener('mouseup', onBgMouseUp);
}
</script>

<template>
  <div
    ref="localViewportRef"
    class="design-viewport"
    :class="{ panning: isPanning }"
    @mousedown="startCanvasPan"
    @mousemove="onCanvasPan"
    @mouseup="stopCanvasPan"
    @mouseleave="stopCanvasPan"
    @click="onViewportClick"
    @dragover.prevent
    @drop.prevent="onViewportFileDrop"
  >
    <!-- Floating Ebenenkonfiguration immer am linken Bildschirmrand der jeweiligen Zeile -->
    <div class="floating-level-controls-container" @mousedown.stop>
      <div
        v-for="lvlInfo in levelsTopToBottom"
        :key="'flp-lvl-' + lvlInfo.level"
        class="floating-level-panel"
        :class="{
          'is-origin-level': lvlInfo.level === 1,
          'is-multi-gen': lvlInfo.generations.length > 1,
        }"
        :style="{
          top: (pan.y + lvlInfo.bandTopY * zoom) + 'px',
          height: (lvlInfo.height * zoom) + 'px',
        }"
      >
        <div class="flp-header">
          <span class="flp-level-title">{{ t('design_level') }} {{ lvlInfo.level }}</span>
          <div class="flp-actions">
            <button
              class="flp-btn flp-btn-group"
              :class="{ disabled: lvlInfo.groupCount <= 1 }"
              :disabled="lvlInfo.groupCount <= 1"
              :title="t('design_group_row_tooltip')"
              @click.stop="groupAllInLevel(lvlInfo.level)"
            >
              🔗
            </button>
            <button
              class="flp-btn flp-btn-add"
              :title="t('design_insert_level_above')"
              @click.stop="insertEmptyLevelAbove(lvlInfo.level)"
            >
              ➕
            </button>
            <button
              v-if="lvlInfo.groupCount === 0 && totalLevels > 1"
              class="flp-btn flp-btn-del"
              :title="t('remove')"
              @click.stop="removeEmptyLevel(lvlInfo.level)"
            >
              🗑️
            </button>
          </div>
        </div>

        <!-- Dynamische Höhe des Ebenenabstandes pro Ebene -->
        <div class="flp-height-row">
          <span class="flp-h-label">{{ t('design_level_height') }}:</span>
          <span class="flp-h-badge">{{ lvlInfo.height }} px</span>
        </div>

        <div class="flp-badges-row">
          <span
            v-for="gNum in lvlInfo.generations"
            :key="'flp-g-' + lvlInfo.level + '-' + gNum"
            class="flp-gen-pill"
          >
            Gen. {{ gNum }}
          </span>
          <span v-if="lvlInfo.generations.length === 0" class="flp-empty-hint">– leer –</span>
        </div>
        <div v-if="lvlInfo.level === 1" class="flp-origin-tag">
          ⬆️ {{ t('design_origin_proband') }}
        </div>
      </div>
    </div>

    <div
      class="design-canvas"
      :style="{
        width: canvasWidth + 'px',
        height: canvasHeight + 'px',
        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
      }"
    >
      <!-- 0. Hintergrundbild-Ebene (hinter dem Ebenengitter und allen Einträgen; temporär im Vordergrund beim Verschieben) -->
      <div
        v-if="bgImageData && bgConfig.visible"
        class="design-bg-image-container"
        :class="{
          'is-interactive-dragging': isBgDraggingOnCanvas,
          'is-moving': isBgMoving,
        }"
        :style="bgContainerStyle"
        @mousedown="onBgMouseDown"
      >
        <img
          :src="bgImageData"
          class="design-bg-image"
          :style="bgImageStyle"
          alt="Hintergrundbild"
          @load="onBgImageLoaded"
          draggable="false"
        />
        <div v-if="isBgDraggingOnCanvas" class="bg-drag-overlay" @mousedown.stop>
          <span>✥ {{ t('design_bg_image_moving_badge') }}</span>
          <button
            type="button"
            class="btn-bg-drag-finish"
            @click.stop="emit('update:isBgDraggingOnCanvas', false)"
            :title="t('design_bg_image_finish_drag')"
          >
            ✓ {{ t('design_bg_image_finish_drag') }}
          </button>
        </div>
      </div>

      <!-- 0b. Subtree-Hintergrundbilder (lokale Wappen/Bilder verknüpfter Zweige) -->
      <div
        v-for="subBg in subtreeBackgrounds"
        :key="subBg.anchorPersonId"
        class="design-subtree-bg-container"
        :style="{
          position: 'absolute',
          left: `${subBg.originX}px`,
          top: `${subBg.originY}px`,
          zIndex: 1,
          pointerEvents: 'none',
        }"
      >
        <img
          :src="subBg.imageData"
          class="design-subtree-bg-image"
          :style="{
            transform: `scale(${(subBg.config.scale || 100) / 100})`,
            opacity: (subBg.config.opacity !== undefined ? subBg.config.opacity : 45) / 100,
            transformOrigin: 'top left',
            display: 'block',
          }"
          :alt="subBg.layoutName"
          draggable="false"
        />
      </div>

      <!-- Horizontale Ebenen-Bänder (von oben nach unten gerendert, Ebene 1 = unten beim Stammahn) -->
      <div
        v-for="lvlInfo in levelsTopToBottom"
        :key="'lvl-band-' + lvlInfo.level"
        class="level-band"
        :class="{
          'is-origin-level': lvlInfo.level === 1,
          'is-multi-gen': lvlInfo.generations.length > 1,
        }"
        :style="{
          top: lvlInfo.bandTopY + 'px',
          height: lvlInfo.height + 'px',
        }"
      ></div>

      <!-- Drop-Indikator zum Einfügen einer neuen Zwischen-Ebene beim vertikalen Ziehen -->
      <div
        v-if="dragHoverInsertAboveLevel !== null"
        class="insert-level-indicator"
        :style="{
          top: (getLevelBandTopY(dragHoverInsertAboveLevel) - 14) + 'px',
        }"
      >
        <span>➕ {{ t('design_insert_level_above') }}</span>
      </div>

      <!-- Visuelle Hilfslinie bei aktivem Rahmenlinien-Kontakt (Snap) -->
      <div
        v-if="activeSnapGuideX !== null"
        class="snap-contact-guide"
        :style="{ left: activeSnapGuideX + 'px', height: canvasHeight + 'px' }"
      ></div>

      <!-- Reservierte Bereiche um Einträge und alle Ebenen oberhalb -->
      <template v-for="bw in renderedBranchWidths" :key="'bw-' + bw.personId">
        <div
          class="branch-corridor-zone"
          :class="{
            'is-dragging': draggingBwId === bw.personId,
            'is-nested': bw.isNested,
          }"
          :style="{
            left: bw.minX + 'px',
            top: bw.corridorTopY + 'px',
            width: bw.width + 'px',
            height: bw.corridorHeight + 'px',
            zIndex: bw.zIndex,
          }"
          @mousedown="startBranchWidthDrag($event, bw.personId)"
        ></div>
        <div
          class="branch-width-bar"
          :class="{
            'is-dragging': draggingBwId === bw.personId,
            'is-nested': bw.isNested,
          }"
          :style="{
            left: bw.minX + 'px',
            top: bw.barY + 'px',
            width: bw.width + 'px',
            zIndex: bw.barZIndex,
          }"
          @mousedown="startBranchWidthDrag($event, bw.personId)"
        >
          <div
            class="bw-handle bw-handle-left"
            title="Linke Grenze anpassen"
            @mousedown.stop="startBranchWidthResize($event, bw.personId, 'left')"
          >◀</div>
          <div
            class="bw-bar-label"
            :title="t('design_move_branch_tooltip')"
          >
            <span class="bw-drag-handle-icon">✥</span>
            <span>📐 {{ bw.personName }}</span>
            <button
              class="bw-remove-btn"
              :title="t('remove')"
              @mousedown.stop
              @click.stop="removeBranchWidth(bw.personId)"
            >✕</button>
          </div>
          <div
            class="bw-handle bw-handle-right"
            title="Rechte Grenze anpassen"
            @mousedown.stop="startBranchWidthResize($event, bw.personId, 'right')"
          >▶</div>
        </div>
      </template>

      <!-- SVG-Layer für alle Kanten inkl. Linienbrücken -->
      <DesignConnectorLayer
        :canvas-width="canvasWidth"
        :canvas-height="canvasHeight"
        :edge-geometry="edgeGeometry"
      />

      <!-- Verschiebbare Geschwistergruppen & Einzeleinträge (gedockte Einträge werden gemeinsam verschoben) -->
      <div
        v-for="gl in groupLayouts"
        :key="gl.group.id"
        class="sibling-group-container"
        :class="{
          'is-dragging': draggingGroupId === gl.group.id || draggingClusterGroupIds.has(gl.group.id),
          'is-docked': gl.isDocked,
          'is-origin-group': gl.group.parentId === null,
          'is-multi-sibling-group': gl.cards.length > 1,
          'is-subtree-readonly': gl.isReadOnly,
        }"
        :style="{
          left: gl.left + 'px',
          top: gl.top + 'px',
          width: gl.width + 'px',
          height: gl.height + 'px',
        }"
        @mousedown="startGroupDrag($event, gl.group)"
      >
        <!-- Schwebende Gruppen-Aktionsleiste: erst auf Select eines Eintrags dieser Gruppe dynamisch nachgeladen -->
        <div
          v-if="gl.cards.some(c => isPersonSelected(c.person.id))"
          class="group-floating-controls"
          :class="{ 'is-readonly': gl.isReadOnly }"
          @mousedown.stop
        >
          <template v-if="gl.isReadOnly">
            <span class="readonly-subtree-pill">🔒 {{ gl.subtreeLayoutName || t('design_subtree_readonly') }}</span>
            <button
              v-if="gl.subtreeLayoutId"
              class="grp-btn grp-btn-edit-subtree"
              :title="t('design_edit_subtree_tooltip')"
              @click.stop="emit('open-subtree', gl.subtreeLayoutId)"
            >
              🌱 {{ t('design_edit_subtree') }}
            </button>
          </template>
          <template v-else>
            <button
              class="grp-btn"
              :title="t('design_dock_left')"
              @click.stop="dockToNeighbor(gl.group, 'left')"
            >
              ⇤
            </button>
            <button
              class="grp-btn"
              :title="t('design_dock_right')"
              @click.stop="dockToNeighbor(gl.group, 'right')"
            >
              ⇥
            </button>
            <button
              class="grp-btn"
              :title="t('design_move_group_up')"
              @click.stop="moveGroupLevel(gl.group, 1)"
            >
              ▲
            </button>
            <button
              class="grp-btn"
              :disabled="gl.group.level <= 1"
              :title="t('design_move_group_down')"
              @click.stop="moveGroupLevel(gl.group, -1)"
            >
              ▼
            </button>
            <button
              class="grp-btn grp-btn-split"
              :title="t('design_split_group_level')"
              @click.stop="insertLevelAboveAndMoveGroup(gl.group)"
            >
              ➕
            </button>
            <!-- Geschwistergruppe nach links oder rechts auflösen -->
            <button
              v-if="gl.cards.length > 1"
              class="grp-btn grp-btn-ungroup"
              :title="t('design_ungroup_left_tooltip')"
              @click.stop="ungroupAtPerson(gl.group, getSelectedOrAnchorPersonId(gl), 'left')"
            >
              ✂️◀ {{ t('design_ungroup_left') }}
            </button>
            <button
              v-if="gl.cards.length > 1"
              class="grp-btn grp-btn-ungroup"
              :title="t('design_ungroup_right_tooltip')"
              @click.stop="ungroupAtPerson(gl.group, getSelectedOrAnchorPersonId(gl), 'right')"
            >
              ✂️▶ {{ t('design_ungroup_right') }}
            </button>
            <!-- Aufgelöste Geschwister wieder zu einer Gruppe zusammenfassen -->
            <button
              v-else-if="gl.canRegroup"
              class="grp-btn grp-btn-regroup"
              :title="t('design_regroup_tooltip')"
              @click.stop="regroupSelectedOrFirstInGroup(gl)"
            >
              {{ t('design_regroup_btn') }}
            </button>
          </template>
        </div>

        <!-- Personen-Boxen: Rahmenlinien von Geschwisterkindern stoßen direkt aneinander an -->
        <div class="sibling-cards-row">
          <div
            v-for="subGrp in gl.siblingSubGroups"
            :key="subGrp.id"
            class="sibling-subgroup-block"
            :class="{
              'is-multi-sibling': subGrp.isMultiSibling,
              'in-larger-union': gl.siblingSubGroups.length > 1,
            }"
          >
            <!-- Nachname pro Geschwistergruppe linksbündig oberhalb der Kachel -->
            <div
              v-if="subGrp.surname"
              class="subgroup-surname-label"
              :title="subGrp.surname"
            >
              {{ subGrp.surname }}
            </div>

            <DesignPersonCard
              v-for="cb in subGrp.cards"
              :key="cb.person.id"
              :card-box="cb"
              :card-data="cardDataByPersonId.get(cb.person.id)"
              :card-config="activeCardConfig"
              :is-selected="Boolean(activeDesignPersonId || selectedId) && (activeDesignPersonId || selectedId) === cb.person.id"
              :has-branch-width="branchWidths.has(cb.person.id)"
              :in-partner-path="Boolean(highlightedPathIds && highlightedPathIds.size > 0 && highlightedPathIds.has(cb.person.id))"
              :has-descendants="hasDescendants(cb.person.id)"
              :is-expanded="isParentExpanded(cb.person.id)"
              :can-regroup="canRegroupPerson(cb.person.id)"
              :group-card-count="gl.cards.length"
              :card-index-in-group="gl.cards.findIndex(c => c.person.id === cb.person.id)"
              :group-level="gl.group.level"
              :is-group-docked="gl.isDocked"
              :is-multi-sibling-group="gl.cards.length > 1"
              :is-origin-group="gl.group.parentId === null"
              :is-group-dragging="draggingGroupId === gl.group.id || draggingClusterGroupIds.has(gl.group.id)"
              @select="selectCardPerson(cb.person)"
              @group-descendants="groupDescendantsByLevel(cb.person.id)"
              @toggle-descendants="toggleDescendants(cb.person.id)"
              @regroup-siblings="regroupSiblingsForPerson(cb.person.id)"
              @ungroup-left="ungroupAtPerson(gl.group, cb.person.id, 'left')"
              @ungroup-right="ungroupAtPerson(gl.group, cb.person.id, 'right')"
              @move-left="movePersonWithinGroup(gl.group, cb.person.id, -1)"
              @move-right="movePersonWithinGroup(gl.group, cb.person.id, 1)"
              @move-up="moveSinglePersonLevel(gl.group, cb.person.id, 1)"
              @move-down="moveSinglePersonLevel(gl.group, cb.person.id, -1)"
              @detach="detachPersonFromGroup(gl.group, cb.person.id)"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Schwebende Zoom-Steuerung -->
    <div class="design-zoom-controls" @mousedown.stop @wheel.stop>
      <button @click="zoomStepCenter(0.9)" title="Rauszoomen">➖</button>
      <span>{{ Math.round(zoom * 100) }}%</span>
      <button @click="zoomStepCenter(1.1)" title="Reinzoomen">➕</button>
      <div class="zoom-divider"></div>
      <button class="btn-center-origin" @click="centerOnOrigin" :title="t('reset_root')">
        {{ t('reset_root') }}
      </button>
      <button class="btn-fit-screen" @click="fitToScreen" :title="t('design_fit_to_screen_tooltip')">
        {{ t('design_fit_to_screen') }}
      </button>
    </div>

    <!-- Buttons mit den Speichern und Laden Funktionen liegen unten rechts als Overlay -->
    <div class="design-persist-overlay" @mousedown.stop @wheel.stop>
      <!-- Zurück / Undo Button: Kreis mit "Zurück" Icon -->
      <button
        class="persist-circle-btn persist-btn-undo"
        :class="{ disabled: !canUndo }"
        :disabled="!canUndo"
        :title="t('design_undo_tooltip')"
        @click.stop="emit('undo')"
      >
        ↩️
      </button>
      <!-- Neu / Neue Datei Button: Kreis mit "Neues Dokument" Icon -->
      <button
        class="persist-circle-btn persist-btn-new"
        :title="t('design_new_file_tooltip')"
        @click.stop="emit('create-new-design')"
      >
        📄
      </button>
      <!-- Laden Button: etwas kleinerer Kreis mit "Open File" Icon -->
      <button
        class="persist-circle-btn persist-btn-load"
        :title="t('design_load_tooltip')"
        @click.stop="emit('open-load-modal')"
      >
        📂
      </button>
      <!-- Speichern Button: etwas größerer Kreis mit "Diskette" Icon -->
      <button
        class="persist-circle-btn persist-btn-save"
        :title="t('design_save_tooltip')"
        @click.stop="emit('open-save-modal')"
      >
        💾
      </button>
    </div>
  </div>
</template>

<style scoped>
/* Viewport & Canvas */
.design-viewport {
  flex-grow: 1;
  overflow: hidden;
  position: relative;
  cursor: grab;
  background: #f4f6f9;
  user-select: none;
  -webkit-user-select: none;
}
.design-viewport.panning {
  cursor: grabbing;
}
.design-viewport.drawing-width-cursor {
  cursor: ew-resize;
}
.design-canvas {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
}

/* Horizontale Ebenen-Bänder */
.level-band {
  position: absolute;
  left: 0;
  right: 0;
  border-bottom: 1px dashed #cbd5e1;
  background: rgba(255, 255, 255, 0.45);
  box-sizing: border-box;
}
.level-band:nth-child(even) {
  background: rgba(237, 242, 247, 0.55);
}
.level-band.is-origin-level {
  background: rgba(232, 248, 245, 0.55);
  border-bottom: 2px solid #1abc9c;
}
.level-band.is-multi-gen {
  background: rgba(254, 249, 231, 0.6);
}
.level-band.is-draw-target-level {
  background: rgba(142, 68, 173, 0.1) !important;
  border-top: 2px dashed #8e44ad;
  border-bottom: 2px dashed #8e44ad;
  cursor: ew-resize;
}

/* Floating Ebenenkonfiguration am linken Bildschirmrand der jeweiligen Zeile */
.floating-level-controls-container {
  position: absolute;
  left: 8px;
  top: 0;
  bottom: 0;
  width: 195px;
  pointer-events: none;
  z-index: 45;
  overflow: visible;
}
.floating-level-panel {
  position: absolute;
  left: 0;
  width: 195px;
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid #cbd5e1;
  border-left: 4px solid #64748b;
  border-radius: 6px;
  padding: 5px 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  pointer-events: auto;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: 3px;
  max-height: 100%;
  overflow: hidden;
  font-size: 0.72rem;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.floating-level-panel.is-origin-level {
  border-left-color: #1abc9c;
  background: rgba(240, 253, 250, 0.97);
}
.floating-level-panel.is-multi-gen {
  border-left-color: #d35400;
}
.floating-level-panel:hover {
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.16);
  border-color: #94a3b8;
}
.flp-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 4px;
}
.flp-level-title {
  font-weight: bold;
  font-size: 0.78rem;
  color: #1e293b;
}
.flp-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}
.flp-btn {
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  border-radius: 3px;
  padding: 1px 4px;
  font-size: 0.68rem;
  cursor: pointer;
  line-height: 1.1;
  color: #334155;
  transition: background 0.12s, border-color 0.12s;
}
.flp-btn:hover:not(:disabled) {
  background: #e2e8f0;
  border-color: #94a3b8;
}
.flp-btn:disabled,
.flp-btn.disabled {
  opacity: 0.35;
  cursor: not-allowed;
  border-color: #cbd5e1;
}
.flp-btn-group {
  background: #eafaf1;
  color: #27ae60;
  border-color: #a3e4d7;
}
.flp-btn-group:hover:not(:disabled) {
  background: #27ae60;
  color: white;
  border-color: #1e8449;
}
.flp-btn-add {
  background: #ebf5fb;
  color: #2980b9;
  border-color: #aed6f1;
}
.flp-btn-add:hover:not(:disabled) {
  background: #3498db;
  color: white;
  border-color: #2980b9;
}
.flp-btn-del:hover:not(:disabled) {
  background: #fadbd8;
  color: #c0392b;
  border-color: #e74c3c;
}
.flp-height-row {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.7rem;
  color: #475569;
}
.flp-h-label {
  font-weight: 600;
}
.flp-h-badge {
  font-size: 0.72rem;
  font-weight: 700;
  color: #1e40af;
  background: #eff6ff;
  padding: 1px 5px;
  border-radius: 3px;
  border: 1px solid #bfdbfe;
}
.flp-badges-row {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}
.flp-gen-pill {
  background: #3498db;
  color: white;
  font-size: 0.65rem;
  font-weight: bold;
  padding: 1px 4px;
  border-radius: 3px;
}
.floating-level-panel.is-multi-gen .flp-gen-pill {
  background: #d35400;
}
.flp-empty-hint {
  font-size: 0.68rem;
  color: #95a5a6;
  font-style: italic;
}
.flp-origin-tag {
  font-size: 0.66rem;
  font-weight: bold;
  color: #16a085;
}

/* Zweig-Breite & Korridor-Abgrenzung */
.branch-corridor-zone {
  position: absolute;
  background: rgba(142, 68, 173, 0.055);
  border-left: 2px dashed rgba(142, 68, 173, 0.65);
  border-right: 2px dashed rgba(142, 68, 173, 0.65);
  pointer-events: auto;
  cursor: grab;
  z-index: 3;
  box-sizing: border-box;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.branch-corridor-zone.is-dragging {
  cursor: grabbing;
  background: rgba(142, 68, 173, 0.12);
  border-left: 2.5px dashed #8e44ad;
  border-right: 2.5px dashed #8e44ad;
}
.branch-corridor-zone.is-nested {
  background: rgba(39, 174, 96, 0.065);
  border-left-color: rgba(39, 174, 96, 0.75);
  border-right-color: rgba(39, 174, 96, 0.75);
}
.branch-corridor-zone.is-nested.is-dragging {
  cursor: grabbing;
  background: rgba(39, 174, 96, 0.15);
  border-left: 2.5px dashed #27ae60;
  border-right: 2.5px dashed #27ae60;
}
.branch-width-bar {
  position: absolute;
  height: 18px;
  background: rgba(142, 68, 173, 0.16);
  border-top: 3px solid #8e44ad;
  border-left: 3px solid #8e44ad;
  border-right: 3px solid #8e44ad;
  border-radius: 4px 4px 0 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  z-index: 28;
  box-sizing: border-box;
  cursor: grab;
  user-select: none;
  transition: background 0.12s ease, box-shadow 0.12s ease;
}
.branch-width-bar:hover {
  background: rgba(142, 68, 173, 0.25);
  box-shadow: 0 2px 8px rgba(142, 68, 173, 0.28);
}
.branch-width-bar.is-dragging {
  cursor: grabbing;
  background: rgba(142, 68, 173, 0.35);
  border-top-color: #6c3483;
  border-left-color: #6c3483;
  border-right-color: #6c3483;
  box-shadow: 0 4px 14px rgba(142, 68, 173, 0.45);
}
.branch-width-bar.is-nested {
  background: rgba(39, 174, 96, 0.18);
  border-top-color: #27ae60;
  border-left-color: #27ae60;
  border-right-color: #27ae60;
}
.branch-width-bar.is-nested:hover {
  background: rgba(39, 174, 96, 0.28);
  box-shadow: 0 2px 8px rgba(39, 174, 96, 0.3);
}
.branch-width-bar.is-nested.is-dragging {
  background: rgba(39, 174, 96, 0.38);
  border-top-color: #1e8449;
  border-left-color: #1e8449;
  border-right-color: #1e8449;
}
.branch-width-bar.is-nested .bw-handle {
  background: #27ae60;
}
.bw-handle {
  width: 18px;
  height: 18px;
  background: #8e44ad;
  color: white;
  font-size: 0.6rem;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: ew-resize;
  flex-shrink: 0;
  user-select: none;
}
.bw-handle:hover {
  background: #6c3483;
}
.bw-bar-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.68rem;
  color: #4a235a;
  background: rgba(255, 255, 255, 0.92);
  padding: 0 6px;
  border-radius: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: grab;
  user-select: none;
}
.branch-width-bar.is-dragging .bw-bar-label {
  cursor: grabbing;
}
.bw-drag-handle-icon {
  font-size: 0.78rem;
  color: #8e44ad;
  display: inline-block;
  user-select: none;
  line-height: 1;
}
.bw-remove-btn {
  background: transparent;
  color: #c0392b;
  border: none;
  padding: 0 2px;
  font-size: 0.72rem;
  font-weight: bold;
  cursor: pointer;
  line-height: 1;
}
.bw-remove-btn:hover {
  color: #e74c3c;
}

.insert-level-indicator {
  position: absolute;
  left: 190px;
  right: 20px;
  height: 28px;
  background: rgba(46, 204, 113, 0.18);
  border: 2px dashed #27ae60;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #1e8449;
  font-weight: bold;
  font-size: 0.82rem;
  z-index: 30;
  pointer-events: none;
}

.snap-contact-guide {
  position: absolute;
  top: 0;
  width: 2px;
  background: #e67e22;
  z-index: 35;
  pointer-events: none;
}

/* Geschwistergruppen-Container: Hält die Kacheln zusammen beim Verschieben */
.sibling-group-container {
  position: absolute;
  background: transparent;
  box-sizing: border-box;
  cursor: move;
  z-index: 10;
  transition: box-shadow 0.12s;
}
.sibling-group-container:hover {
  z-index: 25;
}
.sibling-group-container.is-dragging {
  z-index: 40;
}

/* Schwebende Steuerleiste der Gruppe (erscheint dynamisch bei selektiertem Eintrag) */
.group-floating-controls {
  position: absolute;
  bottom: -28px;
  right: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  background: rgba(15, 23, 42, 0.92);
  padding: 2px 5px;
  border-radius: 4px;
  z-index: 30;
  white-space: nowrap;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
}
.group-floating-controls.is-readonly {
  background: rgba(6, 78, 59, 0.95);
}
.readonly-subtree-pill {
  color: #a7f3d0;
  font-size: 0.68rem;
  font-weight: 600;
  padding: 1px 4px;
}
.grp-btn-edit-subtree {
  background: #10b981;
  color: #ffffff;
  border-color: #059669;
  font-size: 0.68rem;
  padding: 2px 6px;
  border-radius: 3px;
  cursor: pointer;
}
.grp-btn-edit-subtree:hover {
  background: #059669;
  border-color: #047857;
}
.design-sibling-group.is-subtree-readonly {
  border-style: dashed !important;
  border-color: #059669 !important;
  cursor: default !important;
}
.grp-btn {
  background: #ffffff;
  color: #1e293b;
  border: 1px solid #94a3b8;
  border-radius: 3px;
  padding: 1px 5px;
  font-size: 0.65rem;
  font-weight: bold;
  line-height: 1.25;
  cursor: pointer;
}
.grp-btn:hover:not(:disabled) {
  background: #3498db;
  color: white;
  border-color: #2980b9;
}
.grp-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.grp-btn-split:hover:not(:disabled) {
  background: #27ae60;
  border-color: #1e8449;
}
.grp-btn-ungroup {
  background: #fff3cd;
  color: #856404;
  border-color: #ffeeba;
}
.grp-btn-ungroup:hover:not(:disabled) {
  background: #e67e22;
  color: white;
  border-color: #d35400;
}
.grp-btn-regroup {
  background: #d4edda;
  color: #155724;
  border-color: #c3e6cb;
}
.grp-btn-regroup:hover:not(:disabled) {
  background: #27ae60;
  color: white;
}

/* Geschwisterkästchen-Reihe: Kacheln oben bündig ausgerichtet */
.sibling-cards-row {
  display: flex;
  align-items: flex-start;
  gap: 0;
  margin: 0;
  padding: 0;
  width: 100%;
}

/* Subgruppen-Block für Geschwistergruppen innerhalb eines größeren Gruppenverbandes */
.sibling-subgroup-block {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 0;
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  box-shadow: 0 0 0 3px #1e293b;
  border-radius: 4px;
}

.subgroup-surname-label {
  position: absolute;
  bottom: calc(100% + 3px);
  left: 0;
  font-size: 0.82rem;
  font-weight: 800;
  letter-spacing: 0.02em;
  color: #0f172a;
  white-space: nowrap;
  pointer-events: none;
  line-height: 1.25;
  user-select: none;
  background: rgba(248, 250, 252, 0.94);
  padding: 1px 7px;
  border-radius: 4px;
  border-left: 3px solid #2563eb;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12);
  z-index: 15;
}

/* Zoom-Controls unten links */
.design-zoom-controls {
  position: absolute;
  bottom: 20px;
  left: 20px;
  background: rgba(255, 255, 255, 0.95);
  padding: 8px 14px;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.15);
  display: flex;
  align-items: center;
  gap: 0.5rem;
  z-index: 50;
  border: 1px solid #bdc3c7;
}
.design-zoom-controls button {
  background: #ecf0f1;
  color: #2c3e50;
  border: 1px solid #bdc3c7;
  padding: 0.2rem 0.6rem;
  border-radius: 4px;
  font-size: 0.9rem;
  font-weight: bold;
  cursor: pointer;
}
.design-zoom-controls button:hover {
  background: #dcdde1;
}
.design-zoom-controls span {
  font-size: 0.85rem;
  font-weight: bold;
  width: 45px;
  text-align: center;
}
.zoom-divider {
  width: 1px;
  height: 20px;
  background: #bdc3c7;
  margin: 0 4px;
}
.btn-center-origin {
  background: #7f8c8d !important;
  color: white !important;
  font-size: 0.82rem !important;
}
.btn-fit-screen {
  background: #2980b9 !important;
  color: white !important;
  font-size: 0.82rem !important;
}
.btn-fit-screen:hover {
  background: #1f618d !important;
}

/* Overlay: Speichern & Laden Buttons (unten rechts) */
.design-persist-overlay {
  position: absolute;
  bottom: 24px;
  right: 24px;
  display: flex;
  align-items: center;
  gap: 12px;
  z-index: 50;
  pointer-events: auto;
}
.persist-circle-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  cursor: pointer;
  user-select: none;
  outline: none;
  transition: transform 0.16s ease, box-shadow 0.16s ease, background 0.16s ease, border-color 0.16s ease;
}
.persist-circle-btn.persist-btn-undo {
  width: 44px;
  height: 44px;
  background: #ffffff;
  color: #1e293b;
  border: 2px solid #cbd5e1;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  font-size: 1.25rem;
}
.persist-circle-btn.persist-btn-undo:hover:not(.disabled):not(:disabled) {
  background: #f8fafc;
  border-color: #64748b;
  color: #0f172a;
  transform: scale(1.1);
  box-shadow: 0 6px 16px rgba(100, 116, 139, 0.3);
}
.persist-circle-btn.persist-btn-undo.disabled,
.persist-circle-btn.persist-btn-undo:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  transform: none !important;
  box-shadow: none !important;
}
.persist-circle-btn.persist-btn-new {
  width: 44px;
  height: 44px;
  background: #ffffff;
  color: #1e293b;
  border: 2px solid #94a3b8;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  font-size: 1.25rem;
}
.persist-circle-btn.persist-btn-new:hover {
  background: #f8fafc;
  border-color: #10b981;
  color: #059669;
  transform: scale(1.1);
  box-shadow: 0 6px 16px rgba(16, 185, 129, 0.3);
}
.persist-circle-btn.persist-btn-load {
  width: 44px;
  height: 44px;
  background: #ffffff;
  color: #1e293b;
  border: 2px solid #94a3b8;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  font-size: 1.25rem;
}
.persist-circle-btn.persist-btn-load:hover {
  background: #f8fafc;
  border-color: #3b82f6;
  color: #2563eb;
  transform: scale(1.1);
  box-shadow: 0 6px 16px rgba(59, 130, 246, 0.3);
}
.persist-circle-btn.persist-btn-save {
  width: 56px;
  height: 56px;
  background: #2563eb;
  color: #ffffff;
  border: 2.5px solid #1d4ed8;
  box-shadow: 0 5px 16px rgba(37, 99, 235, 0.38);
  font-size: 1.6rem;
}
.persist-circle-btn.persist-btn-save:hover {
  background: #1d4ed8;
  border-color: #1e40af;
  transform: scale(1.1);
  box-shadow: 0 8px 22px rgba(37, 99, 235, 0.5);
}

/* Hintergrundbild im Canvas */
.design-bg-image-container {
  overflow: visible;
  transition: opacity 0.15s ease;
}
.design-bg-image-container.is-interactive-dragging {
  outline: 3px dashed #2563eb;
  outline-offset: 4px;
  background: rgba(37, 99, 235, 0.05);
  box-shadow: 0 8px 30px rgba(37, 99, 235, 0.18);
}
.design-bg-image-container.is-interactive-dragging.is-moving {
  outline-color: #1d4ed8;
  outline-style: solid;
}
.bg-drag-overlay {
  position: absolute;
  top: 12px;
  left: 12px;
  background: rgba(15, 23, 42, 0.92);
  color: #ffffff;
  font-size: 0.8rem;
  font-weight: 600;
  padding: 6px 12px;
  border-radius: 6px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
  display: inline-flex;
  align-items: center;
  gap: 10px;
  user-select: none;
  z-index: 5;
  pointer-events: auto;
}
.btn-bg-drag-finish {
  background: #2563eb;
  color: #ffffff;
  border: none;
  border-radius: 4px;
  padding: 3px 8px;
  font-size: 0.76rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease;
}
.btn-bg-drag-finish:hover {
  background: #1d4ed8;
}
</style>

