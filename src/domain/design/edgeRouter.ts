import type {
  DesignTreeBundle,
  EdgeWaypointRule,
  GrowthDirection,
  RoutingStyle,
  SceneBridgeArc,
  SceneConnectorEdge,
  SceneLevelBand,
  ScenePersonCard,
  SceneSiblingGroup,
} from './sceneTypes';
import type { ContourLayoutOutput } from './contourLayoutEngine';

export interface SegmentRect {
  edgeKey: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface PendingEdge {
  edgeKey: string;
  ownerDocId: string;
  parentCard: ScenePersonCard;
  parentGroup?: SceneSiblingGroup;
  childCards: ScenePersonCard[];
  childGroup?: SceneSiblingGroup;
  marriageIndex?: number;
  marriageLabel?: string;
  isSubtreeEdge: boolean;
  waypoint?: EdgeWaypointRule;

  // Berechnete Anchors:
  parentExitX: number;
  parentExitY: number;
  parentPrePath: string;
  isFeedThrough: boolean;

  childTargetX: number;
  busY: number;
  childBranchPath: string;
  childDropXs: number[];
  childArrows: { x: number; y: number; points: string }[];

  channelKey: string; // z.B. "1->2"
  channelStartParentY: number;
  channelEndChildY: number;
  laneRank: number;
  laneY: number;
}

function assignCrossingFreeLanes(edgesInChannel: PendingEdge[]): Map<string, number> {
  const rankMap = new Map<string, number>();
  if (edgesInChannel.length === 0) return rankMap;
  if (edgesInChannel.length === 1) {
    rankMap.set(edgesInChannel[0].edgeKey, 0);
    return rankMap;
  }

  // Baue gerichteten Präzedenz-Graphen: i -> j bedeutet "i liegt näher am Elternteil als j" (kleinerer Rang)
  const n = edgesInChannel.length;
  const adj: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  const indeg = new Array(n).fill(0);

  const overlap = (aMin: number, aMax: number, bMin: number, bMax: number) =>
    Math.min(aMax, bMax) >= Math.max(aMin, bMin) - 4;

  for (let i = 0; i < n; i++) {
    const ei = edgesInChannel[i];
    const minI = Math.min(ei.parentExitX, ei.childTargetX);
    const maxI = Math.max(ei.parentExitX, ei.childTargetX);

    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const ej = edgesInChannel[j];
      const minJ = Math.min(ej.parentExitX, ej.childTargetX);
      const maxJ = Math.max(ej.parentExitX, ej.childTargetX);
      if (!overlap(minI, maxI, minJ, maxJ)) continue;

      // Regel 1: Kreuzt Horizontale von i den Eltern-Abgang von j?
      // Wenn j näher an Eltern liegt (rank_j < rank_i), schneidet Horizontale von i den Eltern-Stamm von j NICHT!
      // Wait: Eltern-Stamm von j verläuft zwischen channelStartParentY und laneY(j)!
      // Daher darf i NICHT näher an Eltern liegen als j wenn ej.parentExitX strictly inside [minI, maxI]!
      if (ej.parentExitX > minI + 3 && ej.parentExitX < maxI - 3) {
        // j muss näher an Eltern (kleinerer Rang) als i => j -> i
        if (!adj[j].has(i)) {
          adj[j].add(i);
          indeg[i]++;
        }
      }

      // Regel 2: Kreuzt Horizontale von i den Kinder-Bus-Zugang von j?
      // Kinder-Bus-Stamm von j verläuft zwischen laneY(j) und busY(j).
      // Liegt i näher am Elternteil (kleinerer Rang), kreuzt i den Kinder-Stamm von j NICHT!
      if (ej.childTargetX > minI + 3 && ej.childTargetX < maxI - 3) {
        if (!adj[i].has(j)) {
          adj[i].add(j);
          indeg[j]++;
        }
      }
    }
  }

  // Kahn-Toposort + Interval-Packing (gleichzeitige disjunkte Intervalle dürfen selben Rang teilen!)
  const remaining = new Set<number>(Array.from({ length: n }, (_, k) => k));
  const topoOrder: number[] = [];

  while (remaining.size > 0) {
    const zeroNodes = Array.from(remaining).filter(k => indeg[k] === 0);
    let pick: number;
    if (zeroNodes.length > 0) {
      zeroNodes.sort((a, b) => edgesInChannel[a].parentExitX - edgesInChannel[b].parentExitX);
      pick = zeroNodes[0];
    } else {
      // Zyklus auflösen: kürzestes Intervall zuerst
      pick = Array.from(remaining).sort((a, b) => {
        const wa = Math.abs(edgesInChannel[a].childTargetX - edgesInChannel[a].parentExitX);
        const wb = Math.abs(edgesInChannel[b].childTargetX - edgesInChannel[b].parentExitX);
        return wa - wb;
      })[0];
    }
    remaining.delete(pick);
    topoOrder.push(pick);
    for (const next of adj[pick]) {
      indeg[next] = Math.max(0, indeg[next] - 1);
    }
  }

  // Packe nicht-überlappende Intervalle unter Respektierung der Topo-Präzedenz in Spuren
  for (const idx of topoOrder) {
    let minRankFromPred = 0;
    for (let pred = 0; pred < n; pred++) {
      if (adj[pred].has(idx) && rankMap.has(edgesInChannel[pred].edgeKey)) {
        const r = rankMap.get(edgesInChannel[pred].edgeKey)! + 1;
        if (r > minRankFromPred) minRankFromPred = r;
      }
    }

    const ei = edgesInChannel[idx];
    const minI = Math.min(ei.parentExitX, ei.childTargetX);
    const maxI = Math.max(ei.parentExitX, ei.childTargetX);

    let candidateRank = minRankFromPred;
    while (true) {
      let conflict = false;
      for (const [otherKey, otherRank] of rankMap.entries()) {
        if (otherRank !== candidateRank) continue;
        const oe = edgesInChannel.find(e => e.edgeKey === otherKey);
        if (!oe) continue;
        const minO = Math.min(oe.parentExitX, oe.childTargetX);
        const maxO = Math.max(oe.parentExitX, oe.childTargetX);
        if (overlap(minI, maxI, minO, maxO)) {
          conflict = true;
          break;
        }
      }
      if (!conflict) break;
      candidateRank++;
    }
    rankMap.set(ei.edgeKey, candidateRank);
  }

  return rankMap;
}

export function routeSceneEdges(
  bundle: DesignTreeBundle,
  layout: ContourLayoutOutput
): SceneConnectorEdge[] {
  const masterDoc = bundle.rootDocument;
  const direction: GrowthDirection = masterDoc.growthDirection || 'bottom_up';
  const routingStyle: RoutingStyle = masterDoc.routingStyle || 'orthogonal_bus';
  const enableBridges = Boolean(masterDoc.enableLineBridges) && routingStyle === 'orthogonal_bus';
  const d = direction === 'bottom_up' ? -1 : 1;

  const levelByNum = new Map<number, SceneLevelBand>();
  for (const lvl of layout.levels) {
    levelByNum.set(lvl.level, lvl);
  }

  const pendingEdges: PendingEdge[] = [];
  const edgesByChannel = new Map<string, PendingEdge[]>();

  for (const conn of layout.groupParentConnections) {
    const parentCard = layout.personCardById.get(conn.parentPersonId);
    if (!parentCard) continue;

    const childCards = conn.group.memberIds
      .map(id => layout.personCardById.get(id))
      .filter((c): c is ScenePersonCard => Boolean(c))
      .filter(
        c =>
          c.groupKey === conn.group.groupKey ||
          Boolean(conn.ownerDoc.subtreeMounts[c.personId])
      );
    if (childCards.length === 0) continue;

    const parentGroup = layout.groupByKey.get(parentCard.groupKey);
    const childGroup = layout.groupByKey.get(conn.group.groupKey) || layout.groupByKey.get(childCards[0].groupKey);
    const edgeKey = `${conn.parentPersonId}-->${conn.group.groupKey}`;

    const waypoint =
      conn.ownerDoc.edgeWaypoints[edgeKey] || masterDoc.edgeWaypoints[edgeKey];

    // 1. Eltern-Ausgang berechnen (inkl. Durchführungs-Kanal bei gewrappter innerer Elternreihe)
    const baseParentPortX = parentCard.x + parentCard.width / 2;
    const parentPortY = d === -1 ? parentCard.y : parentCard.y + parentCard.height;

    let parentExitX = baseParentPortX;
    let parentExitY = parentPortY;
    let parentPrePath = '';
    let isFeedThrough = false;

    if (parentGroup && parentGroup.rowCount > 1 && parentCard.rowIndex < parentGroup.rowCount - 1) {
      isFeedThrough = true;
      const chCenter =
        parentGroup.channelCentersX[parentCard.colIndex] ??
        parentCard.x + parentCard.width + 12;
      const feedX = Math.round(chCenter + 4 + (waypoint?.verticalChannelDeltaX || 0));
      const stubY = parentPortY + d * 8;
      const exitY = d === -1 ? parentGroup.y - 6 : parentGroup.y + parentGroup.height + 6;
      parentPrePath = `M ${baseParentPortX} ${parentPortY} L ${baseParentPortX} ${stubY} L ${feedX} ${stubY} L ${feedX} ${exitY}`;
      parentExitX = feedX;
      parentExitY = exitY;
    } else if (waypoint?.verticalChannelDeltaX) {
      const shiftedX = Math.round(baseParentPortX + waypoint.verticalChannelDeltaX);
      const stubY = parentPortY + d * 6;
      parentPrePath = `M ${baseParentPortX} ${parentPortY} L ${baseParentPortX} ${stubY} L ${shiftedX} ${stubY}`;
      parentExitX = shiftedX;
      parentExitY = stubY;
    }

    // 2. Kinder-Sammelbus & Zweig-Drops (inkl. Durchführungs-Kanal für innere Reihen r > 0)
    const childLevel = childCards[0].level;
    const parentLevel = parentCard.level;

    // Vorderste Reihe (rowIndex === 0) liegt bei bottom_up UNTEN, bei top_down OBEN
    const childEdgeFaces: number[] = childCards.map(c =>
      d === -1 ? c.y + c.height : c.y
    );
    const busReferenceY =
      d === -1 ? Math.max(...childEdgeFaces) : Math.min(...childEdgeFaces);
    const busY = Math.round(busReferenceY - d * 14);

    const dropPoints: { x: number; y: number; path: string }[] = [];
    const childArrows: { x: number; y: number; points: string }[] = [];
    for (const c of childCards) {
      const cx = c.x + c.width / 2;
      const cy = d === -1 ? c.y + c.height : c.y;
      const tipStopY = cy - d * 3;
      const arrowBaseY = cy - d * 7;
      childArrows.push({
        x: cx,
        y: cy,
        points: `${cx},${cy} ${cx - 4},${arrowBaseY} ${cx + 4},${arrowBaseY}`,
      });
      if (childGroup && childGroup.rowCount > 1 && c.rowIndex > 0) {
        isFeedThrough = true;
        const chCenter =
          childGroup.channelCentersX[c.colIndex] ?? c.x + c.width + 12;
        const feedX = Math.round(chCenter - 4 - Math.min(2, c.rowIndex - 1) * 3);
        const stubY = cy - d * 9;
        dropPoints.push({
          x: feedX,
          y: busY,
          path: `M ${feedX} ${busY} L ${feedX} ${stubY} L ${cx} ${stubY} L ${cx} ${tipStopY}`,
        });
      } else {
        dropPoints.push({
          x: cx,
          y: busY,
          path: `M ${cx} ${busY} L ${cx} ${tipStopY}`,
        });
      }
    }

    const xs = dropPoints.map(dp => dp.x);
    const minBranchX = Math.min(...xs);
    const maxBranchX = Math.max(...xs);
    const childTargetX =
      dropPoints.length === 1 ? dropPoints[0].x : (minBranchX + maxBranchX) / 2;

    let branchPath = '';
    if (dropPoints.length > 1) {
      branchPath += `M ${minBranchX} ${busY} L ${maxBranchX} ${busY} `;
    }
    for (const dp of dropPoints) {
      branchPath += `${dp.path} `;
    }

    const pBand = levelByNum.get(parentLevel);
    const cBand = levelByNum.get(childLevel);
    const chStartY = pBand ? (d === -1 ? pBand.topY : pBand.bottomY) : parentExitY;
    const chEndY = cBand ? (d === -1 ? cBand.bottomY : cBand.topY) : busY;
    const channelKey = `${parentLevel}->${childLevel}`;

    const pending: PendingEdge = {
      edgeKey,
      ownerDocId: conn.ownerDoc.id,
      parentCard,
      parentGroup,
      childCards,
      childGroup,
      marriageIndex: conn.group.marriageIndex,
      marriageLabel: conn.group.marriageLabel,
      isSubtreeEdge: conn.isSubtreeEdge,
      waypoint,
      parentExitX,
      parentExitY,
      parentPrePath,
      isFeedThrough,
      childTargetX,
      busY,
      childBranchPath: branchPath.trim(),
      childDropXs: xs,
      childArrows,
      channelKey,
      channelStartParentY: chStartY,
      channelEndChildY: chEndY,
      laneRank: 0,
      laneY: (parentExitY + busY) / 2,
    };

    pendingEdges.push(pending);
    if (!edgesByChannel.has(channelKey)) edgesByChannel.set(channelKey, []);
    edgesByChannel.get(channelKey)!.push(pending);
  }

  // 3. Pro Kanal kreuzungsfreie Sub-Spuren zuweisen (gespiegelt über d = -1 vs +1!)
  for (const [, chEdges] of edgesByChannel.entries()) {
    const rankMap = assignCrossingFreeLanes(chEdges);
    const maxRank = Math.max(0, ...Array.from(rankMap.values()));

    for (const pe of chEdges) {
      const rank = rankMap.get(pe.edgeKey) ?? 0;
      pe.laneRank = rank;

      const signedSpan = (pe.busY - pe.parentExitY) * d;
      const safeMargin = 10;
      const offsetDelta = pe.waypoint?.laneOffsetDelta || 0;

      if (signedSpan >= 24) {
        const usableSpan = Math.max(16, signedSpan - safeMargin * 2);
        const step = usableSpan / (maxRank + 2);
        const baseLaneY = pe.parentExitY + d * (safeMargin + (rank + 1) * step);
        const clampedOffset = Math.max(-usableSpan * 0.45, Math.min(usableSpan * 0.45, offsetDelta));
        pe.laneY = Math.round(baseLaneY + clampedOffset);
      } else {
        pe.laneY = Math.round((pe.parentExitY + pe.busY) / 2 + offsetDelta);
      }
    }
  }

  // 4. Vertikale Segmente anderer Kanten für Linienbrücken sammeln
  const verticalSegments: { edgeKey: string; x: number; yMin: number; yMax: number }[] = [];
  if (enableBridges) {
    for (const pe of pendingEdges) {
      verticalSegments.push({
        edgeKey: pe.edgeKey,
        x: pe.parentExitX,
        yMin: Math.min(pe.parentExitY, pe.laneY),
        yMax: Math.max(pe.parentExitY, pe.laneY),
      });
      verticalSegments.push({
        edgeKey: pe.edgeKey,
        x: pe.childTargetX,
        yMin: Math.min(pe.laneY, pe.busY),
        yMax: Math.max(pe.laneY, pe.busY),
      });
    }
  }

  // 5. Finale SVG-Pfade inkl. Brücken oder Organischen Kurven erzeugen
  const BRIDGE_RADIUS = 5;
  return pendingEdges.map(pe => {
    const parentPortY = d === -1 ? pe.parentCard.y : pe.parentCard.y + pe.parentCard.height;
    const parentPortX = pe.parentCard.x + pe.parentCard.width / 2;

    let trunkPath = '';
    const bridgeArcs: SceneBridgeArc[] = [];

    if (routingStyle === 'organic_bezier') {
      const midY = (pe.parentExitY + pe.busY) / 2;
      const prefix = pe.parentPrePath ? `${pe.parentPrePath} ` : `M ${pe.parentExitX} ${pe.parentExitY} `;
      trunkPath = `${prefix}C ${pe.parentExitX} ${midY}, ${pe.childTargetX} ${midY}, ${pe.childTargetX} ${pe.busY}`;
    } else {
      const prefix = pe.parentPrePath ? `${pe.parentPrePath} ` : `M ${pe.parentExitX} ${pe.parentExitY} `;
      const xStart = pe.parentExitX;
      const xEnd = pe.childTargetX;
      let hSegPath = '';

      if (Math.abs(xEnd - xStart) < 1) {
        hSegPath = `L ${xEnd} ${pe.busY}`;
      } else if (!enableBridges) {
        hSegPath = `L ${xStart} ${pe.laneY} L ${xEnd} ${pe.laneY} L ${xEnd} ${pe.busY}`;
      } else {
        const minX = Math.min(xStart, xEnd);
        const maxX = Math.max(xStart, xEnd);
        const crossings: number[] = [];
        for (const vs of verticalSegments) {
          if (vs.edgeKey === pe.edgeKey) continue;
          if (vs.x > minX + 6 && vs.x < maxX - 6 && pe.laneY > vs.yMin + 3 && pe.laneY < vs.yMax - 3) {
            if (!crossings.some(cx => Math.abs(cx - vs.x) < BRIDGE_RADIUS * 2.2)) {
              crossings.push(vs.x);
            }
          }
        }
        crossings.sort((a, b) => (xEnd >= xStart ? a - b : b - a));

        hSegPath = `L ${xStart} ${pe.laneY}`;
        const dirSign = xEnd >= xStart ? 1 : -1;
        for (const cx of crossings) {
          const bStart = cx - dirSign * BRIDGE_RADIUS;
          const bEnd = cx + dirSign * BRIDGE_RADIUS;
          // Kleiner Bogen nach oben (kleineres Y) über die kreuzende vertikale Linie
          const sweepFlag = dirSign === 1 ? 1 : 0;
          hSegPath += ` L ${bStart} ${pe.laneY} A ${BRIDGE_RADIUS} ${BRIDGE_RADIUS} 0 0 ${sweepFlag} ${bEnd} ${pe.laneY}`;
          bridgeArcs.push({
            cx,
            cy: pe.laneY,
            radius: BRIDGE_RADIUS,
            orientation: 'horizontal',
            sweepUp: true,
          });
        }
        hSegPath += ` L ${xEnd} ${pe.laneY} L ${xEnd} ${pe.busY}`;
      }

      trunkPath = `${prefix}${hSegPath}`;
    }

    const svgPath = `${trunkPath} ${pe.childBranchPath}`.trim();
    const marriageBadgePos = pe.marriageLabel
      ? {
          x: Math.round((pe.childTargetX + pe.parentExitX) / 2),
          y: Math.round(pe.busY - d * 6),
        }
      : undefined;

    const anchorSweep = d === -1 ? 1 : 0;
    const parentAnchor = {
      x: parentPortX,
      y: parentPortY,
      d: `M ${parentPortX - 5} ${parentPortY} A 5 5 0 0 ${anchorSweep} ${parentPortX + 5} ${parentPortY} Z`,
    };

    return {
      edgeKey: pe.edgeKey,
      ownerDocumentId: pe.ownerDocId,
      parentPersonId: pe.parentCard.personId,
      targetGroupKey: pe.childGroup?.groupKey || pe.edgeKey,
      parentLevel: pe.parentCard.level,
      childLevel: pe.childCards[0].level,
      marriageIndex: pe.marriageIndex,
      marriageBadgeText: pe.marriageLabel,
      marriageBadgePos,
      svgPath,
      trunkPath,
      branchPath: pe.childBranchPath,
      bridgeArcs,
      trunkX1: pe.parentExitX,
      trunkX2: pe.childTargetX,
      trunkY: pe.laneY,
      parentPortX,
      parentPortY,
      parentAnchor,
      childArrows: pe.childArrows,
      groupCenterX: pe.childTargetX,
      busY: pe.busY,
      isSubtreeEdge: pe.isSubtreeEdge,
      isFeedThrough: pe.isFeedThrough,
    };
  });
}
