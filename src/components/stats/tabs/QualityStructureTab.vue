<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import D3BarChart from '../charts/D3BarChart.vue';
import type { Person } from '../../../composables/usePersons';
import type { ImplexGenerationRow, StatBucket } from '../../../composables/useStatistics';

const props = defineProps<{
  qualityStructure: {
    total: number;
    coreCompletenessPct: number;
    completenessBuckets: StatBucket[];
    generationBuckets: StatBucket[];
    maxGeneration: number;
    personsByCentury: StatBucket[];
    earliest: { year: number; person: Person } | null;
    latest: { year: number; person: Person } | null;
    implexProbandName: string | null;
    implexRows: ImplexGenerationRow[];
  };
}>();

const emit = defineEmits<{
  (e: 'drilldown', payload: { title: string; personIds: string[] }): void;
}>();

const { t } = useI18n();

const localizedCompleteness = computed(() => {
  const map: Record<string, string> = {
    birth_date: t('col_birth'),
    birth_place: t('col_birth_place'),
    death_date: t('col_death'),
    death_place: t('col_death_place'),
    sex: t('col_sex'),
    parents: t('stats_field_parents'),
  };
  return props.qualityStructure.completenessBuckets.map((b) => ({
    ...b,
    label: map[b.key] ?? b.label,
  }));
});

function formatPerson(p: Person): string {
  return [p.given_name, p.surname].filter(Boolean).join(' ').trim() || p.id;
}
</script>

<template>
  <div class="tab-grid">
    <!-- Mini-KPIs -->
    <div class="mini-kpi-row full-span">
      <div class="mini-kpi">
        <span class="mini-kpi-label">{{ t('stats_max_generation') }}</span>
        <strong class="mini-kpi-val">{{ qualityStructure.maxGeneration || '—' }}</strong>
        <span class="mini-kpi-sub">{{ qualityStructure.implexProbandName || t('stats_no_proband') }}</span>
      </div>
      <div
        v-if="qualityStructure.earliest"
        class="mini-kpi clickable"
        @click="emit('drilldown', { title: t('stats_earliest_entry'), personIds: [qualityStructure.earliest.person.id] })"
      >
        <span class="mini-kpi-label">{{ t('stats_earliest_entry') }}</span>
        <strong class="mini-kpi-val">{{ qualityStructure.earliest.year }}</strong>
        <span class="mini-kpi-sub">{{ formatPerson(qualityStructure.earliest.person) }}</span>
      </div>
      <div
        v-if="qualityStructure.latest"
        class="mini-kpi clickable"
        @click="emit('drilldown', { title: t('stats_latest_entry'), personIds: [qualityStructure.latest.person.id] })"
      >
        <span class="mini-kpi-label">{{ t('stats_latest_entry') }}</span>
        <strong class="mini-kpi-val">{{ qualityStructure.latest.year }}</strong>
        <span class="mini-kpi-sub">{{ formatPerson(qualityStructure.latest.person) }}</span>
      </div>
    </div>

    <!-- Vollständigkeit der Lebensdaten -->
    <section class="stat-card">
      <div class="card-head">
        <h3>{{ t('stats_data_completeness') }}</h3>
        <span class="sample-badge">{{ t('stats_click_missing_hint') }}</span>
      </div>
      <D3BarChart
        :data="localizedCompleteness"
        orientation="horizontal"
        color="#059669"
        value-suffix="%"
        :max-value="100"
        :empty-text="t('stats_no_data')"
        @select="b => emit('drilldown', { title: `${t('stats_missing_field')}: ${b.label}`, personIds: b.personIds })"
      />
    </section>

    <!-- Personen pro Jahrhundert -->
    <section class="stat-card">
      <div class="card-head">
        <h3>{{ t('stats_persons_by_century') }}</h3>
      </div>
      <D3BarChart
        :data="qualityStructure.personsByCentury"
        color="#2563eb"
        :empty-text="t('stats_no_data')"
        @select="b => emit('drilldown', { title: `${t('stats_persons_by_century')}: ${b.label}`, personIds: b.personIds })"
      />
    </section>

    <!-- Generationstiefe -->
    <section class="stat-card">
      <div class="card-head">
        <h3>{{ t('stats_generation_depth') }}</h3>
      </div>
      <D3BarChart
        :data="qualityStructure.generationBuckets"
        color="#8b5cf6"
        :empty-text="t('stats_no_data')"
        @select="b => emit('drilldown', { title: b.label, personIds: b.personIds })"
      />
    </section>

    <!-- Ahnenverlust (Implex) -->
    <section class="stat-card">
      <div class="card-head">
        <h3>{{ t('stats_implex_title') }}</h3>
        <span v-if="qualityStructure.implexProbandName" class="sample-badge">
          {{ qualityStructure.implexProbandName }}
        </span>
      </div>
      <div v-if="qualityStructure.implexRows.length === 0" class="empty-inline">
        {{ t('stats_implex_empty') }}
      </div>
      <table v-else class="compact-table">
        <thead>
          <tr>
            <th>{{ t('col_gen') }}</th>
            <th>{{ t('stats_implex_theoretical') }}</th>
            <th>{{ t('stats_implex_occupied') }}</th>
            <th>{{ t('stats_implex_unique') }}</th>
            <th>{{ t('stats_implex_loss') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in qualityStructure.implexRows"
            :key="row.generation"
            :class="{ 'clickable-row': row.duplicatePersonIds.length > 0 }"
            @click="row.duplicatePersonIds.length > 0 && emit('drilldown', { title: `${t('stats_implex_title')} (Gen. ${row.generation})`, personIds: row.duplicatePersonIds })"
          >
            <td>{{ row.generation }}</td>
            <td>{{ row.theoretical }}</td>
            <td>{{ row.occupiedSlots }}</td>
            <td>{{ row.uniqueCount }}</td>
            <td>
              <strong>{{ row.lossPercent.toFixed(1) }}%</strong>
              <span v-if="row.duplicateCount > 0" class="dup-badge">({{ row.duplicateCount }})</span>
            </td>
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
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
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

.compact-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
}

.compact-table th,
.compact-table td {
  padding: 0.42rem 0.55rem;
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

.dup-badge {
  color: #dc2626;
  font-size: 0.75rem;
  margin-left: 0.25rem;
}

.empty-inline {
  color: #94a3b8;
  font-size: 0.84rem;
  padding: 0.75rem 0;
}
</style>
