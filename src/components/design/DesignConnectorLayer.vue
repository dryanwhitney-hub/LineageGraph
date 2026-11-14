<script setup lang="ts">
import { computed } from 'vue';
import type { DesignSceneGraph, SceneConnectorEdge } from '../../domain/design/sceneTypes';

const props = defineProps<{
  edges: SceneConnectorEdge[];
  bounds?: DesignSceneGraph['bounds'];
  selectedEdgeKey: string;
  highlightedPersonIds?: Set<string>;
  dragEdgeKey?: string;
  dragDeltaX?: number;
  dragDeltaY?: number;
}>();

const SVG_MARGIN = 2400;
const svgLeft = computed(() => Math.floor((props.bounds?.minX ?? 0) - SVG_MARGIN));
const svgTop = computed(() => Math.floor((props.bounds?.minY ?? 0) - SVG_MARGIN));
const svgWidth = computed(() => Math.max(4800, Math.ceil((props.bounds?.width ?? 0) + SVG_MARGIN * 2)));
const svgHeight = computed(() => Math.max(4800, Math.ceil((props.bounds?.height ?? 0) + SVG_MARGIN * 2)));

const emit = defineEmits<{
  (e: 'select-edge', edgeKey: string): void;
  (e: 'waypoint-drag-start', edge: SceneConnectorEdge, axis: 'y' | 'x', event: MouseEvent): void;
  (e: 'reset-waypoint', edgeKey: string): void;
}>();

function isEdgeHighlighted(edge: SceneConnectorEdge, highlighted?: Set<string>): boolean {
  return Boolean(highlighted && highlighted.has(edge.parentPersonId));
}
</script>

<template>
  <svg
    class="design-edges-svg"
    :style="{
      left: `${svgLeft}px`,
      top: `${svgTop}px`,
      width: `${svgWidth}px`,
      height: `${svgHeight}px`,
    }"
    :width="svgWidth"
    :height="svgHeight"
    :viewBox="`${svgLeft} ${svgTop} ${svgWidth} ${svgHeight}`"
  >
    <g
      v-for="edge in edges"
      :key="edge.edgeKey"
      class="design-edge-group"
    >
      <!-- Sichtbare Verbindungslinie -->
      <path
        :d="edge.svgPath"
        class="design-edge-line"
        :class="{
          'is-subtree': edge.isSubtreeEdge,
          'is-highlighted': isEdgeHighlighted(edge, highlightedPersonIds),
          'is-selected': edge.edgeKey === selectedEdgeKey,
        }"
      />

      <!-- Anker-Halbkreis direkt an der Eltern-Kachelkante -->
      <path
        v-if="edge.parentAnchor"
        :d="edge.parentAnchor.d"
        class="design-edge-anchor"
        :class="{
          'is-subtree': edge.isSubtreeEdge,
          'is-highlighted': isEdgeHighlighted(edge, highlightedPersonIds),
          'is-selected': edge.edgeKey === selectedEdgeKey,
        }"
      />

      <!-- Eingehende Pfeilspitzen direkt an den Kind-Kachelkanten -->
      <polygon
        v-for="(arrow, idx) in edge.childArrows || []"
        :key="idx"
        :points="arrow.points"
        class="design-edge-arrow"
        :class="{
          'is-subtree': edge.isSubtreeEdge,
          'is-highlighted': isEdgeHighlighted(edge, highlightedPersonIds),
          'is-selected': edge.edgeKey === selectedEdgeKey,
        }"
      />

      <!-- Unsichtbare Trefferfläche für Selektion & Doppelklick-Reset -->
      <path
        :d="edge.svgPath"
        class="design-edge-hit"
        @mousedown.stop
        @click.stop="emit('select-edge', edge.edgeKey)"
        @dblclick.stop="emit('reset-waypoint', edge.edgeKey)"
      />

      <!-- Ehe-Verbindungs-Badge [I], [II], ... bei geteilten Kindgruppen -->
      <g
        v-if="edge.marriageBadgeText && edge.marriageBadgePos"
        class="design-marriage-badge"
      >
        <rect
          :x="edge.marriageBadgePos.x - 13"
          :y="edge.marriageBadgePos.y - 8"
          width="26"
          height="16"
          rx="8"
          class="badge-bg"
        />
        <text
          :x="edge.marriageBadgePos.x"
          :y="edge.marriageBadgePos.y + 3.5"
          text-anchor="middle"
          class="badge-text"
        >
          {{ edge.marriageBadgeText }}
        </text>
      </g>

      <!-- Interaktive Wegpunkt-Griffe für die selektierte Kante -->
      <template v-if="edge.edgeKey === selectedEdgeKey">
        <!-- Vertikaler Sammelbalken-Versatz (Bus Y) -->
        <g
          class="waypoint-handle design-edge-hit"
          @mousedown.stop="e => emit('waypoint-drag-start', edge, 'y', e)"
          @click.stop
        >
          <line
            :x1="edge.trunkX1"
            :y1="edge.trunkY + (dragEdgeKey === edge.edgeKey ? (dragDeltaY || 0) : 0)"
            :x2="edge.trunkX2"
            :y2="edge.trunkY + (dragEdgeKey === edge.edgeKey ? (dragDeltaY || 0) : 0)"
            class="waypoint-guide-line"
          />
          <rect
            :x="(edge.trunkX1 + edge.trunkX2) / 2 - 11"
            :y="edge.trunkY + (dragEdgeKey === edge.edgeKey ? (dragDeltaY || 0) : 0) - 7"
            width="22"
            height="14"
            rx="7"
            class="waypoint-pill ns"
          />
          <text
            :x="(edge.trunkX1 + edge.trunkX2) / 2"
            :y="edge.trunkY + (dragEdgeKey === edge.edgeKey ? (dragDeltaY || 0) : 0) + 3"
            text-anchor="middle"
            class="waypoint-icon"
          >
            ↕
          </text>
        </g>

        <!-- Horizontaler Vertikalkanal-Versatz (X-Wegpunkt) -->
        <g
          class="waypoint-handle design-edge-hit"
          @mousedown.stop="e => emit('waypoint-drag-start', edge, 'x', e)"
          @click.stop
        >
          <rect
            :x="edge.parentPortX + (dragEdgeKey === edge.edgeKey ? (dragDeltaX || 0) : 0) - 7"
            :y="(edge.parentPortY + edge.trunkY) / 2 - 7"
            width="14"
            height="14"
            rx="7"
            class="waypoint-pill ew"
          />
          <text
            :x="edge.parentPortX + (dragEdgeKey === edge.edgeKey ? (dragDeltaX || 0) : 0)"
            :y="(edge.parentPortY + edge.trunkY) / 2 + 3"
            text-anchor="middle"
            class="waypoint-icon"
          >
            ↔
          </text>
        </g>
      </template>
    </g>
  </svg>
</template>

<style scoped>
.design-edges-svg {
  position: absolute;
  z-index: 6;
  pointer-events: none;
  overflow: visible;
}

.design-edge-anchor,
.design-edge-arrow {
  fill: #334155;
  pointer-events: none;
  transition: fill 0.12s ease;
}

.design-edge-anchor.is-subtree,
.design-edge-arrow.is-subtree {
  fill: #7c3aed;
}

.design-edge-anchor.is-highlighted,
.design-edge-arrow.is-highlighted {
  fill: #ea580c;
}

.design-edge-anchor.is-selected,
.design-edge-arrow.is-selected {
  fill: #d97706;
}

.design-edge-line {
  fill: none;
  stroke: #334155;
  stroke-width: 1.8px;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: stroke 0.12s ease, stroke-width 0.12s ease;
}

.design-edge-line.is-subtree {
  stroke: #7c3aed;
}

.design-edge-line.is-highlighted {
  stroke: #ea580c;
  stroke-width: 2.8px;
}

.design-edge-line.is-selected {
  stroke: #d97706;
  stroke-width: 3px;
}

.design-edge-hit {
  fill: none;
  stroke: transparent;
  stroke-width: 12px;
  pointer-events: stroke;
  cursor: pointer;
}

.badge-bg {
  fill: #ffffff;
  stroke: #475569;
  stroke-width: 1.2px;
}

.badge-text {
  font-size: 9.5px;
  font-weight: 700;
  fill: #1e293b;
}

.waypoint-handle {
  pointer-events: all;
}

.waypoint-guide-line {
  stroke: #f59e0b;
  stroke-width: 1.5px;
  stroke-dasharray: 4 3;
  opacity: 0.75;
}

.waypoint-pill {
  fill: #fef3c7;
  stroke: #d97706;
  stroke-width: 1.4px;
}

.waypoint-pill.ns {
  cursor: ns-resize;
}

.waypoint-pill.ew {
  cursor: ew-resize;
}

.waypoint-icon {
  font-size: 9.5px;
  font-weight: 800;
  fill: #92400e;
  pointer-events: none;
}
</style>
