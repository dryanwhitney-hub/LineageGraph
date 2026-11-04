<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Person } from '../../composables/usePersons';

const props = defineProps<{
  persons: Person[];
}>();

const emit = defineEmits<{
  'select-person': [person: Person];
}>();

const { t } = useI18n();

const freeQuerySurname = ref<string>('');
const freeQueryGiven = ref<string>('');
const freeQueryBirth = ref<string>('');
const freeQueryId = ref<string>('');

watch(
  () => props.persons,
  () => {
    freeQuerySurname.value = '';
    freeQueryGiven.value = '';
    freeQueryBirth.value = '';
    freeQueryId.value = '';
  }
);

const freeQueryResults = computed(() => {
  const sSurname = freeQuerySurname.value.toLowerCase().trim();
  const sGiven = freeQueryGiven.value.toLowerCase().trim();
  const sBirth = freeQueryBirth.value.toLowerCase().trim();
  const sId = freeQueryId.value.toLowerCase().trim();

  return props.persons
    .filter(p => {
      if (sSurname && !(p.surname || '').toLowerCase().includes(sSurname)) return false;
      if (sGiven && !(p.given_name || '').toLowerCase().includes(sGiven)) return false;
      if (
        sBirth &&
        !(p.birth_date || '').toLowerCase().includes(sBirth) &&
        !(p.birth_place || '').toLowerCase().includes(sBirth)
      )
        return false;
      if (sId && !p.id.toLowerCase().includes(sId)) return false;
      return true;
    })
    .slice(0, 30);
});
</script>

<template>
  <div class="free-query-container" @mousedown.stop @wheel.stop>
    <div class="free-query-card">
      <h2>🧭 {{ t('free_query_title') }}</h2>
      <p class="free-query-subtitle">{{ t('free_query_subtitle') }}</p>

      <div class="free-query-grid">
        <div class="free-query-field">
          <label>{{ t('col_surname') }}:</label>
          <input v-model="freeQuerySurname" :placeholder="t('col_surname') + '...'" />
        </div>
        <div class="free-query-field">
          <label>{{ t('col_given') }}:</label>
          <input v-model="freeQueryGiven" :placeholder="t('col_given') + '...'" />
        </div>
        <div class="free-query-field">
          <label>{{ t('col_birth') }} / {{ t('col_birth_place') }}:</label>
          <input v-model="freeQueryBirth" placeholder="z.B. 1890 oder Ort..." />
        </div>
        <div class="free-query-field">
          <label>{{ t('col_id') }}:</label>
          <input v-model="freeQueryId" placeholder="z.B. @I1@..." />
        </div>
      </div>

      <div class="free-query-results">
        <div v-if="freeQueryResults.length === 0" class="empty">{{ t('no_data') }}</div>
        <ul v-else class="free-query-list">
          <li
            v-for="p in freeQueryResults"
            :key="'fq-' + p.id"
            class="free-query-item"
            @click="emit('select-person', p)"
          >
            <div class="fq-person-main">
              <strong>{{ p.surname || 'N.N.' }}, {{ p.given_name || 'N.N.' }}</strong>
              <small class="fq-id">({{ p.id }})</small>
              <span class="fq-dates">
                <span v-if="p.birth_date || p.birth_place">
                  * {{ p.birth_date || '?' }} {{ p.birth_place ? 'in ' + p.birth_place : '' }}
                </span>
                <span v-if="p.death_date"> | † {{ p.death_date }}</span>
              </span>
            </div>
            <button class="btn-sm btn-select-person" @click.stop="emit('select-person', p)">
              {{ t('free_open_person') }}
            </button>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.free-query-container {
  flex-grow: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f7fa;
  padding: 1.5rem;
  overflow-y: auto;
}
.free-query-card {
  background: white;
  border: 1px solid #dcdde1;
  border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.08);
  padding: 1.5rem 2rem;
  width: 100%;
  max-width: 720px;
  max-height: 92%;
  display: flex;
  flex-direction: column;
}
.free-query-card h2 {
  margin: 0 0 0.35rem 0;
  color: #2c3e50;
  font-size: 1.25rem;
}
.free-query-subtitle {
  margin: 0 0 1rem 0;
  color: #7f8c8d;
  font-size: 0.9rem;
}
.free-query-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem 1rem;
  margin-bottom: 1rem;
}
.free-query-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.free-query-field label {
  font-size: 0.82rem;
  font-weight: bold;
  color: #34495e;
}
.free-query-field input {
  padding: 0.45rem 0.6rem;
  border: 1px solid #bdc3c7;
  border-radius: 4px;
  font-size: 0.9rem;
}
.free-query-field input:focus {
  outline: 2px solid rgba(52, 152, 219, 0.35);
  border-color: #3498db;
}
.free-query-results {
  border: 1px solid #ecf0f1;
  border-radius: 6px;
  background: #fafafa;
  max-height: 280px;
  overflow-y: auto;
}
.free-query-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.free-query-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.55rem 0.85rem;
  border-bottom: 1px solid #ecf0f1;
  cursor: pointer;
  transition: background 0.15s;
}
.free-query-item:last-child {
  border-bottom: none;
}
.free-query-item:hover {
  background: #ebf5fb;
}
.fq-person-main {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  font-size: 0.88rem;
  color: #2c3e50;
}
.fq-id {
  color: #7f8c8d;
}
.fq-dates {
  font-size: 0.8rem;
  color: #576574;
}
button {
  padding: 0.5rem 1rem;
  background-color: #3498db;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-weight: bold;
}
button:hover:not(:disabled) {
  background-color: #2980b9;
}
.btn-sm {
  padding: 0.2rem 0.5rem;
  font-size: 0.75rem;
}
.btn-select-person {
  background-color: #3498db;
  white-space: nowrap;
}
.empty {
  padding: 1rem;
  text-align: center;
  color: #7f8c8d;
}
</style>

