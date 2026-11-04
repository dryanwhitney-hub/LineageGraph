<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  isValidGedcomXref,
  type Person,
  type ColumnConfig,
  type ColumnFilter,
} from '../../composables/usePersons';

defineProps<{
  activeTableColumns: ColumnConfig[];
  displayPersons: Person[];
  selectedPerson: Person | null;
  isEditing: boolean;
  editedPersons: Map<string, Person>;
  sortKey: string;
  sortAsc: boolean;
  columnFilters: Record<string, ColumnFilter>;
  saveErrorAlert: string;
  getColLabel: (col: ColumnConfig) => string;
  getCode: (person: Person) => string | null;
  getGen: (person: Person) => number | null;
  getPersonAttr: (person: Person, key: string) => any;
  setPersonAttr: (person: Person, key: string, value: string) => void;
}>();

const emit = defineEmits<{
  select: [person: Person];
  sort: [key: string];
  'clear-save-error': [];
}>();

const { t } = useI18n();
const activeIdField = ref<string | null>(null);
</script>

<template>
  <div class="table-container">
    <div v-if="saveErrorAlert" class="save-error-banner" @click.stop>
      <span>⚠️ {{ saveErrorAlert }}</span>
      <button class="btn-close-sm" @click="emit('clear-save-error')">✕</button>
    </div>
    <table>
      <thead>
        <tr>
          <th v-for="col in activeTableColumns" :key="col.key">
            <div class="th-header" @click="emit('sort', col.key)">
              {{ getColLabel(col) }}<span v-if="col.key === 'id'" style="color: #e74c3c;"> *</span>
              <span class="sort-icon">{{ sortKey === col.key ? (sortAsc ? '▲' : '▼') : '↕' }}</span>
            </div>
            <div class="filter-controls" @click.stop v-if="columnFilters[col.key]">
              <template v-if="col.isDate || col.key.includes('date')">
                <select v-model="columnFilters[col.key].dateOp" class="filter-sel">
                  <option value="before">Vor</option>
                  <option value="after">Nach</option>
                  <option value="between">Zwischen</option>
                </select>
                <input
                  type="text"
                  v-model="columnFilters[col.key].date1"
                  placeholder="Jahr..."
                  class="filter-inp"
                />
                <input
                  type="text"
                  v-model="columnFilters[col.key].date2"
                  v-if="columnFilters[col.key].dateOp === 'between'"
                  placeholder="Jahr..."
                  class="filter-inp mt-1"
                />
              </template>
              <template v-else>
                <input
                  type="text"
                  v-model="columnFilters[col.key].text"
                  placeholder="Suche..."
                  class="filter-inp"
                />
              </template>
            </div>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="person in displayPersons"
          :key="person.id"
          @click="emit('select', person)"
          :class="{ active: selectedPerson?.id === person.id }"
        >
          <template v-for="col in activeTableColumns" :key="col.key">
            <td>
              <template v-if="!isEditing || !col.editable">
                <span v-if="col.key === 'henry_code'">
                  <strong>{{ getCode(person) || '-' }}</strong>
                </span>
                <span v-else-if="col.key === 'generation'">{{ getGen(person) ?? '-' }}</span>
                <span v-else-if="col.key === 'id'">
                  <small><strong>{{ person.id }}</strong></small>
                </span>
                <span v-else>
                  {{ getPersonAttr(person, col.key) || (col.key === 'given_name' ? 'N.N.' : '-') }}
                </span>
              </template>
              <template v-else-if="editedPersons.get(person.id)">
                <select
                  v-if="col.key === 'sex'"
                  :value="editedPersons.get(person.id)!.sex || 'U'"
                  @change="
                    setPersonAttr(
                      editedPersons.get(person.id)!,
                      'sex',
                      ($event.target as HTMLSelectElement).value
                    )
                  "
                  @click.stop
                >
                  <option value="M">M</option>
                  <option value="F">F</option>
                  <option value="U">U</option>
                </select>
                <div v-else-if="col.key === 'id'" class="xref-input-wrapper" @click.stop>
                  <input
                    :value="getPersonAttr(editedPersons.get(person.id)!, col.key) ?? ''"
                    @input="
                      setPersonAttr(
                        editedPersons.get(person.id)!,
                        col.key,
                        ($event.target as HTMLInputElement).value
                      )
                    "
                    @focus="activeIdField = 'table-' + person.id"
                    @blur="activeIdField = null"
                    :class="{ 'input-warning': !isValidGedcomXref(editedPersons.get(person.id)?.id) }"
                    :placeholder="t('field_required')"
                    class="w-100"
                  />
                  <div
                    v-if="activeIdField === 'table-' + person.id"
                    class="xref-tooltip"
                    @mousedown.prevent
                  >
                    <div class="xref-tooltip-header">
                      <span>📌 {{ t('xref_tooltip_title') }}</span>
                      <span
                        :class="
                          isValidGedcomXref(editedPersons.get(person.id)?.id)
                            ? 'xref-badge-valid'
                            : 'xref-badge-invalid'
                        "
                      >
                        {{
                          isValidGedcomXref(editedPersons.get(person.id)?.id)
                            ? '✓ ' + t('xref_valid')
                            : '⚠️ ' + t('xref_invalid')
                        }}
                      </span>
                    </div>
                    <div class="xref-tooltip-body">
                      {{ t('xref_tooltip_desc') }}
                    </div>
                  </div>
                </div>
                <input
                  v-else
                  :value="getPersonAttr(editedPersons.get(person.id)!, col.key) ?? ''"
                  @input="
                    setPersonAttr(
                      editedPersons.get(person.id)!,
                      col.key,
                      ($event.target as HTMLInputElement).value
                    )
                  "
                  @click.stop
                />
              </template>
            </td>
          </template>
        </tr>
        <tr v-if="displayPersons.length === 0">
          <td :colspan="Math.max(activeTableColumns.length, 1)" class="empty">
            {{ t('no_data') }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.table-container {
  overflow-x: auto;
  overflow-y: auto;
  max-height: 70vh;
  border: 1px solid #dcdde1;
  border-radius: 4px;
  background: white;
}
table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}
th,
td {
  padding: 0.6rem 0.8rem;
  border-bottom: 1px solid #dcdde1;
  font-size: 0.9rem;
}
th {
  background-color: #f5f6fa;
  font-weight: bold;
  color: #2f3640;
  position: sticky;
  top: 0;
  z-index: 1;
  vertical-align: top;
}
.th-header {
  display: flex;
  justify-content: space-between;
  cursor: pointer;
  padding-bottom: 5px;
  border-bottom: 1px solid #dcdde1;
  margin-bottom: 5px;
}
.sort-icon {
  color: #7f8c8d;
  font-size: 0.8rem;
}
.filter-controls {
  font-weight: normal;
}
.filter-inp,
.filter-sel {
  width: 100%;
  box-sizing: border-box;
  font-size: 0.8rem;
  padding: 4px;
  border: 1px solid #bdc3c7;
  border-radius: 3px;
}
.mt-1 {
  margin-top: 1rem;
  display: inline-block;
}
.w-100 {
  width: 100%;
  padding: 0.4rem;
  border: 1px solid #bdc3c7;
  border-radius: 3px;
  box-sizing: border-box;
}
tr {
  cursor: pointer;
}
tr:hover {
  background-color: #f1f2f6;
}
tr.active {
  background-color: #e3f2fd !important;
}
.save-error-banner {
  background: #ffcdd2;
  color: #b71c1c;
  border: 1px solid #e57373;
  padding: 10px 14px;
  border-radius: 4px;
  font-size: 0.95rem;
  margin-bottom: 12px;
  font-weight: bold;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.btn-close-sm {
  background: transparent;
  border: none;
  font-size: 1rem;
  cursor: pointer;
  color: #b71c1c;
  font-weight: bold;
  padding: 0 4px;
}
.input-warning {
  border: 2px solid #e67e22 !important;
  box-shadow: 0 0 6px rgba(230, 126, 34, 0.4) !important;
  background-color: #fffaf0 !important;
}
.xref-input-wrapper {
  position: relative;
  display: block;
  width: 100%;
}
.xref-tooltip {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 1000;
  min-width: 290px;
  max-width: 350px;
  margin-top: 5px;
  padding: 8px 12px;
  background: #2c3e50;
  color: #ecf0f1;
  border-radius: 6px;
  font-size: 0.78rem;
  line-height: 1.4;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.28);
  pointer-events: auto;
  text-align: left;
}
.xref-tooltip-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 5px;
  padding-bottom: 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.15);
  font-weight: 600;
}
.xref-tooltip-body {
  font-size: 0.74rem;
  color: #bdc3c7;
}
.xref-badge-valid {
  color: #2ecc71;
  font-weight: bold;
  font-size: 0.75rem;
}
.xref-badge-invalid {
  color: #e67e22;
  font-weight: bold;
  font-size: 0.75rem;
}
</style>

