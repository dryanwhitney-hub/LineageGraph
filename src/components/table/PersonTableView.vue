<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  isValidGedcomXref,
  type Person,
  type SpouseConnection,
  type ColumnConfig,
  type ColumnFilter,
} from '../../composables/usePersons';

const props = withDefaults(
  defineProps<{
    activeTableColumns: ColumnConfig[];
    displayPersons: Person[];
    allPersons?: Person[];
    selectedPerson: Person | null;
    isEditing: boolean;
    editedPersons: Map<string, Person>;
    sortKey: string;
    sortAsc: boolean;
    columnFilters: Record<string, ColumnFilter>;
    quickSearch?: string;
    activeFilterCount?: number;
    saveErrorAlert: string;
    malePersons?: Person[];
    femalePersons?: Person[];
    getColLabel: (col: ColumnConfig) => string;
    getCode: (person: Person) => string | null;
    getGen: (person: Person) => number | null;
    getPersonAttr: (person: Person, key: string) => any;
    setPersonAttr: (person: Person, key: string, value: string) => void;
  }>(),
  {
    quickSearch: '',
    activeFilterCount: 0,
    allPersons: () => [],
    malePersons: () => [],
    femalePersons: () => [],
  }
);

const emit = defineEmits<{
  select: [person: Person];
  'select-by-id': [personId: string];
  sort: [key: string];
  'update:quickSearch': [val: string];
  'clear-all-filters': [];
  'clear-save-error': [];
  'link-spouses': [payload: { personId: string; partnerId: string }];
  'unlink-family': [payload: { personId: string; familyId: string }];
  'add-child-link': [payload: { parentId: string; childId: string }];
  'remove-child-link': [payload: { parentId: string; childId: string }];
}>();

const { t } = useI18n();
const activeIdField = ref<string | null>(null);
const activeDateFilterCol = ref<string | null>(null);

function toggleDateFilterPopover(colKey: string) {
  activeDateFilterCol.value = activeDateFilterCol.value === colKey ? null : colKey;
}

function isDateFilterActive(colKey: string): boolean {
  const f = props.columnFilters[colKey];
  if (!f) return false;
  return Boolean(f.date1.trim() || (f.dateOp === 'between' && f.date2.trim()));
}

function getDateFilterSummary(colKey: string): string {
  const f = props.columnFilters[colKey];
  if (!f || !f.date1.trim()) return t('table_date_filter_btn');
  if (f.dateOp === 'before') return `📅 < ${f.date1.trim()}`;
  if (f.dateOp === 'after') return `📅 > ${f.date1.trim()}`;
  return `📅 ${f.date1.trim()}–${f.date2.trim() || '...'}`;
}

function clearDateFilterForCol(colKey: string) {
  const f = props.columnFilters[colKey];
  if (f) {
    f.dateOp = 'before';
    f.date1 = '';
    f.date2 = '';
  }
}

// Schnelles O(1) Lookup für Personen
const personPool = computed<Person[]>(() => {
  return props.allPersons && props.allPersons.length > 0 ? props.allPersons : props.displayPersons;
});

const personMap = computed<Map<string, Person>>(() => {
  const map = new Map<string, Person>();
  for (const p of personPool.value) {
    map.set(p.id, p);
  }
  return map;
});

function getPersonById(id: string): Person | undefined {
  return personMap.value.get(id);
}

function getPersonDisplayName(id: string): string {
  const p = getPersonById(id);
  if (!p) return id;
  const name = `${p.surname || ''}, ${p.given_name || 'N.N.'}`.trim();
  return `${name} (${p.id})`;
}

function getPersonShortName(id: string): string {
  const p = getPersonById(id);
  if (!p) return id;
  const name = `${p.given_name || 'N.N.'} ${p.surname || ''}`.trim();
  return name || id;
}

// On-Demand Popover-Zustand für Relationen
const activePopover = ref<{
  type: 'father' | 'mother' | 'spouse' | 'child';
  personId: string;
} | null>(null);
const popoverCandidateId = ref<string>('');
const popoverSearch = ref<string>('');

function toggleAddPopover(
  type: 'father' | 'mother' | 'spouse' | 'child',
  personId: string
) {
  if (activePopover.value?.type === type && activePopover.value?.personId === personId) {
    activePopover.value = null;
  } else {
    activePopover.value = { type, personId };
    popoverSearch.value = '';
    if (type === 'father') {
      popoverCandidateId.value = props.editedPersons.get(personId)?.father_id || '';
    } else if (type === 'mother') {
      popoverCandidateId.value = props.editedPersons.get(personId)?.mother_id || '';
    } else {
      popoverCandidateId.value = '';
    }
  }
}

function getFilteredFatherCandidates(currentPerson: Person): Person[] {
  const q = popoverSearch.value.toLowerCase().trim();
  const pool =
    props.malePersons && props.malePersons.length > 0
      ? props.malePersons
      : personPool.value.filter(p => p.sex === 'M');
  let list = pool.filter(p => p.id !== currentPerson.id);
  if (q) {
    list = list.filter(
      p =>
        p.id.toLowerCase().includes(q) ||
        (p.surname || '').toLowerCase().includes(q) ||
        (p.given_name || '').toLowerCase().includes(q)
    );
  }
  return list.slice(0, 50);
}

function getFilteredMotherCandidates(currentPerson: Person): Person[] {
  const q = popoverSearch.value.toLowerCase().trim();
  const pool =
    props.femalePersons && props.femalePersons.length > 0
      ? props.femalePersons
      : personPool.value.filter(p => p.sex === 'F');
  let list = pool.filter(p => p.id !== currentPerson.id);
  if (q) {
    list = list.filter(
      p =>
        p.id.toLowerCase().includes(q) ||
        (p.surname || '').toLowerCase().includes(q) ||
        (p.given_name || '').toLowerCase().includes(q)
    );
  }
  return list.slice(0, 50);
}

function getFilteredPartnerCandidates(person: Person): Person[] {
  const q = popoverSearch.value.toLowerCase().trim();
  const existingSpouseIds = new Set((person.spouses || []).map(s => s.id));
  let list = personPool.value.filter(p => p.id !== person.id && !existingSpouseIds.has(p.id));
  if (q) {
    list = list.filter(
      p =>
        p.id.toLowerCase().includes(q) ||
        (p.surname || '').toLowerCase().includes(q) ||
        (p.given_name || '').toLowerCase().includes(q)
    );
  }
  return list.slice(0, 50);
}

function getFilteredChildCandidates(person: Person): Person[] {
  const q = popoverSearch.value.toLowerCase().trim();
  const existingChildIds = new Set(person.children_ids || []);
  let list = personPool.value.filter(p => p.id !== person.id && !existingChildIds.has(p.id));
  if (q) {
    list = list.filter(
      p =>
        p.id.toLowerCase().includes(q) ||
        (p.surname || '').toLowerCase().includes(q) ||
        (p.given_name || '').toLowerCase().includes(q)
    );
  }
  return list.slice(0, 50);
}

function confirmSetParent(personId: string, role: 'father' | 'mother') {
  const target = props.editedPersons.get(personId);
  if (target) {
    props.setPersonAttr(target, role, popoverCandidateId.value);
  }
  activePopover.value = null;
}

function confirmAddSpouse(personId: string) {
  if (!popoverCandidateId.value) return;
  emit('link-spouses', { personId, partnerId: popoverCandidateId.value });
  activePopover.value = null;
  popoverCandidateId.value = '';
}

function confirmAddChild(personId: string) {
  if (!popoverCandidateId.value) return;
  emit('add-child-link', { parentId: personId, childId: popoverCandidateId.value });
  activePopover.value = null;
  popoverCandidateId.value = '';
}

function handleUnlinkSpouse(person: Person, sp: SpouseConnection) {
  const spName = getPersonDisplayName(sp.id);
  const msg = t('confirm_unlink_spouse', { name: spName });
  if (window.confirm(msg)) {
    if (sp.family_id) {
      emit('unlink-family', { personId: person.id, familyId: sp.family_id });
    }
  }
}

function handleUnlinkChild(person: Person, childId: string) {
  const childName = getPersonDisplayName(childId);
  const msg = t('confirm_unlink_child', { name: childName });
  if (window.confirm(msg)) {
    emit('remove-child-link', { parentId: person.id, childId });
  }
}

// Client-seitige Paginierung zur DOM-Entlastung bei großen Stammbäumen
const pageSize = ref<number>(100);
const currentPage = ref<number>(1);

const totalEntries = computed(() => props.displayPersons.length);
const totalPages = computed(() => {
  if (pageSize.value === -1) return 1;
  return Math.ceil(totalEntries.value / pageSize.value) || 1;
});

const paginatedPersons = computed(() => {
  if (pageSize.value === -1) return props.displayPersons;
  const start = (currentPage.value - 1) * pageSize.value;
  return props.displayPersons.slice(start, start + pageSize.value);
});

watch(
  () => props.displayPersons.length,
  () => {
    if (currentPage.value > totalPages.value) {
      currentPage.value = 1;
    }
  }
);
</script>

<template>
  <div class="table-view-wrapper" @click="activeDateFilterCol = null">
    <div v-if="saveErrorAlert" class="save-error-banner" @click.stop>
      <span>⚠️ {{ saveErrorAlert }}</span>
      <button class="btn-close-sm" @click="emit('clear-save-error')">✕</button>
    </div>

    <!-- Obere Schnellfilter-Leiste -->
    <div class="table-toolbar" @click.stop>
      <div class="quick-search-box">
        <span class="search-icon">🔍</span>
        <input
          type="text"
          :value="quickSearch"
          @input="emit('update:quickSearch', ($event.target as HTMLInputElement).value)"
          :placeholder="t('table_quick_search_placeholder')"
          class="quick-search-input"
        />
        <button
          v-if="quickSearch"
          type="button"
          class="btn-clear-search"
          @click="emit('update:quickSearch', '')"
        >
          ✕
        </button>
      </div>
      <div class="toolbar-meta">
        <button
          v-if="activeFilterCount > 0"
          type="button"
          class="btn-clear-all-filters"
          @click="emit('clear-all-filters')"
        >
          {{ t('table_clear_all_filters', { count: activeFilterCount }) }}
        </button>
      </div>
    </div>

    <div class="table-scroll-area">
      <table>
        <thead>
          <tr>
            <th v-for="col in activeTableColumns" :key="col.key">
              <div class="th-header" @click="emit('sort', col.key)">
                <span>{{ getColLabel(col) }}<span v-if="col.key === 'id'" style="color: #dc2626;"> *</span></span>
                <span class="sort-icon" :class="{ active: sortKey === col.key }">
                  {{ sortKey === col.key ? (sortAsc ? '▲' : '▼') : '↕' }}
                </span>
              </div>
              <div class="filter-controls" @click.stop v-if="columnFilters[col.key]">
                <template v-if="col.isDate || col.key.includes('date')">
                  <div class="date-filter-wrapper">
                    <button
                      type="button"
                      class="btn-date-filter-trigger"
                      :class="{ active: isDateFilterActive(col.key) }"
                      @click.stop="toggleDateFilterPopover(col.key)"
                    >
                      {{ getDateFilterSummary(col.key) }}
                    </button>
                    <div
                      v-if="activeDateFilterCol === col.key"
                      class="date-filter-popover"
                      @click.stop
                    >
                      <div class="popover-header">
                        <span>{{ getColLabel(col) }}</span>
                        <button type="button" class="btn-popover-close" @click="activeDateFilterCol = null">✕</button>
                      </div>
                      <div class="date-popover-body">
                        <select v-model="columnFilters[col.key].dateOp" class="filter-sel">
                          <option value="before">{{ t('table_date_before') }}</option>
                          <option value="after">{{ t('table_date_after') }}</option>
                          <option value="between">{{ t('table_date_between_from') }} / {{ t('table_date_between_to') }}</option>
                        </select>
                        <input
                          type="text"
                          v-model="columnFilters[col.key].date1"
                          :placeholder="columnFilters[col.key].dateOp === 'between' ? t('table_date_between_from') : 'YYYY'"
                          class="filter-inp"
                        />
                        <input
                          v-if="columnFilters[col.key].dateOp === 'between'"
                          type="text"
                          v-model="columnFilters[col.key].date2"
                          :placeholder="t('table_date_between_to')"
                          class="filter-inp"
                        />
                        <div class="date-popover-actions">
                          <button
                            v-if="isDateFilterActive(col.key)"
                            type="button"
                            class="btn-date-clear"
                            @click="clearDateFilterForCol(col.key)"
                          >
                            {{ t('table_date_clear') }}
                          </button>
                          <button
                            type="button"
                            class="btn-popover-confirm"
                            @click="activeDateFilterCol = null"
                          >
                            {{ t('apply') }}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </template>
                <template v-else>
                  <input
                    type="text"
                    v-model="columnFilters[col.key].text"
                    :placeholder="t('table_filter_placeholder')"
                    class="filter-inp"
                  />
                </template>
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
        <tr
          v-for="person in paginatedPersons"
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
                <span v-else-if="col.key === 'father'">
                  <button
                    v-if="person.father_id"
                    type="button"
                    class="btn-relation-link"
                    @click.stop="emit('select-by-id', person.father_id!)"
                    :title="t('select_prompt')"
                  >
                    {{ getPersonDisplayName(person.father_id) }}
                  </button>
                  <span v-else class="text-muted">-</span>
                </span>
                <span v-else-if="col.key === 'mother'">
                  <button
                    v-if="person.mother_id"
                    type="button"
                    class="btn-relation-link"
                    @click.stop="emit('select-by-id', person.mother_id!)"
                    :title="t('select_prompt')"
                  >
                    {{ getPersonDisplayName(person.mother_id) }}
                  </button>
                  <span v-else class="text-muted">-</span>
                </span>
                <div v-else-if="col.key === 'spouses'" class="chips-container">
                  <template v-if="person.spouses && person.spouses.length > 0">
                    <span
                      v-for="sp in person.spouses"
                      :key="sp.id"
                      class="table-chip spouse-chip"
                      @click.stop="emit('select-by-id', sp.id)"
                      :title="sp.date ? '⚭ ' + sp.date : '⚭'"
                    >
                      ⚭ {{ getPersonShortName(sp.id) }}
                    </span>
                  </template>
                  <span v-else class="text-muted">-</span>
                </div>
                <div v-else-if="col.key === 'children'" class="chips-container">
                  <template v-if="person.children_ids && person.children_ids.length > 0">
                    <span
                      v-for="cid in person.children_ids"
                      :key="cid"
                      class="table-chip child-chip"
                      @click.stop="emit('select-by-id', cid)"
                    >
                      {{ getPersonShortName(cid) }}
                    </span>
                  </template>
                  <span v-else class="text-muted">-</span>
                </div>
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

                <!-- Vater Bearbeitung (On-Demand Popover statt 4500 Options) -->
                <div v-else-if="col.key === 'father'" class="relation-cell-edit" @click.stop>
                  <span class="relation-text-box">
                    {{
                      editedPersons.get(person.id)?.father_id
                        ? getPersonDisplayName(editedPersons.get(person.id)!.father_id!)
                        : t('no_father')
                    }}
                  </span>
                  <button
                    type="button"
                    class="btn-edit-rel-cell"
                    :title="t('edit_father_btn')"
                    @click.stop="toggleAddPopover('father', person.id)"
                  >
                    ✏️
                  </button>
                  <div
                    v-if="activePopover?.type === 'father' && activePopover?.personId === person.id"
                    class="relation-popover"
                    @click.stop
                  >
                    <div class="popover-header">
                      <span>{{ t('col_father') }}</span>
                      <button type="button" class="btn-popover-close" @click="activePopover = null">✕</button>
                    </div>
                    <div class="popover-body">
                      <input
                        v-model="popoverSearch"
                        type="text"
                        :placeholder="t('search_placeholder')"
                        class="popover-search-input"
                        autofocus
                      />
                      <div class="popover-candidates-list">
                        <div
                          class="popover-candidate-item"
                          :class="{ selected: !popoverCandidateId }"
                          @click="popoverCandidateId = ''"
                        >
                          <em>{{ t('no_father') }}</em>
                        </div>
                        <div
                          v-for="cand in getFilteredFatherCandidates(person)"
                          :key="cand.id"
                          class="popover-candidate-item"
                          :class="{ selected: popoverCandidateId === cand.id }"
                          @click="popoverCandidateId = cand.id"
                        >
                          {{ cand.surname || '' }}, {{ cand.given_name || 'N.N.' }}
                          <small class="text-muted">({{ cand.id }})</small>
                        </div>
                      </div>
                      <button
                        type="button"
                        class="btn-popover-confirm"
                        @click="confirmSetParent(person.id, 'father')"
                      >
                        {{ t('apply') }}
                      </button>
                    </div>
                  </div>
                </div>

                <!-- Mutter Bearbeitung (On-Demand Popover) -->
                <div v-else-if="col.key === 'mother'" class="relation-cell-edit" @click.stop>
                  <span class="relation-text-box">
                    {{
                      editedPersons.get(person.id)?.mother_id
                        ? getPersonDisplayName(editedPersons.get(person.id)!.mother_id!)
                        : t('no_mother')
                    }}
                  </span>
                  <button
                    type="button"
                    class="btn-edit-rel-cell"
                    :title="t('edit_mother_btn')"
                    @click.stop="toggleAddPopover('mother', person.id)"
                  >
                    ✏️
                  </button>
                  <div
                    v-if="activePopover?.type === 'mother' && activePopover?.personId === person.id"
                    class="relation-popover"
                    @click.stop
                  >
                    <div class="popover-header">
                      <span>{{ t('col_mother') }}</span>
                      <button type="button" class="btn-popover-close" @click="activePopover = null">✕</button>
                    </div>
                    <div class="popover-body">
                      <input
                        v-model="popoverSearch"
                        type="text"
                        :placeholder="t('search_placeholder')"
                        class="popover-search-input"
                        autofocus
                      />
                      <div class="popover-candidates-list">
                        <div
                          class="popover-candidate-item"
                          :class="{ selected: !popoverCandidateId }"
                          @click="popoverCandidateId = ''"
                        >
                          <em>{{ t('no_mother') }}</em>
                        </div>
                        <div
                          v-for="cand in getFilteredMotherCandidates(person)"
                          :key="cand.id"
                          class="popover-candidate-item"
                          :class="{ selected: popoverCandidateId === cand.id }"
                          @click="popoverCandidateId = cand.id"
                        >
                          {{ cand.surname || '' }}, {{ cand.given_name || 'N.N.' }}
                          <small class="text-muted">({{ cand.id }})</small>
                        </div>
                      </div>
                      <button
                        type="button"
                        class="btn-popover-confirm"
                        @click="confirmSetParent(person.id, 'mother')"
                      >
                        {{ t('apply') }}
                      </button>
                    </div>
                  </div>
                </div>

                <!-- Ehepartner Bearbeitung -->
                <div v-else-if="col.key === 'spouses'" class="chips-edit-container" @click.stop>
                  <div class="chips-container">
                    <span
                      v-for="sp in person.spouses"
                      :key="sp.id"
                      class="table-chip spouse-chip"
                    >
                      <span class="chip-label" @click.stop="emit('select-by-id', sp.id)">
                        ⚭ {{ getPersonShortName(sp.id) }}
                      </span>
                      <button
                        type="button"
                        class="chip-remove-btn"
                        :title="t('unlink_spouse_btn')"
                        @click.stop="handleUnlinkSpouse(person, sp)"
                      >
                        ✕
                      </button>
                    </span>
                    <button
                      type="button"
                      class="btn-chip-add"
                      :title="t('btn_add_spouse')"
                      @click.stop="toggleAddPopover('spouse', person.id)"
                    >
                      ➕
                    </button>
                  </div>
                  <div
                    v-if="activePopover?.type === 'spouse' && activePopover?.personId === person.id"
                    class="relation-popover"
                    @click.stop
                  >
                    <div class="popover-header">
                      <span>⚭ {{ t('btn_add_spouse') }}</span>
                      <button type="button" class="btn-popover-close" @click="activePopover = null">✕</button>
                    </div>
                    <div class="popover-body">
                      <input
                        v-model="popoverSearch"
                        type="text"
                        :placeholder="t('search_placeholder')"
                        class="popover-search-input"
                        autofocus
                      />
                      <div class="popover-candidates-list">
                        <div
                          v-for="cand in getFilteredPartnerCandidates(person)"
                          :key="cand.id"
                          class="popover-candidate-item"
                          :class="{ selected: popoverCandidateId === cand.id }"
                          @click="popoverCandidateId = cand.id"
                        >
                          {{ cand.surname || '' }}, {{ cand.given_name || 'N.N.' }}
                          <small class="text-muted">({{ cand.id }})</small>
                        </div>
                      </div>
                      <button
                        type="button"
                        class="btn-popover-confirm"
                        :disabled="!popoverCandidateId"
                        @click="confirmAddSpouse(person.id)"
                      >
                        {{ t('btn_add_spouse') }}
                      </button>
                    </div>
                  </div>
                </div>

                <!-- Kinder Bearbeitung -->
                <div v-else-if="col.key === 'children'" class="chips-edit-container" @click.stop>
                  <div class="chips-container">
                    <span
                      v-for="cid in person.children_ids"
                      :key="cid"
                      class="table-chip child-chip"
                    >
                      <span class="chip-label" @click.stop="emit('select-by-id', cid)">
                        {{ getPersonShortName(cid) }}
                      </span>
                      <button
                        type="button"
                        class="chip-remove-btn"
                        :title="t('unlink_child_btn')"
                        @click.stop="handleUnlinkChild(person, cid)"
                      >
                        ✕
                      </button>
                    </span>
                    <button
                      type="button"
                      class="btn-chip-add"
                      :title="t('btn_add_child')"
                      @click.stop="toggleAddPopover('child', person.id)"
                    >
                      ➕
                    </button>
                  </div>
                  <div
                    v-if="activePopover?.type === 'child' && activePopover?.personId === person.id"
                    class="relation-popover"
                    @click.stop
                  >
                    <div class="popover-header">
                      <span>{{ t('btn_add_child') }}</span>
                      <button type="button" class="btn-popover-close" @click="activePopover = null">✕</button>
                    </div>
                    <div class="popover-body">
                      <input
                        v-model="popoverSearch"
                        type="text"
                        :placeholder="t('search_placeholder')"
                        class="popover-search-input"
                        autofocus
                      />
                      <div class="popover-candidates-list">
                        <div
                          v-for="cand in getFilteredChildCandidates(person)"
                          :key="cand.id"
                          class="popover-candidate-item"
                          :class="{ selected: popoverCandidateId === cand.id }"
                          @click="popoverCandidateId = cand.id"
                        >
                          {{ cand.surname || '' }}, {{ cand.given_name || 'N.N.' }}
                          <small class="text-muted">({{ cand.id }})</small>
                        </div>
                      </div>
                      <button
                        type="button"
                        class="btn-popover-confirm"
                        :disabled="!popoverCandidateId"
                        @click="confirmAddChild(person.id)"
                      >
                        {{ t('btn_add_child') }}
                      </button>
                    </div>
                  </div>
                </div>

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

    <!-- Paginierungs-Leiste -->
    <div class="pagination-bar" v-if="displayPersons.length > 0">
      <div class="pagination-info">
        {{
          t('showing_entries', {
            start: pageSize === -1 ? 1 : Math.min((currentPage - 1) * pageSize + 1, totalEntries),
            end: pageSize === -1 ? totalEntries : Math.min(currentPage * pageSize, totalEntries),
            total: totalEntries,
          })
        }}
      </div>
      <div class="pagination-controls" v-if="pageSize !== -1 && totalPages > 1">
        <button
          type="button"
          class="btn-page"
          :disabled="currentPage <= 1"
          @click="currentPage = 1"
          title="««"
        >
          ««
        </button>
        <button
          type="button"
          class="btn-page"
          :disabled="currentPage <= 1"
          @click="currentPage--"
          title="‹"
        >
          ‹
        </button>
        <span class="page-indicator">
          {{ t('page_x_of_y', { page: currentPage, total: totalPages }) }}
        </span>
        <button
          type="button"
          class="btn-page"
          :disabled="currentPage >= totalPages"
          @click="currentPage++"
          title="›"
        >
          ›
        </button>
        <button
          type="button"
          class="btn-page"
          :disabled="currentPage >= totalPages"
          @click="currentPage = totalPages"
          title="»»"
        >
          »»
        </button>
      </div>
      <div class="pagination-size">
        <label>{{ t('page_size') }}:</label>
        <select v-model.number="pageSize" @change="currentPage = 1" class="page-size-select">
          <option :value="50">50</option>
          <option :value="100">100</option>
          <option :value="250">250</option>
          <option :value="500">500</option>
          <option :value="-1">{{ t('all_entries') }}</option>
        </select>
      </div>
    </div>
  </div>
</template>

<style scoped>
.table-view-wrapper {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  overflow: hidden;
}

.table-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.55rem 1rem;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
}

.quick-search-box {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  max-width: 520px;
}

.search-icon {
  position: absolute;
  left: 0.65rem;
  font-size: 0.85rem;
  color: #64748b;
  pointer-events: none;
}

.quick-search-input {
  width: 100%;
  padding: 0.4rem 2rem 0.4rem 2.1rem;
  border: 1px solid #cbd5e1;
  border-radius: 7px;
  font-size: 0.83rem;
  background: #ffffff;
  color: #0f172a;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.quick-search-input:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
}

.btn-clear-search {
  position: absolute;
  right: 0.4rem;
  background: transparent;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  font-size: 0.8rem;
  padding: 2px 5px;
  border-radius: 4px;
}

.btn-clear-search:hover {
  color: #334155;
  background: #f1f5f9;
}

.btn-clear-all-filters {
  background: #fee2e2;
  color: #b91c1c;
  border: 1px solid #fecaca;
  border-radius: 6px;
  padding: 0.35rem 0.75rem;
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-clear-all-filters:hover {
  background: #fecaca;
}

.table-scroll-area {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  text-align: left;
}

th,
td {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid #e2e8f0;
  font-size: 0.84rem;
  color: #1e293b;
}

th {
  background-color: #f8fafc;
  font-weight: 700;
  color: #334155;
  position: sticky;
  top: 0;
  z-index: 5;
  vertical-align: top;
  border-bottom: 2px solid #cbd5e1;
}

.th-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.35rem;
  cursor: pointer;
  padding-bottom: 4px;
  margin-bottom: 4px;
  font-size: 0.8rem;
  white-space: nowrap;
  user-select: none;
}

.th-header:hover {
  color: #0f172a;
}

.sort-icon {
  color: #94a3b8;
  font-size: 0.74rem;
}

.sort-icon.active {
  color: #2563eb;
}

.filter-controls {
  font-weight: normal;
}

.filter-inp,
.filter-sel {
  width: 100%;
  box-sizing: border-box;
  font-size: 0.76rem;
  padding: 0.26rem 0.45rem;
  border: 1px solid #cbd5e1;
  border-radius: 5px;
  background: #ffffff;
  color: #0f172a;
}

.filter-inp:focus,
.filter-sel:focus {
  outline: none;
  border-color: #2563eb;
}

.date-filter-wrapper {
  position: relative;
}

.btn-date-filter-trigger {
  width: 100%;
  text-align: left;
  background: #ffffff;
  color: #475569;
  border: 1px solid #cbd5e1;
  border-radius: 5px;
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.btn-date-filter-trigger:hover {
  border-color: #94a3b8;
  background: #f8fafc;
}

.btn-date-filter-trigger.active {
  background: #eff6ff;
  border-color: #3b82f6;
  color: #1d4ed8;
}

.date-filter-popover {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 120;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.16);
  padding: 0.65rem;
  min-width: 220px;
}

.date-popover-body {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.date-popover-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.4rem;
  margin-top: 0.2rem;
}

.btn-date-clear {
  background: #f1f5f9;
  color: #475569;
  border: 1px solid #cbd5e1;
  border-radius: 5px;
  padding: 0.28rem 0.55rem;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
}

.w-100 {
  width: 100%;
  padding: 0.35rem 0.45rem;
  border: 1px solid #cbd5e1;
  border-radius: 5px;
  box-sizing: border-box;
}

tr {
  cursor: pointer;
  transition: background-color 0.1s;
}

tbody tr:hover {
  background-color: #f8fafc;
}

tbody tr.active {
  background-color: #eff6ff !important;
}

tbody tr.active td:first-child {
  box-shadow: inset 3px 0 0 #2563eb;
}

.empty {
  text-align: center;
  padding: 2.5rem 1rem;
  color: #64748b;
  font-size: 0.9rem;
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

/* Relationale Spalten-Stile */
.btn-relation-link {
  background: none;
  border: none;
  color: #2980b9;
  font-size: 0.85rem;
  padding: 0;
  text-align: left;
  cursor: pointer;
  text-decoration: underline;
  display: inline-block;
}
.btn-relation-link:hover {
  color: #1a5276;
}
.text-muted {
  color: #95a5a6;
}
.chips-container {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}
.chips-edit-container {
  position: relative;
  display: inline-block;
  width: 100%;
}
.table-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border-radius: 12px;
  font-size: 0.78rem;
  white-space: nowrap;
  background: #edf2f7;
  border: 1px solid #cbd5e0;
}
.spouse-chip {
  background: #fef3c7;
  border-color: #f59e0b;
  color: #92400e;
}
.child-chip {
  background: #dbeafe;
  border-color: #3b82f6;
  color: #1e40af;
}
.chip-label {
  cursor: pointer;
}
.chip-label:hover {
  text-decoration: underline;
}
.chip-remove-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  color: #dc2626;
  font-size: 0.75rem;
  padding: 0 2px;
  line-height: 1;
  font-weight: bold;
}
.chip-remove-btn:hover {
  color: #991b1b;
}
.btn-chip-add {
  background: #e2e8f0;
  border: 1px dashed #94a3b8;
  border-radius: 10px;
  padding: 1px 6px;
  font-size: 0.72rem;
  cursor: pointer;
}
.btn-chip-add:hover {
  background: #cbd5e1;
}

/* Edit-Zelle für Eltern */
.relation-cell-edit {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  background: #f8f9fa;
  border: 1px solid #dcdde1;
  border-radius: 4px;
  padding: 2px 6px;
}
.relation-text-box {
  font-size: 0.82rem;
  color: #2c3e50;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 160px;
}
.btn-edit-rel-cell {
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 0.8rem;
  padding: 0 2px;
}
.btn-edit-rel-cell:hover {
  transform: scale(1.15);
}

/* Relationen Popover */
.relation-popover {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 100;
  margin-top: 4px;
  background: white;
  border: 1px solid #cbd5e0;
  border-radius: 6px;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.22);
  padding: 8px;
  min-width: 260px;
  max-width: 340px;
}
.popover-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
  font-weight: bold;
  font-size: 0.82rem;
  color: #2c3e50;
  border-bottom: 1px solid #edf2f7;
  padding-bottom: 4px;
}
.btn-popover-close {
  background: none;
  border: none;
  cursor: pointer;
  color: #718096;
  font-weight: bold;
  font-size: 0.9rem;
}
.popover-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.popover-search-input {
  font-size: 0.8rem;
  padding: 4px 6px;
  border: 1px solid #3498db;
  border-radius: 4px;
  width: 100%;
  box-sizing: border-box;
}
.popover-candidates-list {
  max-height: 180px;
  overflow-y: auto;
  border: 1px solid #edf2f7;
  border-radius: 4px;
  display: flex;
  flex-direction: column;
}
.popover-candidate-item {
  padding: 5px 8px;
  font-size: 0.8rem;
  cursor: pointer;
  border-bottom: 1px solid #f1f2f6;
  text-align: left;
}
.popover-candidate-item:hover {
  background-color: #ebf5fb;
}
.popover-candidate-item.selected {
  background-color: #3498db;
  color: white;
}
.popover-candidate-item.selected small {
  color: #ecf0f1;
}
.btn-popover-confirm {
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 4px;
  padding: 5px 8px;
  font-size: 0.8rem;
  font-weight: bold;
  cursor: pointer;
  margin-top: 2px;
}
.btn-popover-confirm:hover:not(:disabled) {
  background: #2563eb;
}
.btn-popover-confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Paginierung */
.pagination-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 1rem;
  background-color: #f8fafc;
  border-top: 1px solid #e2e8f0;
  font-size: 0.82rem;
  color: #334155;
  flex-wrap: wrap;
  gap: 8px;
  flex-shrink: 0;
}
.pagination-info {
  font-size: 0.8rem;
  color: #64748b;
  font-weight: 500;
}
.pagination-controls {
  display: flex;
  align-items: center;
  gap: 6px;
}
.btn-page {
  padding: 0.25rem 0.55rem;
  background-color: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 5px;
  color: #334155;
  cursor: pointer;
  font-size: 0.78rem;
  font-weight: 700;
  transition: all 0.15s;
}
.btn-page:hover:not(:disabled) {
  background-color: #2563eb;
  color: #ffffff;
  border-color: #1d4ed8;
}
.btn-page:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.page-indicator {
  font-size: 0.8rem;
  font-weight: 700;
  padding: 0 4px;
  color: #0f172a;
}
.pagination-size {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: #475569;
}
.page-size-select {
  padding: 0.22rem 0.45rem;
  border: 1px solid #cbd5e1;
  border-radius: 5px;
  background-color: #ffffff;
  color: #0f172a;
  font-size: 0.8rem;
}
</style>
