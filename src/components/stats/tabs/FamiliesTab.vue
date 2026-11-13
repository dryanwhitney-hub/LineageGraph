<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import D3BarChart from '../charts/D3BarChart.vue';
import D3GroupedBarChart from '../charts/D3GroupedBarChart.vue';
import type { FamilySummary, GroupedSeriesBucket, StatBucket } from '../../../composables/useStatistics';

const props = defineProps<{
  families: {
    totalFamilies: number;
    avgChildren: number | null;
    medianChildren: number | null;
    sizeBuckets: StatBucket[];
    largestFamilies: FamilySummary[];
    marriageAgeMaleAvg: number | null;
    marriageAgeMaleN: number;
    marriageAgeFemaleAvg: number | null;
    marriageAgeFemaleN: number;
    marriageAgeByCentury: GroupedSeriesBucket[];
    marriageMonths: StatBucket[];
    marriageMonthN: number;
    motherFirstAvg: number | null;
    motherFirstN: number;
    motherLastAvg: number | null;
    motherLastN: number;
    fatherFirstAvg: number | null;
    fatherFirstN: number;
    fatherLastAvg: number | null;
    fatherLastN: number;
    avgSiblingIntervalYears: number | null;
    medianSiblingIntervalYears: number | null;
    siblingIntervalN: number;
  };
  familyGrouping: 'couple' | 'person';
}>();

const emit = defineEmits<{
  (e: 'update:familyGrouping', mode: 'couple' | 'person'): void;
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

const localizedMarriageMonths = computed(() =>
  props.families.marriageMonths.map((b, idx) => ({
    ...b,
    label: monthNames.value[idx] ?? b.label,
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
        <span class="mini-kpi-label">{{ t('stats_avg_children') }}</span>
        <strong class="mini-kpi-val">{{ fmtNum(families.avgChildren, 2) }}</strong>
        <span class="mini-kpi-sub">Median: {{ fmtNum(families.medianChildren, 1) }} · n = {{ families.totalFamilies }}</span>
      </div>
      <div class="mini-kpi">
        <span class="mini-kpi-label">{{ t('stats_marriage_age_male') }}</span>
        <strong class="mini-kpi-val">{{ fmtNum(families.marriageAgeMaleAvg) }} {{ t('stats_years_unit') }}</strong>
        <span class="mini-kpi-sub">n = {{ families.marriageAgeMaleN }}</span>
      </div>
      <div class="mini-kpi">
        <span class="mini-kpi-label">{{ t('stats_marriage_age_female') }}</span>
        <strong class="mini-kpi-val">{{ fmtNum(families.marriageAgeFemaleAvg) }} {{ t('stats_years_unit') }}</strong>
        <span class="mini-kpi-sub">n = {{ families.marriageAgeFemaleN }}</span>
      </div>
      <div class="mini-kpi">
        <span class="mini-kpi-label">{{ t('stats_sibling_interval') }}</span>
        <strong class="mini-kpi-val">{{ fmtNum(families.avgSiblingIntervalYears) }} {{ t('stats_years_unit') }}</strong>
        <span class="mini-kpi-sub">Median: {{ fmtNum(families.medianSiblingIntervalYears) }} · n = {{ families.siblingIntervalN }}</span>
      </div>
    </div>

    <!-- Familiengrößen -->
    <section class="stat-card">
      <div class="card-head">
        <h3>{{ t('stats_family_sizes') }}</h3>
        <div class="grouping-toggle">
          <button
            :class="{ active: familyGrouping === 'couple' }"
            @click="emit('update:familyGrouping', 'couple')"
          >
            {{ t('stats_grouping_couple') }}
          </button>
          <button
            :class="{ active: familyGrouping === 'person' }"
            @click="emit('update:familyGrouping', 'person')"
          >
            {{ t('stats_grouping_person') }}
          </button>
        </div>
      </div>
      <D3BarChart
        :data="families.sizeBuckets"
        color="#10b981"
        :empty-text="t('stats_no_data')"
        @select="b => emit('drilldown', { title: `${t('stats_family_sizes')}: ${b.label} ${t('stats_children_unit')}`, personIds: b.personIds })"
      />
    </section>

    <!-- Heiratsalter nach Jahrhundert -->
    <section class="stat-card">
      <div class="card-head">
        <h3>{{ t('stats_marriage_age_by_century') }}</h3>
        <span class="sample-badge">n = {{ families.marriageAgeMaleN + families.marriageAgeFemaleN }}</span>
      </div>
      <D3GroupedBarChart
        :data="families.marriageAgeByCentury"
        :series-labels="{ M: t('stats_sex_male'), F: t('stats_sex_female') }"
        :value-suffix="` ${t('stats_years_unit')}`"
        :empty-text="t('stats_no_data')"
        @select="p => emit('drilldown', { title: `${t('stats_marriage_age_by_century')}: ${p.label}`, personIds: p.personIds })"
      />
    </section>

    <!-- Heiratssaisonalität -->
    <section class="stat-card">
      <div class="card-head">
        <h3>{{ t('stats_marriage_months') }}</h3>
        <span class="sample-badge">n = {{ families.marriageMonthN }}</span>
      </div>
      <D3BarChart
        :data="localizedMarriageMonths"
        color="#f59e0b"
        :empty-text="t('stats_no_data')"
        @select="b => emit('drilldown', { title: `${t('stats_marriage_months')}: ${b.label}`, personIds: b.personIds })"
      />
    </section>

    <!-- Elternschaftsalter -->
    <section class="stat-card">
      <div class="card-head">
        <h3>{{ t('stats_parenthood_ages') }}</h3>
      </div>
      <table class="compact-table">
        <thead>
          <tr>
            <th>{{ t('stats_parent_role') }}</th>
            <th>{{ t('stats_first_child_age') }}</th>
            <th>{{ t('stats_last_child_age') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{{ t('stats_mother') }}</td>
            <td>
              <strong>{{ fmtNum(families.motherFirstAvg) }} {{ t('stats_years_unit') }}</strong>
              <span class="sub-n">(n = {{ families.motherFirstN }})</span>
            </td>
            <td>
              <strong>{{ fmtNum(families.motherLastAvg) }} {{ t('stats_years_unit') }}</strong>
              <span class="sub-n">(n = {{ families.motherLastN }})</span>
            </td>
          </tr>
          <tr>
            <td>{{ t('stats_father') }}</td>
            <td>
              <strong>{{ fmtNum(families.fatherFirstAvg) }} {{ t('stats_years_unit') }}</strong>
              <span class="sub-n">(n = {{ families.fatherFirstN }})</span>
            </td>
            <td>
              <strong>{{ fmtNum(families.fatherLastAvg) }} {{ t('stats_years_unit') }}</strong>
              <span class="sub-n">(n = {{ families.fatherLastN }})</span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- Top-Liste größte Familien -->
    <section class="stat-card full-span">
      <div class="card-head">
        <h3>{{ t('stats_largest_families') }}</h3>
      </div>
      <div v-if="families.largestFamilies.length === 0" class="empty-inline">{{ t('stats_no_data') }}</div>
      <table v-else class="compact-table">
        <thead>
          <tr>
            <th>#</th>
            <th>{{ t('stats_family_label') }}</th>
            <th>{{ t('stats_children_count') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(fam, idx) in families.largestFamilies"
            :key="fam.key"
            class="clickable-row"
            @click="emit('drilldown', { title: fam.label, personIds: [...fam.parentIds, ...fam.childrenIds] })"
          >
            <td>{{ idx + 1 }}</td>
            <td>{{ fam.label }}</td>
            <td><strong>{{ fam.childCount }}</strong></td>
          </tr>
        </tbody>
      </table>
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
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
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
  gap: 0.65rem;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  flex-wrap: wrap;
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

.grouping-toggle {
  display: inline-flex;
  background: #f1f5f9;
  border-radius: 6px;
  padding: 2px;
}

.grouping-toggle button {
  border: none;
  background: transparent;
  padding: 0.22rem 0.55rem;
  font-size: 0.74rem;
  font-weight: 600;
  color: #64748b;
  border-radius: 5px;
  cursor: pointer;
}

.grouping-toggle button.active {
  background: #ffffff;
  color: #0f172a;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}

.compact-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
}

.compact-table th,
.compact-table td {
  padding: 0.45rem 0.6rem;
  border-bottom: 1px solid #f1f5f9;
  text-align: left;
}

.compact-table th {
  color: #64748b;
  font-weight: 600;
  font-size: 0.75rem;
}

.clickable-row {
  cursor: pointer;
}

.clickable-row:hover {
  background: #f8fafc;
}

.sub-n {
  font-size: 0.72rem;
  color: #94a3b8;
  margin-left: 0.35rem;
}

.empty-inline {
  color: #94a3b8;
  font-size: 0.84rem;
  padding: 0.75rem 0;
}
</style>
