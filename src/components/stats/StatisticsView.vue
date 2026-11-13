<script setup lang="ts">
import { computed, ref, toRef } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Person, RootAncestorConfig } from '../../composables/usePersons';
import { useStatistics } from '../../composables/useStatistics';
import DemographicsTab from './tabs/DemographicsTab.vue';
import FamiliesTab from './tabs/FamiliesTab.vue';
import NamesPlacesTab from './tabs/NamesPlacesTab.vue';
import QualityStructureTab from './tabs/QualityStructureTab.vue';

const props = defineProps<{
  persons: Person[];
  rootAncestors: RootAncestorConfig[];
  activeProbandId: string | null;
}>();

const emit = defineEmits<{
  (e: 'select-person', person: Person): void;
  (e: 'open-in-table', person: Person): void;
}>();

const { t } = useI18n();

const personsRef = toRef(props, 'persons');
const rootsRef = toRef(props, 'rootAncestors');
const activeProbandRef = toRef(props, 'activeProbandId');

const {
  filters,
  resetFilters,
  personById,
  filteredPersons,
  demographics,
  families,
  namesPlaces,
  qualityStructure,
} = useStatistics(personsRef, rootsRef, activeProbandRef);

type StatsTab = 'demographics' | 'families' | 'names' | 'quality';
const activeTab = ref<StatsTab>('demographics');

const drilldown = ref<{ title: string; personIds: string[] } | null>(null);

const drilldownPersons = computed(() => {
  if (!drilldown.value) return [];
  const uniqueIds = Array.from(new Set(drilldown.value.personIds));
  return uniqueIds
    .map((id) => personById.value.get(id))
    .filter((p): p is Person => !!p);
});

function openDrilldown(payload: { title: string; personIds: string[] }) {
  drilldown.value = payload;
}

function closeDrilldown() {
  drilldown.value = null;
}

function formatPersonName(p: Person): string {
  return [p.given_name, p.surname].filter(Boolean).join(' ').trim() || p.id;
}

function formatRootLabel(r: RootAncestorConfig): string {
  const name = [r.given_name, r.surname].filter(Boolean).join(' ').trim();
  return name ? `${name} (${r.starting_code})` : r.starting_code;
}
</script>

<template>
  <div class="stats-view">
    <div class="stats-main">
      <!-- Filterleiste -->
      <header class="stats-toolbar">
        <div class="toolbar-title">
          <h2>📊 {{ t('stats_title') }}</h2>
          <span class="subtitle">{{ t('stats_subtitle') }}</span>
        </div>

        <div class="filter-controls">
          <label class="filter-field">
            <span>{{ t('stats_filter_line') }}</span>
            <select v-model="filters.probandId">
              <option value="all">{{ t('stats_filter_all_tree') }}</option>
              <option v-for="r in rootAncestors" :key="r.person_id" :value="r.person_id">
                {{ formatRootLabel(r) }}
              </option>
            </select>
          </label>

          <label class="filter-field">
            <span>{{ t('col_sex') }}</span>
            <select v-model="filters.sex">
              <option value="all">{{ t('stats_filter_all') }}</option>
              <option value="M">{{ t('stats_sex_male') }}</option>
              <option value="F">{{ t('stats_sex_female') }}</option>
            </select>
          </label>

          <label class="filter-field year-range">
            <span>{{ t('stats_filter_years') }}</span>
            <div class="year-inputs">
              <input
                type="number"
                v-model.number="filters.yearFrom"
                :placeholder="t('stats_year_from')"
              />
              <span>–</span>
              <input
                type="number"
                v-model.number="filters.yearTo"
                :placeholder="t('stats_year_to')"
              />
            </div>
          </label>

          <label class="exact-toggle" :title="t('stats_only_exact_tooltip')">
            <input type="checkbox" v-model="filters.onlyExactDates" />
            <span>{{ t('stats_only_exact') }}</span>
          </label>

          <button class="reset-btn" @click="resetFilters">
            {{ t('stats_reset_filters') }}
          </button>
        </div>
      </header>

      <!-- Top KPI-Übersicht -->
      <section class="top-kpi-strip">
        <div class="kpi-card">
          <span class="kpi-label">{{ t('stats_kpi_persons') }}</span>
          <strong class="kpi-value">{{ filteredPersons.length }}</strong>
          <span class="kpi-meta">{{ t('stats_kpi_of_total', { total: persons.length }) }}</span>
        </div>
        <div class="kpi-card">
          <span class="kpi-label">{{ t('stats_kpi_families') }}</span>
          <strong class="kpi-value">{{ families.totalFamilies }}</strong>
          <span class="kpi-meta">Ø {{ families.avgChildren !== null ? families.avgChildren.toFixed(1) : '—' }} {{ t('stats_children_unit') }}</span>
        </div>
        <div class="kpi-card">
          <span class="kpi-label">{{ t('stats_kpi_lifespan') }}</span>
          <strong class="kpi-value">
            {{ demographics.avgAge !== null ? demographics.avgAge.toFixed(1) : '—' }} {{ t('stats_years_unit') }}
          </strong>
          <span class="kpi-meta">n = {{ demographics.ageSampleSize }}</span>
        </div>
        <div class="kpi-card">
          <span class="kpi-label">{{ t('stats_kpi_timespan') }}</span>
          <strong class="kpi-value">
            {{
              qualityStructure.earliest && qualityStructure.latest
                ? `${qualityStructure.earliest.year} – ${qualityStructure.latest.year}`
                : '—'
            }}
          </strong>
          <span class="kpi-meta">{{ qualityStructure.personsByCentury.length }} {{ t('stats_centuries_unit') }}</span>
        </div>
        <div class="kpi-card">
          <span class="kpi-label">{{ t('stats_kpi_completeness') }}</span>
          <strong class="kpi-value">{{ qualityStructure.coreCompletenessPct.toFixed(0) }}%</strong>
          <span class="kpi-meta">{{ t('stats_kpi_completeness_sub') }}</span>
        </div>
      </section>

      <!-- 4 Unter-Tabs -->
      <nav class="stats-subtabs">
        <button
          :class="{ active: activeTab === 'demographics' }"
          @click="activeTab = 'demographics'"
        >
          {{ t('stats_tab_demographics') }}
        </button>
        <button
          :class="{ active: activeTab === 'families' }"
          @click="activeTab = 'families'"
        >
          {{ t('stats_tab_families') }}
        </button>
        <button
          :class="{ active: activeTab === 'names' }"
          @click="activeTab = 'names'"
        >
          {{ t('stats_tab_names_places') }}
        </button>
        <button
          :class="{ active: activeTab === 'quality' }"
          @click="activeTab = 'quality'"
        >
          {{ t('stats_tab_quality') }}
        </button>
      </nav>

      <!-- Tab-Inhalt -->
      <div class="stats-content">
        <DemographicsTab
          v-if="activeTab === 'demographics'"
          :demographics="demographics"
          @drilldown="openDrilldown"
        />
        <FamiliesTab
          v-else-if="activeTab === 'families'"
          :families="families"
          v-model:family-grouping="filters.familyGrouping"
          @drilldown="openDrilldown"
        />
        <NamesPlacesTab
          v-else-if="activeTab === 'names'"
          :names-places="namesPlaces"
          @drilldown="openDrilldown"
        />
        <QualityStructureTab
          v-else
          :quality-structure="qualityStructure"
          @drilldown="openDrilldown"
        />
      </div>
    </div>

    <!-- Drilldown-Seitenpanel -->
    <aside v-if="drilldown" class="drilldown-panel">
      <div class="drilldown-header">
        <div>
          <h3>{{ drilldown.title }}</h3>
          <span class="drilldown-count">{{ drilldownPersons.length }} {{ t('stats_persons_unit') }}</span>
        </div>
        <button class="close-btn" @click="closeDrilldown" :title="t('close')">✕</button>
      </div>

      <div v-if="drilldownPersons.length === 0" class="drilldown-empty">
        {{ t('stats_no_data') }}
      </div>
      <ul v-else class="drilldown-list">
        <li v-for="p in drilldownPersons" :key="p.id" class="drilldown-item">
          <div class="person-info" @click="emit('select-person', p)">
            <strong>{{ formatPersonName(p) }}</strong>
            <span class="person-dates">
              {{ p.birth_date || '?' }} – {{ p.death_date || '?' }}
            </span>
          </div>
          <button
            class="table-jump-btn"
            @click="emit('open-in-table', p)"
            :title="t('stats_open_in_table')"
          >
            📋
          </button>
        </li>
      </ul>
    </aside>
  </div>
</template>

<style scoped>
.stats-view {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  background: #f8fafc;
  overflow: hidden;
}

.stats-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 1rem 1.25rem 1.5rem;
  gap: 0.9rem;
}

.stats-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.85rem;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 0.85rem 1rem;
}

.toolbar-title h2 {
  margin: 0;
  font-size: 1.05rem;
  color: #0f172a;
}

.subtitle {
  font-size: 0.78rem;
  color: #64748b;
}

.filter-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.75rem;
}

.filter-field {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.74rem;
  font-weight: 600;
  color: #475569;
}

.filter-field select,
.filter-field input {
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 0.32rem 0.5rem;
  font-size: 0.8rem;
  background: #ffffff;
  color: #0f172a;
}

.year-inputs {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.year-inputs input {
  width: 74px;
}

.exact-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: #334155;
  padding: 0.34rem 0.6rem;
  background: #f1f5f9;
  border-radius: 6px;
  cursor: pointer;
}

.reset-btn {
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #475569;
  padding: 0.36rem 0.65rem;
  border-radius: 6px;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
}

.reset-btn:hover {
  background: #f1f5f9;
}

.top-kpi-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 0.75rem;
}

.kpi-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 0.75rem 0.95rem;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.kpi-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: #64748b;
}

.kpi-value {
  font-size: 1.3rem;
  color: #0f172a;
}

.kpi-meta {
  font-size: 0.72rem;
  color: #94a3b8;
}

.stats-subtabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  border-bottom: 1px solid #e2e8f0;
  padding-bottom: 0.55rem;
}

.stats-subtabs button {
  border: 1px solid transparent;
  background: transparent;
  color: #475569;
  font-size: 0.84rem;
  font-weight: 600;
  padding: 0.42rem 0.85rem;
  border-radius: 7px;
  cursor: pointer;
  transition: all 0.15s;
}

.stats-subtabs button:hover:not(.active) {
  background: #e2e8f0;
  color: #0f172a;
}

.stats-subtabs button.active {
  background: #2563eb;
  color: #ffffff;
}

.stats-content {
  flex: 1;
}

/* Drilldown Panel */
.drilldown-panel {
  width: 310px;
  flex-shrink: 0;
  background: #ffffff;
  border-left: 1px solid #e2e8f0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.drilldown-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.85rem 1rem;
  border-bottom: 1px solid #e2e8f0;
  background: #f8fafc;
}

.drilldown-header h3 {
  margin: 0;
  font-size: 0.88rem;
  color: #0f172a;
}

.drilldown-count {
  font-size: 0.74rem;
  color: #64748b;
}

.close-btn {
  border: none;
  background: transparent;
  font-size: 1rem;
  color: #64748b;
  cursor: pointer;
  padding: 0.1rem 0.35rem;
  border-radius: 4px;
}

.close-btn:hover {
  background: #e2e8f0;
  color: #0f172a;
}

.drilldown-empty {
  padding: 1.5rem 1rem;
  text-align: center;
  color: #94a3b8;
  font-size: 0.84rem;
}

.drilldown-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  flex: 1;
}

.drilldown-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.55rem 0.9rem;
  border-bottom: 1px solid #f1f5f9;
}

.drilldown-item:hover {
  background: #f8fafc;
}

.person-info {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
  cursor: pointer;
  min-width: 0;
  flex: 1;
}

.person-info strong {
  font-size: 0.82rem;
  color: #1e293b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.person-dates {
  font-size: 0.72rem;
  color: #64748b;
}

.table-jump-btn {
  border: 1px solid #e2e8f0;
  background: #ffffff;
  border-radius: 5px;
  padding: 0.22rem 0.42rem;
  cursor: pointer;
  font-size: 0.78rem;
}

.table-jump-btn:hover {
  background: #f1f5f9;
  border-color: #cbd5e1;
}
</style>
