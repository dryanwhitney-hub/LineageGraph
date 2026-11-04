import { ref, type Ref } from 'vue';
import type { DesignSiblingGroup } from './useDesignHistory';

export interface BoundingBoxRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface BranchWidthBounds {
  minX: number;
  maxX: number;
  barY: number;
  corridorTopY: number;
}

export interface UseDesignNavigationOptions {
  siblingGroups: Ref<DesignSiblingGroup[]>;
  activeDesignPersonId: Ref<string>;
  getCanvasHeight: () => number;
  getGroupLayouts: () => BoundingBoxRect[];
  getRenderedBranchWidths: () => BranchWidthBounds[];
  isBgDragging: () => boolean;
  closeBgPopover: () => void;
  onClearSelectionEmit: () => void;
}

export function useDesignNavigation(options: UseDesignNavigationOptions) {
  const {
    siblingGroups,
    activeDesignPersonId,
    getCanvasHeight,
    getGroupLayouts,
    getRenderedBranchWidths,
    isBgDragging,
    closeBgPopover,
    onClearSelectionEmit,
  } = options;

  const viewportRef = ref<HTMLElement | null>(null);
  const pan = ref({ x: 0, y: 0 });
  const zoom = ref(1);
  const isPanning = ref(false);

  let panStart = { x: 0, y: 0 };
  let didPanCanvas = false;
  let panStartClient = { x: 0, y: 0 };
  let panRafId: number | null = null;
  let pendingPanEvent: MouseEvent | null = null;

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
    const cHeight = getCanvasHeight();
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

    const groupLayouts = getGroupLayouts();
    if (groupLayouts.length === 0) {
      centerOnOrigin();
      return;
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    groupLayouts.forEach(gl => {
      if (gl.left < minX) minX = gl.left;
      if (gl.right > maxX) maxX = gl.right;
      if (gl.top < minY) minY = gl.top;
      if (gl.bottom > maxY) maxY = gl.bottom;
    });

    const renderedBranchWidths = getRenderedBranchWidths();
    renderedBranchWidths.forEach(bw => {
      if (bw.minX < minX) minX = bw.minX;
      if (bw.maxX > maxX) maxX = bw.maxX;
      if (bw.barY < minY) minY = bw.barY;
      if (bw.corridorTopY < minY) minY = bw.corridorTopY;
    });

    if (
      !Number.isFinite(minX) ||
      !Number.isFinite(maxX) ||
      !Number.isFinite(minY) ||
      !Number.isFinite(maxY)
    ) {
      centerOnOrigin();
      return;
    }

    const padX = 60;
    const padY = 60;
    const contentW = Math.max(100, maxX - minX + padX * 2);
    const contentH = Math.max(100, maxY - minY + padY * 2);

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

  function startCanvasPan(e: MouseEvent) {
    if (e.button !== 0) return;
    isPanning.value = true;
    didPanCanvas = false;
    panStartClient = { x: e.clientX, y: e.clientY };
    panStart = { x: e.clientX - pan.value.x, y: e.clientY - pan.value.y };
  }

  function handleCanvasPanMove(e: MouseEvent) {
    if (!isPanning.value) return;
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
    if (!isPanning.value) return;
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
    isPanning.value = false;
  }

  // Selektion und Highlights aufheben
  function clearSelection() {
    activeDesignPersonId.value = '';
    onClearSelectionEmit();
  }

  // Klick auf den Viewport / Hintergrund außerhalb von Personeneinträgen und Funktionsbereichen
  function onViewportClick(e: MouseEvent) {
    if (didPanCanvas) {
      didPanCanvas = false;
      return;
    }
    const target = e.target as HTMLElement | null;
    if (!target) return;

    if (
      !target.closest('.bg-tool-wrapper') &&
      !target.closest('.bg-image-popover') &&
      !isBgDragging()
    ) {
      closeBgPopover();
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

  return {
    viewportRef,
    pan,
    zoom,
    isPanning,
    centerOnOrigin,
    fitToScreen,
    startCanvasPan,
    handleCanvasPanMove,
    onCanvasPan,
    stopCanvasPan,
    clearSelection,
    onViewportClick,
    handleWheelZoom,
    zoomStepCenter,
  };
}
