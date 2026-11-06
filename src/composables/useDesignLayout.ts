import { ref, computed, nextTick, type Ref, type ComputedRef } from 'vue';
import {
  computePersonCardNeededHeight,
  formatLocalizedDate,
  type DesignCardConfig,
  type SubLayoutReference,
  type SubtreeBackground,
} from '../types/design';
import type {
  DesignSiblingGroup,
  BranchWidthConstraint,
  DesignPersistedState,
} from './useDesignHistory';

export interface ProbandData {
  henry_code: string;
  generation: number;
}

export interface SpouseConnection {
  id: string;
  date: string | null;
  place: string | null;
  divorce_date: string | null;
  is_divorced: boolean;
}

export interface DesignPerson {
  id: string;
  given_name: string | null;
  surname: string | null;
  sex: string | null;
  birth_date: string | null;
  birth_place: string | null;
  death_date: string | null;
  death_place: string | null;
  father_id?: string | null;
  mother_id?: string | null;
  proband_data: Record<string, ProbandData>;
  gedcom_extra: Record<string, any>;
  spouses: SpouseConnection[];
  parent_ids: string[];
}

export interface RootAncestorConfig {
  person_id: string;
  starting_code: string;
  given_name: string | null;
  surname: string | null;
}

export interface SiblingBarItem {
  parentId?: string;
  parentX?: number;
  minChildX: number;
  maxChildX: number;
  childrenX?: number[];
  pBox?: { centerX: number; level?: number };
  cBoxes?: { centerX: number }[];
  direction?: 'up' | 'same' | 'down';
}

export interface LevelMetrics {
  heights: Record<number, number>;
  bandTopY: Record<number, number>;
  cardTopY: Record<number, number>;
  levelMaxCardBottom: Record<number, number>;
  maxCardHeights: Record<number, number>;
  requiredLanes: Record<number, number>;
  totalCanvasHeight: number;
}

export interface LevelBandInfo {
  level: number;
  bandTopY: number;
  height: number;
  generations: number[];
  groupCount: number;
}

export interface CardBox {
  person: DesignPerson;
  groupId: string;
  level: number;
  generation: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  height: number;
  centerX: number;
  centerY: number;
  isReadOnly?: boolean;
  subtreeAnchorId?: string;
  subtreeLayoutName?: string;
  isSubtreeAnchor?: boolean;
  linkedSubLayoutName?: string;
  linkedSubLayoutId?: string;
}

export interface SiblingSubGroup {
  id: string;
  parentId: string | null;
  parentPerson: DesignPerson | null;
  cards: CardBox[];
  isMultiSibling: boolean;
  surname: string;
}

export interface GroupLayoutInfo {
  group: DesignSiblingGroup;
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
  parentPerson: DesignPerson | null;
  cards: CardBox[];
  siblingSubGroups: SiblingSubGroup[];
  canRegroup: boolean;
  isDocked: boolean;
  isReadOnly?: boolean;
  subtreeAnchorId?: string;
  subtreeLayoutName?: string;
  subtreeLayoutId?: string;
}

export interface SpouseDateItem {
  key: string;
  text: string;
  isDivorce?: boolean;
  isMarriage?: boolean;
}

export interface RenderedCardSpouse {
  id: string;
  name: string;
  henry: string | null;
  isDivorced: boolean;
  divorceDate: string | null;
  dateItems: SpouseDateItem[];
}

export interface RenderedCardData {
  henryCode: string | null;
  firstName: string;
  fullName: string;
  birthText: string;
  chrText: string;
  deathText: string;
  hasLine3: boolean;
  hasMarriage: boolean;
  spouses: RenderedCardSpouse[];
}

export interface RenderedBranchWidth {
  personId: string;
  personName: string;
  level: number;
  minX: number;
  maxX: number;
  width: number;
  barY: number;
  corridorTopY: number;
  corridorHeight: number;
  zIndex: number;
  barZIndex: number;
  isNested: boolean;
}

export interface LineSegment {
  id: string;
  edgeKey: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  isHighlighted: boolean;
}

export interface ArrowHead {
  x: number;
  y: number;
  direction: 'up' | 'down';
  isHighlighted: boolean;
}

export interface AnchorPoint {
  x: number;
  y: number;
  d: string;
  isHighlighted: boolean;
}

export interface EdgeGeometry {
  normalPaths: string[];
  highlightedPaths: string[];
  arrows: ArrowHead[];
  anchors: AnchorPoint[];
  totalBridgesCount: number;
}

export interface DraggingClusterMember {
  group: DesignSiblingGroup;
  startX: number;
  startLevel: number;
  width: number;
}

// Geometrie-Konstanten: Geschwisterkästchen stoßen direkt aneinander (CARD_GAP = 0, kein Innenabstand)
export const CARD_WIDTH = 174;
export const DEFAULT_LEVEL_HEIGHT = 200;
export const MIN_LEVEL_HEIGHT = 110;
export const LEVEL_SIDEBAR_W = 210;
export const CANVAS_PAD_TOP = 65;
export const CANVAS_PAD_BOTTOM = 65;
export const SNAP_DISTANCE = 16;
export const LEVEL_CARD_PAD_TOP = 26; // Platz oberhalb der Kacheln für den Nachnamens-Header (subgroup-surname-label)
export const CORRIDOR_PAD_TOP = 24; // Sicherer Mindestabstand unterhalb der untersten Kachelkante der Ebene bis zur obersten Querlinie
export const CORRIDOR_PAD_BOTTOM = 28; // Sicherer Mindestabstand von der untersten Querlinie bis zur Kacheloberkante/Nachnamenslabel der darunterliegenden Ebene
export const CORRIDOR_EMPTY = 36; // Mindestabstand zwischen Ebenen, wenn keine Querlinien vorhanden sind

export interface UseDesignLayoutOptions {
  t: (key: string, named?: Record<string, unknown>) => string;
  locale: Ref<string>;
  siblingGroups: Ref<DesignSiblingGroup[]>;
  totalLevels: Ref<number>;
  levelHeights: Ref<Record<number, number>>;
  expandedParentIds: Ref<Set<string>>;
  activeDesignPersonId: Ref<string>;
  branchWidths: Ref<Map<string, BranchWidthConstraint>>;
  zoom: Ref<number>;
  activeCardConfig: ComputedRef<DesignCardConfig>;
  personById: ComputedRef<Map<string, DesignPerson>>;
  subLayoutReferences?: Ref<Record<string, SubLayoutReference>>;
  subLayoutCache?: Ref<Map<string, DesignPersistedState>>;
  getProps: () => {
    persons: DesignPerson[];
    rootAncestors: RootAncestorConfig[];
    activeProbandId: string | null;
    selectedId: string;
    highlightedPathIds?: Set<string>;
    horizontalLaneGap?: number;
    autoSubLanes?: boolean;
    enableLineBridges?: boolean;
    bridgeRadius?: number;
    minimizeBridges?: boolean;
  };
  pushHistoryState: () => void;
  beginDragSnapshot: () => void;
  commitDragSnapshot: (didMove: boolean) => void;
  centerOnOrigin: () => void;
  onSelectPerson: (person: DesignPerson | null) => void;
}

export function useDesignLayout(options: UseDesignLayoutOptions) {
  const {
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
    getProps,
    pushHistoryState,
    beginDragSnapshot,
    commitDragSnapshot,
    centerOnOrigin,
    onSelectPerson,
  } = options;

  // Drag-State für Geschwistergruppen / Einzeleinträge & gemeinsam verschiebbare gedockte Cluster
  const draggingGroupId = ref<string | null>(null);
  const draggingCluster = ref<DraggingClusterMember[]>([]);
  const draggingClusterGroupIds = computed(() => new Set(draggingCluster.value.map(m => m.group.id)));
  const dragHoverInsertAboveLevel = ref<number | null>(null);
  const activeSnapGuideX = ref<number | null>(null);
  let groupDragStartMouse = { x: 0, y: 0 };
  let groupDragStartPos = { x: 0, level: 1 };
  let didMoveGroup = false;

  const selectedDesignPerson = computed<DesignPerson | null>(() => {
    const id = activeDesignPersonId.value || getProps().selectedId;
    if (!id) return null;
    return personById.value.get(id) || null;
  });

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

  function comparePersonsByBirth(a: DesignPerson, b: DesignPerson): number {
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
    const found = getProps().rootAncestors.find(r => r.person_id === pid);
    return found ? found.starting_code : '1';
  }

  /**
   * Ermittelt den maßgeblichen Elterneintrag im Baum für eine Person.
   * Bei Implex-Fällen (beide Elternteile sind im Baum enthalten) wird strikt eine
   * patrilineare Darstellung verfolgt (Vater hat Vorrang vor Mutter).
   */
  function resolvePatrilinearParentId(
    person: DesignPerson | undefined,
    activeTreeIds: { has(id: string): boolean },
    henryParentId?: string | null
  ): string | null {
    if (!person) return henryParentId && activeTreeIds.has(henryParentId) ? henryParentId : null;

    // 1. Explizite Vater-ID prüfen (patrilinearer Vorrang bei Implex)
    if (person.father_id && activeTreeIds.has(person.father_id)) {
      return person.father_id;
    }

    // 2. Männlichen Elternteil in parent_ids prüfen
    const parentIds = person.parent_ids || [];
    for (const pid of parentIds) {
      if (activeTreeIds.has(pid)) {
        const pObj = personById.value.get(pid);
        if (pObj?.sex === 'M') {
          return pid;
        }
      }
    }

    // 3. Falls Henry-Elternteil männlich und im Baum aktiv ist
    if (henryParentId && activeTreeIds.has(henryParentId)) {
      const hObj = personById.value.get(henryParentId);
      if (hObj?.sex === 'M') {
        return henryParentId;
      }
    }

    // 4. Fallback auf Henry-Elternteil (z. B. Mutter ist Nachkommin eines externen Ehemanns)
    if (henryParentId && activeTreeIds.has(henryParentId)) {
      return henryParentId;
    }

    // 5. Fallback auf Mutter oder sonstigen im Baum vorhandenen Elternteil
    if (person.mother_id && activeTreeIds.has(person.mother_id)) {
      return person.mother_id;
    }
    for (const pid of parentIds) {
      if (activeTreeIds.has(pid)) {
        return pid;
      }
    }

    return null;
  }

  const childrenMapByParentId = computed<Map<string, string[]>>(() => {
    const { activeProbandId: pid, persons } = getProps();
    if (!pid) return new Map();
    const rootPerson = personById.value.get(pid);
    if (!rootPerson) return new Map();

    const startCode = getActiveStartCode(pid);
    const pList = persons.filter(p => p.proband_data && p.proband_data[pid]);
    const activeTreeSet = new Set<string>(pList.map(p => p.id));

    const childrenByParentId = new Map<string, DesignPerson[]>();
    const personByHenry = new Map<string, DesignPerson>();
    pList.forEach(p => {
      const code = p.proband_data[pid]?.henry_code;
      if (code) personByHenry.set(code, p);
    });

    pList.forEach(p => {
      if (p.id === pid) return;
      const code = p.proband_data[pid]?.henry_code;
      if (!code || code === startCode) return;
      const parentCode = getParentHenryCode(code, startCode);
      const henryParent = parentCode ? personByHenry.get(parentCode) : undefined;
      const resolvedParentId = resolvePatrilinearParentId(p, activeTreeSet, henryParent?.id ?? null);

      if (resolvedParentId && resolvedParentId !== p.id) {
        if (!childrenByParentId.has(resolvedParentId)) {
          childrenByParentId.set(resolvedParentId, []);
        }
        childrenByParentId.get(resolvedParentId)!.push(p);
      }
    });

    childrenByParentId.forEach(list => list.sort(comparePersonsByBirth));

    const cIdMap = new Map<string, string[]>();
    childrenByParentId.forEach((list, parentId) => {
      if (list.length > 0) {
        cIdMap.set(parentId, list.map(c => c.id));
      }
    });
    return cIdMap;
  });

  const parentIdByChildIdMap = computed<Map<string, string>>(() => {
    const map = new Map<string, string>();
    childrenMapByParentId.value.forEach((kids, parId) => {
      kids.forEach(kId => map.set(kId, parId));
    });
    return map;
  });

  function getBiologicalParentId(personId: string): string | null {
    const mapped = parentIdByChildIdMap.value.get(personId);
    if (mapped) return mapped;
    const p = personById.value.get(personId);
    return resolvePatrilinearParentId(p, personById.value, null);
  }

  function getBaptismInfo(person: DesignPerson): { date: string | null; place: string | null } {
    const extra = person.gedcom_extra;
    if (!extra || typeof extra !== 'object') return { date: null, place: null };
    const chr = extra['CHR'];
    if (!chr) return { date: null, place: null };
    if (typeof chr === 'object') {
      return {
        date: chr['DATE'] ? String(chr['DATE']) : null,
        place: chr['PLAC'] ? String(chr['PLAC']) : null,
      };
    }
    return { date: null, place: null };
  }

  // Sichtbare Gruppen & sichtbare Personen unter Berücksichtigung von:
  // 1. Expand/Collapse-Status (Stammahn bleibt immer aktiv)
  // 2. Isolierung der Stammeinträge (Zweiganker) aus Geschwistergruppen
  // 3. Dynamisches Einbetten der verknüpften Zweige mit Verdrängung links/rechts nach außen
  const visibleGroupAndMemberMap = computed<{
    groups: DesignSiblingGroup[];
    visibleMembersByGroupId: Map<string, string[]>;
  }>(() => {
    const visiblePersons = new Set<string>();
    const initialResultGroups: DesignSiblingGroup[] = [];
    const membersMap = new Map<string, string[]>();

    const subRefs = options.subLayoutReferences?.value || {};
    const subCache = options.subLayoutCache?.value || new Map();

    // Ermittle alle Personen, die von einem verknüpften Subtree verwaltet werden (außer dem Anker selbst)
    const subtreeManagedMemberIds = new Set<string>();
    for (const [anchorId, sRef] of Object.entries(subRefs)) {
      const subState = subCache.get(sRef.layoutId);
      if (subState && subState.siblingGroups) {
        subState.siblingGroups.forEach((sg: DesignSiblingGroup) => {
          sg.memberIds.forEach((mId: string) => {
            if (mId !== anchorId) {
              subtreeManagedMemberIds.add(mId);
            }
          });
        });
      }
    }

    // 1. Ursprung (parentId === null) ist immer aktiv
    siblingGroups.value.forEach(g => {
      if (g.parentId === null) {
        initialResultGroups.push(g);
        membersMap.set(g.id, [...g.memberIds]);
        g.memberIds.forEach(id => visiblePersons.add(id));
      }
    });

    let added = true;
    const includedGroupIds = new Set<string>(initialResultGroups.map(g => g.id));

    while (added) {
      added = false;
      for (const g of siblingGroups.value) {
        if (includedGroupIds.has(g.id)) continue;
        // Gruppen, deren Mitglieder vollständig über ein verknüpftes Zweig-Design abgebildet werden, im Master überspringen
        if (g.memberIds.length > 0 && g.memberIds.every(id => subtreeManagedMemberIds.has(id))) {
          continue;
        }
        if (
          g.parentId &&
          visiblePersons.has(g.parentId) &&
          expandedParentIds.value.has(g.parentId)
        ) {
          includedGroupIds.add(g.id);
          initialResultGroups.push(g);
          membersMap.set(g.id, [...g.memberIds]);
          g.memberIds.forEach(id => visiblePersons.add(id));
          added = true;
        }
      }
    }

    // 2. Isoliere alle Stammeinträge, zu denen ein Zweig definiert ist, aus ihren Geschwistergruppen heraus
    const masterGroups: DesignSiblingGroup[] = [];
    for (const g of initialResultGroups) {
      const containedAnchors = g.memberIds.filter(id => subRefs[id]);
      if (containedAnchors.length === 0 || g.memberIds.length <= 1) {
        masterGroups.push({ ...g, memberIds: [...g.memberIds] });
      } else {
        // Gruppe enthält mindestens einen Zweig-Anker und weitere Geschwister -> Aufteilen!
        const members = [...g.memberIds];
        const origTotalW = getGroupWidth(members.length);
        const origLeft = Math.round(g.x - origTotalW / 2);
        const GAP = 28;

        let curLeft = origLeft;
        let currentNonAnchorChunk: string[] = [];

        const flushNonAnchorChunk = () => {
          if (currentNonAnchorChunk.length === 0) return;
          const chunkW = getGroupWidth(currentNonAnchorChunk.length);
          const chunkX = Math.round(curLeft + chunkW / 2);
          const chunkId = `sg-split-${g.id}-${currentNonAnchorChunk[0]}`;
          masterGroups.push({
            id: chunkId,
            parentId: g.parentId,
            generation: g.generation,
            level: g.level,
            x: chunkX,
            memberIds: [...currentNonAnchorChunk],
            isUngrouped: currentNonAnchorChunk.length === 1,
          });
          membersMap.set(chunkId, [...currentNonAnchorChunk]);
          curLeft += chunkW + GAP;
          currentNonAnchorChunk = [];
        };

        for (let i = 0; i < members.length; i++) {
          const mId = members[i];
          if (subRefs[mId]) {
            flushNonAnchorChunk();
            const anchorW = CARD_WIDTH;
            const anchorX = Math.round(curLeft + anchorW / 2);
            const anchorGroupId = `sg-anchor-${mId}`;
            masterGroups.push({
              id: anchorGroupId,
              parentId: g.parentId,
              generation: g.generation,
              level: g.level,
              x: anchorX,
              memberIds: [mId],
              isUngrouped: true,
            });
            membersMap.set(anchorGroupId, [mId]);
            curLeft += anchorW + GAP;
          } else {
            currentNonAnchorChunk.push(mId);
          }
        }
        flushNonAnchorChunk();
        membersMap.delete(g.id);
      }
    }

    // 3. Dynamisches Einbetten der Gruppen aus verknüpften Zweigen & Auswärtsschub links/rechts
    const embeddedGroupsAll: DesignSiblingGroup[] = [];

    for (const [anchorId, sRef] of Object.entries(subRefs)) {
      if (!visiblePersons.has(anchorId) || !expandedParentIds.value.has(anchorId)) {
        continue;
      }
      const subState = subCache.get(sRef.layoutId);
      if (!subState || !subState.siblingGroups || subState.siblingGroups.length === 0) {
        continue;
      }

      // Anker-Gruppe in masterGroups finden
      const anchorGroup = masterGroups.find(g => g.memberIds.includes(anchorId));
      if (!anchorGroup) continue;

      // Wurzelgruppe im Zweig-Design ermitteln (Level 1 oder parentId === null)
      const subRootGroup = subState.siblingGroups.find((g: DesignSiblingGroup) => g.level === 1 || g.parentId === null);
      const subRootX = subRootGroup ? subRootGroup.x : 720;
      const subRootLevel = subRootGroup ? subRootGroup.level : 1;

      // X-Zentrum der Anker-Person
      const anchorCardCenterX = anchorGroup.x;
      const deltaX = anchorCardCenterX - subRootX;
      const levelOffset = anchorGroup.level - subRootLevel;

      const currentSubtreeGroups: DesignSiblingGroup[] = [];
      subState.siblingGroups.forEach((sg: DesignSiblingGroup) => {
        // Wurzelgruppe überspringen, wenn sie ausschließlich den Anker enthält (wurde bereits im Master gerendert)
        if ((sg.level === subRootLevel || sg.parentId === null) && sg.memberIds.includes(anchorId)) {
          return;
        }

        const mappedLevel = sg.level + levelOffset;
        const mappedX = Math.round(sg.x + deltaX);
        const embeddedGroupId = `subtree-${sRef.layoutId}-${sg.id}`;

        const embeddedGroup: DesignSiblingGroup = {
          ...sg,
          id: embeddedGroupId,
          level: mappedLevel,
          x: mappedX,
          isReadOnly: true,
          subtreeAnchorId: anchorId,
          subtreeLayoutName: sRef.layoutName,
          subtreeLayoutId: sRef.layoutId,
        };

        currentSubtreeGroups.push(embeddedGroup);
        membersMap.set(embeddedGroupId, [...sg.memberIds]);
        sg.memberIds.forEach((id: string) => visiblePersons.add(id));
      });

      if (currentSubtreeGroups.length === 0) {
        continue;
      }

      // 4. Korridor-Berechnung & Verschiebung der links und rechts liegenden Einträge nach außen
      const GAP = 28;
      const subBoundsByLevel = new Map<number, { minLeft: number; maxRight: number }>();
      let overallSubMinLeft = Infinity;
      let overallSubMaxRight = -Infinity;

      currentSubtreeGroups.forEach(eg => {
        const w = getGroupWidth(eg.memberIds.length);
        const l = eg.x - w / 2;
        const r = eg.x + w / 2;
        if (l < overallSubMinLeft) overallSubMinLeft = l;
        if (r > overallSubMaxRight) overallSubMaxRight = r;

        const cur = subBoundsByLevel.get(eg.level);
        if (!cur) {
          subBoundsByLevel.set(eg.level, { minLeft: l, maxRight: r });
        } else {
          if (l < cur.minLeft) cur.minLeft = l;
          if (r > cur.maxRight) cur.maxRight = r;
        }
      });

      // Anker-Ebene berücksichtigen
      const anchorCardHalfW = CARD_WIDTH / 2;
      const anchorCorridorLeft = Math.min(anchorCardCenterX - anchorCardHalfW, overallSubMinLeft);
      const anchorCorridorRight = Math.max(anchorCardCenterX + anchorCardHalfW, overallSubMaxRight);
      subBoundsByLevel.set(anchorGroup.level, { minLeft: anchorCorridorLeft, maxRight: anchorCorridorRight });

      const minLvl = Math.min(anchorGroup.level, ...Array.from(subBoundsByLevel.keys()));
      const maxLvl = Math.max(anchorGroup.level, ...Array.from(subBoundsByLevel.keys()));

      let requiredShiftLeft = 0;
      let requiredShiftRight = 0;

      for (let lvl = minLvl; lvl <= maxLvl; lvl++) {
        const bounds = subBoundsByLevel.get(lvl) || { minLeft: overallSubMinLeft, maxRight: overallSubMaxRight };
        const targetLeftLimit = bounds.minLeft - GAP;
        const targetRightLimit = bounds.maxRight + GAP;

        const groupsOnLvl = masterGroups.filter(g => g.level === lvl && g.id !== anchorGroup.id);
        for (const g of groupsOnLvl) {
          const w = getGroupWidth(g.memberIds.length);
          const gLeft = g.x - w / 2;
          const gRight = g.x + w / 2;

          if (g.x <= anchorCardCenterX) {
            if (gRight > targetLeftLimit) {
              const overlap = gRight - targetLeftLimit;
              if (overlap > requiredShiftLeft) {
                requiredShiftLeft = overlap;
              }
            }
          } else {
            if (gLeft < targetRightLimit) {
              const overlap = targetRightLimit - gLeft;
              if (overlap > requiredShiftRight) {
                requiredShiftRight = overlap;
              }
            }
          }
        }
      }

      // Verschiebe alle links liegenden Master-Gruppen auf allen betroffenen Ebenen ab dem Anker nach links
      if (requiredShiftLeft > 0) {
        for (const g of masterGroups) {
          if (g.id !== anchorGroup.id && g.x <= anchorCardCenterX && g.level >= minLvl) {
            g.x = Math.round(g.x - requiredShiftLeft);
          }
        }
      }

      // Verschiebe alle rechts liegenden Master-Gruppen auf allen betroffenen Ebenen ab dem Anker nach rechts
      if (requiredShiftRight > 0) {
        for (const g of masterGroups) {
          if (g.id !== anchorGroup.id && g.x > anchorCardCenterX && g.level >= minLvl) {
            g.x = Math.round(g.x + requiredShiftRight);
          }
        }
      }

      embeddedGroupsAll.push(...currentSubtreeGroups);
    }

    // 5. Mindestabstand zur linken Seitenleiste für alle Gruppen sicherstellen
    const minAllowedLeft = LEVEL_SIDEBAR_W + 16;
    let minCanvasX = Infinity;
    masterGroups.forEach(g => {
      const l = g.x - getGroupWidth(g.memberIds.length) / 2;
      if (l < minCanvasX) minCanvasX = l;
    });
    embeddedGroupsAll.forEach(eg => {
      const l = eg.x - getGroupWidth(eg.memberIds.length) / 2;
      if (l < minCanvasX) minCanvasX = l;
    });

    if (minCanvasX < minAllowedLeft) {
      const globalShiftRight = Math.round(minAllowedLeft - minCanvasX);
      masterGroups.forEach(g => {
        g.x += globalShiftRight;
      });
      embeddedGroupsAll.forEach(eg => {
        eg.x += globalShiftRight;
      });
    }

    return {
      groups: [...masterGroups, ...embeddedGroupsAll],
      visibleMembersByGroupId: membersMap,
    };
  });

  const visibleSiblingGroups = computed<DesignSiblingGroup[]>(() => visibleGroupAndMemberMap.value.groups);

  // Zentraler Cache für die dynamische Kachelhöhe jeder Person
  const cardHeightByPersonId = computed<Map<string, number>>(() => {
    const map = new Map<string, number>();
    const cfg = activeCardConfig.value;
    const loc = locale.value;
    const activeProband = getProps().activeProbandId;

    const genByPersonId = new Map<string, number>();
    visibleSiblingGroups.value.forEach(g => {
      g.memberIds.forEach(id => {
        genByPersonId.set(id, g.generation);
      });
    });

    personById.value.forEach((p, pId) => {
      const chr = getBaptismInfo(p);
      const hasHenry = Boolean(p.proband_data && activeProband && p.proband_data[activeProband]?.henry_code);
      const spousesInput = (p.spouses || []).map(sp => {
        const spPerson = personById.value.get(sp.id);
        const spHenry = Boolean(spPerson?.proband_data && activeProband && spPerson.proband_data[activeProband]?.henry_code);
        return {
          id: sp.id,
          given_name: spPerson?.given_name,
          surname: spPerson?.surname,
          date: sp.date,
          divorce_date: sp.divorce_date,
          is_divorced: sp.is_divorced,
          birth_date: spPerson?.birth_date,
          birth_place: spPerson?.birth_place,
          death_date: spPerson?.death_date,
          death_place: spPerson?.death_place,
          has_henry_code: spHenry,
        };
      });

      const h = computePersonCardNeededHeight(
        {
          given_name: p.given_name,
          surname: p.surname,
          sex: p.sex,
          birth_date: p.birth_date,
          birth_place: p.birth_place,
          death_date: p.death_date,
          death_place: p.death_place,
          chr_date: chr.date,
          chr_place: chr.place,
          has_henry_code: hasHenry,
          generation: genByPersonId.get(pId),
          spouses: spousesInput,
        },
        cfg,
        loc
      );
      map.set(pId, h);
    });
    return map;
  });

  function getCardHeightForPerson(personId: string, _generation?: number): number {
    return cardHeightByPersonId.value.get(personId) || 50;
  }

  /**
   * Track Assignment für Bottom-Up-Layouts:
   * Berechnet die Track-Indizes (0 = ganz oben direkt unter den Kind-Knoten,
   * 1, 2, ... = weiter unten Richtung Eltern-Knoten) für die horizontalen Segmente
   * der orthogonalen Verbindungslinien:
   *
   * 1. Datenaufbereitung & Intervalle:
   *    Jede horizontale Verbindungslinie C hat x_start (Eltern) und x_end (Kind / Kindergruppierung)
   *    mit dem horizontalen Intervall [min(x_start, x_end) - PADDING, max(x_start, x_end) + PADDING].
   * 2. Sortierung (Längste zuerst):
   *    Absteigend nach horizontaler Spannweite abs(x_start - x_end), sodass Verbindungen, die
   *    weiter nach außen greifen, weiter unten (näher am Elternknoten) platziert werden.
   * 3. Greedy Track-Zuweisung von oben nach unten (Kollisionsprüfung):
   *    - Bedingung A (Horizontale Überlappung): Kein Intervall-Overlap innerhalb desselben Tracks T.
   *    - Bedingung B (Vertikale Kreuzungsfreiheit): Die vertikalen Zuleitungen von C (von den
   *      Kind-Knoten oben hinab zu Track T) kreuzen in den darüberliegenden Tracks (0 bis T-1)
   *      keine dort bereits platzierten horizontalen Intervalle.
   * 4. Ausgabe / Rendering:
   *    Jedem Track T wird Y = Y_Basis_unter_Kindern + CORRIDOR_PAD_TOP + T * Zeilenabstand zugewiesen.
   */
  function assignNonOverlappingLanes(
    items: SiblingBarItem[],
    direction: 'up' | 'same' | 'down' = 'up'
  ): { lanes: number[]; totalLanes: number } {
    const n = items.length;
    if (n === 0) return { lanes: [], totalLanes: 0 };
    if (n === 1) return { lanes: [0], totalLanes: 1 };

    const PADDING = 8;

    interface TrackConnection {
      origIdx: number;
      parentId?: string;
      xStart: number;
      xEnd: number;
      childrenX: number[];
      barMin: number;
      barMax: number;
      intervalMin: number;
      intervalMax: number;
      span: number;
      topFeedXs: number[];
      bottomFeedXs: number[];
    }

    // 1. Datenaufbereitung & Intervalle
    const connections: TrackConnection[] = items.map((rel, origIdx) => {
      const xStart = rel.pBox ? rel.pBox.centerX : (rel.parentX ?? 0);
      const childrenX = rel.cBoxes
        ? rel.cBoxes.map(c => c.centerX)
        : (rel.childrenX && rel.childrenX.length > 0 ? rel.childrenX : [rel.minChildX, rel.maxChildX]);
      const minChildX = childrenX.length > 0 ? Math.min(...childrenX) : rel.minChildX;
      const maxChildX = childrenX.length > 0 ? Math.max(...childrenX) : rel.maxChildX;
      const barMin = Math.min(xStart, minChildX);
      const barMax = Math.max(xStart, maxChildX);
      const xEnd = Math.abs(xStart - minChildX) >= Math.abs(xStart - maxChildX) ? minChildX : maxChildX;
      const span = Math.max(0, barMax - barMin);
      const intervalMin = barMin - PADDING;
      const intervalMax = barMax + PADDING;
      const topFeedXs = direction === 'down' ? [xStart] : childrenX;
      const bottomFeedXs = direction === 'down' ? childrenX : [xStart];

      return {
        origIdx,
        parentId: rel.parentId,
        xStart,
        xEnd,
        childrenX,
        barMin,
        barMax,
        intervalMin,
        intervalMax,
        span,
        topFeedXs,
        bottomFeedXs,
      };
    });

    // 2. Sortierung (Längste zuerst): absteigend nach horizontaler Spannweite abs(x_start - x_end)
    const sortedConnections = [...connections].sort((a, b) => {
      if (Math.abs(b.span - a.span) > 0.5) return b.span - a.span;
      if (Math.abs(a.barMin - b.barMin) > 0.5) return a.barMin - b.barMin;
      return a.origIdx - b.origIdx;
    });

    // Bedingung A: Überschneiden sich die horizontalen Intervalle zweier Verbindungen?
    function intervalsOverlap(a: TrackConnection, b: TrackConnection): boolean {
      return Math.max(a.intervalMin, b.intervalMin) <= Math.min(a.intervalMax, b.intervalMax);
    }

    // Bedingung B: Kreuzt eine vertikale Zuleitung von conn (von den Kind-Knoten oben hinab zu Track T)
    // das horizontale Intervall einer Verbindung barConn in einem darüberliegenden Track (0 bis T-1)?
    function verticalTopFeedsCrossInterval(conn: TrackConnection, barConn: TrackConnection): boolean {
      if (conn.parentId && barConn.parentId && conn.parentId === barConn.parentId) return false;
      for (const feedX of conn.topFeedXs) {
        if (feedX >= barConn.intervalMin && feedX <= barConn.intervalMax) {
          return true;
        }
      }
      return false;
    }

    function verticalBottomFeedsCrossInterval(conn: TrackConnection, barConn: TrackConnection): boolean {
      if (conn.parentId && barConn.parentId && conn.parentId === barConn.parentId) return false;
      for (const feedX of conn.bottomFeedXs) {
        if (feedX >= barConn.intervalMin && feedX <= barConn.intervalMax) {
          return true;
        }
      }
      return false;
    }

    // 3. Greedy Track-Zuweisung von oben nach unten (Track 0 = ganz oben unter den Kind-Knoten,
    //    Track 1, 2, ... = weiter unten Richtung Eltern-Knoten)
    const tracks: TrackConnection[][] = [];

    function placeIntoTracks(conn: TrackConnection, minTrackIndex: number): void {
      for (let t = minTrackIndex; t < tracks.length; t++) {
        // Prüfe Bedingung B für alle darüberliegenden Tracks (0 bis t - 1):
        // Vertikale Zuleitungen von conn dürfen in 0..t-1 kein horizontales Intervall kreuzen.
        let blockedAbove = false;
        for (let upper = 0; upper < t; upper++) {
          if (tracks[upper].some(d => verticalTopFeedsCrossInterval(conn, d))) {
            blockedAbove = true;
            break;
          }
        }
        if (blockedAbove) break;

        // Prüfe, ob eine Platzierung von conn in Track t vertikale Zuleitungen bereits weiter unten
        // liegender Verbindungen (Tracks t+1..) kreuzen würde, die nicht selbst unter conn gehören.
        let blocksLowerFeeds = false;
        for (let lower = t + 1; lower < tracks.length; lower++) {
          if (tracks[lower].some(e => verticalTopFeedsCrossInterval(e, conn))) {
            blocksLowerFeeds = true;
            break;
          }
        }

        const overlappingInTrack = tracks[t].filter(d => intervalsOverlap(conn, d));

        // Fall 1: Bedingung A (keine horizontale Überlappung in Track t) & Bedingung B erfüllt
        if (overlappingInTrack.length === 0 && !blocksLowerFeeds) {
          tracks[t].push(conn);
          return;
        }

        // Fall 2: In Track t liegt bereits eine längere, weiter nach außen greifende Verbindung D,
        // deren horizontales Intervall die vertikale Kind-Zuleitung der engeren Verbindung conn
        // überdeckt (oder von conn's Elternstamm gekreuzt würde). Gemäß Schritt 2 & Bedingung B
        // muss die weiter nach außen greifende Verbindung D weiter nach unten (Richtung Elternknoten)
        // rücken, damit die engere Verbindung conn in Track t (näher an den Kindern) liegen kann.
        if (overlappingInTrack.length > 0 && !blocksLowerFeeds) {
          const shouldDisplaceDown = overlappingInTrack.some(
            d => verticalTopFeedsCrossInterval(conn, d) || verticalBottomFeedsCrossInterval(d, conn)
          );
          const safeForDisplaced = overlappingInTrack.every(
            d => !verticalTopFeedsCrossInterval(d, conn)
          );

          if (shouldDisplaceDown && safeForDisplaced) {
            const displacedSet = new Set(overlappingInTrack.map(d => d.origIdx));
            tracks[t] = tracks[t].filter(d => !displacedSet.has(d.origIdx));
            tracks[t].push(conn);
            for (const d of overlappingInTrack) {
              placeIntoTracks(d, t + 1);
            }
            return;
          }
        }
      }

      // Falls kein kollisionsfreier Track 0..T-1 gefunden wurde, prüfe ob ein bestehender Track ab
      // minTrackIndex Bedingung A erfüllt (falls eine unvermeidbare X-Kreuzung vorlag),
      // andernfalls erstelle einen neuen Track weiter unten (Richtung Eltern-Knoten).
      let canAppendWithoutAboveCrossing = true;
      for (let upper = 0; upper < tracks.length; upper++) {
        if (tracks[upper].some(d => verticalTopFeedsCrossInterval(conn, d))) {
          canAppendWithoutAboveCrossing = false;
          break;
        }
      }

      if (canAppendWithoutAboveCrossing) {
        tracks.push([conn]);
        return;
      }

      for (let t = minTrackIndex; t < tracks.length; t++) {
        const hasOverlapInT = tracks[t].some(d => intervalsOverlap(conn, d));
        if (!hasOverlapInT) {
          tracks[t].push(conn);
          return;
        }
      }

      tracks.push([conn]);
    }

    for (const conn of sortedConnections) {
      placeIntoTracks(conn, 0);
    }

    // Leere Tracks bereinigen und Track-Indizes (0 = ganz oben unter den Kindern) zuordnen
    const nonEmptyTracks = tracks.filter(trk => trk.length > 0);
    const assignedLanes = new Array<number>(n).fill(0);
    nonEmptyTracks.forEach((trk, trackIdx) => {
      trk.forEach(conn => {
        assignedLanes[conn.origIdx] = trackIdx;
      });
    });

    return {
      lanes: assignedLanes,
      totalLanes: nonEmptyTracks.length,
    };
  }

  // Gruppiert Kinderkacheln desselben Elternteils auf einer Ebene in zusammenhängende
  // Geschwister-Gruppierungen (anhand groupId und direkter Nachbarschaft).
  function partitionIntoChildGroupings<T extends { groupId: string; left: number; right: number; centerX: number }>(
    cBoxes: T[]
  ): T[][] {
    if (cBoxes.length === 0) return [];
    const sorted = [...cBoxes].sort((a, b) => a.centerX - b.centerX);
    const groups: T[][] = [];
    let currentGroup: T[] = [sorted[0]];
    groups.push(currentGroup);

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const sameGroup = prev.groupId === curr.groupId;
      const isAdjacent = Math.abs(curr.left - prev.right) <= 2;
      if (sameGroup && isAdjacent) {
        currentGroup.push(curr);
      } else {
        currentGroup = [curr];
        groups.push(currentGroup);
      }
    }
    return groups;
  }

  const computedLevelMetrics = computed<LevelMetrics>(() => {
    const heights: Record<number, number> = {};
    const bandTopY: Record<number, number> = {};
    const cardTopY: Record<number, number> = {};
    const levelMaxCardBottom: Record<number, number> = {};
    const maxCardHeights: Record<number, number> = {};
    const requiredLanes: Record<number, number> = {};

    const gap = Math.max(10, getProps().horizontalLaneGap || 16);
    const maxSubtreeLvl = visibleSiblingGroups.value.reduce((max, g) => Math.max(max, g.level), totalLevels.value);
    const totalLvls = Math.max(totalLevels.value, maxSubtreeLvl);

    // 1. O(1) Index für Elterngruppen-Suche
    const groupByPersonId = new Map<string, DesignSiblingGroup>();
    visibleSiblingGroups.value.forEach(g => {
      g.memberIds.forEach(id => groupByPersonId.set(id, g));
    });

    // 2. Gruppen nach Ebene indizieren
    const groupsByLevel = new Map<number, DesignSiblingGroup[]>();
    for (let l = 1; l <= totalLvls; l++) {
      groupsByLevel.set(l, []);
    }
    visibleSiblingGroups.value.forEach(g => {
      if (!groupsByLevel.has(g.level)) {
        groupsByLevel.set(g.level, []);
      }
      groupsByLevel.get(g.level)!.push(g);
    });

    // 2b. Alle Querlinien nach physischem Korridor indizieren (up, same und down)
    // Verwende dieselbe patrilineare Eltern-Kind-Zuordnung wie in edgeGeometry.
    interface HorizCardPos {
      id: string;
      groupId: string;
      level: number;
      left: number;
      right: number;
      centerX: number;
    }
    const cardPosByPersonId = new Map<string, HorizCardPos>();
    visibleSiblingGroups.value.forEach(g => {
      const visibleMemberIds = visibleGroupAndMemberMap.value.visibleMembersByGroupId.get(g.id) || g.memberIds;
      const width = getGroupWidth(visibleMemberIds.length);
      const left = Math.round(g.x - width / 2);
      visibleMemberIds.forEach((pid, idx) => {
        const cLeft = left + idx * CARD_WIDTH;
        const cRight = cLeft + CARD_WIDTH;
        cardPosByPersonId.set(pid, {
          id: pid,
          groupId: g.id,
          level: g.level,
          left: cLeft,
          right: cRight,
          centerX: cLeft + CARD_WIDTH / 2,
        });
      });
    });

    const childrenByParentAndLevel = new Map<string, Map<number, HorizCardPos[]>>();
    cardPosByPersonId.forEach(cb => {
      const person = personById.value.get(cb.id);
      const henryParentId = parentIdByChildIdMap.value.get(cb.id) ?? null;
      const pId = resolvePatrilinearParentId(person, cardPosByPersonId, henryParentId);
      if (!pId) return;
      const pBox = cardPosByPersonId.get(pId);
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

    const barsByCorridorLevel = new Map<number, SiblingBarItem[]>();
    childrenByParentAndLevel.forEach((lvlMap, parentId) => {
      const pBox = cardPosByPersonId.get(parentId);
      if (!pBox) return;

      lvlMap.forEach((cBoxes, childLevel) => {
        const direction: 'up' | 'same' | 'down' =
          childLevel > pBox.level ? 'up' : (childLevel === pBox.level ? 'same' : 'down');
        const corridorLevel = direction === 'down' ? pBox.level : childLevel;

        const childGroupings = partitionIntoChildGroupings(cBoxes);
        const targetXs: number[] = [];
        childGroupings.forEach(boxes => {
          const minL = Math.min(...boxes.map(c => c.left));
          const maxR = Math.max(...boxes.map(c => c.right));
          targetXs.push(Math.round((minL + maxR) / 2));
        });
        if (targetXs.length === 0) return;

        const minChildX = Math.min(...targetXs);
        const maxChildX = Math.max(...targetXs);
        const stemX = pBox.centerX;
        const barMinX = Math.min(stemX, ...targetXs);
        const barMaxX = Math.max(stemX, ...targetXs);

        if (barMaxX - barMinX > 1) {
          if (!barsByCorridorLevel.has(corridorLevel)) {
            barsByCorridorLevel.set(corridorLevel, []);
          }
          barsByCorridorLevel.get(corridorLevel)!.push({
            parentId,
            parentX: stemX,
            minChildX,
            maxChildX,
            childrenX: targetXs,
            direction,
          });
        }
      });
    });

    // 3. Maximale Kachelhöhe und benötigte Lanes je Ebene ermitteln
    for (let lvl = 1; lvl <= totalLvls; lvl++) {
      const groupsInLvl = groupsByLevel.get(lvl) || [];
      let maxCardH = 50;
      if (groupsInLvl.length > 0) {
        groupsInLvl.forEach(g => {
          g.memberIds.forEach(id => {
            const h = cardHeightByPersonId.value.get(id) || 50;
            if (h > maxCardH) maxCardH = h;
          });
        });
      }
      maxCardHeights[lvl] = maxCardH;

      const corridorBars = barsByCorridorLevel.get(lvl) || [];
      let totalLanes = 0;
      if (corridorBars.length > 0) {
        const corridorDir = (corridorBars[0] as any)?.direction || 'up';
        const { totalLanes: calculatedLanes } = assignNonOverlappingLanes(corridorBars, corridorDir);
        totalLanes = calculatedLanes;
      }

      requiredLanes[lvl] = totalLanes;
      const linesHeight = totalLanes === 0
        ? CORRIDOR_EMPTY
        : (CORRIDOR_PAD_TOP + (totalLanes - 1) * gap + CORRIDOR_PAD_BOTTOM);
      heights[lvl] = Math.max(MIN_LEVEL_HEIGHT, LEVEL_CARD_PAD_TOP + maxCardH + linesHeight);
    }

    // 4. Kumulative Positionen von oben (totalLevels) nach unten (1) in O(L)
    let currY = CANVAS_PAD_TOP;
    for (let lvl = totalLvls; lvl >= 1; lvl--) {
      bandTopY[lvl] = currY;
      cardTopY[lvl] = currY + LEVEL_CARD_PAD_TOP;
      levelMaxCardBottom[lvl] = cardTopY[lvl] + (maxCardHeights[lvl] || 50);
      currY += heights[lvl];
    }

    const totalCanvasHeight = Math.max(800, currY + CANVAS_PAD_BOTTOM);

    return {
      heights,
      bandTopY,
      cardTopY,
      levelMaxCardBottom,
      maxCardHeights,
      requiredLanes,
      totalCanvasHeight,
    };
  });

  const levelLayoutMetrics = computed<LevelMetrics>(() => computedLevelMetrics.value);

  function getLevelHeight(level: number): number {
    return levelLayoutMetrics.value.heights[level] || DEFAULT_LEVEL_HEIGHT;
  }

  function getLevelBandTopY(level: number): number {
    return levelLayoutMetrics.value.bandTopY[level] || CANVAS_PAD_TOP;
  }

  function getGroupTopY(level: number): number {
    return levelLayoutMetrics.value.cardTopY[level] || (CANVAS_PAD_TOP + LEVEL_CARD_PAD_TOP);
  }

  function getMaxCardHeightForLevel(level: number): number {
    return levelLayoutMetrics.value.maxCardHeights[level] || 50;
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
          let cursor = Math.round(centerSpanX - totalGroupW / 2);
          lvlGroups.forEach((g, idx) => {
            const w = widths[idx];
            g.x = Math.round(cursor + w / 2);
            cursor += w;
          });
        } else {
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

  // Initialisiert den Stammbaum mit dem ausgewählten Stammahnen (oder Ankerperson eines Zweigs) als Ursprung (Ebene 1 unten -> nach oben)
  function buildInitialDesignLayout(overrideRootId?: string) {
    if (siblingGroups.value.length > 0) {
      pushHistoryState();
    }
    const pid = overrideRootId || getProps().activeProbandId;
    branchWidths.value = new Map();

    if (!pid) {
      siblingGroups.value = [];
      totalLevels.value = 1;
      expandedParentIds.value = new Set();
      return;
    }

    const rootPerson = personById.value.get(pid);
    if (!rootPerson) {
      siblingGroups.value = [];
      totalLevels.value = 1;
      expandedParentIds.value = new Set();
      return;
    }

    const initialExpanded = new Set<string>();
    childrenMapByParentId.value.forEach((kids, parentId) => {
      if (kids.length > 0) {
        initialExpanded.add(parentId);
      }
    });
    expandedParentIds.value = initialExpanded;

    // Subtree-Breite rekursiv berechnen
    const subtreeWidthMap = new Map<string, number>();
    const visitedWidth = new Set<string>();

    function computePersonSubtreeSpan(personId: string): number {
      if (visitedWidth.has(personId)) return CARD_WIDTH + 32;
      visitedWidth.add(personId);
      const childIds = childrenMapByParentId.value.get(personId) || [];
      if (childIds.length === 0) {
        subtreeWidthMap.set(personId, CARD_WIDTH + 32);
        return CARD_WIDTH + 32;
      }
      const groupOwnW = getGroupWidth(childIds.length) + 36;
      let childrenSubtreesW = 0;
      childIds.forEach(cId => {
        childrenSubtreesW += computePersonSubtreeSpan(cId);
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
      const childIds = (childrenMapByParentId.value.get(parentId) || []).filter(cId => !visitedBuild.has(cId));
      if (childIds.length === 0) return;
      childIds.forEach(cId => visitedBuild.add(cId));

      const gen = parentGen + 1;
      if (gen > maxGen) maxGen = gen;

      groups.push({
        id: `sg-of-${parentId}`,
        parentId,
        generation: gen,
        level: gen,
        x: spanCenterX,
        memberIds: childIds,
        isUngrouped: false,
      });

      const childSpans = childIds.map(cId => subtreeWidthMap.get(cId) || (CARD_WIDTH + 32));
      const sumChildSpans = childSpans.reduce((a, b) => a + b, 0);
      let cursorX = spanCenterX - sumChildSpans / 2;

      childIds.forEach((cId, idx) => {
        const w = childSpans[idx];
        const childCenterX = cursorX + w / 2;
        layoutChildrenOf(cId, gen, childCenterX);
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
    ensureAllSubtreeAnchorsIsolated();

    nextTick(() => {
      centerOnOrigin();
    });
  }

  // Ein- und Ausklappen von Nachfahren (Stammahn bleibt immer als Ursprung aktiv)
  const personIdsWithDescendants = computed<Set<string>>(() => {
    const set = new Set<string>();
    childrenMapByParentId.value.forEach((kids, pId) => {
      if (kids.length > 0) set.add(pId);
    });
    const { activeProbandId, persons } = getProps();
    const activeCode = activeProbandId || '';
    persons.forEach(p => {
      if (p.parent_ids && p.parent_ids.length > 0 && p.proband_data && p.proband_data[activeCode]) {
        p.parent_ids.forEach(pId => set.add(pId));
      }
    });
    return set;
  });

  function hasDescendants(personId: string): boolean {
    return personIdsWithDescendants.value.has(personId);
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

  const canvasHeight = computed<number>(() => levelLayoutMetrics.value.totalCanvasHeight);

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

  const levelsTopToBottom = computed<LevelBandInfo[]>(() => {
    const list: LevelBandInfo[] = [];
    const maxSubtreeLvl = visibleSiblingGroups.value.reduce((max, g) => Math.max(max, g.level), totalLevels.value);
    const totalLvls = Math.max(totalLevels.value, maxSubtreeLvl);

    for (let lvl = totalLvls; lvl >= 1; lvl--) {
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

  const cardDataByPersonId = computed<Map<string, RenderedCardData>>(() => {
    const map = new Map<string, RenderedCardData>();
    const cfg = activeCardConfig.value;
    const loc = locale.value;
    const { activeProbandId: activeProband, persons } = getProps();

    persons.forEach(person => {
      const henryCode = (person.proband_data && activeProband)
        ? (person.proband_data[activeProband]?.henry_code || null)
        : null;

      const firstName = (person.given_name || 'N.N.').trim();
      const fullName = `${firstName} ${person.surname || ''}`.trim();

      let birthText = '';
      if (cfg.showBirthDate && person.birth_date) {
        const dateStr = formatLocalizedDate(person.birth_date, loc, cfg.showOnlyYears);
        const placePart = cfg.showBirthPlace && person.birth_place ? ` (${person.birth_place})` : '';
        birthText = `* ${dateStr}${placePart}`;
      }

      let chrText = '';
      if (cfg.showChrDate) {
        const chr = getBaptismInfo(person);
        if (chr.date) {
          const dateStr = formatLocalizedDate(chr.date, loc, cfg.showOnlyYears);
          const placePart = cfg.showChrPlace && chr.place ? ` (${chr.place})` : '';
          chrText = `~ ${dateStr}${placePart}`;
        }
      }

      let deathText = '';
      if (cfg.showDeathDate && person.death_date) {
        const dateStr = formatLocalizedDate(person.death_date, loc, cfg.showOnlyYears);
        const placePart = cfg.showDeathPlace && person.death_place ? ` (${person.death_place})` : '';
        deathText = `† ${dateStr}${placePart}`;
      }

      const hasLine3 = Boolean(birthText || chrText || deathText);

      const hasMarriage = Boolean(
        person.spouses && person.spouses.length > 0 &&
        (cfg.showSpouseName || cfg.showMarriageCounter || cfg.showMarriageDate || cfg.showDivorce || cfg.showSpouseBirthDate || cfg.showSpouseDeathDate)
      );

      const spouses: RenderedCardSpouse[] = [];
      if (hasMarriage && person.spouses) {
        person.spouses.forEach(spConn => {
          const spPerson = personById.value.get(spConn.id);
          const spName = spPerson
            ? `${spPerson.given_name || 'N.N.'} ${spPerson.surname || ''}`.trim()
            : 'N.N.';
          const spHenry = (spPerson?.proband_data && activeProband)
            ? (spPerson.proband_data[activeProband]?.henry_code || null)
            : null;

          const dateStr = spConn.date ? formatLocalizedDate(spConn.date, loc, cfg.showOnlyYears) : null;
          const bDateStr = spPerson?.birth_date ? formatLocalizedDate(spPerson.birth_date, loc, cfg.showOnlyYears) : null;
          const dDateStr = spPerson?.death_date ? formatLocalizedDate(spPerson.death_date, loc, cfg.showOnlyYears) : null;
          const divDateStr = spConn.divorce_date ? formatLocalizedDate(spConn.divorce_date, loc, cfg.showOnlyYears) : null;
          const isDivorced = Boolean(spConn.is_divorced);

          const dateItems: SpouseDateItem[] = [];
          if (cfg.showMarriageDate && dateStr) {
            dateItems.push({ key: 'marriage', text: `oo ${dateStr}`, isMarriage: true });
          }
          if (cfg.showDivorce && (isDivorced || divDateStr)) {
            dateItems.push({
              key: 'divorce',
              text: `o|o ${divDateStr || t('divorced')}`,
              isDivorce: true,
              isMarriage: true,
            });
          }
          if (cfg.showSpouseBirthDate && bDateStr) {
            const place = cfg.showSpouseBirthPlace && spPerson?.birth_place ? ` (${spPerson.birth_place})` : '';
            dateItems.push({ key: 'birth', text: `* ${bDateStr}${place}` });
          }
          if (cfg.showSpouseDeathDate && dDateStr) {
            const place = cfg.showSpouseDeathPlace && spPerson?.death_place ? ` (${spPerson.death_place})` : '';
            dateItems.push({ key: 'death', text: `† ${dDateStr}${place}` });
          }

          spouses.push({
            id: spConn.id,
            name: spName,
            henry: spHenry,
            isDivorced,
            divorceDate: divDateStr,
            dateItems,
          });
        });
      }

      map.set(person.id, {
        henryCode,
        firstName,
        fullName,
        birthText,
        chrText,
        deathText,
        hasLine3,
        hasMarriage,
        spouses,
      });
    });

    return map;
  });

  function getLineStyle(bold: boolean, italic: boolean) {
    return {
      fontWeight: bold ? 'bold' : 'normal',
      fontStyle: italic ? 'italic' : 'normal',
    };
  }

  function getSiblingSubGroupSurname(cards: CardBox[], parentPerson: DesignPerson | null): string {
    const surnames: string[] = [];
    for (const cb of cards) {
      const s = cb.person.surname?.trim();
      if (s && !surnames.includes(s)) {
        surnames.push(s);
      }
    }
    if (surnames.length > 0) {
      return surnames.join(' / ');
    }
    if (parentPerson?.surname?.trim()) {
      return parentPerson.surname.trim();
    }
    return '';
  }

  const splitParentIdsSet = computed<Set<string>>(() => {
    const set = new Set<string>();
    const groupsByParentId = new Map<string, number>();
    siblingGroups.value.forEach(g => {
      const pSet = new Set<string>();
      g.memberIds.forEach(mId => {
        const pId = getBiologicalParentId(mId);
        if (pId) pSet.add(pId);
      });
      pSet.forEach(pId => {
        groupsByParentId.set(pId, (groupsByParentId.get(pId) || 0) + 1);
      });
    });
    groupsByParentId.forEach((count, pId) => {
      if (count > 1) set.add(pId);
    });
    return set;
  });

  function canRegroupPerson(personId: string): boolean {
    const pParentId = getBiologicalParentId(personId);
    if (!pParentId) return false;
    return splitParentIdsSet.value.has(pParentId);
  }

  const groupLayouts = computed<GroupLayoutInfo[]>(() => {
    const membersByGroup = visibleGroupAndMemberMap.value.visibleMembersByGroupId;

    return visibleSiblingGroups.value.map(group => {
      const visibleMemberIds = membersByGroup.get(group.id) || group.memberIds;
      const width = getGroupWidth(visibleMemberIds.length);
      const left = Math.round(group.x - width / 2);
      const right = left + width;
      const top = getGroupTopY(group.level);

      const groupCardHeight = visibleMemberIds.length > 0
        ? Math.max(...visibleMemberIds.map(id => getCardHeightForPerson(id, group.generation)), 50)
        : 50;

      const cards: CardBox[] = [];
      const subRefs = options.subLayoutReferences?.value || {};
      visibleMemberIds.forEach((pid, idx) => {
        const p = personById.value.get(pid);
        if (!p) return;
        const cLeft = left + idx * CARD_WIDTH;
        const cRight = cLeft + CARD_WIDTH;
        const cardH = groupCardHeight;
        const linkedRef = subRefs[pid];
        cards.push({
          person: p,
          groupId: group.id,
          level: group.level,
          generation: group.generation,
          left: cLeft,
          right: cRight,
          top,
          bottom: top + cardH,
          height: cardH,
          centerX: cLeft + CARD_WIDTH / 2,
          centerY: top + cardH / 2,
          isReadOnly: Boolean(group.isReadOnly),
          subtreeAnchorId: group.subtreeAnchorId,
          subtreeLayoutName: group.subtreeLayoutName,
          isSubtreeAnchor: Boolean(linkedRef),
          linkedSubLayoutName: linkedRef?.layoutName,
          linkedSubLayoutId: linkedRef?.layoutId,
        });
      });

      const groupHeight = groupCardHeight;

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
            surname: '',
          };
          siblingSubGroups.push(currentSubGroup);
        } else {
          currentSubGroup.cards.push(cb);
          currentSubGroup.isMultiSibling = true;
        }
      });

      siblingSubGroups.forEach(sub => {
        sub.surname = getSiblingSubGroupSurname(sub.cards, sub.parentPerson);
      });

      const canRegroup = group.memberIds.some(id => canRegroupPerson(id));

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
        bottom: top + groupHeight,
        width,
        height: groupHeight,
        parentPerson: group.parentId ? (personById.value.get(group.parentId) || null) : null,
        cards,
        siblingSubGroups,
        canRegroup: group.isReadOnly ? false : canRegroup,
        isDocked,
        isReadOnly: Boolean(group.isReadOnly),
        subtreeAnchorId: group.subtreeAnchorId,
        subtreeLayoutName: group.subtreeLayoutName,
        subtreeLayoutId: group.subtreeLayoutId,
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

  // Ermittelt den übergeordneten reservierten Bereich für personId, falls personId verschachtelt ist
  function getParentReservedAreaId(personId: string): string | null {
    const candidates: { id: string; level: number }[] = [];
    branchWidths.value.forEach((_bw, otherId) => {
      if (otherId === personId) return;
      const descSet = getDescendantPersonIds(otherId);
      if (descSet.has(personId)) {
        const pos = getRawPersonPosition(otherId);
        candidates.push({ id: otherId, level: pos ? pos.level : 1 });
      }
    });

    if (candidates.length === 0) {
      const targetBw = branchWidths.value.get(personId);
      const pPos = getRawPersonPosition(personId);
      const pLvl = pPos ? pPos.level : 1;
      if (targetBw) {
        branchWidths.value.forEach((otherBw, otherId) => {
          if (otherId === personId) return;
          const oPos = getRawPersonPosition(otherId);
          const oLvl = oPos ? oPos.level : 1;
          if (pLvl >= oLvl && targetBw.minX >= otherBw.minX - 4 && targetBw.maxX <= otherBw.maxX + 4) {
            candidates.push({ id: otherId, level: oLvl });
          }
        });
      }
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.level - a.level);
    return candidates[0].id;
  }

  // Ermittelt alle untergeordneten (verschachtelten) reservierten Bereiche innerhalb von ancestorPersonId
  function getAllNestedReservedAreaIds(ancestorPersonId: string): string[] {
    const res: string[] = [];
    const descSet = getDescendantPersonIds(ancestorPersonId);
    branchWidths.value.forEach((bw, otherId) => {
      if (otherId === ancestorPersonId) return;
      if (descSet.has(otherId)) {
        res.push(otherId);
      } else {
        const parentBw = branchWidths.value.get(ancestorPersonId);
        const posOther = getRawPersonPosition(otherId);
        const posAnc = getRawPersonPosition(ancestorPersonId);
        if (parentBw && posOther && posAnc && posOther.level >= posAnc.level) {
          if (bw.minX >= parentBw.minX - 4 && bw.maxX <= parentBw.maxX + 4) {
            res.push(otherId);
          }
        }
      }
    });
    return res;
  }

  // Verschachtelungstiefe eines reservierten Bereiches ermitteln
  function getNestingDepth(personId: string): number {
    let depth = 0;
    let curr = getParentReservedAreaId(personId);
    const visited = new Set<string>();
    while (curr && !visited.has(curr)) {
      visited.add(curr);
      depth++;
      curr = getParentReservedAreaId(curr);
    }
    return depth;
  }

  // Darstellungsdaten für alle aktiven Zweig-Breiten-Abgrenzungen
  const renderedBranchWidths = computed<RenderedBranchWidth[]>(() => {
    const list: RenderedBranchWidth[] = [];

    branchWidths.value.forEach(bw => {
      const person = personById.value.get(bw.personId);
      const rawPos = getRawPersonPosition(bw.personId);
      if (!person || !rawPos) return;
      const bandTop = getLevelBandTopY(rawPos.level);
      const bandBottom = bandTop + getLevelHeight(rawPos.level);
      const cardTop = getGroupTopY(rawPos.level);
      const barY = cardTop - 22;
      const corridorTopY = CANVAS_PAD_TOP;
      const corridorHeight = Math.max(0, bandBottom - CANVAS_PAD_TOP);

      const nestingDepth = getNestingDepth(bw.personId);
      const zIndex = Math.min(8, 3 + nestingDepth * 2);
      const barZIndex = 28 + nestingDepth * 2;

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
        zIndex,
        barZIndex,
        isNested: nestingDepth > 0,
      });
    });

    list.sort((a, b) => {
      const depthA = getNestingDepth(a.personId);
      const depthB = getNestingDepth(b.personId);
      if (depthA !== depthB) return depthA - depthB;
      return a.level - b.level;
    });

    return list;
  });

  // ----------------------------------------------------
  // Verschieben eines gesamten reservierten Bereichs samt aller darin befindlichen Einträge
  // ----------------------------------------------------
  const draggingBwId = ref<string | null>(null);
  let bwDragStartMouseX = 0;
  let bwDragStartMinX = 0;
  let bwDragStartMaxX = 0;
  let bwDragMinDx = 0;
  let bwDragMaxDx = 0;
  let draggingAreaGroups: { group: DesignSiblingGroup; startX: number }[] = [];
  let draggingNestedBwItems: { id: string; startMinX: number; startMaxX: number }[] = [];

  function getGroupsInReservedArea(personId: string): DesignSiblingGroup[] {
    const bw = branchWidths.value.get(personId);
    if (!bw) return [];
    const descSet = getDescendantPersonIds(personId);
    const pPos = getRawPersonPosition(personId);
    const pLevel = pPos ? pPos.level : 1;
    const parentAreaId = getParentReservedAreaId(personId);

    const res: DesignSiblingGroup[] = [];
    siblingGroups.value.forEach(g => {
      if (g.memberIds.includes(personId)) {
        res.push(g);
        return;
      }
      if (g.level >= pLevel && g.memberIds.some(id => descSet.has(id))) {
        res.push(g);
        return;
      }
      if (!parentAreaId && g.level >= pLevel) {
        const w = getGroupWidth(g.memberIds.length);
        const left = g.x - w / 2;
        const right = g.x + w / 2;
        if (left >= bw.minX - 8 && right <= bw.maxX + 8) {
          const belongsToOther = Array.from(branchWidths.value.keys()).some(otherId => {
            if (otherId === personId) return false;
            return getDescendantPersonIds(otherId).has(g.memberIds[0]);
          });
          if (!belongsToOther) {
            res.push(g);
          }
        }
      }
    });

    return res;
  }

  function calculateBranchMoveBounds(personId: string, areaGroups: DesignSiblingGroup[]): { minDx: number; maxDx: number } {
    const bw = branchWidths.value.get(personId);
    if (!bw) return { minDx: 0, maxDx: 0 };

    const pPos = getRawPersonPosition(personId);
    const pLevel = pPos ? pPos.level : 1;
    const areaGroupIds = new Set(areaGroups.map(g => g.id));

    const minLvl = pLevel;
    const maxLvl = Math.max(totalLevels.value, ...areaGroups.map(g => g.level));

    const OBSTACLE_GAP = 12;
    const startMinX = bw.minX;
    const startMaxX = bw.maxX;

    let minDx = (LEVEL_SIDEBAR_W + 16) - startMinX;
    let maxDx = Infinity;

    const parentAreaId = getParentReservedAreaId(personId);
    if (parentAreaId) {
      const parentBw = branchWidths.value.get(parentAreaId);
      if (parentBw) {
        const parentMinLimit = (parentBw.minX + 8) - startMinX;
        if (parentMinLimit > minDx) minDx = parentMinLimit;
        const parentMaxLimit = (parentBw.maxX - 8) - startMaxX;
        if (parentMaxLimit < maxDx) maxDx = parentMaxLimit;
      }
    }

    for (const g of areaGroups) {
      const w = getGroupWidth(g.memberIds.length);
      const gLeft = g.x - w / 2;
      const gMinDx = (LEVEL_SIDEBAR_W + 16) - gLeft;
      if (gMinDx > minDx) minDx = gMinDx;
    }

    let maxDxVal = maxDx;
    const nestedChildAreaIds = new Set(getAllNestedReservedAreaIds(personId));

    branchWidths.value.forEach((otherBw, otherId) => {
      if (otherId === personId) return;
      if (nestedChildAreaIds.has(otherId)) return;
      if (otherId === parentAreaId) return;

      const otherPos = getRawPersonPosition(otherId);
      const otherLevel = otherPos ? otherPos.level : 1;
      const otherMinLvl = otherLevel;
      const otherMaxLvl = totalLevels.value;
      const levelsOverlap = Math.max(minLvl, otherMinLvl) <= Math.min(maxLvl, otherMaxLvl);
      if (!levelsOverlap) return;

      if (otherBw.maxX <= startMinX + 2) {
        const limitDx = (otherBw.maxX + OBSTACLE_GAP) - startMinX;
        if (limitDx > minDx) minDx = limitDx;
      } else if (otherBw.minX >= startMaxX - 2) {
        const limitDx = (otherBw.minX - OBSTACLE_GAP) - startMaxX;
        if (limitDx < maxDxVal) maxDxVal = limitDx;
      }
    });

    for (const otherG of siblingGroups.value) {
      if (areaGroupIds.has(otherG.id)) continue;
      if (otherG.level < minLvl || otherG.level > maxLvl) continue;

      const otherW = getGroupWidth(otherG.memberIds.length);
      const otherLeft = otherG.x - otherW / 2;
      const otherRight = otherG.x + otherW / 2;

      if (otherRight <= startMinX + 2) {
        const limitDx = (otherRight + OBSTACLE_GAP) - startMinX;
        if (limitDx > minDx) minDx = limitDx;
      } else if (otherLeft >= startMaxX - 2) {
        const limitDx = (otherLeft - OBSTACLE_GAP) - startMaxX;
        if (limitDx < maxDxVal) maxDxVal = limitDx;
      }

      for (const g of areaGroups) {
        if (g.level !== otherG.level) continue;
        const gW = getGroupWidth(g.memberIds.length);
        const gLeft = g.x - gW / 2;
        const gRight = g.x + gW / 2;

        if (otherRight <= gLeft + 2) {
          const limitDx = (otherRight + OBSTACLE_GAP) - gLeft;
          if (limitDx > minDx) minDx = limitDx;
        } else if (otherLeft >= gRight - 2) {
          const limitDx = (otherLeft - OBSTACLE_GAP) - gRight;
          if (limitDx < maxDxVal) maxDxVal = limitDx;
        }
      }
    }

    minDx = Math.min(0, minDx);
    maxDxVal = Math.max(0, maxDxVal);

    return { minDx, maxDx: maxDxVal };
  }

  function startBranchWidthDrag(e: MouseEvent, personId: string) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const bw = branchWidths.value.get(personId);
    if (!bw) return;

    const areaGroups = getGroupsInReservedArea(personId);
    const bounds = calculateBranchMoveBounds(personId, areaGroups);

    pushHistoryState();
    draggingBwId.value = personId;
    bwDragStartMouseX = e.clientX;
    bwDragStartMinX = bw.minX;
    bwDragStartMaxX = bw.maxX;
    bwDragMinDx = bounds.minDx;
    bwDragMaxDx = bounds.maxDx;
    draggingAreaGroups = areaGroups.map(g => ({ group: g, startX: g.x }));

    const nestedIds = getAllNestedReservedAreaIds(personId);
    draggingNestedBwItems = nestedIds
      .map(id => {
        const b = branchWidths.value.get(id);
        return b ? { id, startMinX: b.minX, startMaxX: b.maxX } : null;
      })
      .filter((x): x is { id: string; startMinX: number; startMaxX: number } => x !== null);

    document.body.style.cursor = 'grabbing';
    window.addEventListener('mousemove', onWindowBranchWidthDragMove);
    window.addEventListener('mouseup', onWindowBranchWidthDragEnd);
  }

  function onWindowBranchWidthDragMove(e: MouseEvent) {
    if (!draggingBwId.value) return;
    const bw = branchWidths.value.get(draggingBwId.value);
    if (!bw) return;

    const rawDx = (e.clientX - bwDragStartMouseX) / zoom.value;
    const effectiveDx = Math.round(Math.max(bwDragMinDx, Math.min(bwDragMaxDx, rawDx)));

    bw.minX = Math.round(bwDragStartMinX + effectiveDx);
    bw.maxX = Math.round(bwDragStartMaxX + effectiveDx);

    draggingNestedBwItems.forEach(item => {
      const nbw = branchWidths.value.get(item.id);
      if (nbw) {
        nbw.minX = Math.round(item.startMinX + effectiveDx);
        nbw.maxX = Math.round(item.startMaxX + effectiveDx);
      }
    });

    draggingAreaGroups.forEach(item => {
      item.group.x = Math.round(item.startX + effectiveDx);
    });
  }

  function onWindowBranchWidthDragEnd() {
    draggingBwId.value = null;
    draggingAreaGroups = [];
    draggingNestedBwItems = [];
    document.body.style.cursor = '';
    window.removeEventListener('mousemove', onWindowBranchWidthDragMove);
    window.removeEventListener('mouseup', onWindowBranchWidthDragEnd);
  }

  // ----------------------------------------------------
  // Anpassung der Grenzen eines reservierten Bereichs per Mausziehgriff
  // ----------------------------------------------------
  let resizingBwId: string | null = null;
  let resizingBwSide: 'left' | 'right' | null = null;
  let bwResizeStartMouseX = 0;
  let bwResizeStartMinX = 0;
  let bwResizeStartMaxX = 0;
  let activeResizeBounds = {
    minAllowedLeft: LEVEL_SIDEBAR_W + 16,
    maxAllowedLeft: 0,
    minAllowedRight: 0,
    maxAllowedRight: Infinity,
  };

  function calculateBranchResizeBounds(personId: string): {
    minAllowedLeft: number;
    maxAllowedLeft: number;
    minAllowedRight: number;
    maxAllowedRight: number;
  } {
    const bw = branchWidths.value.get(personId);
    if (!bw) {
      return {
        minAllowedLeft: LEVEL_SIDEBAR_W + 16,
        maxAllowedLeft: 0,
        minAllowedRight: 0,
        maxAllowedRight: Infinity,
      };
    }

    let minAllowedLeft = LEVEL_SIDEBAR_W + 16;
    let maxAllowedLeft = bw.maxX - 100;
    let minAllowedRight = bw.minX + 100;
    let maxAllowedRight = Infinity;

    const parentId = getParentReservedAreaId(personId);
    if (parentId) {
      const parentBw = branchWidths.value.get(parentId);
      if (parentBw) {
        minAllowedLeft = Math.max(minAllowedLeft, parentBw.minX + 8);
        maxAllowedRight = Math.min(maxAllowedRight, parentBw.maxX - 8);
      }
    }

    const nestedChildIds = getAllNestedReservedAreaIds(personId);
    if (nestedChildIds.length > 0) {
      const childMinX = Math.min(...nestedChildIds.map(id => branchWidths.value.get(id)!.minX));
      const childMaxX = Math.max(...nestedChildIds.map(id => branchWidths.value.get(id)!.maxX));
      maxAllowedLeft = Math.min(maxAllowedLeft, childMinX - 8);
      minAllowedRight = Math.max(minAllowedRight, childMaxX + 8);
    }

    const pPos = getRawPersonPosition(personId);
    const pLevel = pPos ? pPos.level : 1;
    const nestedSet = new Set(nestedChildIds);

    branchWidths.value.forEach((otherBw, otherId) => {
      if (otherId === personId || otherId === parentId || nestedSet.has(otherId)) return;
      const otherPos = getRawPersonPosition(otherId);
      const otherLevel = otherPos ? otherPos.level : 1;
      const levelsOverlap = Math.max(pLevel, otherLevel) <= totalLevels.value;
      if (!levelsOverlap) return;

      if (otherBw.maxX <= bw.minX + 2) {
        minAllowedLeft = Math.max(minAllowedLeft, otherBw.maxX + 12);
      } else if (otherBw.minX >= bw.maxX - 2) {
        maxAllowedRight = Math.min(maxAllowedRight, otherBw.minX - 12);
      }
    });

    return { minAllowedLeft, maxAllowedLeft, minAllowedRight, maxAllowedRight };
  }

  function startBranchWidthResize(e: MouseEvent, personId: string, side: 'left' | 'right') {
    if (e.button !== 0) return;
    e.stopPropagation();
    const bw = branchWidths.value.get(personId);
    if (!bw) return;
    pushHistoryState();
    resizingBwId = personId;
    resizingBwSide = side;
    bwResizeStartMouseX = e.clientX;
    bwResizeStartMinX = bw.minX;
    bwResizeStartMaxX = bw.maxX;
    activeResizeBounds = calculateBranchResizeBounds(personId);
    window.addEventListener('mousemove', onWindowBranchWidthResizeMove);
    window.addEventListener('mouseup', onWindowBranchWidthResizeEnd);
  }

  function onWindowBranchWidthResizeMove(e: MouseEvent) {
    if (!resizingBwId || !resizingBwSide) return;
    const bw = branchWidths.value.get(resizingBwId);
    if (!bw) return;
    const dxCanvas = (e.clientX - bwResizeStartMouseX) / zoom.value;
    if (resizingBwSide === 'left') {
      const rawMinX = Math.round(bwResizeStartMinX + dxCanvas);
      bw.minX = Math.max(activeResizeBounds.minAllowedLeft, Math.min(activeResizeBounds.maxAllowedLeft, rawMinX));
    } else {
      const rawMaxX = Math.round(bwResizeStartMaxX + dxCanvas);
      bw.maxX = Math.min(activeResizeBounds.maxAllowedRight, Math.max(activeResizeBounds.minAllowedRight, rawMaxX));
    }

    shiftGroupsInwardForBranch(resizingBwId, resizingBwSide);
  }

  function onWindowBranchWidthResizeEnd() {
    if (resizingBwId) {
      const personId = resizingBwId;
      const initialWidth = bwResizeStartMaxX - bwResizeStartMinX;
      const currentBw = branchWidths.value.get(personId);
      if (currentBw) {
        const currentWidth = currentBw.maxX - currentBw.minX;
        if (Math.abs(currentWidth - initialWidth) > 2) {
          handleBranchWidthRecalculate(personId);
        }
      }
    }
    resizingBwId = null;
    resizingBwSide = null;
    window.removeEventListener('mousemove', onWindowBranchWidthResizeMove);
    window.removeEventListener('mouseup', onWindowBranchWidthResizeEnd);
  }

  function shiftGroupsInwardForBranch(personId: string, side: 'left' | 'right') {
    const bw = branchWidths.value.get(personId);
    if (!bw) return;

    const descSet = getDescendantPersonIds(personId);
    const pPos = getRawPersonPosition(personId);
    const pLevel = pPos ? pPos.level : 1;

    const branchGroups = siblingGroups.value.filter(g =>
      g.memberIds.includes(personId) ||
      (g.level >= pLevel && g.memberIds.some(id => descSet.has(id)))
    );

    const pad = 12;

    branchGroups.forEach(g => {
      const w = getGroupWidth(g.memberIds.length);
      const left = g.x - w / 2;
      const right = g.x + w / 2;

      if (w <= bw.maxX - bw.minX) {
        if (left < bw.minX + pad) {
          g.x = Math.round(bw.minX + pad + w / 2);
        } else if (right > bw.maxX - pad) {
          g.x = Math.round(bw.maxX - pad - w / 2);
        }
      } else {
        if (side === 'left' && left < bw.minX) {
          g.x = Math.round(bw.minX + w / 2);
        } else if (side === 'right' && right > bw.maxX) {
          g.x = Math.round(bw.maxX - w / 2);
        }
      }
    });
  }

  function getDescendantsByGeneration(personId: string): Map<number, string[]> {
    const descSet = getDescendantPersonIds(personId);
    const byGen = new Map<number, string[]>();
    if (descSet.size === 0) return byGen;

    const pPos = getRawPersonPosition(personId);
    const pLevel = pPos ? pPos.level : 1;
    const pPerson = personById.value.get(personId);
    const activeProbandId = getProps().activeProbandId || '';
    const pGen = pPerson?.proband_data[activeProbandId]?.generation || pLevel;

    const genMap = new Map<string, number>();
    const queue: { id: string; depth: number }[] = [{ id: personId, depth: 0 }];
    const visited = new Set<string>([personId]);

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      const kids = childrenMapByParentId.value.get(id) || [];
      for (const kid of kids) {
        if (!visited.has(kid)) {
          visited.add(kid);
          const kidPerson = personById.value.get(kid);
          const probandGen = kidPerson?.proband_data[activeProbandId]?.generation;
          const assignedGen = probandGen !== undefined ? probandGen : (pGen + depth + 1);
          genMap.set(kid, assignedGen);
          if (descSet.has(kid)) {
            if (!byGen.has(assignedGen)) {
              byGen.set(assignedGen, []);
            }
            byGen.get(assignedGen)!.push(kid);
          }
          queue.push({ id: kid, depth: depth + 1 });
        }
      }
    }

    for (const id of descSet) {
      if (!genMap.has(id)) {
        const p = personById.value.get(id);
        const probandGen = p?.proband_data[activeProbandId]?.generation || (pGen + 1);
        genMap.set(id, probandGen);
        if (!byGen.has(probandGen)) {
          byGen.set(probandGen, []);
        }
        byGen.get(probandGen)!.push(id);
      }
    }

    for (const [, members] of byGen.entries()) {
      members.sort((a, b) => {
        const pA = getBiologicalParentId(a) || '';
        const pB = getBiologicalParentId(b) || '';
        if (pA !== pB) return pA.localeCompare(pB);
        const personA = personById.value.get(a);
        const personB = personById.value.get(b);
        if (personA && personB) {
          const birthCmp = comparePersonsByBirth(personA, personB);
          if (birthCmp !== 0) return birthCmp;
        }
        return a.localeCompare(b);
      });
    }

    return byGen;
  }

  function partitionBlocksIntoChunks(blocks: { parentId: string | null; memberIds: string[] }[], K: number): string[][] {
    const m = blocks.length;
    if (m === 0) return [];
    if (K <= 1 || m === 1) {
      return [blocks.flatMap(b => b.memberIds)];
    }

    const effectiveK = Math.min(K, m);
    if (effectiveK === 1) {
      return [blocks.flatMap(b => b.memberIds)];
    }

    const blockSizes = blocks.map(b => b.memberIds.length);
    const totalCount = blockSizes.reduce((a, b) => a + b, 0);
    const targetPerChunk = totalCount / effectiveK;

    if (effectiveK === 2) {
      let bestCut = 1;
      let bestDiff = Infinity;
      let runningLeft = 0;
      for (let i = 0; i < m - 1; i++) {
        runningLeft += blockSizes[i];
        const runningRight = totalCount - runningLeft;
        const diff = Math.abs(runningLeft - runningRight);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestCut = i + 1;
        }
      }
      const leftMembers = blocks.slice(0, bestCut).flatMap(b => b.memberIds);
      const rightMembers = blocks.slice(bestCut).flatMap(b => b.memberIds);
      return [leftMembers, rightMembers];
    }

    function getBestCuts(startIndex: number, remainingK: number): { cuts: number[]; score: number } {
      if (remainingK === 1) {
        const chunkSize = blockSizes.slice(startIndex).reduce((a, b) => a + b, 0);
        const score = Math.pow(chunkSize - targetPerChunk, 2);
        return { cuts: [], score };
      }

      let bestScore = Infinity;
      let bestCuts: number[] = [];

      let currentChunkSize = 0;
      const maxI = m - remainingK;
      for (let i = startIndex; i <= maxI; i++) {
        currentChunkSize += blockSizes[i];
        const chunkScore = Math.pow(currentChunkSize - targetPerChunk, 2);
        const rest = getBestCuts(i + 1, remainingK - 1);
        const totalScore = chunkScore + rest.score;
        if (totalScore < bestScore) {
          bestScore = totalScore;
          bestCuts = [i + 1, ...rest.cuts];
        }
      }

      return { cuts: bestCuts, score: bestScore };
    }

    const { cuts } = getBestCuts(0, effectiveK);
    const resultChunks: string[][] = [];
    let prevIdx = 0;
    for (const cutIdx of cuts) {
      resultChunks.push(blocks.slice(prevIdx, cutIdx).flatMap(b => b.memberIds));
      prevIdx = cutIdx;
    }
    resultChunks.push(blocks.slice(prevIdx).flatMap(b => b.memberIds));

    return resultChunks;
  }

  function handleBranchWidthRecalculate(personId: string) {
    const bw = branchWidths.value.get(personId);
    if (!bw) return;

    const descSet = getDescendantPersonIds(personId);
    if (descSet.size === 0) return;

    const pPos = getRawPersonPosition(personId);
    const pLevel = pPos ? pPos.level : 1;

    pushHistoryState();

    const availableWidth = bw.maxX - bw.minX;
    const capacity = Math.max(1, Math.floor(availableWidth / CARD_WIDTH));

    const nestedChildAreaIds = new Set(getAllNestedReservedAreaIds(personId));
    const nestedChildDescSet = new Set<string>();
    nestedChildAreaIds.forEach(cId => {
      nestedChildDescSet.add(cId);
      for (const d of getDescendantPersonIds(cId)) {
        nestedChildDescSet.add(d);
      }
    });

    const byGen = getDescendantsByGeneration(personId);
    for (const [gen, members] of byGen.entries()) {
      const filtered = members.filter(id => !nestedChildDescSet.has(id));
      if (filtered.length === 0) {
        byGen.delete(gen);
      } else {
        byGen.set(gen, filtered);
      }
    }

    const sortedGens = Array.from(byGen.keys()).sort((a, b) => a - b);
    if (sortedGens.length === 0) return;

    interface GenAllocation {
      gen: number;
      chunks: string[][];
      levelsNeeded: number;
    }

    const genAllocations: GenAllocation[] = [];

    for (const gen of sortedGens) {
      const members = byGen.get(gen)!;
      const count = members.length;

      if (count <= capacity) {
        genAllocations.push({
          gen,
          chunks: [members],
          levelsNeeded: 1,
        });
        continue;
      }

      const factor = Math.ceil(count / capacity);

      const blocks: { parentId: string | null; memberIds: string[] }[] = [];
      let curBlock: { parentId: string | null; memberIds: string[] } | null = null;

      for (const mId of members) {
        const pId = getBiologicalParentId(mId);
        if (!curBlock || curBlock.parentId !== pId || pId === null) {
          curBlock = { parentId: pId, memberIds: [mId] };
          blocks.push(curBlock);
        } else {
          curBlock.memberIds.push(mId);
        }
      }

      if (blocks.length <= 1) {
        genAllocations.push({
          gen,
          chunks: [members],
          levelsNeeded: 1,
        });
        continue;
      }

      const chunks = partitionBlocksIntoChunks(blocks, factor);
      genAllocations.push({
        gen,
        chunks,
        levelsNeeded: chunks.length,
      });
    }

    const baseLevelForGen = new Map<number, number>();
    let curAssignedLevel = pLevel + 1;

    for (const alloc of genAllocations) {
      baseLevelForGen.set(alloc.gen, curAssignedLevel);
      curAssignedLevel += alloc.levelsNeeded;
    }

    const untouchedGroups: DesignSiblingGroup[] = [];

    siblingGroups.value.forEach(g => {
      const hasRecomputedDesc = g.memberIds.some(id => descSet.has(id) && !nestedChildDescSet.has(id));
      if (hasRecomputedDesc) {
        const remainingMembers = g.memberIds.filter(id => !descSet.has(id) || nestedChildDescSet.has(id));
        if (remainingMembers.length > 0) {
          untouchedGroups.push({
            ...g,
            memberIds: remainingMembers,
            isUngrouped: remainingMembers.length === 1,
          });
        }
        return;
      }

      untouchedGroups.push(g);
    });

    const newDescendantGroups: DesignSiblingGroup[] = [];
    const activeProbandId = getProps().activeProbandId || '';

    for (const alloc of genAllocations) {
      const baseLvl = baseLevelForGen.get(alloc.gen)!;
      const K = alloc.chunks.length;

      for (let j = 0; j < K; j++) {
        const chunkMembers = alloc.chunks[j];
        const targetLvl = baseLvl + j;
        const w = getGroupWidth(chunkMembers.length);
        const pad = Math.max(0, Math.min(16, Math.floor((availableWidth - w) / 2)));

        let chunkX: number;
        if (K === 1) {
          chunkX = Math.round((bw.minX + bw.maxX) / 2);
        } else if (j === 0) {
          chunkX = Math.round(bw.minX + pad + w / 2);
        } else if (j === K - 1) {
          chunkX = Math.round(bw.maxX - pad - w / 2);
        } else {
          const fraction = j / (K - 1);
          const leftBound = bw.minX + pad + w / 2;
          const rightBound = bw.maxX - pad - w / 2;
          chunkX = Math.round(leftBound + fraction * (rightBound - leftBound));
        }

        const pFirst = personById.value.get(chunkMembers[0]);
        const genFirst = pFirst?.proband_data[activeProbandId]?.generation || alloc.gen;
        const allSameParent = chunkMembers.every(id => getBiologicalParentId(id) === getBiologicalParentId(chunkMembers[0]));
        const commonParentId = allSameParent ? getBiologicalParentId(chunkMembers[0]) : null;

        newDescendantGroups.push({
          id: `sg-desc-${personId}-gen-${alloc.gen}-part-${j}-${Date.now()}`,
          parentId: commonParentId,
          generation: genFirst,
          level: targetLvl,
          x: chunkX,
          memberIds: chunkMembers,
          isUngrouped: chunkMembers.length === 1,
        });
      }
    }

    const allUpdatedGroups = [...untouchedGroups, ...newDescendantGroups];
    const maxLvl = Math.max(1, ...allUpdatedGroups.map(g => g.level));

    const nextHeights: Record<number, number> = {};
    for (let l = 1; l <= maxLvl; l++) {
      nextHeights[l] = levelHeights.value[l] || DEFAULT_LEVEL_HEIGHT;
    }

    totalLevels.value = maxLvl;
    levelHeights.value = nextHeights;
    siblingGroups.value = allUpdatedGroups;

    const pGroup = siblingGroups.value.find(g => g.memberIds.includes(personId));
    if (pGroup) {
      const pW = getGroupWidth(pGroup.memberIds.length);
      const pPad = Math.max(0, Math.min(16, Math.floor((availableWidth - pW) / 2)));
      if (pGroup.x - pW / 2 < bw.minX + pPad) {
        pGroup.x = Math.round(bw.minX + pPad + pW / 2);
      } else if (pGroup.x + pW / 2 > bw.maxX - pPad) {
        pGroup.x = Math.round(bw.maxX - pPad - pW / 2);
      }
    }

    const newLevels = new Set(newDescendantGroups.map(g => g.level));
    for (const l of newLevels) {
      expandAndResolveLevelOverlaps(l);
    }
  }

  function removeBranchWidth(personId: string) {
    pushHistoryState();
    branchWidths.value.delete(personId);
  }

  function isPersonSelected(personId: string): boolean {
    const sel = activeDesignPersonId.value || getProps().selectedId;
    return Boolean(sel && sel === personId);
  }

  function selectCardPerson(person: DesignPerson) {
    if (didMoveGroup) return;
    activeDesignPersonId.value = person.id;
    onSelectPerson(person);
  }

  function groupDescendantsByLevel(personId: string) {
    const descSet = getDescendantPersonIds(personId);
    if (descSet.size === 0) return;

    pushHistoryState();

    if (!expandedParentIds.value.has(personId)) {
      const nextExp = new Set(expandedParentIds.value);
      const q = [personId];
      while (q.length > 0) {
        const curr = q.shift()!;
        nextExp.add(curr);
        const kids = childrenMapByParentId.value.get(curr) || [];
        kids.forEach(k => q.push(k));
      }
      expandedParentIds.value = nextExp;
    }

    let curGroups = [...siblingGroups.value];
    const pGroupIdx = curGroups.findIndex(g => g.memberIds.includes(personId));
    if (pGroupIdx === -1) return;
    const origPGroup = curGroups[pGroupIdx];
    const pLevel = origPGroup.level;

    const origPW = getGroupWidth(origPGroup.memberIds.length);
    const origPLeft = origPGroup.x - origPW / 2;
    const pIdxInGroup = origPGroup.memberIds.indexOf(personId);
    const pCardLeft = origPLeft + pIdxInGroup * CARD_WIDTH;
    const pCardRight = pCardLeft + CARD_WIDTH;
    let pCenterX = Math.round(pCardLeft + CARD_WIDTH / 2);

    let isolatedPGroupId = origPGroup.id;
    if (origPGroup.memberIds.length > 1) {
      const leftMembers = origPGroup.memberIds.slice(0, pIdxInGroup);
      const rightMembers = origPGroup.memberIds.slice(pIdxInGroup + 1);
      const replacementGroups: DesignSiblingGroup[] = [];

      if (leftMembers.length > 0) {
        const lw = getGroupWidth(leftMembers.length);
        replacementGroups.push({
          id: `sg-split-left-${Date.now()}-${origPGroup.id}`,
          parentId: origPGroup.parentId,
          generation: origPGroup.generation,
          level: pLevel,
          x: Math.round(pCardLeft - 20 - lw / 2),
          memberIds: leftMembers,
          isUngrouped: leftMembers.length === 1,
        });
      }

      isolatedPGroupId = `sg-isolated-${personId}-${Date.now()}`;
      replacementGroups.push({
        id: isolatedPGroupId,
        parentId: origPGroup.parentId,
        generation: origPGroup.generation,
        level: pLevel,
        x: pCenterX,
        memberIds: [personId],
        isUngrouped: true,
      });

      if (rightMembers.length > 0) {
        const rw = getGroupWidth(rightMembers.length);
        replacementGroups.push({
          id: `sg-split-right-${Date.now()}-${origPGroup.id}`,
          parentId: origPGroup.parentId,
          generation: origPGroup.generation,
          level: pLevel,
          x: Math.round(pCardRight + 20 + rw / 2),
          memberIds: rightMembers,
          isUngrouped: rightMembers.length === 1,
        });
      }

      curGroups.splice(pGroupIdx, 1, ...replacementGroups);
    }

    const descByLevel = new Map<number, string[]>();
    const posXMap = new Map<string, number>();

    curGroups.forEach(g => {
      const w = getGroupWidth(g.memberIds.length);
      const left = g.x - w / 2;
      g.memberIds.forEach((mId, idx) => {
        posXMap.set(mId, left + idx * CARD_WIDTH + CARD_WIDTH / 2);
        if (descSet.has(mId) && g.level > pLevel) {
          if (!descByLevel.has(g.level)) {
            descByLevel.set(g.level, []);
          }
          descByLevel.get(g.level)!.push(mId);
        }
      });
    });

    if (descByLevel.size === 0) {
      curGroups.forEach(g => {
        g.memberIds.forEach(mId => {
          if (descSet.has(mId)) {
            if (!descByLevel.has(g.level)) {
              descByLevel.set(g.level, []);
            }
            descByLevel.get(g.level)!.push(mId);
          }
        });
      });
    }

    let updatedGroups: DesignSiblingGroup[] = [];
    const newDescGroupIds: string[] = [];
    let maxDescSpan = CARD_WIDTH;

    const descLevels = new Set(descByLevel.keys());

    curGroups.forEach(g => {
      if (!descLevels.has(g.level)) {
        updatedGroups.push(g);
        return;
      }
      const nonDescMembers = g.memberIds.filter(id => !descSet.has(id));
      if (nonDescMembers.length > 0) {
        updatedGroups.push({
          ...g,
          memberIds: nonDescMembers,
          isUngrouped: nonDescMembers.length === 1,
        });
      }
    });

    const activeProbandId = getProps().activeProbandId || '';

    descByLevel.forEach((descIds, level) => {
      if (descIds.length === 0) return;

      descIds.sort((a, b) => {
        const pA = getBiologicalParentId(a) || '';
        const pB = getBiologicalParentId(b) || '';
        if (pA !== pB) {
          const posXA = posXMap.get(pA) ?? 0;
          const posXB = posXMap.get(pB) ?? 0;
          if (posXA !== posXB) return posXA - posXB;
          return pA.localeCompare(pB);
        }
        const personA = personById.value.get(a);
        const personB = personById.value.get(b);
        if (personA && personB) {
          const birthCmp = comparePersonsByBirth(personA, personB);
          if (birthCmp !== 0) return birthCmp;
        }
        return (posXMap.get(a) ?? 0) - (posXMap.get(b) ?? 0);
      });

      const groupW = getGroupWidth(descIds.length);
      if (groupW > maxDescSpan) {
        maxDescSpan = groupW;
      }

      const firstPerson = personById.value.get(descIds[0]);
      const gen = firstPerson?.proband_data[activeProbandId]?.generation || level;
      const allSameParent = descIds.every(id => getBiologicalParentId(id) === getBiologicalParentId(descIds[0]));
      const commonParentId = allSameParent ? getBiologicalParentId(descIds[0]) : null;

      const newGrpId = `sg-desc-${personId}-lvl-${level}-${Date.now()}`;
      newDescGroupIds.push(newGrpId);
      updatedGroups.push({
        id: newGrpId,
        parentId: commonParentId,
        generation: gen,
        level,
        x: pCenterX,
        memberIds: descIds,
        isUngrouped: descIds.length === 1,
      });
    });

    const RESERVED_PADDING = 16;
    const reservedW = maxDescSpan + 2 * RESERVED_PADDING;
    let reservedMinX = Math.round(pCenterX - reservedW / 2);
    let reservedMaxX = Math.round(pCenterX + reservedW / 2);

    const minAllowedCanvasX = LEVEL_SIDEBAR_W + 16;
    if (reservedMinX < minAllowedCanvasX) {
      const shift = minAllowedCanvasX - reservedMinX;
      pCenterX += shift;
      reservedMinX += shift;
      reservedMaxX += shift;
      updatedGroups.forEach(g => {
        if (g.memberIds.includes(personId) || newDescGroupIds.includes(g.id)) {
          g.x += shift;
        }
      });
    }

    const groupsOnPLevel = updatedGroups.filter(g => g.level === pLevel && !g.memberIds.includes(personId));
    const leftNeighborIds = new Set<string>();
    const rightNeighborIds = new Set<string>();

    groupsOnPLevel.forEach(g => {
      if (g.x <= pCenterX) {
        g.memberIds.forEach(id => leftNeighborIds.add(id));
      } else {
        g.memberIds.forEach(id => rightNeighborIds.add(id));
      }
    });

    const leftNeighborDescIds = new Set<string>();
    leftNeighborIds.forEach(id => {
      for (const d of getDescendantPersonIds(id)) {
        leftNeighborDescIds.add(d);
      }
    });

    const rightNeighborDescIds = new Set<string>();
    rightNeighborIds.forEach(id => {
      for (const d of getDescendantPersonIds(id)) {
        rightNeighborDescIds.add(d);
      }
    });

    const targetLevels = new Set<number>();
    for (let l = pLevel; l <= totalLevels.value; l++) {
      targetLevels.add(l);
    }

    const otherGroupsOnTargetLevels = updatedGroups.filter(g =>
      targetLevels.has(g.level) &&
      !g.memberIds.includes(personId) &&
      !newDescGroupIds.includes(g.id)
    );

    const leftSideGroups: DesignSiblingGroup[] = [];
    const rightSideGroups: DesignSiblingGroup[] = [];

    otherGroupsOnTargetLevels.forEach(g => {
      const hasLeftDesc = g.memberIds.some(id => leftNeighborDescIds.has(id));
      const hasRightDesc = g.memberIds.some(id => rightNeighborDescIds.has(id));

      if (hasLeftDesc && !hasRightDesc) {
        leftSideGroups.push(g);
        if (g.x > pCenterX) {
          g.x = reservedMinX - 30;
        }
      } else if (hasRightDesc && !hasLeftDesc) {
        rightSideGroups.push(g);
        if (g.x < pCenterX) {
          g.x = reservedMaxX + 30;
        }
      } else {
        if (g.x <= pCenterX) {
          leftSideGroups.push(g);
        } else {
          rightSideGroups.push(g);
        }
      }
    });

    const parentAreaId = getParentReservedAreaId(personId);
    if (parentAreaId) {
      const parentBw = branchWidths.value.get(parentAreaId)!;
      if (reservedMinX < parentBw.minX + 8) {
        const expandLeft = (parentBw.minX + 8) - reservedMinX;
        parentBw.minX -= expandLeft;
      }
      if (reservedMaxX > parentBw.maxX - 8) {
        const expandRight = reservedMaxX - (parentBw.maxX - 8);
        parentBw.maxX += expandRight;
      }

      const parentDescSet = getDescendantPersonIds(parentAreaId);
      const nestedGroups = updatedGroups.filter(g =>
        !newDescGroupIds.includes(g.id) &&
        !g.memberIds.includes(personId) &&
        g.memberIds.some(id => parentDescSet.has(id) || id === parentAreaId)
      );

      nestedGroups.sort((a, b) => b.level - a.level);
      for (const g of nestedGroups) {
        const w = getGroupWidth(g.memberIds.length);
        if (g.x <= pCenterX) {
          if (g.x + w / 2 > reservedMinX - 12) {
            g.x = Math.round(reservedMinX - 12 - w / 2);
          }
        } else {
          if (g.x - w / 2 < reservedMaxX + 12) {
            g.x = Math.round(reservedMaxX + 12 + w / 2);
          }
        }
      }

      nestedGroups.forEach(g => {
        const w = getGroupWidth(g.memberIds.length);
        const l = g.x - w / 2;
        const r = g.x + w / 2;
        if (l < parentBw.minX + 8) parentBw.minX = l - 8;
        if (r > parentBw.maxX - 8) parentBw.maxX = r + 8;
      });

      branchWidths.value.set(personId, {
        personId,
        minX: reservedMinX,
        maxX: reservedMaxX,
      });

      siblingGroups.value = updatedGroups;
      for (let l = pLevel; l <= totalLevels.value; l++) {
        expandAndResolveLevelOverlaps(l);
      }
      return;
    }

    const MIN_GAP = 20;
    const existingOtherBws: BranchWidthConstraint[] = [];
    branchWidths.value.forEach((bw, pId) => {
      if (pId !== personId) {
        existingOtherBws.push(bw);
      }
    });

    const leftOtherBws = existingOtherBws.filter(bw => (bw.minX + bw.maxX) / 2 <= pCenterX);
    const rightOtherBws = existingOtherBws.filter(bw => (bw.minX + bw.maxX) / 2 > pCenterX);

    let maxLeftEdge = -Infinity;
    leftSideGroups.forEach(g => {
      const r = g.x + getGroupWidth(g.memberIds.length) / 2;
      if (r > maxLeftEdge) maxLeftEdge = r;
    });
    leftOtherBws.forEach(bw => {
      if (bw.maxX > maxLeftEdge) maxLeftEdge = bw.maxX;
    });

    const targetLeftBoundary = reservedMinX - MIN_GAP;
    let shiftLeft = 0;
    if (maxLeftEdge > targetLeftBoundary) {
      shiftLeft = maxLeftEdge - targetLeftBoundary;
      leftSideGroups.forEach(g => {
        g.x -= shiftLeft;
      });
      leftOtherBws.forEach(bw => {
        bw.minX -= shiftLeft;
        bw.maxX -= shiftLeft;
        const nested = getAllNestedReservedAreaIds(bw.personId);
        nested.forEach(nId => {
          const nBw = branchWidths.value.get(nId);
          if (nBw) {
            nBw.minX -= shiftLeft;
            nBw.maxX -= shiftLeft;
          }
        });
      });
    }

    let minRightEdge = Infinity;
    rightSideGroups.forEach(g => {
      const l = g.x - getGroupWidth(g.memberIds.length) / 2;
      if (l < minRightEdge) minRightEdge = l;
    });
    rightOtherBws.forEach(bw => {
      if (bw.minX < minRightEdge) minRightEdge = bw.minX;
    });

    const targetRightBoundary = reservedMaxX + MIN_GAP;
    let shiftRight = 0;
    if (minRightEdge < targetRightBoundary) {
      shiftRight = targetRightBoundary - minRightEdge;
      rightSideGroups.forEach(g => {
        g.x += shiftRight;
      });
      rightOtherBws.forEach(bw => {
        bw.minX += shiftRight;
        bw.maxX += shiftRight;
        const nested = getAllNestedReservedAreaIds(bw.personId);
        nested.forEach(nId => {
          const nBw = branchWidths.value.get(nId);
          if (nBw) {
            nBw.minX += shiftRight;
            nBw.maxX += shiftRight;
          }
        });
      });
    }

    let minAllX = reservedMinX;
    updatedGroups.forEach(g => {
      const l = g.x - getGroupWidth(g.memberIds.length) / 2;
      if (l < minAllX) minAllX = l;
    });
    existingOtherBws.forEach(bw => {
      if (bw.minX < minAllX) minAllX = bw.minX;
    });

    if (minAllX < minAllowedCanvasX) {
      const underflow = minAllowedCanvasX - minAllX;
      updatedGroups.forEach(g => {
        g.x += underflow;
      });
      existingOtherBws.forEach(bw => {
        bw.minX += underflow;
        bw.maxX += underflow;
      });
      reservedMinX += underflow;
      reservedMaxX += underflow;
    }

    branchWidths.value.set(personId, {
      personId,
      minX: reservedMinX,
      maxX: reservedMaxX,
    });

    siblingGroups.value = updatedGroups;

    for (let l = pLevel; l <= totalLevels.value; l++) {
      expandAndResolveLevelOverlaps(l);
    }
  }

  function expandAndResolveLevelOverlaps(targetLevel: number, anchorGroupIds?: Set<string>) {
    const groupsOnLevel = siblingGroups.value.filter(g => g.level === targetLevel);
    if (groupsOnLevel.length <= 1) {
      if (groupsOnLevel.length === 1) {
        const w = getGroupWidth(groupsOnLevel[0].memberIds.length);
        const minLeft = LEVEL_SIDEBAR_W + 16;
        if (groupsOnLevel[0].x - w / 2 < minLeft) {
          groupsOnLevel[0].x = Math.round(minLeft + w / 2);
        }
      }
      return;
    }

    const MIN_GAP = 20;
    const minAllowedLeft = LEVEL_SIDEBAR_W + 16;

    const anchorGroups = anchorGroupIds && anchorGroupIds.size > 0
      ? groupsOnLevel.filter(g => anchorGroupIds.has(g.id))
      : [];

    if (anchorGroups.length > 0) {
      const anchorIds = new Set(anchorGroups.map(g => g.id));
      const anchorMinLeft = Math.min(...anchorGroups.map(g => g.x - getGroupWidth(g.memberIds.length) / 2));
      const anchorMaxRight = Math.max(...anchorGroups.map(g => g.x + getGroupWidth(g.memberIds.length) / 2));
      const anchorCenter = (anchorMinLeft + anchorMaxRight) / 2;

      const nonAnchors = groupsOnLevel.filter(g => !anchorIds.has(g.id));
      const leftOthers = nonAnchors.filter(g => g.x <= anchorCenter).sort((a, b) => b.x - a.x);
      const rightOthers = nonAnchors.filter(g => g.x > anchorCenter).sort((a, b) => a.x - b.x);

      let rightBoundary = anchorMaxRight;
      for (const rg of rightOthers) {
        const w = getGroupWidth(rg.memberIds.length);
        let curLeft = rg.x - w / 2;
        const isDocked = Math.abs(curLeft - rightBoundary) <= 2;
        if (isDocked) {
          rg.x = Math.round(rightBoundary + w / 2);
          curLeft = rightBoundary;
        } else if (curLeft < rightBoundary + MIN_GAP) {
          const newLeft = rightBoundary + MIN_GAP;
          rg.x = Math.round(newLeft + w / 2);
          curLeft = newLeft;
        }
        rightBoundary = curLeft + w;
      }

      let leftBoundary = anchorMinLeft;
      for (const lg of leftOthers) {
        const w = getGroupWidth(lg.memberIds.length);
        let curRight = lg.x + w / 2;
        const isDocked = Math.abs(curRight - leftBoundary) <= 2;
        if (isDocked) {
          lg.x = Math.round(leftBoundary - w / 2);
          curRight = leftBoundary;
        } else if (curRight > leftBoundary - MIN_GAP) {
          const newRight = leftBoundary - MIN_GAP;
          lg.x = Math.round(newRight - w / 2);
          curRight = newRight;
        }
        leftBoundary = curRight - w;
      }

      const curMinLeft = Math.min(...groupsOnLevel.map(g => g.x - getGroupWidth(g.memberIds.length) / 2));
      if (curMinLeft < minAllowedLeft) {
        const shiftRight = minAllowedLeft - curMinLeft;
        groupsOnLevel.forEach(g => {
          g.x = Math.round(g.x + shiftRight);
        });
      }
    }

    groupsOnLevel.sort((a, b) => a.x - b.x);

    const firstW = getGroupWidth(groupsOnLevel[0].memberIds.length);
    if (groupsOnLevel[0].x - firstW / 2 < minAllowedLeft) {
      groupsOnLevel[0].x = Math.round(minAllowedLeft + firstW / 2);
    }

    for (let i = 1; i < groupsOnLevel.length; i++) {
      const prev = groupsOnLevel[i - 1];
      const curr = groupsOnLevel[i];
      const prevW = getGroupWidth(prev.memberIds.length);
      const currW = getGroupWidth(curr.memberIds.length);
      const prevRight = prev.x + prevW / 2;
      const currLeft = curr.x - currW / 2;

      const isDocked = Math.abs(currLeft - prevRight) <= 2;
      if (isDocked) {
        curr.x = Math.round(prevRight + currW / 2);
      } else if (currLeft < prevRight + MIN_GAP) {
        const newLeft = prevRight + MIN_GAP;
        curr.x = Math.round(newLeft + currW / 2);
      }
    }
  }

  // Kanten-Segmente (starten und enden direkt an den Kästchen der Einträge) & Linienbrücken bei Kreuzungen
  const edgeGeometry = computed<EdgeGeometry>(() => {
    const rawSegments: LineSegment[] = [];
    const arrows: ArrowHead[] = [];
    const anchors: AnchorPoint[] = [];

    const childrenByParentAndLevel = new Map<string, Map<number, CardBox[]>>();

    cardBoxByPersonId.value.forEach(cb => {
      const henryParentId = parentIdByChildIdMap.value.get(cb.person.id) ?? null;
      const pId = resolvePatrilinearParentId(cb.person, cardBoxByPersonId.value, henryParentId);
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

    interface CorridorRelation {
      parentId: string;
      childLevel: number;
      corridorLevel: number;
      direction: 'up' | 'same' | 'down';
      pBox: CardBox;
      cBoxes: CardBox[];
      minChildX: number;
      maxChildX: number;
    }

    const relationsByCorridor = new Map<number, CorridorRelation[]>();

    childrenByParentAndLevel.forEach((levelMap, parentId) => {
      const pBox = cardBoxByPersonId.value.get(parentId);
      if (!pBox) return;

      levelMap.forEach((cBoxes, childLevel) => {
        cBoxes.sort((a, b) => a.centerX - b.centerX);
        const minChildX = Math.min(...cBoxes.map(c => c.centerX));
        const maxChildX = Math.max(...cBoxes.map(c => c.centerX));

        const direction: 'up' | 'same' | 'down' =
          childLevel > pBox.level ? 'up' : (childLevel === pBox.level ? 'same' : 'down');
        const corridorLevel = direction === 'down' ? pBox.level : childLevel;

        if (!relationsByCorridor.has(corridorLevel)) {
          relationsByCorridor.set(corridorLevel, []);
        }
        relationsByCorridor.get(corridorLevel)!.push({
          parentId,
          childLevel,
          corridorLevel,
          direction,
          pBox,
          cBoxes,
          minChildX,
          maxChildX,
        });
      });
    });

    const propsSnap = getProps();
    const gap = Math.max(10, propsSnap.horizontalLaneGap || 16);
    const bridgeRadius = Math.max(4, Math.min(20, propsSnap.bridgeRadius || 8));
    const enableBridges = propsSnap.enableLineBridges !== false;

    relationsByCorridor.forEach((relations, corridorLevel) => {
      relations.sort((a, b) => {
        const aCenter = (a.minChildX + a.maxChildX) / 2;
        const bCenter = (b.minChildX + b.maxChildX) / 2;
        return aCenter - bCenter;
      });

      const corridorDir = relations[0]?.direction || 'up';

      // 1. Relationen mit tatsächlichem horizontalen Balken ermitteln
      interface PreparedRelation {
        rel: CorridorRelation;
        groupTargets: { targetX: number; targetY: number; isHighlighted: boolean; key: string }[];
        barMinX: number;
        barMaxX: number;
        hasBar: boolean;
        item?: SiblingBarItem;
      }

      const preparedRelations: PreparedRelation[] = relations.map(rel => {
        const { parentId, childLevel, pBox, cBoxes, direction } = rel;
        const commonEdgeKey = `edge-${parentId}-lvl${childLevel}`;
        const activeSel = activeDesignPersonId.value || propsSnap.selectedId;
        const highlightedPathIds = propsSnap.highlightedPathIds;

        const childGroupings = partitionIntoChildGroupings(cBoxes);

        const groupTargets: { targetX: number; targetY: number; isHighlighted: boolean; key: string }[] = [];
        let targetIdx = 0;
        childGroupings.forEach((boxes) => {
          const minL = Math.min(...boxes.map(c => c.left));
          const maxR = Math.max(...boxes.map(c => c.right));
          const targetX = Math.round((minL + maxR) / 2);
          const targetY = direction === 'down'
            ? Math.min(...boxes.map(c => c.top))
            : Math.max(...boxes.map(c => c.bottom));

          const isTargetHighlighted =
            Boolean(activeSel && (activeSel === parentId || boxes.some(c => c.person.id === activeSel))) ||
            Boolean(
              highlightedPathIds && highlightedPathIds.size > 0 &&
              highlightedPathIds.has(parentId) &&
              boxes.some(c => highlightedPathIds.has(c.person.id))
            );

          groupTargets.push({
            targetX,
            targetY,
            isHighlighted: isTargetHighlighted,
            key: `${commonEdgeKey}-grp${targetIdx++}`,
          });
        });

        const allTargetXs = groupTargets.map(t => t.targetX);
        const stemX = pBox.centerX;
        const barMinX = Math.min(stemX, ...allTargetXs);
        const barMaxX = Math.max(stemX, ...allTargetXs);
        const hasBar = barMaxX - barMinX > 1;

        const item: SiblingBarItem | undefined = hasBar
          ? {
              parentId: rel.parentId,
              parentX: stemX,
              minChildX: Math.min(...allTargetXs),
              maxChildX: Math.max(...allTargetXs),
              childrenX: allTargetXs,
            }
          : undefined;

        return {
          rel,
          groupTargets,
          barMinX,
          barMaxX,
          hasBar,
          item,
        };
      });

      // 2. Nur Relationen mit horizontalem Balken erhalten eine Höhenstufe (Lane)
      const barRelations = preparedRelations.filter(p => p.hasBar);
      const barItems = barRelations.map(p => p.item!);
      const { lanes: barLanes } = assignNonOverlappingLanes(barItems, corridorDir);

      let barRelIdx = 0;
      preparedRelations.forEach(prep => {
        const { rel, groupTargets, barMinX, barMaxX, hasBar } = prep;
        const { parentId, childLevel, pBox, cBoxes, direction } = rel;
        const commonEdgeKey = `edge-${parentId}-lvl${childLevel}`;
        const activeSel = activeDesignPersonId.value || propsSnap.selectedId;
        const highlightedPathIds = propsSnap.highlightedPathIds;
        const isCommonHighlighted =
          Boolean(activeSel && (activeSel === parentId || cBoxes.some(c => c.person.id === activeSel))) ||
          Boolean(
            highlightedPathIds && highlightedPathIds.size > 0 &&
            highlightedPathIds.has(parentId) &&
            cBoxes.some(c => highlightedPathIds.has(c.person.id))
          );

        const stemX = pBox.centerX;
        const startY = direction === 'down' ? pBox.bottom : pBox.top;

        // Ausgangs-Anknüpfpunkt (Halbkreis) an der oberen/unteren Kante der Elternkachel
        const anchorRadius = 7;
        const anchorD = direction === 'down'
          ? `M ${stemX - anchorRadius} ${startY} A ${anchorRadius} ${anchorRadius} 0 0 0 ${stemX + anchorRadius} ${startY} Z`
          : `M ${stemX - anchorRadius} ${startY} A ${anchorRadius} ${anchorRadius} 0 0 1 ${stemX + anchorRadius} ${startY} Z`;

        const existingAnchor = anchors.find(a => Math.abs(a.x - stemX) < 1 && Math.abs(a.y - startY) < 1);
        if (existingAnchor) {
          if (isCommonHighlighted) existingAnchor.isHighlighted = true;
        } else {
          anchors.push({
            x: stemX,
            y: startY,
            d: anchorD,
            isHighlighted: isCommonHighlighted,
          });
        }

        if (!hasBar) {
          // Gerade Verbindung (kein horizontaler Abschnitt nötig)
          const targetY = groupTargets[0]?.targetY ?? startY;
          rawSegments.push({
            id: `${commonEdgeKey}-straight`,
            edgeKey: commonEdgeKey,
            x1: stemX,
            y1: startY,
            x2: stemX,
            y2: targetY,
            isHighlighted: isCommonHighlighted,
          });

          arrows.push({
            x: stemX,
            y: targetY,
            direction: direction === 'down' ? 'down' : 'up',
            isHighlighted: isCommonHighlighted,
          });
          return;
        }

        // Horizontale Linienführung auf der optimalen Lane
        const assignedLane = barLanes[barRelIdx++];
        const laneOffset = assignedLane * gap;
        const levelMaxBottom = levelLayoutMetrics.value.levelMaxCardBottom[corridorLevel]
          || (getLevelBandTopY(corridorLevel) + LEVEL_CARD_PAD_TOP + getMaxCardHeightForLevel(corridorLevel));
        const jogY = levelMaxBottom + CORRIDOR_PAD_TOP + laneOffset;

        // Stammsegment vom Eltern-Anknüpfpunkt zur Querlinie
        rawSegments.push({
          id: `${commonEdgeKey}-stem`,
          edgeKey: commonEdgeKey,
          x1: stemX,
          y1: startY,
          x2: stemX,
          y2: jogY,
          isHighlighted: isCommonHighlighted,
        });

        // Horizontaler Verbindungsbalken
        rawSegments.push({
          id: `${commonEdgeKey}-bar`,
          edgeKey: commonEdgeKey,
          x1: barMinX,
          y1: jogY,
          x2: barMaxX,
          y2: jogY,
          isHighlighted: isCommonHighlighted,
        });

        // Abgänge zu den Zielkacheln / -gruppen mit eingehenden Pfeilen
        groupTargets.forEach(tgt => {
          rawSegments.push({
            id: tgt.key,
            edgeKey: commonEdgeKey,
            x1: tgt.targetX,
            y1: jogY,
            x2: tgt.targetX,
            y2: tgt.targetY,
            isHighlighted: tgt.isHighlighted,
          });

          arrows.push({
            x: tgt.targetX,
            y: tgt.targetY,
            direction: direction === 'down' ? 'down' : 'up',
            isHighlighted: tgt.isHighlighted,
          });
        });
      });
    });

    const isDragging = draggingGroupId.value !== null;
    const bridgesBySegIdx = new Map<number, number[]>();
    let totalBridgesCount = 0;

    if (enableBridges && !isDragging) {
      const minClearance = 0.5;

      interface HorizSegInfo {
        idx: number;
        edgeKey: string;
        y: number;
        minX: number;
        maxX: number;
        x1: number;
        len: number;
      }
      interface VertSegInfo {
        idx: number;
        edgeKey: string;
        x: number;
        minY: number;
        maxY: number;
        len: number;
      }

      const hSegs: HorizSegInfo[] = [];
      const vSegs: VertSegInfo[] = [];

      for (let i = 0; i < rawSegments.length; i++) {
        const s = rawSegments[i];
        const dx = s.x2 - s.x1;
        const dy = s.y2 - s.y1;
        const isHoriz = Math.abs(dy) < 0.5;
        const isVert = Math.abs(dx) < 0.5;
        const len = isHoriz ? Math.abs(dx) : (isVert ? Math.abs(dy) : Math.hypot(dx, dy));
        if (len < 4) continue;

        if (isHoriz) {
          hSegs.push({
            idx: i,
            edgeKey: s.edgeKey,
            y: s.y1,
            minX: Math.min(s.x1, s.x2),
            maxX: Math.max(s.x1, s.x2),
            x1: s.x1,
            len,
          });
        } else if (isVert) {
          vSegs.push({
            idx: i,
            edgeKey: s.edgeKey,
            x: s.x1,
            minY: Math.min(s.y1, s.y2),
            maxY: Math.max(s.y1, s.y2),
            len,
          });
        }
      }

      for (let h = 0; h < hSegs.length; h++) {
        const hs = hSegs[h];
        const hMinX = hs.minX + minClearance;
        const hMaxX = hs.maxX - minClearance;
        if (hMinX >= hMaxX) continue;

        for (let v = 0; v < vSegs.length; v++) {
          const vs = vSegs[v];
          if (hs.idx === vs.idx) continue;
          if (vs.x <= hMinX || vs.x >= hMaxX) continue;
          if (hs.y <= vs.minY + minClearance || hs.y >= vs.maxY - minClearance) continue;

          const dist = Math.abs(vs.x - hs.x1);
          if (!bridgesBySegIdx.has(hs.idx)) {
            bridgesBySegIdx.set(hs.idx, []);
          }
          bridgesBySegIdx.get(hs.idx)!.push(dist);
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
          const effR = Math.min(bridgeRadius, Math.max(3, Math.min(d - 1, len - d - 1)));
          const s = Math.max(0.5, d - effR);
          const e = Math.min(len - 0.5, d + effR);
          if (e <= s + 1) return;
          if (intervals.length > 0 && s <= intervals[intervals.length - 1].end + 2) {
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
      anchors,
      totalBridgesCount,
    };
  });

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

        const isTouching = Math.abs(cRight - oLeft) <= 2 || Math.abs(cLeft - oRight) <= 2;
        if (isTouching) {
          visited.add(other.id);
          queue.push(other);
        }
      }
    }

    return cluster;
  }

  let dragRafId: number | null = null;
  let pendingDragEvent: MouseEvent | null = null;
  let dragBranchMinDx = -Infinity;
  let dragBranchMaxDx = Infinity;
  let dragBranchFixedDx: number | null = null;

  function startGroupDrag(e: MouseEvent, group: DesignSiblingGroup) {
    if (e.button !== 0 || group.isReadOnly) return;
    e.stopPropagation();
    beginDragSnapshot();
    draggingGroupId.value = group.id;
    didMoveGroup = false;
    groupDragStartMouse = { x: e.clientX, y: e.clientY };
    groupDragStartPos = { x: group.x, level: group.level };
    dragHoverInsertAboveLevel.value = null;
    activeSnapGuideX.value = null;

    const cluster = getDockedCluster(group);
    draggingCluster.value = cluster.map(g => ({
      group: g,
      startX: g.x,
      startLevel: g.level,
      width: getGroupWidth(g.memberIds.length),
    }));

    dragBranchMinDx = -Infinity;
    dragBranchMaxDx = Infinity;
    dragBranchFixedDx = null;

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
          dragBranchFixedDx = Math.round((bw.minX + bw.maxX) / 2) - Math.round((subMinLeft + subMaxRight) / 2);
        } else {
          const minAllowedDx = bw.minX - subMinLeft;
          const maxAllowedDx = bw.maxX - subMaxRight;
          dragBranchMinDx = Math.max(dragBranchMinDx, minAllowedDx);
          dragBranchMaxDx = Math.min(dragBranchMaxDx, maxAllowedDx);
        }
      }
    });

    window.addEventListener('mousemove', onWindowGroupDragMove);
    window.addEventListener('mouseup', onWindowGroupDragEnd);
  }

  function handleGroupDragMove(e: MouseEvent) {
    if (!draggingGroupId.value || draggingCluster.value.length === 0) return;

    const dxScreen = e.clientX - groupDragStartMouse.x;
    const dyScreen = e.clientY - groupDragStartMouse.y;
    if (Math.hypot(dxScreen, dyScreen) > 4) {
      didMoveGroup = true;
    }

    const dxCanvas = dxScreen / zoom.value;
    const dyCanvas = dyScreen / zoom.value;

    const clusterMinLeft = Math.min(...draggingCluster.value.map(m => m.startX - m.width / 2));
    const clusterMaxRight = Math.max(...draggingCluster.value.map(m => m.startX + m.width / 2));

    const minAllowedLeft = LEVEL_SIDEBAR_W + 12;
    let candidateDx = Math.round(dxCanvas);
    if (clusterMinLeft + candidateDx < minAllowedLeft) {
      candidateDx = minAllowedLeft - clusterMinLeft;
    }

    if (dragBranchFixedDx !== null) {
      candidateDx = dragBranchFixedDx;
    } else {
      candidateDx = Math.max(dragBranchMinDx, Math.min(dragBranchMaxDx, candidateDx));
    }

    const startCenterY = getGroupTopY(groupDragStartPos.level) + getMaxCardHeightForLevel(groupDragStartPos.level) / 2;
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

    const clusterWidth = clusterMaxRight - clusterMinLeft;
    const rawCandidateLeft = clusterMinLeft + candidateDx;
    const rawCandidateRight = rawCandidateLeft + clusterWidth;

    let candidateLeft = rawCandidateLeft;
    let candidateRight = rawCandidateRight;
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

    let bestSnapDist = SNAP_DISTANCE;
    for (const other of othersOnLevel) {
      const distLeftToRight = Math.abs(rawCandidateLeft - other.right);
      if (distLeftToRight < bestSnapDist) {
        bestSnapDist = distLeftToRight;
        candidateLeft = other.right;
        candidateRight = candidateLeft + clusterWidth;
        snapEdgeX = other.right;
      }

      const distRightToLeft = Math.abs(rawCandidateRight - other.left);
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

    draggingCluster.value.forEach(m => {
      m.group.x = Math.round(m.startX + effectiveDx);
    });
  }

  function onWindowGroupDragMove(e: MouseEvent) {
    pendingDragEvent = e;
    if (dragRafId === null) {
      dragRafId = requestAnimationFrame(() => {
        dragRafId = null;
        if (pendingDragEvent) {
          handleGroupDragMove(pendingDragEvent);
          pendingDragEvent = null;
        }
      });
    }
  }

  function onWindowGroupDragEnd() {
    if (dragRafId !== null) {
      cancelAnimationFrame(dragRafId);
      dragRafId = null;
    }
    if (pendingDragEvent) {
      handleGroupDragMove(pendingDragEvent);
      pendingDragEvent = null;
    }

    commitDragSnapshot(didMoveGroup);

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

    const finalClusterIds = draggingClusterGroupIds.value;
    if (finalClusterIds.size > 0 && draggingCluster.value.length > 0) {
      const targetLvl = draggingCluster.value[0].group.level;
      expandAndResolveLevelOverlaps(targetLvl, finalClusterIds);

      const originLvl = groupDragStartPos.level;
      if (originLvl !== targetLvl) {
        expandAndResolveLevelOverlaps(originLvl);
      }
    }

    draggingGroupId.value = null;
    draggingCluster.value = [];
    dragHoverInsertAboveLevel.value = null;
    activeSnapGuideX.value = null;
    window.removeEventListener('mousemove', onWindowGroupDragMove);
    window.removeEventListener('mouseup', onWindowGroupDragEnd);
  }

  function ungroupAtPerson(group: DesignSiblingGroup, targetPersonId?: string, direction: 'left' | 'right' = 'right') {
    if (group.memberIds.length <= 1) return;
    pushHistoryState();
    const members = [...group.memberIds];
    const count = members.length;

    let effectivePersonId = targetPersonId;
    if (!effectivePersonId) {
      const selId = activeDesignPersonId.value || getProps().selectedId;
      if (selId && members.includes(selId)) {
        effectivePersonId = selId;
      } else {
        effectivePersonId = direction === 'left' ? members[members.length - 1] : members[0];
      }
    }

    const pIdx = members.indexOf(effectivePersonId);
    if (pIdx === -1) return;

    const pParentId = getBiologicalParentId(effectivePersonId);

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

    let cutIndex = -1;

    if (direction === 'left') {
      if (isPartOfSiblingGroup && sibStart > 0) {
        cutIndex = sibStart;
      } else {
        cutIndex = pIdx > 0 ? pIdx : 1;
      }
    } else {
      if (isPartOfSiblingGroup && sibEnd < count - 1) {
        cutIndex = sibEnd + 1;
      } else {
        cutIndex = pIdx < count - 1 ? pIdx + 1 : count - 1;
      }
    }

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
      rightCenterX = Math.round(origRight - rightW / 2);
      leftCenterX = Math.round(origRight - rightW - GAP - leftW / 2);
    } else {
      leftCenterX = Math.round(origLeft + leftW / 2);
      rightCenterX = Math.round(origLeft + leftW + GAP + rightW / 2);
    }

    const minAllowedLeft = LEVEL_SIDEBAR_W + 16;
    const curMinX = Math.round(leftCenterX - leftW / 2);
    if (curMinX < minAllowedLeft) {
      const shift = minAllowedLeft - curMinX;
      leftCenterX += shift;
      rightCenterX += shift;
    }

    const activeProbandId = getProps().activeProbandId || '';
    const leftGen = personById.value.get(leftMembers[0])?.proband_data[activeProbandId]?.generation || group.generation;
    const rightGen = personById.value.get(rightMembers[0])?.proband_data[activeProbandId]?.generation || group.generation;

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
      expandAndResolveLevelOverlaps(group.level, new Set([leftGroup.id, rightGroup.id]));
    }
  }

  function getSelectedOrAnchorPersonId(gl: GroupLayoutInfo): string {
    const selId = activeDesignPersonId.value || getProps().selectedId;
    const match = gl.cards.find(c => c.person.id === selId);
    return match ? match.person.id : gl.cards[0].person.id;
  }

  function regroupSelectedOrFirstInGroup(gl: GroupLayoutInfo) {
    const selId = activeDesignPersonId.value || getProps().selectedId;
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

  function groupAllInLevel(level: number) {
    const groupsOnLevel = siblingGroups.value.filter(g => g.level === level);
    if (groupsOnLevel.length <= 1) return;
    pushHistoryState();

    const rootGroup = siblingGroups.value.find(g => g.parentId === null);
    const treeCenterX = rootGroup ? rootGroup.x : 720;

    const activeBwsOnLevel: { personId: string; minX: number; maxX: number }[] = [];
    branchWidths.value.forEach(bw => {
      const rawPos = getRawPersonPosition(bw.personId);
      if (rawPos && level >= rawPos.level) {
        activeBwsOnLevel.push({ personId: bw.personId, minX: bw.minX, maxX: bw.maxX });
      }
    });

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

    zones.push({
      id: 'outside-left',
      type: 'outside-left',
      minX: -Infinity,
      maxX: firstBw.minX,
      bwRef: firstBw,
      groups: [],
    });

    activeBwsOnLevel.forEach((bw, idx) => {
      zones.push({
        id: `inside-${bw.personId}`,
        type: 'inside',
        minX: bw.minX,
        maxX: bw.maxX,
        bwRef: bw,
        groups: [],
      });

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

    zones.push({
      id: 'outside-right',
      type: 'outside-right',
      minX: lastBw.maxX,
      maxX: Infinity,
      bwRef: lastBw,
      groups: [],
    });

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
        targetX = Math.round((z.bwRef.minX + z.bwRef.maxX) / 2);
      } else if (z.type === 'between' && z.prevBwRef && z.nextBwRef) {
        targetX = Math.round((z.prevBwRef.maxX + z.nextBwRef.minX) / 2);
      } else if (z.type === 'outside-left' && z.bwRef) {
        const targetRight = z.bwRef.minX - 12;
        const calcX = Math.round(targetRight - totalW / 2);
        const minAllowedX = LEVEL_SIDEBAR_W + 16 + Math.round(totalW / 2);
        targetX = Math.max(minAllowedX, calcX);
      } else if (z.type === 'outside-right' && z.bwRef) {
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
    expandAndResolveLevelOverlaps(level);
  }

  function detachPersonFromGroup(targetGroup: DesignSiblingGroup, personId: string) {
    const p = personById.value.get(personId);
    if (!p) return;
    pushHistoryState();

    const descSet = getDescendantPersonIds(personId);

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

    const activeProbandId = getProps().activeProbandId || '';
    const personGen = p.proband_data[activeProbandId]?.generation || targetGroup.generation;
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

    expandAndResolveLevelOverlaps(origGroupLevel, new Set([groupForPerson.id]));
  }

  // Isoliert eine Stammperson (Zweiganker) aus ihrer Geschwistergruppe heraus, falls sie mit anderen Geschwistern zusammenliegt
  function isolateAnchorInSiblingGroups(anchorPersonId: string): boolean {
    const grpIdx = siblingGroups.value.findIndex(g => g.memberIds.includes(anchorPersonId));
    if (grpIdx < 0) return false;
    const group = siblingGroups.value[grpIdx];
    if (group.memberIds.length <= 1) return false;

    pushHistoryState();

    const members = [...group.memberIds];
    const idx = members.indexOf(anchorPersonId);
    if (idx < 0) return false;

    const leftMembers = members.slice(0, idx);
    const rightMembers = members.slice(idx + 1);

    const origTotalW = getGroupWidth(members.length);
    const origLeft = Math.round(group.x - origTotalW / 2);
    const GAP = 28;

    const anchorCenterX = Math.round(origLeft + idx * CARD_WIDTH + CARD_WIDTH / 2);

    const newGroups: DesignSiblingGroup[] = [];

    if (leftMembers.length > 0) {
      const leftW = getGroupWidth(leftMembers.length);
      const leftCenterX = Math.round(anchorCenterX - CARD_WIDTH / 2 - GAP - leftW / 2);
      newGroups.push({
        id: `sg-split-${anchorPersonId}-L-${Date.now()}`,
        parentId: group.parentId,
        generation: group.generation,
        level: group.level,
        x: leftCenterX,
        memberIds: leftMembers,
        isUngrouped: leftMembers.length === 1,
      });
    }

    const anchorGroup: DesignSiblingGroup = {
      id: `sg-anchor-${anchorPersonId}`,
      parentId: group.parentId,
      generation: group.generation,
      level: group.level,
      x: anchorCenterX,
      memberIds: [anchorPersonId],
      isUngrouped: true,
    };
    newGroups.push(anchorGroup);

    if (rightMembers.length > 0) {
      const rightW = getGroupWidth(rightMembers.length);
      const rightCenterX = Math.round(anchorCenterX + CARD_WIDTH / 2 + GAP + rightW / 2);
      newGroups.push({
        id: `sg-split-${anchorPersonId}-R-${Date.now()}`,
        parentId: group.parentId,
        generation: group.generation,
        level: group.level,
        x: rightCenterX,
        memberIds: rightMembers,
        isUngrouped: rightMembers.length === 1,
      });
    }

    const next = [...siblingGroups.value];
    next.splice(grpIdx, 1, ...newGroups);
    siblingGroups.value = next;
    expandAndResolveLevelOverlaps(group.level, new Set([anchorGroup.id]));
    return true;
  }

  function ensureAllSubtreeAnchorsIsolated(): boolean {
    const subRefs = options.subLayoutReferences?.value || {};
    let changed = false;
    for (const anchorId of Object.keys(subRefs)) {
      if (isolateAnchorInSiblingGroups(anchorId)) {
        changed = true;
      }
    }
    return changed;
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

    const mergedSiblings: string[] = [];
    matchingGroups.forEach(g => {
      g.memberIds.forEach(id => {
        if (bioSet.has(id) && !mergedSiblings.includes(id)) {
          mergedSiblings.push(id);
        }
      });
    });

    if (mergedSiblings.length <= 1) return;

    const anchorGroup = matchingGroups.find(g => g.memberIds.includes(personId)) || matchingGroups[0];
    const avgX = Math.round(matchingGroups.reduce((acc, g) => acc + g.x, 0) / matchingGroups.length);

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

    siblingGroups.value = siblingGroups.value
      .filter(g => g.memberIds.length > 0)
      .concat(mergedGroup);

    expandAndResolveLevelOverlaps(anchorGroup.level, new Set([mergedGroup.id]));
  }

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

    expandAndResolveLevelOverlaps(group.level, clusterIds);
  }

  function moveGroupLevel(group: DesignSiblingGroup, delta: number) {
    const cluster = getDockedCluster(group);
    const clusterIds = new Set(cluster.map(g => g.id));
    const originLevel = group.level;
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
    expandAndResolveLevelOverlaps(nextLevel, clusterIds);
    expandAndResolveLevelOverlaps(originLevel);
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
    expandAndResolveLevelOverlaps(newLevel, clusterIds);
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

    const originLevel = group.level;
    if (group.memberIds.length <= 1) {
      group.level = targetLevel;
      expandAndResolveLevelOverlaps(targetLevel, new Set([group.id]));
      expandAndResolveLevelOverlaps(originLevel);
      return;
    }

    const cb = cardBoxByPersonId.value.get(personId);
    const newX = cb ? cb.centerX : group.x + 80;
    group.memberIds = group.memberIds.filter(id => id !== personId);

    const splitGroup: DesignSiblingGroup = {
      id: `sg-split-${personId}-${Date.now()}`,
      parentId: group.parentId,
      generation: group.generation,
      level: targetLevel,
      x: newX,
      memberIds: [personId],
      isUngrouped: true,
    };
    siblingGroups.value.push(splitGroup);
    expandAndResolveLevelOverlaps(targetLevel, new Set([splitGroup.id]));
    expandAndResolveLevelOverlaps(originLevel);
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

  const subtreeBackgrounds = computed<SubtreeBackground[]>(() => {
    const backgrounds: SubtreeBackground[] = [];
    const subRefs = options.subLayoutReferences?.value || {};
    const subCache = options.subLayoutCache?.value || new Map();

    for (const [anchorId, sRef] of Object.entries(subRefs)) {
      const subState = subCache.get(sRef.layoutId);
      if (!subState || !subState.backgroundImageData || !subState.backgroundConfig?.visible) {
        continue;
      }
      const anchorCard = cardBoxByPersonId.value.get(anchorId);
      if (!anchorCard) continue;

      const subRootGroup = subState.siblingGroups.find((g: DesignSiblingGroup) => g.level === 1 || g.parentId === null);
      const subRootX = subRootGroup ? subRootGroup.x : 720;

      const bgCfg = subState.backgroundConfig;
      const finalX = anchorCard.centerX + (bgCfg.x - subRootX);
      const finalY = anchorCard.centerY + bgCfg.y;

      backgrounds.push({
        anchorPersonId: anchorId,
        layoutId: sRef.layoutId,
        layoutName: sRef.layoutName,
        imageData: subState.backgroundImageData,
        config: bgCfg,
        originX: Math.round(finalX),
        originY: Math.round(finalY),
      });
    }
    return backgrounds;
  });

  function cleanupLayoutListeners() {
    window.removeEventListener('mousemove', onWindowBranchWidthDragMove);
    window.removeEventListener('mouseup', onWindowBranchWidthDragEnd);
    window.removeEventListener('mousemove', onWindowBranchWidthResizeMove);
    window.removeEventListener('mouseup', onWindowBranchWidthResizeEnd);
    window.removeEventListener('mousemove', onWindowGroupDragMove);
    window.removeEventListener('mouseup', onWindowGroupDragEnd);
  }

  return {
    // Drag & Selection State
    draggingGroupId,
    draggingCluster,
    draggingClusterGroupIds,
    dragHoverInsertAboveLevel,
    activeSnapGuideX,
    draggingBwId,
    selectedDesignPerson,

    // Layout Metrics & Dimensions
    computedLevelMetrics,
    levelLayoutMetrics,
    getLevelHeight,
    getLevelBandTopY,
    getGroupTopY,
    getMaxCardHeightForLevel,
    getGroupWidth,
    canvasHeight,
    canvasWidth,
    levelsTopToBottom,

    // Cards, Groups & Branch Widths
    cardHeightByPersonId,
    getCardHeightForPerson,
    cardDataByPersonId,
    getLineStyle,
    groupLayouts,
    cardBoxByPersonId,
    renderedBranchWidths,
    visibleSiblingGroups,

    // Edge Geometry & SVG Paths
    edgeGeometry,

    // Hierarchische Subtree-Hintergründe
    subtreeBackgrounds,

    // Tree & Descendant Helpers
    childrenMapByParentId,
    hasDescendants,
    isParentExpanded,
    toggleDescendants,
    expandAllDescendants,
    collapseAllToOrigin,
    buildInitialDesignLayout,
    placeDescendantsWithinWidth,

    // Group, Card & Level Manipulation
    isPersonSelected,
    selectCardPerson,
    startGroupDrag,
    startBranchWidthDrag,
    startBranchWidthResize,
    removeBranchWidth,
    groupDescendantsByLevel,
    expandAndResolveLevelOverlaps,
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
    isolateAnchorInSiblingGroups,
    ensureAllSubtreeAnchorsIsolated,
    cleanupLayoutListeners,
  };
}
