<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';

const { t } = useI18n();

interface ProbandData {
  henry_code: string;
  generation: number;
}
interface SpouseConnection {
  id: string;
  date: string | null;
  place: string | null;
  divorce_date: string | null;
  is_divorced: boolean;
}
interface Person {
  id: string;
  given_name: string | null;
  surname: string | null;
  sex: string | null;
  birth_date: string | null;
  birth_place: string | null;
  death_date: string | null;
  death_place: string | null;
  proband_data: Record<string, ProbandData>;
  gedcom_extra: Record<string, any>;
  spouses: SpouseConnection[];
  parent_ids: string[];
}
interface RootAncestorConfig {
  person_id: string;
  starting_code: string;
  given_name: string | null;
  surname: string | null;
}

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
  (e: 'jump-to', personId: string): void;
}>();

// Geometrie-Konstanten: Geschwisterkästchen stoßen direkt aneinander (CARD_GAP = 0, kein Innenabstand)
const CARD_WIDTH = 174;
const CARD_HEIGHT = 84;
const DEFAULT_LEVEL_HEIGHT = 200;
const MIN_LEVEL_HEIGHT = 110;
const MAX_LEVEL_HEIGHT = 600;
const LEVEL_SIDEBAR_W = 210;
const CANVAS_PAD_TOP = 65;
const CANVAS_PAD_BOTTOM = 65;
const SNAP_DISTANCE = 16;

interface DesignSiblingGroup {
  id: string;
  parentId: string | null;
  generation: number;
  level: number; // 1 = unterste Ebene (Ursprung/Stammahn), aufsteigend nach oben
  x: number; // Horizontale Mittelposition auf dem Canvas
  memberIds: string[];
  isUngrouped?: boolean; // true wenn Geschwistergruppe in Einzeleinträge aufgelöst wurde
}

interface BranchWidthConstraint {
  personId: string;
  minX: number;
  maxX: number;
}

const siblingGroups = ref<DesignSiblingGroup[]>([]);
const totalLevels = ref<number>(1);
const levelHeights = ref<Record<number, number>>({});
const expandedParentIds = ref<Set<string>>(new Set());
const childrenMapByParentId = ref<Map<string, string[]>>(new Map());

// Ausgewählter Eintrag im Design-Mode & Zweig-Breiten-Abgrenzungen (personId -> [minX, maxX])
const activeDesignPersonId = ref<string>('');
const branchWidths = ref<Map<string, BranchWidthConstraint>>(new Map());
const drawingWidthForPersonId = ref<string | null>(null);

// ----------------------------------------------------
// Undo-Funktionalität (Aktionen im Design-Mode zurücksetzen)
// ----------------------------------------------------
interface HistorySnapshot {
  siblingGroups: DesignSiblingGroup[];
  totalLevels: number;
  levelHeights: Record<number, number>;
  branchWidths: { personId: string; minX: number; maxX: number }[];
  expandedParentIds: string[];
}

const historyStack = ref<HistorySnapshot[]>([]);
const maxHistoryLength = 50;

let preDragSnapshot: HistorySnapshot | null = null;
let preResizeSnapshot: HistorySnapshot | null = null;
let didResizeLevel = false;
let preWidthSnapshot: HistorySnapshot | null = null;
let didDragWidth = false;

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

function pushHistorySnapshot(snapshot: HistorySnapshot) {
  historyStack.value.push(snapshot);
  if (historyStack.value.length > maxHistoryLength) {
    historyStack.value.shift();
  }
}

function pushHistoryState() {
  pushHistorySnapshot(captureCurrentSnapshot());
}

const canUndo = computed(() => historyStack.value.length > 0);

function undoLastAction() {
  if (historyStack.value.length === 0) return;
  const prev = historyStack.value.pop();
  if (!prev) return;
  totalLevels.value = prev.totalLevels;
  levelHeights.value = { ...prev.levelHeights };
  siblingGroups.value = JSON.parse(JSON.stringify(prev.siblingGroups));
  const bwMap = new Map<string, BranchWidthConstraint>();
  prev.branchWidths.forEach(bw => {
    if (bw.personId) bwMap.set(bw.personId, bw);
  });
  branchWidths.value = bwMap;
  expandedParentIds.value = new Set(prev.expandedParentIds);
  activeDesignPersonId.value = '';
}

function onGlobalKeyDown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }
    if (canUndo.value) {
      e.preventDefault();
      undoLastAction();
    }
  }
}

// Drag-State für das Aufziehen / Anpassen einer Zweig-Breite
let widthDragMode: 'draw' | 'left' | 'right' | null = null;
let widthDragPersonId: string | null = null;
let widthDragAnchorX = 0;

// Viewport Pan & Zoom
const viewportRef = ref<HTMLElement | null>(null);
const pan = ref({ x: 0, y: 0 });
const zoom = ref(1);
let isPanning = false;
let panStart = { x: 0, y: 0 };

// Drag-State für Geschwistergruppen / Einzeleinträge & gemeinsam verschiebbare gedockte Cluster
interface DraggingClusterMember {
  group: DesignSiblingGroup;
  startX: number;
  startLevel: number;
  width: number;
}

const draggingGroupId = ref<string | null>(null);
const draggingCluster = ref<DraggingClusterMember[]>([]);
const draggingClusterGroupIds = computed(() => new Set(draggingCluster.value.map(m => m.group.id)));
const dragHoverInsertAboveLevel = ref<number | null>(null);
const activeSnapGuideX = ref<number | null>(null);
let groupDragStartMouse = { x: 0, y: eZero() };
let groupDragStartPos = { x: 0, level: 1 };
let didMoveGroup = false;

function eZero() {
  return 0;
}

// Drag-State für Ebenen-Höhenänderung per Maus
const resizingLevel = ref<number | null>(null);
let resizeStartY = 0;
let resizeStartHeight = DEFAULT_LEVEL_HEIGHT;

const personById = computed<Map<string, Person>>(() => {
  const m = new Map<string, Person>();
  props.persons.forEach(p => m.set(p.id, p));
  return m;
});

const selectedDesignPerson = computed<Person | null>(() => {
  const id = activeDesignPersonId.value || props.selectedId;
  if (!id) return null;
  return personById.value.get(id) || null;
});

function getBiologicalParentId(personId: string): string | null {
  for (const [parId, kids] of childrenMapByParentId.value.entries()) {
    if (kids.includes(personId)) {
      return parId;
    }
  }
  const p = personById.value.get(personId);
  if (p && p.parent_ids && p.parent_ids.length > 0) {
    const found = p.parent_ids.find(id => personById.value.has(id));
    if (found) return found;
  }
  return null;
}

function getLevelHeight(level: number): number {
  const h = levelHeights.value[level];
  if (typeof h === 'number' && !Number.isNaN(h)) {
    return Math.max(MIN_LEVEL_HEIGHT, Math.min(MAX_LEVEL_HEIGHT, h));
  }
  return DEFAULT_LEVEL_HEIGHT;
}

function setLevelHeight(level: number, val: number) {
  const clamped = Math.max(MIN_LEVEL_HEIGHT, Math.min(MAX_LEVEL_HEIGHT, Math.round(val || DEFAULT_LEVEL_HEIGHT)));
  levelHeights.value = {
    ...levelHeights.value,
    [level]: clamped,
  };
}

function extractSortableBirthYear(dateStr: string | null | undefined): number {
  if (!dateStr) return Number.MAX_SAFE_INTEGER;
  const s = dateStr.trim();
  if (!s) return Number.MAX_SAFE_INTEGER;
  const isoMatch = s.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = isoMatch[2] ? parseInt(isoMatch[2], 10) : 6;
    const d = isoMatch[3] ? parseInt(isoMatch[3], 10) : 15;
    return y * 10000 + m * 100 + d;
  }
  const yearMatch = s.match(/(\d{4})/);
  if (yearMatch) {
    return parseInt(yearMatch[1], 10) * 10000 + 600 + 15;
  }
  return Number.MAX_SAFE_INTEGER;
}

function comparePersonsByBirth(a: Person, b: Person): number {
  const keyA = extractSortableBirthYear(a.birth_date);
  const keyB = extractSortableBirthYear(b.birth_date);
  if (keyA !== keyB) return keyA - keyB;
  return a.id.localeCompare(b.id);
}

function getParentHenryCode(hCode: string, startCode: string): string | null {
  if (!hCode || hCode === startCode || !hCode.startsWith(startCode)) return null;
  const suffix = hCode.slice(startCode.length);
  if (!suffix) return null;
  const match = suffix.match(/(\(\d+\)|[0-9A-Z])$/);
  if (!match) return null;
  return hCode.slice(0, hCode.length - match[1].length);
}

function getActiveStartCode(pid: string): string {
  const found = props.rootAncestors.find(r => r.person_id === pid);
  return found ? found.starting_code : '1';
}

// Da die Rahmenlinien der Geschwisterkästchen direkt aneinanderstoßen, ist die Gruppenbreite exakt n * CARD_WIDTH
function getGroupWidth(memberCount: number): number {
  const n = Math.max(1, memberCount);
  return n * CARD_WIDTH;
}

// Liefert alle Nachkommen-IDs einer Person im aktuellen Stammahn-Baum
function getDescendantPersonIds(ancestorId: string): Set<string> {
  const desc = new Set<string>();
  const queue = [ancestorId];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    const kids = childrenMapByParentId.value.get(curr) || [];
    kids.forEach(k => {
      if (!desc.has(k)) {
        desc.add(k);
        queue.push(k);
      }
    });
  }
  return desc;
}

// Findet die aktuelle Ebene und horizontale Position eines Personeneintrags (auch vor dem Filtern)
function getRawPersonPosition(personId: string): { level: number; left: number; right: number; centerX: number } | null {
  for (const g of siblingGroups.value) {
    const idx = g.memberIds.indexOf(personId);
    if (idx >= 0) {
      const w = getGroupWidth(g.memberIds.length);
      const gLeft = Math.round(g.x - w / 2);
      const cLeft = gLeft + idx * CARD_WIDTH;
      return {
        level: g.level,
        left: cLeft,
        right: cLeft + CARD_WIDTH,
        centerX: cLeft + CARD_WIDTH / 2,
      };
    }
  }
  return null;
}

// Platziert alle Nachfolgeeinträge von personId innerhalb [minX, maxX]
function placeDescendantsWithinWidth(personId: string, minX: number, maxX: number) {
  const descIds = getDescendantPersonIds(personId);
  if (descIds.size === 0) return;

  const descGroups = siblingGroups.value.filter(
    g => (g.parentId && (g.parentId === personId || descIds.has(g.parentId))) || g.memberIds.some(id => descIds.has(id))
  );
  if (descGroups.length === 0) return;

  // Gruppiert nach Ebene alle Nachfolgeeinträge innerhalb [minX, maxX] anordnen
  const byLevel = new Map<number, DesignSiblingGroup[]>();
  descGroups.forEach(g => {
    if (!byLevel.has(g.level)) byLevel.set(g.level, []);
    byLevel.get(g.level)!.push(g);
  });

  const spanWidth = Math.max(CARD_WIDTH, maxX - minX);
  const centerSpanX = Math.round((minX + maxX) / 2);

  byLevel.forEach(lvlGroups => {
    lvlGroups.sort((a, b) => a.x - b.x);
    if (lvlGroups.length === 1) {
      const g = lvlGroups[0];
      const gw = getGroupWidth(g.memberIds.length);
      if (gw >= spanWidth) {
        g.x = centerSpanX;
      } else {
        const minAllowedCenter = Math.round(minX + gw / 2);
        const maxAllowedCenter = Math.round(maxX - gw / 2);
        // Falls noch außerhalb oder beim ersten Ziehen: innerhalb [minX, maxX] zentrieren/einpassen
        if (g.x < minAllowedCenter || g.x > maxAllowedCenter) {
          g.x = Math.max(minAllowedCenter, Math.min(maxAllowedCenter, centerSpanX));
        } else {
          g.x = centerSpanX;
        }
      }
    } else {
      const widths = lvlGroups.map(g => getGroupWidth(g.memberIds.length));
      const totalGroupW = widths.reduce((a, b) => a + b, 0);
      if (totalGroupW >= spanWidth) {
        // Dicht Kante an Kante zentriert innerhalb von [minX, maxX]
        let cursor = Math.round(centerSpanX - totalGroupW / 2);
        lvlGroups.forEach((g, idx) => {
          const w = widths[idx];
          g.x = Math.round(cursor + w / 2);
          cursor += w;
        });
      } else {
        // Gleichmäßig innerhalb von [minX, maxX] verteilen, sodass alle Nachfolgeeinträge komplett in [minX, maxX] liegen
        const freeSpace = spanWidth - totalGroupW;
        const gap = freeSpace / (lvlGroups.length + 1);
        let cursor = minX + gap;
        lvlGroups.forEach((g, idx) => {
          const w = widths[idx];
          g.x = Math.round(cursor + w / 2);
          cursor += w + gap;
        });
      }
    }
  });
}

// Initialisiert den Stammbaum mit dem ausgewählten Stammahnen als Ursprung (Ebene 1 unten -> nach oben)
function buildInitialDesignLayout() {
  if (siblingGroups.value.length > 0) {
    pushHistoryState();
  }
  const pid = props.activeProbandId;
  branchWidths.value = new Map();
  drawingWidthForPersonId.value = null;

  if (!pid) {
    siblingGroups.value = [];
    totalLevels.value = 1;
    expandedParentIds.value = new Set();
    childrenMapByParentId.value = new Map();
    return;
  }

  const rootPerson = personById.value.get(pid);
  if (!rootPerson) {
    siblingGroups.value = [];
    totalLevels.value = 1;
    expandedParentIds.value = new Set();
    childrenMapByParentId.value = new Map();
    return;
  }

  const startCode = getActiveStartCode(pid);
  const pList = props.persons.filter(p => p.proband_data[pid]);

  const childrenByParentId = new Map<string, Person[]>();
  const personByHenry = new Map<string, Person>();
  pList.forEach(p => {
    const code = p.proband_data[pid]?.henry_code;
    if (code) personByHenry.set(code, p);
  });

  pList.forEach(p => {
    const code = p.proband_data[pid]?.henry_code;
    if (!code || code === startCode) return;
    const parentCode = getParentHenryCode(code, startCode);
    if (parentCode) {
      const parentPerson = personByHenry.get(parentCode);
      if (parentPerson) {
        if (!childrenByParentId.has(parentPerson.id)) {
          childrenByParentId.set(parentPerson.id, []);
        }
        childrenByParentId.get(parentPerson.id)!.push(p);
      }
    }
  });

  childrenByParentId.forEach(list => list.sort(comparePersonsByBirth));

  const cIdMap = new Map<string, string[]>();
  const initialExpanded = new Set<string>();
  childrenByParentId.forEach((list, parentId) => {
    if (list.length > 0) {
      cIdMap.set(parentId, list.map(c => c.id));
      initialExpanded.add(parentId);
    }
  });
  childrenMapByParentId.value = cIdMap;
  expandedParentIds.value = initialExpanded;

  // Subtree-Breite rekursiv berechnen
  const subtreeWidthMap = new Map<string, number>();
  const visitedWidth = new Set<string>();

  function computePersonSubtreeSpan(personId: string): number {
    if (visitedWidth.has(personId)) return CARD_WIDTH + 32;
    visitedWidth.add(personId);
    const children = childrenByParentId.get(personId) || [];
    if (children.length === 0) {
      subtreeWidthMap.set(personId, CARD_WIDTH + 32);
      return CARD_WIDTH + 32;
    }
    const groupOwnW = getGroupWidth(children.length) + 36;
    let childrenSubtreesW = 0;
    children.forEach(c => {
      childrenSubtreesW += computePersonSubtreeSpan(c.id);
    });
    const span = Math.max(groupOwnW, childrenSubtreesW);
    subtreeWidthMap.set(personId, span);
    return span;
  }

  const totalSpan = computePersonSubtreeSpan(rootPerson.id);
  const baseCenterX = Math.max(720, LEVEL_SIDEBAR_W + totalSpan / 2 + 120);

  const groups: DesignSiblingGroup[] = [];
  let maxGen = 1;

  // Ursprung: Stammahn auf Ebene 1 (unten) — bleibt immer aktiv
  groups.push({
    id: `sg-root-${rootPerson.id}`,
    parentId: null,
    generation: 1,
    level: 1,
    x: baseCenterX,
    memberIds: [rootPerson.id],
    isUngrouped: false,
  });

  const visitedBuild = new Set<string>([rootPerson.id]);

  function layoutChildrenOf(parentId: string, parentGen: number, spanCenterX: number) {
    const children = (childrenByParentId.get(parentId) || []).filter(c => !visitedBuild.has(c.id));
    if (children.length === 0) return;
    children.forEach(c => visitedBuild.add(c.id));

    const gen = parentGen + 1;
    if (gen > maxGen) maxGen = gen;

    groups.push({
      id: `sg-of-${parentId}`,
      parentId,
      generation: gen,
      level: gen,
      x: spanCenterX,
      memberIds: children.map(c => c.id),
      isUngrouped: false,
    });

    const childSpans = children.map(c => subtreeWidthMap.get(c.id) || (CARD_WIDTH + 32));
    const sumChildSpans = childSpans.reduce((a, b) => a + b, 0);
    let cursorX = spanCenterX - sumChildSpans / 2;

    children.forEach((c, idx) => {
      const w = childSpans[idx];
      const childCenterX = cursorX + w / 2;
      layoutChildrenOf(c.id, gen, childCenterX);
      cursorX += w;
    });
  }

  layoutChildrenOf(rootPerson.id, 1, baseCenterX);

  // Überlappungen auf derselben Ebene entzerren
  const byLevel = new Map<number, DesignSiblingGroup[]>();
  groups.forEach(g => {
    if (!byLevel.has(g.level)) byLevel.set(g.level, []);
    byLevel.get(g.level)!.push(g);
  });

  byLevel.forEach(lvlGroups => {
    lvlGroups.sort((a, b) => a.x - b.x);
    for (let i = 1; i < lvlGroups.length; i++) {
      const prev = lvlGroups[i - 1];
      const curr = lvlGroups[i];
      const minGap = (getGroupWidth(prev.memberIds.length) + getGroupWidth(curr.memberIds.length)) / 2 + 24;
      if (curr.x - prev.x < minGap) {
        curr.x = prev.x + minGap;
      }
    }
  });

  totalLevels.value = Math.max(1, maxGen);
  const heightsObj: Record<number, number> = {};
  for (let l = 1; l <= totalLevels.value; l++) {
    heightsObj[l] = levelHeights.value[l] || DEFAULT_LEVEL_HEIGHT;
  }
  levelHeights.value = heightsObj;
  siblingGroups.value = groups;

  nextTick(() => {
    centerOnOrigin();
  });
}

// Ein- und Ausklappen von Nachfahren (Stammahn bleibt immer als Ursprung aktiv)
function hasDescendants(personId: string): boolean {
  const c = childrenMapByParentId.value.get(personId);
  return Boolean(c && c.length > 0);
}

function isParentExpanded(personId: string): boolean {
  return expandedParentIds.value.has(personId);
}

function toggleDescendants(personId: string) {
  const next = new Set(expandedParentIds.value);
  if (next.has(personId)) {
    const queue = [personId];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      next.delete(curr);
      const kids = childrenMapByParentId.value.get(curr) || [];
      kids.forEach(k => queue.push(k));
    }
  } else {
    next.add(personId);
  }
  expandedParentIds.value = next;

  // Falls aktive Zweig-Breiten bestehen, Nachfolgeeinträge darin ausrichten
  branchWidths.value.forEach(bw => {
    placeDescendantsWithinWidth(bw.personId, bw.minX, bw.maxX);
  });
}

function expandAllDescendants() {
  pushHistoryState();
  const next = new Set<string>();
  childrenMapByParentId.value.forEach((kids, parentId) => {
    if (kids.length > 0) next.add(parentId);
  });
  expandedParentIds.value = next;
  branchWidths.value.forEach(bw => {
    placeDescendantsWithinWidth(bw.personId, bw.minX, bw.maxX);
  });
}

function collapseAllToOrigin() {
  pushHistoryState();
  expandedParentIds.value = new Set();
  nextTick(() => centerOnOrigin());
}

// Bei aktiver Zweig-Abgrenzung werden andere Einträge automatisch nach außen gerückt,
// sodass alle Personen sichtbar bleiben und der Korridor freigehalten wird.
function isCardBlockedByBranchWidths(_memberId: string, _groupLevel: number, _cLeft: number, _cRight: number): boolean {
  return false;
}

// Sichtbare Gruppen & sichtbare Personen unter Berücksichtigung von:
// 1. Expand/Collapse-Status (Stammahn bleibt immer aktiv)
// 2. Zweig-Breiten-Abgrenzungen (Einträge aus anderen Zweigen oberhalb einer gezogenen Breite sowie deren Nachfahren werden nicht dargestellt)
const visibleGroupAndMemberMap = computed<{
  groups: DesignSiblingGroup[];
  visibleMembersByGroupId: Map<string, string[]>;
}>(() => {
  const visiblePersons = new Set<string>();
  const resultGroups: DesignSiblingGroup[] = [];
  const membersMap = new Map<string, string[]>();

  // 1. Ursprung (parentId === null) ist immer aktiv
  siblingGroups.value.forEach(g => {
    if (g.parentId === null) {
      resultGroups.push(g);
      membersMap.set(g.id, [...g.memberIds]);
      g.memberIds.forEach(id => visiblePersons.add(id));
    }
  });

  let added = true;
  const includedGroupIds = new Set<string>(resultGroups.map(g => g.id));

  while (added) {
    added = false;
    for (const g of siblingGroups.value) {
      if (includedGroupIds.has(g.id)) continue;
      if (
        g.parentId &&
        visiblePersons.has(g.parentId) &&
        expandedParentIds.value.has(g.parentId)
      ) {
        const w = getGroupWidth(g.memberIds.length);
        const gLeft = Math.round(g.x - w / 2);

        // Prüfe für jedes Mitglied der Gruppe, ob es oberhalb einer fremden Zweig-Breite liegt
        const allowedMembers = g.memberIds.filter((mId, idx) => {
          const cLeft = gLeft + idx * CARD_WIDTH;
          const cRight = cLeft + CARD_WIDTH;
          return !isCardBlockedByBranchWidths(mId, g.level, cLeft, cRight);
        });

        includedGroupIds.add(g.id);
        if (allowedMembers.length > 0) {
          resultGroups.push(g);
          membersMap.set(g.id, allowedMembers);
          allowedMembers.forEach(id => visiblePersons.add(id));
          added = true;
        }
      }
    }
  }

  return {
    groups: resultGroups,
    visibleMembersByGroupId: membersMap,
  };
});

const visibleSiblingGroups = computed<DesignSiblingGroup[]>(() => visibleGroupAndMemberMap.value.groups);

function centerOnOrigin() {
  const vp = viewportRef.value;
  const rootGroup = siblingGroups.value.find(g => g.parentId === null);
  if (!vp || !rootGroup) {
    pan.value = { x: 0, y: 0 };
    zoom.value = 1;
    return;
  }
  const vpW = vp.clientWidth || 1000;
  const vpH = vp.clientHeight || 650;
  const cHeight = canvasHeight.value;
  zoom.value = 1;
  pan.value = {
    x: Math.round(vpW / 2 - rootGroup.x),
    y: Math.round(vpH - cHeight + 20),
  };
}

function fitToScreen() {
  const vp = viewportRef.value;
  if (!vp) return;

  const vpW = vp.clientWidth || 1000;
  const vpH = vp.clientHeight || 650;

  if (groupLayouts.value.length === 0) {
    centerOnOrigin();
    return;
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  groupLayouts.value.forEach(gl => {
    if (gl.left < minX) minX = gl.left;
    if (gl.right > maxX) maxX = gl.right;
    if (gl.top < minY) minY = gl.top;
    if (gl.bottom > maxY) maxY = gl.bottom;
  });

  renderedBranchWidths.value.forEach(bw => {
    if (bw.minX < minX) minX = bw.minX;
    if (bw.maxX > maxX) maxX = bw.maxX;
    if (bw.barY < minY) minY = bw.barY;
    if (bw.corridorTopY < minY) minY = bw.corridorTopY;
  });

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    centerOnOrigin();
    return;
  }

  const padX = 60;
  const padY = 60;
  const contentW = Math.max(100, (maxX - minX) + padX * 2);
  const contentH = Math.max(100, (maxY - minY) + padY * 2);

  const scaleX = vpW / contentW;
  const scaleY = vpH / contentH;
  const targetZoom = Math.max(0.1, Math.min(2.0, Math.min(scaleX, scaleY)));

  zoom.value = Math.round(targetZoom * 100) / 100;

  const contentCenterX = (minX + maxX) / 2;
  const contentCenterY = (minY + maxY) / 2;

  pan.value = {
    x: Math.round(vpW / 2 - contentCenterX * zoom.value),
    y: Math.round(vpH / 2 - contentCenterY * zoom.value),
  };
}

watch(() => [props.activeProbandId, props.persons.length], () => {
  buildInitialDesignLayout();
}, { immediate: true });

onMounted(() => {
  nextTick(() => centerOnOrigin());
  if (viewportRef.value) {
    viewportRef.value.addEventListener('wheel', handleWheelZoom, { passive: false });
  }
  window.addEventListener('keydown', onGlobalKeyDown);
});

onUnmounted(() => {
  if (viewportRef.value) {
    viewportRef.value.removeEventListener('wheel', handleWheelZoom);
  }
  window.removeEventListener('keydown', onGlobalKeyDown);
});

// Kumulative Ebenen-Geometrie mit individuell definierbarer Höhe pro Ebene
function getLevelBandTopY(level: number): number {
  let y = CANVAS_PAD_TOP;
  for (let l = totalLevels.value; l > level; l--) {
    y += getLevelHeight(l);
  }
  return y;
}

function getGroupTopY(level: number): number {
  const bandTop = getLevelBandTopY(level);
  const lvlH = getLevelHeight(level);
  return bandTop + Math.round((lvlH - CARD_HEIGHT) / 2);
}

function getLevelAtCanvasY(canvasY: number): { level: number; insertAboveLevel: number | null } {
  let y = CANVAS_PAD_TOP;
  for (let l = totalLevels.value; l >= 1; l--) {
    const h = getLevelHeight(l);
    const bandTop = y;
    const bandBottom = y + h;
    if (Math.abs(canvasY - bandTop) < 16) {
      return { level: l, insertAboveLevel: l };
    }
    if (canvasY >= bandTop && canvasY <= bandBottom) {
      if (Math.abs(canvasY - bandBottom) < 16) {
        return { level: l, insertAboveLevel: l - 1 };
      }
      return { level: l, insertAboveLevel: null };
    }
    y += h;
  }
  if (canvasY < CANVAS_PAD_TOP) {
    return { level: totalLevels.value, insertAboveLevel: totalLevels.value };
  }
  return { level: 1, insertAboveLevel: null };
}

const canvasHeight = computed<number>(() => {
  let sum = CANVAS_PAD_TOP + CANVAS_PAD_BOTTOM;
  for (let l = 1; l <= totalLevels.value; l++) {
    sum += getLevelHeight(l);
  }
  return sum;
});

const canvasWidth = computed<number>(() => {
  let maxRight = 1400;
  visibleSiblingGroups.value.forEach(g => {
    const right = g.x + getGroupWidth(g.memberIds.length) / 2 + 240;
    if (right > maxRight) maxRight = right;
  });
  branchWidths.value.forEach(bw => {
    if (bw.maxX + 200 > maxRight) maxRight = bw.maxX + 200;
  });
  return maxRight;
});

const levelsTopToBottom = computed(() => {
  const list: {
    level: number;
    bandTopY: number;
    height: number;
    generations: number[];
    groupCount: number;
  }[] = [];

  for (let lvl = totalLevels.value; lvl >= 1; lvl--) {
    const groupsInLevel = visibleSiblingGroups.value.filter(g => g.level === lvl);
    const gens = Array.from(new Set(groupsInLevel.map(g => g.generation))).sort((a, b) => a - b);
    list.push({
      level: lvl,
      bandTopY: getLevelBandTopY(lvl),
      height: getLevelHeight(lvl),
      generations: gens,
      groupCount: groupsInLevel.length,
    });
  }
  return list;
});

// Berechnet die exakten Kästchen- und Gruppenboxen auf dem Canvas
interface CardBox {
  person: Person;
  groupId: string;
  level: number;
  generation: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
}

interface SiblingSubGroup {
  id: string;
  parentId: string | null;
  parentPerson: Person | null;
  cards: CardBox[];
  isMultiSibling: boolean;
}

interface GroupLayoutInfo {
  group: DesignSiblingGroup;
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
  parentPerson: Person | null;
  cards: CardBox[];
  siblingSubGroups: SiblingSubGroup[];
  canRegroup: boolean;
  isDocked: boolean;
}

const groupLayouts = computed<GroupLayoutInfo[]>(() => {
  const countByParentId = new Map<string, number>();
  siblingGroups.value.forEach(g => {
    if (g.parentId) {
      countByParentId.set(g.parentId, (countByParentId.get(g.parentId) || 0) + 1);
    }
  });

  const membersByGroup = visibleGroupAndMemberMap.value.visibleMembersByGroupId;

  return visibleSiblingGroups.value.map(group => {
    const visibleMemberIds = membersByGroup.get(group.id) || group.memberIds;
    const width = getGroupWidth(visibleMemberIds.length);
    const left = Math.round(group.x - width / 2);
    const right = left + width;
    const top = getGroupTopY(group.level);
    const bottom = top + CARD_HEIGHT;

    const cards: CardBox[] = [];
    visibleMemberIds.forEach((pid, idx) => {
      const p = personById.value.get(pid);
      if (!p) return;
      const cLeft = left + idx * CARD_WIDTH;
      const cRight = cLeft + CARD_WIDTH;
      cards.push({
        person: p,
        groupId: group.id,
        level: group.level,
        generation: group.generation,
        left: cLeft,
        right: cRight,
        top,
        bottom,
        centerX: cLeft + CARD_WIDTH / 2,
        centerY: top + CARD_HEIGHT / 2,
      });
    });

    // Geschwister-Subgruppen innerhalb dieses Gruppenverbands ermitteln (biologische Geschwister)
    const siblingSubGroups: SiblingSubGroup[] = [];
    let currentSubGroup: SiblingSubGroup | null = null;

    cards.forEach((cb, idx) => {
      const pId = getBiologicalParentId(cb.person.id);

      if (!currentSubGroup || currentSubGroup.parentId !== pId || pId === null) {
        currentSubGroup = {
          id: `${group.id}-sub-${idx}-${pId || 'indiv'}`,
          parentId: pId,
          parentPerson: pId ? (personById.value.get(pId) || null) : null,
          cards: [cb],
          isMultiSibling: false,
        };
        siblingSubGroups.push(currentSubGroup);
      } else {
        currentSubGroup.cards.push(cb);
        currentSubGroup.isMultiSibling = true;
      }
    });

    const canRegroup = group.memberIds.some(id => canRegroupPerson(id));

    // Prüfen, ob dieser Eintrag / diese Gruppe an einen Nachbarn auf derselben Ebene anstößt (<= 2px)
    const isDocked = visibleSiblingGroups.value.some(other => {
      if (other.id === group.id || other.level !== group.level) return false;
      const oW = getGroupWidth(other.memberIds.length);
      const oLeft = Math.round(other.x - oW / 2);
      const oRight = oLeft + oW;
      return Math.abs(right - oLeft) <= 2 || Math.abs(left - oRight) <= 2;
    });

    return {
      group,
      left,
      right,
      top,
      bottom,
      width,
      height: CARD_HEIGHT,
      parentPerson: group.parentId ? (personById.value.get(group.parentId) || null) : null,
      cards,
      siblingSubGroups,
      canRegroup,
      isDocked,
    };
  });
});

const cardBoxByPersonId = computed<Map<string, CardBox>>(() => {
  const m = new Map<string, CardBox>();
  groupLayouts.value.forEach(gl => {
    gl.cards.forEach(cb => m.set(cb.person.id, cb));
  });
  return m;
});

// Darstellungsdaten für alle aktiven Zweig-Breiten-Abgrenzungen
const renderedBranchWidths = computed(() => {
  const list: {
    personId: string;
    personName: string;
    level: number;
    minX: number;
    maxX: number;
    width: number;
    barY: number;
    corridorTopY: number;
    corridorHeight: number;
  }[] = [];

  branchWidths.value.forEach(bw => {
    const person = personById.value.get(bw.personId);
    const rawPos = getRawPersonPosition(bw.personId);
    if (!person || !rawPos) return;
    const bandTop = getLevelBandTopY(rawPos.level);
    const bandBottom = bandTop + getLevelHeight(rawPos.level);
    const cardTop = getGroupTopY(rawPos.level);
    const barY = cardTop - 22;
    const corridorTopY = CANVAS_PAD_TOP;
    // Der reservierte Bereich gilt auch für die Ebene auf der sich der ausgewählte Eintrag selbst befindet
    const corridorHeight = Math.max(0, bandBottom - CANVAS_PAD_TOP);

    list.push({
      personId: bw.personId,
      personName: `${person.given_name || 'N.N.'} ${person.surname || ''}`.trim(),
      level: rawPos.level,
      minX: bw.minX,
      maxX: bw.maxX,
      width: Math.round(bw.maxX - bw.minX),
      barY,
      corridorTopY,
      corridorHeight,
    });
  });

  return list;
});

// Prüfen, ob eine Person aktuell selektiert ist
function isPersonSelected(personId: string): boolean {
  const sel = activeDesignPersonId.value || props.selectedId;
  return Boolean(sel && sel === personId);
}

// Die Zweig-Abgrenzung steht nur isolierten Einträgen zur Verfügung (Gruppe mit 1 Mitglied)
function isPersonIsolated(personId: string): boolean {
  const g = siblingGroups.value.find(grp => grp.memberIds.includes(personId));
  return Boolean(g && g.memberIds.length === 1);
}

// Wird eine reservierte Zweigbereite verwendet, werden andere Einträge in diesem Bereich
// so weit nach außen gerückt, dass sie außerhalb des Bereiches erscheinen.
// Die Reihenfolge der Einträge bleibt bestehen, aber der dem Bereich nächste Eintrag schiebt alle weiteren nach außen.
// Der reservierte Bereich gilt auch für die Ebene, auf der sich der ausgewählte Eintrag selbst befindet.
function pushNonBranchEntriesOutward(bw: BranchWidthConstraint) {
  const rawPos = getRawPersonPosition(bw.personId);
  if (!rawPos) return;

  const bwLevel = rawPos.level;
  const descSet = getDescendantPersonIds(bw.personId);

  for (let lvl = bwLevel; lvl <= totalLevels.value; lvl++) {
    const groupsOnLevel = siblingGroups.value.filter(g => g.level === lvl);

    const nonBranchGroups = groupsOnLevel.filter(g => {
      if (lvl === bwLevel) {
        return !g.memberIds.includes(bw.personId);
      } else {
        const isDesc = (g.parentId && (g.parentId === bw.personId || descSet.has(g.parentId))) ||
          g.memberIds.some(id => descSet.has(id));
        return !isDesc;
      }
    });

    if (nonBranchGroups.length === 0) continue;

    // Reihenfolge der Einträge strikt beibehalten
    nonBranchGroups.sort((a, b) => a.x - b.x);

    const midX = (bw.minX + bw.maxX) / 2;
    const leftSideGroups: DesignSiblingGroup[] = [];
    const rightSideGroups: DesignSiblingGroup[] = [];

    nonBranchGroups.forEach(g => {
      const gW = getGroupWidth(g.memberIds.length);
      const gLeft = g.x - gW / 2;
      const gRight = g.x + gW / 2;

      if (gRight <= bw.minX - 10) {
        leftSideGroups.push(g);
      } else if (gLeft >= bw.maxX + 10) {
        rightSideGroups.push(g);
      } else if (g.x < midX) {
        leftSideGroups.push(g);
      } else {
        rightSideGroups.push(g);
      }
    });

    // 1. Rechte Seite: der dem Bereich nächste Eintrag schiebt alle weiteren Einträge nach außen (nach rechts)
    let rightCursor = bw.maxX + 14;
    for (const g of rightSideGroups) {
      const gW = getGroupWidth(g.memberIds.length);
      const minCenter = rightCursor + gW / 2;
      if (g.x < minCenter) {
        g.x = Math.round(minCenter);
      }
      rightCursor = Math.round(g.x + gW / 2 + 16);
    }

    // 2. Linke Seite: der dem Bereich nächste Eintrag schiebt alle weiteren Einträge nach außen (nach links)
    let leftCursor = bw.minX - 14;
    for (let i = leftSideGroups.length - 1; i >= 0; i--) {
      const g = leftSideGroups[i];
      const gW = getGroupWidth(g.memberIds.length);
      const maxCenter = leftCursor - gW / 2;
      if (g.x > maxCenter) {
        g.x = Math.round(maxCenter);
      }
      leftCursor = Math.round(g.x - gW / 2 - 16);
    }

    // Mindestabstand zur linken Seitenleiste einhalten
    if (leftSideGroups.length > 0) {
      const minLeftEdge = Math.min(...leftSideGroups.map(g => g.x - getGroupWidth(g.memberIds.length) / 2));
      const minAllowed = LEVEL_SIDEBAR_W + 12;
      if (minLeftEdge < minAllowed) {
        const shift = minAllowed - minLeftEdge;
        leftSideGroups.forEach(g => { g.x += shift; });
      }
    }
  }
}

// Auswahl eines Eintrags & Starten / Anpassen der Zweig-Breite auf der Ebene des Eintrags
function selectCardPerson(person: Person) {
  if (didMoveGroup) return;
  activeDesignPersonId.value = person.id;
  emit('select', person);
}

function startOrToggleBranchWidthFor(personId: string) {
  // Die Zweig-Abgrenzung steht nur isolierten Einträgen zur Verfügung
  if (!isPersonIsolated(personId)) return;

  activeDesignPersonId.value = personId;
  const p = personById.value.get(personId);
  if (p) emit('select', p);

  const pos = getRawPersonPosition(personId);
  if (!pos) return;

  // Falls noch keine Zweig-Breite für diesen Eintrag existiert, initialen Balken auf seiner Ebene anlegen
  if (!branchWidths.value.has(personId)) {
    pushHistoryState();
    const initialMinX = Math.max(LEVEL_SIDEBAR_W + 10, pos.left - 110);
    const initialMaxX = pos.right + 110;
    const newBw = {
      personId,
      minX: initialMinX,
      maxX: initialMaxX,
    };
    const nextMap = new Map(branchWidths.value);
    nextMap.set(personId, newBw);
    branchWidths.value = nextMap;

    // Stelle sicher, dass Nachfahren ausgeklappt sind und innerhalb der gezogenen Breite platziert werden
    if (hasDescendants(personId) && !expandedParentIds.value.has(personId)) {
      const nextExp = new Set(expandedParentIds.value);
      nextExp.add(personId);
      expandedParentIds.value = nextExp;
    }
    placeDescendantsWithinWidth(personId, initialMinX, initialMaxX);
    pushNonBranchEntriesOutward(newBw);
  }

  drawingWidthForPersonId.value =
    drawingWidthForPersonId.value === personId ? null : personId;
}

function removeBranchWidth(personId: string) {
  pushHistoryState();
  const nextMap = new Map(branchWidths.value);
  nextMap.delete(personId);
  branchWidths.value = nextMap;
  if (drawingWidthForPersonId.value === personId) {
    drawingWidthForPersonId.value = null;
  }
}

function screenXToCanvasX(clientX: number): number {
  const vp = viewportRef.value;
  if (!vp) return clientX;
  const rect = vp.getBoundingClientRect();
  return Math.round((clientX - rect.left - pan.value.x) / zoom.value);
}

// Ziehen der Zweig-Breite direkt auf dem Ebenen-Band (wenn Zieh-Modus aktiv ist)
function onLevelBandMouseDown(e: MouseEvent, level: number) {
  if (!drawingWidthForPersonId.value) return;
  const targetPid = drawingWidthForPersonId.value;
  const pos = getRawPersonPosition(targetPid);
  if (!pos || pos.level !== level) return;

  e.stopPropagation();
  preWidthSnapshot = captureCurrentSnapshot();
  didDragWidth = false;

  const startCanvasX = Math.max(LEVEL_SIDEBAR_W + 10, screenXToCanvasX(e.clientX));
  widthDragMode = 'draw';
  widthDragPersonId = targetPid;
  widthDragAnchorX = startCanvasX;

  const minX = Math.min(startCanvasX, pos.left);
  const maxX = Math.max(startCanvasX, pos.right);
  const nextMap = new Map(branchWidths.value);
  const newBw = { personId: targetPid, minX, maxX };
  nextMap.set(targetPid, newBw);
  branchWidths.value = nextMap;
  placeDescendantsWithinWidth(targetPid, minX, maxX);
  pushNonBranchEntriesOutward(newBw);

  window.addEventListener('mousemove', onWindowWidthDragMove);
  window.addEventListener('mouseup', onWindowWidthDragEnd);
}

// Ziehen des linken oder rechten Griffs (◀ / ▶) einer bestehenden Zweig-Breite
function startBranchWidthHandleDrag(e: MouseEvent, personId: string, side: 'left' | 'right') {
  if (e.button !== 0) return;
  e.stopPropagation();
  preWidthSnapshot = captureCurrentSnapshot();
  didDragWidth = false;
  widthDragMode = side;
  widthDragPersonId = personId;
  window.addEventListener('mousemove', onWindowWidthDragMove);
  window.addEventListener('mouseup', onWindowWidthDragEnd);
}

function onWindowWidthDragMove(e: MouseEvent) {
  if (!widthDragMode || !widthDragPersonId) return;
  const bw = branchWidths.value.get(widthDragPersonId);
  const pos = getRawPersonPosition(widthDragPersonId);
  if (!bw || !pos) return;

  didDragWidth = true;
  const currCanvasX = Math.max(LEVEL_SIDEBAR_W + 10, screenXToCanvasX(e.clientX));
  let newMinX = bw.minX;
  let newMaxX = bw.maxX;

  if (widthDragMode === 'draw') {
    const rawMin = Math.min(widthDragAnchorX, currCanvasX);
    const rawMax = Math.max(widthDragAnchorX, currCanvasX);
    // Der ausgewählte Eintrag selbst bleibt stets innerhalb seiner gezogenen Breite eingeschlossen
    newMinX = Math.min(rawMin, pos.left);
    newMaxX = Math.max(rawMax, pos.right);
  } else if (widthDragMode === 'left') {
    newMinX = Math.min(currCanvasX, pos.left);
  } else if (widthDragMode === 'right') {
    newMaxX = Math.max(currCanvasX, pos.right);
  }

  if (newMaxX - newMinX < CARD_WIDTH) {
    newMaxX = newMinX + CARD_WIDTH;
  }

  const nextMap = new Map(branchWidths.value);
  const updatedBw = {
    personId: widthDragPersonId,
    minX: newMinX,
    maxX: newMaxX,
  };
  nextMap.set(widthDragPersonId, updatedBw);
  branchWidths.value = nextMap;

  // Alle Nachfolgeeinträge live innerhalb der gezogenen Breite platzieren
  placeDescendantsWithinWidth(widthDragPersonId, newMinX, newMaxX);
  // Andere Einträge nach außen rücken
  pushNonBranchEntriesOutward(updatedBw);
}

function onWindowWidthDragEnd() {
  if (didDragWidth && preWidthSnapshot) {
    pushHistorySnapshot(preWidthSnapshot);
  }
  preWidthSnapshot = null;
  didDragWidth = false;

  if (widthDragMode === 'draw') {
    drawingWidthForPersonId.value = null;
  }
  widthDragMode = null;
  widthDragPersonId = null;
  window.removeEventListener('mousemove', onWindowWidthDragMove);
  window.removeEventListener('mouseup', onWindowWidthDragEnd);
}

// Kanten-Segmente (starten und enden direkt an den Kästchen der Einträge) & Linienbrücken bei Kreuzungen
interface LineSegment {
  id: string;
  edgeKey: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  isHighlighted: boolean;
}

interface ArrowHead {
  x: number;
  y: number;
  direction: 'up' | 'down';
  isHighlighted: boolean;
}

interface SiblingGroupRelation {
  parentId: string;
  childLevel: number;
  pBox: CardBox;
  cBoxes: CardBox[];
  minChildX: number;
  maxChildX: number;
}

// Optimiert die Ebenen-Zuweisung (Lanes) der horizontalen Querlinien, um Kreuzungen / Linienbrücken zu minimieren
function optimizeSiblingGroupLanes(
  groupRels: SiblingGroupRelation[],
  maxLanes: number,
  _mode: 'up' | 'down' | 'same'
): number[] {
  const n = groupRels.length;
  if (n <= 1) return [0];
  if (maxLanes <= 1) return new Array(n).fill(0);

  const items = groupRels.map(rel => {
    const parentX = rel.pBox.centerX;
    const barMin = Math.min(parentX, rel.minChildX);
    const barMax = Math.max(parentX, rel.maxChildX);
    const childrenX = rel.cBoxes.map(c => c.centerX);
    return { parentX, barMin, barMax, childrenX };
  });

  const pairCosts: { iBelowJ: number; jBelowI: number; overlap: boolean }[][] = [];
  for (let i = 0; i < n; i++) {
    pairCosts[i] = [];
    for (let j = 0; j < n; j++) {
      if (i === j) {
        pairCosts[i][j] = { iBelowJ: 0, jBelowI: 0, overlap: false };
        continue;
      }
      const itemI = items[i];
      const itemJ = items[j];
      const overlap = Math.max(itemI.barMin, itemJ.barMin) <= Math.min(itemI.barMax, itemJ.barMax) - 4;

      let iBelowJ = 0;
      let jBelowI = 0;

      // i auf niedrigerem Lane-Index als j (l_i < l_j):
      // i liegt näher an den Kindern (Ebene 0 / höhere Ebene),
      // j liegt weiter weg / näher am Elternteil (niedrigere Ebene).
      // 1) i's Elternstamm startet am Elternknoten und muss zu i's Querlinie laufen.
      //    Da j's Querlinie dazwischen liegt, kreuzt i's Elternstamm j's Querlinie:
      if (itemI.parentX > itemJ.barMin + 3 && itemI.parentX < itemJ.barMax - 3) {
        iBelowJ++;
      }
      // 2) j's Kinder-Abgangslinien starten an j's Querlinie und laufen zu den Kindern.
      //    Falls eines von j's Kindern im horizontalen Bereich von i liegt,
      //    kreuzt diese Abgangslinie i's Querlinie:
      for (const cx of itemJ.childrenX) {
        if (cx > itemI.barMin + 3 && cx < itemI.barMax - 3) {
          iBelowJ++;
        }
      }

      // j auf niedrigerem Lane-Index als i (l_j < l_i):
      // j liegt näher an den Kindern, i weiter weg / näher am Elternteil.
      if (itemJ.parentX > itemI.barMin + 3 && itemJ.parentX < itemI.barMax - 3) {
        jBelowI++;
      }
      for (const cx of itemI.childrenX) {
        if (cx > itemJ.barMin + 3 && cx < itemJ.barMax - 3) {
          jBelowI++;
        }
      }

      pairCosts[i][j] = { iBelowJ, jBelowI, overlap };
    }
  }

  function evaluate(assignment: number[]): number {
    let cost = 0;
    for (let i = 0; i < n; i++) {
      cost += assignment[i] * 0.05;
      for (let j = i + 1; j < n; j++) {
        const pc = pairCosts[i][j];
        const lI = assignment[i];
        const lJ = assignment[j];
        if (lI === lJ) {
          if (pc.overlap) cost += 1000;
        } else if (lI < lJ) {
          cost += pc.iBelowJ;
          // Tie-Breaker: Wenn i das Intervall von j umschließt (i ist außen, j ist innen),
          // soll j bevorzugt auf niedrigerem Lane-Index (näher an Kindern) liegen.
          // Liegt i fälschlich auf niedrigerem Lane-Index als j (lI < lJ), kleiner Malus:
          if (items[i].barMin <= items[j].barMin + 4 && items[i].barMax >= items[j].barMax - 4) {
            cost += 0.2;
          }
        } else {
          cost += pc.jBelowI;
          // Tie-Breaker: Wenn j das Intervall von i umschließt (j ist außen, i ist innen),
          // soll i bevorzugt auf niedrigerem Lane-Index (näher an Kindern) liegen.
          // Liegt j fälschlich auf niedrigerem Lane-Index als i (lJ < lI), kleiner Malus:
          if (items[j].barMin <= items[i].barMin + 4 && items[j].barMax >= items[i].barMax - 4) {
            cost += 0.2;
          }
        }
      }
    }
    return cost;
  }

  // 1. Initial-Kandidaten
  const candidates: number[][] = [];
  candidates.push(groupRels.map((_, idx) => idx % maxLanes));

  // Strategie-Kandidat: Innere Einträge auf höherer Ebene (Lane 0, näher an Kindern),
  // äußere Einträge auf niedrigerer Ebene (höhere Lanes, näher am Elternteil)
  const innerRanked = items.map((it, idx) => {
    let enclosedByCount = 0;
    for (let other = 0; other < n; other++) {
      if (other === idx) continue;
      if (items[other].barMin <= it.barMin + 4 && items[other].barMax >= it.barMax - 4) {
        enclosedByCount++;
      }
    }
    const span = it.barMax - it.barMin;
    // Am stärksten umschlossene Einträge (innere) und bei Gleichstand kleinere Spannweiten zuerst
    const score = enclosedByCount * 10000 - span;
    return { idx, score };
  }).sort((a, b) => b.score - a.score);

  const innerOuterLanes = new Array(n).fill(0);
  const laneIntervals: { min: number; max: number }[][] = Array.from({ length: maxLanes }, () => []);

  for (const item of innerRanked) {
    const idx = item.idx;
    const it = items[idx];
    let bestL = 0;
    let bestIncr = Infinity;

    for (let l = 0; l < maxLanes; l++) {
      let curCost = 0;
      let hasOverlapOnSameLane = false;

      for (const existing of laneIntervals[l]) {
        if (Math.max(it.barMin, existing.min) <= Math.min(it.barMax, existing.max) - 4) {
          hasOverlapOnSameLane = true;
          break;
        }
      }

      if (hasOverlapOnSameLane) {
        curCost += 1000;
      }

      for (let other = 0; other < n; other++) {
        if (other === idx || innerOuterLanes[other] === undefined) continue;
        const pc = idx < other ? pairCosts[idx][other] : pairCosts[other][idx];
        const lA = idx < other ? l : innerOuterLanes[other];
        const lB = idx < other ? innerOuterLanes[other] : l;
        if (lA === lB) {
          if (pc.overlap) curCost += 1000;
        } else if (lA < lB) {
          curCost += pc.iBelowJ;
          const aIdx = idx < other ? idx : other;
          const bIdx = idx < other ? other : idx;
          if (items[aIdx].barMin <= items[bIdx].barMin + 4 && items[aIdx].barMax >= items[bIdx].barMax - 4) {
            curCost += 0.2;
          }
        } else {
          curCost += pc.jBelowI;
          const aIdx = idx < other ? idx : other;
          const bIdx = idx < other ? other : idx;
          if (items[bIdx].barMin <= items[aIdx].barMin + 4 && items[bIdx].barMax >= items[aIdx].barMax - 4) {
            curCost += 0.2;
          }
        }
      }

      curCost += l * 0.1;

      if (curCost < bestIncr) {
        bestIncr = curCost;
        bestL = l;
      }
    }

    innerOuterLanes[idx] = bestL;
    laneIntervals[bestL].push({ min: it.barMin, max: it.barMax });
  }
  candidates.push(innerOuterLanes);

  // Greedy nach Spannweiten-Breite (kleinste Spannen zuerst)
  const sortedByWidth = items.map((it, idx) => ({ idx, width: it.barMax - it.barMin }))
    .sort((a, b) => a.width - b.width)
    .map(x => x.idx);

  const greedyLanes = new Array(n).fill(0);
  for (const idx of sortedByWidth) {
    let bestL = 0;
    let bestIncr = Infinity;
    for (let l = 0; l < maxLanes; l++) {
      greedyLanes[idx] = l;
      let curCost = 0;
      for (let other = 0; other < n; other++) {
        if (other === idx) continue;
        const pc = idx < other ? pairCosts[idx][other] : pairCosts[other][idx];
        const lA = idx < other ? l : greedyLanes[other];
        const lB = idx < other ? greedyLanes[other] : l;
        if (lA === lB) {
          if (pc.overlap) curCost += 1000;
        } else if (lA < lB) {
          curCost += pc.iBelowJ;
          const aIdx = idx < other ? idx : other;
          const bIdx = idx < other ? other : idx;
          if (items[aIdx].barMin <= items[bIdx].barMin + 4 && items[aIdx].barMax >= items[bIdx].barMax - 4) {
            curCost += 0.2;
          }
        } else {
          curCost += pc.jBelowI;
          const aIdx = idx < other ? idx : other;
          const bIdx = idx < other ? other : idx;
          if (items[bIdx].barMin <= items[aIdx].barMin + 4 && items[bIdx].barMax >= items[aIdx].barMax - 4) {
            curCost += 0.2;
          }
        }
      }
      curCost += l * 0.1;
      if (curCost < bestIncr) {
        bestIncr = curCost;
        bestL = l;
      }
    }
    greedyLanes[idx] = bestL;
  }
  candidates.push(greedyLanes);

  // Intervall-Packen (nicht-überlappende Spannen teilen sich dieselbe Lane)
  const sortedByLeft = items.map((it, idx) => ({ idx, minX: it.barMin }))
    .sort((a, b) => a.minX - b.minX)
    .map(x => x.idx);
  const packedLanes = new Array(n).fill(0);
  const laneMaxX: number[] = new Array(maxLanes).fill(-Infinity);
  for (const idx of sortedByLeft) {
    let placed = false;
    for (let l = 0; l < maxLanes; l++) {
      if (items[idx].barMin >= laneMaxX[l] + 8) {
        packedLanes[idx] = l;
        laneMaxX[l] = items[idx].barMax;
        placed = true;
        break;
      }
    }
    if (!placed) {
      packedLanes[idx] = idx % maxLanes;
    }
  }
  candidates.push(packedLanes);

  let bestAssignment = candidates[0];
  let bestScore = evaluate(bestAssignment);

  for (let c = 1; c < candidates.length; c++) {
    const score = evaluate(candidates[c]);
    if (score < bestScore) {
      bestScore = score;
      bestAssignment = candidates[c];
    }
  }

  // 2. Lokale Suche / iterierte Verbesserung (Einzelverschiebungen & Vertauschungen)
  const currentAssignment = [...bestAssignment];
  let improved = true;
  let iterations = 0;

  while (improved && iterations < 8) {
    improved = false;
    iterations++;

    for (let i = 0; i < n; i++) {
      const origLane = currentAssignment[i];
      for (let l = 0; l < maxLanes; l++) {
        if (l === origLane) continue;
        currentAssignment[i] = l;
        const score = evaluate(currentAssignment);
        if (score < bestScore) {
          bestScore = score;
          improved = true;
        } else {
          currentAssignment[i] = origLane;
        }
      }
    }

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (currentAssignment[i] === currentAssignment[j]) continue;
        const tmp = currentAssignment[i];
        currentAssignment[i] = currentAssignment[j];
        currentAssignment[j] = tmp;
        const score = evaluate(currentAssignment);
        if (score < bestScore) {
          bestScore = score;
          improved = true;
        } else {
          currentAssignment[j] = currentAssignment[i];
          currentAssignment[i] = tmp;
        }
      }
    }
  }

  return currentAssignment;
}

const edgeGeometry = computed(() => {
  const rawSegments: LineSegment[] = [];
  const arrows: ArrowHead[] = [];

  // 1. Alle sichtbaren Eltern-Kind-Verbindungen sammeln (biologische Abstammung)
  // Jedes Kind wird exakt mit seinem Elternteil verbunden, unabhängig davon, wie Karten visuell gruppiert sind
  const parentIdByChildId = new Map<string, string>();
  childrenMapByParentId.value.forEach((kids, pId) => {
    kids.forEach(kId => {
      parentIdByChildId.set(kId, pId);
    });
  });

  // Kinder nach (parentId, childLevel) gruppieren, um Geschwister auf derselben Ebene sauber anzuordnen
  const childrenByParentAndLevel = new Map<string, Map<number, CardBox[]>>();

  cardBoxByPersonId.value.forEach(cb => {
    let pId = parentIdByChildId.get(cb.person.id);
    if (!pId && cb.person.parent_ids) {
      pId = cb.person.parent_ids.find(id => cardBoxByPersonId.value.has(id));
    }
    if (!pId) return;
    const pBox = cardBoxByPersonId.value.get(pId);
    if (!pBox) return;

    if (!childrenByParentAndLevel.has(pId)) {
      childrenByParentAndLevel.set(pId, new Map());
    }
    const lvlMap = childrenByParentAndLevel.get(pId)!;
    if (!lvlMap.has(cb.level)) {
      lvlMap.set(cb.level, []);
    }
    lvlMap.get(cb.level)!.push(cb);
  });

  // 2. Geschwister-Gruppen je Ziel-Ebene sammeln, damit Querlinien verschiedener Geschwistergruppen
  // sichtbar gestaffelt in unterschiedlichen Höhen (Lanes) verlaufen.
  // Nur für Kinder derselben Geschwistergruppe liegen die Querlinien auf exakt gleicher Höhe.
  const relationsByLevel = new Map<number, SiblingGroupRelation[]>();

  childrenByParentAndLevel.forEach((levelMap, parentId) => {
    const pBox = cardBoxByPersonId.value.get(parentId);
    if (!pBox) return;

    levelMap.forEach((cBoxes, childLevel) => {
      cBoxes.sort((a, b) => a.centerX - b.centerX);
      const minChildX = Math.min(...cBoxes.map(c => c.centerX));
      const maxChildX = Math.max(...cBoxes.map(c => c.centerX));

      if (!relationsByLevel.has(childLevel)) {
        relationsByLevel.set(childLevel, []);
      }
      relationsByLevel.get(childLevel)!.push({
        parentId,
        childLevel,
        pBox,
        cBoxes,
        minChildX,
        maxChildX,
      });
    });
  });

  // Konfigurierbarer Mindestabstand für Querlinien
  const gap = Math.max(10, props.horizontalLaneGap || 16);
  const bridgeRadius = Math.max(4, Math.min(20, props.bridgeRadius || 8));
  const enableBridges = props.enableLineBridges !== false;

  // 3. Für jede Ebene die Geschwistergruppen einordnen und Linienbrücken durch optimierte Ebenen-Zuweisung minimieren
  relationsByLevel.forEach((relations, childLevel) => {
    relations.sort((a, b) => {
      const aCenter = (a.minChildX + a.maxChildX) / 2;
      const bCenter = (b.minChildX + b.maxChildX) / 2;
      return aCenter - bCenter;
    });

    // Partitionieren nach Richtung relativ zum Elternknoten
    const upRelations = relations.filter(r => childLevel > r.pBox.level);
    const sameRelations = relations.filter(r => childLevel === r.pBox.level);
    const downRelations = relations.filter(r => childLevel < r.pBox.level);

    // 3a. Verbindungen nach oben (Kinderebene liegt über Elternteil)
    if (upRelations.length > 0) {
      const minTopDist = Math.min(...upRelations.map(r => r.pBox.top - r.cBoxes[0].bottom));
      const corridorHeight = Math.max(36, minTopDist);
      const maxLanes = props.autoSubLanes !== false
        ? Math.max(1, Math.min(24, Math.floor((corridorHeight - 20) / gap)))
        : 6;

      const upLanes = (props.minimizeBridges !== false)
        ? optimizeSiblingGroupLanes(upRelations, maxLanes, 'up')
        : upRelations.map((_, idx) => idx % maxLanes);

      upRelations.forEach((rel, idx) => {
        const { parentId, pBox, cBoxes, minChildX, maxChildX } = rel;
        const startX = pBox.centerX;
        const commonEdgeKey = `edge-${parentId}-lvl${childLevel}`;
        const activeSel = activeDesignPersonId.value || props.selectedId;
        const isCommonHighlighted =
          Boolean(activeSel && (activeSel === parentId || cBoxes.some(c => c.person.id === activeSel))) ||
          Boolean(
            props.highlightedPathIds && props.highlightedPathIds.size > 0 &&
            props.highlightedPathIds.has(parentId) &&
            cBoxes.some(c => props.highlightedPathIds?.has(c.person.id))
          );

        const barMinX = Math.min(startX, minChildX);
        const barMaxX = Math.max(startX, maxChildX);
        const laneOffset = upLanes[idx] * gap;
        const startY = pBox.top;
        const jogY = cBoxes[0].bottom + 16 + laneOffset;

        // Stamm vom Elternteil
        rawSegments.push({
          id: `${commonEdgeKey}-stem`,
          edgeKey: commonEdgeKey,
          x1: startX,
          y1: startY,
          x2: startX,
          y2: jogY,
          isHighlighted: isCommonHighlighted,
        });

        // Horizontale Querlinie
        if (barMaxX - barMinX > 1) {
          rawSegments.push({
            id: `${commonEdgeKey}-bar`,
            edgeKey: commonEdgeKey,
            x1: barMinX,
            y1: jogY,
            x2: barMaxX,
            y2: jogY,
            isHighlighted: isCommonHighlighted,
          });
        }

        // Abgänge zu den Kindern
        cBoxes.forEach((cb, cIdx) => {
          const isChildHighlighted =
            Boolean(activeSel && (activeSel === parentId || activeSel === cb.person.id)) ||
            Boolean(
              props.highlightedPathIds && props.highlightedPathIds.size > 0 &&
              props.highlightedPathIds.has(parentId) &&
              props.highlightedPathIds.has(cb.person.id)
            );

          rawSegments.push({
            id: `${commonEdgeKey}-c${cIdx}`,
            edgeKey: commonEdgeKey,
            x1: cb.centerX,
            y1: jogY,
            x2: cb.centerX,
            y2: cb.bottom,
            isHighlighted: isChildHighlighted,
          });

          arrows.push({
            x: cb.centerX,
            y: cb.bottom,
            direction: 'up',
            isHighlighted: isChildHighlighted,
          });
        });
      });
    }

    // 3b. Verbindungen auf derselben Ebene
    if (sameRelations.length > 0) {
      const maxLanesSame = 8;
      const sameLanes = (props.minimizeBridges !== false)
        ? optimizeSiblingGroupLanes(sameRelations, maxLanesSame, 'same')
        : sameRelations.map((_, idx) => idx % maxLanesSame);

      sameRelations.forEach((rel, idx) => {
        const { parentId, pBox, cBoxes, minChildX, maxChildX } = rel;
        const startX = pBox.centerX;
        const commonEdgeKey = `edge-${parentId}-lvl${childLevel}`;
        const activeSel = activeDesignPersonId.value || props.selectedId;
        const isCommonHighlighted =
          Boolean(activeSel && (activeSel === parentId || cBoxes.some(c => c.person.id === activeSel))) ||
          Boolean(
            props.highlightedPathIds && props.highlightedPathIds.size > 0 &&
            props.highlightedPathIds.has(parentId) &&
            cBoxes.some(c => props.highlightedPathIds?.has(c.person.id))
          );

        const barMinX = Math.min(startX, minChildX);
        const barMaxX = Math.max(startX, maxChildX);
        const laneOffset = sameLanes[idx] * gap;
        const startY = pBox.bottom;
        const jogY = pBox.bottom + 18 + laneOffset;

        rawSegments.push({
          id: `${commonEdgeKey}-same-stem`,
          edgeKey: commonEdgeKey,
          x1: startX,
          y1: startY,
          x2: startX,
          y2: jogY,
          isHighlighted: isCommonHighlighted,
        });

        if (barMaxX - barMinX > 1) {
          rawSegments.push({
            id: `${commonEdgeKey}-same-bar`,
            edgeKey: commonEdgeKey,
            x1: barMinX,
            y1: jogY,
            x2: barMaxX,
            y2: jogY,
            isHighlighted: isCommonHighlighted,
          });
        }

        cBoxes.forEach((cb, cIdx) => {
          const isChildHighlighted =
            Boolean(activeSel && (activeSel === parentId || activeSel === cb.person.id)) ||
            Boolean(
              props.highlightedPathIds && props.highlightedPathIds.size > 0 &&
              props.highlightedPathIds.has(parentId) &&
              props.highlightedPathIds.has(cb.person.id)
            );

          rawSegments.push({
            id: `${commonEdgeKey}-same-c${cIdx}`,
            edgeKey: commonEdgeKey,
            x1: cb.centerX,
            y1: jogY,
            x2: cb.centerX,
            y2: cb.bottom,
            isHighlighted: isChildHighlighted,
          });

          arrows.push({
            x: cb.centerX,
            y: cb.bottom,
            direction: 'up',
            isHighlighted: isChildHighlighted,
          });
        });
      });
    }

    // 3c. Verbindungen nach unten (Kinderebene liegt unter Elternteil)
    if (downRelations.length > 0) {
      const minBottomDist = Math.min(...downRelations.map(r => r.cBoxes[0].top - r.pBox.bottom));
      const corridorHeightDown = Math.max(36, minBottomDist);
      const maxLanesDown = props.autoSubLanes !== false
        ? Math.max(1, Math.min(24, Math.floor((corridorHeightDown - 20) / gap)))
        : 6;

      const downLanes = (props.minimizeBridges !== false)
        ? optimizeSiblingGroupLanes(downRelations, maxLanesDown, 'down')
        : downRelations.map((_, idx) => idx % maxLanesDown);

      downRelations.forEach((rel, idx) => {
        const { parentId, pBox, cBoxes, minChildX, maxChildX } = rel;
        const startX = pBox.centerX;
        const commonEdgeKey = `edge-${parentId}-lvl${childLevel}`;
        const activeSel = activeDesignPersonId.value || props.selectedId;
        const isCommonHighlighted =
          Boolean(activeSel && (activeSel === parentId || cBoxes.some(c => c.person.id === activeSel))) ||
          Boolean(
            props.highlightedPathIds && props.highlightedPathIds.size > 0 &&
            props.highlightedPathIds.has(parentId) &&
            cBoxes.some(c => props.highlightedPathIds?.has(c.person.id))
          );

        const barMinX = Math.min(startX, minChildX);
        const barMaxX = Math.max(startX, maxChildX);
        const laneOffset = downLanes[idx] * gap;
        const startY = pBox.bottom;
        const jogY = cBoxes[0].top - 16 - laneOffset;

        rawSegments.push({
          id: `${commonEdgeKey}-down-stem`,
          edgeKey: commonEdgeKey,
          x1: startX,
          y1: startY,
          x2: startX,
          y2: jogY,
          isHighlighted: isCommonHighlighted,
        });

        if (barMaxX - barMinX > 1) {
          rawSegments.push({
            id: `${commonEdgeKey}-down-bar`,
            edgeKey: commonEdgeKey,
            x1: barMinX,
            y1: jogY,
            x2: barMaxX,
            y2: jogY,
            isHighlighted: isCommonHighlighted,
          });
        }

        cBoxes.forEach((cb, cIdx) => {
          const isChildHighlighted =
            Boolean(activeSel && (activeSel === parentId || activeSel === cb.person.id)) ||
            Boolean(
              props.highlightedPathIds && props.highlightedPathIds.size > 0 &&
              props.highlightedPathIds.has(parentId) &&
              props.highlightedPathIds.has(cb.person.id)
            );

          rawSegments.push({
            id: `${commonEdgeKey}-down-c${cIdx}`,
            edgeKey: commonEdgeKey,
            x1: cb.centerX,
            y1: jogY,
            x2: cb.centerX,
            y2: cb.top,
            isHighlighted: isChildHighlighted,
          });

          arrows.push({
            x: cb.centerX,
            y: cb.top,
            direction: 'down',
            isHighlighted: isChildHighlighted,
          });
        });
      });
    }
  });

  // 4. Schnittpunkte zwischen Kanten-Segmenten berechnen und Linienbrücken (Line Bridges) erzeugen
  const bridgesBySegIdx = new Map<number, number[]>();
  let totalBridgesCount = 0;

  if (enableBridges) {
    for (let i = 0; i < rawSegments.length; i++) {
      const s1 = rawSegments[i];
      const dx1 = s1.x2 - s1.x1;
      const dy1 = s1.y2 - s1.y1;
      const len1 = Math.hypot(dx1, dy1);
      if (len1 < bridgeRadius * 2 + 4) continue;

      for (let j = i + 1; j < rawSegments.length; j++) {
        const s2 = rawSegments[j];
        if (s1.edgeKey === s2.edgeKey) continue;

        const dx2 = s2.x2 - s2.x1;
        const dy2 = s2.y2 - s2.y1;
        const len2 = Math.hypot(dx2, dy2);
        if (len2 < bridgeRadius * 2 + 4) continue;

        const cross = dx1 * dy2 - dy1 * dx2;
        if (Math.abs(cross) < 1e-4) continue;

        const rx = s2.x1 - s1.x1;
        const ry = s2.y1 - s1.y1;
        const t = (rx * dy2 - ry * dx2) / cross;
        const u = (rx * dy1 - ry * dx1) / cross;

        if (t <= 0 || t >= 1 || u <= 0 || u >= 1) continue;

        const dist1 = t * len1;
        const dist2 = u * len2;

        const margin = 4;
        if (
          dist1 <= margin ||
          len1 - dist1 <= margin ||
          dist2 <= margin ||
          len2 - dist2 <= margin
        ) {
          continue;
        }

        const horiz1 = Math.abs(dx1) / len1;
        const horiz2 = Math.abs(dx2) / len2;

        const targetIdx = horiz1 >= horiz2 ? i : j;
        const targetDist = horiz1 >= horiz2 ? dist1 : dist2;

        if (!bridgesBySegIdx.has(targetIdx)) {
          bridgesBySegIdx.set(targetIdx, []);
        }
        bridgesBySegIdx.get(targetIdx)!.push(targetDist);
        totalBridgesCount++;
      }
    }
  }

  const normalPaths: string[] = [];
  const highlightedPaths: string[] = [];

  rawSegments.forEach((seg, idx) => {
    const dx = seg.x2 - seg.x1;
    const dy = seg.y2 - seg.y1;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) return;

    const ux = dx / len;
    const uy = dy / len;
    const dists = bridgesBySegIdx.get(idx);

    let dStr = '';
    if (!enableBridges || !dists || dists.length === 0) {
      dStr = `M ${seg.x1} ${seg.y1} L ${seg.x2} ${seg.y2}`;
    } else {
      dists.sort((a, b) => a - b);
      const intervals: { start: number; end: number }[] = [];
      dists.forEach(d => {
        const s = Math.max(2, d - bridgeRadius);
        const e = Math.min(len - 2, d + bridgeRadius);
        if (e <= s) return;
        if (intervals.length > 0 && s <= intervals[intervals.length - 1].end + 3) {
          intervals[intervals.length - 1].end = Math.max(intervals[intervals.length - 1].end, e);
        } else {
          intervals.push({ start: s, end: e });
        }
      });

      const sweepFlag = ux >= 0 ? 1 : 0;
      const parts = [`M ${seg.x1} ${seg.y1}`];
      intervals.forEach(iv => {
        const sx = +(seg.x1 + ux * iv.start).toFixed(1);
        const sy = +(seg.y1 + uy * iv.start).toFixed(1);
        const ex = +(seg.x1 + ux * iv.end).toFixed(1);
        const ey = +(seg.y1 + uy * iv.end).toFixed(1);
        const r = +((iv.end - iv.start) / 2).toFixed(1);
        parts.push(`L ${sx} ${sy}`);
        parts.push(`A ${r} ${r} 0 0 ${sweepFlag} ${ex} ${ey}`);
      });
      parts.push(`L ${seg.x2} ${seg.y2}`);
      dStr = parts.join(' ');
    }

    if (seg.isHighlighted) {
      highlightedPaths.push(dStr);
    } else {
      normalPaths.push(dStr);
    }
  });

  return {
    normalPaths,
    highlightedPaths,
    arrows,
    totalBridgesCount,
  };
});

// Ermittelt alle aneinander gedockten Einträge oder Eintragsgruppen (Rahmenkontakt <= 2px auf derselben Ebene)
function getDockedCluster(startGroup: DesignSiblingGroup): DesignSiblingGroup[] {
  const cluster: DesignSiblingGroup[] = [];
  const visited = new Set<string>();
  const queue: DesignSiblingGroup[] = [startGroup];
  visited.add(startGroup.id);

  const sameLevelGroups = visibleSiblingGroups.value.filter(g => g.level === startGroup.level);

  while (queue.length > 0) {
    const current = queue.shift()!;
    cluster.push(current);

    const cW = getGroupWidth(current.memberIds.length);
    const cLeft = Math.round(current.x - cW / 2);
    const cRight = cLeft + cW;

    for (const other of sameLevelGroups) {
      if (visited.has(other.id)) continue;
      const oW = getGroupWidth(other.memberIds.length);
      const oLeft = Math.round(other.x - oW / 2);
      const oRight = oLeft + oW;

      // Berührung auf <= 2px Abstand auf derselben Ebene
      const isTouching = Math.abs(cRight - oLeft) <= 2 || Math.abs(cLeft - oRight) <= 2;
      if (isTouching) {
        visited.add(other.id);
        queue.push(other);
      }
    }
  }

  return cluster;
}

// Drag & Drop für Geschwistergruppen & Einzeleinträge (inkl. gemeinsamem Verschieben aneinander gedockter Gruppen)
function startGroupDrag(e: MouseEvent, group: DesignSiblingGroup) {
  if (e.button !== 0) return;
  e.stopPropagation();
  preDragSnapshot = captureCurrentSnapshot();
  draggingGroupId.value = group.id;
  didMoveGroup = false;
  groupDragStartMouse = { x: e.clientX, y: e.clientY };
  groupDragStartPos = { x: group.x, level: group.level };
  dragHoverInsertAboveLevel.value = null;
  activeSnapGuideX.value = null;

  // Aneinander gedockte Einträge oder Eintragsgruppen gemeinsam ermitteln
  const cluster = getDockedCluster(group);
  draggingCluster.value = cluster.map(g => ({
    group: g,
    startX: g.x,
    startLevel: g.level,
    width: getGroupWidth(g.memberIds.length),
  }));

  window.addEventListener('mousemove', onWindowGroupDragMove);
  window.addEventListener('mouseup', onWindowGroupDragEnd);
}

function onWindowGroupDragMove(e: MouseEvent) {
  if (!draggingGroupId.value || draggingCluster.value.length === 0) return;

  const dxScreen = e.clientX - groupDragStartMouse.x;
  const dyScreen = e.clientY - groupDragStartMouse.y;
  if (Math.hypot(dxScreen, dyScreen) > 4) {
    didMoveGroup = true;
  }

  const dxCanvas = dxScreen / zoom.value;
  const dyCanvas = dyScreen / zoom.value;

  // Bounding box des gesamten gedockten Clusters bei Drag-Start
  const clusterMinLeft = Math.min(...draggingCluster.value.map(m => m.startX - m.width / 2));
  const clusterMaxRight = Math.max(...draggingCluster.value.map(m => m.startX + m.width / 2));

  // Horizontale Verschiebung: mindestens 12px Abstand zur Ebenen-Seitenleiste
  const minAllowedLeft = LEVEL_SIDEBAR_W + 12;
  let candidateDx = Math.round(dxCanvas);
  if (clusterMinLeft + candidateDx < minAllowedLeft) {
    candidateDx = minAllowedLeft - clusterMinLeft;
  }

  // Falls Mitglieder des Clusters Nachfolgeeinträge mit aktiven Zweig-Breiten sind,
  // Grenzen für das Cluster berücksichtigen
  branchWidths.value.forEach(bw => {
    const descSet = getDescendantPersonIds(bw.personId);
    const constrainedMembers = draggingCluster.value.filter(m => {
      const g = m.group;
      return (
        (g.parentId && (g.parentId === bw.personId || descSet.has(g.parentId))) ||
        g.memberIds.some(id => descSet.has(id))
      );
    });

    if (constrainedMembers.length > 0) {
      const subMinLeft = Math.min(...constrainedMembers.map(m => m.startX - m.width / 2));
      const subMaxRight = Math.max(...constrainedMembers.map(m => m.startX + m.width / 2));
      const subW = subMaxRight - subMinLeft;
      const spanW = bw.maxX - bw.minX;

      if (subW >= spanW) {
        const centerOffset = Math.round((bw.minX + bw.maxX) / 2) - Math.round((subMinLeft + subMaxRight) / 2);
        candidateDx = centerOffset;
      } else {
        const minAllowedDx = bw.minX - subMinLeft;
        const maxAllowedDx = bw.maxX - subMaxRight;
        candidateDx = Math.max(minAllowedDx, Math.min(maxAllowedDx, candidateDx));
      }
    }
  });

  // Ziel-Ebene aus der vertikalen Position berechnen
  const startCenterY = getGroupTopY(groupDragStartPos.level) + CARD_HEIGHT / 2;
  const currentCenterY = startCenterY + dyCanvas;
  const { level: targetLevel, insertAboveLevel } = getLevelAtCanvasY(currentCenterY);

  if (insertAboveLevel !== null) {
    dragHoverInsertAboveLevel.value = insertAboveLevel;
  } else {
    dragHoverInsertAboveLevel.value = null;
    draggingCluster.value.forEach(m => {
      m.group.level = targetLevel;
    });
  }

  // Überlappungen auf targetLevel vermeiden und stattdessen direkt an Nachbarn andocken
  const clusterWidth = clusterMaxRight - clusterMinLeft;
  let candidateLeft = clusterMinLeft + candidateDx;
  let candidateRight = candidateLeft + clusterWidth;
  let snapEdgeX: number | null = null;

  const clusterIds = draggingClusterGroupIds.value;
  const othersOnLevel = visibleSiblingGroups.value
    .filter(o => !clusterIds.has(o.id) && o.level === targetLevel)
    .map(o => {
      const oW = getGroupWidth(o.memberIds.length);
      const oLeft = Math.round(o.x - oW / 2);
      return { id: o.id, left: oLeft, right: oLeft + oW, width: oW, centerX: o.x };
    })
    .sort((a, b) => a.left - b.left);

  // 1. Überlappungsprüfung: Objekte dürfen nicht überlappen, sondern docken stattdessen an
  for (const other of othersOnLevel) {
    if (candidateLeft < other.right && candidateRight > other.left) {
      const candCenter = candidateLeft + clusterWidth / 2;
      if (candCenter >= other.centerX) {
        candidateLeft = other.right;
        candidateRight = candidateLeft + clusterWidth;
        snapEdgeX = other.right;
      } else {
        candidateRight = other.left;
        candidateLeft = candidateRight - clusterWidth;
        snapEdgeX = other.left;
      }
    }
  }

  // Zweite Prüfung zur Vermeidung von Kaskaden-Überlappungen
  for (const other of othersOnLevel) {
    if (candidateLeft < other.right && candidateRight > other.left) {
      const candCenter = candidateLeft + clusterWidth / 2;
      if (candCenter >= other.centerX) {
        candidateLeft = other.right;
        candidateRight = candidateLeft + clusterWidth;
        snapEdgeX = other.right;
      } else {
        candidateRight = other.left;
        candidateLeft = candidateRight - clusterWidth;
        snapEdgeX = other.left;
      }
    }
  }

  // 2. Magnetischer Kontakt (Snap) falls nahe an einer Kante (innerhalb SNAP_DISTANCE)
  let bestSnapDist = SNAP_DISTANCE;
  for (const other of othersOnLevel) {
    const distLeftToRight = Math.abs(candidateLeft - other.right);
    if (distLeftToRight < bestSnapDist) {
      bestSnapDist = distLeftToRight;
      candidateLeft = other.right;
      candidateRight = candidateLeft + clusterWidth;
      snapEdgeX = other.right;
    }

    const distRightToLeft = Math.abs(candidateRight - other.left);
    if (distRightToLeft < bestSnapDist) {
      bestSnapDist = distRightToLeft;
      candidateRight = other.left;
      candidateLeft = candidateRight - clusterWidth;
      snapEdgeX = other.left;
    }
  }

  if (candidateLeft < minAllowedLeft) {
    candidateLeft = minAllowedLeft;
  }

  const effectiveDx = candidateLeft - clusterMinLeft;
  activeSnapGuideX.value = snapEdgeX;

  // Alle aneinander gedockten Gruppen gemeinsam verschieben (Kantenkontakt bleibt exakt erhalten)
  draggingCluster.value.forEach(m => {
    m.group.x = Math.round(m.startX + effectiveDx);
  });
}

function onWindowGroupDragEnd() {
  if (didMoveGroup && preDragSnapshot) {
    pushHistorySnapshot(preDragSnapshot);
  }
  preDragSnapshot = null;

  if (draggingGroupId.value && dragHoverInsertAboveLevel.value !== null && draggingCluster.value.length > 0) {
    const insertAbove = dragHoverInsertAboveLevel.value;
    const newLevelNum = insertAbove + 1;
    const nextHeights: Record<number, number> = {};
    for (let l = 1; l <= totalLevels.value; l++) {
      if (l < newLevelNum) nextHeights[l] = getLevelHeight(l);
      else nextHeights[l + 1] = getLevelHeight(l);
    }
    nextHeights[newLevelNum] = DEFAULT_LEVEL_HEIGHT;

    const clusterIds = draggingClusterGroupIds.value;
    siblingGroups.value.forEach(g => {
      if (!clusterIds.has(g.id) && g.level >= newLevelNum) {
        g.level += 1;
      }
    });
    totalLevels.value += 1;
    levelHeights.value = nextHeights;
    draggingCluster.value.forEach(m => {
      m.group.level = newLevelNum;
    });
  }

  draggingGroupId.value = null;
  draggingCluster.value = [];
  dragHoverInsertAboveLevel.value = null;
  activeSnapGuideX.value = null;
  window.removeEventListener('mousemove', onWindowGroupDragMove);
  window.removeEventListener('mouseup', onWindowGroupDragEnd);
}

// Ebenen-Höhe per Ziehen am unteren Ebenenrand anpassen
function startLevelResize(e: MouseEvent, level: number) {
  if (e.button !== 0) return;
  e.stopPropagation();
  preResizeSnapshot = captureCurrentSnapshot();
  didResizeLevel = false;
  resizingLevel.value = level;
  resizeStartY = e.clientY;
  resizeStartHeight = getLevelHeight(level);
  window.addEventListener('mousemove', onWindowLevelResizeMove);
  window.addEventListener('mouseup', onWindowLevelResizeEnd);
}

function onWindowLevelResizeMove(e: MouseEvent) {
  if (resizingLevel.value === null) return;
  const dy = (e.clientY - resizeStartY) / zoom.value;
  if (Math.abs(dy) > 2) didResizeLevel = true;
  setLevelHeight(resizingLevel.value, resizeStartHeight + dy);
}

function onWindowLevelResizeEnd() {
  if (didResizeLevel && preResizeSnapshot) {
    pushHistorySnapshot(preResizeSnapshot);
  }
  preResizeSnapshot = null;
  didResizeLevel = false;
  resizingLevel.value = null;
  window.removeEventListener('mousemove', onWindowLevelResizeMove);
  window.removeEventListener('mouseup', onWindowLevelResizeEnd);
}

// Geschwistergruppe / Gruppenverband auflösen (nach links oder nach rechts auflösen)
// 1. Wird eine Gruppierung nach links oder rechts aufgelöst, so wird nur die Gruppierung des gewählten Eintrages
//    zu seinem Nachbarn in der gewählten Richtung aufgelöst.
// 2. Ist der Eintrag Teil einer Geschwistergruppe, wird der am weitesten auf der gewählten Richtung liegende
//    Geschwistereintrag vom anliegenden Nicht-Geschwistereintrag getrennt.
function ungroupAtPerson(group: DesignSiblingGroup, targetPersonId?: string, direction: 'left' | 'right' = 'right') {
  if (group.memberIds.length <= 1) return;
  pushHistoryState();
  const members = [...group.memberIds];
  const count = members.length;

  // Wenn keine targetPersonId übergeben wurde, versuchen wir den selektierten Eintrag der Gruppe zu finden
  let effectivePersonId = targetPersonId;
  if (!effectivePersonId) {
    const selId = activeDesignPersonId.value || props.selectedId;
    if (selId && members.includes(selId)) {
      effectivePersonId = selId;
    } else {
      effectivePersonId = direction === 'left' ? members[members.length - 1] : members[0];
    }
  }

  const pIdx = members.indexOf(effectivePersonId);
  if (pIdx === -1) return;

  // Biologischen Elternteil ermitteln
  const pParentId = getBiologicalParentId(effectivePersonId);

  // Zusammenhängende Geschwistergruppe um pIdx ermitteln
  let sibStart = pIdx;
  let sibEnd = pIdx;
  if (pParentId !== null) {
    while (sibStart > 0 && getBiologicalParentId(members[sibStart - 1]) === pParentId) {
      sibStart--;
    }
    while (sibEnd < count - 1 && getBiologicalParentId(members[sibEnd + 1]) === pParentId) {
      sibEnd++;
    }
  }
  const isPartOfSiblingGroup = pParentId !== null && (sibEnd > sibStart);

  // Schnittposition 'cutIndex' (Index des ersten Elements der rechten Gruppe, 1 <= cutIndex < count)
  let cutIndex = -1;

  if (direction === 'left') {
    // Wird eine Gruppierung nach links aufgelöst:
    // Ist der Eintrag Teil einer Geschwistergruppe, wird der am weitesten auf der gewählten Richtung liegende
    // Geschwistereintrag vom anliegenden Nicht-Geschwistereintrag getrennt.
    if (isPartOfSiblingGroup && sibStart > 0) {
      cutIndex = sibStart;
    } else {
      // Ansonsten wird nur die Gruppierung des gewählten Eintrages zu seinem Nachbarn in der gewählten Richtung aufgelöst
      cutIndex = pIdx > 0 ? pIdx : 1;
    }
  } else {
    // Wird eine Gruppierung nach rechts aufgelöst:
    // Ist der Eintrag Teil einer Geschwistergruppe, wird der am weitesten auf der gewählten Richtung liegende
    // Geschwistereintrag vom anliegenden Nicht-Geschwistereintrag getrennt.
    if (isPartOfSiblingGroup && sibEnd < count - 1) {
      cutIndex = sibEnd + 1;
    } else {
      // Ansonsten wird nur die Gruppierung des gewählten Eintrages zu seinem Nachbarn in der gewählten Richtung aufgelöst
      cutIndex = pIdx < count - 1 ? pIdx + 1 : count - 1;
    }
  }

  // Sicherheitsprüfung: cutIndex muss zwischen 1 und count - 1 liegen
  cutIndex = Math.max(1, Math.min(count - 1, cutIndex));

  const leftMembers = members.slice(0, cutIndex);
  const rightMembers = members.slice(cutIndex);

  const origTotalW = getGroupWidth(count);
  const origLeft = Math.round(group.x - origTotalW / 2);
  const origRight = origLeft + origTotalW;

  const leftW = getGroupWidth(leftMembers.length);
  const rightW = getGroupWidth(rightMembers.length);
  const GAP = 24;

  let leftCenterX = 0;
  let rightCenterX = 0;

  if (direction === 'left') {
    // Nach links auflösen: der rechte Teil bleibt an seiner rechten Kante stehen,
    // der linke Teil wird nach links gerückt (mit GAP Abstand)
    rightCenterX = Math.round(origRight - rightW / 2);
    leftCenterX = Math.round(origRight - rightW - GAP - leftW / 2);
  } else {
    // Nach rechts auflösen: der linke Teil bleibt an seiner linken Kante stehen,
    // der rechte Teil wird nach rechts gerückt (mit GAP Abstand)
    leftCenterX = Math.round(origLeft + leftW / 2);
    rightCenterX = Math.round(origLeft + leftW + GAP + rightW / 2);
  }

  // Sicherstellen, dass die linke Gruppe nicht hinter die Seitenleiste rutscht
  const minAllowedLeft = LEVEL_SIDEBAR_W + 16;
  const curMinX = Math.round(leftCenterX - leftW / 2);
  if (curMinX < minAllowedLeft) {
    const shift = minAllowedLeft - curMinX;
    leftCenterX += shift;
    rightCenterX += shift;
  }

  const leftGen = personById.value.get(leftMembers[0])?.proband_data[props.activeProbandId || '']?.generation || group.generation;
  const rightGen = personById.value.get(rightMembers[0])?.proband_data[props.activeProbandId || '']?.generation || group.generation;

  const leftGroup: DesignSiblingGroup = {
    id: `sg-${Date.now()}-L`,
    parentId: getBiologicalParentId(leftMembers[0]) ?? group.parentId,
    generation: leftGen,
    level: group.level,
    x: leftCenterX,
    memberIds: leftMembers,
    isUngrouped: leftMembers.length === 1,
  };

  const rightGroup: DesignSiblingGroup = {
    id: `sg-${Date.now()}-R`,
    parentId: getBiologicalParentId(rightMembers[0]) ?? group.parentId,
    generation: rightGen,
    level: group.level,
    x: rightCenterX,
    memberIds: rightMembers,
    isUngrouped: rightMembers.length === 1,
  };

  const grpIdx = siblingGroups.value.findIndex(g => g.id === group.id);
  if (grpIdx >= 0) {
    const next = [...siblingGroups.value];
    next.splice(grpIdx, 1, leftGroup, rightGroup);
    siblingGroups.value = next;
  }
}

function getSelectedOrAnchorPersonId(gl: GroupLayoutInfo): string {
  const selId = activeDesignPersonId.value || props.selectedId;
  const match = gl.cards.find(c => c.person.id === selId);
  return match ? match.person.id : gl.cards[0].person.id;
}

function regroupSelectedOrFirstInGroup(gl: GroupLayoutInfo) {
  const selId = activeDesignPersonId.value || props.selectedId;
  if (selId && gl.group.memberIds.includes(selId) && canRegroupPerson(selId)) {
    regroupSiblingsForPerson(selId);
    return;
  }
  const match = gl.cards.find(c => canRegroupPerson(c.person.id));
  if (match) {
    regroupSiblingsForPerson(match.person.id);
  } else if (gl.cards.length > 0) {
    regroupSiblingsForPerson(gl.cards[0].person.id);
  }
}

// Alle Einträge einer Zeile (Ebene) gruppieren.
// 1. Ohne Zweigabgrenzungen: Gruppe wird mittig zentriert.
// 2. Mit Zweigabgrenzungen:
//    - Gruppen innerhalb der Zweigbreite werden zentriert.
//    - Gruppierungen zwischen Bereichen werden ebenfalls zentriert.
//    - Gruppierungen außerhalb werden an den reservierten Bereich herangerückt.
function groupAllInLevel(level: number) {
  const groupsOnLevel = siblingGroups.value.filter(g => g.level === level);
  if (groupsOnLevel.length <= 1) return;
  pushHistoryState();

  // Stammahn (Ursprung) X-Position als vertikale Mittelachse des Stammbaums
  const rootGroup = siblingGroups.value.find(g => g.parentId === null);
  const treeCenterX = rootGroup ? rootGroup.x : 720;

  // Relevante Zweig-Abgrenzungen ermitteln (Ebene des Eintrags oder darüber)
  const activeBwsOnLevel: { personId: string; minX: number; maxX: number }[] = [];
  branchWidths.value.forEach(bw => {
    const rawPos = getRawPersonPosition(bw.personId);
    if (rawPos && level >= rawPos.level) {
      activeBwsOnLevel.push({ personId: bw.personId, minX: bw.minX, maxX: bw.maxX });
    }
  });

  // Fall 1: Keine reservierten Zweigbreiten -> Alle Einträge gruppieren und mittig zentrieren
  if (activeBwsOnLevel.length === 0) {
    groupsOnLevel.sort((a, b) => a.x - b.x);
    const mergedMemberIds: string[] = [];
    groupsOnLevel.forEach(g => {
      g.memberIds.forEach(id => {
        if (!mergedMemberIds.includes(id)) mergedMemberIds.push(id);
      });
    });

    const totalW = getGroupWidth(mergedMemberIds.length);
    const minAllowedX = LEVEL_SIDEBAR_W + 16 + Math.round(totalW / 2);
    // Mittig auf der Mittelachse des Stammbaums zentrieren
    const targetX = Math.max(minAllowedX, treeCenterX);

    const anchor = groupsOnLevel[0];
    const mergedGroup: DesignSiblingGroup = {
      id: `sg-row-${level}-${Date.now()}`,
      parentId: anchor.parentId,
      generation: anchor.generation,
      level,
      x: targetX,
      memberIds: mergedMemberIds,
      isUngrouped: false,
    };
    siblingGroups.value = siblingGroups.value.filter(g => g.level !== level).concat(mergedGroup);
    return;
  }

  // Fall 2: Reservierte Zweigbreiten vorhanden
  activeBwsOnLevel.sort((a, b) => a.minX - b.minX);

  type ZoneType = 'outside-left' | 'inside' | 'between' | 'outside-right';

  interface BoundaryZone {
    id: string;
    type: ZoneType;
    minX: number;
    maxX: number;
    bwRef?: { minX: number; maxX: number };
    prevBwRef?: { minX: number; maxX: number };
    nextBwRef?: { minX: number; maxX: number };
    groups: DesignSiblingGroup[];
  }

  const zones: BoundaryZone[] = [];
  const firstBw = activeBwsOnLevel[0];
  const lastBw = activeBwsOnLevel[activeBwsOnLevel.length - 1];

  // 1. Bereich außerhalb links vor der ersten Zweigbreite
  zones.push({
    id: 'outside-left',
    type: 'outside-left',
    minX: -Infinity,
    maxX: firstBw.minX,
    bwRef: firstBw,
    groups: [],
  });

  // 2. Bereiche innerhalb der Zweigbreiten und zwischen ihnen
  activeBwsOnLevel.forEach((bw, idx) => {
    // Innerhalb dieser Zweigbreite
    zones.push({
      id: `inside-${bw.personId}`,
      type: 'inside',
      minX: bw.minX,
      maxX: bw.maxX,
      bwRef: bw,
      groups: [],
    });

    // Zwischen dieser und der nächsten Zweigbreite
    if (idx < activeBwsOnLevel.length - 1) {
      const nextBw = activeBwsOnLevel[idx + 1];
      if (nextBw.minX > bw.maxX) {
        zones.push({
          id: `between-${idx}-${idx + 1}`,
          type: 'between',
          minX: bw.maxX,
          maxX: nextBw.minX,
          prevBwRef: bw,
          nextBwRef: nextBw,
          groups: [],
        });
      }
    }
  });

  // 3. Bereich außerhalb rechts nach der letzten Zweigbreite
  zones.push({
    id: 'outside-right',
    type: 'outside-right',
    minX: lastBw.maxX,
    maxX: Infinity,
    bwRef: lastBw,
    groups: [],
  });

  // Jede Gruppe auf dieser Ebene der passenden Zone zuordnen
  groupsOnLevel.forEach(g => {
    let assigned = false;
    for (const z of zones) {
      if (g.x >= z.minX && g.x <= z.maxX) {
        z.groups.push(g);
        assigned = true;
        break;
      }
    }
    if (!assigned) {
      let bestZ = zones[0];
      let bestDist = Infinity;
      zones.forEach(z => {
        let center = 0;
        if (z.type === 'inside' && z.bwRef) {
          center = (z.bwRef.minX + z.bwRef.maxX) / 2;
        } else if (z.type === 'between' && z.prevBwRef && z.nextBwRef) {
          center = (z.prevBwRef.maxX + z.nextBwRef.minX) / 2;
        } else if (z.type === 'outside-left' && z.bwRef) {
          center = z.bwRef.minX - 100;
        } else if (z.type === 'outside-right' && z.bwRef) {
          center = z.bwRef.maxX + 100;
        }
        const dist = Math.abs(g.x - center);
        if (dist < bestDist) {
          bestDist = dist;
          bestZ = z;
        }
      });
      bestZ.groups.push(g);
    }
  });

  // Für jede Zone die Einträge gruppieren und gemäß den Vorgaben zentrieren / herandrücken
  const resultGroups: DesignSiblingGroup[] = [];

  zones.forEach(z => {
    if (z.groups.length === 0) return;

    z.groups.sort((a, b) => a.x - b.x);
    const mergedMemberIds: string[] = [];
    z.groups.forEach(g => {
      g.memberIds.forEach(id => {
        if (!mergedMemberIds.includes(id)) mergedMemberIds.push(id);
      });
    });

    const totalW = getGroupWidth(mergedMemberIds.length);
    let targetX = z.groups[0].x;

    if (z.type === 'inside' && z.bwRef) {
      // Bei reservierten Zweigbreiten werden die Gruppen innerhalb der Zweigbreite zentriert
      targetX = Math.round((z.bwRef.minX + z.bwRef.maxX) / 2);
    } else if (z.type === 'between' && z.prevBwRef && z.nextBwRef) {
      // Gruppierungen zwischen Bereichen werden ebenfalls zentriert
      targetX = Math.round((z.prevBwRef.maxX + z.nextBwRef.minX) / 2);
    } else if (z.type === 'outside-left' && z.bwRef) {
      // Gruppierungen außerhalb links werden an den reservierten Bereich herangerückt
      const targetRight = z.bwRef.minX - 12;
      const calcX = Math.round(targetRight - totalW / 2);
      const minAllowedX = LEVEL_SIDEBAR_W + 16 + Math.round(totalW / 2);
      targetX = Math.max(minAllowedX, calcX);
    } else if (z.type === 'outside-right' && z.bwRef) {
      // Gruppierungen außerhalb rechts werden an den reservierten Bereich herangerückt
      const targetLeft = z.bwRef.maxX + 12;
      targetX = Math.round(targetLeft + totalW / 2);
    }

    const anchor = z.groups[0];
    const mergedGroup: DesignSiblingGroup = {
      id: `sg-row-${level}-${z.id}-${Date.now()}`,
      parentId: anchor.parentId,
      generation: anchor.generation,
      level,
      x: targetX,
      memberIds: mergedMemberIds,
      isUngrouped: false,
    };
    resultGroups.push(mergedGroup);
  });

  siblingGroups.value = siblingGroups.value.filter(g => g.level !== level).concat(resultGroups);
}

// Eintrag aus einer Gruppe oder angedockten Gruppe herauslösen.
// Sind Nachkommengenerationen in derselben Gruppe enthalten, werden diese so herausgelöst,
// dass Nachkommeneinträge, die auf einer Ebene dargestellt sind, jeweils neue Gruppen bilden.
function detachPersonFromGroup(targetGroup: DesignSiblingGroup, personId: string) {
  const p = personById.value.get(personId);
  if (!p) return;
  pushHistoryState();

  const descSet = getDescendantPersonIds(personId);

  // Fall 1: Eintrag ist einzeln in einer angedockten Gruppe
  if (targetGroup.memberIds.length === 1 && targetGroup.memberIds[0] === personId) {
    const ownW = getGroupWidth(1);
    const sameLevelOthers = visibleSiblingGroups.value.filter(
      g => g.id !== targetGroup.id && g.level === targetGroup.level
    );
    const gLeft = targetGroup.x - ownW / 2;
    const gRight = targetGroup.x + ownW / 2;
    const touchingLeft = sameLevelOthers.find(o => Math.abs(Math.round(o.x + getGroupWidth(o.memberIds.length) / 2) - gLeft) <= 2);
    const touchingRight = sameLevelOthers.find(o => Math.abs(gRight - Math.round(o.x - getGroupWidth(o.memberIds.length) / 2)) <= 2);

    if (touchingRight && !touchingLeft) {
      targetGroup.x -= 28;
    } else {
      targetGroup.x += 28;
    }
    return;
  }

  // Fall 2: Eintrag ist Teil einer Gruppe mit mehreren Mitgliedern
  const extractedIds = targetGroup.memberIds.filter(id => id === personId || descSet.has(id));
  const remainingIds = targetGroup.memberIds.filter(id => !extractedIds.includes(id));

  const origGroupX = targetGroup.x;
  const origGroupLevel = targetGroup.level;

  if (remainingIds.length > 0) {
    targetGroup.memberIds = remainingIds;
  } else {
    siblingGroups.value = siblingGroups.value.filter(g => g.id !== targetGroup.id);
  }

  const remainingW = getGroupWidth(remainingIds.length || 1);
  const detachedX = Math.round(origGroupX + remainingW / 2 + CARD_WIDTH / 2 + 24);

  // Gruppe für den herausgelösten Haupteintrag
  const personGen = p.proband_data[props.activeProbandId || '']?.generation || targetGroup.generation;
  const groupForPerson: DesignSiblingGroup = {
    id: `sg-detached-${personId}-${Date.now()}`,
    parentId: targetGroup.parentId,
    generation: personGen,
    level: origGroupLevel,
    x: detachedX,
    memberIds: [personId],
    isUngrouped: true,
  };
  siblingGroups.value.push(groupForPerson);

  // Nachkommen, die in derselben Gruppe enthalten waren:
  // Nachkommeneinträge, die auf einer Ebene dargestellt sind, bilden jeweils neue Gruppen
  const descInGroup = extractedIds.filter(id => id !== personId);
  if (descInGroup.length > 0) {
    const descGroup: DesignSiblingGroup = {
      id: `sg-desc-${personId}-${origGroupLevel}-${Date.now()}`,
      parentId: personId,
      generation: personGen + 1,
      level: origGroupLevel,
      x: detachedX + CARD_WIDTH + 24,
      memberIds: descInGroup,
      isUngrouped: false,
    };
    siblingGroups.value.push(descGroup);
  }

  // Prüfen, ob in weiteren Gruppen desselben gedockten Verbunds Nachkommen von personId enthalten sind
  const dockedCluster = getDockedCluster(targetGroup);
  dockedCluster.forEach(otherG => {
    if (otherG.id === targetGroup.id) return;
    const descInOther = otherG.memberIds.filter(id => descSet.has(id));
    if (descInOther.length > 0) {
      otherG.memberIds = otherG.memberIds.filter(id => !descInOther.includes(id));
      if (otherG.memberIds.length === 0) {
        siblingGroups.value = siblingGroups.value.filter(g => g.id !== otherG.id);
      }
      const dW = getGroupWidth(descInOther.length);
      siblingGroups.value.push({
        id: `sg-desc-cluster-${personId}-${otherG.level}-${Date.now()}`,
        parentId: personId,
        generation: personGen + 1,
        level: otherG.level,
        x: otherG.x + dW + 24,
        memberIds: descInOther,
        isUngrouped: false,
      });
    }
  });
}

const canDetachSelectedPerson = computed(() => {
  const p = selectedDesignPerson.value;
  if (!p) return false;
  const g = siblingGroups.value.find(grp => grp.memberIds.includes(p.id));
  if (!g) return false;
  if (g.memberIds.length > 1) return true;
  const sameLevel = visibleSiblingGroups.value.filter(o => o.id !== g.id && o.level === g.level);
  const ownW = getGroupWidth(1);
  const left = g.x - ownW / 2;
  const right = left + ownW;
  return sameLevel.some(o => {
    const oW = getGroupWidth(o.memberIds.length);
    const oL = o.x - oW / 2;
    const oR = oL + oW;
    return Math.abs(right - oL) <= 2 || Math.abs(left - oR) <= 2;
  });
});

function detachSelectedPerson() {
  const p = selectedDesignPerson.value;
  if (!p) return;
  const g = siblingGroups.value.find(grp => grp.memberIds.includes(p.id));
  if (g) detachPersonFromGroup(g, p.id);
}

function canRegroupPerson(personId: string): boolean {
  const pParentId = getBiologicalParentId(personId);
  if (!pParentId) return false;

  const bioSiblings = childrenMapByParentId.value.get(pParentId) || [];
  if (bioSiblings.length <= 1) return false;

  const bioSet = new Set(bioSiblings);
  const matchingGroups = siblingGroups.value.filter(g =>
    g.memberIds.some(id => bioSet.has(id))
  );

  return matchingGroups.length > 1;
}

// Die Funktion Geschwisterkinder wieder zu gruppieren, wirkt sich nur auf die Geschwister des Eintrags unter demselben Elterneintrag aus.
// Andere Nicht-Geschwister in den betroffenen Gruppen bleiben in ihren jeweiligen Gruppen erhalten.
function regroupSiblingsForPerson(personId: string) {
  const pParentId = getBiologicalParentId(personId);
  if (!pParentId) return;

  const bioSiblings = childrenMapByParentId.value.get(pParentId) || [];
  if (bioSiblings.length <= 1) return;

  const bioSet = new Set(bioSiblings);
  const matchingGroups = siblingGroups.value.filter(g =>
    g.memberIds.some(id => bioSet.has(id))
  );

  if (matchingGroups.length <= 1) return;
  pushHistoryState();

  matchingGroups.sort((a, b) => a.x - b.x);

  // Nur die biologischen Geschwister unter demselben Elterneintrag sammeln
  const mergedSiblings: string[] = [];
  matchingGroups.forEach(g => {
    g.memberIds.forEach(id => {
      if (bioSet.has(id) && !mergedSiblings.includes(id)) {
        mergedSiblings.push(id);
      }
    });
  });

  if (mergedSiblings.length <= 1) return;

  // Anker-Gruppe (wo der selektierte Eintrag lag, oder die erste Gruppe)
  const anchorGroup = matchingGroups.find(g => g.memberIds.includes(personId)) || matchingGroups[0];
  const avgX = Math.round(matchingGroups.reduce((acc, g) => acc + g.x, 0) / matchingGroups.length);

  // In allen betroffenen Gruppen NUR die biologischen Geschwister entfernen; Nicht-Geschwister bleiben erhalten!
  matchingGroups.forEach(g => {
    g.memberIds = g.memberIds.filter(id => !bioSet.has(id));
  });

  const mergedGroup: DesignSiblingGroup = {
    id: `sg-of-${pParentId}-${Date.now()}`,
    parentId: pParentId,
    generation: anchorGroup.generation,
    level: anchorGroup.level,
    x: avgX,
    memberIds: mergedSiblings,
    isUngrouped: false,
  };

  // Gruppen aktualisieren: Leere Gruppen (ohne verbleibende Mitglieder) fallen weg, neue Geschwistergruppe wird hinzugefügt
  siblingGroups.value = siblingGroups.value
    .filter(g => g.memberIds.length > 0)
    .concat(mergedGroup);
}


// Einzeleintrag / Gruppe direkt Kante an Kante (Rahmenkontakt) an den nächsten linken oder rechten Nachbarn auf derselben Ebene andocken
// Wenn Einträge bereits aneinander gedockt sind, wird das gesamte Cluster gemeinsam angedockt
function dockToNeighbor(group: DesignSiblingGroup, direction: 'left' | 'right') {
  const cluster = getDockedCluster(group);
  const clusterIds = new Set(cluster.map(g => g.id));
  const sameLevelOthers = visibleSiblingGroups.value.filter(
    g => !clusterIds.has(g.id) && g.level === group.level
  );
  if (sameLevelOthers.length === 0) return;
  pushHistoryState();

  const clusterMinLeft = Math.min(...cluster.map(g => Math.round(g.x - getGroupWidth(g.memberIds.length) / 2)));
  const clusterMaxRight = Math.max(...cluster.map(g => Math.round(g.x + getGroupWidth(g.memberIds.length) / 2)));

  if (direction === 'left') {
    const leftNeighbors = sameLevelOthers
      .filter(g => Math.round(g.x + getGroupWidth(g.memberIds.length) / 2) <= clusterMinLeft + 4)
      .sort((a, b) => b.x - a.x);
    if (leftNeighbors.length > 0) {
      const target = leftNeighbors[0];
      const targetRight = Math.round(target.x + getGroupWidth(target.memberIds.length) / 2);
      const offset = targetRight - clusterMinLeft;
      cluster.forEach(g => {
        g.x = Math.round(g.x + offset);
      });
    }
  } else {
    const rightNeighbors = sameLevelOthers
      .filter(g => Math.round(g.x - getGroupWidth(g.memberIds.length) / 2) >= clusterMaxRight - 4)
      .sort((a, b) => a.x - b.x);
    if (rightNeighbors.length > 0) {
      const target = rightNeighbors[0];
      const targetLeft = Math.round(target.x - getGroupWidth(target.memberIds.length) / 2);
      const offset = targetLeft - clusterMaxRight;
      cluster.forEach(g => {
        g.x = Math.round(g.x + offset);
      });
    }
  }
}

// Ebenen-Aktionen für Geschwistergruppen & einzelne Einträge (gedockte Einträge wechseln gemeinsam die Ebene)
function moveGroupLevel(group: DesignSiblingGroup, delta: number) {
  const cluster = getDockedCluster(group);
  const nextLevel = group.level + delta;
  if (nextLevel < 1) return;
  pushHistoryState();
  if (nextLevel > totalLevels.value) {
    levelHeights.value = {
      ...levelHeights.value,
      [nextLevel]: DEFAULT_LEVEL_HEIGHT,
    };
    totalLevels.value = nextLevel;
  }
  cluster.forEach(g => {
    g.level = nextLevel;
  });
}

function insertLevelAboveAndMoveGroup(group: DesignSiblingGroup) {
  pushHistoryState();
  const cluster = getDockedCluster(group);
  const clusterIds = new Set(cluster.map(g => g.id));
  const newLevel = group.level + 1;
  const nextHeights: Record<number, number> = {};
  for (let l = 1; l <= totalLevels.value; l++) {
    if (l < newLevel) nextHeights[l] = getLevelHeight(l);
    else nextHeights[l + 1] = getLevelHeight(l);
  }
  nextHeights[newLevel] = DEFAULT_LEVEL_HEIGHT;

  siblingGroups.value.forEach(g => {
    if (!clusterIds.has(g.id) && g.level >= newLevel) {
      g.level += 1;
    }
  });
  totalLevels.value += 1;
  levelHeights.value = nextHeights;
  cluster.forEach(g => {
    g.level = newLevel;
  });
}

function movePersonWithinGroup(group: DesignSiblingGroup, personId: string, dir: -1 | 1) {
  const idx = group.memberIds.indexOf(personId);
  if (idx < 0) return;
  const targetIdx = idx + dir;
  if (targetIdx < 0 || targetIdx >= group.memberIds.length) return;
  pushHistoryState();
  const copy = [...group.memberIds];
  const tmp = copy[idx];
  copy[idx] = copy[targetIdx];
  copy[targetIdx] = tmp;
  group.memberIds = copy;
}

function moveSinglePersonLevel(group: DesignSiblingGroup, personId: string, delta: number) {
  const targetLevel = group.level + delta;
  if (targetLevel < 1) return;
  pushHistoryState();
  if (targetLevel > totalLevels.value) {
    levelHeights.value = {
      ...levelHeights.value,
      [targetLevel]: DEFAULT_LEVEL_HEIGHT,
    };
    totalLevels.value = targetLevel;
  }

  if (group.memberIds.length <= 1) {
    group.level = targetLevel;
    return;
  }

  const cb = cardBoxByPersonId.value.get(personId);
  const newX = cb ? cb.centerX : group.x + 80;
  group.memberIds = group.memberIds.filter(id => id !== personId);

  siblingGroups.value.push({
    id: `sg-split-${personId}-${Date.now()}`,
    parentId: group.parentId,
    generation: group.generation,
    level: targetLevel,
    x: newX,
    memberIds: [personId],
    isUngrouped: true,
  });
}

function addTopLevel() {
  pushHistoryState();
  const nextLvl = totalLevels.value + 1;
  levelHeights.value = {
    ...levelHeights.value,
    [nextLvl]: DEFAULT_LEVEL_HEIGHT,
  };
  totalLevels.value = nextLvl;
}

function insertEmptyLevelAbove(level: number) {
  pushHistoryState();
  const newLevel = level + 1;
  const nextHeights: Record<number, number> = {};
  for (let l = 1; l <= totalLevels.value; l++) {
    if (l < newLevel) nextHeights[l] = getLevelHeight(l);
    else nextHeights[l + 1] = getLevelHeight(l);
  }
  nextHeights[newLevel] = DEFAULT_LEVEL_HEIGHT;

  siblingGroups.value.forEach(g => {
    if (g.level >= newLevel) {
      g.level += 1;
    }
  });
  totalLevels.value += 1;
  levelHeights.value = nextHeights;
}

function removeEmptyLevel(level: number) {
  if (totalLevels.value <= 1) return;
  const hasGroups = siblingGroups.value.some(g => g.level === level);
  if (hasGroups) return;
  pushHistoryState();

  const nextHeights: Record<number, number> = {};
  for (let l = 1; l <= totalLevels.value; l++) {
    if (l < level) nextHeights[l] = getLevelHeight(l);
    else if (l > level) nextHeights[l - 1] = getLevelHeight(l);
  }

  siblingGroups.value.forEach(g => {
    if (g.level > level) {
      g.level -= 1;
    }
  });
  totalLevels.value -= 1;
  levelHeights.value = nextHeights;
}

function cleanAllEmptyLevels() {
  const occupied = Array.from(new Set(siblingGroups.value.map(g => g.level))).sort((a, b) => a - b);
  if (occupied.length === 0) return;
  pushHistoryState();
  const levelMap = new Map<number, number>();
  const nextHeights: Record<number, number> = {};
  occupied.forEach((oldLvl, idx) => {
    const newLvl = idx + 1;
    levelMap.set(oldLvl, newLvl);
    nextHeights[newLvl] = getLevelHeight(oldLvl);
  });
  siblingGroups.value.forEach(g => {
    g.level = levelMap.get(g.level) || 1;
  });
  totalLevels.value = occupied.length;
  levelHeights.value = nextHeights;
}

// Canvas-Hintergrund Pan & Zoom
let didPanCanvas = false;
let panStartClient = { x: 0, y: 0 };

function startCanvasPan(e: MouseEvent) {
  if (e.button !== 0) return;
  isPanning = true;
  didPanCanvas = false;
  panStartClient = { x: e.clientX, y: e.clientY };
  panStart = { x: e.clientX - pan.value.x, y: e.clientY - pan.value.y };
}

function onCanvasPan(e: MouseEvent) {
  if (!isPanning) return;
  const dist = Math.hypot(e.clientX - panStartClient.x, e.clientY - panStartClient.y);
  if (dist > 4) {
    didPanCanvas = true;
  }
  pan.value = {
    x: e.clientX - panStart.x,
    y: e.clientY - panStart.y,
  };
}

function stopCanvasPan() {
  isPanning = false;
}

// Selektion und Highlights aufheben
function clearSelection() {
  activeDesignPersonId.value = '';
  drawingWidthForPersonId.value = null;
  emit('select', null);
  emit('clear-selection');
}

// Klick auf den Viewport / Hintergrund außerhalb von Personeneinträgen und Funktionsbereichen
function onViewportClick(e: MouseEvent) {
  if (didPanCanvas) {
    didPanCanvas = false;
    return;
  }
  const target = e.target as HTMLElement | null;
  if (!target) return;

  // Wenn der Klick innerhalb eines Eintrages oder Funktionsbereiches erfolgte, Selektion nicht aufheben
  if (
    target.closest('.design-person-card') ||
    target.closest('.sibling-group-container') ||
    target.closest('.design-toolbar') ||
    target.closest('.floating-level-controls-container') ||
    target.closest('.design-zoom-controls') ||
    target.closest('.group-floating-controls') ||
    target.closest('.branch-width-bar') ||
    target.closest('.design-proband-prompt')
  ) {
    return;
  }

  clearSelection();
}

// Mausrad steuert die Zoom-Funktion, zentriert auf die aktuelle Mauszeiger-Position
function handleWheelZoom(e: WheelEvent) {
  e.preventDefault();
  const vp = viewportRef.value;
  if (!vp) return;

  const rect = vp.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  // Zoomfaktor je Mausrad-Richtung
  const zoomFactor = e.deltaY < 0 ? 1.09 : 0.91;
  const currentZoom = zoom.value;
  const nextZoom = Math.max(0.08, Math.min(2.5, currentZoom * zoomFactor));

  // Leinwandkoordinaten unter dem Mauszeiger
  const canvasX = (mouseX - pan.value.x) / currentZoom;
  const canvasY = (mouseY - pan.value.y) / currentZoom;

  // Pan so anpassen, dass der Punkt unter dem Mauszeiger stabil bleibt
  pan.value = {
    x: Math.round(mouseX - canvasX * nextZoom),
    y: Math.round(mouseY - canvasY * nextZoom),
  };
  zoom.value = Math.round(nextZoom * 1000) / 1000;
}

// Zoom-Buttons in der Ansicht (zentriert auf Viewport-Mitte)
function zoomStepCenter(factor: number) {
  const vp = viewportRef.value;
  const vpW = vp?.clientWidth || 1000;
  const vpH = vp?.clientHeight || 650;
  const centerX = vpW / 2;
  const centerY = vpH / 2;
  const canvasX = (centerX - pan.value.x) / zoom.value;
  const canvasY = (centerY - pan.value.y) / zoom.value;
  const nextZoom = Math.max(0.08, Math.min(2.5, zoom.value * factor));
  pan.value = {
    x: Math.round(centerX - canvasX * nextZoom),
    y: Math.round(centerY - canvasY * nextZoom),
  };
  zoom.value = Math.round(nextZoom * 1000) / 1000;
}

function getHenryCode(person: Person): string {
  const pid = props.activeProbandId;
  if (!pid) return '';
  return person.proband_data[pid]?.henry_code || '';
}

// ----------------------------------------------------
// Speichern & Laden von Design-Zuständen (DB & Datei)
// ----------------------------------------------------
interface DesignPersistedState {
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
}

interface DesignLayoutEntry {
  id: string;
  proband_id: string;
  name: string;
  created_at: string;
  layout_data: string;
}

const showSaveModal = ref(false);
const saveFileName = ref('');
const saveFeedbackMessage = ref('');
const isSaving = ref(false);
const existingPresets = ref<DesignLayoutEntry[]>([]);
const saveMode = ref<'new' | 'overwrite'>('new');
const selectedOverwriteId = ref('');

const showLoadModal = ref(false);
const savedLayoutsList = ref<DesignLayoutEntry[]>([]);
const isLoadingLayouts = ref(false);
const loadFeedbackMessage = ref('');
const fileInputRef = ref<HTMLInputElement | null>(null);

const activeProbandName = computed(() => {
  if (!props.activeProbandId) return '';
  const p = personById.value.get(props.activeProbandId);
  return p ? `${p.given_name || 'N.N.'} ${p.surname || ''}`.trim() : props.activeProbandId;
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

  return {
    version: 1,
    probandId: props.activeProbandId || '',
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
  };
}

async function openSaveModal() {
  const probandPerson = props.activeProbandId ? personById.value.get(props.activeProbandId) : null;
  const rawName = probandPerson
    ? `${probandPerson.given_name || ''}_${probandPerson.surname || ''}`.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\-äöüÄÖÜß]/g, '')
    : 'Stammbaum';
  const dateStr = new Date().toISOString().slice(0, 10);
  saveFileName.value = `${rawName || 'Design'}_${dateStr}`;
  saveFeedbackMessage.value = '';
  saveMode.value = 'new';
  selectedOverwriteId.value = '';
  showSaveModal.value = true;
  try {
    existingPresets.value = await invoke<DesignLayoutEntry[]>('get_design_layouts', {
      probandId: props.activeProbandId || '',
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
    const stateObj = getSerializedDesignState(name);
    const jsonStr = JSON.stringify(stateObj, null, 2);
    const overwriteId = (saveMode.value === 'overwrite' && selectedOverwriteId.value)
      ? selectedOverwriteId.value
      : (matchingExistingPreset.value ? matchingExistingPreset.value.id : null);
    await invoke('save_design_layout', {
      probandId: props.activeProbandId || '',
      name,
      createdAt: new Date().toISOString(),
      layoutData: jsonStr,
      overwriteId,
    });
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
    try {
      const res = await save({
        defaultPath: `${name}.json`,
        filters: [{ name: 'Stammbaum Design (*.json)', extensions: ['json'] }],
      });
      if (typeof res === 'string') filePath = res;
    } catch {
      filePath = null;
    }

    if (filePath) {
      await invoke('save_design_file', { filePath, content: jsonStr });
      saveFeedbackMessage.value = t('design_export_success', { path: filePath });
    } else {
      downloadJsonInBrowser(`${name}.json`, jsonStr);
      saveFeedbackMessage.value = t('design_save_success', { name });
    }

    const overwriteId = (saveMode.value === 'overwrite' && selectedOverwriteId.value)
      ? selectedOverwriteId.value
      : (matchingExistingPreset.value ? matchingExistingPreset.value.id : null);
    try {
      await invoke('save_design_layout', {
        probandId: props.activeProbandId || '',
        name,
        createdAt: new Date().toISOString(),
        layoutData: jsonStr,
        overwriteId,
      });
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
    savedLayoutsList.value = await invoke<DesignLayoutEntry[]>('get_design_layouts', {
      probandId: props.activeProbandId || '',
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
  if (state.expandedParentIds && Array.isArray(state.expandedParentIds)) {
    expandedParentIds.value = new Set(state.expandedParentIds);
  }
  if (state.pan && typeof state.pan.x === 'number' && typeof state.pan.y === 'number') {
    pan.value = { x: state.pan.x, y: state.pan.y };
  }
  if (state.zoom && typeof state.zoom === 'number') {
    zoom.value = state.zoom;
  }
  activeDesignPersonId.value = '';
}

function loadStateFromEntry(entry: DesignLayoutEntry) {
  try {
    const parsed = JSON.parse(entry.layout_data) as DesignPersistedState;
    applyLoadedState(parsed);
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

async function loadStateFromFile() {
  try {
    let selected: string | null = null;
    try {
      const res = await open({
        multiple: false,
        filters: [{ name: 'Stammbaum Design (*.json)', extensions: ['json'] }],
      });
      if (typeof res === 'string') selected = res;
    } catch {
      selected = null;
    }

    if (selected) {
      const content = await invoke<string>('read_design_file', { filePath: selected });
      processLoadedJsonString(content, selected.split(/[\\/]/).pop()?.replace(/\.json$/i, '') || 'Import');
    } else if (fileInputRef.value) {
      fileInputRef.value.click();
    }
  } catch (err) {
    loadFeedbackMessage.value = t('design_load_error', { error: String(err) });
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

    try {
      await invoke('save_design_layout', {
        probandId: props.activeProbandId || parsed.probandId || '',
        name: entryName,
        createdAt: new Date().toISOString(),
        layoutData: content,
      });
    } catch {}

    loadFeedbackMessage.value = t('design_load_file_success');
    setTimeout(() => {
      showLoadModal.value = false;
      loadFeedbackMessage.value = '';
    }, 1000);
  } catch (err) {
    loadFeedbackMessage.value = t('design_load_error', { error: String(err) });
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
</script>

<template>
  <div class="design-mode-wrapper">
    <!-- 1. Falls noch kein Stammahn ausgewählt wurde: Auswahlmaske für Stammahnen -->
    <div v-if="!activeProbandId" class="design-proband-prompt" @mousedown.stop>
      <div class="design-prompt-card">
        <h2>📐 {{ t('design_select_proband_title') }}</h2>
        <p class="design-prompt-subtitle">{{ t('design_select_proband_subtitle') }}</p>

        <div v-if="rootAncestors.length > 0" class="design-proband-list">
          <div
            v-for="r in rootAncestors"
            :key="'dm-root-' + r.person_id"
            class="design-proband-item"
            @click="emit('select-proband', r.person_id)"
          >
            <div class="dp-info">
              <span class="dp-code">[{{ r.starting_code }}]</span>
              <strong>{{ r.surname || 'N.N.' }}, {{ r.given_name || 'N.N.' }}</strong>
              <small class="dp-id">({{ r.person_id }})</small>
            </div>
            <button class="btn-sm btn-select-proband" @click.stop="emit('select-proband', r.person_id)">
              {{ t('free_open_person') }}
            </button>
          </div>
        </div>

        <div v-else class="design-no-probands">
          <p>{{ t('no_probands') }}</p>
          <button class="btn-open-settings" @click="emit('open-settings')">
            {{ t('design_open_settings') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 2. Design-Mode Arbeitsfläche mit ausgewähltem Stammahnen (Darstellung von unten nach oben) -->
    <template v-else>
      <div class="design-toolbar" @mousedown.stop>
        <div class="design-toolbar-left">
          <!-- Undo-Button zum Zurücksetzen der letzten Aktionen -->
          <button
            class="btn-design-tool btn-undo"
            :disabled="!canUndo"
            :title="t('design_undo_tooltip')"
            @click="undoLastAction"
          >
            ↩️ {{ t('design_undo_btn') }} <span v-if="historyStack.length > 0">({{ historyStack.length }})</span>
          </button>
          <button class="btn-design-tool" @click="expandAllDescendants">
            {{ t('design_expand_all') }}
          </button>
          <button class="btn-design-tool" @click="collapseAllToOrigin">
            {{ t('design_collapse_all') }}
          </button>
          <button class="btn-design-tool" @click="addTopLevel">
            {{ t('design_add_level_top') }}
          </button>
          <button class="btn-design-tool" @click="cleanAllEmptyLevels">
            {{ t('design_clean_empty_levels') }}
          </button>
          <button class="btn-design-tool btn-reset-design" @click="buildInitialDesignLayout">
            {{ t('design_reset_layout') }}
          </button>

          <!-- Button für Zweig-Breite des aktuell ausgewählten Eintrags (nur bei isolierten Einträgen verfügbar) -->
          <button
            v-if="selectedDesignPerson && isPersonIsolated(selectedDesignPerson.id)"
            class="btn-design-tool btn-draw-branch-width"
            :class="{ active: drawingWidthForPersonId === selectedDesignPerson.id }"
            @click="startOrToggleBranchWidthFor(selectedDesignPerson.id)"
          >
            {{ t('design_draw_width_btn') }} ({{ selectedDesignPerson.given_name || 'N.N.' }} {{ selectedDesignPerson.surname || '' }})
          </button>

          <!-- Button zum Herauslösen des aktuell ausgewählten Eintrags aus der Gruppe / angedockten Gruppe -->
          <button
            v-if="canDetachSelectedPerson && selectedDesignPerson"
            class="btn-design-tool btn-detach-person"
            :title="t('design_detach_person_tooltip')"
            @click="detachSelectedPerson"
          >
            ⏏️ {{ t('design_detach_person_btn') }} ({{ selectedDesignPerson.given_name || 'N.N.' }} {{ selectedDesignPerson.surname || '' }})
          </button>
          <span v-if="drawingWidthForPersonId && selectedDesignPerson" class="draw-width-status">
            {{ t('design_draw_width_active', { name: `${selectedDesignPerson.given_name || 'N.N.'} ${selectedDesignPerson.surname || ''}` }) }}
            <button class="btn-cancel-draw-width" @click="drawingWidthForPersonId = null">
              {{ t('design_draw_width_cancel') }}
            </button>
          </span>
        </div>

        <div class="design-toolbar-right">
          <span
            class="bridges-badge"
            :class="{
              'has-bridges': edgeGeometry.totalBridgesCount > 0,
              'is-disabled': props.enableLineBridges === false
            }"
          >
            🌉 {{ t('design_bridges_count') }}:
            <strong v-if="props.enableLineBridges !== false">{{ edgeGeometry.totalBridgesCount }}</strong>
            <small v-else style="font-weight: normal; margin-left: 2px;">({{ t('design_bridges_disabled') || 'deaktiviert' }})</small>
          </span>
          <span class="design-hint-text">{{ t('design_hint') }}</span>
        </div>
      </div>

      <div
        ref="viewportRef"
        class="design-viewport"
        :class="{ panning: isPanning, 'drawing-width-cursor': Boolean(drawingWidthForPersonId) }"
        @mousedown="startCanvasPan"
        @mousemove="onCanvasPan"
        @mouseup="stopCanvasPan"
        @mouseleave="stopCanvasPan"
        @click="onViewportClick"
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

            <!-- Individuell definierbare Höhe des Ebenenabstandes pro Ebene -->
            <div class="flp-height-row">
              <span class="flp-h-label">{{ t('design_level_height') }}:</span>
              <button
                class="flp-h-step"
                @click.stop="setLevelHeight(lvlInfo.level, lvlInfo.height - 20)"
              >
                −
              </button>
              <input
                type="number"
                class="flp-h-input"
                :min="MIN_LEVEL_HEIGHT"
                :max="MAX_LEVEL_HEIGHT"
                step="10"
                :value="lvlInfo.height"
                @change="setLevelHeight(lvlInfo.level, parseInt(($event.target as HTMLInputElement).value, 10))"
              />
              <button
                class="flp-h-step"
                @click.stop="setLevelHeight(lvlInfo.level, lvlInfo.height + 20)"
              >
                +
              </button>
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
          <!-- Horizontale Ebenen-Bänder (von oben nach unten gerendert, Ebene 1 = unten beim Stammahn) -->
          <div
            v-for="lvlInfo in levelsTopToBottom"
            :key="'lvl-band-' + lvlInfo.level"
            class="level-band"
            :class="{
              'is-origin-level': lvlInfo.level === 1,
              'is-multi-gen': lvlInfo.generations.length > 1,
              'is-draw-target-level':
                drawingWidthForPersonId !== null &&
                getRawPersonPosition(drawingWidthForPersonId)?.level === lvlInfo.level,
            }"
            :style="{
              top: lvlInfo.bandTopY + 'px',
              height: lvlInfo.height + 'px',
            }"
            @mousedown="onLevelBandMouseDown($event, lvlInfo.level)"
          >
            <!-- Ziehbare untere Trennlinie zur direkten Höhenanpassung der Ebene per Maus -->
            <div
              class="level-resize-handle"
              @mousedown="startLevelResize($event, lvlInfo.level)"
            ></div>
          </div>

          <!-- Korridor- & Abgrenzungs-Visualisierung für gezogene Zweig-Breiten -->
          <template v-for="bw in renderedBranchWidths" :key="'bw-zone-' + bw.personId">
            <!-- Korridor oberhalb der Ebene des Eintrags (innerhalb dessen Nachfolgeeinträge platziert und andere Zweige ausgeblendet werden) -->
            <div
              v-if="bw.corridorHeight > 0"
              class="branch-corridor-zone"
              :style="{
                left: bw.minX + 'px',
                top: bw.corridorTopY + 'px',
                width: bw.width + 'px',
                height: bw.corridorHeight + 'px',
              }"
            ></div>

            <!-- Ziehbare Breiten-Abgrenzung auf der aktuellen Ebene des ausgewählten Eintrags -->
            <div
              class="branch-width-bar"
              :style="{
                left: bw.minX + 'px',
                top: bw.barY + 'px',
                width: bw.width + 'px',
              }"
              @mousedown.stop
            >
              <div
                class="bw-handle bw-handle-left"
                title="Linke Grenze ziehen"
                @mousedown="startBranchWidthHandleDrag($event, bw.personId, 'left')"
              >
                ◀
              </div>
              <div class="bw-bar-label">
                <span>↔️ {{ t('design_branch_width_label') }}: <strong>{{ bw.personName }}</strong> ({{ bw.width }} px)</span>
                <button
                  class="bw-remove-btn"
                  :title="t('design_remove_branch_width')"
                  @click.stop="removeBranchWidth(bw.personId)"
                >
                  ✖
                </button>
              </div>
              <div
                class="bw-handle bw-handle-right"
                title="Rechte Grenze ziehen"
                @mousedown="startBranchWidthHandleDrag($event, bw.personId, 'right')"
              >
                ▶
              </div>
            </div>
          </template>

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

          <!-- SVG-Layer für alle Kanten (starten & enden direkt an den Kästchen) inkl. Linienbrücken -->
          <svg
            class="design-edges-svg"
            :width="canvasWidth"
            :height="canvasHeight"
          >
            <path
              v-for="(d, idx) in edgeGeometry.normalPaths"
              :key="'np-' + idx"
              :d="d"
              class="design-edge-line"
            />
            <path
              v-for="(d, idx) in edgeGeometry.highlightedPaths"
              :key="'hp-' + idx"
              :d="d"
              class="design-edge-line is-highlighted"
            />
            <polygon
              v-for="(arr, idx) in edgeGeometry.arrows"
              :key="'arr-' + idx"
              :points="
                arr.direction === 'up'
                  ? `${arr.x},${arr.y} ${arr.x - 5},${arr.y + 9} ${arr.x + 5},${arr.y + 9}`
                  : `${arr.x},${arr.y} ${arr.x - 5},${arr.y - 9} ${arr.x + 5},${arr.y - 9}`
              "
              class="design-edge-arrow"
              :class="{ 'is-highlighted': arr.isHighlighted }"
            />
          </svg>

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
              @mousedown.stop
            >
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
                <div
                  v-for="cb in subGrp.cards"
                  :key="cb.person.id"
                  class="design-person-card"
                  :class="{
                    selected: Boolean(activeDesignPersonId || selectedId) && (activeDesignPersonId || selectedId) === cb.person.id,
                    'has-branch-width': branchWidths.has(cb.person.id),
                    'in-partner-path': Boolean(highlightedPathIds && highlightedPathIds.size > 0 && highlightedPathIds.has(cb.person.id)),
                    male: cb.person.sex === 'M',
                    female: cb.person.sex === 'F',
                  }"
                  :style="{ width: CARD_WIDTH + 'px', height: CARD_HEIGHT + 'px' }"
                  @click.stop="selectCardPerson(cb.person)"
                >
                <!-- Button zum Ziehen / Festlegen der Zweig-Breite: erst auf Select dynamisch nachgeladen -->
                <button
                  v-if="isPersonSelected(cb.person.id) && isPersonIsolated(cb.person.id)"
                  class="branch-width-card-btn"
                  :class="{
                    active: drawingWidthForPersonId === cb.person.id || branchWidths.has(cb.person.id),
                  }"
                  :title="t('design_card_width_tooltip')"
                  @mousedown.stop
                  @click.stop="startOrToggleBranchWidthFor(cb.person.id)"
                >
                  ↔️
                </button>

                <!-- Button zum Ein- und Ausklappen der Nachfahren: erst auf Select dynamisch nachgeladen -->
                <button
                  v-if="isPersonSelected(cb.person.id) && hasDescendants(cb.person.id)"
                  class="descendant-toggle-btn"
                  :class="{ 'is-expanded': isParentExpanded(cb.person.id) }"
                  :title="isParentExpanded(cb.person.id) ? t('collapse_children_tooltip') : t('expand_children_tooltip')"
                  @mousedown.stop
                  @click.stop="toggleDescendants(cb.person.id)"
                >
                  {{ isParentExpanded(cb.person.id) ? '▼' : '▲' }}
                </button>

                <div class="d-card-top">
                  <span v-if="getHenryCode(cb.person)" class="d-henry-badge">
                    [{{ getHenryCode(cb.person) }}]
                  </span>
                  <span class="d-gen-badge">Gen. {{ cb.generation }}</span>

                  <!-- Steuerung für einzelne Box innerhalb der Gruppe: erst auf Select dynamisch nachgeladen -->
                  <div
                    v-if="isPersonSelected(cb.person.id) && (gl.cards.length > 1 || gl.isDocked || canRegroupPerson(cb.person.id))"
                    class="d-card-mini-btns"
                    @mousedown.stop
                  >
                    <!-- Aufgelöste Geschwister wieder zu einer Gruppe zusammenführen -->
                    <button
                      v-if="canRegroupPerson(cb.person.id)"
                      class="d-mini-btn d-mini-regroup"
                      :title="t('design_regroup_tooltip')"
                      @click.stop="regroupSiblingsForPerson(cb.person.id)"
                    >
                      🔗
                    </button>

                    <template v-if="gl.cards.length > 1">
                      <!-- Gruppe auflösen nach links oder rechts -->
                      <button
                        class="d-mini-btn d-mini-ungroup"
                        :title="t('design_ungroup_left_tooltip')"
                        @click.stop="ungroupAtPerson(gl.group, cb.person.id, 'left')"
                      >
                        ✂️◀
                      </button>
                      <button
                        class="d-mini-btn d-mini-ungroup"
                        :title="t('design_ungroup_right_tooltip')"
                        @click.stop="ungroupAtPerson(gl.group, cb.person.id, 'right')"
                      >
                        ✂️▶
                      </button>
                      <button
                        class="d-mini-btn"
                        :disabled="gl.cards.findIndex(c => c.person.id === cb.person.id) === 0"
                        :title="t('design_move_person_left')"
                        @click.stop="movePersonWithinGroup(gl.group, cb.person.id, -1)"
                      >
                        ◀
                      </button>
                      <button
                        class="d-mini-btn"
                        :disabled="gl.cards.findIndex(c => c.person.id === cb.person.id) === gl.cards.length - 1"
                        :title="t('design_move_person_right')"
                        @click.stop="movePersonWithinGroup(gl.group, cb.person.id, 1)"
                      >
                        ▶
                      </button>
                      <button
                        class="d-mini-btn"
                        :title="t('design_move_person_up')"
                        @click.stop="moveSinglePersonLevel(gl.group, cb.person.id, 1)"
                      >
                        ▲
                      </button>
                      <button
                        v-if="gl.group.level > 1"
                        class="d-mini-btn"
                        :title="t('design_move_person_down')"
                        @click.stop="moveSinglePersonLevel(gl.group, cb.person.id, -1)"
                      >
                        ▼
                      </button>
                    </template>

                    <!-- Eintrag aus Gruppe / angedockter Gruppe herauslösen -->
                    <button
                      v-if="gl.cards.length > 1 || gl.isDocked"
                      class="d-mini-btn d-mini-detach"
                      :title="t('design_detach_person_tooltip')"
                      @click.stop="detachPersonFromGroup(gl.group, cb.person.id)"
                    >
                      ⏏️
                    </button>
                  </div>
                </div>

                <div class="d-card-name" :title="`${cb.person.given_name || 'N.N.'} ${cb.person.surname || ''}`">
                  <strong>{{ cb.person.given_name || 'N.N.' }}</strong> {{ cb.person.surname || '' }}
                </div>

                <div class="d-card-dates">
                  <span v-if="cb.person.birth_date">* {{ cb.person.birth_date }}</span>
                  <span v-if="cb.person.death_date"> † {{ cb.person.death_date }}</span>
                </div>
              </div>
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
            @click.stop="undoLastAction"
          >
            ↩️
          </button>
          <!-- Laden Button: etwas kleinerer Kreis mit "Open File" Icon -->
          <button
            class="persist-circle-btn persist-btn-load"
            :title="t('design_load_tooltip')"
            @click.stop="openLoadModal"
          >
            📂
          </button>
          <!-- Speichern Button: etwas größerer Kreis mit "Diskette" Icon -->
          <button
            class="persist-circle-btn persist-btn-save"
            :title="t('design_save_tooltip')"
            @click.stop="openSaveModal"
          >
            💾
          </button>
        </div>
      </div>

      <!-- Speichern-Modal -->
      <div v-if="showSaveModal" class="design-modal-backdrop" @click="showSaveModal = false" @mousedown.stop>
        <div class="design-modal-window" @click.stop>
          <div class="design-modal-header">
            <div class="design-modal-title">
              <span class="design-modal-icon">💾</span>
              <h3>{{ t('design_save_modal_title') }}</h3>
            </div>
            <button class="design-modal-close-btn" @click="showSaveModal = false">✕</button>
          </div>

          <div class="design-modal-body">
            <div class="design-modal-proband-banner">
              <span class="proband-label">Stammahn:</span>
              <strong>{{ activeProbandName || '–' }}</strong>
            </div>

            <!-- Modus-Auswahl: Neuer Stand oder Bestehenden Stand überschreiben -->
            <div v-if="existingPresets.length > 0" class="save-mode-selector">
              <label class="save-mode-radio">
                <input
                  type="radio"
                  name="save-mode"
                  value="new"
                  :checked="saveMode === 'new'"
                  @change="onSaveModeChange('new')"
                />
                <span>{{ t('design_save_mode_new') }}</span>
              </label>
              <label class="save-mode-radio">
                <input
                  type="radio"
                  name="save-mode"
                  value="overwrite"
                  :checked="saveMode === 'overwrite'"
                  @change="onSaveModeChange('overwrite')"
                />
                <span>{{ t('design_save_mode_overwrite') }} ({{ existingPresets.length }})</span>
              </label>
            </div>

            <!-- Wenn Modus "Überschreiben": Auswahlliste bestehender Stände -->
            <div v-if="saveMode === 'overwrite'" class="design-form-group">
              <label class="design-form-label">{{ t('design_select_overwrite_label') }}</label>
              <select
                v-model="selectedOverwriteId"
                class="design-modal-select"
                @change="onSelectOverwritePreset"
              >
                <option v-for="preset in existingPresets" :key="preset.id" :value="preset.id">
                  {{ preset.name }} ({{ formatDateStr(preset.created_at) }})
                </option>
              </select>
            </div>

            <div class="design-form-group">
              <label class="design-form-label">{{ t('design_save_filename_label') }}</label>
              <input
                v-model="saveFileName"
                type="text"
                class="design-modal-input"
                :placeholder="t('design_save_filename_placeholder')"
                @keyup.enter="saveCurrentStateToDb"
                autofocus
              />
              <span v-if="saveMode === 'new' && isMatchingExistingName" class="design-input-hint warn-text">
                ⚠️ {{ t('design_overwrite_warning') }}
              </span>
              <span v-else class="design-input-hint">
                {{ saveMode === 'overwrite' ? t('design_overwrite_hint') : 'Mehrere Stände können gespeichert werden, um verschiedene Anordnungen auszuprobieren.' }}
              </span>
            </div>

            <div class="design-summary-box">
              <div class="summary-item">
                <span class="s-label">Ebenen:</span>
                <span class="s-val">{{ totalLevels }}</span>
              </div>
              <div class="summary-item">
                <span class="s-label">Gruppen:</span>
                <span class="s-val">{{ siblingGroups.length }}</span>
              </div>
              <div class="summary-item">
                <span class="s-label">Zweig-Abgrenzungen:</span>
                <span class="s-val">{{ branchWidths.size }}</span>
              </div>
            </div>

            <div v-if="saveFeedbackMessage" class="design-modal-feedback success">
              {{ saveFeedbackMessage }}
            </div>
          </div>

          <div class="design-modal-footer">
            <button
              class="d-modal-btn d-modal-btn-primary"
              :class="{ 'btn-overwrite': saveMode === 'overwrite' || isMatchingExistingName }"
              :disabled="!saveFileName.trim() || isSaving"
              @click="saveCurrentStateToDb"
            >
              {{ (saveMode === 'overwrite' || isMatchingExistingName) ? t('design_overwrite_btn') : t('design_save_to_db_btn') }}
            </button>
            <button
              class="d-modal-btn d-modal-btn-secondary"
              :disabled="!saveFileName.trim() || isSaving"
              @click="exportStateToFile"
            >
              {{ t('design_export_file_btn') }}
            </button>
            <button class="d-modal-btn d-modal-btn-cancel" @click="showSaveModal = false">
              {{ t('cancel') || 'Abbrechen' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Laden-Modal -->
      <div v-if="showLoadModal" class="design-modal-backdrop" @click="showLoadModal = false" @mousedown.stop>
        <div class="design-modal-window load-modal-window" @click.stop>
          <div class="design-modal-header">
            <div class="design-modal-title">
              <span class="design-modal-icon">📂</span>
              <h3>{{ t('design_load_modal_title') }}</h3>
            </div>
            <button class="design-modal-close-btn" @click="showLoadModal = false">✕</button>
          </div>

          <div class="design-modal-body">
            <div class="design-modal-proband-banner">
              <span class="proband-label">{{ t('design_saved_presets_title') }}</span>
              <strong>{{ activeProbandName || '–' }}</strong>
            </div>

            <div v-if="loadFeedbackMessage" class="design-modal-feedback success">
              {{ loadFeedbackMessage }}
            </div>

            <!-- Gespeicherte Stände Liste -->
            <div class="design-presets-container">
              <div v-if="isLoadingLayouts" class="design-presets-loading">
                Lade Stände...
              </div>
              <div v-else-if="savedLayoutsList.length === 0" class="design-empty-presets">
                {{ t('design_no_presets') }}
              </div>
              <div v-else class="design-presets-list">
                <div
                  v-for="entry in savedLayoutsList"
                  :key="entry.id"
                  class="design-preset-row"
                >
                  <div class="preset-info">
                    <div class="preset-name">{{ entry.name }}</div>
                    <div class="preset-meta">
                      <span>🕒 {{ formatDateStr(entry.created_at) }}</span>
                    </div>
                  </div>
                  <div class="preset-actions">
                    <button
                      class="d-preset-btn btn-apply"
                      @click="loadStateFromEntry(entry)"
                      :title="t('design_load_preset_btn')"
                    >
                      {{ t('design_load_preset_btn') }}
                    </button>
                    <button
                      class="d-preset-btn btn-export"
                      @click="exportEntryToFile(entry)"
                      :title="t('design_export_file_btn')"
                    >
                      💾 Datei
                    </button>
                    <button
                      class="d-preset-btn btn-delete"
                      @click="deleteStateEntry(entry.id)"
                      :title="t('design_delete_preset_btn')"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Geteilte Datei öffnen -->
            <div class="design-external-file-box">
              <div class="ext-file-title">
                <strong>{{ t('design_open_file_section') }}</strong>
              </div>
              <p class="ext-file-desc">{{ t('design_open_file_hint') }}</p>
              <button class="d-modal-btn d-modal-btn-open-file" @click="loadStateFromFile">
                {{ t('design_open_file_btn') }}
              </button>
              <input
                ref="fileInputRef"
                type="file"
                accept=".json"
                style="display: none"
                @change="onFileInputChange"
              />
            </div>
          </div>

          <div class="design-modal-footer">
            <button class="d-modal-btn d-modal-btn-cancel" @click="showLoadModal = false">
              {{ t('close') || 'Schließen' }}
            </button>
          </div>
        </div>
      </div>
    </template>
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

/* Stammahnen-Auswahlmaske wenn noch kein Stammahn gewählt ist */
.design-proband-prompt {
  flex-grow: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  overflow-y: auto;
}
.design-prompt-card {
  background: white;
  border: 1px solid #dcdde1;
  border-radius: 8px;
  padding: 1.6rem 2rem;
  width: 100%;
  max-width: 640px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.06);
}
.design-prompt-card h2 {
  margin: 0 0 0.4rem 0;
  color: #2c3e50;
  font-size: 1.25rem;
}
.design-prompt-subtitle {
  margin: 0 0 1.2rem 0;
  color: #7f8c8d;
  font-size: 0.9rem;
  line-height: 1.45;
}
.design-proband-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: 320px;
  overflow-y: auto;
}
.design-proband-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.65rem 0.9rem;
  border: 1px solid #e1e8ed;
  border-radius: 6px;
  background: #fafbfc;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.design-proband-item:hover {
  background: #eaf4fc;
  border-color: #3498db;
}
.dp-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.92rem;
  color: #2c3e50;
}
.dp-code {
  background: #34495e;
  color: white;
  font-weight: bold;
  font-size: 0.78rem;
  padding: 2px 6px;
  border-radius: 4px;
}
.dp-id {
  color: #7f8c8d;
}
.btn-select-proband {
  background: #2980b9;
  color: white;
  border: none;
  padding: 0.35rem 0.75rem;
  border-radius: 4px;
  cursor: pointer;
  font-weight: bold;
  font-size: 0.8rem;
}
.btn-select-proband:hover {
  background: #1f618d;
}
.design-no-probands {
  text-align: center;
  padding: 1rem;
  background: #f8f9fa;
  border: 1px dashed #bdc3c7;
  border-radius: 6px;
}
.btn-open-settings {
  margin-top: 0.5rem;
  background: #3498db;
  color: white;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  cursor: pointer;
  font-weight: bold;
}

/* Design-Toolbar */
.design-toolbar {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 10px 15px;
  background: white;
  border-bottom: 1px solid #dcdde1;
  z-index: 20;
}
.design-toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.design-toolbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.btn-design-tool {
  background: #34495e;
  color: white;
  border: none;
  padding: 0.4rem 0.75rem;
  border-radius: 4px;
  font-size: 0.78rem;
  font-weight: bold;
  cursor: pointer;
}
.btn-design-tool:hover {
  background: #2c3e50;
}
.btn-undo {
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  color: #334155;
}
.btn-undo:hover:not(:disabled) {
  background: #e2e8f0;
  border-color: #94a3b8;
  color: #0f172a;
}
.btn-undo:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.btn-reset-design {
  background: #e67e22;
}
.btn-reset-design:hover {
  background: #d35400;
}
.btn-draw-branch-width {
  background: #8e44ad;
}
.btn-draw-branch-width:hover,
.btn-draw-branch-width.active {
  background: #6c3483;
  box-shadow: 0 0 0 2px rgba(142, 68, 173, 0.35);
}
.draw-width-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #f3e5f5;
  color: #6a1b9a;
  border: 1px solid #ce93d8;
  border-radius: 4px;
  padding: 3px 8px;
  font-size: 0.76rem;
  font-weight: bold;
}
.btn-cancel-draw-width {
  background: #6a1b9a;
  color: white;
  border: none;
  border-radius: 3px;
  padding: 2px 6px;
  font-size: 0.72rem;
  cursor: pointer;
}
.bridges-badge {
  font-size: 0.8rem;
  padding: 0.3rem 0.65rem;
  border-radius: 12px;
  background: #ecf0f1;
  color: #576574;
  border: 1px solid #dcdde1;
  white-space: nowrap;
}
.bridges-badge.has-bridges {
  background: #fff3cd;
  color: #856404;
  border-color: #ffeeba;
}
.bridges-badge.is-disabled {
  opacity: 0.65;
  background: #f1f5f9;
  color: #94a3b8;
}
.design-hint-text {
  font-size: 0.76rem;
  color: #7f8c8d;
}

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

.level-sidebar {
  position: absolute;
  left: 10px;
  top: 10px;
  width: 168px;
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 6px 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
  z-index: 5;
}
.level-title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}
.level-num {
  font-weight: bold;
  font-size: 0.8rem;
  color: #2c3e50;
}
.level-actions {
  display: flex;
  gap: 3px;
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
  gap: 3px;
  font-size: 0.7rem;
  color: #475569;
}
.flp-h-label {
  font-weight: 600;
}
.flp-h-input {
  width: 44px;
  padding: 1px 2px;
  font-size: 0.7rem;
  border: 1px solid #cbd5e1;
  border-radius: 3px;
  text-align: center;
}
.flp-h-step {
  background: #f1f5f9;
  color: #334155;
  border: 1px solid #cbd5e1;
  border-radius: 3px;
  padding: 0 4px;
  font-size: 0.72rem;
  font-weight: bold;
  cursor: pointer;
  line-height: 1.2;
}
.flp-h-step:hover {
  background: #e2e8f0;
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

.lvl-btn {
  background: #ecf0f1;
  border: 1px solid #bdc3c7;
  border-radius: 3px;
  padding: 1px 4px;
  font-size: 0.68rem;
  cursor: pointer;
  line-height: 1.1;
}
.lvl-btn:hover {
  background: #d5dbdb;
}
.lvl-btn-del:hover {
  background: #fadbd8;
  border-color: #e74c3c;
}

/* Höhensteuerung pro Ebene */
.level-height-control {
  display: flex;
  align-items: center;
  gap: 3px;
  margin-bottom: 5px;
  font-size: 0.7rem;
  color: #475569;
}
.lvl-h-label {
  font-weight: 600;
}
.lvl-h-input {
  width: 48px;
  padding: 1px 3px;
  font-size: 0.7rem;
  border: 1px solid #cbd5e1;
  border-radius: 3px;
  text-align: center;
}
.lvl-h-step {
  background: #f1f5f9;
  color: #334155;
  border: 1px solid #cbd5e1;
  border-radius: 3px;
  padding: 0 5px;
  font-size: 0.72rem;
  font-weight: bold;
  cursor: pointer;
  line-height: 1.2;
}
.lvl-h-step:hover {
  background: #e2e8f0;
}

.level-gen-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.level-gen-pill {
  background: #3498db;
  color: white;
  font-size: 0.68rem;
  font-weight: bold;
  padding: 1px 5px;
  border-radius: 3px;
}
.level-band.is-multi-gen .level-gen-pill {
  background: #d35400;
}
.level-empty-hint {
  font-size: 0.7rem;
  color: #95a5a6;
  font-style: italic;
}
.origin-level-tag {
  margin-top: 4px;
  font-size: 0.68rem;
  font-weight: bold;
  color: #16a085;
}

.level-resize-handle {
  position: absolute;
  left: 0;
  right: 0;
  bottom: -3px;
  height: 6px;
  cursor: ns-resize;
  z-index: 6;
}
.level-resize-handle:hover {
  background: rgba(52, 152, 219, 0.35);
}

/* Zweig-Breite & Korridor-Abgrenzung */
.branch-corridor-zone {
  position: absolute;
  background: rgba(142, 68, 173, 0.055);
  border-left: 2px dashed rgba(142, 68, 173, 0.65);
  border-right: 2px dashed rgba(142, 68, 173, 0.65);
  pointer-events: none;
  z-index: 3;
  box-sizing: border-box;
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

/* SVG Kanten & Linienbrücken - Personeneinträge liegen stets über Verbindungslinien */
.design-edges-svg {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  z-index: 5;
  overflow: visible;
}
.design-edge-line {
  fill: none;
  stroke: #1e293b;
  stroke-width: 2px;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.design-edge-line.is-highlighted {
  stroke: #e67e22;
  stroke-width: 3.2px;
}
.design-edge-arrow {
  fill: #1e293b;
}
.design-edge-arrow.is-highlighted {
  fill: #e67e22;
}

/* Geschwistergruppen-Container: stärkere Gruppierungsumrandung direkt um die aneinanderstoßenden Kästchen */
.sibling-group-container {
  position: absolute;
  background: white;
  border: 2px solid #1e293b;
  box-sizing: border-box;
  cursor: move;
  z-index: 10;
  transition: box-shadow 0.12s;
}
.sibling-group-container.is-multi-sibling-group {
  border: 3px solid #0f172a;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.18);
}
.sibling-group-container.is-origin-group {
  border: 3px solid #0e6251;
}
.sibling-group-container.is-docked {
  box-shadow: 0 0 0 1.5px #27ae60, 0 3px 8px rgba(39, 174, 96, 0.22);
}
.sibling-group-container:hover {
  z-index: 25;
}
.sibling-group-container.is-dragging {
  z-index: 40;
  border: 3.5px solid #e67e22 !important;
  box-shadow: 0 8px 22px rgba(230, 126, 34, 0.35) !important;
}

/* Schwebende Steuerleiste der Gruppe (erscheint dynamisch bei selektiertem Eintrag) */
.group-floating-controls {
  position: absolute;
  bottom: -24px;
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

/* Geschwisterkästchen-Reihe ohne Zwischenraum (Rahmenlinien stoßen direkt aneinander an) */
.sibling-cards-row {
  display: flex;
  align-items: stretch;
  gap: 0;
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
}

/* Subgruppen-Block für Geschwistergruppen innerhalb eines größeren Gruppenverbandes */
.sibling-subgroup-block {
  display: flex;
  align-items: stretch;
  gap: 0;
  margin: 0;
  padding: 0;
  height: 100%;
  box-sizing: border-box;
}

/* Geschwistergruppen innerhalb eines größeren Gruppenverbandes sind über stärkere Rahmenlinien gekennzeichnet (gleiche Breite auf allen 4 Seiten) */
.sibling-subgroup-block.in-larger-union {
  border: 3px solid #0f172a;
  box-sizing: border-box;
  position: relative;
  z-index: 2;
}
.sibling-subgroup-block.in-larger-union + .sibling-subgroup-block.in-larger-union {
  margin-left: -3px;
}
.sibling-subgroup-block.in-larger-union.is-multi-sibling {
  box-shadow: inset 0 0 0 1px #1e293b;
}

/* Personen-Boxen */
.design-person-card {
  position: relative;
  background: white;
  border-right: 1.5px solid #334155;
  padding: 6px 7px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  cursor: grab;
}
.design-person-card:last-child {
  border-right: none;
}
.design-person-card:active {
  cursor: grabbing;
}
.design-person-card.male {
  border-bottom: 3px solid #2980b9;
}
.design-person-card.female {
  border-bottom: 3px solid #e84393;
}
.design-person-card.selected {
  background: #fffde7 !important;
  box-shadow: inset 0 0 0 2px #f39c12;
}
.design-person-card.has-branch-width {
  box-shadow: inset 0 0 0 2px #8e44ad;
}
.design-person-card.in-partner-path {
  background: #fef5e7;
}

/* Button auf dem Eintrag zum Festlegen / Ziehen der Zweig-Breite */
.branch-width-card-btn {
  position: absolute;
  top: -16px;
  left: 6px;
  width: 22px;
  height: 15px;
  padding: 0;
  font-size: 0.62rem;
  line-height: 1;
  background: #64748b;
  color: white;
  border: 1px solid #1e293b;
  border-bottom: none;
  border-radius: 4px 4px 0 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 15;
}
.branch-width-card-btn:hover,
.branch-width-card-btn.active {
  background: #8e44ad;
}

/* Button zum Ein- und Ausklappen der Nachfahren direkt am oberen Rand des Kästchens */
.descendant-toggle-btn {
  position: absolute;
  top: -16px;
  right: 6px;
  width: 18px;
  height: 15px;
  padding: 0;
  font-size: 0.58rem;
  line-height: 1;
  background: #34495e;
  color: white;
  border: 1px solid #1e293b;
  border-bottom: none;
  border-radius: 4px 4px 0 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 15;
}
.descendant-toggle-btn:hover {
  background: #2980b9;
}
.descendant-toggle-btn.is-expanded {
  background: #64748b;
}

.d-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 3px;
}
.d-henry-badge {
  background: #34495e;
  color: white;
  font-size: 0.65rem;
  font-weight: bold;
  padding: 1px 4px;
  border-radius: 3px;
}
.d-gen-badge {
  font-size: 0.65rem;
  color: #64748b;
  font-weight: bold;
}
.d-card-mini-btns {
  display: flex;
  gap: 1px;
  margin-left: auto;
}
.d-mini-btn {
  background: #f1f5f9;
  color: #475569;
  border: 1px solid #cbd5e1;
  border-radius: 2px;
  padding: 0 3px;
  font-size: 0.58rem;
  line-height: 1.2;
  cursor: pointer;
}
.d-mini-btn:hover:not(:disabled) {
  background: #3498db;
  color: white;
  border-color: #2980b9;
}
.d-mini-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.d-mini-btn.d-mini-ungroup {
  background: #fff8e1;
  color: #b7791f;
  border-color: #fbd38d;
}
.d-mini-btn.d-mini-ungroup:hover:not(:disabled) {
  background: #e67e22;
  color: white;
  border-color: #d35400;
}
.d-mini-btn.d-mini-detach {
  background: #ebf8ff;
  color: #2b6cb0;
  border-color: #bee3f8;
}
.d-mini-btn.d-mini-detach:hover:not(:disabled) {
  background: #3182ce;
  color: white;
  border-color: #2b6cb0;
}

.d-mini-btn.d-mini-regroup {
  background: #eafaf1;
  color: #1e8449;
  border-color: #a3e4d7;
  font-weight: bold;
}
.d-mini-btn.d-mini-regroup:hover:not(:disabled) {
  background: #27ae60;
  color: white;
  border-color: #1e8449;
}

.floating-row-group-btn {
  position: absolute;
  left: 12px;
  bottom: 8px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #ffffff;
  color: #27ae60;
  border: 1.5px solid #27ae60;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.82rem;
  cursor: pointer;
  z-index: 15;
  transition: transform 0.15s, background 0.15s, box-shadow 0.15s;
}
.floating-row-group-btn:hover:not(:disabled) {
  background: #27ae60;
  color: white;
  transform: scale(1.12);
  box-shadow: 0 3px 10px rgba(39, 174, 96, 0.35);
}
.floating-row-group-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  border-color: #94a3b8;
  color: #94a3b8;
}

.lvl-btn-group-row {
  background: #eafaf1;
  color: #27ae60;
  border-color: #a3e4d7;
}
.lvl-btn-group-row:hover:not(:disabled) {
  background: #27ae60;
  color: white;
  border-color: #1e8449;
}
.btn-detach-person {
  background: #ebf8ff;
  color: #2b6cb0;
  border-color: #bee3f8;
}
.btn-detach-person:hover {
  background: #3182ce;
  color: white;
}

.d-card-name {
  font-size: 0.78rem;
  color: #1e293b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: center;
}
.d-card-dates {
  font-size: 0.66rem;
  color: #64748b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: center;
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

/* ----------------------------------------------------
   Overlay: Speichern & Laden Buttons (unten rechts)
   ---------------------------------------------------- */
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

/* Zurück / Undo Button: Kreis mit "Zurück" Icon */
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

/* Laden Button: etwas kleinerer Kreis mit "Open File" Icon */
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

/* Speichern Button: etwas größerer Kreis mit "Diskette" Icon */
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

/* ----------------------------------------------------
   Modals für Speichern und Laden
   ---------------------------------------------------- */
.design-modal-backdrop {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(15, 23, 42, 0.6);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 20px;
  box-sizing: border-box;
}

.design-modal-window {
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.25);
  width: 100%;
  max-width: 480px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #cbd5e1;
  animation: modalPopIn 0.18s ease-out;
}
.design-modal-window.load-modal-window {
  max-width: 580px;
}

@keyframes modalPopIn {
  from {
    opacity: 0;
    transform: scale(0.95) translateY(8px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.design-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 18px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}
.design-modal-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.design-modal-title h3 {
  margin: 0;
  font-size: 1.05rem;
  color: #1e293b;
  font-weight: 700;
}
.design-modal-icon {
  font-size: 1.25rem;
}
.design-modal-close-btn {
  background: transparent;
  border: none;
  font-size: 1.1rem;
  color: #64748b;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
}
.design-modal-close-btn:hover {
  background: #e2e8f0;
  color: #0f172a;
}

.design-modal-body {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  max-height: 70vh;
}

.design-modal-proband-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  color: #166534;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 0.85rem;
}
.proband-label {
  color: #15803d;
  font-size: 0.8rem;
}

.save-mode-selector {
  display: flex;
  gap: 16px;
  background: #f8fafc;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
}
.save-mode-radio {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85rem;
  font-weight: 600;
  color: #334155;
  cursor: pointer;
}
.save-mode-radio input[type="radio"] {
  cursor: pointer;
}
.design-modal-select {
  width: 100%;
  padding: 8px 12px;
  border: 1.5px solid #cbd5e1;
  border-radius: 6px;
  font-size: 0.88rem;
  background: #ffffff;
  color: #1e293b;
  outline: none;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.design-modal-select:focus {
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
}
.warn-text {
  color: #b45309 !important;
  font-weight: 600;
}
.btn-overwrite {
  background: #d97706 !important;
  border-color: #b45309 !important;
}
.btn-overwrite:hover:not(:disabled) {
  background: #b45309 !important;
}

.design-form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.design-form-label {
  font-size: 0.85rem;
  font-weight: 600;
  color: #334155;
}
.design-modal-input {
  width: 100%;
  padding: 8px 12px;
  border: 1.5px solid #cbd5e1;
  border-radius: 6px;
  font-size: 0.9rem;
  box-sizing: border-box;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.design-modal-input:focus {
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
}
.design-input-hint {
  font-size: 0.75rem;
  color: #64748b;
}

.design-summary-box {
  display: flex;
  align-items: center;
  justify-content: space-around;
  background: #f1f5f9;
  border-radius: 8px;
  padding: 10px;
  gap: 8px;
}
.summary-item {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.summary-item .s-label {
  font-size: 0.72rem;
  color: #64748b;
}
.summary-item .s-val {
  font-size: 1.05rem;
  font-weight: bold;
  color: #1e293b;
}

.design-modal-feedback {
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 0.82rem;
  font-weight: 600;
}
.design-modal-feedback.success {
  background: #dcfce7;
  color: #15803d;
  border: 1px solid #86efac;
}

.design-modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  background: #f8fafc;
  border-top: 1px solid #e2e8f0;
}

.d-modal-btn {
  padding: 7px 14px;
  border-radius: 6px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 0.15s, border-color 0.15s, transform 0.12s;
}
.d-modal-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.d-modal-btn-primary {
  background: #2563eb;
  color: white;
}
.d-modal-btn-primary:hover:not(:disabled) {
  background: #1d4ed8;
}

.d-modal-btn-secondary {
  background: #f1f5f9;
  color: #1e293b;
  border-color: #cbd5e1;
}
.d-modal-btn-secondary:hover:not(:disabled) {
  background: #e2e8f0;
  border-color: #94a3b8;
}

.d-modal-btn-cancel {
  background: #ffffff;
  color: #64748b;
  border-color: #cbd5e1;
}
.d-modal-btn-cancel:hover {
  background: #f1f5f9;
  color: #1e293b;
}

/* Presets List in Load Modal */
.design-presets-container {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #fafafa;
  padding: 4px;
}
.design-presets-loading,
.design-empty-presets {
  padding: 20px;
  text-align: center;
  color: #64748b;
  font-size: 0.85rem;
}
.design-presets-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.design-preset-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  transition: border-color 0.12s, box-shadow 0.12s;
}
.design-preset-row:hover {
  border-color: #3b82f6;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
}
.preset-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.preset-name {
  font-size: 0.88rem;
  font-weight: 700;
  color: #1e293b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.preset-meta {
  font-size: 0.72rem;
  color: #64748b;
}
.preset-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.d-preset-btn {
  padding: 4px 8px;
  font-size: 0.75rem;
  font-weight: 600;
  border-radius: 4px;
  cursor: pointer;
  border: 1px solid transparent;
}
.d-preset-btn.btn-apply {
  background: #2563eb;
  color: white;
}
.d-preset-btn.btn-apply:hover {
  background: #1d4ed8;
}
.d-preset-btn.btn-export {
  background: #f1f5f9;
  color: #334155;
  border-color: #cbd5e1;
}
.d-preset-btn.btn-export:hover {
  background: #e2e8f0;
}
.d-preset-btn.btn-delete {
  background: #fff1f2;
  color: #e11d48;
  border-color: #fecdd3;
}
.d-preset-btn.btn-delete:hover {
  background: #ffe4e6;
}

/* External File Box */
.design-external-file-box {
  background: #f8fafc;
  border: 1.5px dashed #cbd5e1;
  border-radius: 8px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
}
.ext-file-title {
  font-size: 0.85rem;
  color: #1e293b;
}
.ext-file-desc {
  margin: 0;
  font-size: 0.76rem;
  color: #64748b;
}
.d-modal-btn-open-file {
  background: #10b981;
  color: white;
  margin-top: 4px;
}
.d-modal-btn-open-file:hover {
  background: #059669;
}
</style>
