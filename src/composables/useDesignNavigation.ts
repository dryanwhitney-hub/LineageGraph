import { ref, type Ref } from 'vue';
import type { DesignSceneGraph } from '../domain/design/sceneTypes';

export interface UseDesignNavigationOptions {
  sceneGraph: Ref<DesignSceneGraph | null>;
  activeDesignPersonId: Ref<string>;
  isBgDragging: () => boolean;
  closeBgPopover: () => void;
  onClearSelectionEmit: () => void;
}

export function useDesignNavigation(options: UseDesignNavigationOptions) {
  const {
    sceneGraph,
    activeDesignPersonId,
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
    const sg = sceneGraph.value;
    const rootCard =
      sg?.cards.find(c => c.personId === sg.rootPersonId) || sg?.cards[0];
    if (!vp || !sg || !rootCard) {
      pan.value = { x: 0, y: 0 };
      zoom.value = 1;
      return;
    }

    const vpW = vp.clientWidth || 1000;
    const vpH = vp.clientHeight || 650;
    zoom.value = 1;

    const rootCenterX = rootCard.x + rootCard.width / 2;
    if (sg.growthDirection === 'bottom_up') {
      pan.value = {
        x: Math.round(vpW / 2 - rootCenterX),
        y: Math.round(vpH - (rootCard.y + rootCard.height) - 48),
      };
    } else {
      pan.value = {
        x: Math.round(vpW / 2 - rootCenterX),
        y: Math.round(48 - rootCard.y),
      };
    }
  }

  function fitToScreen() {
    const vp = viewportRef.value;
    const sg = sceneGraph.value;
    if (!vp || !sg || sg.cards.length === 0) {
      centerOnOrigin();
      return;
    }

    const vpW = vp.clientWidth || 1000;
    const vpH = vp.clientHeight || 650;
    const { minX, maxX, minY, maxY } = sg.bounds;

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
    const targetZoom = Math.max(0.08, Math.min(2.0, Math.min(scaleX, scaleY)));

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

  function clearSelection() {
    activeDesignPersonId.value = '';
    onClearSelectionEmit();
  }

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

    if (
      target.closest('.design-person-card') ||
      target.closest('.sibling-group-container') ||
      target.closest('.design-subtree-frame') ||
      target.closest('.design-edge-hit') ||
      target.closest('.design-breadcrumbs') ||
      target.closest('.design-toolbar') ||
      target.closest('.design-zoom-controls') ||
      target.closest('.group-floating-controls') ||
      target.closest('.design-proband-prompt') ||
      target.closest('.design-modal-card')
    ) {
      return;
    }

    clearSelection();
  }

  function handleWheelZoom(e: WheelEvent) {
    e.preventDefault();
    const vp = viewportRef.value;
    if (!vp) return;

    const rect = vp.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const zoomFactor = e.deltaY < 0 ? 1.09 : 0.91;
    const currentZoom = zoom.value;
    const nextZoom = Math.max(0.08, Math.min(2.5, currentZoom * zoomFactor));

    const canvasX = (mouseX - pan.value.x) / currentZoom;
    const canvasY = (mouseY - pan.value.y) / currentZoom;

    pan.value = {
      x: Math.round(mouseX - canvasX * nextZoom),
      y: Math.round(mouseY - canvasY * nextZoom),
    };
    zoom.value = Math.round(nextZoom * 1000) / 1000;
  }

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

  function focusCardByPersonId(personId: string, rightDrawerOpen: boolean = false): boolean {
    const vp = viewportRef.value;
    const sg = sceneGraph.value;
    const card = sg?.cards.find(c => c.personId === personId);
    if (!vp || !card) return false;

    const vpW = vp.clientWidth || 1000;
    const vpH = vp.clientHeight || 650;
    const drawerWidth = rightDrawerOpen && vpW - 390 > 320 ? 390 : 0;
    const visibleCenterX = (vpW - drawerWidth) / 2;

    if (zoom.value < 0.65) {
      zoom.value = 0.85;
    }

    const cardCenterX = card.x + card.width / 2;
    const cardCenterY = card.y + card.height / 2;
    pan.value = {
      x: Math.round(visibleCenterX - cardCenterX * zoom.value),
      y: Math.round(vpH / 2 - cardCenterY * zoom.value),
    };
    return true;
  }

  return {
    viewportRef,
    pan,
    zoom,
    isPanning,
    centerOnOrigin,
    fitToScreen,
    focusCardByPersonId,
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
