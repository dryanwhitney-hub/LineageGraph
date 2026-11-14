import type { GrowthDirection } from './sceneTypes';

export const STANDARD_CARD_GAP_X = 14;
export const FEED_THROUGH_CHANNEL_WIDTH = 24;
export const WRAPPED_ROW_GAP_Y = 26;

export interface WrappedMemberSlot {
  personId: string;
  rowIndex: number; // Logische chronologische Reihe (0 = erste Reihe, am Eltern-Bus)
  colIndex: number;
  visualRowOrder: number; // Visuelle Reihe von oben nach unten (0 = oberste Reihe im Block)
  localX: number;
  localY: number;
  width: number;
  height: number;
  /** X-Koordinate des benachbarten Durchführungs-Kanals (nur bei Wrapping relevant) */
  feedChannelX: number;
}

export interface WrappedGroupBlock {
  width: number;
  height: number;
  rowCount: number;
  columnCount: number;
  isWrapped: boolean;
  /** Visuelle Reihen-Top-Offsets von oben nach unten (relativ zur Block-Oberkante) */
  rowTopsLocalY: number[];
  rowHeights: number[];
  colCentersLocalX: number[];
  channelCentersLocalX: number[];
  slots: WrappedMemberSlot[];
}

export function layoutWrappedGroupBlock(
  memberIds: string[],
  cardWidth: number,
  cardHeightsById: Map<string, number>,
  maxColumnsPerRow: number | null,
  growthDirection: GrowthDirection
): WrappedGroupBlock {
  const n = memberIds.length;
  if (n === 0) {
    return {
      width: cardWidth,
      height: 0,
      rowCount: 1,
      columnCount: 1,
      isWrapped: false,
      rowTopsLocalY: [0],
      rowHeights: [0],
      colCentersLocalX: [cardWidth / 2],
      channelCentersLocalX: [],
      slots: [],
    };
  }

  const effectiveMaxCols =
    maxColumnsPerRow && maxColumnsPerRow > 0 ? Math.min(n, maxColumnsPerRow) : n;
  const isWrapped = effectiveMaxCols < n;
  const colGap = isWrapped ? FEED_THROUGH_CHANNEL_WIDTH : STANDARD_CARD_GAP_X;
  const rowCount = Math.ceil(n / effectiveMaxCols);
  const columnCount = Math.min(n, effectiveMaxCols);

  // Spalten-Positionen & Durchführungs-Kanäle berechnen
  const colLefts: number[] = [];
  const colCentersLocalX: number[] = [];
  const channelCentersLocalX: number[] = [];

  for (let c = 0; c < columnCount; c++) {
    const left = c * (cardWidth + colGap);
    colLefts.push(left);
    colCentersLocalX.push(left + cardWidth / 2);
    if (c < columnCount - 1) {
      channelCentersLocalX.push(left + cardWidth + colGap / 2);
    }
  }
  // Zusatz-Kanal rechts außen für die letzte Spalte bei Wrapping
  if (isWrapped) {
    const lastRight = (columnCount - 1) * (cardWidth + colGap) + cardWidth;
    channelCentersLocalX.push(lastRight + colGap / 2);
  }

  const totalWidth =
    columnCount * cardWidth +
    Math.max(0, columnCount - 1) * colGap +
    (isWrapped ? Math.round(colGap * 0.5) : 0);

  // Höhe jeder logischen Reihe r = max(Kachelhöhe in Reihe r)
  const logicalRowHeights: number[] = new Array(rowCount).fill(0);
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / effectiveMaxCols);
    const h = cardHeightsById.get(memberIds[i]) ?? 60;
    if (h > logicalRowHeights[r]) logicalRowHeights[r] = h;
  }

  // Visuelle Reihen-Anordnung je nach Wuchsrichtung:
  // - bottom_up: logische Reihe 0 [1..K] liegt UNTEN (nahe Eltern-Bus), Reihe R-1 [..N] OBEN.
  // - top_down:  logische Reihe 0 [1..K] liegt OBEN (nahe Eltern-Bus), Reihe R-1 [..N] UNTEN.
  const logicalToVisualOrder: number[] = new Array(rowCount);
  const visualOrderToLogical: number[] = new Array(rowCount);
  for (let r = 0; r < rowCount; r++) {
    const visualIdx = growthDirection === 'bottom_up' ? rowCount - 1 - r : r;
    logicalToVisualOrder[r] = visualIdx;
    visualOrderToLogical[visualIdx] = r;
  }

  const rowTopsLocalY: number[] = new Array(rowCount).fill(0);
  const rowHeights: number[] = new Array(rowCount).fill(0);
  let cursorY = 0;
  for (let v = 0; v < rowCount; v++) {
    const logicalR = visualOrderToLogical[v];
    const rH = logicalRowHeights[logicalR];
    rowTopsLocalY[logicalR] = cursorY;
    rowHeights[logicalR] = rH;
    cursorY += rH;
    if (v < rowCount - 1) {
      cursorY += WRAPPED_ROW_GAP_Y;
    }
  }
  const totalHeight = cursorY;

  const slots: WrappedMemberSlot[] = memberIds.map((pid, idx) => {
    const rowIndex = Math.floor(idx / effectiveMaxCols);
    const colIndex = idx % effectiveMaxCols;
    const width = cardWidth;
    const height = cardHeightsById.get(pid) ?? 60;
    const localX = colLefts[colIndex];
    // Top-Aligned innerhalb seiner Reihe!
    const localY = rowTopsLocalY[rowIndex];

    // Kanal rechts neben dieser Spalte (oder bei letzter Spalte der Außenkanal rechts)
    const feedChannelX =
      colIndex < channelCentersLocalX.length
        ? channelCentersLocalX[colIndex]
        : localX + width + colGap / 2;

    return {
      personId: pid,
      rowIndex,
      colIndex,
      visualRowOrder: logicalToVisualOrder[rowIndex],
      localX,
      localY,
      width,
      height,
      feedChannelX,
    };
  });

  return {
    width: totalWidth,
    height: totalHeight,
    rowCount,
    columnCount,
    isWrapped,
    rowTopsLocalY,
    rowHeights,
    colCentersLocalX,
    channelCentersLocalX,
    slots,
  };
}
