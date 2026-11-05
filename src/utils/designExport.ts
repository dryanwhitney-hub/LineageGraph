/**
 * Utility for exporting the Stammbaum Design Mode as an image file (PNG, JPG, SVG).
 * Supports level grid toggle, background image inclusion or transparent background,
 * and vector-crisp SVG generation with line bridges and parent-child connections.
 */

import {
  type DesignCardConfig,
  type DesignBackgroundConfig,
  DEFAULT_CARD_CONFIG,
  computePersonCardNeededHeight,
  formatLocalizedDate,
} from '../types/design';

export interface DesignExportPerson {
  id: string;
  given_name: string | null;
  surname: string | null;
  sex: string | null;
  birth_date: string | null;
  birth_place: string | null;
  death_date: string | null;
  death_place: string | null;
  gedcom_extra?: Record<string, any>;
  spouses?: {
    id: string;
    date?: string | null;
    place?: string | null;
    divorce_date?: string | null;
    is_divorced?: boolean;
    [key: string]: any;
  }[];
  parent_ids?: string[];
  proband_data?: Record<string, { henry_code?: string; generation?: number; branch?: string | number }>;
}

export interface DesignPersistedState {
  version: number;
  probandId: string;
  probandName?: string;
  name: string;
  savedAt: string;
  totalLevels: number;
  levelHeights: Record<number, number>;
  siblingGroups: DesignExportSiblingGroup[];
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

export interface DesignExportSiblingGroup {
  id: string;
  parentId: string | null;
  generation: number;
  level: number;
  x: number;
  memberIds: string[];
  isUngrouped?: boolean;
}

export interface DesignExportOptions {
  includeGrid: boolean; // default: false
  includeBackground: boolean; // default: true
  format: 'png' | 'jpg' | 'svg';
  scale?: number; // 1 or 2
  cardConfig?: DesignCardConfig;
  onlyYears?: boolean;
  locale?: string; // 'de' | 'en'
  enableLineBridges?: boolean;
  bridgeRadius?: number;
  horizontalLaneGap?: number;
}

export interface DesignExportResult {
  svgString: string;
  width: number;
  height: number;
  viewBox: { x: number; y: number; width: number; height: number };
  stats: {
    totalLevels: number;
    totalPersons: number;
    totalGroups: number;
    hasBackground: boolean;
  };
}

const CARD_WIDTH = 130;
const CANVAS_PAD_TOP = 40;
const MIN_LEVEL_HEIGHT = 160;
const DEFAULT_LEVEL_HEIGHT = 180;
const CORRIDOR_PAD_TOP = 24;
const CORRIDOR_PAD_BOTTOM = 28;
const CORRIDOR_EMPTY = 36;

function getBaptismInfo(person: DesignExportPerson): { date: string | null; place: string | null } {
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

function escapeXml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Berechnet optimale Höhenstufen (Lanes) für Querlinien:
// - Linien ohne gemeinsamen horizontalen Abschnitt dürfen Linienhöhen wiederverwenden.
// Berechnet optimale Höhenstufen (Lanes) für Querlinien:
// - Linien ohne gemeinsamen horizontalen Abschnitt dürfen Linienhöhen wiederverwenden,
//   sofern sie einen horizontalen Sicherheitsabstand einhalten (keine Berührung an Endpunkten).
// - Linien mit gemeinsamem horizontalem Abschnitt erhalten zwingend unterschiedliche Linienhöhen (keine Überdeckung).
// - Vertikale Linien dürfen Querlinien kreuzen.
function assignNonOverlappingLanes(
  items: { parentId?: string; parentX: number; minChildX: number; maxChildX: number; childrenX?: number[] }[],
  direction: 'up' | 'same' | 'down' = 'up'
): { lanes: number[]; totalLanes: number } {
  const n = items.length;
  if (n === 0) return { lanes: [], totalLanes: 0 };
  if (n === 1) return { lanes: [0], totalLanes: 1 };

  const parsed = items.map((rel, origIdx) => {
    const parentX = rel.parentX;
    const minChildX = rel.minChildX;
    const maxChildX = rel.maxChildX;
    const childrenX = rel.childrenX ?? [minChildX, maxChildX];
    const barMin = Math.min(parentX, minChildX);
    const barMax = Math.max(parentX, maxChildX);
    const span = Math.max(0, barMax - barMin);
    const centerX = (barMin + barMax) / 2;
    return { origIdx, parentX, barMin, barMax, span, centerX, childrenX };
  });

  // Mindestabstand (in px) zwischen horizontalen Balken auf derselben Lane, um optisches Verschmelzen zu verhindern
  const LANE_REUSE_SAFETY_GAP = 6;

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
          if (pc.overlap) cost += 100000;
        } else if (lI < lJ) {
          cost += pc.iBelowJ;
          // Maßgabe: Umso weiter "außen" ein Nachkommenknoten liegt, umso tiefer soll der horizontale Abschnitt liegen.
          if (direction !== 'down') {
            if (parsed[i].span > parsed[j].span + 4) cost += 3.0;
          } else {
            if (parsed[j].span > parsed[i].span + 4) cost += 3.0;
          }
        } else {
          cost += pc.jBelowI;
          if (direction !== 'down') {
            if (parsed[j].span > parsed[i].span + 4) cost += 3.0;
          } else {
            if (parsed[i].span > parsed[j].span + 4) cost += 3.0;
          }
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

  // 1. Kandidat: Verschachtelung (innere umschlossene Spannen zuerst bei 'up', äußere zuerst bei 'down')
  const order1 = parsed.map((it, idx) => {
    let enclosedByCount = 0;
    for (let other = 0; other < n; other++) {
      if (other === idx) continue;
      if (parsed[other].barMin <= it.barMin + 4 && parsed[other].barMax >= it.barMax - 4) {
        enclosedByCount++;
      }
    }
    const score = direction !== 'down'
      ? (enclosedByCount * 10000 - it.span)
      : (-enclosedByCount * 10000 + it.span);
    return { idx, score };
  }).sort((a, b) => b.score - a.score).map(o => o.idx);

  // 2. Kandidat: Greedy nach Position (von links nach rechts)
  const order2 = parsed.map((it, idx) => ({ idx, minX: it.barMin }))
    .sort((a, b) => a.minX - b.minX).map(o => o.idx);

  // 3. Kandidat: Kürzeste Spannen zuerst (bei 'up') bzw. Längste zuerst (bei 'down')
  const order3 = parsed.map((it, idx) => ({ idx, span: it.span }))
    .sort((a, b) => direction !== 'down' ? (a.span - b.span) : (b.span - a.span)).map(o => o.idx);

  // 4. Kandidat: Längste Spannen zuerst (bei 'up') bzw. Kürzeste zuerst (bei 'down')
  const order4 = parsed.map((it, idx) => ({ idx, span: it.span }))
    .sort((a, b) => direction !== 'down' ? (b.span - a.span) : (a.span - b.span)).map(o => o.idx);

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
    while (improved && iters < 14) {
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

interface ExportCard {
  person: DesignExportPerson;
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

interface ExportGroup {
  group: DesignExportSiblingGroup;
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
  cards: ExportCard[];
  subGroups: { parentId: string | null; cards: ExportCard[]; surname: string }[];
}

function getSiblingSubGroupSurname(cards: ExportCard[], parentPerson: DesignExportPerson | null): string {
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

/**
 * Builds the standalone SVG representing the tree state.
 */
export function generateDesignExportSvg(
  state: DesignPersistedState,
  persons: DesignExportPerson[],
  options: DesignExportOptions
): DesignExportResult {
  const cfg: DesignCardConfig = {
    ...DEFAULT_CARD_CONFIG,
    ...(state.cardConfig || {}),
    ...(options.cardConfig || {}),
    ...(options.onlyYears !== undefined ? { showOnlyYears: options.onlyYears } : {}),
  };
  const loc = options.locale || 'de';
  const totalLevels = Math.max(1, state.totalLevels || 1);
  const siblingGroups = (state.siblingGroups || []).filter(g => g.memberIds && g.memberIds.length > 0);
  const probandId = state.probandId || '';

  const personById = new Map<string, DesignExportPerson>();
  persons.forEach(p => personById.set(p.id, p));

  // Determine biological parent for each child
  const biologicalParentMap = new Map<string, string>();
  persons.forEach(p => {
    for (const pid of p.parent_ids || []) {
      if (!biologicalParentMap.has(p.id) && personById.has(pid)) {
        biologicalParentMap.set(p.id, pid);
      }
    }
  });


  function computeCardHeightForPerson(personId: string, generation?: number): number {
    const p = personById.get(personId);
    if (!p) return 50;
    const chr = getBaptismInfo(p);
    const hasHenry = Boolean(p.proband_data && probandId && p.proband_data[probandId]?.henry_code);

    const spousesInput = (p.spouses || []).map(sp => {
      const spPerson = personById.get(sp.id);
      const spHenry = Boolean(spPerson?.proband_data && probandId && spPerson.proband_data[probandId]?.henry_code);
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

    return computePersonCardNeededHeight(
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
        generation,
        spouses: spousesInput,
      },
      cfg,
      loc
    );
  }

  const cardHeightByPersonId = new Map<string, number>();
  siblingGroups.forEach(g => {
    g.memberIds.forEach(id => {
      if (!cardHeightByPersonId.has(id)) {
        cardHeightByPersonId.set(id, computeCardHeightForPerson(id, g.generation));
      }
    });
  });

  function getCardHeightForPerson(personId: string, generation?: number): number {
    const cached = cardHeightByPersonId.get(personId);
    if (cached !== undefined) return cached;
    const computed = computeCardHeightForPerson(personId, generation);
    cardHeightByPersonId.set(personId, computed);
    return computed;
  }

  const LEVEL_CARD_PAD_TOP = 26;

  // Single pass calculation of level geometry
  const groupByPersonId = new Map<string, DesignExportSiblingGroup>();
  siblingGroups.forEach(g => {
    g.memberIds.forEach(id => groupByPersonId.set(id, g));
  });

  const levelGroupsMap = new Map<number, DesignExportSiblingGroup[]>();
  siblingGroups.forEach(g => {
    if (!levelGroupsMap.has(g.level)) {
      levelGroupsMap.set(g.level, []);
    }
    levelGroupsMap.get(g.level)!.push(g);
  });

  const levelHeights: Record<number, number> = {};
  const levelBandTopY: Record<number, number> = {};
  const levelCardTopY: Record<number, number> = {};
  const levelMaxCardBottom: Record<number, number> = {};
  const levelMaxCardHeights: Record<number, number> = {};
  const levelRequiredLanes: Record<number, number> = {};

  const gap = Math.max(10, options.horizontalLaneGap || state.horizontalLaneGap || 16);

  // Alle Querlinien nach physischem Korridor indizieren (up, same und down)
  // Verwende dieselbe kartenbasierte Eltern-Kind-Zuordnung wie in computeEdgeGeometry,
  // damit auch gruppierte/verschmolzene Geschwisterreihen mit mehreren biologischen Eltern
  // exakt dieselben Relationen und Lane-Bedarfe ermitteln.
  interface HorizCardPos {
    id: string;
    groupId: string;
    level: number;
    left: number;
    right: number;
    centerX: number;
    person: DesignExportPerson;
  }
  const cardPosByPersonId = new Map<string, HorizCardPos>();
  siblingGroups.forEach(g => {
    const width = g.memberIds.length * CARD_WIDTH;
    const left = Math.round(g.x - width / 2);
    g.memberIds.forEach((pid, idx) => {
      const p = personById.get(pid);
      if (!p) return;
      const cLeft = left + idx * CARD_WIDTH;
      const cRight = cLeft + CARD_WIDTH;
      cardPosByPersonId.set(pid, {
        id: pid,
        groupId: g.id,
        level: g.level,
        left: cLeft,
        right: cRight,
        centerX: cLeft + CARD_WIDTH / 2,
        person: p,
      });
    });
  });

  const corridorChildrenByParentAndLevel = new Map<string, Map<number, HorizCardPos[]>>();
  cardPosByPersonId.forEach(cb => {
    let pId: string | undefined;
    if (cb.person.parent_ids && cb.person.parent_ids.length > 0) {
      pId = cb.person.parent_ids.find(id => cardPosByPersonId.has(id));
    }
    if (!pId) return;
    const pBox = cardPosByPersonId.get(pId);
    if (!pBox) return;

    if (!corridorChildrenByParentAndLevel.has(pId)) {
      corridorChildrenByParentAndLevel.set(pId, new Map());
    }
    const lvlMap = corridorChildrenByParentAndLevel.get(pId)!;
    if (!lvlMap.has(cb.level)) {
      lvlMap.set(cb.level, []);
    }
    lvlMap.get(cb.level)!.push(cb);
  });

  const barsByCorridorLevel = new Map<number, { parentId?: string; parentX: number; minChildX: number; maxChildX: number; childrenX?: number[]; direction: 'up' | 'same' | 'down' }[]>();
  corridorChildrenByParentAndLevel.forEach((lvlMap, parentId) => {
    const pBox = cardPosByPersonId.get(parentId);
    if (!pBox) return;

    lvlMap.forEach((cBoxes, childLevel) => {
      const direction: 'up' | 'same' | 'down' =
        childLevel > pBox.level ? 'up' : (childLevel === pBox.level ? 'same' : 'down');
      const corridorLevel = direction === 'down' ? pBox.level : childLevel;

      const cBoxesByGroup = new Map<string, HorizCardPos[]>();
      cBoxes.forEach(cb => {
        const gId = cb.groupId || cb.id;
        if (!cBoxesByGroup.has(gId)) cBoxesByGroup.set(gId, []);
        cBoxesByGroup.get(gId)!.push(cb);
      });

      const targetXs: number[] = [];
      cBoxesByGroup.forEach(boxes => {
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

  for (let lvl = 1; lvl <= totalLevels; lvl++) {
    const groupsInLevel = levelGroupsMap.get(lvl) || [];
    let maxCardH = 50;
    if (groupsInLevel.length > 0) {
      groupsInLevel.forEach(g => {
        g.memberIds.forEach(id => {
          const h = cardHeightByPersonId.get(id) || 50;
          if (h > maxCardH) maxCardH = h;
        });
      });
    }
    levelMaxCardHeights[lvl] = maxCardH;

    const corridorBars = barsByCorridorLevel.get(lvl) || [];
    let totalLanes = 0;
    if (corridorBars.length > 0) {
      const corridorDir = (corridorBars[0] as any)?.direction || 'up';
      const { totalLanes: calculatedLanes } = assignNonOverlappingLanes(corridorBars, corridorDir);
      totalLanes = calculatedLanes;
    }

    levelRequiredLanes[lvl] = totalLanes;
    const linesHeight = totalLanes === 0
      ? CORRIDOR_EMPTY
      : (CORRIDOR_PAD_TOP + (totalLanes - 1) * gap + CORRIDOR_PAD_BOTTOM);
    levelHeights[lvl] = Math.max(MIN_LEVEL_HEIGHT, LEVEL_CARD_PAD_TOP + maxCardH + linesHeight);
  }

  let currY = CANVAS_PAD_TOP;
  for (let lvl = totalLevels; lvl >= 1; lvl--) {
    levelBandTopY[lvl] = currY;
    levelCardTopY[lvl] = currY + LEVEL_CARD_PAD_TOP;
    levelMaxCardBottom[lvl] = levelCardTopY[lvl] + (levelMaxCardHeights[lvl] || 50);
    currY += levelHeights[lvl];
  }

  function getLevelHeight(lvl: number): number {
    return levelHeights[lvl] || DEFAULT_LEVEL_HEIGHT;
  }

  function getLevelBandTopY(lvl: number): number {
    return levelBandTopY[lvl] || CANVAS_PAD_TOP;
  }

  function getGroupTopY(lvl: number): number {
    return levelCardTopY[lvl] || (CANVAS_PAD_TOP + LEVEL_CARD_PAD_TOP);
  }

  function getMaxCardHeightForLevel(lvl: number): number {
    return levelMaxCardHeights[lvl] || 50;
  }

  // 1. Calculate geometry for all groups and cards
  const exportGroups: ExportGroup[] = [];
  const cardBoxByPersonId = new Map<string, ExportCard>();

  siblingGroups.forEach(g => {
    const width = g.memberIds.length * CARD_WIDTH;
    const left = Math.round(g.x - width / 2);
    const right = left + width;
    const top = getGroupTopY(g.level);

    // Größte dynamische Höhe innerhalb dieser Gruppe ermitteln
    const groupCardHeight = g.memberIds.length > 0
      ? Math.max(...g.memberIds.map(id => getCardHeightForPerson(id, g.generation)), 50)
      : 50;

    const cards: ExportCard[] = [];
    g.memberIds.forEach((pid, idx) => {
      let p = personById.get(pid);
      if (!p) {
        p = {
          id: pid,
          given_name: 'N.N.',
          surname: '',
          sex: 'M',
          birth_date: null,
          birth_place: null,
          death_date: null,
          death_place: null,
          parent_ids: [],
          spouses: [],
          proband_data: {},
        };
      }
      const cLeft = left + idx * CARD_WIDTH;
      const cRight = cLeft + CARD_WIDTH;
      // Bei Gruppierung (> 1 Kachel) Höhe aller Kacheln aneinander anpassen (größte dynamische Höhe der Gruppe)
      const cardH = groupCardHeight;
      const cardObj: ExportCard = {
        person: p,
        groupId: g.id,
        level: g.level,
        generation: g.generation,
        left: cLeft,
        right: cRight,
        top,
        bottom: top + cardH,
        height: cardH,
        centerX: cLeft + CARD_WIDTH / 2,
        centerY: top + cardH / 2,
      };
      cards.push(cardObj);
      cardBoxByPersonId.set(pid, cardObj);
    });

    const groupHeight = groupCardHeight;

    // Subgroups for biological siblings inside group
    const subGroups: { parentId: string | null; cards: ExportCard[]; surname: string }[] = [];
    let curSub: { parentId: string | null; cards: ExportCard[]; surname: string } | null = null;
    cards.forEach(c => {
      const pId = biologicalParentMap.get(c.person.id) || null;
      if (!curSub || curSub.parentId !== pId || pId === null) {
        curSub = { parentId: pId, cards: [c], surname: '' };
        subGroups.push(curSub);
      } else {
        curSub.cards.push(c);
      }
    });

    subGroups.forEach(sub => {
      const pPerson = sub.parentId ? (personById.get(sub.parentId) || null) : null;
      sub.surname = getSiblingSubGroupSurname(sub.cards, pPerson);
    });

    exportGroups.push({
      group: g,
      left,
      right,
      top,
      bottom: top + groupHeight,
      width,
      height: groupHeight,
      cards,
      subGroups,
    });
  });

  // 2. Compute edge geometry (connecting lines, line bridges, and arrows)
  interface LineSeg {
    id: string;
    edgeKey: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }

  interface Arrow {
    x: number;
    y: number;
    direction: 'up' | 'down';
  }
  interface Anchor {
    x: number;
    y: number;
    d: string;
  }

  const rawSegments: LineSeg[] = [];
  const arrows: Arrow[] = [];
  const anchors: Anchor[] = [];

  const childrenByParentAndLevel = new Map<string, Map<number, ExportCard[]>>();
  cardBoxByPersonId.forEach(cb => {
    let pId = biologicalParentMap.get(cb.person.id);
    if (!pId && cb.person.parent_ids) {
      pId = cb.person.parent_ids.find(id => cardBoxByPersonId.has(id));
    }
    if (!pId) return;
    const pBox = cardBoxByPersonId.get(pId);
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
    pBox: ExportCard;
    cBoxes: ExportCard[];
    minChildX: number;
    maxChildX: number;
  }

  const relationsByCorridor = new Map<number, CorridorRelation[]>();

  childrenByParentAndLevel.forEach((levelMap, parentId) => {
    const pBox = cardBoxByPersonId.get(parentId);
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

  const bridgeRadius = Math.max(4, Math.min(20, options.bridgeRadius || state.bridgeRadius || 8));
  const enableBridges = options.enableLineBridges !== undefined
    ? options.enableLineBridges
    : (state.enableLineBridges !== undefined ? state.enableLineBridges : true);

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
      groupTargets: { targetX: number; targetY: number; key: string }[];
      barMinX: number;
      barMaxX: number;
      hasBar: boolean;
      item?: { parentId?: string; parentX: number; minChildX: number; maxChildX: number; childrenX?: number[] };
    }

    const preparedRelations: PreparedRelation[] = relations.map(rel => {
      const { parentId, childLevel, pBox, cBoxes, direction } = rel;
      const commonEdgeKey = `edge-${parentId}-lvl${childLevel}`;

      const cBoxesByGroup = new Map<string, ExportCard[]>();
      cBoxes.forEach(cb => {
        const gId = cb.groupId || cb.person.id;
        if (!cBoxesByGroup.has(gId)) cBoxesByGroup.set(gId, []);
        cBoxesByGroup.get(gId)!.push(cb);
      });

      const groupTargets: { targetX: number; targetY: number; key: string }[] = [];
      let targetIdx = 0;
      cBoxesByGroup.forEach((boxes) => {
        const minL = Math.min(...boxes.map(c => c.left));
        const maxR = Math.max(...boxes.map(c => c.right));
        const targetX = Math.round((minL + maxR) / 2);
        const targetY = direction === 'down'
          ? Math.min(...boxes.map(c => c.top))
          : Math.max(...boxes.map(c => c.bottom));

        groupTargets.push({
          targetX,
          targetY,
          key: `${commonEdgeKey}-grp${targetIdx++}`,
        });
      });

      const allTargetXs = groupTargets.map(t => t.targetX);
      const stemX = pBox.centerX;
      const barMinX = Math.min(stemX, ...allTargetXs);
      const barMaxX = Math.max(stemX, ...allTargetXs);
      const hasBar = barMaxX - barMinX > 1;

      const item = hasBar
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
      const { parentId, childLevel, pBox, direction } = rel;
      const commonEdgeKey = `edge-${parentId}-lvl${childLevel}`;

      const stemX = pBox.centerX;
      const startY = direction === 'down' ? pBox.bottom : pBox.top;

      // Ausgangs-Anknüpfpunkt (Halbkreis) an der oberen/unteren Kante der Elternkachel
      const anchorRadius = 7;
      const anchorD = direction === 'down'
        ? `M ${stemX - anchorRadius} ${startY} A ${anchorRadius} ${anchorRadius} 0 0 0 ${stemX + anchorRadius} ${startY} Z`
        : `M ${stemX - anchorRadius} ${startY} A ${anchorRadius} ${anchorRadius} 0 0 1 ${stemX + anchorRadius} ${startY} Z`;

      const existingAnchor = anchors.find(a => Math.abs(a.x - stemX) < 1 && Math.abs(a.y - startY) < 1);
      if (!existingAnchor) {
        anchors.push({
          x: stemX,
          y: startY,
          d: anchorD,
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
        });

        arrows.push({
          x: stemX,
          y: targetY,
          direction: direction === 'down' ? 'down' : 'up',
        });
        return;
      }

      // Horizontale Linienführung auf der optimalen Lane
      const assignedLane = barLanes[barRelIdx++];
      const laneOffset = assignedLane * gap;
      const levelMaxBottom = getLevelBandTopY(corridorLevel) + LEVEL_CARD_PAD_TOP + getMaxCardHeightForLevel(corridorLevel);
      const jogY = levelMaxBottom + CORRIDOR_PAD_TOP + laneOffset;

      // Stammsegment vom Eltern-Anknüpfpunkt zur Querlinie
      rawSegments.push({
        id: `${commonEdgeKey}-stem`,
        edgeKey: commonEdgeKey,
        x1: stemX,
        y1: startY,
        x2: stemX,
        y2: jogY,
      });

      // Horizontaler Verbindungsbalken
      rawSegments.push({
        id: `${commonEdgeKey}-bar`,
        edgeKey: commonEdgeKey,
        x1: barMinX,
        y1: jogY,
        x2: barMaxX,
        y2: jogY,
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
        });
        arrows.push({
          x: tgt.targetX,
          y: tgt.targetY,
          direction: direction === 'down' ? 'down' : 'up',
        });
      });
    });
  });

  // 3. Compute Line Bridges for intersections
  const bridgesBySegIdx = new Map<number, number[]>();
  if (enableBridges) {
    const minClearance = 0.5;
    interface HorizSegInfo {
      idx: number;
      y: number;
      minX: number;
      maxX: number;
      x1: number;
    }
    interface VertSegInfo {
      idx: number;
      x: number;
      minY: number;
      maxY: number;
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
          y: s.y1,
          minX: Math.min(s.x1, s.x2),
          maxX: Math.max(s.x1, s.x2),
          x1: s.x1,
        });
      } else if (isVert) {
        vSegs.push({
          idx: i,
          x: s.x1,
          minY: Math.min(s.y1, s.y2),
          maxY: Math.max(s.y1, s.y2),
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
      }
    }
  }

  // Paths with bridges
  const edgePaths: string[] = [];
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
    edgePaths.push(dStr);
  });

  // 4. Calculate bounding box for content
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  exportGroups.forEach(eg => {
    if (eg.left < minX) minX = eg.left;
    if (eg.right > maxX) maxX = eg.right;
    if (eg.top - 20 < minY) minY = eg.top - 20;
    if (eg.bottom > maxY) maxY = eg.bottom;
  });

  rawSegments.forEach(s => {
    minX = Math.min(minX, s.x1, s.x2);
    maxX = Math.max(maxX, s.x1, s.x2);
    minY = Math.min(minY, s.y1, s.y2);
    maxY = Math.max(maxY, s.y1, s.y2);
  });

  // Background image bounds
  const bgConfig = state.backgroundConfig;
  const bgImage = state.backgroundImageData;
  const hasBackground = Boolean(options.includeBackground && bgImage && bgConfig && bgConfig.visible !== false);
  let bgX = 0, bgY = 0, bgW = 0, bgH = 0, bgOpacity = 0.45;
  if (hasBackground && bgConfig) {
    bgX = bgConfig.x || 0;
    bgY = bgConfig.y || 0;
    const baseW = bgConfig.naturalWidth || 1200;
    const baseH = bgConfig.naturalHeight || 800;
    const scale = (bgConfig.scale || 100) / 100;
    bgW = Math.max(20, Math.round(baseW * scale));
    bgH = Math.max(20, Math.round(baseH * scale));
    bgOpacity = (bgConfig.opacity ?? 45) / 100;

    minX = Math.min(minX, bgX);
    maxX = Math.max(maxX, bgX + bgW);
    minY = Math.min(minY, bgY);
    maxY = Math.max(maxY, bgY + bgH);
  }

  // If no content, provide default bounding box
  if (minX === Infinity) {
    minX = hasBackground ? bgX : 100;
    maxX = hasBackground ? bgX + bgW : 800;
    minY = hasBackground ? bgY : 100;
    maxY = hasBackground ? bgY + bgH : 600;
  }

  // Include grid bounds if requested
  if (options.includeGrid) {
    const topGridY = getLevelBandTopY(totalLevels);
    const bottomGridY = getLevelBandTopY(1) + getLevelHeight(1);
    minY = Math.min(minY, topGridY);
    maxY = Math.max(maxY, bottomGridY);
    minX = Math.min(minX, minX - 100); // room for level badges
  }

  const MARGIN = 45;
  const cropX = Math.floor(minX - MARGIN);
  const cropY = Math.floor(minY - MARGIN);
  const cropW = Math.max(400, Math.ceil(maxX - minX + 2 * MARGIN));
  const cropH = Math.max(300, Math.ceil(maxY - minY + 2 * MARGIN));

  // 5. Build SVG Elements
  const svgParts: string[] = [];

  svgParts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${cropW}" height="${cropH}" viewBox="${cropX} ${cropY} ${cropW} ${cropH}">`
  );

  // Embedded Styles for consistent font rendering
  svgParts.push(`  <defs>
    <style>
      .tree-font { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
      .text-title { font-size: 11px; fill: #1e293b; text-anchor: middle; }
      .text-meta { font-size: 8.5px; fill: #475569; text-anchor: middle; }
      .text-badge { font-size: 8px; font-weight: bold; fill: #ffffff; text-anchor: middle; }
      .text-marriage { font-size: 8px; fill: #64748b; text-anchor: middle; }
      .edge-line { fill: none; stroke: #1e293b; stroke-width: 2px; stroke-linecap: round; stroke-linejoin: round; }
      .edge-arrow { fill: #1e293b; }
      .edge-anchor { fill: #1e293b; stroke: #1e293b; stroke-width: 1.5px; }
      .level-line { stroke: #cbd5e1; stroke-dasharray: 5,5; stroke-width: 1.5px; }
      .level-text { font-size: 10.5px; font-weight: bold; fill: #ffffff; text-anchor: middle; }
    </style>
  </defs>`);

  // Background Layer:
  // If JPG, fill with white. If transparent PNG/SVG, omit background rect unless background image is enabled.
  if (options.format === 'jpg') {
    svgParts.push(`  <!-- JPG Background (White) -->`);
    svgParts.push(`  <rect x="${cropX}" y="${cropY}" width="${cropW}" height="${cropH}" fill="#ffffff" />`);
  }

  // Background Image (if configured and enabled)
  if (hasBackground && bgImage) {
    svgParts.push(`  <!-- Background Image -->`);
    svgParts.push(
      `  <image href="${escapeXml(bgImage)}" x="${bgX}" y="${bgY}" width="${bgW}" height="${bgH}" opacity="${bgOpacity}" preserveAspectRatio="none" />`
    );
  }

  // Level Grid Layer (only when includeGrid is true)
  if (options.includeGrid) {
    svgParts.push(`  <!-- Level Grid -->`);
    svgParts.push(`  <g id="level-grid">`);
    for (let lvl = 1; lvl <= totalLevels; lvl++) {
      const bandTop = getLevelBandTopY(lvl);
      const lvlH = getLevelHeight(lvl);
      const isEven = lvl % 2 === 0;
      const bandFill = isEven ? '#f1f5f9' : '#f8fafc';
      const bandOpacity = 0.55;

      svgParts.push(
        `    <rect x="${cropX}" y="${bandTop}" width="${cropW}" height="${lvlH}" fill="${bandFill}" opacity="${bandOpacity}" />`
      );
      svgParts.push(
        `    <line x1="${cropX}" y1="${bandTop + lvlH}" x2="${cropX + cropW}" y2="${bandTop + lvlH}" class="level-line" />`
      );

      // Level Badge pill
      const badgeX = cropX + 16;
      const badgeY = bandTop + 10;
      svgParts.push(
        `    <rect x="${badgeX}" y="${badgeY}" width="72" height="22" rx="4" fill="#334155" />`
      );
      svgParts.push(
        `    <text x="${badgeX + 36}" y="${badgeY + 15}" class="tree-font level-text">Ebene ${lvl}</text>`
      );
    }
    svgParts.push(`  </g>`);
  }

  // Connecting Lines Layer (cards are on the topmost layer when lines cross an entire level)
  svgParts.push(`  <!-- Connecting Lines -->`);
  svgParts.push(`  <g id="edges">`);
  edgePaths.forEach(p => {
    svgParts.push(`    <path d="${p}" class="edge-line" />`);
  });
  anchors.forEach(anc => {
    svgParts.push(`    <path d="${anc.d}" class="edge-anchor" />`);
  });
  arrows.forEach(arr => {
    const pts = arr.direction === 'up'
      ? `${arr.x},${arr.y} ${arr.x - 5},${arr.y + 9} ${arr.x + 5},${arr.y + 9}`
      : `${arr.x},${arr.y} ${arr.x - 5},${arr.y - 9} ${arr.x + 5},${arr.y - 9}`;
    svgParts.push(`    <polygon points="${pts}" class="edge-arrow" />`);
  });
  svgParts.push(`  </g>`);

  // Sibling Groups & Cards Layer
  svgParts.push(`  <!-- Sibling Groups & Cards -->`);
  svgParts.push(`  <g id="nodes" class="tree-font">`);

  exportGroups.forEach(eg => {
    const isOrigin = eg.group.parentId === null;
    const isMultiSibling = eg.cards.length > 1;
    const groupStroke = isOrigin ? '#0e6251' : (isMultiSibling ? '#0f172a' : '#1e293b');
    const groupStrokeWidth = isMultiSibling || isOrigin ? 3.5 : 3;

    // Sibling Group Surname linksbündig oberhalb der Kachel
    eg.subGroups.forEach(sub => {
      if (sub.surname && sub.cards.length > 0) {
        const sLeft = sub.cards[0].left;
        const sTop = eg.top - 5;
        svgParts.push(
          `    <!-- Sibling Group Surname -->`,
          `    <text x="${sLeft}" y="${sTop}" class="tree-font" font-size="11px" font-weight="bold" fill="#0f172a" text-anchor="start">${escapeXml(sub.surname)}</text>`
        );
      }
    });

    // Individual Person Cards: Jede Kachel hat ihre eigene dynamische Höhe
    eg.cards.forEach((card, _cIdx) => {
      const p = card.person;
      const cLeft = card.left;
      const cRight = card.right;
      const cTop = card.top;
      const cBottom = card.bottom;
      const cCenter = card.centerX;

      // Card box rectangle with exact dynamic height
      svgParts.push(
        `    <rect x="${cLeft}" y="${cTop}" width="${CARD_WIDTH}" height="${card.height}" fill="#ffffff" stroke="${groupStroke}" stroke-width="${groupStrokeWidth}" />`
      );

      // Gender bottom bar
      const isMale = p.sex === 'M';
      const isFemale = p.sex === 'F';
      const genderColor = isMale ? '#2980b9' : (isFemale ? '#e84393' : '#64748b');
      svgParts.push(
        `    <line x1="${cLeft}" y1="${cBottom - 1.5}" x2="${cRight}" y2="${cBottom - 1.5}" stroke="${genderColor}" stroke-width="3" />`
      );

      // Line #1: Henry code badge & Gen badge
      const henryCode = (p.proband_data && probandId)
        ? (p.proband_data[probandId]?.henry_code || null)
        : null;

      if (cfg.showHenryId && henryCode) {
        const badgeW = Math.max(22, henryCode.length * 6.8 + 8);
        svgParts.push(
          `    <rect x="${cLeft + 5}" y="${cTop + 4}" width="${badgeW}" height="14" rx="3" fill="#34495e" />`
        );
        svgParts.push(
          `    <text x="${cLeft + 5 + badgeW / 2}" y="${cTop + 14.5}" class="text-badge">[${escapeXml(henryCode)}]</text>`
        );
      }

      if (cfg.showGeneration && card.generation) {
        svgParts.push(
          `    <text x="${cRight - 6}" y="${cTop + 14.5}" font-size="8.5px" font-weight="bold" fill="#64748b" text-anchor="end">Gen. ${card.generation}</text>`
        );
      }

      // Line #2: Given Name (only given name inside the card)
      const firstName = (p.given_name || 'N.N.').trim();
      const nameWeight = cfg.line2Bold ? 'bold' : 'normal';
      const nameStyle = cfg.line2Italic ? 'italic' : 'normal';
      const nameY = cTop + 33;

      // Wrap name into two lines if long
      if (firstName.length > 18 && firstName.includes(' ')) {
        const words = firstName.split(' ');
        const mid = Math.ceil(words.length / 2);
        const part1 = words.slice(0, mid).join(' ');
        const part2 = words.slice(mid).join(' ');
        svgParts.push(
          `    <text x="${cCenter}" y="${nameY - 4}" class="text-title" font-weight="${nameWeight}" font-style="${nameStyle}">`
        );
        svgParts.push(`      <tspan x="${cCenter}" dy="0">${escapeXml(part1)}</tspan>`);
        svgParts.push(`      <tspan x="${cCenter}" dy="12">${escapeXml(part2)}</tspan>`);
        svgParts.push(`    </text>`);
      } else {
        svgParts.push(
          `    <text x="${cCenter}" y="${nameY}" class="text-title" font-weight="${nameWeight}" font-style="${nameStyle}">${escapeXml(firstName)}</text>`
        );
      }

      // Line #3: Life Dates
      let currY = nameY + 20;
      let dateTexts: string[] = [];

      if (cfg.showBirthDate && p.birth_date) {
        const bDate = formatLocalizedDate(p.birth_date, loc, cfg.showOnlyYears);
        const bPlace = cfg.showBirthPlace && p.birth_place ? ` (${p.birth_place})` : '';
        dateTexts.push(`* ${bDate}${bPlace}`);
      }
      if (cfg.showChrDate) {
        const chr = getBaptismInfo(p);
        if (chr.date) {
          const cDate = formatLocalizedDate(chr.date, loc, cfg.showOnlyYears);
          const cPlace = cfg.showChrPlace && chr.place ? ` (${chr.place})` : '';
          dateTexts.push(`~ ${cDate}${cPlace}`);
        }
      }
      if (cfg.showDeathDate && p.death_date) {
        const dDate = formatLocalizedDate(p.death_date, loc, cfg.showOnlyYears);
        const dPlace = cfg.showDeathPlace && p.death_place ? ` (${p.death_place})` : '';
        dateTexts.push(`† ${dDate}${dPlace}`);
      }

      if (dateTexts.length > 0) {
        if (cfg.lifeDatesLayout === 'single') {
          const joined = dateTexts.join(', ');
          svgParts.push(
            `    <text x="${cCenter}" y="${currY}" class="text-meta">${escapeXml(joined)}</text>`
          );
          currY += 14;
        } else {
          dateTexts.forEach(dt => {
            svgParts.push(
              `    <text x="${cCenter}" y="${currY}" class="text-meta">${escapeXml(dt)}</text>`
            );
            currY += 13;
          });
        }
      }

      // Line #4 & #5: Marriages / Spouses
      const hasSpouses = p.spouses && p.spouses.length > 0;
      const showMarriage = cfg.showSpouseName || cfg.showMarriageCounter || cfg.showMarriageDate || cfg.showDivorce;
      if (hasSpouses && showMarriage) {
        svgParts.push(
          `    <line x1="${cLeft + 8}" y1="${currY - 2}" x2="${cRight - 8}" y2="${currY - 2}" stroke="#cbd5e1" stroke-dasharray="3,2" stroke-width="1" />`
        );
        currY += 10;

        p.spouses!.forEach((sp, spIdx) => {
          if (currY >= cBottom - 10) return; // avoid overflowing card
          const spPerson = personById.get(sp.id);
          const spName = spPerson
            ? `${spPerson.given_name || 'N.N.'} ${spPerson.surname || ''}`.trim()
            : 'N.N.';
          const prefix = p.spouses!.length > 1 && cfg.showMarriageCounter ? `(${spIdx + 1}) ` : '';

          if (cfg.showSpouseName) {
            svgParts.push(
              `    <text x="${cCenter}" y="${currY}" class="text-marriage" font-weight="bold" fill="#1e293b">${escapeXml(prefix + '⚭ ' + spName)}</text>`
            );
            currY += 12;
          }

          let spDateParts: string[] = [];
          if (cfg.showMarriageDate && sp.date) {
            spDateParts.push(`oo ${formatLocalizedDate(sp.date, loc, cfg.showOnlyYears)}`);
          }
          if (cfg.showDivorce && (sp.is_divorced || sp.divorce_date)) {
            const divDate = sp.divorce_date ? formatLocalizedDate(sp.divorce_date, loc, cfg.showOnlyYears) : 'gesch.';
            spDateParts.push(`o|o ${divDate}`);
          }
          if (spDateParts.length > 0 && currY < cBottom - 6) {
            svgParts.push(
              `    <text x="${cCenter}" y="${currY}" class="text-marriage">${escapeXml(spDateParts.join(', '))}</text>`
            );
            currY += 12;
          }
        });
      }
    });
  });

  svgParts.push(`  </g>`);
  svgParts.push(`</svg>`);

  const svgString = svgParts.join('\n');

  return {
    svgString,
    width: cropW,
    height: cropH,
    viewBox: { x: cropX, y: cropY, width: cropW, height: cropH },
    stats: {
      totalLevels,
      totalPersons: cardBoxByPersonId.size,
      totalGroups: exportGroups.length,
      hasBackground,
    },
  };
}

/**
 * Renders an SVG string onto an HTML5 canvas and converts it to a PNG or JPG Blob.
 */
export async function renderSvgToRaster(
  svgString: string,
  width: number,
  height: number,
  format: 'png' | 'jpg',
  scale: number = 2
): Promise<{ blob: Blob; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    try {
      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();

      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(width * scale);
          canvas.height = Math.round(height * scale);
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to create 2D canvas context'));
            return;
          }

          // If JPG, fill with white background since JPEG does not support transparency
          if (format === 'jpg') {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }

          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);

          const mimeType = format === 'jpg' ? 'image/jpeg' : 'image/png';
          const quality = format === 'jpg' ? 0.95 : undefined;
          const dataUrl = canvas.toDataURL(mimeType, quality);

          canvas.toBlob(
            blob => {
              if (blob) {
                resolve({ blob, dataUrl });
              } else {
                reject(new Error('Canvas toBlob failed'));
              }
            },
            mimeType,
            quality
          );
        } catch (err) {
          URL.revokeObjectURL(url);
          reject(err);
        }
      };

      img.onerror = err => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load SVG into image: ' + String(err)));
      };

      img.src = url;
    } catch (e) {
      reject(e);
    }
  });
}
