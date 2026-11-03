<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import {
  DEFAULT_CARD_CONFIG,
  DEFAULT_BACKGROUND_CONFIG,
  computePersonCardNeededHeight,
  formatLocalizedDate,
  type DesignCardConfig,
  type DesignBackgroundConfig,
} from '../types/design';
import {
  saveBackgroundImageToDB,
  loadBackgroundImageFromDB,
  deleteBackgroundImageFromDB,
} from '../utils/designBgStorage';

const { t, locale } = useI18n();

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

// Konfiguration der Kachelinhalte & Zeilenformatierungen
const activeCardConfig = computed<DesignCardConfig>(() => props.cardConfig || DEFAULT_CARD_CONFIG);

// Geometrie-Konstanten: Geschwisterkästchen stoßen direkt aneinander (CARD_GAP = 0, kein Innenabstand)
const CARD_WIDTH = 174;
const DEFAULT_LEVEL_HEIGHT = 200;
const MIN_LEVEL_HEIGHT = 110;
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

// Ausgewählter Eintrag im Design-Mode & Zweig-Breiten-Abgrenzungen (personId -> [minX, maxX])
const activeDesignPersonId = ref<string>('');
const branchWidths = ref<Map<string, BranchWidthConstraint>>(new Map());

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

function getBaptismInfo(person: Person): { date: string | null; place: string | null } {
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

// Zentraler Cache für die dynamische Kachelhöhe jeder Person
const cardHeightByPersonId = computed<Map<string, number>>(() => {
  const map = new Map<string, number>();
  const cfg = activeCardConfig.value;
  const loc = locale.value;
  const activeProband = props.activeProbandId;

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

const LEVEL_CARD_PAD_TOP = 26; // Platz oberhalb der Kacheln für den Nachnamens-Header (subgroup-surname-label)
const CORRIDOR_PAD_TOP = 24; // Sicherer Mindestabstand unterhalb der untersten Kachelkante der Ebene bis zur obersten Querlinie
const CORRIDOR_PAD_BOTTOM = 28; // Sicherer Mindestabstand von der untersten Querlinie bis zur Kacheloberkante/Nachnamenslabel der darunterliegenden Ebene
const CORRIDOR_EMPTY = 36; // Mindestabstand zwischen Ebenen, wenn keine Querlinien vorhanden sind

interface SiblingBarItem {
  parentId?: string;
  parentX?: number;
  minChildX: number;
  maxChildX: number;
  childrenX?: number[];
  pBox?: { centerX: number; level?: number };
  cBoxes?: { centerX: number }[];
}

// Berechnet optimale Höhenstufen (Lanes) für Querlinien:
// - Linien ohne gemeinsamen horizontalen Abschnitt dürfen Linienhöhen wiederverwenden,
//   sofern sie einen horizontalen Sicherheitsabstand einhalten (keine Berührung an Endpunkten).
// - Linien mit gemeinsamem horizontalem Abschnitt erhalten zwingend unterschiedliche Linienhöhen (keine Überdeckung).
// - Vertikale Linien dürfen Querlinien kreuzen.
function assignNonOverlappingLanes(
  items: SiblingBarItem[],
  direction: 'up' | 'same' | 'down' = 'up'
): { lanes: number[]; totalLanes: number } {
  const n = items.length;
  if (n === 0) return { lanes: [], totalLanes: 0 };
  if (n === 1) return { lanes: [0], totalLanes: 1 };

  const parsed = items.map((rel, origIdx) => {
    const parentX = rel.pBox ? rel.pBox.centerX : (rel.parentX ?? 0);
    const minChildX = rel.minChildX;
    const maxChildX = rel.maxChildX;
    const childrenX = rel.cBoxes
      ? rel.cBoxes.map(c => c.centerX)
      : (rel.childrenX ?? [minChildX, maxChildX]);
    const barMin = Math.min(parentX, minChildX);
    const barMax = Math.max(parentX, maxChildX);
    const span = Math.max(0, barMax - barMin);
    const centerX = (barMin + barMax) / 2;
    return { origIdx, parentX, barMin, barMax, span, centerX, childrenX };
  });

  // Mindestabstand (in px) zwischen horizontalen Balken auf derselben Lane, um optisches Verschmelzen zu verhindern
  const LANE_REUSE_SAFETY_GAP = 24;

  // Überlappungs-Prüfung: Haben zwei Items einen gemeinsamen horizontalen Abschnitt oder unterschreiten sie den Sicherheitsabstand?
  function hasOverlap(i: number, j: number): boolean {
    const a = parsed[i];
    const b = parsed[j];
    // Wirkungsbereich für horizontale Kollision:
    // Auch Einzelkinder (span <= 1) definieren einen Knotenbereich um parentX, damit Querlinien nicht durch ihren Knoten laufen.
    const aMin = a.span <= 1 ? a.parentX - 8 : a.barMin;
    const aMax = a.span <= 1 ? a.parentX + 8 : a.barMax;
    const bMin = b.span <= 1 ? b.parentX - 8 : b.barMin;
    const bMax = b.span <= 1 ? b.parentX + 8 : b.barMax;

    return Math.max(aMin, bMin) < Math.min(aMax, bMax) + LANE_REUSE_SAFETY_GAP;
  }

  // Precompute pair costs for crossing quality
  // iBelowJ: Kosten/Kreuzungen, wenn Item i auf kleinerem Lane-Index liegt als Item j (lI < lJ)
  // jBelowI: Kosten/Kreuzungen, wenn Item j auf kleinerem Lane-Index liegt als Item i (lJ < lI)
  const pairCosts: { iBelowJ: number; jBelowI: number; overlap: boolean }[][] = [];
  for (let i = 0; i < n; i++) {
    pairCosts[i] = [];
    for (let j = 0; j < n; j++) {
      if (i === j) {
        pairCosts[i][j] = { iBelowJ: 0, jBelowI: 0, overlap: false };
        continue;
      }
      const overlap = hasOverlap(i, j);
      let iBelowJ = 0;
      let jBelowI = 0;

      const sameParent = Math.abs(parsed[i].parentX - parsed[j].parentX) < 2;

      if (direction !== 'down') {
        // Standard (up): Lane 0 ist näher an Kindern (oben), höhere Lanes näher an Eltern (unten)
        // 1. Wenn lI < lJ:
        //    - Item i's Elternstamm steigt von unten nach Lane lI auf und kreuzt Lane lJ, falls parentX_i in j's Balken liegt.
        if (!sameParent && parsed[i].parentX > parsed[j].barMin + 2 && parsed[i].parentX < parsed[j].barMax - 2) {
          iBelowJ += 500;
        }
        //    - Item j's Kinder-Abgangslinien steigen von Lane lJ nach oben zu den Kindern auf und kreuzen Lane lI, falls cx in i's Balken liegt.
        for (const cx of parsed[j].childrenX) {
          if (cx > parsed[i].barMin + 2 && cx < parsed[i].barMax - 2) {
            iBelowJ += 500;
          }
        }

        // 2. Wenn lJ < lI:
        //    - Item j's Elternstamm kreuzt Lane lI, falls parentX_j in i's Balken liegt.
        if (!sameParent && parsed[j].parentX > parsed[i].barMin + 2 && parsed[j].parentX < parsed[i].barMax - 2) {
          jBelowI += 500;
        }
        //    - Item i's Kinder-Abgangslinien steigen von Lane lI auf und kreuzen Lane lJ, falls cx in j's Balken liegt.
        for (const cx of parsed[i].childrenX) {
          if (cx > parsed[j].barMin + 2 && cx < parsed[j].barMax - 2) {
            jBelowI += 500;
          }
        }
      } else {
        // Umgekehrt für down: Lane 0 ist näher an Eltern (oben), höhere Lanes näher an Kindern (unten)
        if (!sameParent && parsed[i].parentX > parsed[j].barMin + 2 && parsed[i].parentX < parsed[j].barMax - 2) {
          jBelowI += 500;
        }
        for (const cx of parsed[j].childrenX) {
          if (cx > parsed[i].barMin + 2 && cx < parsed[i].barMax - 2) {
            jBelowI += 500;
          }
        }

        if (!sameParent && parsed[j].parentX > parsed[i].barMin + 2 && parsed[j].parentX < parsed[i].barMax - 2) {
          iBelowJ += 500;
        }
        for (const cx of parsed[i].childrenX) {
          if (cx > parsed[j].barMin + 2 && cx < parsed[j].barMax - 2) {
            iBelowJ += 500;
          }
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
          if (pc.overlap) cost += 100000; // Harter Ausschluss: Überlappende Linien dürfen NIEMALS dieselbe Lane haben
        } else if (lI < lJ) {
          cost += pc.iBelowJ;
          if (parsed[i].span > parsed[j].span + 8) cost += 0.5;
        } else {
          cost += pc.jBelowI;
          if (parsed[j].span > parsed[i].span + 8) cost += 0.5;
        }
      }
    }
    return cost;
  }

  function buildAssignment(order: number[]): number[] {
    const lanes = new Array<number>(n).fill(0);
    const laneOccupants: number[][] = [];
    for (const idx of order) {
      let chosenLane = 0;
      while (true) {
        if (!laneOccupants[chosenLane]) {
          laneOccupants[chosenLane] = [];
          break;
        }
        const hasConflict = laneOccupants[chosenLane].some(occIdx => pairCosts[idx][occIdx].overlap);
        if (!hasConflict) break;
        chosenLane++;
      }
      lanes[idx] = chosenLane;
      laneOccupants[chosenLane].push(idx);
    }
    return lanes;
  }

  // 1. Kandidat: Verschachtelung (innere umschlossene Spannen zuerst)
  const order1 = parsed.map((it, idx) => {
    let enclosedByCount = 0;
    for (let other = 0; other < n; other++) {
      if (other === idx) continue;
      if (parsed[other].barMin <= it.barMin + 4 && parsed[other].barMax >= it.barMax - 4) {
        enclosedByCount++;
      }
    }
    return { idx, score: enclosedByCount * 10000 - it.span };
  }).sort((a, b) => b.score - a.score).map(o => o.idx);

  // 2. Kandidat: Greedy nach Position (von links nach rechts)
  const order2 = parsed.map((it, idx) => ({ idx, minX: it.barMin }))
    .sort((a, b) => a.minX - b.minX).map(o => o.idx);

  // 3. Kandidat: Kürzeste Spannen zuerst (reduziert Durchdringungen und Brückenbildung)
  const order3 = parsed.map((it, idx) => ({ idx, span: it.span }))
    .sort((a, b) => a.span - b.span).map(o => o.idx);

  // 4. Kandidat: Längste Spannen zuerst
  const order4 = parsed.map((it, idx) => ({ idx, span: it.span }))
    .sort((a, b) => b.span - a.span).map(o => o.idx);

  // 5. Kandidat: Rangfolge nach gerichteter Kreuzungspräferenz
  const order5 = parsed.map((_it, i) => {
    let prefScore = 0;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      prefScore += (pairCosts[i][j].jBelowI - pairCosts[i][j].iBelowJ);
    }
    return { idx: i, prefScore };
  }).sort((a, b) => b.prefScore - a.prefScore).map(o => o.idx);

  const candidates = [order1, order2, order3, order4, order5].map(buildAssignment);
  let bestAssignment = candidates[0];
  let bestScore = evaluate(bestAssignment);

  for (let c = 1; c < candidates.length; c++) {
    const score = evaluate(candidates[c]);
    if (score < bestScore) {
      bestScore = score;
      bestAssignment = candidates[c];
    }
  }

  // Lokale Suche zur weiteren Minimierung von Linienkreuzungen (sofern n <= 60)
  if (n <= 60) {
    const current = [...bestAssignment];
    let improved = true;
    let iters = 0;
    while (improved && iters < 12) {
      improved = false;
      iters++;

      // 1. Pairwise Swaps: Tauscht die Lanes von zwei Items, um lokale Minima bei kreuzungsreduzierender Sortierung zu überwinden
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const li = current[i];
          const lj = current[j];
          if (li === lj) continue;

          let canSwap = true;
          for (let k = 0; k < n; k++) {
            if (k !== i && k !== j) {
              if (current[k] === lj && pairCosts[i][k].overlap) { canSwap = false; break; }
              if (current[k] === li && pairCosts[j][k].overlap) { canSwap = false; break; }
            }
          }
          if (!canSwap) continue;

          current[i] = lj;
          current[j] = li;
          const score = evaluate(current);
          if (score < bestScore - 0.001) {
            bestScore = score;
            improved = true;
            bestAssignment[i] = lj;
            bestAssignment[j] = li;
          } else {
            current[i] = li;
            current[j] = lj;
          }
        }
      }

      // 2. Einzel-Verschiebungen in freie oder andere Lanes
      const maxLane = Math.max(...current);
      for (let i = 0; i < n; i++) {
        const origL = current[i];
        for (let targetL = 0; targetL <= maxLane + 1; targetL++) {
          if (targetL === origL) continue;
          let conflict = false;
          for (let other = 0; other < n; other++) {
            if (other === i) continue;
            if (current[other] === targetL && pairCosts[i][other].overlap) {
              conflict = true;
              break;
            }
          }
          if (conflict) continue;

          current[i] = targetL;
          const score = evaluate(current);
          if (score < bestScore - 0.001) {
            bestScore = score;
            improved = true;
            bestAssignment[i] = targetL;
          } else {
            current[i] = origL;
          }
        }
      }
    }
  }

  const usedLanes = Array.from(new Set(bestAssignment)).sort((a, b) => a - b);
  const laneMap = new Map<number, number>();
  usedLanes.forEach((l, idx) => laneMap.set(l, idx));
  const compacted = bestAssignment.map(l => laneMap.get(l) ?? 0);
  const totalLanes = usedLanes.length > 0 ? Math.max(...compacted) + 1 : 0;

  return { lanes: compacted, totalLanes };
}

interface LevelMetrics {
  heights: Record<number, number>;
  bandTopY: Record<number, number>;
  cardTopY: Record<number, number>;
  levelMaxCardBottom: Record<number, number>;
  maxCardHeights: Record<number, number>;
  requiredLanes: Record<number, number>;
  totalCanvasHeight: number;
}


const computedLevelMetrics = computed<LevelMetrics>(() => {
  const heights: Record<number, number> = {};
  const bandTopY: Record<number, number> = {};
  const cardTopY: Record<number, number> = {};
  const levelMaxCardBottom: Record<number, number> = {};
  const maxCardHeights: Record<number, number> = {};
  const requiredLanes: Record<number, number> = {};

  const gap = Math.max(10, props.horizontalLaneGap || 16);
  const totalLvls = totalLevels.value;

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
  const barsByCorridorLevel = new Map<number, SiblingBarItem[]>();
  const childGroupsAll = visibleSiblingGroups.value.filter(g => g.parentId);
  const groupsByParentAndLvl = new Map<string, Map<number, DesignSiblingGroup[]>>();
  childGroupsAll.forEach(cg => {
    const pId = cg.parentId!;
    if (!groupsByParentAndLvl.has(pId)) groupsByParentAndLvl.set(pId, new Map());
    const lvlMap = groupsByParentAndLvl.get(pId)!;
    if (!lvlMap.has(cg.level)) lvlMap.set(cg.level, []);
    lvlMap.get(cg.level)!.push(cg);
  });

  groupsByParentAndLvl.forEach((lvlMap, parentId) => {
    const pGrp = groupByPersonId.get(parentId);
    if (!pGrp) return;
    const pIdx = pGrp.memberIds.indexOf(parentId);
    const pWidth = pGrp.memberIds.length * CARD_WIDTH;
    const pLeft = Math.round(pGrp.x - pWidth / 2);
    const parentX = pLeft + pIdx * CARD_WIDTH + Math.round(CARD_WIDTH / 2);

    lvlMap.forEach((cGroups, childLevel) => {
      // Jede Geschwistergruppe hat genau einen Ziel-X-Punkt (ihr Zentrum)
      const targetXs = cGroups.map(cg => Math.round(cg.x));
      if (targetXs.length === 0) return;
      const minChildX = Math.min(...targetXs);
      const maxChildX = Math.max(...targetXs);
      const barMinX = Math.min(parentX, minChildX);
      const barMaxX = Math.max(parentX, maxChildX);

      if (barMaxX - barMinX > 1) {
        // Physischer Korridor: Bei downRelations liegt der Querbalken unterhalb von pGrp.level, sonst unter childLevel
        const corridorLvl = childLevel < pGrp.level ? pGrp.level : childLevel;
        if (!barsByCorridorLevel.has(corridorLvl)) {
          barsByCorridorLevel.set(corridorLvl, []);
        }
        barsByCorridorLevel.get(corridorLvl)!.push({
          parentId,
          parentX,
          minChildX,
          maxChildX,
          childrenX: targetXs,
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
      const { totalLanes: calculatedLanes } = assignNonOverlappingLanes(corridorBars);
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

const childrenMapByParentId = computed<Map<string, string[]>>(() => {
  const pid = props.activeProbandId;
  if (!pid) return new Map();
  const rootPerson = personById.value.get(pid);
  if (!rootPerson) return new Map();

  const startCode = getActiveStartCode(pid);
  const pList = props.persons.filter(p => p.proband_data && p.proband_data[pid]);

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
  childrenByParentId.forEach((list, parentId) => {
    if (list.length > 0) {
      cIdMap.set(parentId, list.map(c => c.id));
    }
  });
  return cIdMap;
});

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
  const activeCode = props.activeProbandId || '';
  props.persons.forEach(p => {
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
        includedGroupIds.add(g.id);
        resultGroups.push(g);
        membersMap.set(g.id, [...g.memberIds]);
        g.memberIds.forEach(id => visiblePersons.add(id));
        added = true;
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
  if (isApplyingLoadedState) return;
  loadProbandBackground(props.activeProbandId);
  if (hasInitialized && props.persons.length > 0) {
    checkAndLoadLatestStateOrOffer();
  }
});

onMounted(async () => {
  hasInitialized = true;
  if (viewportRef.value) {
    viewportRef.value.addEventListener('wheel', handleWheelZoom, { passive: false });
  }
  window.addEventListener('keydown', onGlobalKeyDown);

  // Hintergrundbild und Konfiguration für aktiven Probanden initial laden
  loadProbandBackground(props.activeProbandId);

  if (props.persons.length > 0) {
    await checkAndLoadLatestStateOrOffer();
  }
});

onUnmounted(() => {
  if (viewportRef.value) {
    viewportRef.value.removeEventListener('wheel', handleWheelZoom);
  }
  window.removeEventListener('keydown', onGlobalKeyDown);
  window.removeEventListener('mousemove', onWindowBranchWidthDragMove);
  window.removeEventListener('mouseup', onWindowBranchWidthDragEnd);
  window.removeEventListener('mousemove', onWindowBranchWidthResizeMove);
  window.removeEventListener('mouseup', onWindowBranchWidthResizeEnd);
  window.removeEventListener('mousemove', onBgMouseMove);
  window.removeEventListener('mouseup', onBgMouseUp);
});


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

// ----------------------------------------------------
// Hintergrundbild für den Design-Modus
// ----------------------------------------------------
const bgImageData = ref<string | null>(null);
const bgConfig = ref<DesignBackgroundConfig>({ ...DEFAULT_BACKGROUND_CONFIG });
const isBgPopoverOpen = ref<boolean>(false);
const bgFileInputRef = ref<HTMLInputElement | null>(null);
const isBgDraggingOnCanvas = ref<boolean>(false);
const isBgMoving = ref<boolean>(false);

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

  // 1. Config aus localStorage laden (proband-spezifisch)
  try {
    const savedCfg = localStorage.getItem(getProbandConfigKey(probandId));
    if (savedCfg) {
      bgConfig.value = { ...DEFAULT_BACKGROUND_CONFIG, ...JSON.parse(savedCfg) };
    } else {
      bgConfig.value = { ...DEFAULT_BACKGROUND_CONFIG };
    }
  } catch {
    bgConfig.value = { ...DEFAULT_BACKGROUND_CONFIG };
  }

  // 2. Bild aus IndexedDB laden (proband-spezifisch)
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
  saveBackgroundImageToDB(
    dataUrl,
    config.fileName || 'background_image',
    'image/png',
    0,
    getProbandBgKey(pId)
  );
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

const bgDisplayWidth = computed<number>(() => {
  const base = bgConfig.value.naturalWidth || 1200;
  return Math.max(20, Math.round(base * (bgConfig.value.scale / 100)));
});

const bgDisplayHeight = computed<number>(() => {
  const base = bgConfig.value.naturalHeight || 800;
  return Math.max(20, Math.round(base * (bgConfig.value.scale / 100)));
});

const bgContainerStyle = computed(() => {
  return {
    position: 'absolute' as const,
    left: bgConfig.value.x + 'px',
    top: bgConfig.value.y + 'px',
    width: bgDisplayWidth.value + 'px',
    height: bgDisplayHeight.value + 'px',
    opacity: isBgDraggingOnCanvas.value
      ? Math.max(0.4, Math.min(bgConfig.value.opacity / 100, 0.85))
      : bgConfig.value.opacity / 100,
    pointerEvents: isBgDraggingOnCanvas.value ? ('auto' as const) : ('none' as const),
    userSelect: 'none' as const,
    zIndex: isBgDraggingOnCanvas.value ? 70 : 0,
    cursor: isBgDraggingOnCanvas.value ? (isBgMoving.value ? 'grabbing' : 'grab') : 'default',
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

function triggerBgUpload() {
  bgFileInputRef.value?.click();
}

function onBgFileSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  processBgFile(file);
  input.value = '';
}

function processBgFile(file: File) {
  const validTypes = ['image/jpeg', 'image/png', 'image/svg+xml', 'image/webp'];
  const isSvgOrImg = validTypes.includes(file.type) || file.name.match(/\.(jpg|jpeg|png|svg|webp)$/i);
  if (!isSvgOrImg) {
    alert('Bitte eine Bilddatei im Format JPG, PNG, SVG oder WebP auswählen.');
    return;
  }

  const reader = new FileReader();
  reader.onload = e => {
    const dataUrl = e.target?.result as string;
    if (!dataUrl) return;

    bgImageData.value = dataUrl;
    bgConfig.value.fileName = file.name;
    bgConfig.value.visible = true;

    const img = new Image();
    img.onload = () => {
      bgConfig.value.naturalWidth = img.naturalWidth || 1200;
      bgConfig.value.naturalHeight = img.naturalHeight || 800;

      // Wenn das Bild neu geladen wurde oder noch keine Position hat, im Canvas zentrieren
      if (bgConfig.value.x === 0 && bgConfig.value.y === 0) {
        centerBgImage();
      }

      saveProbandBg(props.activeProbandId, dataUrl, bgConfig.value);
    };
    img.src = dataUrl;
  };
  reader.readAsDataURL(file);
}

function onViewportFileDrop(e: DragEvent) {
  const file = e.dataTransfer?.files?.[0];
  if (file && (file.type.startsWith('image/') || file.name.match(/\.(jpg|jpeg|png|svg|webp)$/i))) {
    processBgFile(file);
    isBgPopoverOpen.value = true;
  }
}

function onBgImageLoaded(e: Event) {
  const img = e.target as HTMLImageElement;
  if (img && img.naturalWidth && (!bgConfig.value.naturalWidth || !bgConfig.value.naturalHeight)) {
    bgConfig.value.naturalWidth = img.naturalWidth;
    bgConfig.value.naturalHeight = img.naturalHeight;
    if (bgConfig.value.x === 0 && bgConfig.value.y === 0) {
      centerBgImage();
    }
  }
}

function centerBgImage() {
  bgConfig.value.x = Math.round((canvasWidth.value - bgDisplayWidth.value) / 2);
  bgConfig.value.y = Math.round((canvasHeight.value - bgDisplayHeight.value) / 2);
}

function alignBottomCenterBgImage() {
  bgConfig.value.x = Math.round((canvasWidth.value - bgDisplayWidth.value) / 2);
  bgConfig.value.y = Math.max(CANVAS_PAD_TOP, Math.round(canvasHeight.value - bgDisplayHeight.value - CANVAS_PAD_BOTTOM));
}

function alignTopLeftBgImage() {
  bgConfig.value.x = LEVEL_SIDEBAR_W + 16;
  bgConfig.value.y = CANVAS_PAD_TOP;
}

function fitBgToWidth() {
  if (bgConfig.value.naturalWidth) {
    const availableW = Math.max(400, canvasWidth.value - LEVEL_SIDEBAR_W - 40);
    bgConfig.value.scale = Math.max(10, Math.min(500, Math.round((availableW / bgConfig.value.naturalWidth) * 100)));
    centerBgImage();
  }
}

function fitBgToHeight() {
  if (bgConfig.value.naturalHeight) {
    const availableH = Math.max(300, canvasHeight.value - CANVAS_PAD_TOP - CANVAS_PAD_BOTTOM);
    bgConfig.value.scale = Math.max(10, Math.min(500, Math.round((availableH / bgConfig.value.naturalHeight) * 100)));
    centerBgImage();
  }
}

function resetBgScale() {
  bgConfig.value.scale = 100;
  centerBgImage();
}

function removeBgImage() {
  if (confirm(t('design_bg_image_delete_confirm') || 'Möchten Sie das Hintergrundbild wirklich entfernen?')) {
    bgImageData.value = null;
    bgConfig.value.fileName = undefined;
    deleteProbandBg(props.activeProbandId);
  }
}

let bgDragStartMouseX = 0;
let bgDragStartMouseY = 0;
let bgDragInitialX = 0;
let bgDragInitialY = 0;

function onBgMouseDown(e: MouseEvent) {
  if (!isBgDraggingOnCanvas.value) return;
  if (e.button !== 0) return;
  e.stopPropagation();
  e.preventDefault();
  isBgMoving.value = true;
  bgDragStartMouseX = e.clientX;
  bgDragStartMouseY = e.clientY;
  bgDragInitialX = bgConfig.value.x;
  bgDragInitialY = bgConfig.value.y;
  window.addEventListener('mousemove', onBgMouseMove);
  window.addEventListener('mouseup', onBgMouseUp);
}

function onBgMouseMove(e: MouseEvent) {
  const dx = (e.clientX - bgDragStartMouseX) / zoom.value;
  const dy = (e.clientY - bgDragStartMouseY) / zoom.value;
  bgConfig.value.x = Math.round(bgDragInitialX + dx);
  bgConfig.value.y = Math.round(bgDragInitialY + dy);
}

function onBgMouseUp() {
  isBgMoving.value = false;
  window.removeEventListener('mousemove', onBgMouseMove);
  window.removeEventListener('mouseup', onBgMouseUp);
}

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
  height: number;
  centerX: number;
  centerY: number;
}

interface SiblingSubGroup {
  id: string;
  parentId: string | null;
  parentPerson: Person | null;
  cards: CardBox[];
  isMultiSibling: boolean;
  surname: string;
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

interface SpouseDateItem {
  key: string;
  text: string;
  isDivorce?: boolean;
  isMarriage?: boolean;
}

interface RenderedCardSpouse {
  id: string;
  name: string;
  henry: string | null;
  isDivorced: boolean;
  divorceDate: string | null;
  dateItems: SpouseDateItem[];
}

interface RenderedCardData {
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

const cardDataByPersonId = computed<Map<string, RenderedCardData>>(() => {
  const map = new Map<string, RenderedCardData>();
  const cfg = activeCardConfig.value;
  const loc = locale.value;
  const activeProband = props.activeProbandId;

  props.persons.forEach(person => {
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

function getSiblingSubGroupSurname(cards: CardBox[], parentPerson: Person | null): string {
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

    // Größte dynamische Höhe innerhalb dieser Gruppe ermitteln
    const groupCardHeight = visibleMemberIds.length > 0
      ? Math.max(...visibleMemberIds.map(id => getCardHeightForPerson(id, group.generation)), 50)
      : 50;

    const cards: CardBox[] = [];
    visibleMemberIds.forEach((pid, idx) => {
      const p = personById.value.get(pid);
      if (!p) return;
      const cLeft = left + idx * CARD_WIDTH;
      const cRight = cLeft + CARD_WIDTH;
      // Bei Gruppierung (> 1 Kachel) Höhe aller Kacheln aneinander anpassen (größte dynamische Höhe dieser Gruppe)
      const cardH = groupCardHeight;
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
      });
    });

    const groupHeight = groupCardHeight;

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
      bottom: top + groupHeight,
      width,
      height: groupHeight,
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
    zIndex: number;
    barZIndex: number;
    isNested: boolean;
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

    const nestingDepth = getNestingDepth(bw.personId);
    // Spätere Generationen erhalten höhere z-Index-Werte: Bereich der späteren Generation liegt in der obersten Ebene!
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

  // Sortierung: Bereiche früherer Generationen / geringere Verschachtelung zuerst, spätere Generationen danach
  // Dadurch wird der Bereich der späteren Generation im DOM und in der Ebenenhierarchie obenauf abgelegt.
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

// Ermittelt alle Einträge, die sich innerhalb des reservierten Bereichs befinden
function getGroupsInReservedArea(personId: string): DesignSiblingGroup[] {
  const bw = branchWidths.value.get(personId);
  if (!bw) return [];
  const descSet = getDescendantPersonIds(personId);
  const pPos = getRawPersonPosition(personId);
  const pLevel = pPos ? pPos.level : 1;
  const parentAreaId = getParentReservedAreaId(personId);

  const res: DesignSiblingGroup[] = [];
  siblingGroups.value.forEach(g => {
    // 1. Enthält personId selbst
    if (g.memberIds.includes(personId)) {
      res.push(g);
      return;
    }
    // 2. Auf Ebene >= pLevel und enthält Nachkommen von personId
    if (g.level >= pLevel && g.memberIds.some(id => descSet.has(id))) {
      res.push(g);
      return;
    }
    // 3. Wenn personId kein Sub-Bereich eines anderen Bereichs ist,
    // auch räumlich innerhalb des reservierten Bereichs liegende Gruppen erfassen
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

// Berechnet die maximal zulässige Verschiebung (minDx nach links, maxDx nach rechts),
// sodass der reservierte Bereich und die darin befindlichen Einträge weder mit
// externen Einträgen noch mit anderen reservierten Bereichen kollidieren.
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

  // Linke und rechte Grenze initial
  let minDx = (LEVEL_SIDEBAR_W + 16) - startMinX;
  let maxDx = Infinity;

  // Wenn dieser Bereich innerhalb eines übergeordneten Bereichs verschachtelt ist:
  // Die Grenzen des übergeordneten Bereichs strikt einhalten
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

  // Auch alle Gruppen im Bereich dürfen nicht hinter die linke Seitenleiste rutschen
  for (const g of areaGroups) {
    const w = getGroupWidth(g.memberIds.length);
    const gLeft = g.x - w / 2;
    const gMinDx = (LEVEL_SIDEBAR_W + 16) - gLeft;
    if (gMinDx > minDx) minDx = gMinDx;
  }

  let maxDxVal = maxDx;

  // Verschachtelte Kind-Bereiche erfassen: Diese bewegen sich MIT personId und sind keine Hindernisse
  const nestedChildAreaIds = new Set(getAllNestedReservedAreaIds(personId));

  // 1. Andere reservierte Bereiche prüfen
  branchWidths.value.forEach((otherBw, otherId) => {
    if (otherId === personId) return;
    if (nestedChildAreaIds.has(otherId)) return; // Bewegt sich mit
    if (otherId === parentAreaId) return; // Bereits oben als übergeordnete Grenze berücksichtigt

    const otherPos = getRawPersonPosition(otherId);
    const otherLevel = otherPos ? otherPos.level : 1;
    const otherMinLvl = otherLevel;
    const otherMaxLvl = totalLevels.value;
    const levelsOverlap = Math.max(minLvl, otherMinLvl) <= Math.min(maxLvl, otherMaxLvl);
    if (!levelsOverlap) return;

    if (otherBw.maxX <= startMinX + 2) {
      // otherBw liegt links von unserem reservierten Bereich
      const limitDx = (otherBw.maxX + OBSTACLE_GAP) - startMinX;
      if (limitDx > minDx) minDx = limitDx;
    } else if (otherBw.minX >= startMaxX - 2) {
      // otherBw liegt rechts von unserem reservierten Bereich
      const limitDx = (otherBw.minX - OBSTACLE_GAP) - startMaxX;
      if (limitDx < maxDxVal) maxDxVal = limitDx;
    }
  });

  // 2. Externe Einträge (Gruppen außerhalb des reservierten Bereichs) auf überlappenden Ebenen prüfen
  for (const otherG of siblingGroups.value) {
    if (areaGroupIds.has(otherG.id)) continue;
    if (otherG.level < minLvl || otherG.level > maxLvl) continue;

    const otherW = getGroupWidth(otherG.memberIds.length);
    const otherLeft = otherG.x - otherW / 2;
    const otherRight = otherG.x + otherW / 2;

    // A) Kollision der reservierten Bereichsgrenzen mit dem externen Eintrag
    if (otherRight <= startMinX + 2) {
      const limitDx = (otherRight + OBSTACLE_GAP) - startMinX;
      if (limitDx > minDx) minDx = limitDx;
    } else if (otherLeft >= startMaxX - 2) {
      const limitDx = (otherLeft - OBSTACLE_GAP) - startMaxX;
      if (limitDx < maxDxVal) maxDxVal = limitDx;
    }

    // B) Direkte Kollision von Gruppen auf derselben Ebene
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

  // Grenzen gegen Vorzustände absichern
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

  // Verschachtelte Kind-Bereiche in gleicher Weise mitführen
  draggingNestedBwItems.forEach(item => {
    const nbw = branchWidths.value.get(item.id);
    if (nbw) {
      nbw.minX = Math.round(item.startMinX + effectiveDx);
      nbw.maxX = Math.round(item.startMaxX + effectiveDx);
    }
  });

  // Alle aneinander/darin befindlichen Einträge gemeinsam verschieben (Anordnung bleibt exakt erhalten)
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

  // 1. Übergeordneter Bereich (falls verschachtelt)
  const parentId = getParentReservedAreaId(personId);
  if (parentId) {
    const parentBw = branchWidths.value.get(parentId);
    if (parentBw) {
      minAllowedLeft = Math.max(minAllowedLeft, parentBw.minX + 8);
      maxAllowedRight = Math.min(maxAllowedRight, parentBw.maxX - 8);
    }
  }

  // 2. Untergeordnete Bereiche (dürfen nicht abgeschnitten werden)
  const nestedChildIds = getAllNestedReservedAreaIds(personId);
  if (nestedChildIds.length > 0) {
    const childMinX = Math.min(...nestedChildIds.map(id => branchWidths.value.get(id)!.minX));
    const childMaxX = Math.max(...nestedChildIds.map(id => branchWidths.value.get(id)!.maxX));
    maxAllowedLeft = Math.min(maxAllowedLeft, childMinX - 8);
    minAllowedRight = Math.max(minAllowedRight, childMaxX + 8);
  }

  // 3. Andere unabhängige / benachbarte reservierte Bereiche auf überlappenden Ebenen einhalten
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

  // Wird der reservierte Bereich verkleinert und eine Eintragsgruppe ragt über den neuen Bereich heraus,
  // verschiebe die Gruppe nach innen:
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

// Verschiebt Gruppen eines Zweigs nach innen, wenn der reservierte Bereich verkleinert wird
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

// Liefert alle Nachkommen einer Person geordnet nach Generation und innerhalb der Generation sortiert
function getDescendantsByGeneration(personId: string): Map<number, string[]> {
  const descSet = getDescendantPersonIds(personId);
  const byGen = new Map<number, string[]>();
  if (descSet.size === 0) return byGen;

  const pPos = getRawPersonPosition(personId);
  const pLevel = pPos ? pPos.level : 1;
  const pPerson = personById.value.get(personId);
  const pGen = pPerson?.proband_data[props.activeProbandId || '']?.generation || pLevel;

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
        const probandGen = kidPerson?.proband_data[props.activeProbandId || '']?.generation;
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
      const probandGen = p?.proband_data[props.activeProbandId || '']?.generation || (pGen + 1);
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

// Teilt Blöcke (z. B. unteilbare Geschwistergruppen) in K möglichst gleich große zusammenhängende Abschnitte
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

// Berechnet bei Breitenänderungen des reservierten Bereichs die Aufteilung von Generationengruppen
// jeweils für jeden Teilschritt neu mit der Annahme, dass die ursprünglich vorhandene Gruppe noch zusammengehört
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

  // 1. Verschachtelte Kind-Bereiche erfassen: Deren interne Gruppenaufteilung bleibt geschützt!
  const nestedChildAreaIds = new Set(getAllNestedReservedAreaIds(personId));
  const nestedChildDescSet = new Set<string>();
  nestedChildAreaIds.forEach(cId => {
    nestedChildDescSet.add(cId);
    for (const d of getDescendantPersonIds(cId)) {
      nestedChildDescSet.add(d);
    }
  });

  // Alle Nachkommen von personId nach ihrer Generation sammeln (ohne Nachkommen von verschachtelten Kind-Bereichen)
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

  // 2. Für jede Generation die optimale Aufteilung in Chunks berechnen
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

    // Geschwisterblöcke ermitteln (biologische Geschwister bleiben zusammen)
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

  // 3. Ebenen-Zuweisung für jede Generation aufbauen
  const baseLevelForGen = new Map<number, number>();
  let curAssignedLevel = pLevel + 1;

  for (const alloc of genAllocations) {
    baseLevelForGen.set(alloc.gen, curAssignedLevel);
    curAssignedLevel += alloc.levelsNeeded;
  }

  // 4. Nicht neu zu berechnende Gruppen erfassen:
  // WICHTIG: Die Aufteilung von Einträgen in anderen reservierten Bereichen wird NICHT geändert!
  const untouchedGroups: DesignSiblingGroup[] = [];

  siblingGroups.value.forEach(g => {
    // Wenn Gruppe Nachkommen enthält, die gerade neu aufgeteilt werden:
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

    // Alle anderen Gruppen (auch Gruppen anderer reservierter Bereiche) bleiben exakt unverändert!
    untouchedGroups.push(g);
  });

  // 5. Die neu berechneten Chunks als Gruppen auf den jeweiligen Ebenen einsetzen
  const newDescendantGroups: DesignSiblingGroup[] = [];

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
        // Linker Teil: außenbündig links
        chunkX = Math.round(bw.minX + pad + w / 2);
      } else if (j === K - 1) {
        // Rechter Teil: außenbündig rechts
        chunkX = Math.round(bw.maxX - pad - w / 2);
      } else {
        const fraction = j / (K - 1);
        const leftBound = bw.minX + pad + w / 2;
        const rightBound = bw.maxX - pad - w / 2;
        chunkX = Math.round(leftBound + fraction * (rightBound - leftBound));
      }

      const pFirst = personById.value.get(chunkMembers[0]);
      const genFirst = pFirst?.proband_data[props.activeProbandId || '']?.generation || alloc.gen;
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

  // 6. Gesamt-Ebenenanzahl und Ebenen-Höhen aktualisieren
  const allUpdatedGroups = [...untouchedGroups, ...newDescendantGroups];
  const maxLvl = Math.max(1, ...allUpdatedGroups.map(g => g.level));

  const nextHeights: Record<number, number> = {};
  for (let l = 1; l <= maxLvl; l++) {
    nextHeights[l] = levelHeights.value[l] || DEFAULT_LEVEL_HEIGHT;
  }

  totalLevels.value = maxLvl;
  levelHeights.value = nextHeights;
  siblingGroups.value = allUpdatedGroups;

  // 7. Falls der Eintrag personId selbst auf pLevel über den neuen Bereich herausragt, verschiebe ihn nach innen
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

  // 8. Überlappungen auf den betroffenen Ebenen auflösen, ohne andere reservierte Bereiche zu verletzen
  const newLevels = new Set(newDescendantGroups.map(g => g.level));
  for (const l of newLevels) {
    expandAndResolveLevelOverlaps(l);
  }
}

function removeBranchWidth(personId: string) {
  pushHistoryState();
  branchWidths.value.delete(personId);
}

// Prüfen, ob eine Person aktuell selektiert ist
function isPersonSelected(personId: string): boolean {
  const sel = activeDesignPersonId.value || props.selectedId;
  return Boolean(sel && sel === personId);
}

// Auswahl eines Eintrags
function selectCardPerson(person: Person) {
  if (didMoveGroup) return;
  activeDesignPersonId.value = person.id;
  emit('select', person);
}

// Gruppiert alle Nachkommeneinträge des gewählten Eintrags, die sich auf einer Ebene befinden, je Ebene zu einer gemeinsamen Gruppe,
// fügt einen reservierten Bereich um den Eintrag und alle Ebenen oberhalb hinzu und schiebt andere Einträge unter Wahrung ihrer Anordnung nach außen.
function groupDescendantsByLevel(personId: string) {
  const descSet = getDescendantPersonIds(personId);
  if (descSet.size === 0) return;

  pushHistoryState();

  // 1. Stelle sicher, dass Nachfahren ausgeklappt sind
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

  // 2. Position und Gruppe des ausgewählten Eintrags ermitteln
  let curGroups = [...siblingGroups.value];
  const pGroupIdx = curGroups.findIndex(g => g.memberIds.includes(personId));
  if (pGroupIdx === -1) return;
  const origPGroup = curGroups[pGroupIdx];
  const pLevel = origPGroup.level;

  // Berechne die aktuelle X-Position des ausgewählten Eintrags
  const origPW = getGroupWidth(origPGroup.memberIds.length);
  const origPLeft = origPGroup.x - origPW / 2;
  const pIdxInGroup = origPGroup.memberIds.indexOf(personId);
  const pCardLeft = origPLeft + pIdxInGroup * CARD_WIDTH;
  const pCardRight = pCardLeft + CARD_WIDTH;
  let pCenterX = Math.round(pCardLeft + CARD_WIDTH / 2);

  // Falls der Eintrag Teil einer größeren Gruppe auf pLevel ist, isolieren wir ihn als eigene Gruppe,
  // da andere Einträge auf seiner Ebene nach außen geschoben werden
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

  // 3. Nachkommen je Ebene sammeln und zu je einer Gruppe zusammenfassen
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
    const gen = firstPerson?.proband_data[props.activeProbandId || '']?.generation || level;
    const allSameParent = descIds.every(id => getBiologicalParentId(id) === getBiologicalParentId(descIds[0]));
    const commonParentId = allSameParent ? getBiologicalParentId(descIds[0]) : null;

    const newGrpId = `sg-desc-${personId}-lvl-${level}-${Date.now()}`;
    newDescGroupIds.push(newGrpId);
    updatedGroups.push({
      id: newGrpId,
      parentId: commonParentId,
      generation: gen,
      level,
      x: pCenterX, // Zentriert über dem ausgewählten Eintrag
      memberIds: descIds,
      isUngrouped: descIds.length === 1,
    });
  });

  // 4. Reservierten Bereich berechnen:
  // Umfasst den Eintrag und alle gruppierten Nachkommeneinträge auf allen Ebenen oberhalb
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

  // 5. Nachbarelemente auf der Ebene des Eintrags ermitteln
  // und Nachkommen der Nachbarelemente auf höheren Ebenen zuordnen:
  // "Ausnahme: Alle Nachkommen müssen auf der selben Seite des reservierten Bereiches dargestellt werden,
  // wie die Nachbarelemente des ausgewählten Eintrages."
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

  // 6. Andere Einträge auf der Ebene des ausgewählten Eintrags und darüber nach außen schieben
  // Dabei werden die relativen Anordnungen der verschobenen Einträge nicht verändert!
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

  // 6b. Verschachtelte Erstellung: Wenn personId innerhalb eines bestehenden reservierten Bereiches liegt
  const parentAreaId = getParentReservedAreaId(personId);
  if (parentAreaId) {
    const parentBw = branchWidths.value.get(parentAreaId)!;
    // Sicherstellen, dass parentBw groß genug ist für den neuen geschachtelten Bereich
    if (reservedMinX < parentBw.minX + 8) {
      const expandLeft = (parentBw.minX + 8) - reservedMinX;
      parentBw.minX -= expandLeft;
    }
    if (reservedMaxX > parentBw.maxX - 8) {
      const expandRight = reservedMaxX - (parentBw.maxX - 8);
      parentBw.maxX += expandRight;
    }

    // Andere Gruppen innerhalb von parentBw (die nicht zu personId gehören) nach außen ausrücken
    // Priorität auf späteren Generationen: Sortiere nach Ebene absteigend (spätere Generationen zuerst)
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

  // 7. Weitere reservierte Bereiche (bestehende branchWidths) berücksichtigen
  const MIN_GAP = 20;
  const existingOtherBws: BranchWidthConstraint[] = [];
  branchWidths.value.forEach((bw, pId) => {
    if (pId !== personId) {
      existingOtherBws.push(bw);
    }
  });

  const leftOtherBws = existingOtherBws.filter(bw => (bw.minX + bw.maxX) / 2 <= pCenterX);
  const rightOtherBws = existingOtherBws.filter(bw => (bw.minX + bw.maxX) / 2 > pCenterX);

  // Nach links schieben:
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

  // Nach rechts schieben:
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

  // 8. Falls das Verschieben nach links die Seitenleiste unterschreitet, gesamte Arbeitsfläche nachjustieren
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

  // 9. Neuen reservierten Bereich für personId eintragen
  branchWidths.value.set(personId, {
    personId,
    minX: reservedMinX,
    maxX: reservedMaxX,
  });

  siblingGroups.value = updatedGroups;

  // 10. Auf allen betroffenen Ebenen abschließende Prüfung gegen Überlappungen
  for (let l = pLevel; l <= totalLevels.value; l++) {
    expandAndResolveLevelOverlaps(l);
  }
}

// Löst Überlappungen auf einer Ebene zuverlässig auf und expandiert den verfügbaren Platz,
// sodass eingefügte / verschobene Gruppen vollständig Platz finden und keine Kästchen überlappen
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

  // 1. Wenn Anker-Gruppen vorhanden sind (z. B. gerade abgelegte oder geteilte Gruppe),
  // wird deren Platz als Bezugspunkt genommen und benachbarte Einträge werden nach außen geschoben
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

    // Nach rechts schieben: Alle rechts vom Anker liegenden Gruppen nach außen drücken
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

    // Nach links schieben: Alle links vom Anker liegenden Gruppen nach außen drücken
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

    // Falls das Verschieben nach links die Seitenleiste unterschreitet, gesamte Ebene nach rechts nachjustieren
    const curMinLeft = Math.min(...groupsOnLevel.map(g => g.x - getGroupWidth(g.memberIds.length) / 2));
    if (curMinLeft < minAllowedLeft) {
      const shiftRight = minAllowedLeft - curMinLeft;
      groupsOnLevel.forEach(g => {
        g.x = Math.round(g.x + shiftRight);
      });
    }
  }

  // 2. Vollständiger Sicherheitsdurchlauf von links nach rechts:
  // Unter keinen Umständen dürfen sich Eintragsboxen überlappen
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

    // Gedockte Gruppen haben Kantenkontakt (<= 2px Abstand)
    const isDocked = Math.abs(currLeft - prevRight) <= 2;
    if (isDocked) {
      // Exakten Kantenkontakt (0px Abstand) herstellen
      curr.x = Math.round(prevRight + currW / 2);
    } else if (currLeft < prevRight + MIN_GAP) {
      const newLeft = prevRight + MIN_GAP;
      curr.x = Math.round(newLeft + currW / 2);
    }
  }
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

interface AnchorPoint {
  x: number;
  y: number;
  d: string;
  isHighlighted: boolean;
}

const edgeGeometry = computed(() => {
  const rawSegments: LineSegment[] = [];
  const arrows: ArrowHead[] = [];
  const anchors: AnchorPoint[] = [];

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

  // 2. Geschwister-Gruppen je physischem Korridor sammeln, damit alle Querlinien im selben
  // Zwischenbereich (Verbindungen nach oben, selbe Ebene und nach unten) gemeinsam und kollisionsfrei
  // in Lanes eingeteilt werden.
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
      // Physischer Korridor: Bei Verbindungen nach unten liegt der Korridor unterhalb des Elternteils (pBox.level),
      // bei Verbindungen nach oben oder gleicher Ebene unterhalb der Kinderebene (childLevel).
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

  // Konfigurierbarer Mindestabstand für Querlinien
  const gap = Math.max(10, props.horizontalLaneGap || 16);
  const bridgeRadius = Math.max(4, Math.min(20, props.bridgeRadius || 8));
  const enableBridges = props.enableLineBridges !== false;

  // 3. Für jeden physischen Korridor die Querlinien gemeinsam konfliktfrei auf Lanes verteilen
  relationsByCorridor.forEach((relations, corridorLevel) => {
    relations.sort((a, b) => {
      const aCenter = (a.minChildX + a.maxChildX) / 2;
      const bCenter = (b.minChildX + b.maxChildX) / 2;
      return aCenter - bCenter;
    });

    const items: SiblingBarItem[] = relations.map(r => {
      // Jede Geschwistergruppe hat genau einen Zielpunkt (Zentrum der Gruppe)
      const cBoxesByGroup = new Map<string, CardBox[]>();
      r.cBoxes.forEach(cb => {
        const gId = cb.groupId || cb.person.id;
        if (!cBoxesByGroup.has(gId)) cBoxesByGroup.set(gId, []);
        cBoxesByGroup.get(gId)!.push(cb);
      });
      const targetXs: number[] = [];
      cBoxesByGroup.forEach(boxes => {
        const minL = Math.min(...boxes.map(c => c.left));
        const maxR = Math.max(...boxes.map(c => c.right));
        targetXs.push(Math.round((minL + maxR) / 2));
      });
      const minChildX = Math.min(...targetXs);
      const maxChildX = Math.max(...targetXs);
      return {
        parentId: r.parentId,
        parentX: r.pBox.centerX,
        minChildX,
        maxChildX,
        childrenX: targetXs,
      };
    });

    const corridorDir = relations[0]?.direction || 'up';
    const { lanes } = assignNonOverlappingLanes(items, corridorDir);

    relations.forEach((rel, idx) => {
      const { parentId, childLevel, pBox, cBoxes } = rel;
      const commonEdgeKey = `edge-${parentId}-lvl${childLevel}`;
      const activeSel = activeDesignPersonId.value || props.selectedId;
      const isCommonHighlighted =
        Boolean(activeSel && (activeSel === parentId || cBoxes.some(c => c.person.id === activeSel))) ||
        Boolean(
          props.highlightedPathIds && props.highlightedPathIds.size > 0 &&
          props.highlightedPathIds.has(parentId) &&
          cBoxes.some(c => props.highlightedPathIds?.has(c.person.id))
        );

      // Der Start-Anknüpfpunkt und der Stamm beginnen immer exakt mittig oben auf der Kachel der Elterngeneration
      const stemX = pBox.centerX;
      const startY = pBox.top;

      const laneOffset = lanes[idx] * gap;
      const levelMaxBottom = levelLayoutMetrics.value.levelMaxCardBottom[corridorLevel]
        || (getLevelBandTopY(corridorLevel) + LEVEL_CARD_PAD_TOP + getMaxCardHeightForLevel(corridorLevel));
      // Linien verlassen den Anknüpfpunkt immer nach oben: jogY liegt immer oberhalb von startY
      const jogY = Math.min(startY - 12, levelMaxBottom + CORRIDOR_PAD_TOP + laneOffset);

      // 1. Ausgangs-Anknüpfpunkt (Halbkreisaußen) an der oberen Kante des Elternknotens
      const anchorRadius = 7;
      // Halbkreis wölbt sich nach außen (oben) weg von der Kachelkante in den Zwischenraum
      const anchorD = `M ${stemX - anchorRadius} ${startY} A ${anchorRadius} ${anchorRadius} 0 0 1 ${stemX + anchorRadius} ${startY} Z`;

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

      // 2. Stamm vom Elternteil bis zur Höhenstufe (Lane)
      rawSegments.push({
        id: `${commonEdgeKey}-stem`,
        edgeKey: commonEdgeKey,
        x1: stemX,
        y1: startY,
        x2: stemX,
        y2: jogY,
        isHighlighted: isCommonHighlighted,
      });

      // 3. Pro Geschwistergruppe genau EINE eingehende Verbindungslinie ermitteln
      const cBoxesByGroup = new Map<string, CardBox[]>();
      cBoxes.forEach(cb => {
        const gId = cb.groupId || cb.person.id;
        if (!cBoxesByGroup.has(gId)) cBoxesByGroup.set(gId, []);
        cBoxesByGroup.get(gId)!.push(cb);
      });

      const groupTargets: { targetX: number; targetY: number; isHighlighted: boolean; key: string }[] = [];
      let targetIdx = 0;
      cBoxesByGroup.forEach((boxes) => {
        const minL = Math.min(...boxes.map(c => c.left));
        const maxR = Math.max(...boxes.map(c => c.right));
        // Der Ende-Anknüpfpunkt wird mittig an der Unterseite der Kachel bzw. bei Geschwistergruppen mittig an der Unterseite der Kachelgruppe angezeigt
        const targetX = Math.round((minL + maxR) / 2);
        const targetY = Math.max(...boxes.map(c => c.bottom));

        const isTargetHighlighted =
          Boolean(activeSel && (activeSel === parentId || boxes.some(c => c.person.id === activeSel))) ||
          Boolean(
            props.highlightedPathIds && props.highlightedPathIds.size > 0 &&
            props.highlightedPathIds.has(parentId) &&
            boxes.some(c => props.highlightedPathIds?.has(c.person.id))
          );

        groupTargets.push({
          targetX,
          targetY,
          isHighlighted: isTargetHighlighted,
          key: `${commonEdgeKey}-grp${targetIdx++}`,
        });
      });

      // 4. Horizontale Querlinie zwischen Stamm und Ziel-Geschwistergruppen
      const allTargetXs = groupTargets.map(t => t.targetX);
      const barMinX = Math.min(stemX, ...allTargetXs);
      const barMaxX = Math.max(stemX, ...allTargetXs);

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

      // 5. Einzelne eingehende Verbindungslinie und Pfeil pro Geschwistergruppe
      // Der Ende-Anknüpfpunkt wird mit einem eingehenden Pfeil an der Unterseite dargestellt (Pfeilspitze zeigt nach oben)
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
          direction: 'up',
          isHighlighted: tgt.isHighlighted,
        });
      });
    });
  });

  // 4. Schnittpunkte zwischen Kanten-Segmenten berechnen und Linienbrücken (Line Bridges) erzeugen
  const isDragging = draggingGroupId.value !== null;
  const bridgesBySegIdx = new Map<number, number[]>();
  let totalBridgesCount = 0;

  // Während aktivem Dragging Linienbrückenberechnung überspringen für 60-120 FPS
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

    // Kreuzungsprüfung: Nur horizontale Querlinien kreuzen vertikale Linien
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

      // Bogen als Brücke immer nach oben wölben (arch)
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
let dragRafId: number | null = null;
let pendingDragEvent: MouseEvent | null = null;

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

let dragBranchMinDx = -Infinity;
let dragBranchMaxDx = Infinity;
let dragBranchFixedDx: number | null = null;

function handleGroupDragMove(e: MouseEvent) {
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

  // Bereits bei Drag-Start vorberechnete Grenzen für Zweig-Breiten anwenden
  if (dragBranchFixedDx !== null) {
    candidateDx = dragBranchFixedDx;
  } else {
    candidateDx = Math.max(dragBranchMinDx, Math.min(dragBranchMaxDx, candidateDx));
  }

  // Ziel-Ebene aus der vertikalen Position berechnen
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

  // Überlappungen auf targetLevel vermeiden und stattdessen direkt an Nachbarn andocken
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

  // Magnetischer Kontakt (Snap) falls nahe an einer Kante (innerhalb SNAP_DISTANCE)
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

  // Alle aneinander gedockten Gruppen gemeinsam verschieben (Kantenkontakt bleibt exakt erhalten)
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

  // Zielplatz auf der Ebene expandieren und andere Einträge nach außen schieben,
  // sodass die vollständige Gruppe Platz findet und sich keine Eintragsboxen überschneiden
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
    expandAndResolveLevelOverlaps(group.level, new Set([leftGroup.id, rightGroup.id]));
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
  expandAndResolveLevelOverlaps(level);
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

  expandAndResolveLevelOverlaps(origGroupLevel, new Set([groupForPerson.id]));
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

  expandAndResolveLevelOverlaps(anchorGroup.level, new Set([mergedGroup.id]));
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

  expandAndResolveLevelOverlaps(group.level, clusterIds);
}

// Ebenen-Aktionen für Geschwistergruppen & einzelne Einträge (gedockte Einträge wechseln gemeinsam die Ebene)
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

// Canvas-Hintergrund Pan & Zoom
let didPanCanvas = false;
let panStartClient = { x: 0, y: 0 };
let panRafId: number | null = null;
let pendingPanEvent: MouseEvent | null = null;

function startCanvasPan(e: MouseEvent) {
  if (e.button !== 0) return;
  isPanning = true;
  didPanCanvas = false;
  panStartClient = { x: e.clientX, y: e.clientY };
  panStart = { x: e.clientX - pan.value.x, y: e.clientY - pan.value.y };
}

function handleCanvasPanMove(e: MouseEvent) {
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

function onCanvasPan(e: MouseEvent) {
  if (!isPanning) return;
  pendingPanEvent = e;
  if (panRafId === null) {
    panRafId = requestAnimationFrame(() => {
      panRafId = null;
      if (pendingPanEvent) {
        handleCanvasPanMove(pendingPanEvent);
        pendingPanEvent = null;
      }
    });
  }
}

function stopCanvasPan() {
  if (panRafId !== null) {
    cancelAnimationFrame(panRafId);
    panRafId = null;
  }
  if (pendingPanEvent) {
    handleCanvasPanMove(pendingPanEvent);
    pendingPanEvent = null;
  }
  isPanning = false;
}

// Selektion und Highlights aufheben
function clearSelection() {
  activeDesignPersonId.value = '';
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

  if (!target.closest('.bg-tool-wrapper') && !target.closest('.bg-image-popover') && !isBgDraggingOnCanvas.value) {
    isBgPopoverOpen.value = false;
  }

  // Wenn der Klick innerhalb eines Eintrages oder Funktionsbereiches erfolgte, Selektion nicht aufheben
  if (
    target.closest('.design-person-card') ||
    target.closest('.sibling-group-container') ||
    target.closest('.design-toolbar') ||
    target.closest('.floating-level-controls-container') ||
    target.closest('.design-zoom-controls') ||
    target.closest('.group-floating-controls') ||
    target.closest('.branch-width-bar') ||
    target.closest('.branch-corridor-zone') ||
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
  backgroundConfig?: DesignBackgroundConfig | null;
  backgroundImageData?: string | null;
  cardConfig?: DesignCardConfig;
  horizontalLaneGap?: number;
  autoSubLanes?: boolean;
  enableLineBridges?: boolean;
  bridgeRadius?: number;
  minimizeBridges?: boolean;
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
const isInitialOffer = ref(false);
const currentLayoutId = ref<string | null>(null);
const currentLayoutName = ref<string>('');
const autoLoadToast = ref<string>('');
let isApplyingLoadedState = false;
let hasInitialized = false;
let isCheckingLayout = false;

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
    version: 2,
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
    backgroundConfig: bgImageData.value ? { ...bgConfig.value } : null,
    backgroundImageData: bgImageData.value || null,
    cardConfig: { ...activeCardConfig.value },
    horizontalLaneGap: props.horizontalLaneGap,
    autoSubLanes: props.autoSubLanes,
    enableLineBridges: props.enableLineBridges,
    bridgeRadius: props.bridgeRadius,
    minimizeBridges: props.minimizeBridges,
  };
}

function closeSaveModal() {
  showSaveModal.value = false;
  isInitialOffer.value = false;
  saveFeedbackMessage.value = '';
}

function openInitialOfferModal() {
  const probandPerson = props.activeProbandId ? personById.value.get(props.activeProbandId) : null;
  const rawName = probandPerson
    ? `${probandPerson.given_name || ''}_${probandPerson.surname || ''}`.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\-äöüÄÖÜß]/g, '')
    : 'Stammbaum';
  const dateStr = new Date().toISOString().slice(0, 10);
  saveFileName.value = `${rawName || 'Design'}_${dateStr}`;
  saveFeedbackMessage.value = '';
  saveMode.value = 'new';
  selectedOverwriteId.value = '';
  existingPresets.value = [];
  isInitialOffer.value = true;
  showSaveModal.value = true;
}

async function checkAndLoadLatestStateOrOffer() {
  if (props.persons.length === 0 || isCheckingLayout) return;
  isCheckingLayout = true;
  isApplyingLoadedState = true;
  try {
    let layouts: DesignLayoutEntry[] = [];
    const currentProband = props.activeProbandId || '';

    // 1. Zuerst Layouts für aktuellen Probanden abrufen
    if (currentProband) {
      try {
        layouts = await invoke<DesignLayoutEntry[]>('get_design_layouts', { probandId: currentProband });
      } catch (err) {
        console.error('Error fetching layouts for proband', err);
      }
    }

    // 2. Falls für aktuellen Probanden keine Layouts vorliegen: alle Layouts des Stammbaums prüfen
    if (layouts.length === 0) {
      try {
        const all = await invoke<DesignLayoutEntry[]>('get_design_layouts', { probandId: '' });
        if (all.length > 0) {
          layouts = all;
        }
      } catch (err) {
        console.error('Error fetching all layouts', err);
      }
    }

    // 3. Wenn gespeicherte Stände existieren: den zuletzt bearbeiteten laden!
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

        if (targetLayout.proband_id && targetLayout.proband_id !== props.activeProbandId) {
          emit('select-proband', targetLayout.proband_id);
        }

        autoLoadToast.value = t('design_auto_loaded_toast', { name: targetLayout.name });
        setTimeout(() => {
          autoLoadToast.value = '';
        }, 3200);

        nextTick(() => {
          if (!parsed.pan) {
            centerOnOrigin();
          }
        });
        return;
      } catch (err) {
        console.error('Failed to parse and apply saved layout', err);
      }
    }

    // 4. Wurde noch kein Stand bearbeitet: Ausgangs-Layout erstellen und Erstellen einer neuen Datei anbieten
    buildInitialDesignLayout();
    nextTick(() => {
      centerOnOrigin();
      openInitialOfferModal();
    });
  } finally {
    isApplyingLoadedState = false;
    isCheckingLayout = false;
  }
}

async function openSaveModal() {
  isInitialOffer.value = false;
  const probandPerson = props.activeProbandId ? personById.value.get(props.activeProbandId) : null;
  const rawName = probandPerson
    ? `${probandPerson.given_name || ''}_${probandPerson.surname || ''}`.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\-äöüÄÖÜß]/g, '')
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
    const savedEntry = await invoke<DesignLayoutEntry>('save_design_layout', {
      probandId: props.activeProbandId || '',
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

    const overwriteId = (saveMode.value === 'overwrite' && selectedOverwriteId.value)
      ? selectedOverwriteId.value
      : (matchingExistingPreset.value ? matchingExistingPreset.value.id : null);
    try {
      const savedEntry = await invoke<DesignLayoutEntry>('save_design_layout', {
        probandId: props.activeProbandId || '',
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
  if (state.cardConfig) {
    emit('update-card-config', state.cardConfig);
  }
  emit('update-design-config', {
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

  // Hintergrundbild und Konfiguration für diesen Stand wiederherstellen
  if (state.backgroundImageData && state.backgroundConfig) {
    bgImageData.value = state.backgroundImageData;
    bgConfig.value = { ...DEFAULT_BACKGROUND_CONFIG, ...state.backgroundConfig };
    saveProbandBg(props.activeProbandId, state.backgroundImageData, bgConfig.value);
  } else {
    bgImageData.value = null;
    bgConfig.value = { ...DEFAULT_BACKGROUND_CONFIG };
    deleteProbandBg(props.activeProbandId);
  }

  activeDesignPersonId.value = '';
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
      const savedEntry = await invoke<DesignLayoutEntry>('save_design_layout', {
        probandId: props.activeProbandId || parsed.probandId || '',
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
      <!-- Auto-Load Notification Toast -->
      <transition name="fade">
        <div v-if="autoLoadToast" class="design-toast-notification">
          <span class="toast-icon">✨</span>
          <span>{{ autoLoadToast }}</span>
        </div>
      </transition>

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
          <button class="btn-design-tool btn-reset-design" @click="buildInitialDesignLayout">
            {{ t('design_reset_layout') }}
          </button>

          <!-- Button & Popover für Hintergrundbild -->
          <div class="bg-tool-wrapper">
            <button
              class="btn-design-tool btn-bg-image"
              :class="{ 'has-image': !!bgImageData, 'active': isBgPopoverOpen }"
              :title="t('design_bg_image_tooltip')"
              @click.stop="isBgPopoverOpen = !isBgPopoverOpen"
            >
              🖼️ {{ t('design_bg_image_btn') }}
              <span v-if="bgImageData" class="bg-indicator-dot" :class="{ 'is-hidden': !bgConfig.visible }"></span>
            </button>
          </div>

          <!-- Button zum Gruppieren aller Nachkommeneinträge des gewählten Eintrags je Ebene -->
          <button
            v-if="selectedDesignPerson && hasDescendants(selectedDesignPerson.id)"
            class="btn-design-tool btn-group-descendants"
            :title="t('design_group_descendants_tooltip')"
            @click="groupDescendantsByLevel(selectedDesignPerson.id)"
          >
            👥 {{ t('design_group_descendants_btn') }} ({{ selectedDesignPerson.given_name || 'N.N.' }} {{ selectedDesignPerson.surname || '' }})
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
        :class="{ panning: isPanning }"
        @mousedown="startCanvasPan"
        @mousemove="onCanvasPan"
        @mouseup="stopCanvasPan"
        @mouseleave="stopCanvasPan"
        @click="onViewportClick"
        @dragover.prevent
        @drop.prevent="onViewportFileDrop"
      >
        <!-- Popover für Hintergrundbild-Einstellungen: rechtsbündig zum Anzeigebereich, unterhalb des Buttons "Hintergrundbild" -->
        <div
          v-if="isBgPopoverOpen"
          class="bg-image-popover"
          @click.stop
          @mousedown.stop
          @wheel.stop
        >
          <div class="bg-popover-header">
            <span class="bg-popover-title">🖼️ {{ t('design_bg_image_title') }}</span>
            <button
              type="button"
              class="bg-popover-close"
              @click="isBgPopoverOpen = false"
            >✕</button>
          </div>

          <!-- Keine Datei geladen -->
          <div v-if="!bgImageData" class="bg-popover-empty">
            <p class="bg-drop-hint">{{ t('design_bg_image_drop_hint') }}</p>
            <button
              type="button"
              class="btn-bg-upload-big"
              @click="triggerBgUpload"
            >
              📁 {{ t('design_bg_image_upload_btn') }}
            </button>
          </div>

          <!-- Bild ist geladen -->
          <div v-else class="bg-popover-content">
            <!-- Status & Dateiinfo -->
            <div class="bg-file-info-row">
              <div class="bg-file-meta">
                <span class="bg-filename" :title="bgConfig.fileName || ''">
                  {{ bgConfig.fileName || 'Bild' }}
                </span>
                <span v-if="bgConfig.naturalWidth" class="bg-dims">
                  {{ bgConfig.naturalWidth }} × {{ bgConfig.naturalHeight }} px
                </span>
              </div>
              <div class="bg-file-actions">
                <button
                  type="button"
                  class="btn-icon-bg"
                  :class="{ 'is-active': bgConfig.visible }"
                  :title="bgConfig.visible ? t('design_bg_image_hidden') : t('design_bg_image_visible')"
                  @click="bgConfig.visible = !bgConfig.visible"
                >
                  {{ bgConfig.visible ? '👁️' : '🙈' }}
                </button>
                <button
                  type="button"
                  class="btn-icon-bg"
                  :title="t('design_bg_image_replace_btn')"
                  @click="triggerBgUpload"
                >
                  🔄
                </button>
                <button
                  type="button"
                  class="btn-icon-bg danger"
                  :title="t('design_bg_image_delete_btn')"
                  @click="removeBgImage"
                >
                  🗑️
                </button>
              </div>
            </div>

            <!-- Skalierung / Größe -->
            <div class="bg-control-section">
              <div class="bg-section-label-row">
                <label>🔍 {{ t('design_bg_image_scale_label') }}</label>
                <span class="bg-val-badge">{{ bgConfig.scale }}%</span>
              </div>
              <div class="bg-slider-row">
                <input
                  type="range"
                  min="10"
                  max="400"
                  step="1"
                  v-model.number="bgConfig.scale"
                  class="bg-slider"
                />
                <input
                  type="number"
                  min="10"
                  max="1000"
                  v-model.number="bgConfig.scale"
                  class="bg-num-input"
                />
              </div>
              <div class="bg-quick-btn-row">
                <button type="button" class="btn-quick-bg" @click="resetBgScale">{{ t('design_bg_image_orig_btn') }}</button>
                <button type="button" class="btn-quick-bg" @click="fitBgToWidth">{{ t('design_bg_image_fit_w_btn') }}</button>
                <button type="button" class="btn-quick-bg" @click="fitBgToHeight">{{ t('design_bg_image_fit_h_btn') }}</button>
              </div>
            </div>

            <!-- Deckkraft / Transparenz -->
            <div class="bg-control-section">
              <div class="bg-section-label-row">
                <label>🌓 {{ t('design_bg_image_opacity_label') }}</label>
                <span class="bg-val-badge">{{ bgConfig.opacity }}%</span>
              </div>
              <div class="bg-slider-row">
                <input
                  type="range"
                  min="5"
                  max="100"
                  step="1"
                  v-model.number="bgConfig.opacity"
                  class="bg-slider"
                />
                <input
                  type="number"
                  min="5"
                  max="100"
                  v-model.number="bgConfig.opacity"
                  class="bg-num-input"
                />
              </div>
            </div>

            <!-- Positionierung -->
            <div class="bg-control-section">
              <div class="bg-section-label-row">
                <label>📍 {{ t('design_bg_image_pos_label') }}</label>
                <button
                  type="button"
                  class="btn-toggle-drag-bg"
                  :class="{ active: isBgDraggingOnCanvas }"
                  @click="isBgDraggingOnCanvas = !isBgDraggingOnCanvas"
                  :title="isBgDraggingOnCanvas ? 'Maus-Verschieben beenden' : 'Mit der Maus im Canvas verschieben'"
                >
                  ✥ {{ isBgDraggingOnCanvas ? 'Aktiv (Ziehen)' : 'Per Maus' }}
                </button>
              </div>
              <div class="bg-coord-row">
                <label>
                  <span>X:</span>
                  <input type="number" v-model.number="bgConfig.x" class="bg-num-input coord" />
                </label>
                <label>
                  <span>Y:</span>
                  <input type="number" v-model.number="bgConfig.y" class="bg-num-input coord" />
                </label>
              </div>
              <div class="bg-quick-btn-row">
                <button type="button" class="btn-quick-bg" @click="centerBgImage">⌖ {{ t('design_bg_image_center_btn') }}</button>
                <button type="button" class="btn-quick-bg" @click="alignBottomCenterBgImage">⬇️ {{ t('design_bg_image_bottom_btn') }}</button>
                <button type="button" class="btn-quick-bg" @click="alignTopLeftBgImage">↖️ Oben links</button>
              </div>
            </div>
          </div>
        </div>

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
                @click.stop="isBgDraggingOnCanvas = false"
                :title="t('design_bg_image_finish_drag')"
              >
                ✓ {{ t('design_bg_image_finish_drag') }}
              </button>
            </div>
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
            <!-- Ausgangs-Anknüpfpunkte (Halbkreise außen) an der oberen Kante der Elternkacheln -->
            <path
              v-for="(anc, idx) in edgeGeometry.anchors"
              :key="'anc-' + idx"
              :d="anc.d"
              class="design-edge-anchor"
              :class="{ 'is-highlighted': anc.isHighlighted }"
            />
            <!-- Eingehende Pfeile an der Unterseite der Kinderkacheln/-gruppen -->
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
                <!-- Nachname pro Geschwistergruppe linksbündig oberhalb der Kachel -->
                <div
                  v-if="subGrp.surname"
                  class="subgroup-surname-label"
                  :title="subGrp.surname"
                >
                  {{ subGrp.surname }}
                </div>

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
                  :style="{ width: CARD_WIDTH + 'px', height: cb.height + 'px' }"
                  @click.stop="selectCardPerson(cb.person)"
                >
                <!-- Button zum Gruppieren der Nachkommen des Eintrags & Reservierten Bereich setzen: sichtbar wenn Nachkommen vorhanden -->
                <button
                  v-if="hasDescendants(cb.person.id)"
                  class="group-descendants-card-btn"
                  :class="{ 'is-selected': isPersonSelected(cb.person.id) }"
                  :title="t('design_group_descendants_tooltip')"
                  @mousedown.stop
                  @click.stop="groupDescendantsByLevel(cb.person.id)"
                >
                  👥
                </button>

                <!-- Button zum Ein- und Ausklappen der Nachfahren: sichtbar wenn Nachkommen vorhanden -->
                <button
                  v-if="hasDescendants(cb.person.id)"
                  class="descendant-toggle-btn"
                  :class="{ 'is-expanded': isParentExpanded(cb.person.id) }"
                  :title="isParentExpanded(cb.person.id) ? t('collapse_children_tooltip') : t('expand_children_tooltip')"
                  @mousedown.stop
                  @click.stop="toggleDescendants(cb.person.id)"
                >
                  {{ isParentExpanded(cb.person.id) ? '▼' : '▲' }}
                </button>

                <!-- Zeile #1: Henry ID & Badges -->
                <div class="d-card-top" :style="getLineStyle(activeCardConfig.line1Bold, activeCardConfig.line1Italic)">
                  <span v-if="activeCardConfig.showHenryId && cardDataByPersonId.get(cb.person.id)?.henryCode" class="d-henry-badge">
                    [{{ cardDataByPersonId.get(cb.person.id)?.henryCode }}]
                  </span>
                  <span v-if="activeCardConfig.showGeneration && cb.generation" class="d-gen-badge">Gen. {{ cb.generation }}</span>

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

                <!-- Zeile #2: Vorname (in der Kachel wird nur noch der Vorname angezeigt) -->
                <div
                  class="d-card-name"
                  :style="getLineStyle(activeCardConfig.line2Bold, activeCardConfig.line2Italic)"
                  :title="cardDataByPersonId.get(cb.person.id)?.fullName"
                >
                  {{ cardDataByPersonId.get(cb.person.id)?.firstName }}
                </div>

                <!-- Zeile #3: Geburts-, Tauf- und Todesdaten mit vorn angestellten Icons -->
                <div
                  v-if="cardDataByPersonId.get(cb.person.id)?.hasLine3"
                  class="d-card-line-3"
                  :class="{ 'd-card-line-3-single': activeCardConfig.lifeDatesLayout === 'single' }"
                  :style="getLineStyle(activeCardConfig.line3Bold, activeCardConfig.line3Italic)"
                >
                  <span v-if="cardDataByPersonId.get(cb.person.id)?.birthText" class="d-date-item nowrap-date">
                    {{ cardDataByPersonId.get(cb.person.id)?.birthText }}
                  </span>
                  <span v-if="cardDataByPersonId.get(cb.person.id)?.chrText" class="d-date-item nowrap-date">
                    {{ cardDataByPersonId.get(cb.person.id)?.chrText }}
                  </span>
                  <span v-if="cardDataByPersonId.get(cb.person.id)?.deathText" class="d-date-item nowrap-date">
                    {{ cardDataByPersonId.get(cb.person.id)?.deathText }}
                  </span>
                </div>

                <!-- Zeilen #4 & #5: Ehen / Ehepartner (Status-Icon + Name, Hochzeits/Scheidungsdatum, Geburts/Todesdatum) -->
                <div
                  v-if="cardDataByPersonId.get(cb.person.id)?.hasMarriage"
                  class="d-card-marriages-block"
                >
                  <div
                    v-for="(spInfo, sIdx) in (cardDataByPersonId.get(cb.person.id)?.spouses || [])"
                    :key="'sp-' + sIdx"
                    class="d-marriage-entry"
                  >
                    <!-- Linke Spalte: Status-Icon (⚭ verbundene Ringe / ⚮ getrennte Ringe) & Zähler -->
                    <div class="d-spouse-status-col">
                      <span v-if="activeCardConfig.showMarriageCounter" class="d-marriage-counter">({{ sIdx + 1 }})</span>
                      <span
                        class="d-spouse-status-icon"
                        :title="(spInfo.isDivorced || spInfo.divorceDate) ? t('divorced') : t('married')"
                      >{{ (spInfo.isDivorced || spInfo.divorceDate) ? '⚮' : '⚭' }}</span>
                    </div>

                    <!-- Rechte Spalte: Name, Hochzeits/Scheidungsdatum, Lebensdaten eingerückt auf einer Höhe zum Namen -->
                    <div class="d-spouse-details-col">
                      <!-- Row 1: Name Ehepartner [Henry ID] -->
                      <div
                        v-if="(activeCardConfig.showSpouseName && spInfo.name) || (activeCardConfig.showHenryId && spInfo.henry)"
                        class="d-spouse-name-row"
                        :style="getLineStyle(activeCardConfig.line4Bold, activeCardConfig.line4Italic)"
                      >
                        <span v-if="activeCardConfig.showSpouseName && spInfo.name" class="d-spouse-name">{{ spInfo.name }}</span>
                        <span v-if="activeCardConfig.showHenryId && spInfo.henry" class="d-spouse-henry">[{{ spInfo.henry }}]</span>
                      </div>

                      <!-- Row 2: Hochzeits-, Scheidungs-, Geburts- und Todesdatum (in einer Zeile bei single layout) -->
                      <div
                        v-if="spInfo.dateItems.length > 0"
                        class="d-spouse-dates-row"
                        :class="{ 'd-spouse-dates-multi': activeCardConfig.lifeDatesLayout === 'multi' }"
                        :style="getLineStyle(activeCardConfig.line5Bold, activeCardConfig.line5Italic)"
                      >
                        <span
                          v-for="(item, dIdx) in spInfo.dateItems"
                          :key="item.key"
                          class="nowrap-date d-spouse-date-item"
                          :class="{ 'd-divorce-badge': item.isDivorce }"
                        >
                          {{ item.text }}<span v-if="activeCardConfig.lifeDatesLayout === 'single' && dIdx < spInfo.dateItems.length - 1" class="d-date-sep">, </span>
                        </span>
                      </div>
                    </div>
                  </div>
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
      <div v-if="showSaveModal" class="design-modal-backdrop" @click="closeSaveModal" @mousedown.stop>
        <div class="design-modal-window" @click.stop>
          <div class="design-modal-header">
            <div class="design-modal-title">
              <span class="design-modal-icon">💾</span>
              <h3>{{ isInitialOffer ? t('design_initial_offer_title') : t('design_save_modal_title') }}</h3>
            </div>
            <button class="design-modal-close-btn" @click="closeSaveModal">✕</button>
          </div>

          <div class="design-modal-body">
            <!-- Hinweis-Banner beim ersten Öffnen / wenn noch kein Stand existiert -->
            <div v-if="isInitialOffer" class="design-initial-offer-banner">
              <span class="offer-icon">💡</span>
              <div class="offer-text">
                <strong>{{ t('design_initial_offer_badge') }}</strong>
                <p>{{ t('design_initial_offer_subtitle') }}</p>
              </div>
            </div>

            <div class="design-modal-proband-banner">
              <span class="proband-label">Stammahn:</span>
              <strong>{{ activeProbandName || '–' }}</strong>
            </div>

            <!-- Modus-Auswahl: Neuer Stand oder Bestehenden Stand überschreiben -->
            <div v-if="!isInitialOffer && existingPresets.length > 0" class="save-mode-selector">
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
            <template v-if="isInitialOffer">
              <button
                class="d-modal-btn d-modal-btn-primary"
                :disabled="!saveFileName.trim() || isSaving"
                @click="exportStateToFile"
              >
                {{ t('design_initial_offer_create_file_btn') }}
              </button>
              <button
                class="d-modal-btn d-modal-btn-secondary"
                :disabled="!saveFileName.trim() || isSaving"
                @click="saveCurrentStateToDb"
              >
                {{ t('design_save_to_db_btn') }}
              </button>
              <button class="d-modal-btn d-modal-btn-cancel" @click="closeSaveModal">
                {{ t('design_initial_offer_later_btn') }}
              </button>
            </template>
            <template v-else>
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
              <button class="d-modal-btn d-modal-btn-cancel" @click="closeSaveModal">
                {{ t('cancel') || 'Abbrechen' }}
              </button>
            </template>
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

      <!-- Versteckter Datei-Input für Hintergrundbild-Upload (JPG, PNG, SVG, WEBP) -->
      <input
        ref="bgFileInputRef"
        type="file"
        accept=".jpg,.jpeg,.png,.svg,.webp,image/jpeg,image/png,image/svg+xml,image/webp"
        style="display: none;"
        @change="onBgFileSelected"
      />
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
.btn-group-descendants {
  background: #2563eb;
  color: white;
}
.btn-group-descendants:hover {
  background: #1d4ed8;
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
.design-edge-anchor {
  fill: #1e293b;
  stroke: #1e293b;
  stroke-width: 1.5px;
  transition: fill 0.12s ease, stroke 0.12s ease;
}
.design-edge-anchor.is-highlighted {
  fill: #e67e22;
  stroke: #e67e22;
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

/* Personen-Boxen: Jede Kachel passt sich dynamisch ihrem Inhalt an */
.design-person-card {
  position: relative;
  background: white;
  border: 3px solid #1e293b;
  border-bottom: 3.5px solid #64748b;
  padding: 5px 6px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: 2px;
  cursor: grab;
  overflow: visible;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
}
.design-person-card + .design-person-card {
  margin-left: -3px;
}
.design-person-card:active {
  cursor: grabbing;
}
.design-person-card.male {
  border-bottom: 3.5px solid #2980b9 !important;
}
.design-person-card.female {
  border-bottom: 3.5px solid #e84393 !important;
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

/* Zustände der Gruppe auf die Kacheln übertragen */
.sibling-group-container.is-multi-sibling-group .design-person-card {
  border-top-width: 3.5px;
  border-left-width: 3.5px;
  border-right-width: 3.5px;
}
.sibling-group-container.is-origin-group .design-person-card {
  border-top-color: #0e6251;
  border-left-color: #0e6251;
  border-right-color: #0e6251;
}
.sibling-group-container.is-docked .design-person-card {
  box-shadow: 0 0 0 1.5px #27ae60;
}
.sibling-group-container.is-dragging .design-person-card {
  border-color: #e67e22 !important;
  box-shadow: 0 8px 22px rgba(230, 126, 34, 0.35) !important;
}

/* Button auf dem Eintrag zum Gruppieren der Nachkommen je Ebene */
.group-descendants-card-btn {
  position: absolute;
  top: -12px;
  left: 6px;
  width: 24px;
  height: 18px;
  padding: 0;
  font-size: 0.68rem;
  line-height: 1;
  background: #2563eb;
  color: white;
  border: 1px solid #1d4ed8;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 35;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
  transition: transform 0.15s, background 0.15s;
}
.group-descendants-card-btn:hover {
  background: #1d4ed8;
  transform: scale(1.15);
}

/* Button zum Ein- und Ausklappen der Nachfahren direkt am oberen Rand des Kästchens */
.descendant-toggle-btn {
  position: absolute;
  top: -12px;
  right: 6px;
  width: 22px;
  height: 18px;
  padding: 0;
  font-size: 0.65rem;
  font-weight: bold;
  line-height: 1;
  background: #34495e;
  color: white;
  border: 1px solid #1e293b;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 35;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
  transition: transform 0.15s, background 0.15s;
}
.descendant-toggle-btn:hover {
  background: #2980b9;
  transform: scale(1.15);
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
  white-space: normal;
  word-break: break-word;
  overflow-wrap: break-word;
  text-align: center;
  line-height: 1.25;
  margin: 2px 0;
}
.d-card-line-3 {
  font-size: 0.65rem;
  color: #475569;
  text-align: center;
  line-height: 1.2;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.d-card-line-3-single {
  flex-direction: row !important;
  flex-wrap: wrap !important;
  justify-content: center !important;
  gap: 5px !important;
}
.nowrap-date {
  white-space: nowrap;
}
.d-spouse-henry {
  font-size: 0.62rem;
  font-weight: 700;
  color: #d97706;
}
.d-card-marriages-block {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 2px;
  border-top: 1px dashed #cbd5e1;
  padding-top: 2px;
}
.d-marriage-entry {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 4px;
  line-height: 1.2;
}
.d-spouse-status-col {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  padding-top: 1px;
}
.d-spouse-status-icon {
  font-size: 0.78rem;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #475569;
  user-select: none;
}
.d-spouse-status-icon.is-divorced {
  color: #c0392b;
}
.d-spouse-details-col {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  flex-grow: 1;
  min-width: 0;
  text-align: left;
}
.d-spouse-name-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px;
  font-size: 0.66rem;
  color: #1e293b;
  line-height: 1.2;
}
.d-spouse-name {
  font-weight: 600;
  color: #1e293b;
}
.d-spouse-dates-row {
  font-size: 0.65rem;
  color: #475569;
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px;
  line-height: 1.2;
}
.d-spouse-dates-row.d-spouse-dates-multi {
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
}
.d-spouse-date-item {
  color: #475569;
  font-size: 0.65rem;
}
.d-marriage-counter {
  font-weight: 700;
  color: #2563eb;
  font-size: 0.66rem;
}
.d-divorce-badge {
  color: #c0392b;
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

.design-toast-notification {
  position: absolute;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(15, 23, 42, 0.92);
  color: #f8fafc;
  padding: 8px 18px;
  border-radius: 20px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  font-size: 0.85rem;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 8px;
  z-index: 1200;
  pointer-events: none;
  border: 1px solid rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(4px);
}

.design-initial-offer-banner {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  color: #1e3a8a;
  padding: 12px 14px;
  border-radius: 8px;
  font-size: 0.88rem;
}
.design-initial-offer-banner .offer-icon {
  font-size: 1.3rem;
  line-height: 1;
}
.design-initial-offer-banner .offer-text strong {
  display: block;
  font-size: 0.92rem;
  color: #1e40af;
  margin-bottom: 3px;
}
.design-initial-offer-banner .offer-text p {
  margin: 0;
  color: #1e3a8a;
  line-height: 1.35;
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

/* ----------------------------------------------------
   Hintergrundbild (Design Mode)
   ---------------------------------------------------- */
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

.bg-tool-wrapper {
  position: relative;
  display: inline-block;
}

.btn-bg-image {
  background: #475569;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  position: relative;
}

.btn-bg-image:hover {
  background: #334155;
}

.btn-bg-image.has-image {
  background: #0284c7;
}

.btn-bg-image.has-image:hover {
  background: #0369a1;
}

.btn-bg-image.active {
  box-shadow: 0 0 0 2px #38bdf8;
}

.bg-indicator-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #22c55e;
  display: inline-block;
}

.bg-indicator-dot.is-hidden {
  background: #f59e0b;
}

.bg-image-popover {
  position: absolute;
  top: 10px;
  right: 14px;
  left: auto;
  width: 340px;
  max-width: calc(100% - 28px);
  max-height: calc(100% - 20px);
  overflow-y: auto;
  overscroll-behavior: contain;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  box-shadow: 0 12px 32px -4px rgba(0, 0, 0, 0.22), 0 8px 12px -6px rgba(0, 0, 0, 0.12);
  z-index: 60;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  user-select: none;
  box-sizing: border-box;
}

.bg-image-popover::-webkit-scrollbar {
  width: 6px;
}

.bg-image-popover::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 3px;
}

.bg-image-popover::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}

.bg-popover-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #f1f5f9;
  padding-bottom: 8px;
}

.bg-popover-title {
  font-size: 0.88rem;
  font-weight: 700;
  color: #0f172a;
}

.bg-popover-close {
  background: none;
  border: none;
  font-size: 1rem;
  color: #64748b;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
}

.bg-popover-close:hover {
  background: #f1f5f9;
  color: #0f172a;
}

.bg-popover-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 10px;
  padding: 12px 6px;
}

.bg-drop-hint {
  font-size: 0.8rem;
  color: #64748b;
  margin: 0;
  line-height: 1.4;
}

.btn-bg-upload-big {
  width: 100%;
  background: #2563eb;
  color: white;
  border: none;
  padding: 8px 14px;
  border-radius: 6px;
  font-size: 0.84rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease;
}

.btn-bg-upload-big:hover {
  background: #1d4ed8;
}

.bg-popover-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.bg-file-info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #f8fafc;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
}

.bg-file-meta {
  display: flex;
  flex-direction: column;
  max-width: 180px;
}

.bg-filename {
  font-size: 0.78rem;
  font-weight: 600;
  color: #1e293b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bg-dims {
  font-size: 0.7rem;
  color: #64748b;
}

.bg-file-actions {
  display: flex;
  gap: 4px;
}

.btn-icon-bg {
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  padding: 4px 6px;
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-icon-bg:hover {
  background: #f1f5f9;
  border-color: #94a3b8;
}

.btn-icon-bg.danger:hover {
  background: #fef2f2;
  border-color: #ef4444;
  color: #dc2626;
}

.btn-icon-bg.is-active {
  background: #eff6ff;
  border-color: #3b82f6;
}

.bg-control-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.bg-section-label-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.78rem;
  font-weight: 600;
  color: #334155;
}

.bg-val-badge {
  font-size: 0.74rem;
  font-weight: 700;
  color: #2563eb;
  background: #eff6ff;
  padding: 1px 6px;
  border-radius: 4px;
}

.bg-slider-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.bg-slider {
  flex: 1;
  height: 5px;
  accent-color: #2563eb;
  cursor: pointer;
}

.bg-num-input {
  width: 52px;
  padding: 3px 5px;
  font-size: 0.78rem;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  text-align: right;
  outline: none;
}

.bg-num-input:focus {
  border-color: #2563eb;
}

.bg-num-input.coord {
  width: 70px;
}

.bg-quick-btn-row {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
}

.btn-quick-bg {
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  color: #334155;
  font-size: 0.72rem;
  font-weight: 600;
  padding: 3px 7px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.12s ease;
}

.btn-quick-bg:hover {
  background: #e2e8f0;
  color: #0f172a;
}

.btn-toggle-drag-bg {
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  font-size: 0.7rem;
  font-weight: 600;
  color: #475569;
  padding: 2px 7px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.12s ease;
}

.btn-toggle-drag-bg:hover {
  background: #e2e8f0;
  color: #0f172a;
}

.btn-toggle-drag-bg.active {
  background: #2563eb;
  border-color: #1d4ed8;
  color: #ffffff;
}

.bg-coord-row {
  display: flex;
  gap: 12px;
  align-items: center;
}

.bg-coord-row label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.78rem;
  color: #475569;
  font-weight: 600;
}
</style>
