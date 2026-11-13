<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import D3BarChart from '../charts/D3BarChart.vue';
import D3LineChart from '../charts/D3LineChart.vue';
import type { LineSeries, StatBucket } from '../../../composables/useStatistics';

defineProps<{
  namesPlaces: {
    uniqueSurnames: number;
    uniqueGivenNames: number;
    topSurnames: StatBucket[];
    topGivenNames: StatBucket[];
    surnameTrends: LineSeries[];
    givenNameTrends: LineSeries[];
    topBirthPlaces: StatBucket[];
    topDeathPlaces: StatBucket[];
    topMarriagePlaces: StatBucket[];
    topOccupations: StatBucket[];
    occupationN: number;
  };
}>();

const emit = defineEmits<{
  (e: 'drilldown', payload: { title: string; personIds: string[] }): void;
}>();

const { t } = useI18n();
</script>

<template>
  <div class="tab-grid">
    <!-- Top Nachnamen -->
    <section class="stat-card">
      <div class="card-head">
        <h3>{{ t('stats_top_surnames') }}</h3>
        <span class="sample-badge">{{ namesPlaces.uniqueSurnames }} {{ t('stats_unique_label') }}</span>
      </div>
      <D3BarChart
        :data="namesPlaces.topSurnames"
        orientation="horizontal"
        color="#2563eb"
        :empty-text="t('stats_no_data')"
        @select="b => emit('drilldown', { title: `${t('col_surname')}: ${b.label}`, personIds: b.personIds })"
      />
    </section>

    <!-- Top Vornamen -->
    <section class="stat-card">
      <div class="card-head">
        <h3>{{ t('stats_top_given_names') }}</h3>
        <span class="sample-badge">{{ namesPlaces.uniqueGivenNames }} {{ t('stats_unique_label') }}</span>
      </div>
      <D3BarChart
        :data="namesPlaces.topGivenNames"
        orientation="horizontal"
        color="#7c3aed"
        :empty-text="t('stats_no_data')"
        @select="b => emit('drilldown', { title: `${t('col_given')}: ${b.label}`, personIds: b.personIds })"
      />
    </section>

    <!-- Trend Nachnamen -->
    <section class="stat-card">
      <div class="card-head">
        <h3>{{ t('stats_surname_trends') }}</h3>
      </div>
      <D3LineChart
        :series="namesPlaces.surnameTrends"
        :empty-text="t('stats_no_data')"
        @select="p => emit('drilldown', { title: `${t('stats_surname_trends')}: ${p.label}`, personIds: p.personIds })"
      />
    </section>

    <!-- Trend Vornamen -->
    <section class="stat-card">
      <div class="card-head">
        <h3>{{ t('stats_given_name_trends') }}</h3>
      </div>
      <D3LineChart
        :series="namesPlaces.givenNameTrends"
        :empty-text="t('stats_no_data')"
        @select="p => emit('drilldown', { title: `${t('stats_given_name_trends')}: ${p.label}`, personIds: p.personIds })"
      />
    </section>

    <!-- Geburtsorte -->
    <section class="stat-card">
      <div class="card-head">
        <h3>{{ t('stats_top_birth_places') }}</h3>
      </div>
      <D3BarChart
        :data="namesPlaces.topBirthPlaces"
        orientation="horizontal"
        color="#0ea5e9"
        :empty-text="t('stats_no_data')"
        @select="b => emit('drilldown', { title: `${t('col_birth_place')}: ${b.label}`, personIds: b.personIds })"
      />
    </section>

    <!-- Sterbeorte -->
    <section class="stat-card">
      <div class="card-head">
        <h3>{{ t('stats_top_death_places') }}</h3>
      </div>
      <D3BarChart
        :data="namesPlaces.topDeathPlaces"
        orientation="horizontal"
        color="#64748b"
        :empty-text="t('stats_no_data')"
        @select="b => emit('drilldown', { title: `${t('col_death_place')}: ${b.label}`, personIds: b.personIds })"
      />
    </section>

    <!-- Heiratsorte -->
    <section class="stat-card">
      <div class="card-head">
        <h3>{{ t('stats_top_marriage_places') }}</h3>
      </div>
      <D3BarChart
        :data="namesPlaces.topMarriagePlaces"
        orientation="horizontal"
        color="#f59e0b"
        :empty-text="t('stats_no_data')"
        @select="b => emit('drilldown', { title: `${t('stats_top_marriage_places')}: ${b.label}`, personIds: b.personIds })"
      />
    </section>

    <!-- Berufe -->
    <section class="stat-card">
      <div class="card-head">
        <h3>{{ t('stats_top_occupations') }}</h3>
        <span class="sample-badge">n = {{ namesPlaces.occupationN }}</span>
      </div>
      <D3BarChart
        :data="namesPlaces.topOccupations"
        orientation="horizontal"
        color="#10b981"
        :empty-text="t('stats_no_data')"
        @select="b => emit('drilldown', { title: `${t('col_occu')}: ${b.label}`, personIds: b.personIds })"
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
