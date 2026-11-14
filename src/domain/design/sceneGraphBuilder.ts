import type { Person } from '../../composables/usePersons';
import { computeSynchronizedContourLayout } from './contourLayoutEngine';
import { routeSceneEdges } from './edgeRouter';
import type { DesignSceneGraph, DesignTreeBundle } from './sceneTypes';

export function buildDesignSceneGraph(
  bundle: DesignTreeBundle,
  persons: Person[],
  locale: string = 'de'
): DesignSceneGraph {
  const layout = computeSynchronizedContourLayout(bundle, persons, locale);
  const edges = routeSceneEdges(bundle, layout);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const c of layout.cards) {
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.x + c.width > maxX) maxX = c.x + c.width;
    if (c.y + c.height > maxY) maxY = c.y + c.height;
  }

  for (const f of layout.subtreeFrames) {
    if (f.x < minX) minX = f.x;
    if (f.y < minY) minY = f.y;
    if (f.x + f.width > maxX) maxX = f.x + f.width;
    if (f.y + f.height > maxY) maxY = f.y + f.height;
  }

  for (const bg of layout.backgrounds) {
    if (bg.x < minX) minX = bg.x;
    if (bg.y < minY) minY = bg.y;
    if (bg.x + bg.width > maxX) maxX = bg.x + bg.width;
    if (bg.y + bg.height > maxY) maxY = bg.y + bg.height;
  }

  for (const l of layout.levels) {
    if (l.topY < minY) minY = l.topY;
    if (l.bottomY > maxY) maxY = l.bottomY;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    minX = 0;
    minY = 0;
    maxX = 800;
    maxY = 600;
  }

  const PAD = 60;
  const paddedMinX = Math.floor(minX - PAD);
  const paddedMinY = Math.floor(minY - PAD);
  const paddedMaxX = Math.ceil(maxX + PAD);
  const paddedMaxY = Math.ceil(maxY + PAD);

  const masterDoc = bundle.rootDocument;
  return {
    documentId: masterDoc.id,
    documentName: masterDoc.name,
    rootPersonId: masterDoc.rootPersonId,
    growthDirection: masterDoc.growthDirection,
    lineagePolicy: masterDoc.lineagePolicy,
    routingStyle: masterDoc.routingStyle,
    enableLineBridges: masterDoc.enableLineBridges,
    levels: layout.levels,
    backgrounds: layout.backgrounds,
    subtreeFrames: layout.subtreeFrames,
    groups: layout.groups,
    cards: layout.cards,
    edges,
    bounds: {
      minX: paddedMinX,
      minY: paddedMinY,
      maxX: paddedMaxX,
      maxY: paddedMaxY,
      width: Math.max(400, paddedMaxX - paddedMinX),
      height: Math.max(300, paddedMaxY - paddedMinY),
    },
  };
}
