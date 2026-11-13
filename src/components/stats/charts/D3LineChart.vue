<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue';
import * as d3 from 'd3';
import type { LineSeries } from '../../../composables/useStatistics';

const props = withDefaults(
  defineProps<{
    series: LineSeries[];
    height?: number;
    palette?: string[];
    valueSuffix?: string;
    emptyText?: string;
  }>(),
  {
    height: 240,
    palette: () => ['#2563eb', '#16a34a', '#ea580c', '#9333ea', '#e11d48'],
    valueSuffix: '',
    emptyText: 'Keine Daten vorhanden',
  }
);

const emit = defineEmits<{
  (e: 'select', payload: { label: string; personIds: string[] }): void;
}>();

const containerRef = ref<HTMLDivElement | null>(null);
const tooltip = ref<{ visible: boolean; x: number; y: number; text: string }>({
  visible: false,
  x: 0,
  y: 0,
  text: '',
});

const hasPoints = computed(() => props.series.some((s) => s.points.length > 0));
let resizeObserver: ResizeObserver | null = null;

function renderChart() {
  const container = containerRef.value;
  if (!container) return;

  d3.select(container).selectAll('svg').remove();
  if (!hasPoints.value) return;

  const width = Math.max(container.clientWidth || 360, 220);
  const margin = { top: 18, right: 18, bottom: 32, left: 42 };
  const innerW = Math.max(width - margin.left - margin.right, 80);
  const innerH = props.height - margin.top - margin.bottom;

  const svg = d3
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', props.height);

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const xKeys = Array.from(
    new Set(props.series.flatMap((s) => s.points.map((p) => p.xKey)))
  );
  const xLabelMap = new Map<string, string>();
  for (const s of props.series) {
    for (const p of s.points) xLabelMap.set(p.xKey, p.xLabel);
  }

  const maxVal =
    d3.max(props.series, (s) => d3.max(s.points, (p) => p.value) ?? 0) || 1;

  const x = d3.scalePoint().domain(xKeys).range([0, innerW]).padding(0.3);
  const y = d3.scaleLinear().domain([0, maxVal]).nice().range([innerH, 0]);

  g.append('g')
    .attr('transform', `translate(0,${innerH})`)
    .call(d3.axisBottom(x).tickFormat((k) => xLabelMap.get(String(k)) ?? String(k)))
    .selectAll('text')
    .style('font-size', '11px')
    .style('fill', '#475569');

  g.append('g')
    .call(d3.axisLeft(y).ticks(5))
    .selectAll('text')
    .style('font-size', '11px')
    .style('fill', '#64748b');

  g.selectAll('.domain, .tick line').style('stroke', '#e2e8f0');

  const lineGen = d3
    .line<{ xKey: string; value: number }>()
    .x((d) => x(d.xKey) ?? 0)
    .y((d) => y(d.value));

  props.series.forEach((s, idx) => {
    const color = props.palette[idx % props.palette.length];
    g.append('path')
      .datum(s.points)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 2.2)
      .attr('d', lineGen);

    g.selectAll(`circle.pt-${idx}`)
      .data(s.points)
      .enter()
      .append('circle')
      .attr('class', `pt-${idx}`)
      .attr('cx', (d) => x(d.xKey) ?? 0)
      .attr('cy', (d) => y(d.value))
      .attr('r', 4.2)
      .attr('fill', color)
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 1.5)
      .style('cursor', 'pointer')
      .on('mouseenter', function (event, d) {
        d3.select(this).attr('r', 6);
        const valStr = props.valueSuffix === '%' ? d.value.toFixed(1) : String(Math.round(d.value));
        tooltip.value = {
          visible: true,
          x: event.offsetX + 12,
          y: event.offsetY - 12,
          text: `${s.label} (${d.xLabel}): ${valStr}${props.valueSuffix} (n = ${d.n})`,
        };
      })
      .on('mousemove', (event) => {
        tooltip.value.x = event.offsetX + 12;
        tooltip.value.y = event.offsetY - 12;
      })
      .on('mouseleave', function () {
        d3.select(this).attr('r', 4.2);
        tooltip.value.visible = false;
      })
      .on('click', (_, d) => {
        emit('select', { label: `${s.label} (${d.xLabel})`, personIds: d.personIds });
      });
  });
}

onMounted(() => {
  renderChart();
  if (containerRef.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => renderChart());
    resizeObserver.observe(containerRef.value);
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
});

watch(() => [props.series, props.palette], renderChart, { deep: true });
</script>

<template>
  <div class="d3-chart-wrap" ref="containerRef">
    <div v-if="!hasPoints" class="chart-empty">{{ emptyText }}</div>
    <div v-else class="chart-legend">
      <span v-for="(s, idx) in series" :key="s.key" class="legend-item">
        <span class="legend-dot" :style="{ backgroundColor: palette[idx % palette.length] }"></span>
        {{ s.label }}
      </span>
    </div>
    <div
      v-if="tooltip.visible"
      class="chart-tooltip"
      :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
    >
      {{ tooltip.text }}
    </div>
  </div>
</template>

<style scoped>
.d3-chart-wrap {
  position: relative;
  width: 100%;
  min-height: 120px;
}

.chart-empty {
  padding: 2rem 1rem;
  text-align: center;
  color: #94a3b8;
  font-size: 0.85rem;
}

.chart-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.85rem;
  margin-bottom: 0.35rem;
  font-size: 0.76rem;
  color: #475569;
  font-weight: 600;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.chart-tooltip {
  position: absolute;
  pointer-events: none;
  background: #0f172a;
  color: #f8fafc;
  font-size: 0.76rem;
  font-weight: 600;
  padding: 0.3rem 0.55rem;
  border-radius: 6px;
  white-space: nowrap;
  z-index: 20;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.25);
}
</style>
