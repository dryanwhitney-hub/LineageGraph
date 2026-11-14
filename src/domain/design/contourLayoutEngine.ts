import type { Person } from '../../composables/usePersons';
import { DENSITY_PROFILE_SPECS, computeCapsuleCardMetrics, computeCardMetricsForPerson } from './cardMetrics';
import {
  FEED_THROUGH_CHANNEL_WIDTH,
  STANDARD_CARD_GAP_X,
  layoutWrappedGroupBlock,
  type WrappedGroupBlock,
} from './groupWrapper';
import {
  resolveGenealogyTree,
  type ResolvedLineageResult,
  type ResolvedPersonMeta,
} from './lineageResolver';
import type {
  DesignDocumentModel,
  DesignTreeBundle,
  ResolvedGroupNode,
  SceneBackgroundLayer,
  SceneLevelBand,
  ScenePersonCard,
  SceneSiblingGroup,
  SceneSubtreeFrame,
  SubtreeMountRule,
} from './sceneTypes';

export const BRANCH_GAP_X = 28;
export const DOCKED_GROUP_GAP_X = 8;
export const SUBTREE_FRAME_PAD_X = 22;
export const SUBTREE_FRAME_PAD_Y = 18;
export const SUBTREE_MARGIN_X = 24;
export const BASE_CHANNEL_GAP_Y = 56;
export const LEVEL_LANE_STEP_Y = 11;

interface InternalPlacedGroup {
  node: ResolvedGroupNode;
  doc: DesignDocumentModel;
  lineage: ResolvedLineageResult;
  globalLevel: number;
  block: WrappedGroupBlock;
  /** X-Position der Block-Mitte / Linkskante relativ zum lokalen Unit-Ursprung */
  relX: number;
  mountedInlineMap: Map<string, InternalSubtreePlacement>;
  capsuleMap: Map<string, { mount: SubtreeMountRule; subDoc: DesignDocumentModel; personCount: number; genSpan: number }>;
  cardWidth: number;
  cardHeights: Map<string, number>;
}

interface InternalSubtreePlacement {
  subDoc: DesignDocumentModel;
  parentDocId: string;
  anchorPersonId: string;
  depth: number;
  levelMin: number;
  levelMax: number;
  frameLocalMinX: number;
  frameLocalMaxX: number;
  relX: number;
}

interface ContourSpan {
  minX: number;
  maxX: number;
}

interface LaidOutUnit {
  /** Kontur pro globaler Ebene relativ zum Unit-Ursprung X = 0 */
  contour: Map<number, ContourSpan>;
  /** Ankerebene dieses Units */
  rootLevel: number;
  /** Zentrierungs-Punkt X (z. B. Wurzel-Kachelmitte) relativ zu Unit X = 0 */
  anchorCenterX: number;
  groups: { pg: InternalPlacedGroup; offsetX: number }[];
  subtrees: { st: InternalSubtreePlacement; offsetX: number; minX: number; maxX: number }[];
}

function mergeContourInto(
  target: Map<number, ContourSpan>,
  source: Map<number, ContourSpan>,
  shiftX: number
) {
  for (const [lvl, span] of source.entries()) {
    const sMin = span.minX + shiftX;
    const sMax = span.maxX + shiftX;
    const prev = target.get(lvl);
    if (!prev) {
      target.set(lvl, { minX: sMin, maxX: sMax });
    } else {
      if (sMin < prev.minX) prev.minX = sMin;
      if (sMax > prev.maxX) prev.maxX = sMax;
    }
  }
}

function computeRequiredShift(
  accContour: Map<number, ContourSpan>,
  nextContour: Map<number, ContourSpan>,
  rootLevel: number,
  tightSameLevelGap: number,
  branchGap: number
): number {
  let maxShift = -Infinity;
  let hasShared = false;

  for (const [lvl, nextSpan] of nextContour.entries()) {
    const accSpan = accContour.get(lvl);
    if (!accSpan) continue;
    hasShared = true;
    const gap = lvl === rootLevel ? tightSameLevelGap : branchGap;
    const needed = accSpan.maxX + gap - nextSpan.minX;
    if (needed > maxShift) maxShift = needed;
  }

  if (!hasShared) return 0;
  return Number.isFinite(maxShift) ? maxShift : 0;
}

function shiftUnitOffsets(unit: LaidOutUnit, dx: number) {
  if (dx === 0) return;
  unit.anchorCenterX += dx;
  for (const g of unit.groups) g.offsetX += dx;
  for (const s of unit.subtrees) {
    s.offsetX += dx;
    s.minX += dx;
    s.maxX += dx;
  }
  for (const span of unit.contour.values()) {
    span.minX += dx;
    span.maxX += dx;
  }
}

function countDescendantStats(lineage: ResolvedLineageResult): { personCount: number; genSpan: number } {
  let minGen = Infinity;
  let maxGen = -Infinity;
  for (const meta of lineage.resolvedMeta.values()) {
    if (meta.generation < minGen) minGen = meta.generation;
    if (meta.generation > maxGen) maxGen = meta.generation;
  }
  const genSpan =
    Number.isFinite(minGen) && Number.isFinite(maxGen)
      ? Math.max(1, maxGen - minGen + 1)
      : 1;
  return {
    personCount: lineage.visiblePersonIds.size,
    genSpan,
  };
}

export interface ContourLayoutOutput {
  groups: SceneSiblingGroup[];
  cards: ScenePersonCard[];
  levels: SceneLevelBand[];
  subtreeFrames: SceneSubtreeFrame[];
  backgrounds: SceneBackgroundLayer[];
  personCardById: Map<string, ScenePersonCard>;
  groupByKey: Map<string, SceneSiblingGroup>;
  resolvedLineagesByDocId: Map<string, ResolvedLineageResult>;
  parentEdgeCountByLevelGap: Map<number, number>;
  groupParentConnections: {
    ownerDoc: DesignDocumentModel;
    group: ResolvedGroupNode;
    parentPersonId: string;
    isSubtreeEdge: boolean;
  }[];
}

export function computeSynchronizedContourLayout(
  bundle: DesignTreeBundle,
  persons: Person[],
  locale: string = 'de'
): ContourLayoutOutput {
  const masterDoc = bundle.rootDocument;
  const stammahnPersonId = bundle.masterRootPersonId || masterDoc.rootPersonId;
  const direction = masterDoc.growthDirection || 'bottom_up';

  const resolvedLineagesByDocId = new Map<string, ResolvedLineageResult>();
  const cardMetricsCache = new Map<string, ReturnType<typeof computeCardMetricsForPerson>>();

  function getLineageForDoc(doc: DesignDocumentModel): ResolvedLineageResult {
    const existing = resolvedLineagesByDocId.get(doc.id);
    if (existing) return existing;
    const res = resolveGenealogyTree(doc, persons, locale, stammahnPersonId, masterDoc);
    resolvedLineagesByDocId.set(doc.id, res);
    return res;
  }

  function getPersonMetrics(
    doc: DesignDocumentModel,
    meta: ResolvedPersonMeta
  ): ReturnType<typeof computeCardMetricsForPerson> {
    const key = `${doc.id}::${meta.person.id}`;
    const existing = cardMetricsCache.get(key);
    if (existing) return existing;
    const computed = computeCardMetricsForPerson(
      meta,
      doc.cardDensityProfile,
      doc.cardConfig,
      locale
    );
    cardMetricsCache.set(key, computed);
    return computed;
  }

  const dockMetaByGroupKey = new Map<
    string,
    { dockClusterKey: string; isDocked: boolean; dockTargetGroupKey: string | null }
  >();

  function applyDocumentGroupOffsetsAndDocking(unit: LaidOutUnit, doc: DesignDocumentModel) {
    if (unit.groups.length === 0) return;

    type GroupEntry = { pg: InternalPlacedGroup; offsetX: number };
    const docGroups = unit.groups.filter(g => g.pg.doc.id === doc.id);
    if (docGroups.length === 0) return;

    const rootGroupEntry = docGroups.find(g => g.pg.node.memberIds.includes(doc.rootPersonId));
    const prevRootGroupX = rootGroupEntry ? rootGroupEntry.offsetX : 0;

    // Eltern-Beziehungen über alle Gruppen (inkl. eingebetteter Sub-Bäume) aufbauen,
    // damit Verschieben/Andocken einer Gruppe alle Nachkommen & Subtree-Frames mitnimmt.
    const childrenByGroupEntry = new Map<GroupEntry, GroupEntry[]>();
    const containerByDocId = new Map<string, GroupEntry>();

    for (const g of unit.groups) {
      for (const s of unit.subtrees) {
        if (s.st.parentDocId === g.pg.doc.id && g.pg.node.memberIds.includes(s.st.anchorPersonId)) {
          containerByDocId.set(s.st.subDoc.id, g);
        }
      }
    }

    for (const child of unit.groups) {
      let parentEntry: GroupEntry | undefined;

      const container = containerByDocId.get(child.pg.doc.id);
      if (container && container.pg.doc.id !== child.pg.doc.id) {
        if (
          child.pg.node.memberIds.some(
            mid =>
              container.pg.mountedInlineMap.has(mid) &&
              container.pg.mountedInlineMap.get(mid)!.subDoc.id === child.pg.doc.id
          )
        ) {
          parentEntry = container;
        }
      }

      if (!parentEntry && child.pg.node.anchorParentId) {
        const pid = child.pg.node.anchorParentId;
        parentEntry =
          unit.groups.find(
            cand => cand !== child && cand.pg.doc.id === child.pg.doc.id && cand.pg.node.memberIds.includes(pid)
          ) || unit.groups.find(cand => cand !== child && cand.pg.node.memberIds.includes(pid));
      }

      if (parentEntry) {
        if (!childrenByGroupEntry.has(parentEntry)) childrenByGroupEntry.set(parentEntry, []);
        childrenByGroupEntry.get(parentEntry)!.push(child);
      }
    }

    const subtreesByRootGroup = new Map<GroupEntry, LaidOutUnit['subtrees']>();
    for (const s of unit.subtrees) {
      const rootEntry = unit.groups.find(
        g => g.pg.doc.id === s.st.subDoc.id && g.pg.node.memberIds.includes(s.st.anchorPersonId)
      );
      if (rootEntry) {
        if (!subtreesByRootGroup.has(rootEntry)) subtreesByRootGroup.set(rootEntry, []);
        subtreesByRootGroup.get(rootEntry)!.push(s);
      }
    }

    function shiftGroupAndDescendants(rootEntry: GroupEntry, dx: number) {
      if (Math.abs(dx) < 0.001) return;
      const visited = new Set<GroupEntry>();
      const queue: GroupEntry[] = [rootEntry];
      while (queue.length > 0) {
        const cur = queue.shift()!;
        if (visited.has(cur)) continue;
        visited.add(cur);
        cur.offsetX += dx;
        const linkedSubtrees = subtreesByRootGroup.get(cur);
        if (linkedSubtrees) {
          for (const stEntry of linkedSubtrees) {
            stEntry.offsetX += dx;
            stEntry.minX += dx;
            stEntry.maxX += dx;
          }
        }
        const kids = childrenByGroupEntry.get(cur);
        if (kids) {
          for (const kid of kids) {
            if (!visited.has(kid)) queue.push(kid);
          }
        }
      }
    }

    function getVisualWidth(g: GroupEntry): number {
      let maxW = g.pg.block.width;
      if (g.pg.mountedInlineMap.size > 0) {
        for (const inl of g.pg.mountedInlineMap.values()) {
          const stEntry = unit.subtrees.find(s => s.st.subDoc.id === inl.subDoc.id);
          if (stEntry) {
            const relRight = stEntry.maxX - g.offsetX;
            if (relRight > maxW) maxW = relRight;
          }
        }
      }
      return maxW;
    }

    const byLevel = new Map<number, GroupEntry[]>();
    for (const g of docGroups) {
      const lvl = g.pg.globalLevel;
      if (!byLevel.has(lvl)) byLevel.set(lvl, []);
      byLevel.get(lvl)!.push(g);
    }
    const sortedLevels = Array.from(byLevel.keys()).sort((a, b) => a - b);

    for (const lvl of sortedLevels) {
      const levelGroups = byLevel.get(lvl)!;
      levelGroups.sort((a, b) => a.offsetX - b.offsetX);

      const levelSet = new Set(levelGroups.map(g => g.pg.node.groupKey));
      const validTargetOf = new Map<string, string>();

      for (const g of levelGroups) {
        const key = g.pg.node.groupKey;
        const rawTarget = doc.groupRules[key]?.dockTargetGroupKey ?? g.pg.node.dockTargetGroupKey ?? null;
        if (rawTarget && rawTarget !== key && levelSet.has(rawTarget)) {
          validTargetOf.set(key, rawTarget);
        }
      }

      for (const key of Array.from(validTargetOf.keys())) {
        const seen = new Set<string>([key]);
        let cur: string | undefined = validTargetOf.get(key);
        let cyclic = false;
        while (cur) {
          if (seen.has(cur)) {
            cyclic = true;
            break;
          }
          seen.add(cur);
          cur = validTargetOf.get(cur);
        }
        if (cyclic) {
          validTargetOf.delete(key);
        }
      }

      const followersByTarget = new Map<string, GroupEntry[]>();
      for (const g of levelGroups) {
        const tgt = validTargetOf.get(g.pg.node.groupKey);
        if (tgt) {
          if (!followersByTarget.has(tgt)) followersByTarget.set(tgt, []);
          followersByTarget.get(tgt)!.push(g);
        }
      }

      const heads = levelGroups.filter(g => !validTargetOf.has(g.pg.node.groupKey));
      for (const head of heads) {
        const headKey = head.pg.node.groupKey;
        const headDeltaX = doc.groupRules[headKey]?.relativeDeltaX ?? head.pg.node.relativeDeltaX ?? 0;
        if (headDeltaX) {
          shiftGroupAndDescendants(head, headDeltaX);
        }

        const chain: GroupEntry[] = [];
        const stack: GroupEntry[] = [head];
        while (stack.length > 0) {
          const cur = stack.pop()!;
          chain.push(cur);
          const kids = followersByTarget.get(cur.pg.node.groupKey);
          if (kids && kids.length > 0) {
            for (let i = kids.length - 1; i >= 0; i--) {
              stack.push(kids[i]);
            }
          }
        }

        const isClusterDocked = chain.length > 1;
        let cursorRight = head.offsetX + getVisualWidth(head);

        for (let i = 0; i < chain.length; i++) {
          const item = chain[i];
          const k = item.pg.node.groupKey;
          if (i > 0) {
            const desiredX = cursorRight + DOCKED_GROUP_GAP_X;
            const snapDx = desiredX - item.offsetX;
            if (snapDx) {
              shiftGroupAndDescendants(item, snapDx);
            }
            cursorRight = item.offsetX + getVisualWidth(item);
          }
          dockMetaByGroupKey.set(k, {
            dockClusterKey: headKey,
            isDocked: isClusterDocked,
            dockTargetGroupKey: validTargetOf.get(k) ?? null,
          });
        }
      }
    }

    if (rootGroupEntry) {
      unit.anchorCenterX += rootGroupEntry.offsetX - prevRootGroupX;
    }

    unit.contour.clear();
    for (const item of unit.groups) {
      const lvl = item.pg.globalLevel;
      const sMin = item.offsetX;
      const sMax = item.offsetX + item.pg.block.width;
      const prev = unit.contour.get(lvl);
      if (!prev) {
        unit.contour.set(lvl, { minX: sMin, maxX: sMax });
      } else {
        if (sMin < prev.minX) prev.minX = sMin;
        if (sMax > prev.maxX) prev.maxX = sMax;
      }
    }
    for (const s of unit.subtrees) {
      for (let l = s.st.levelMin; l <= s.st.levelMax; l++) {
        const prev = unit.contour.get(l);
        if (!prev) {
          unit.contour.set(l, { minX: s.minX, maxX: s.maxX });
        } else {
          if (s.minX < prev.minX) prev.minX = s.minX;
          if (s.maxX > prev.maxX) prev.maxX = s.maxX;
        }
      }
    }
  }

  const groupParentConnections: {
    ownerDoc: DesignDocumentModel;
    group: ResolvedGroupNode;
    parentPersonId: string;
    isSubtreeEdge: boolean;
  }[] = [];

  /**
   * Rekursive Post-Order Kontur-Konstruktion ab einem ResolvedGroupNode
   */
  function layoutGroupRecursive(
    node: ResolvedGroupNode,
    doc: DesignDocumentModel,
    lineage: ResolvedLineageResult,
    levelOffsetFromParent: number,
    activeDocStack: Set<string>,
    subtreeDepth: number,
    parentAnchorLevel?: number
  ): LaidOutUnit {
    const globalLevel = node.level + levelOffsetFromParent;

    // Welche Mitglieder in dieser Gruppe haben eingebundene Sub-Bäume?
    const mountedInlineMap = new Map<string, InternalSubtreePlacement>();
    const capsuleMap = new Map<
      string,
      { mount: SubtreeMountRule; subDoc: DesignDocumentModel; personCount: number; genSpan: number }
    >();

    for (const mid of node.memberIds) {
      const mount = doc.subtreeMounts[mid];
      if (!mount || activeDocStack.has(mount.subDocumentId)) continue;
      const subDoc = bundle.subDocuments[mount.subDocumentId];
      if (!subDoc) continue;
      const subLineage = getLineageForDoc(subDoc);
      const stats = countDescendantStats(subLineage);
      if (mount.displayMode === 'capsule') {
        capsuleMap.set(mid, {
          mount,
          subDoc,
          personCount: stats.personCount,
          genSpan: stats.genSpan,
        });
      } else {
        // Inline-Einbettung ersetzt Knoten & dessen Nachkommen durch Sub-Baum
        mountedInlineMap.set(mid, {
          subDoc,
          parentDocId: doc.id,
          anchorPersonId: mid,
          depth: subtreeDepth + 1,
          levelMin: globalLevel,
          levelMax: globalLevel,
          frameLocalMinX: 0,
          frameLocalMaxX: 0,
          relX: mount.relativeDeltaX || 0,
        });
      }
    }

    const spec = DENSITY_PROFILE_SPECS[doc.cardDensityProfile] || DENSITY_PROFILE_SPECS.standard;
    const cardWidth = spec.cardWidth;
    const cardHeights = new Map<string, number>();

    for (const mid of node.memberIds) {
      const cap = capsuleMap.get(mid);
      if (cap) {
        const cm = computeCapsuleCardMetrics(
          doc.cardDensityProfile,
          cap.subDoc.name,
          cap.personCount,
          cap.genSpan
        );
        cardHeights.set(mid, cm.height);
        continue;
      }
      const inl = mountedInlineMap.get(mid);
      if (inl) {
        // Im Inline-Sub-Baum übernimmt die Anker-Kachel das Design des Sub-Baums
        const subLin = getLineageForDoc(inl.subDoc);
        const subMeta = subLin.resolvedMeta.get(inl.subDoc.rootPersonId);
        if (subMeta) {
          cardHeights.set(mid, getPersonMetrics(inl.subDoc, subMeta).height);
          continue;
        }
      }
      const meta = lineage.resolvedMeta.get(mid);
      if (meta) {
        cardHeights.set(mid, getPersonMetrics(doc, meta).height);
      } else {
        cardHeights.set(mid, 60);
      }
    }

    // Inline-Subtrees verbieten mehrzeiliges Wrapping derselben Gruppe, da der Sub-Baum vertikal herauswächst
    const hasInlineMounts = mountedInlineMap.size > 0;
    const effectiveMaxCols = hasInlineMounts ? null : node.maxColumnsPerRow;

    // ------------------------------------------------------------------
    // FALL A: Geschwistergruppe ohne inline/gekapselte Sub-Bäume (einzeilig kompakt zentriert ODER mehrzeilig gewrappt)
    // ------------------------------------------------------------------
    const willWrapMultiRow =
      effectiveMaxCols !== null && effectiveMaxCols > 0 && effectiveMaxCols < node.memberIds.length;

    if (
      willWrapMultiRow ||
      node.memberIds.length === 1 ||
      (mountedInlineMap.size === 0 && capsuleMap.size === 0)
    ) {
      // Wenn genau 1 Mitglied ein Inline-Sub-Baum ist (z.B. alleiniges Kind oder Root des Sub-Baums):
      if (node.memberIds.length === 1 && mountedInlineMap.has(node.memberIds[0])) {
        const anchorId = node.memberIds[0];
        const inl = mountedInlineMap.get(anchorId)!;
        return buildInlineSubtreeUnit(
          inl,
          globalLevel,
          activeDocStack,
          node.anchorParentId,
          doc
        );
      }

      const singleCap = node.memberIds.length === 1 ? capsuleMap.get(node.memberIds[0]) : undefined;
      const effectiveBlockCardW = singleCap
        ? computeCapsuleCardMetrics(
            doc.cardDensityProfile,
            singleCap.subDoc.name,
            singleCap.personCount,
            singleCap.genSpan
          ).width
        : cardWidth;

      const block = layoutWrappedGroupBlock(
        node.memberIds,
        effectiveBlockCardW,
        cardHeights,
        effectiveMaxCols,
        direction
      );

      const placedGroup: InternalPlacedGroup = {
        node,
        doc,
        lineage,
        globalLevel,
        block,
        relX: -block.width / 2,
        mountedInlineMap,
        capsuleMap,
        cardWidth,
        cardHeights,
      };

      const unitContour = new Map<number, ContourSpan>();
      unitContour.set(globalLevel, {
        minX: -block.width / 2,
        maxX: block.width / 2,
      });

      const unit: LaidOutUnit = {
        contour: unitContour,
        rootLevel: globalLevel,
        anchorCenterX: 0,
        groups: [{ pg: placedGroup, offsetX: -block.width / 2 }],
        subtrees: [],
      };

      // Kind-Gruppen dieser Mitglieder auf den folgenden Ebenen platzieren
      const emittingOrder = [...node.memberIds];
      const childUnits: { parentSlotCenterX: number; childUnit: LaidOutUnit }[] = [];

      for (const cg of node.childGroups) {
        if (!cg.anchorParentId) continue;
        // Wenn Kind-Gruppe zu einem gekapselten Knoten gehört, entfällt sie im Hauptbaum
        if (capsuleMap.has(cg.anchorParentId)) continue;

        groupParentConnections.push({
          ownerDoc: doc,
          group: cg,
          parentPersonId: cg.anchorParentId,
          isSubtreeEdge: subtreeDepth > 0 || parentAnchorLevel !== undefined,
        });

        const cgUnit = layoutGroupRecursive(
          cg,
          doc,
          lineage,
          levelOffsetFromParent,
          activeDocStack,
          subtreeDepth,
          parentAnchorLevel
        );
        const slot = block.slots.find(s => s.personId === cg.anchorParentId);
        const slotCenter = slot ? slot.localX - block.width / 2 + slot.width / 2 : 0;

        // Vertikale Riser-Kontur reservieren, falls die Kindgruppe Ebenen übersprungen hat
        const cgLevel = cg.level + levelOffsetFromParent;
        for (let l = globalLevel + 1; l < cgLevel; l++) {
          mergeContourInto(
            cgUnit.contour,
            new Map([[l, { minX: -12, maxX: 12 }]]),
            0
          );
        }

        childUnits.push({ parentSlotCenterX: slotCenter, childUnit: cgUnit });
      }

      if (childUnits.length > 0) {
        // Chronologisch sortieren entlang Eltern-X
        childUnits.sort((a, b) => {
          if (Math.abs(a.parentSlotCenterX - b.parentSlotCenterX) > 1) {
            return a.parentSlotCenterX - b.parentSlotCenterX;
          }
          return (
            emittingOrder.indexOf(a.childUnit.groups[0]?.pg.node.anchorParentId || '') -
            emittingOrder.indexOf(b.childUnit.groups[0]?.pg.node.anchorParentId || '')
          );
        });

        // Kinder-Units sauber nebeneinander packen (ohne Überlappung über alle Ebenen)
        const accChildContour = new Map<number, ContourSpan>();
        const placedChildUnits: { unit: LaidOutUnit; desiredX: number; placedX: number }[] = [];

        for (let i = 0; i < childUnits.length; i++) {
          const cu = childUnits[i];
          const desired = cu.parentSlotCenterX - cu.childUnit.anchorCenterX;
          if (i === 0) {
            shiftUnitOffsets(cu.childUnit, desired);
            mergeContourInto(accChildContour, cu.childUnit.contour, 0);
            placedChildUnits.push({ unit: cu.childUnit, desiredX: desired, placedX: desired });
          } else {
            const minRequiredShift = computeRequiredShift(
              accChildContour,
              cu.childUnit.contour,
              cu.childUnit.rootLevel,
              BRANCH_GAP_X,
              BRANCH_GAP_X
            );
            const finalShift = Math.max(desired, minRequiredShift);
            shiftUnitOffsets(cu.childUnit, finalShift);
            mergeContourInto(accChildContour, cu.childUnit.contour, 0);
            placedChildUnits.push({ unit: cu.childUnit, desiredX: desired, placedX: finalShift });
          }
        }

        // Ganze Kinder-Schar so zentrieren, dass das Mittel über den Elternteil-Slots sitzt
        if (placedChildUnits.length > 0) {
          const avgDesired =
            childUnits.reduce((sum, c) => sum + c.parentSlotCenterX, 0) / childUnits.length;
          const firstChild = placedChildUnits[0];
          const lastChild = placedChildUnits[placedChildUnits.length - 1];
          const actualChildSpanCenter =
            (firstChild.unit.anchorCenterX + lastChild.unit.anchorCenterX) / 2;
          const centeringShift = avgDesired - actualChildSpanCenter;

          // Nur zentrieren, wenn sich auf globalLevel nichts mit den eigenen Eltern-Slot beißt
          for (const pc of placedChildUnits) {
            shiftUnitOffsets(pc.unit, centeringShift);
            unit.groups.push(...pc.unit.groups);
            unit.subtrees.push(...pc.unit.subtrees);
            mergeContourInto(unit.contour, pc.unit.contour, 0);
          }
        }
      }

      return unit;
    }

    // ------------------------------------------------------------------
    // FALL B: Einzeilige Geschwistergruppe (>= 2 Mitglieder) – Kontur-basiertes Auto-Shifting
    // pro Zweig (damit Sub-Bäume Geschwister sauber nach links/rechts ausrücken können!)
    // ------------------------------------------------------------------
    interface MemberBranchAssembly {
      memberId: string;
      unit: LaidOutUnit;
      isInlineSubtree: boolean;
      cardCenterOffsetInUnit: number;
    }

    const memberBranches: MemberBranchAssembly[] = [];

    for (const mid of node.memberIds) {
      const inlineMount = mountedInlineMap.get(mid);
      if (inlineMount) {
        const subUnit = buildInlineSubtreeUnit(
          inlineMount,
          globalLevel,
          activeDocStack,
          node.anchorParentId,
          doc
        );
        memberBranches.push({
          memberId: mid,
          unit: subUnit,
          isInlineSubtree: true,
          cardCenterOffsetInUnit: subUnit.anchorCenterX,
        });
        continue;
      }

      // Einzelkarte (normal oder Verweis-Kapsel) auf Ebene globalLevel
      const h = cardHeights.get(mid) ?? 60;
      const w = capsuleMap.has(mid)
        ? computeCapsuleCardMetrics(
            doc.cardDensityProfile,
            capsuleMap.get(mid)!.subDoc.name,
            capsuleMap.get(mid)!.personCount,
            capsuleMap.get(mid)!.genSpan
          ).width
        : cardWidth;

      const dummyGroupNode: ResolvedGroupNode = {
        ...node,
        groupKey: `${node.groupKey}::slot_${mid}`,
        memberIds: [mid],
        childGroups: [],
      };
      const slotBlock = layoutWrappedGroupBlock([mid], w, new Map([[mid, h]]), null, direction);
      const slotPlaced: InternalPlacedGroup = {
        node: dummyGroupNode,
        doc,
        lineage,
        globalLevel,
        block: slotBlock,
        relX: -w / 2,
        mountedInlineMap,
        capsuleMap,
        cardWidth: w,
        cardHeights: new Map([[mid, h]]),
      };

      const mUnit: LaidOutUnit = {
        contour: new Map([[globalLevel, { minX: -w / 2, maxX: w / 2 }]]),
        rootLevel: globalLevel,
        anchorCenterX: 0,
        groups: [{ pg: slotPlaced, offsetX: -w / 2 }],
        subtrees: [],
      };

      if (!capsuleMap.has(mid)) {
        const childrenOfMid = node.childGroups.filter(cg => cg.anchorParentId === mid);
        if (childrenOfMid.length > 0) {
          const cgAccContour = new Map<number, ContourSpan>();
          const cgPlaced: LaidOutUnit[] = [];

          childrenOfMid.forEach((cg, idx) => {
            groupParentConnections.push({
              ownerDoc: doc,
              group: cg,
              parentPersonId: mid,
              isSubtreeEdge: subtreeDepth > 0 || parentAnchorLevel !== undefined,
            });
            const cgUnit = layoutGroupRecursive(
              cg,
              doc,
              lineage,
              levelOffsetFromParent,
              activeDocStack,
              subtreeDepth,
              parentAnchorLevel
            );
            const cgLevel = cg.level + levelOffsetFromParent;
            for (let l = globalLevel + 1; l < cgLevel; l++) {
              mergeContourInto(cgUnit.contour, new Map([[l, { minX: -12, maxX: 12 }]]), 0);
            }

            if (idx > 0) {
              const shift = computeRequiredShift(
                cgAccContour,
                cgUnit.contour,
                cgUnit.rootLevel,
                BRANCH_GAP_X,
                BRANCH_GAP_X
              );
              shiftUnitOffsets(cgUnit, shift);
            }
            mergeContourInto(cgAccContour, cgUnit.contour, 0);
            cgPlaced.push(cgUnit);
          });

          const cSpanMid =
            (cgPlaced[0].anchorCenterX + cgPlaced[cgPlaced.length - 1].anchorCenterX) / 2;
          for (const cp of cgPlaced) {
            shiftUnitOffsets(cp, -cSpanMid);
            mUnit.groups.push(...cp.groups);
            mUnit.subtrees.push(...cp.subtrees);
            mergeContourInto(mUnit.contour, cp.contour, 0);
          }
        }
      }

      memberBranches.push({
        memberId: mid,
        unit: mUnit,
        isInlineSubtree: false,
        cardCenterOffsetInUnit: 0,
      });
    }

    // Jetzt alle MemberBranchUnits horizontal nebeneinander mittels Kontur-Merge positionieren!
    // Da Inline-Sub-Bäume auf ALLEN ihren Ebenen (inkl. globalLevel!) ihre volle Rahmenbreite in `contour` haben,
    // rücken Geschwister automatisch nach links & rechts aus dem Sub-Baum-Rahmen heraus!
    const masterAccContour = new Map<number, ContourSpan>();
    const combinedUnit: LaidOutUnit = {
      contour: masterAccContour,
      rootLevel: globalLevel,
      anchorCenterX: 0,
      groups: [],
      subtrees: [],
    };

    const cardCenterXs: number[] = [];

    memberBranches.forEach((mb, idx) => {
      if (idx === 0) {
        mergeContourInto(masterAccContour, mb.unit.contour, 0);
        cardCenterXs.push(mb.cardCenterOffsetInUnit);
      } else {
        const prevIsSubtree = memberBranches[idx - 1].isInlineSubtree;
        const currIsSubtree = mb.isInlineSubtree;
        const sameLevelGap =
          prevIsSubtree || currIsSubtree ? SUBTREE_MARGIN_X : STANDARD_CARD_GAP_X;
        const shift = computeRequiredShift(
          masterAccContour,
          mb.unit.contour,
          globalLevel,
          sameLevelGap,
          BRANCH_GAP_X
        );
        shiftUnitOffsets(mb.unit, shift);
        mergeContourInto(masterAccContour, mb.unit.contour, 0);
        cardCenterXs.push(mb.cardCenterOffsetInUnit + shift);
      }
      combinedUnit.groups.push(...mb.unit.groups);
      combinedUnit.subtrees.push(...mb.unit.subtrees);
    });

    // Geschwisterreihe um ihren ersten..letzten Karten-Mittelpunkt bei X = 0 zentrieren
    const finalMemberCenterXMap = new Map<string, number>();
    const midCenter =
      cardCenterXs.length > 0 ? (cardCenterXs[0] + cardCenterXs[cardCenterXs.length - 1]) / 2 : 0;
    if (cardCenterXs.length > 0) {
      shiftUnitOffsets(combinedUnit, -midCenter);
    }
    memberBranches.forEach((mb, idx) => {
      const cumShift = idx === 0 ? 0 : cardCenterXs[idx] - mb.cardCenterOffsetInUnit;
      finalMemberCenterXMap.set(mb.memberId, mb.cardCenterOffsetInUnit + cumShift - midCenter);
    });

    // Slot-Dummy-Gruppen entfernen und durch eine einzige konsistente Gruppen-Hülle ersetzen.
    // Inline-Subtree-Anker behalten ihre echte Kachel aus `subUnit` (keine Doppel-Kachel erzeugen!).
    const mergedPlacedGroups: { pg: InternalPlacedGroup; offsetX: number }[] = [];
    for (const item of combinedUnit.groups) {
      if (!item.pg.node.groupKey.startsWith(`${node.groupKey}::slot_`)) {
        mergedPlacedGroups.push(item);
      }
    }

    const nonInlineIds = node.memberIds.filter(mid => !mountedInlineMap.has(mid));
    const slotPositions = node.memberIds.map(mid => {
      const w = capsuleMap.has(mid)
        ? computeCapsuleCardMetrics(
            doc.cardDensityProfile,
            capsuleMap.get(mid)!.subDoc.name,
            capsuleMap.get(mid)!.personCount,
            capsuleMap.get(mid)!.genSpan
          ).width
        : mountedInlineMap.has(mid)
        ? DENSITY_PROFILE_SPECS[mountedInlineMap.get(mid)!.subDoc.cardDensityProfile].cardWidth
        : cardWidth;
      const center = finalMemberCenterXMap.get(mid) ?? 0;
      return { mid, leftX: center - w / 2, w, h: cardHeights.get(mid) ?? 60 };
    });

    const minLeftX = Math.min(...slotPositions.map(s => s.leftX));
    const maxRightX = Math.max(...slotPositions.map(s => s.leftX + s.w));

    const customColCenters: number[] = [];
    const customSlots = slotPositions
      .filter(sp => nonInlineIds.includes(sp.mid))
      .map((sp, cIdx) => {
        const localX = sp.leftX - minLeftX;
        customColCenters.push(localX + sp.w / 2);
        return {
          personId: sp.mid,
          rowIndex: 0,
          colIndex: cIdx,
          visualRowOrder: 0,
          localX,
          localY: 0,
          width: sp.w,
          height: sp.h,
          feedChannelX: localX + sp.w + FEED_THROUGH_CHANNEL_WIDTH / 2,
        };
      });

    const rowHeightMax = Math.max(60, ...slotPositions.map(s => s.h));
    const unifiedGroupBlock: WrappedGroupBlock = {
      width: Math.max(cardWidth, maxRightX - minLeftX),
      height: rowHeightMax,
      rowCount: 1,
      columnCount: node.memberIds.length,
      isWrapped: false,
      rowTopsLocalY: [0],
      rowHeights: [rowHeightMax],
      colCentersLocalX: customColCenters,
      channelCentersLocalX: [],
      slots: customSlots,
    };

    const unifiedPlacedGroup: InternalPlacedGroup = {
      node,
      doc,
      lineage,
      globalLevel,
      block: unifiedGroupBlock,
      relX: minLeftX,
      mountedInlineMap,
      capsuleMap,
      cardWidth,
      cardHeights,
    };

    combinedUnit.groups = [
      { pg: unifiedPlacedGroup, offsetX: minLeftX },
      ...mergedPlacedGroups,
    ];

    return combinedUnit;
  }

  function buildInlineSubtreeUnit(
    inl: InternalSubtreePlacement,
    anchorGlobalLevel: number,
    activeDocStack: Set<string>,
    parentInMasterId: string | null,
    parentDoc: DesignDocumentModel
  ): LaidOutUnit {
    const subDoc = inl.subDoc;
    const subLineage = getLineageForDoc(subDoc);
    if (!subLineage.rootGroup) {
      return {
        contour: new Map([[anchorGlobalLevel, { minX: -85, maxX: 85 }]]),
        rootLevel: anchorGlobalLevel,
        anchorCenterX: 0,
        groups: [],
        subtrees: [],
      };
    }

    const nextStack = new Set(activeDocStack);
    nextStack.add(subDoc.id);

    const levelOffset = anchorGlobalLevel - 1;
    const subUnit = layoutGroupRecursive(
      subLineage.rootGroup,
      subDoc,
      subLineage,
      levelOffset,
      nextStack,
      inl.depth,
      anchorGlobalLevel
    );

    // Relative Gruppen-Offsets & Andock-Cluster des Sub-Baums 1:1 VOR der Bounding-Box auflösen!
    applyDocumentGroupOffsetsAndDocking(subUnit, subDoc);

    // Falls es in parentDoc noch eine eingehende Kante zum Ankerknoten gab, bleibt diese über groupParentConnections
    // in der übergeordneten Gruppe registriert! Hier berechnen wir die hermetische Bounding-Box des Sub-Baums.
    let minX = Infinity;
    let maxX = -Infinity;
    let levelMin = anchorGlobalLevel;
    let levelMax = anchorGlobalLevel;

    for (const [lvl, span] of subUnit.contour.entries()) {
      if (span.minX < minX) minX = span.minX;
      if (span.maxX > maxX) maxX = span.maxX;
      if (lvl < levelMin) levelMin = lvl;
      if (lvl > levelMax) levelMax = lvl;
    }

    if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
      minX = -85;
      maxX = 85;
    }

    const frameMinX = minX - SUBTREE_FRAME_PAD_X;
    const frameMaxX = maxX + SUBTREE_FRAME_PAD_X;

    // Hermetische Sperr-Kontur: Reserviere die VOLLE Rahmenbreite über ALLE Ebenen [levelMin .. levelMax],
    // damit kein Nachbarzweig des Hauptbaums in oder quer über diesen Sub-Baum wächst!
    for (let l = levelMin; l <= levelMax; l++) {
      subUnit.contour.set(l, {
        minX: frameMinX,
        maxX: frameMaxX,
      });
    }

    inl.levelMin = levelMin;
    inl.levelMax = levelMax;
    inl.frameLocalMinX = frameMinX;
    inl.frameLocalMaxX = frameMaxX;

    subUnit.subtrees.push({
      st: inl,
      offsetX: 0,
      minX: frameMinX,
      maxX: frameMaxX,
    });

    if (inl.relX) {
      shiftUnitOffsets(subUnit, inl.relX);
    }

    // Markiere Root-Gruppe des Sub-Baums mit dem übergeordneten parentInMasterId (für Referenz/Highlighting)
    if (parentInMasterId && subUnit.groups[0]) {
      subUnit.groups[0].pg.node = {
        ...subUnit.groups[0].pg.node,
        anchorParentId: parentInMasterId,
        isSubtree: true,
        subDocumentId: subDoc.id,
      };
      void parentDoc;
    }

    return subUnit;
  }

  const masterLineage = getLineageForDoc(masterDoc);
  if (!masterLineage.rootGroup) {
    return {
      groups: [],
      cards: [],
      levels: [],
      subtreeFrames: [],
      backgrounds: [],
      personCardById: new Map(),
      groupByKey: new Map(),
      resolvedLineagesByDocId,
      parentEdgeCountByLevelGap: new Map(),
      groupParentConnections: [],
    };
  }

  const activeStack = new Set<string>([masterDoc.id]);
  const rootUnit = layoutGroupRecursive(
    masterLineage.rootGroup,
    masterDoc,
    masterLineage,
    0,
    activeStack,
    0
  );

  // Relative Gruppen-Offsets & Andock-Cluster des Hauptdokuments auflösen (Sub-Baum-Layouts bleiben 1:1 unberührt)
  applyDocumentGroupOffsetsAndDocking(rootUnit, masterDoc);

  // Alles so verschieben, dass minX bei +100 beginnt
  let globalMinX = Infinity;
  for (const span of rootUnit.contour.values()) {
    if (span.minX < globalMinX) globalMinX = span.minX;
  }
  const shiftOriginX = Number.isFinite(globalMinX) ? 100 - globalMinX : 100;
  shiftUnitOffsets(rootUnit, shiftOriginX);

  // =========================================================================
  // Schritt 2: Globale Ebenen-Höhen-Synchronisation (Top-Aligned über Haupt- & Sub-Bäume!)
  // =========================================================================
  let maxGlobalLevel = 1;
  const maxHeightByLevel = new Map<number, number>();
  const parentEdgeCountByLevelGap = new Map<number, number>();

  for (const item of rootUnit.groups) {
    const lvl = item.pg.globalLevel;
    if (lvl > maxGlobalLevel) maxGlobalLevel = lvl;
    const cur = maxHeightByLevel.get(lvl) ?? 0;
    if (item.pg.block.height > cur) {
      maxHeightByLevel.set(lvl, item.pg.block.height);
    }
  }

  for (const conn of groupParentConnections) {
    const targetGrp = rootUnit.groups.find(g => g.pg.node.groupKey === conn.group.groupKey);
    const gapLevel = Math.max(1, (targetGrp?.pg.globalLevel ?? conn.group.level) - 1);
    parentEdgeCountByLevelGap.set(gapLevel, (parentEdgeCountByLevelGap.get(gapLevel) ?? 0) + 1);
  }

  const levels: SceneLevelBand[] = [];
  const levelByNum = new Map<number, SceneLevelBand>();
  const LEVEL_PAD_TOP = 8;
  const LEVEL_PAD_BOTTOM = 8;

  // Reihenfolge je nach Wuchsrichtung:
  // - bottom_up: Ebene maxLevel ganz oben (kleinstes Y), Ebene 1 ganz unten (größtes Y)
  // - top_down:  Ebene 1 ganz oben (kleinstes Y), Ebene maxLevel ganz unten (größtes Y)
  let cursorY = 60;
  const orderedLevelNums: number[] =
    direction === 'bottom_up'
      ? Array.from({ length: maxGlobalLevel }, (_, i) => maxGlobalLevel - i)
      : Array.from({ length: maxGlobalLevel }, (_, i) => i + 1);

  for (let i = 0; i < orderedLevelNums.length; i++) {
    const lvl = orderedLevelNums[i];
    const contentH = Math.max(64, maxHeightByLevel.get(lvl) ?? 64);
    const totalBandH = contentH + LEVEL_PAD_TOP + LEVEL_PAD_BOTTOM;
    const band: SceneLevelBand = {
      level: lvl,
      label: `Ebene ${lvl}`,
      topY: cursorY,
      bottomY: cursorY + totalBandH,
      height: totalBandH,
      contentTopY: cursorY + LEVEL_PAD_TOP,
      contentHeight: contentH,
    };
    levels.push(band);
    levelByNum.set(lvl, band);

    if (i < orderedLevelNums.length - 1) {
      const lowerLvl = Math.min(lvl, orderedLevelNums[i + 1]);
      const edgeCnt = parentEdgeCountByLevelGap.get(lowerLvl) ?? 1;
      const dynamicChannelGap = BASE_CHANNEL_GAP_Y + Math.min(18, Math.max(0, edgeCnt - 1)) * LEVEL_LANE_STEP_Y;
      cursorY += totalBandH + dynamicChannelGap;
    }
  }

  // Sortiere Levels aufsteigend nach Ebenennummer (1..N) für konsistente Metadaten
  levels.sort((a, b) => a.level - b.level);

  // =========================================================================
  // Schritt 3: Finalisierte Groups, Top-Aligned Cards, Sub-Baum-Frames & Unverzerrte Hintergründe
  // =========================================================================
  const sceneGroups: SceneSiblingGroup[] = [];
  const sceneCards: ScenePersonCard[] = [];
  const personCardById = new Map<string, ScenePersonCard>();
  const groupByKey = new Map<string, SceneSiblingGroup>();

  for (const item of rootUnit.groups) {
    const pg = item.pg;
    const band = levelByNum.get(pg.globalLevel);
    if (!band) continue;

    // Alle Gruppen & obersten Kachelreihen einer Ebene liegen TOP-ALIGNED an band.contentTopY!
    const groupX = item.offsetX;
    const groupY = band.contentTopY;

    const dockMeta = dockMetaByGroupKey.get(pg.node.groupKey);
    const sceneGroup: SceneSiblingGroup = {
      groupKey: pg.node.groupKey,
      ownerDocumentId: pg.doc.id,
      anchorParentId: pg.node.anchorParentId,
      marriageIndex: pg.node.marriageIndex,
      marriageLabel: pg.node.marriageLabel,
      level: pg.globalLevel,
      x: groupX,
      y: groupY,
      width: pg.block.width,
      height: pg.block.height,
      maxColumnsPerRow: pg.node.maxColumnsPerRow,
      rowCount: pg.block.rowCount,
      columnCount: pg.block.columnCount,
      colCentersX: pg.block.colCentersLocalX.map(cx => groupX + cx),
      channelCentersX: pg.block.channelCentersLocalX.map(cx => groupX + cx),
      rowTopsY: pg.block.rowTopsLocalY.map(ry => groupY + ry),
      rowHeights: pg.block.rowHeights,
      isSubtree: pg.node.isSubtree,
      subDocumentId: pg.node.subDocumentId,
      relativeDeltaX: pg.node.relativeDeltaX,
      dockTargetGroupKey: dockMeta?.dockTargetGroupKey ?? pg.node.dockTargetGroupKey ?? null,
      dockClusterKey: dockMeta?.dockClusterKey ?? pg.node.groupKey,
      isDocked: Boolean(dockMeta?.isDocked),
      isSplit: pg.node.isSplit,
      memberIds: pg.node.memberIds,
    };
    sceneGroups.push(sceneGroup);
    groupByKey.set(sceneGroup.groupKey, sceneGroup);

    let minGroupCardX = Infinity;
    let minGroupCardY = Infinity;
    let maxGroupCardX = -Infinity;
    let maxGroupCardY = -Infinity;

    for (const slot of pg.block.slots) {
      if (personCardById.has(slot.personId)) {
        continue;
      }
      const cap = pg.capsuleMap.get(slot.personId);
      const inl = pg.mountedInlineMap.get(slot.personId);

      // Effektives Dokument & Metadaten bestimmen (bei Inline-Sub-Baum übernimmt die Anker-Kachel Design des Sub-Baums)
      const effectiveDoc = inl ? inl.subDoc : pg.doc;
      const effectiveLineage = inl ? getLineageForDoc(inl.subDoc) : pg.lineage;
      const effectiveMeta = effectiveLineage.resolvedMeta.get(slot.personId) || pg.lineage.resolvedMeta.get(slot.personId);
      if (!effectiveMeta) continue;

      const cardMetrics = cap
        ? null
        : getPersonMetrics(effectiveDoc, effectiveMeta);

      const cardOffsetRule = pg.doc.groupRules[`__card_offset__::${slot.personId}`];
      const cardDx = cardOffsetRule?.relativeDeltaX || 0;

      // Strikte Oben-bündige Ausrichtung innerhalb jeder Ebene (keine vertikale manuelle Verschiebung)
      const cardX = groupX + slot.localX + cardDx;
      const cardY = groupY + slot.localY;

      const p = effectiveMeta.person;
      const fullName = `${p.given_name || ''} ${p.surname || ''}`.trim() || 'N.N.';

      const card: ScenePersonCard = {
        personId: slot.personId,
        ownerDocumentId: effectiveDoc.id,
        groupKey: sceneGroup.groupKey,
        level: pg.globalLevel,
        rowIndex: slot.rowIndex,
        colIndex: slot.colIndex,
        x: cardX,
        y: cardY,
        width: slot.width,
        height: slot.height,
        densityProfile: effectiveDoc.cardDensityProfile,
        cardConfig: { ...effectiveDoc.cardConfig },
        henryCode: effectiveMeta.henryCode,
        generation: effectiveMeta.generation,
        givenName: p.given_name || 'N.N.',
        surname: p.surname || '',
        fullName,
        sex: p.sex || 'U',
        lifeLines: cardMetrics ? cardMetrics.lifeLines : [],
        occupationText: cardMetrics?.occupationText,
        spouses: cardMetrics ? cardMetrics.spouses : [],
        implexBadges: effectiveMeta.implexBadges,
        hasChildrenInTree: !cap && effectiveMeta.childrenIds.length > 0,
        isSubtreeMember: Boolean(inl) || pg.doc.id !== masterDoc.id,
        subDocumentId: inl ? inl.subDoc.id : pg.doc.id !== masterDoc.id ? pg.doc.id : undefined,
        isCapsule: Boolean(cap),
        capsuleMeta: cap
          ? {
              subDocumentId: cap.subDoc.id,
              name: cap.subDoc.name,
              personCount: cap.personCount,
              generationSpan: cap.genSpan,
              anchorPersonId: slot.personId,
            }
          : undefined,
      };
      sceneCards.push(card);
      personCardById.set(card.personId, card);

      if (card.x < minGroupCardX) minGroupCardX = card.x;
      if (card.y < minGroupCardY) minGroupCardY = card.y;
      if (card.x + card.width > maxGroupCardX) maxGroupCardX = card.x + card.width;
      if (card.y + card.height > maxGroupCardY) maxGroupCardY = card.y + card.height;
    }

    if (Number.isFinite(minGroupCardX)) {
      sceneGroup.x = minGroupCardX;
      sceneGroup.y = minGroupCardY;
      sceneGroup.width = Math.max(1, maxGroupCardX - minGroupCardX);
      sceneGroup.height = Math.max(1, maxGroupCardY - minGroupCardY);
    }
  }

  // Subtree Frames & Aspect-Ratio-Locked Subtree Backgrounds
  const subtreeFrames: SceneSubtreeFrame[] = [];
  const backgrounds: SceneBackgroundLayer[] = [];

  for (const entry of rootUnit.subtrees) {
    const st = entry.st;
    const minBand = levelByNum.get(st.levelMin);
    const maxBand = levelByNum.get(st.levelMax);
    if (!minBand || !maxBand) continue;

    const topEdge = Math.min(minBand.topY, maxBand.topY) - SUBTREE_FRAME_PAD_Y;
    const bottomEdge = Math.max(minBand.bottomY, maxBand.bottomY) + SUBTREE_FRAME_PAD_Y;
    const frameX = entry.minX;
    const frameY = topEdge;
    const frameW = Math.max(120, entry.maxX - entry.minX);
    const frameH = Math.max(80, bottomEdge - topEdge);

    const subLin = getLineageForDoc(st.subDoc);
    const stats = countDescendantStats(subLin);

    subtreeFrames.push({
      subDocumentId: st.subDoc.id,
      subDocumentName: st.subDoc.name,
      anchorPersonId: st.anchorPersonId,
      parentDocumentId: st.parentDocId,
      displayMode: 'inline',
      levelMin: st.levelMin,
      levelMax: st.levelMax,
      x: frameX,
      y: frameY,
      width: frameW,
      height: frameH,
      personCount: stats.personCount,
      generationSpan: stats.genSpan,
      depth: st.depth,
    });

    // Subtree-Hintergrundbild strikt mit Aspect-Ratio Lock einpassen!
    if (st.subDoc.bgAssetId && st.subDoc.bgConfig?.visible !== false) {
      const dataUrl = bundle.mediaAssets[st.subDoc.bgAssetId];
      const meta = bundle.mediaMetas[st.subDoc.bgAssetId];
      if (dataUrl) {
        const natW = st.subDoc.bgConfig?.naturalWidth || meta?.width || 400;
        const natH = st.subDoc.bgConfig?.naturalHeight || meta?.height || 400;
        const userScale = (st.subDoc.bgConfig?.scale ?? 100) / 100;
        // Uniforme Aspect-Ratio-sichere Skalierung:
        const fitScale = Math.min(frameW / Math.max(1, natW), frameH / Math.max(1, natH));
        const finalW = natW * fitScale * userScale;
        const finalH = natH * fitScale * userScale;
        const bgX = frameX + (frameW - finalW) / 2 + (st.subDoc.bgConfig?.x || 0);
        const bgY = frameY + (frameH - finalH) / 2 + (st.subDoc.bgConfig?.y || 0);
        backgrounds.push({
          id: `bg_sub_${st.subDoc.id}_${st.anchorPersonId}`,
          scope: 'subtree',
          ownerDocumentId: st.subDoc.id,
          title: st.subDoc.name,
          dataUrl,
          x: bgX,
          y: bgY,
          width: finalW,
          height: finalH,
          opacity: (st.subDoc.bgConfig?.opacity ?? 45) / 100,
        });
      }
    }
  }

  // Master-Hintergrundbild ebenfalls unverzerrt (Aspect-Ratio Lock) im globalen Baum-Bereich platzieren
  if (masterDoc.bgAssetId && masterDoc.bgConfig?.visible !== false) {
    const dataUrl = bundle.mediaAssets[masterDoc.bgAssetId];
    const meta = bundle.mediaMetas[masterDoc.bgAssetId];
    if (dataUrl) {
      let cMinX = Infinity,
        cMaxX = -Infinity,
        cMinY = Infinity,
        cMaxY = -Infinity;
      for (const c of sceneCards) {
        if (c.x < cMinX) cMinX = c.x;
        if (c.x + c.width > cMaxX) cMaxX = c.x + c.width;
        if (c.y < cMinY) cMinY = c.y;
        if (c.y + c.height > cMaxY) cMaxY = c.y + c.height;
      }
      const treeW = Number.isFinite(cMaxX - cMinX) ? Math.max(300, cMaxX - cMinX) : 600;
      const treeH = Number.isFinite(cMaxY - cMinY) ? Math.max(300, cMaxY - cMinY) : 600;
      const natW = masterDoc.bgConfig?.naturalWidth || meta?.width || 600;
      const natH = masterDoc.bgConfig?.naturalHeight || meta?.height || 600;
      const userScale = (masterDoc.bgConfig?.scale ?? 100) / 100;
      const fitScale = Math.min(treeW / Math.max(1, natW), treeH / Math.max(1, natH));
      const finalW = natW * fitScale * userScale;
      const finalH = natH * fitScale * userScale;
      const centerTreeX = Number.isFinite(cMinX) ? (cMinX + cMaxX) / 2 : 400;
      const centerTreeY = Number.isFinite(cMinY) ? (cMinY + cMaxY) / 2 : 300;
      backgrounds.unshift({
        id: `bg_master_${masterDoc.id}`,
        scope: 'master',
        ownerDocumentId: masterDoc.id,
        title: masterDoc.name,
        dataUrl,
        x: centerTreeX - finalW / 2 + (masterDoc.bgConfig?.x || 0),
        y: centerTreeY - finalH / 2 + (masterDoc.bgConfig?.y || 0),
        width: finalW,
        height: finalH,
        opacity: (masterDoc.bgConfig?.opacity ?? 45) / 100,
      });
    }
  }

  return {
    groups: sceneGroups,
    cards: sceneCards,
    levels,
    subtreeFrames,
    backgrounds,
    personCardById,
    groupByKey,
    resolvedLineagesByDocId,
    parentEdgeCountByLevelGap,
    groupParentConnections,
  };
}
