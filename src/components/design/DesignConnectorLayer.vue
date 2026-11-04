<script setup lang="ts">
import type { EdgeGeometry } from '../../composables/useDesignLayout';

defineProps<{
  canvasWidth: number;
  canvasHeight: number;
  edgeGeometry: EdgeGeometry;
}>();
</script>

<template>
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
</template>

<style scoped>
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
</style>

