<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type {
  DesignStudioStore,
  DesignDocumentSummaryDto,
} from '../../composables/useDesignStudioStore';
import type {
  SceneBackgroundLayer,
  SceneConnectorEdge,
  SceneImplexBadge,
  ScenePersonCard,
  SceneSiblingGroup,
} from '../../domain/design/sceneTypes';
import DesignPersonCard from './DesignPersonCard.vue';
import DesignConnectorLayer from './DesignConnectorLayer.vue';
import { DOCKED_GROUP_GAP_X } from '../../domain/design/contourLayoutEngine';

const props = defineProps<{
  store: DesignStudioStore;
  pan: { x: number; y: number };
  zoom: number;
  isPanning: boolean;
  isDetailsOpen?: boolean;
  highlightedPathIds?: Set<string>;
  savedSubtreeList: DesignDocumentSummaryDto[];
  setViewportRef: (el: HTMLElement | null) => void;
  startCanvasPan: (e: MouseEvent) => void;
  onCanvasPan: (e: MouseEvent) => void;
  stopCanvasPan: (e: MouseEvent) => void;
  onViewportClick: (e: MouseEvent) => void;
  handleWheelZoom: (e: WheelEvent) => void;
  zoomStepCenter: (factor: number) => void;
  centerOnOrigin: () => void;
  fitToScreen: () => void;
}>();

const emit = defineEmits<{
  (e: 'select-person', personId: string): void;
  (e: 'open-details', personId: string): void;
}>();

const localViewportEl = ref<HTMLElement | null>(null);
const vpSize = ref({ w: 1200, h: 800 });
let resizeObserver: ResizeObserver | null = null;

function attachViewportRef(el: unknown) {
  const htmlEl = el instanceof HTMLElement ? el : null;
  localViewportEl.value = htmlEl;
  props.setViewportRef(htmlEl);
}

function onCanvasKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.store.isSplitToolActive.value) {
    props.store.setSplitToolActive(false);
  }
}

onMounted(() => {
  window.addEventListener('keydown', onCanvasKeyDown);
  if (localViewportEl.value) {
    vpSize.value = {
      w: localViewportEl.value.clientWidth || 1200,
      h: localViewportEl.value.clientHeight || 800,
    };
    resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        vpSize.value = {
          w: entry.contentRect.width || 1200,
          h: entry.contentRect.height || 800,
        };
      }
    });
    resizeObserver.observe(localViewportEl.value);
  }
});

  onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  if (dragRafId !== null) cancelAnimationFrame(dragRafId);
  window.removeEventListener('keydown', onCanvasKeyDown);
  window.removeEventListener('mousemove', onGlobalMouseMove);
  window.removeEventListener('mouseup', onGlobalMouseUp);
});

const scene = computed(() => props.store.sceneGraph.value);
const activeDoc = computed(() => props.store.activeDocument.value);
const selectedPersonId = computed(() => props.store.selectedPersonId.value);
const selectedGroupKey = computed(() => props.store.selectedGroupKey.value);
const selectedEdgeKey = computed(() => props.store.selectedEdgeKey.value);
const showLevelGrid = computed(() => props.store.showLevelGrid.value);
const isSplitToolActive = computed(() => props.store.isSplitToolActive.value);
const dragPreview = computed(() => props.store.dragPreview.value);
const isLoading = computed(() => props.store.isLoading.value);

const levelBandExtent = computed(() => {
  const b = scene.value?.bounds;
  if (!b) return { left: -1200, width: 2400 };
  const pad = 600;
  return {
    left: b.minX - pad,
    width: Math.max(2400, b.width + pad * 2),
  };
});

// Viewport-Culling für flüssige Darstellung bei > 2.000 Personen
const visibleWorldRect = computed(() => {
  const pad = 320;
  const minX = -props.pan.x / props.zoom - pad;
  const minY = -props.pan.y / props.zoom - pad;
  const maxX = (vpSize.value.w - props.pan.x) / props.zoom + pad;
  const maxY = (vpSize.value.h - props.pan.y) / props.zoom + pad;
  return { minX, minY, maxX, maxY };
});

const visibleCards = computed<ScenePersonCard[]>(() => {
  const sg = scene.value;
  if (!sg) return [];
  if (sg.cards.length <= 160) return sg.cards;
  const vr = visibleWorldRect.value;
  const selId = selectedPersonId.value;
  return sg.cards.filter(
    c =>
      c.personId === selId ||
      (c.x + c.width >= vr.minX &&
        c.x <= vr.maxX &&
        c.y + c.height >= vr.minY &&
        c.y <= vr.maxY)
  );
});

// Aktuell ausgewählte Karte & zugehörige Gruppe für die Floating Toolbar
const selectedCard = computed<ScenePersonCard | null>(() => {
  const sg = scene.value;
  const pid = selectedPersonId.value;
  if (!sg || !pid) return null;
  return sg.cards.find(c => c.personId === pid) || null;
});

const selectedGroup = computed<SceneSiblingGroup | null>(() => {
  const sg = scene.value;
  if (!sg) return null;
  if (selectedGroupKey.value) {
    const byKey = sg.groups.find(g => g.groupKey === selectedGroupKey.value);
    if (byKey) return byKey;
  }
  if (selectedCard.value) {
    return sg.groups.find(g => g.groupKey === selectedCard.value!.groupKey) || null;
  }
  return null;
});

const selectedMountRule = computed(() => {
  const doc = activeDoc.value;
  const card = selectedCard.value;
  if (!doc || !card) return null;
  return doc.subtreeMounts[card.personId] || null;
});

const isLockedSubtreeSelection = computed<boolean>(() => {
  const doc = activeDoc.value;
  const card = selectedCard.value;
  if (!doc || !card) return false;
  return card.ownerDocumentId !== doc.id;
});

const selectedPersonRule = computed(() => {
  const doc = activeDoc.value;
  const card = selectedCard.value;
  if (!doc || !card || card.ownerDocumentId !== doc.id) return null;
  return doc.personRules[card.personId] || null;
});

const availableExistingSubtrees = computed(() => {
  const doc = activeDoc.value;
  const card = selectedCard.value;
  return props.savedSubtreeList.filter(
    s => s.id !== doc?.id && (!card || s.root_person_id === card.personId)
  );
});

const canDockLeftNeighbor = computed<boolean>(() => {
  const sg = scene.value;
  const doc = activeDoc.value;
  const grp = selectedGroup.value;
  if (!sg || !doc || !grp || grp.ownerDocumentId !== doc.id) return false;
  const myCluster = grp.dockClusterKey || grp.groupKey;
  const myGroups = sg.groups.filter(
    g => g.ownerDocumentId === doc.id && g.level === grp.level && (g.dockClusterKey || g.groupKey) === myCluster
  );
  if (myGroups.length === 0) return false;
  const myMinX = Math.min(...myGroups.map(g => g.x));
  return sg.groups.some(
    g =>
      g.ownerDocumentId === doc.id &&
      g.level === grp.level &&
      (g.dockClusterKey || g.groupKey) !== myCluster &&
      g.x + g.width <= myMinX + grp.width / 2
  );
});

const canDockRightNeighbor = computed<boolean>(() => {
  const sg = scene.value;
  const doc = activeDoc.value;
  const grp = selectedGroup.value;
  if (!sg || !doc || !grp || grp.ownerDocumentId !== doc.id) return false;
  const myCluster = grp.dockClusterKey || grp.groupKey;
  const myGroups = sg.groups.filter(
    g => g.ownerDocumentId === doc.id && g.level === grp.level && (g.dockClusterKey || g.groupKey) === myCluster
  );
  if (myGroups.length === 0) return false;
  const myMaxRight = Math.max(...myGroups.map(g => g.x + g.width));
  return sg.groups.some(
    g =>
      g.ownerDocumentId === doc.id &&
      g.level === grp.level &&
      (g.dockClusterKey || g.groupKey) !== myCluster &&
      g.x >= myMaxRight - grp.width / 2
  );
});

const selectedMemberIndex = computed<number>(() => {
  const card = selectedCard.value;
  const grp = selectedGroup.value;
  if (!card || !grp) return -1;
  return grp.memberIds.indexOf(card.personId);
});

const canMergeSplitSiblings = computed<boolean>(() => {
  const sg = scene.value;
  const doc = activeDoc.value;
  const grp = selectedGroup.value;
  if (!sg || !doc || !grp || isLockedSubtreeSelection.value || grp.ownerDocumentId !== doc.id) {
    return false;
  }
  const siblingParts = sg.groups.filter(
    g =>
      g.ownerDocumentId === doc.id &&
      g.anchorParentId === grp.anchorParentId &&
      (g.marriageIndex ?? null) === (grp.marriageIndex ?? null)
  );
  return siblingParts.some(part =>
    part.memberIds.some(mid => Boolean(doc.personRules[mid]?.customGroupKey))
  );
});

interface CanvasSplitSeam {
  id: string;
  kind: 'sibling_group' | 'dock_seam';
  groupKey: string;
  splitAfterIndex?: number;
  rightGroupKey?: string;
  x: number;
  y: number;
  height: number;
  label: string;
}

const visibleSplitSeams = computed<CanvasSplitSeam[]>(() => {
  const sg = scene.value;
  const doc = activeDoc.value;
  if (!sg || !doc) return [];

  let targetGroups: SceneSiblingGroup[] = [];
  if (isSplitToolActive.value) {
    targetGroups = sg.groups.filter(g => g.ownerDocumentId === doc.id);
  } else if (!isLockedSubtreeSelection.value && selectedGroup.value && selectedGroup.value.ownerDocumentId === doc.id) {
    const selClusterKey = selectedGroup.value.dockClusterKey || selectedGroup.value.groupKey;
    targetGroups = sg.groups.filter(
      g => g.ownerDocumentId === doc.id && (g.dockClusterKey || g.groupKey) === selClusterKey
    );
  } else {
    return [];
  }

  const cardById = new Map<string, ScenePersonCard>();
  for (const c of sg.cards) cardById.set(c.personId, c);
  const groupByKey = new Map<string, SceneSiblingGroup>();
  for (const g of sg.groups) groupByKey.set(g.groupKey, g);

  const seams: CanvasSplitSeam[] = [];

  for (const grp of targetGroups) {
    // A) Trennstellen innerhalb mehrteiliger Geschwistergruppen
    if (grp.memberIds.length > 1) {
      for (let i = 0; i < grp.memberIds.length - 1; i++) {
        const leftCard = cardById.get(grp.memberIds[i]);
        const rightCard = cardById.get(grp.memberIds[i + 1]);
        if (!leftCard || !rightCard) continue;

        const sameRow = leftCard.rowIndex === rightCard.rowIndex && Math.abs(leftCard.y - rightCard.y) < 10;
        const x = sameRow
          ? (leftCard.x + leftCard.width + rightCard.x) / 2
          : leftCard.x + leftCard.width + 6;
        const y = sameRow ? Math.min(leftCard.y, rightCard.y) - 6 : leftCard.y - 4;
        const height = sameRow
          ? Math.max(leftCard.height, rightCard.height) + 12
          : leftCard.height + 8;

        seams.push({
          id: `seam_sib_${grp.groupKey}_${i}`,
          kind: 'sibling_group',
          groupKey: grp.groupKey,
          splitAfterIndex: i,
          x,
          y,
          height,
          label: `Gruppe hier trennen: ${leftCard.givenName} | ${rightCard.givenName}`,
        });
      }
    }

    // B) Trennstellen zwischen angedockten Gruppen
    const dockTargetKey = doc.groupRules[grp.groupKey]?.dockTargetGroupKey ?? grp.dockTargetGroupKey ?? null;
    if (dockTargetKey) {
      const leftGrp = groupByKey.get(dockTargetKey);
      if (leftGrp && leftGrp.ownerDocumentId === doc.id) {
        const x = (leftGrp.x + leftGrp.width + grp.x) / 2;
        const y = Math.min(leftGrp.y, grp.y) - 8;
        const height = Math.max(leftGrp.height, grp.height) + 16;
        seams.push({
          id: `seam_dock_${dockTargetKey}_${grp.groupKey}`,
          kind: 'dock_seam',
          groupKey: grp.groupKey,
          rightGroupKey: grp.groupKey,
          x,
          y,
          height,
          label: 'Angedockte Gruppen an dieser Stelle trennen',
        });
      }
    }
  }

  return seams;
});

function onSplitSeamClick(seam: CanvasSplitSeam) {
  if (seam.kind === 'sibling_group' && seam.splitAfterIndex !== undefined) {
    props.store.splitSiblingGroupAtIndex(seam.groupKey, seam.splitAfterIndex);
  } else if (seam.kind === 'dock_seam' && seam.rightGroupKey) {
    props.store.splitDockedClusterAtGroup(seam.rightGroupKey);
  }
}

const floatingControlsPos = computed(() => {
  const card = selectedCard.value;
  if (!card) return null;
  return {
    left: card.x + card.width / 2,
    top: Math.min(card.y - 10, (selectedGroup.value?.y ?? card.y) - 10),
  };
});

// ============================================================================
// 60fps Drag-Handling (Cluster horizontal mit Magnet-Andocken, Hintergrund & Wegpunkte)
// ============================================================================

const DOCK_SNAP_THRESHOLD_PX = 26;

type ActiveDragState =
  | {
      kind: 'group';
      groupKey: string;
      personId?: string;
      anchorParentId: string | null;
      startClientX: number;
      startClientY: number;
      latestClientX: number;
      startRelX: number;
      undoPushed: boolean;
      moved: boolean;
    }
  | {
      kind: 'bg';
      startClientX: number;
      startClientY: number;
      latestClientX: number;
      latestClientY: number;
      startBgX: number;
      startBgY: number;
      undoPushed: boolean;
      moved: boolean;
    }
  | {
      kind: 'edge';
      edge: SceneConnectorEdge;
      axis: 'x' | 'y';
      startClientX: number;
      startClientY: number;
    }
  | null;

let activeDrag: ActiveDragState = null;
let dragRafId: number | null = null;
const activeDragKey = ref<string>('');
const snapTarget = ref<{
  sourceGroupKey: string;
  targetGroupKey: string;
  side: 'left' | 'right';
  clusterKey: string;
} | null>(null);

function isCardInActiveDrag(card: ScenePersonCard): boolean {
  if (!activeDragKey.value) return false;
  const grp = scene.value?.groups.find(g => g.groupKey === card.groupKey);
  const clusterKey = grp?.dockClusterKey || card.groupKey;
  return clusterKey === activeDragKey.value || card.groupKey === activeDragKey.value;
}

function updateSnapTarget(draggedGroupKey: string) {
  const sg = scene.value;
  const doc = activeDoc.value;
  if (!sg || !doc) {
    snapTarget.value = null;
    return;
  }
  const draggedGrp = sg.groups.find(g => g.groupKey === draggedGroupKey);
  if (!draggedGrp || draggedGrp.ownerDocumentId !== doc.id) {
    snapTarget.value = null;
    return;
  }

  const dragClusterKey = draggedGrp.dockClusterKey || draggedGrp.groupKey;
  const sameLevel = sg.groups.filter(
    g => g.ownerDocumentId === doc.id && g.level === draggedGrp.level
  );
  const dragCluster = sameLevel.filter(
    g => (g.dockClusterKey || g.groupKey) === dragClusterKey
  );
  if (dragCluster.length === 0) {
    snapTarget.value = null;
    return;
  }

  const dragMinX = Math.min(...dragCluster.map(g => g.x));
  const dragMaxRight = Math.max(...dragCluster.map(g => g.x + g.width));

  const otherClusters = new Map<string, SceneSiblingGroup[]>();
  for (const g of sameLevel) {
    const ck = g.dockClusterKey || g.groupKey;
    if (ck === dragClusterKey) continue;
    if (!otherClusters.has(ck)) otherClusters.set(ck, []);
    otherClusters.get(ck)!.push(g);
  }

  let best: {
    dist: number;
    targetGroupKey: string;
    side: 'left' | 'right';
    clusterKey: string;
  } | null = null;

  for (const [ck, grpList] of otherClusters.entries()) {
    const sorted = [...grpList].sort((a, b) => a.x - b.x);
    const leftMost = sorted[0];
    const rightMost = sorted[sorted.length - 1];
    const neighborMinX = leftMost.x;
    const neighborMaxRight = Math.max(...sorted.map(g => g.x + g.width));

    const distLeft = Math.abs(dragMinX - (neighborMaxRight + DOCKED_GROUP_GAP_X));
    if (distLeft <= DOCK_SNAP_THRESHOLD_PX && (!best || distLeft < best.dist)) {
      best = { dist: distLeft, targetGroupKey: rightMost.groupKey, side: 'left', clusterKey: ck };
    }

    const distRight = Math.abs(dragMaxRight + DOCKED_GROUP_GAP_X - neighborMinX);
    if (distRight <= DOCK_SNAP_THRESHOLD_PX && (!best || distRight < best.dist)) {
      best = { dist: distRight, targetGroupKey: leftMost.groupKey, side: 'right', clusterKey: ck };
    }
  }

  snapTarget.value = best
    ? {
        sourceGroupKey: draggedGroupKey,
        targetGroupKey: best.targetGroupKey,
        side: best.side,
        clusterKey: best.clusterKey,
      }
    : null;
}

function onCardMouseDown(card: ScenePersonCard, e: MouseEvent) {
  if (e.button !== 0) return;
  const doc = activeDoc.value;
  const grp = scene.value?.groups.find(g => g.groupKey === card.groupKey);
  if (!doc || card.ownerDocumentId !== doc.id || (grp && grp.ownerDocumentId !== doc.id)) {
    return;
  }
  activeDrag = {
    kind: 'group',
    groupKey: card.groupKey,
    personId: card.personId,
    anchorParentId: grp?.anchorParentId ?? null,
    startClientX: e.clientX,
    startClientY: e.clientY,
    latestClientX: e.clientX,
    startRelX: props.store.getGroupRelativeX(card.groupKey),
    undoPushed: false,
    moved: false,
  };
  window.addEventListener('mousemove', onGlobalMouseMove);
  window.addEventListener('mouseup', onGlobalMouseUp);
}

function onGroupMouseDown(groupKey: string, anchorParentId: string | null, e: MouseEvent) {
  if (e.button !== 0) return;
  const doc = activeDoc.value;
  const grp = scene.value?.groups.find(g => g.groupKey === groupKey);
  if (!doc || !grp || grp.ownerDocumentId !== doc.id) {
    return;
  }
  activeDrag = {
    kind: 'group',
    groupKey,
    anchorParentId,
    startClientX: e.clientX,
    startClientY: e.clientY,
    latestClientX: e.clientX,
    startRelX: props.store.getGroupRelativeX(groupKey),
    undoPushed: false,
    moved: false,
  };
  window.addEventListener('mousemove', onGlobalMouseMove);
  window.addEventListener('mouseup', onGlobalMouseUp);
}

function onBackgroundMouseDown(bg: SceneBackgroundLayer, e: MouseEvent) {
  if (e.button !== 0) return;
  if (!activeDoc.value || bg.ownerDocumentId !== activeDoc.value.id || activeDoc.value.bgConfig?.locked !== false) {
    return;
  }
  e.stopPropagation();
  e.preventDefault();
  const cfg = activeDoc.value.bgConfig;
  activeDrag = {
    kind: 'bg',
    startClientX: e.clientX,
    startClientY: e.clientY,
    latestClientX: e.clientX,
    latestClientY: e.clientY,
    startBgX: cfg.x || 0,
    startBgY: cfg.y || 0,
    undoPushed: false,
    moved: false,
  };
  window.addEventListener('mousemove', onGlobalMouseMove);
  window.addEventListener('mouseup', onGlobalMouseUp);
}

function onWaypointDragStart(edge: SceneConnectorEdge, axis: 'x' | 'y', e: MouseEvent) {
  if (e.button !== 0) return;
  props.store.selectedEdgeKey.value = edge.edgeKey;
  activeDrag = {
    kind: 'edge',
    edge,
    axis,
    startClientX: e.clientX,
    startClientY: e.clientY,
  };
  window.addEventListener('mousemove', onGlobalMouseMove);
  window.addEventListener('mouseup', onGlobalMouseUp);
}

function flushDragFrame() {
  dragRafId = null;
  if (!activeDrag) return;
  const z = props.zoom || 1;
  if (activeDrag.kind === 'group') {
    if (!activeDrag.undoPushed) {
      props.store.beginInteractiveDrag();
      activeDrag.undoPushed = true;
      if (activeDrag.personId) {
        props.store.selectedPersonId.value = activeDrag.personId;
      }
      props.store.selectedGroupKey.value = activeDrag.groupKey;
    }
    const worldDx = (activeDrag.latestClientX - activeDrag.startClientX) / z;
    props.store.setGroupRelativeXLive(
      activeDrag.groupKey,
      activeDrag.startRelX + worldDx,
      activeDrag.anchorParentId
    );
    updateSnapTarget(activeDrag.groupKey);
  } else if (activeDrag.kind === 'bg') {
    if (!activeDrag.undoPushed) {
      props.store.beginInteractiveDrag();
      activeDrag.undoPushed = true;
    }
    const worldDx = (activeDrag.latestClientX - activeDrag.startClientX) / z;
    const worldDy = (activeDrag.latestClientY - activeDrag.startClientY) / z;
    props.store.updateBackgroundConfig(
      {
        x: Math.round(activeDrag.startBgX + worldDx),
        y: Math.round(activeDrag.startBgY + worldDy),
      },
      false
    );
  }
}

function onGlobalMouseMove(e: MouseEvent) {
  if (!activeDrag) return;
  const z = props.zoom || 1;
  if (activeDrag.kind === 'group') {
    const rawDx = e.clientX - activeDrag.startClientX;
    if (!activeDrag.moved && Math.abs(rawDx) < 4) return;
    activeDrag.moved = true;
    activeDrag.latestClientX = e.clientX;
    const dragGroupKey = activeDrag.groupKey;
    const grp = scene.value?.groups.find(g => g.groupKey === dragGroupKey);
    activeDragKey.value = grp?.dockClusterKey || dragGroupKey;
    if (dragRafId === null) dragRafId = requestAnimationFrame(flushDragFrame);
  } else if (activeDrag.kind === 'bg') {
    const rawDx = e.clientX - activeDrag.startClientX;
    const rawDy = e.clientY - activeDrag.startClientY;
    if (!activeDrag.moved && Math.hypot(rawDx, rawDy) < 3) return;
    activeDrag.moved = true;
    activeDrag.latestClientX = e.clientX;
    activeDrag.latestClientY = e.clientY;
    if (dragRafId === null) dragRafId = requestAnimationFrame(flushDragFrame);
  } else if (activeDrag.kind === 'edge') {
    const dx = activeDrag.axis === 'x' ? Math.round((e.clientX - activeDrag.startClientX) / z) : 0;
    const dy = activeDrag.axis === 'y' ? Math.round((e.clientY - activeDrag.startClientY) / z) : 0;
    props.store.dragPreview.value = {
      kind: 'edge',
      key: activeDrag.edge.edgeKey,
      dx,
      dy,
    };
  }
}

function onGlobalMouseUp() {
  window.removeEventListener('mousemove', onGlobalMouseMove);
  window.removeEventListener('mouseup', onGlobalMouseUp);
  if (dragRafId !== null) {
    cancelAnimationFrame(dragRafId);
    flushDragFrame();
  }
  if (!activeDrag) return;

  const preview = props.store.dragPreview.value;
  if (activeDrag.kind === 'group' && activeDrag.moved) {
    if (snapTarget.value) {
      props.store.dockGroupCluster(
        snapTarget.value.sourceGroupKey,
        snapTarget.value.targetGroupKey,
        snapTarget.value.side,
        true
      );
    } else {
      props.store.finishInteractiveDrag();
    }
  } else if (activeDrag.kind === 'bg' && activeDrag.moved) {
    props.store.finishInteractiveDrag();
  } else if (activeDrag.kind === 'edge' && preview && preview.kind === 'edge') {
    if (Math.abs(preview.dx) >= 1 || Math.abs(preview.dy) >= 1) {
      props.store.updateEdgeWaypoint(
        activeDrag.edge.edgeKey,
        activeDrag.edge.parentPersonId,
        preview.dy,
        preview.dx
      );
    }
  }
  props.store.dragPreview.value = null;
  snapTarget.value = null;
  activeDragKey.value = '';
  activeDrag = null;
}

function handleCardSelect(card: ScenePersonCard) {
  props.store.selectedPersonId.value = card.personId;
  props.store.selectedGroupKey.value = card.groupKey;
  props.store.selectedEdgeKey.value = '';
  emit('select-person', card.personId);
}

function handleGroupSelect(group: SceneSiblingGroup) {
  props.store.selectedGroupKey.value = group.groupKey;
  if (!selectedPersonId.value || !group.memberIds.includes(selectedPersonId.value)) {
    props.store.selectedPersonId.value = group.memberIds[0] || '';
  }
  props.store.selectedEdgeKey.value = '';
}

function handleSwitchImplex(badge: SceneImplexBadge) {
  props.store.switchImplexBranchParent(badge.affectedChildIds, badge.chosenParentIdIfClicked);
}

function onCanvasDragOver(e: DragEvent) {
  e.preventDefault();
}

function onCanvasDrop(e: DragEvent) {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (file && file.type.startsWith('image/')) {
    props.store.uploadBackgroundAsset(file);
  }
}

function onMountExistingChange(ev: Event) {
  const select = ev.target as HTMLSelectElement;
  const subDocId = select.value;
  if (subDocId && selectedCard.value) {
    props.store.mountExistingSubtree(selectedCard.value.personId, subDocId);
    select.value = '';
  }
}
</script>

<template>
  <div
    :ref="attachViewportRef"
    class="design-canvas-viewport"
    :class="{ 'is-panning': isPanning }"
    @mousedown="startCanvasPan"
    @mousemove="onCanvasPan"
    @mouseup="stopCanvasPan"
    @mouseleave="stopCanvasPan"
    @click="onViewportClick"
    @wheel.prevent="handleWheelZoom"
    @dragover="onCanvasDragOver"
    @drop="onCanvasDrop"
  >
    <!-- Welt-Transform Layer -->
    <div
      v-if="scene"
      class="design-world-stage"
      :style="{
        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        transformOrigin: '0 0',
      }"
    >
      <!-- 1. Synchronisierte Generationsebenen (visuelles Hilfsraster) -->
      <div v-if="showLevelGrid" class="design-level-bands-layer">
        <div
          v-for="(lvl, idx) in scene.levels"
          :key="'lvl-' + lvl.level"
          class="design-level-band"
          :class="{ 'is-odd': idx % 2 === 1 }"
          :style="{
            left: levelBandExtent.left + 'px',
            top: lvl.topY + 'px',
            width: levelBandExtent.width + 'px',
            height: lvl.height + 'px',
          }"
        >
          <span class="design-level-label">{{ lvl.label }}</span>
        </div>
      </div>

      <!-- 2. Hintergrundbilder & Wappen (Aspect-Ratio geschützt) -->
      <div class="design-backgrounds-layer">
        <img
          v-for="bg in scene.backgrounds"
          :key="bg.id"
          :src="bg.dataUrl"
          :alt="bg.title || 'Hintergrund'"
          class="design-bg-image"
          :class="{ 'is-movable': bg.ownerDocumentId === activeDoc?.id && activeDoc?.bgConfig?.locked === false }"
          :style="{
            left: bg.x + 'px',
            top: bg.y + 'px',
            width: bg.width + 'px',
            height: bg.height + 'px',
            opacity: bg.opacity,
          }"
          @mousedown="e => onBackgroundMouseDown(bg, e)"
        />
      </div>

      <!-- 3. Eingebettete Inline-Sub-Baum Rahmen -->
      <div class="design-subtree-frames-layer">
        <div
          v-for="frame in scene.subtreeFrames.filter(f => f.displayMode === 'inline')"
          :key="'sf-' + frame.subDocumentId + '-' + frame.anchorPersonId"
          class="design-subtree-frame"
          :style="{
            left: frame.x - 10 + 'px',
            top: frame.y - 26 + 'px',
            width: frame.width + 20 + 'px',
            height: frame.height + 36 + 'px',
          }"
          @dblclick.stop="store.enterSubtree(frame.subDocumentId)"
        >
          <div class="subtree-frame-header" @mousedown.stop>
            <span class="subtree-frame-badge">
              🌿 {{ frame.subDocumentName }} · {{ frame.personCount }} Pers.
            </span>
            <div class="subtree-frame-actions">
              <button
                type="button"
                class="sf-btn"
                title="In dieses Sub-Baum-Studio wechseln"
                @click.stop="store.enterSubtree(frame.subDocumentId)"
              >
                ✏️ Öffnen
              </button>
              <button
                type="button"
                class="sf-btn"
                title="Als platzsparende Verweis-Kapsel einklappen"
                @click.stop="store.setSubtreeDisplayMode(frame.anchorPersonId, 'capsule')"
              >
                📁 Kapsel
              </button>
              <button
                type="button"
                class="sf-btn is-danger"
                title="Sub-Baum an dieser Stelle wieder aushängen"
                @click.stop="store.unmountSubtree(frame.anchorPersonId)"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 4. Geschwister- / Ehegruppen-Container -->
      <div class="design-groups-layer">
        <div
          v-for="grp in scene.groups"
          :key="grp.groupKey"
          class="sibling-group-container"
          :class="{
            'is-multi': grp.memberIds.length > 1,
            'is-wrapped': grp.rowCount > 1,
            'is-selected': grp.groupKey === selectedGroupKey,
            'is-dragging': activeDragKey === (grp.dockClusterKey || grp.groupKey),
            'is-docked': grp.isDocked,
            'is-snap-target': snapTarget?.clusterKey === (grp.dockClusterKey || grp.groupKey),
            'is-locked': Boolean(activeDoc && grp.ownerDocumentId !== activeDoc.id),
          }"
          :style="{
            left: grp.x - 5 + 'px',
            top: grp.y - 4 + 'px',
            width: grp.width + 10 + 'px',
            height: grp.height + 8 + 'px',
          }"
          @mousedown.stop="e => onGroupMouseDown(grp.groupKey, grp.anchorParentId, e)"
          @click.stop="handleGroupSelect(grp)"
        >
          <span
            v-if="grp.marriageLabel"
            class="group-marriage-tag"
            title="Getrennte Kindergruppe nach Ehe"
          >
            {{ grp.marriageLabel }}
          </span>
          <span
            v-if="grp.rowCount > 1"
            class="group-wrap-tag"
            title="Mehrreihiger Umbruch mit vertikalen Durchführungskanälen"
          >
            ⊞ {{ grp.columnCount }} Sp. × {{ grp.rowCount }} R.
          </span>
        </div>
      </div>

      <!-- 5. Geroutete SVG-Verbindungslinien & Wegpunkte -->
      <DesignConnectorLayer
        :edges="scene.edges"
        :bounds="scene.bounds"
        :selected-edge-key="selectedEdgeKey"
        :highlighted-person-ids="highlightedPathIds"
        :drag-edge-key="dragPreview?.kind === 'edge' ? dragPreview.key : undefined"
        :drag-delta-x="dragPreview?.kind === 'edge' ? dragPreview.dx : 0"
        :drag-delta-y="dragPreview?.kind === 'edge' ? dragPreview.dy : 0"
        @select-edge="key => { store.selectedEdgeKey.value = key; }"
        @waypoint-drag-start="onWaypointDragStart"
        @reset-waypoint="key => store.resetEdgeWaypoint(key)"
      />

      <!-- 6. Personenkacheln & Verweis-Kapseln (Viewport-Culled) -->
      <DesignPersonCard
        v-for="card in visibleCards"
        :key="card.personId + ':' + card.groupKey"
        :card="card"
        :is-selected="card.personId === selectedPersonId"
        :is-highlighted="Boolean(highlightedPathIds && highlightedPathIds.has(card.personId))"
        :is-dimmed="Boolean(highlightedPathIds && highlightedPathIds.size > 0 && !highlightedPathIds.has(card.personId))"
        :is-group-dragging="isCardInActiveDrag(card)"
        :is-locked-in-parent="Boolean(activeDoc && card.ownerDocumentId !== activeDoc.id)"
        @select="() => handleCardSelect(card)"
        @enter-subtree="subId => store.enterSubtree(subId)"
        @card-mousedown="e => onCardMouseDown(card, e)"
      />

      <!-- 6b. Interaktive Gruppen- & Andock-Trennstellen -->
      <div v-if="visibleSplitSeams.length > 0" class="design-split-seams-layer">
        <div
          v-for="seam in visibleSplitSeams"
          :key="seam.id"
          class="split-seam-marker"
          :class="{ 'is-dock-seam': seam.kind === 'dock_seam' }"
          :style="{
            left: seam.x + 'px',
            top: seam.y + 'px',
            height: seam.height + 'px',
          }"
        >
          <div class="split-seam-line"></div>
          <button
            type="button"
            class="split-seam-handle"
            :title="seam.label"
            @mousedown.stop
            @click.stop="onSplitSeamClick(seam)"
          >
            ✂️
          </button>
        </div>
      </div>

      <!-- 7. Schwebende Aktionsleiste für selektierte Kachel / Gruppe -->
      <div
        v-if="selectedCard && floatingControlsPos"
        class="group-floating-controls"
        :style="{
          left: floatingControlsPos.left + 'px',
          top: floatingControlsPos.top + 'px',
        }"
        @mousedown.stop
        @click.stop
      >
        <div class="floating-header">
          <span class="floating-name">{{ selectedCard.fullName }}</span>
          <span v-if="selectedCard.henryCode" class="floating-code">[{{ selectedCard.henryCode }}]</span>
          <button
            type="button"
            class="f-btn floating-details-btn"
            :class="{ 'is-active': isDetailsOpen }"
            title="Vollständige Personendetails öffnen"
            @click="emit('open-details', selectedCard.personId)"
          >
            ℹ️ Details
          </button>
        </div>

        <!-- Gesperrte Sub-Baum-Elemente im Haupt-Stammbaum -->
        <div v-if="isLockedSubtreeSelection" class="floating-actions-row">
          <span class="floating-locked-note">
            🌿 Sub-Baum-Element (Anordnung nur im Sub-Baum)
          </span>
          <button
            v-if="selectedCard.subDocumentId || selectedMountRule?.subDocumentId"
            type="button"
            class="f-btn is-accent"
            @click="store.enterSubtree(selectedCard.subDocumentId || selectedMountRule!.subDocumentId)"
          >
            ✏️ Im Sub-Baum anordnen
          </button>
          <template v-if="selectedMountRule">
            <button
              type="button"
              class="f-btn"
              @click="
                store.setSubtreeDisplayMode(
                  selectedCard.personId,
                  selectedMountRule.displayMode === 'inline' ? 'capsule' : 'inline'
                )
              "
            >
              {{ selectedMountRule.displayMode === 'inline' ? '📁 Als Kapsel' : '🌿 Inline' }}
            </button>
            <button
              type="button"
              class="f-btn is-danger"
              @click="store.unmountSubtree(selectedCard.personId)"
            >
              Aushängen
            </button>
          </template>
        </div>

        <div v-else class="floating-actions-row">
          <!-- Gruppen-Wrapping (Spalten pro Reihe) -->
          <div v-if="selectedGroup && selectedGroup.memberIds.length > 1" class="floating-chip-group">
            <span class="chip-label">Spalten:</span>
            <button
              v-for="cols in [null, 2, 3, 4, 6]"
              :key="String(cols)"
              type="button"
              class="f-btn"
              :class="{ active: (selectedGroup.maxColumnsPerRow ?? null) === cols }"
              @click="store.setGroupMaxColumns(selectedGroup.groupKey, cols, selectedGroup.anchorParentId)"
            >
              {{ cols === null ? 'Auto' : cols }}
            </button>
          </div>

          <!-- Ebene anpassen -->
          <div v-if="selectedGroup" class="floating-chip-group">
            <span class="chip-label">Ebene {{ selectedCard.level }}:</span>
            <button
              type="button"
              class="f-btn"
              title="Eine Ebene tiefer / weiter vom Spitzenahn"
              @click="store.shiftGroupLevel(selectedGroup.groupKey, [selectedCard.personId], 1)"
            >
              +1
            </button>
            <button
              type="button"
              class="f-btn"
              title="Ebene zurücksetzen"
              :disabled="!selectedPersonRule || selectedPersonRule.levelOffset === 0"
              @click="store.shiftGroupLevel(selectedGroup.groupKey, [selectedCard.personId], -1)"
            >
              -1
            </button>
          </div>

          <!-- Magnet-Andocken zum Minimieren der Tafel-Breite -->
          <div
            v-if="selectedGroup && (canDockLeftNeighbor || canDockRightNeighbor || selectedGroup.isDocked)"
            class="floating-chip-group"
          >
            <span class="chip-label">Andocken:</span>
            <button
              type="button"
              class="f-btn"
              title="Links an Nachbargruppe/-Kachel andocken"
              :disabled="!canDockLeftNeighbor"
              @click="store.dockClusterToNeighbor(selectedGroup.groupKey, 'left')"
            >
              🧲 ←
            </button>
            <button
              type="button"
              class="f-btn"
              title="Rechts an Nachbargruppe/-Kachel andocken"
              :disabled="!canDockRightNeighbor"
              @click="store.dockClusterToNeighbor(selectedGroup.groupKey, 'right')"
            >
              → 🧲
            </button>
            <button
              v-if="selectedGroup.isDocked"
              type="button"
              class="f-btn"
              title="Aus dem angedockten Verband lösen"
              @click="store.undockGroup(selectedGroup.groupKey)"
            >
              🔓 Abdocken
            </button>
          </div>

          <!-- Gruppe an Zielstelle auftrennen / Teilgruppen zusammenführen -->
          <div
            v-if="selectedGroup && selectedGroup.memberIds.length > 1 && !selectedCard.isCapsule"
            class="floating-chip-group"
          >
            <span class="chip-label">Trennen:</span>
            <button
              v-if="selectedMemberIndex > 0"
              type="button"
              class="f-btn"
              title="Gruppe links vor dieser Kachel auftrennen"
              @click="store.splitSiblingGroupAtIndex(selectedGroup.groupKey, selectedMemberIndex - 1)"
            >
              ✂️ | Links
            </button>
            <button
              v-if="selectedMemberIndex >= 0 && selectedMemberIndex < selectedGroup.memberIds.length - 1"
              type="button"
              class="f-btn"
              title="Gruppe rechts nach dieser Kachel auftrennen"
              @click="store.splitSiblingGroupAtIndex(selectedGroup.groupKey, selectedMemberIndex)"
            >
              Rechts | ✂️
            </button>
            <button
              v-if="selectedGroup.memberIds.length > 2"
              type="button"
              class="f-btn"
              title="Nur diese einzelne Kachel aus der Geschwistergruppe herauslösen"
              @click="store.detachCardFromSiblingGroup(selectedCard.personId)"
            >
              ✂️ Einzelkachel
            </button>
          </div>
          <button
            v-if="canMergeSplitSiblings && selectedGroup"
            type="button"
            class="f-btn"
            title="Alle aufgetrennten Geschwister-Teilgruppen dieses Elternteils wieder zusammenführen"
            @click="store.mergeSplitSiblingGroups(selectedGroup.groupKey)"
          >
            🔗 Teilgruppen vereinen
          </button>
          <button
            v-else-if="selectedPersonRule?.customGroupKey"
            type="button"
            class="f-btn"
            title="Einzelkachel wieder in die Geschwistergruppe einfügen"
            @click="store.reattachCardToSiblingGroup(selectedCard.personId)"
          >
            🔗 Zurück in Gruppe
          </button>

          <!-- Mehrere Ehen -> Kinder nach Ehe trennen -->
          <button
            v-if="selectedCard.spouses.length > 1"
            type="button"
            class="f-btn"
            :class="{ active: Boolean(selectedPersonRule?.splitChildrenByMarriage) }"
            title="Kinder dieser Person getrennt nach Ehepartnern [I] / [II] gruppieren"
            @click="store.toggleSplitChildrenByMarriage(selectedCard.personId)"
          >
            ⚮ Ehen [I]/[II]
          </button>

          <!-- Implex-Anknüpfung umschalten (nur in der Floating-Leiste, nicht in der Kachel) -->
          <button
            v-for="badge in selectedCard.implexBadges.filter(b => !b.isBranchAttachedHere)"
            :key="'imp-' + badge.partnerId"
            type="button"
            class="f-btn"
            :title="`Gemeinsame Kinder mit ${badge.partnerName} (${badge.partnerCode}) an diesen Zweig umhängen`"
            @click="handleSwitchImplex(badge)"
          >
            ⚡ Kinder → {{ badge.partnerCode || badge.partnerName }}
          </button>

          <!-- Sub-Baum einhängen / kapseln / öffnen -->
          <template v-if="selectedMountRule">
            <button
              type="button"
              class="f-btn is-accent"
              @click="store.enterSubtree(selectedMountRule.subDocumentId)"
            >
              🌿 Sub-Baum öffnen
            </button>
            <button
              type="button"
              class="f-btn"
              @click="
                store.setSubtreeDisplayMode(
                  selectedCard.personId,
                  selectedMountRule.displayMode === 'inline' ? 'capsule' : 'inline'
                )
              "
            >
              {{ selectedMountRule.displayMode === 'inline' ? '📁 Als Kapsel' : '🌿 Inline' }}
            </button>
            <button
              type="button"
              class="f-btn is-danger"
              @click="store.unmountSubtree(selectedCard.personId)"
            >
              Aushängen
            </button>
          </template>
          <template v-else-if="selectedCard.personId !== activeDoc?.rootPersonId">
            <button
              type="button"
              class="f-btn is-accent"
              title="Diesen Zweig als eigenen, verschachtelbaren Sub-Baum auslagern"
              @click="store.createAndMountSubtree(selectedCard.personId)"
            >
              🌿 + Sub-Baum
            </button>
            <select
              v-if="availableExistingSubtrees.length > 0"
              class="f-select"
              title="Vorhandenen Sub-Baum an dieser Person einbinden"
              @change="onMountExistingChange"
            >
              <option value="">Sub-Baum einbinden…</option>
              <option v-for="sub in availableExistingSubtrees" :key="sub.id" :value="sub.id">
                {{
                  store.getPersonHenryCode(sub.root_person_id)
                    ? `[${store.getPersonHenryCode(sub.root_person_id)}] ${sub.name}`
                    : sub.name
                }}
              </option>
            </select>
          </template>

          <!-- Manuelle Position zurücksetzen -->
          <button
            v-if="store.hasManualOffset(selectedCard.personId, selectedGroup?.groupKey)"
            type="button"
            class="f-btn"
            title="Manuelle Kachel-/Gruppen-Verschiebung zurücksetzen"
            @click="store.resetManualOffset(selectedCard.personId, selectedGroup?.groupKey)"
          >
            ↺ Position zurücksetzen
          </button>

          <!-- Ausblenden (außer Wurzel) -->
          <button
            v-if="selectedCard.personId !== activeDoc?.rootPersonId"
            type="button"
            class="f-btn is-danger"
            title="Diese Kachel im aktuellen Design ausblenden"
            @click="store.togglePersonHidden(selectedCard.personId)"
          >
            👁️ Ausblenden
          </button>
        </div>
      </div>
    </div>

    <!-- Lade- oder Leerzustand -->
    <div v-else class="canvas-empty-overlay">
      <div v-if="isLoading" class="canvas-status-card">Lade Stammbaum-Szene…</div>
      <div v-else class="canvas-status-card">
        Bitte wählen Sie oben einen Spitzenahn aus, um das Design Studio zu starten.
      </div>
    </div>

    <!-- Aktiv-Banner für Gruppen-Trennwerkzeug -->
    <div v-if="isSplitToolActive" class="split-tool-banner" @mousedown.stop @click.stop>
      <span>✂️ <strong>Trenn-Werkzeug aktiv</strong> – Klicken Sie auf eine Scheren-Trennstelle zwischen Kacheln oder angedockten Gruppen</span>
      <button type="button" class="split-banner-close" @click="store.setSplitToolActive(false)">
        Fertig (Esc)
      </button>
    </div>

    <!-- Zoom & Navigations-Steuerung unten rechts -->
    <div class="design-zoom-controls" @mousedown.stop @click.stop>
      <span v-if="scene" class="zoom-stats" title="Aktuell gerenderte Kacheln">
        {{ scene.cards.length }} Kacheln ·
        {{ scene.growthDirection === 'bottom_up' ? '↑ Unten→Oben' : '↓ Oben→Unten' }}
      </span>
      <button type="button" class="z-btn" title="Herauszoomen" @click="zoomStepCenter(0.85)">−</button>
      <span class="zoom-pct">{{ Math.round(zoom * 100) }}%</span>
      <button type="button" class="z-btn" title="Hineinzoomen" @click="zoomStepCenter(1.18)">+</button>
      <button type="button" class="z-btn" title="Auf Spitzenahn zentrieren" @click="centerOnOrigin">
        🎯
      </button>
      <button type="button" class="z-btn" title="Kompletten Baum einpassen" @click="fitToScreen">
        ⛶ Fit
      </button>
    </div>
  </div>
</template>

<style scoped>
.design-canvas-viewport {
  position: relative;
  flex: 1;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background-color: #f8fafc;
  background-image: radial-gradient(#cbd5e1 1px, transparent 1px);
  background-size: 24px 24px;
  cursor: grab;
  user-select: none;
}

.design-canvas-viewport.is-panning {
  cursor: grabbing;
}

.design-world-stage {
  position: absolute;
  top: 0;
  left: 0;
  width: 1px;
  height: 1px;
}

/* Ebenenraster */
.design-level-bands-layer {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  z-index: 1;
}

.design-level-band {
  position: absolute;
  border-top: 1px dashed rgba(148, 163, 184, 0.38);
  border-bottom: 1px dashed rgba(148, 163, 184, 0.2);
  background: rgba(241, 245, 249, 0.35);
}

.design-level-band.is-odd {
  background: rgba(255, 255, 255, 0.38);
}

.design-level-label {
  position: sticky;
  left: 16px;
  top: 8px;
  display: inline-block;
  margin: 6px 14px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.85);
  border: 1px solid #cbd5e1;
  font-size: 10px;
  font-weight: 700;
  color: #64748b;
}

/* Hintergrundbilder */
.design-backgrounds-layer {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  z-index: 2;
}

.design-bg-image {
  position: absolute;
  object-fit: contain;
  pointer-events: none;
}

.design-bg-image.is-movable {
  pointer-events: auto;
  cursor: move;
  outline: 2px dashed rgba(59, 130, 246, 0.75);
  outline-offset: 2px;
}

/* Inline Sub-Baum Rahmen */
.design-subtree-frames-layer {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 4;
}

.design-subtree-frame {
  position: absolute;
  border: 2px dashed #8b5cf6;
  border-radius: 12px;
  background: rgba(245, 243, 255, 0.36);
  pointer-events: none;
}

.subtree-frame-header {
  position: absolute;
  top: -13px;
  left: 12px;
  right: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  pointer-events: auto;
}

.subtree-frame-badge {
  background: #ede9fe;
  color: #5b21b6;
  border: 1px solid #c4b5fd;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 700;
  box-shadow: 0 1px 4px rgba(91, 33, 182, 0.14);
}

.subtree-frame-actions {
  display: flex;
  gap: 4px;
}

.sf-btn {
  background: #ffffff;
  color: #4c1d95;
  border: 1px solid #c4b5fd;
  border-radius: 5px;
  padding: 2px 7px;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
}
.sf-btn:hover {
  background: #7c3aed;
  color: #ffffff;
}
.sf-btn.is-danger:hover {
  background: #dc2626;
  border-color: #dc2626;
  color: #ffffff;
}

/* Gruppen-Container */
.design-groups-layer {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 5;
}

.sibling-group-container {
  position: absolute;
  border-radius: 9px;
  border: 1px solid transparent;
  pointer-events: auto;
  transition: border-color 0.12s ease, background-color 0.12s ease;
}

.sibling-group-container.is-multi {
  border-color: rgba(148, 163, 184, 0.35);
  background: rgba(255, 255, 255, 0.25);
}

.sibling-group-container.is-wrapped {
  border-style: dashed;
  border-color: rgba(59, 130, 246, 0.45);
}

.sibling-group-container.is-selected {
  border-color: #f59e0b;
  background: rgba(254, 243, 199, 0.18);
}

.sibling-group-container.is-dragging {
  border-color: #ea580c;
  background: rgba(255, 237, 213, 0.35);
}

.sibling-group-container.is-docked {
  border-color: rgba(14, 165, 233, 0.55);
  background: rgba(224, 242, 254, 0.25);
}

.sibling-group-container.is-snap-target {
  border-color: #10b981;
  border-style: solid;
  border-width: 2px;
  background: rgba(209, 250, 229, 0.35);
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.28);
}

.sibling-group-container.is-locked {
  cursor: pointer;
}

.floating-locked-note {
  font-size: 10.5px;
  color: #ddd6fe;
  font-weight: 600;
  padding-right: 4px;
}

.group-marriage-tag,
.group-wrap-tag {
  position: absolute;
  top: -11px;
  font-size: 9px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 999px;
  pointer-events: none;
}

.group-marriage-tag {
  left: 8px;
  background: #eff6ff;
  color: #1d4ed8;
  border: 1px solid #bfdbfe;
}

.group-wrap-tag {
  right: 8px;
  background: #f1f5f9;
  color: #475569;
  border: 1px solid #cbd5e1;
}

/* Schwebende Selektions-Aktionsleiste */
.group-floating-controls {
  position: absolute;
  transform: translate(-50%, -100%);
  z-index: 60;
  background: #0f172a;
  color: #f8fafc;
  border-radius: 9px;
  padding: 6px 10px;
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.35);
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 280px;
  max-width: 620px;
  pointer-events: auto;
}

.floating-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.14);
  padding-bottom: 3px;
}

.floating-name {
  font-weight: 700;
}

.floating-details-btn {
  margin-left: auto;
}

.floating-code {
  color: #fbbf24;
  font-family: monospace;
  font-size: 10.5px;
}

.floating-actions-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
}

.floating-chip-group {
  display: flex;
  align-items: center;
  gap: 2px;
  background: rgba(255, 255, 255, 0.08);
  padding: 2px 4px;
  border-radius: 5px;
}

.chip-label {
  font-size: 10px;
  color: #cbd5e1;
  margin-right: 3px;
}

.f-btn {
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.1);
  color: #f8fafc;
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;
}
.f-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.24);
}
.f-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.f-btn.active {
  background: #2563eb;
  border-color: #60a5fa;
}
.f-btn.is-accent {
  background: #7c3aed;
  border-color: #a78bfa;
}
.f-btn.is-danger:hover {
  background: #dc2626;
  border-color: #f87171;
}

.f-select {
  background: #1e293b;
  color: #f8fafc;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 4px;
  padding: 2px 5px;
  font-size: 10.5px;
}

/* Zoom & Overlay */
.canvas-empty-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.canvas-status-card {
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  padding: 18px 26px;
  color: #334155;
  font-weight: 600;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.1);
}

.design-zoom-controls {
  position: absolute;
  right: 16px;
  bottom: 16px;
  z-index: 50;
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 5px 8px;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.12);
}

.zoom-stats {
  font-size: 11px;
  font-weight: 600;
  color: #475569;
  padding-right: 6px;
  border-right: 1px solid #e2e8f0;
  margin-right: 2px;
}

.z-btn {
  border: 1px solid #cbd5e1;
  background: #f8fafc;
  color: #0f172a;
  border-radius: 5px;
  padding: 3px 8px;
  font-size: 11.5px;
  font-weight: 700;
  cursor: pointer;
}
.z-btn:hover {
  background: #e2e8f0;
}

.zoom-pct {
  min-width: 40px;
  text-align: center;
  font-size: 11.5px;
  font-weight: 700;
  color: #1e293b;
}

/* Zielstellen-Marker (Trenn-Werkzeug) */
.design-split-seams-layer {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  z-index: 35;
}

.split-seam-marker {
  position: absolute;
  transform: translateX(-50%);
  width: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.split-seam-line {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 0;
  transform: translateX(-50%);
  border-left: 2px dashed #d97706;
  opacity: 0.82;
}

.split-seam-marker.is-dock-seam .split-seam-line {
  border-left-color: #0284c7;
}

.split-seam-handle {
  position: relative;
  z-index: 2;
  pointer-events: auto;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  border: 1.5px solid #d97706;
  background: #fffbeb;
  color: #92400e;
  font-size: 11px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.22);
  transition: transform 0.12s ease, background-color 0.12s ease, box-shadow 0.12s ease;
}

.split-seam-marker.is-dock-seam .split-seam-handle {
  border-color: #0284c7;
  background: #f0f9ff;
  color: #0369a1;
}

.split-seam-handle:hover {
  transform: scale(1.16);
  background: #fef3c7;
  box-shadow: 0 4px 12px rgba(217, 119, 6, 0.35);
}

.split-seam-marker.is-dock-seam .split-seam-handle:hover {
  background: #e0f2fe;
  box-shadow: 0 4px 12px rgba(2, 132, 199, 0.35);
}

.split-tool-banner {
  position: absolute;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 55;
  display: flex;
  align-items: center;
  gap: 10px;
  background: #fffbeb;
  color: #78350f;
  border: 1px solid #f59e0b;
  border-radius: 999px;
  padding: 5px 12px;
  font-size: 11.5px;
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.14);
}

.split-banner-close {
  border: 1px solid #d97706;
  background: #ffffff;
  color: #92400e;
  border-radius: 999px;
  padding: 2px 9px;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}
.split-banner-close:hover {
  background: #fef3c7;
}
</style>
