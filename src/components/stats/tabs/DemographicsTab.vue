<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import D3BarChart from '../charts/D3BarChart.vue';
import D3GroupedBarChart from '../charts/D3GroupedBarChart.vue';
import D3LineChart from '../charts/D3LineChart.vue';
import type { StatBucket, GroupedSeriesBucket, LineSeries } from '../../../composables/useStatistics';

const props = defineProps<{
  demographics: {
    ageSampleSize: number;
    avgAge: number | null;
    medianAge: number | null;
    avgAgeMale: number | null;
    maleAgeN: number;
    avgAgeFemale: number | null;
    femaleAgeN: number;
    ageBuckets: StatBucket[];
    lifeExpectancyByCentury: GroupedSeriesBucket[];
    infantMortalityRate: number | null;
    infantTotalIds: string[];
    childMortalityRate: number | null;
    childTotalIds: string[];
    mortalitySeries: LineSeries[];
    sexBuckets: StatBucket[];
    birthMonths: StatBucket[];
    birthMonthN: number;
    deathMonths: StatBucket[];
    deathMonthN: number;
  };
}>();

const emit = defineEmits<{
  (e: 'drilldown', payload: { title: string; personIds: string[] }): void;
}>();

const { t } = useI18n();

const monthNames = computed(() => [
  t('stats_month_1'),
  t('stats_month_2'),
  t('stats_month_3'),
  t('stats_month_4'),
  t('stats_month_5'),
  t('stats_month_6'),
  t('stats_month_7'),
  t('stats_month_8'),
  t('stats_month_9'),
  t('stats_month_10'),
  t('stats_month_11'),
  t('stats_month_12'),
]);

const localizedSexBuckets = computed(() =>
  props.demographics.sexBuckets.map((b) => ({
    ...b,
    label:
      b.key === 'M'
        ? t('stats_sex_male')
        : b.key === 'F'
          ? t('stats_sex_female')
          : t('stats_sex_unknown'),
  }))
);

const localizedBirthMonths = computed(() =>
  props.demographics.birthMonths.map((b, idx) => ({
    ...b,
    label: monthNames.value[idx] ?? b.label,
  }))
);

const localizedDeathMonths = computed(() =>
  props.demographics.deathMonths.map((b, idx) => ({
    ...b,
    label: monthNames.value[idx] ?? b.label,
  }))
);

const localizedMortalitySeries = computed<LineSeries[]>(() =>
  props.demographics.mortalitySeries.map((s) => ({
    ...s,
    label:
      s.key === 'infant'
        ? t('stats_infant_mortality_label')
        : t('stats_child_mortality_label'),
  }))
);

function fmtNum(val: number | null, decimals = 1): string {
  return val === null ? '—' : val.toFixed(decimals);
}
</script>

<template>
  <div class="tab-grid">
    <!-- Mini-KPIs -->
    <div class="mini-kpi-row full-span">
      <div class="mini-kpi">
        <span class="mini-kpi-label">{{ t('stats_avg_lifespan') }}</span>
        <strong class="mini-kpi-val">{{ fmtNum(demographics.avgAge) }} {{ t('stats_years_unit') }}</strong>
        <span class="mini-kpi-sub">Median: {{ fmtNum(demographics.medianAge) }} · n = {{ demographics.ageSampleSize }}</span>
      </div>
      <div class="mini-kpi">
        <span class="mini-kpi-label">{{ t('stats_lifespan_male') }}</span>
        <strong class="mini-kpi-val">{{ fmtNum(demographics.avgAgeMale) }} {{ t('stats_years_unit') }}</strong>
        <span class="mini-kpi-sub">n = {{ demographics.maleAgeN }}</span>
      </div>
      <div class="mini-kpi">
        <span class="mini-kpi-label">{{ t('stats_lifespan_female') }}</span>
        <strong class="mini-kpi-val">{{ fmtNum(demographics.avgAgeFemale) }} {{ t('stats_years_unit') }}</strong>
        <span class="mini-kpi-sub">n = {{ demographics.femaleAgeN }}</span>
      </div>
      <div
        class="mini-kpi clickable"
        @click="emit('drilldown', { title: t('stats_infant_mortality'), personIds: demographics.infantTotalIds })"
      >
        <span class="mini-kpi-label">{{ t('stats_infant_mortality') }}</span>
        <strong class="mini-kpi-val">{{ fmtNum(demographics.infantMortalityRate) }}%</strong>
        <span class="mini-kpi-sub">{{ demographics.infantTotalIds.length }} / {{ demographics.ageSampleSize }}</span>
      </div>
      <div
        class="mini-kpi clickable"
        @click="emit('drilldown', { title: t('stats_child_mortality'), personIds: demographics.childTotalIds })"
      >
        <span class="mini-kpi-label">{{ t('stats_child_mortality') }}</span>
        <strong class="mini-kpi-val">{{ fmtNum(demographics.childMortalityRate) }}%</strong>
        <span class="mini-kpi-sub">{{ demographics.childTotalIds.length }} / {{ demographics.ageSampleSize }}</span>
      </div>
    </div>

    <!-- Altersverteilung -->
    <section class="stat-card">
      <div class="card-head">
        <h3>{{ t('stats_age_distribution') }}</h3>
        <span class="sample-badge">n = {{ demographics.ageSampleSize }}</span>
      </div>
      <D3BarChart
        :data="demographics.ageBuckets"
        color="#2563eb"
        :empty-text="t('stats_no_data')"
        @select="b => emit('drilldown', { title: `${t('stats_age_distribution')}: ${b.label}`, personIds: b.personIds })"
      />
    </section>

    <!-- Lebenserwartung nach Jahrhundert & Geschlecht -->
    <section class="stat-card">
      <div class="card-head">
        <h3>{{ t('stats_lifespan_by_century') }}</h3>
        <span class="sample-badge">n = {{ demographics.ageSampleSize }}</span>
      </div>
      <D3GroupedBarChart
        :data="demographics.lifeExpectancyByCentury"
        :series-labels="{ M: t('stats_sex_male'), F: t('stats_sex_female') }"
        :value-suffix="` ${t('stats_years_unit')}`"
        :empty-text="t('stats_no_data')"
        @select="p => emit('drilldown', { title: `${t('stats_lifespan_by_century')}: ${p.label}`, personIds: p.personIds })"
      />
    </section>

    <!-- Kindersterblichkeit im Zeitverlauf -->
    <section class="stat-card">
      <div class="card-head">
        <h3>{{ t('stats_mortality_trend') }}</h3>
        <span class="sample-badge">n = {{ demographics.ageSampleSize }}</span>
      </div>
      <D3LineChart
        :series="localizedMortalitySeries"
        :palette="['#ef4444', '#f59e0b']"
        value-suffix="%"
        :empty-text="t('stats_no_data')"
        @select="p => emit('drilldown', { title: `${t('stats_mortality_trend')}: ${p.label}`, personIds: p.personIds })"
      />
    </section>

    <!-- Geschlechterverteilung -->
    <section class="stat-card">
      <div class="card-head">
        <h3>{{ t('stats_sex_distribution') }}</h3>
      </div>
      <D3BarChart
        :data="localizedSexBuckets"
        color="#6366f1"
        :empty-text="t('stats_no_data')"
        @select="b => emit('drilldown', { title: `${t('stats_sex_distribution')}: ${b.label}`, personIds: b.personIds })"
      />
    </section>

    <!-- Geburtsmonate -->
    <section class="stat-card">
      <div class="card-head">
        <h3>{{ t('stats_birth_months') }}</h3>
        <span class="sample-badge">n = {{ demographics.birthMonthN }}</span>
      </div>
      <D3BarChart
        :data="localizedBirthMonths"
        color="#0ea5e9"
        :empty-text="t('stats_no_data')"
        @select="b => emit('drilldown', { title: `${t('stats_birth_months')}: ${b.label}`, personIds: b.personIds })"
      />
    </section>

    <!-- Sterbemonate -->
    <section class="stat-card">
      <div class="card-head">
        <h3>{{ t('stats_death_months') }}</h3>
        <span class="sample-badge">n = {{ demographics.deathMonthN }}</span>
      </div>
      <D3BarChart
        :data="localizedDeathMonths"
        color="#64748b"
        :empty-text="t('stats_no_data')"
        @select="b => emit('drilldown', { title: `${t('stats_death_months')}: ${b.label}`, personIds: b.personIds })"
      />
    </section>
  </div>
</template>

<style scoped>
.tab-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
  gap: 1rem;
}

.full-span {
  grid-column: 1 / -1;
}

.mini-kpi-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 0.75rem;
}

.mini-kpi {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 0.75rem 0.9rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.mini-kpi.clickable {
  cursor: pointer;
  transition: border-color 0.15s;
}

.mini-kpi.clickable:hover {
  border-color: #2563eb;
}

.mini-kpi-label {
  font-size: 0.76rem;
  color: #64748b;
  font-weight: 600;
}

.mini-kpi-val {
  font-size: 1.25rem;
  color: #0f172a;
}

.mini-kpi-sub {
  font-size: 0.72rem;
  color: #94a3b8;
}

.stat-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 0.9rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.card-head h3 {
  margin: 0;
  font-size: 0.92rem;
  font-weight: 700;
  color: #1e293b;
}

.sample-badge {
  font-size: 0.72rem;
  font-weight: 600;
  color: #475569;
  background: #f1f5f9;
  padding: 0.15rem 0.45rem;
  border-radius: 999px;
}
</style>
