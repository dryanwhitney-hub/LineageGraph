<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import * as d3 from 'd3';
import type { StatBucket } from '../../../composables/useStatistics';

const props = withDefaults(
  defineProps<{
    data: StatBucket[];
    orientation?: 'vertical' | 'horizontal';
    height?: number;
    color?: string;
    valueSuffix?: string;
    maxValue?: number;
    emptyText?: string;
  }>(),
  {
    orientation: 'vertical',
    height: 240,
    color: '#2563eb',
    valueSuffix: '',
    emptyText: 'Keine Daten vorhanden',
  }
);

const emit = defineEmits<{
  (e: 'select', bucket: StatBucket): void;
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

  if (props.orientation === 'horizontal') {
    const barRowHeight = 26;
    const margin = { top: 8, right: 44, bottom: 24, left: 130 };
    const dynamicHeight = Math.max(props.height, props.data.length * barRowHeight + margin.top + margin.bottom);
    const innerW = Math.max(width - margin.left - margin.right, 80);
    const innerH = dynamicHeight - margin.top - margin.bottom;

    const svg = d3
      .select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', dynamicHeight);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const maxVal = props.maxValue ?? (d3.max(props.data, (d) => d.value) || 1);
    const x = d3.scaleLinear().domain([0, maxVal]).nice().range([0, innerW]);
    const y = d3
      .scaleBand()
      .domain(props.data.map((d) => d.key))
      .range([0, innerH])
      .padding(0.24);

    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(d3.axisBottom(x).ticks(4))
      .selectAll('text')
      .style('font-size', '11px')
      .style('fill', '#64748b');

    const labelMap = new Map(props.data.map((d) => [d.key, d.label]));
    g.append('g')
      .call(
        d3.axisLeft(y).tickFormat((k) => {
          const lbl = labelMap.get(String(k)) ?? String(k);
          return lbl.length > 18 ? lbl.slice(0, 17) + '…' : lbl;
        })
      )
      .selectAll('text')
      .style('font-size', '11px')
      .style('fill', '#334155');

    g.selectAll('.domain, .tick line').style('stroke', '#e2e8f0');

    g.selectAll('rect.bar')
      .data(props.data)
      .enter()
      .append('rect')
      .attr('class', 'bar')
      .attr('x', 0)
      .attr('y', (d) => y(d.key) ?? 0)
      .attr('height', y.bandwidth())
      .attr('width', (d) => Math.max(0, x(d.value)))
      .attr('rx', 4)
      .attr('fill', props.color)
      .style('cursor', 'pointer')
      .on('mouseenter', function (event, d) {
        d3.select(this).attr('opacity', 0.82);
        const formatted = props.valueSuffix === '%' ? d.value.toFixed(1) : String(Math.round(d.value * 10) / 10);
        tooltip.value = {
          visible: true,
          x: event.offsetX + 12,
          y: event.offsetY - 12,
          text: `${d.label}: ${formatted}${props.valueSuffix}`,
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
      .on('click', (_, d) => emit('select', d));

    g.selectAll('text.val-label')
      .data(props.data)
      .enter()
      .append('text')
      .attr('class', 'val-label')
      .attr('x', (d) => x(d.value) + 5)
      .attr('y', (d) => (y(d.key) ?? 0) + y.bandwidth() / 2 + 4)
      .style('font-size', '11px')
      .style('font-weight', '600')
      .style('fill', '#475569')
      .text((d) =>
        props.valueSuffix === '%' ? `${d.value.toFixed(0)}%` : `${Math.round(d.value * 10) / 10}${props.valueSuffix}`
      );
  } else {
    const margin = { top: 18, right: 14, bottom: 32, left: 38 };
    const height = props.height;
    const innerW = Math.max(width - margin.left - margin.right, 80);
    const innerH = height - margin.top - margin.bottom;

    const svg = d3
      .select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const maxVal = props.maxValue ?? (d3.max(props.data, (d) => d.value) || 1);
    const x = d3
      .scaleBand()
      .domain(props.data.map((d) => d.key))
      .range([0, innerW])
      .padding(0.24);
    const y = d3.scaleLinear().domain([0, maxVal]).nice().range([innerH, 0]);

    const labelMap = new Map(props.data.map((d) => [d.key, d.label]));
    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(d3.axisBottom(x).tickFormat((k) => labelMap.get(String(k)) ?? String(k)))
      .selectAll('text')
      .style('font-size', '11px')
      .style('fill', '#475569');

    g.append('g')
      .call(d3.axisLeft(y).ticks(5))
      .selectAll('text')
      .style('font-size', '11px')
      .style('fill', '#64748b');

    g.selectAll('.domain, .tick line').style('stroke', '#e2e8f0');

    g.selectAll('rect.bar')
      .data(props.data)
      .enter()
      .append('rect')
      .attr('class', 'bar')
      .attr('x', (d) => x(d.key) ?? 0)
      .attr('y', (d) => y(d.value))
      .attr('width', x.bandwidth())
      .attr('height', (d) => Math.max(0, innerH - y(d.value)))
      .attr('rx', 4)
      .attr('fill', props.color)
      .style('cursor', 'pointer')
      .on('mouseenter', function (event, d) {
        d3.select(this).attr('opacity', 0.82);
        const formatted = props.valueSuffix === '%' ? d.value.toFixed(1) : String(Math.round(d.value * 10) / 10);
        tooltip.value = {
          visible: true,
          x: event.offsetX + 12,
          y: event.offsetY - 12,
          text: `${d.label}: ${formatted}${props.valueSuffix}`,
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
      .on('click', (_, d) => emit('select', d));

    g.selectAll('text.val-label')
      .data(props.data.filter((d) => d.value > 0))
      .enter()
      .append('text')
      .attr('class', 'val-label')
      .attr('x', (d) => (x(d.key) ?? 0) + x.bandwidth() / 2)
      .attr('y', (d) => y(d.value) - 4)
      .attr('text-anchor', 'middle')
      .style('font-size', '10px')
      .style('font-weight', '600')
      .style('fill', '#475569')
      .text((d) =>
        props.valueSuffix === '%' ? `${d.value.toFixed(0)}%` : String(Math.round(d.value * 10) / 10)
      );
  }
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

watch(() => [props.data, props.orientation, props.color], renderChart, { deep: true });
</script>

<template>
  <div class="d3-chart-wrap" ref="containerRef">
    <div v-if="!data || data.length === 0" class="chart-empty">{{ emptyText }}</div>
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
