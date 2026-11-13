<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import * as d3 from 'd3';
import type { GroupedSeriesBucket } from '../../../composables/useStatistics';

const props = withDefaults(
  defineProps<{
    data: GroupedSeriesBucket[];
    height?: number;
    colors?: Record<string, string>;
    seriesLabels?: Record<string, string>;
    valueSuffix?: string;
    emptyText?: string;
  }>(),
  {
    height: 240,
    colors: () => ({ M: '#2563eb', F: '#ec4899' }),
    seriesLabels: () => ({ M: 'M', F: 'F' }),
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

let resizeObserver: ResizeObserver | null = null;

function renderChart() {
  const container = containerRef.value;
  if (!container) return;

  d3.select(container).selectAll('svg').remove();
  if (!props.data || props.data.length === 0) return;

  const width = Math.max(container.clientWidth || 360, 220);
  const margin = { top: 20, right: 16, bottom: 32, left: 40 };
  const innerW = Math.max(width - margin.left - margin.right, 80);
  const innerH = props.height - margin.top - margin.bottom;

  const svg = d3
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', props.height);

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const groups = props.data.map((d) => d.groupKey);
  const seriesKeys = Array.from(
    new Set(props.data.flatMap((d) => d.values.map((v) => v.seriesKey)))
  );
  const maxVal =
    d3.max(props.data, (d) => d3.max(d.values, (v) => v.value) ?? 0) || 1;

  const x0 = d3.scaleBand().domain(groups).range([0, innerW]).padding(0.24);
  const x1 = d3.scaleBand().domain(seriesKeys).range([0, x0.bandwidth()]).padding(0.08);
  const y = d3.scaleLinear().domain([0, maxVal]).nice().range([innerH, 0]);

  const groupLabelMap = new Map(props.data.map((d) => [d.groupKey, d.groupLabel]));
  g.append('g')
    .attr('transform', `translate(0,${innerH})`)
    .call(d3.axisBottom(x0).tickFormat((k) => groupLabelMap.get(String(k)) ?? String(k)))
    .selectAll('text')
    .style('font-size', '11px')
    .style('fill', '#475569');

  g.append('g')
    .call(d3.axisLeft(y).ticks(5))
    .selectAll('text')
    .style('font-size', '11px')
    .style('fill', '#64748b');

  g.selectAll('.domain, .tick line').style('stroke', '#e2e8f0');

  const groupNodes = g
    .selectAll('g.group')
    .data(props.data)
    .enter()
    .append('g')
    .attr('class', 'group')
    .attr('transform', (d) => `translate(${x0(d.groupKey) ?? 0},0)`);

  groupNodes
    .selectAll('rect')
    .data((d) => d.values.map((v) => ({ ...v, groupLabel: d.groupLabel })))
    .enter()
    .append('rect')
    .attr('x', (d) => x1(d.seriesKey) ?? 0)
    .attr('y', (d) => y(d.value))
    .attr('width', x1.bandwidth())
    .attr('height', (d) => Math.max(0, innerH - y(d.value)))
    .attr('rx', 3)
    .attr('fill', (d) => props.colors[d.seriesKey] ?? '#3b82f6')
    .style('cursor', 'pointer')
    .on('mouseenter', function (event, d) {
      d3.select(this).attr('opacity', 0.82);
      const lbl = props.seriesLabels[d.seriesKey] ?? d.seriesLabel;
      tooltip.value = {
        visible: true,
        x: event.offsetX + 12,
        y: event.offsetY - 12,
        text: `${d.groupLabel} (${lbl}): ${d.value.toFixed(1)}${props.valueSuffix} (n = ${d.n})`,
      };
    })
    .on('mousemove', (event) => {
      tooltip.value.x = event.offsetX + 12;
      tooltip.value.y = event.offsetY - 12;
    })
    .on('mouseleave', function () {
      d3.select(this).attr('opacity', 1);
      tooltip.value.visible = false;
    })
    .on('click', (_, d) => {
      const lbl = props.seriesLabels[d.seriesKey] ?? d.seriesLabel;
      emit('select', { label: `${d.groupLabel} — ${lbl}`, personIds: d.personIds });
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

watch(() => [props.data, props.colors, props.seriesLabels], renderChart, { deep: true });
</script>

<template>
  <div class="d3-chart-wrap" ref="containerRef">
    <div v-if="!data || data.length === 0" class="chart-empty">{{ emptyText }}</div>
    <div v-else class="chart-legend">
      <span v-for="(lbl, key) in seriesLabels" :key="key" class="legend-item">
        <span class="legend-dot" :style="{ backgroundColor: colors[key] || '#3b82f6' }"></span>
        {{ lbl }}
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
  gap: 0.9rem;
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
  border-radius: 3px;
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
