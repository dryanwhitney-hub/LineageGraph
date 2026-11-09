<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { ResearchTaskDto, TaskStatus, ResearchPortalConfig } from '../../types/research';
import { useResearchPortals } from '../../composables/useResearchPortals';

interface PersonCandidate {
  id: string;
  given_name: string | null;
  surname: string | null;
}

interface RootAncestorConfig {
  person_id: string;
  starting_code: string;
  given_name: string | null;
  surname: string | null;
}

interface PersonTaskGroup {
  person_id: string;
  person_name: string;
  proband_code: string | null;
  generation: number | null;
  person_birth_date: string | null;
  person_birth_place: string | null;
  person_death_date: string | null;
  person_death_place: string | null;
  person_sex: string | null;
  tasks: ResearchTaskDto[];
  open_count: number;
  highest_priority_score: number;
  highest_priority_label: string;
}

const { t, locale } = useI18n();

const props = defineProps<{
  tasks: ResearchTaskDto[];
  stats: {
    total_gaps: number;
    open_count: number;
    in_progress_count: number;
    completed_count: number;
    ignored_count: number;
    missing_parents_count: number;
    missing_death_count: number;
    missing_place_count: number;
    child_gap_count: number;
  };
  isLoading: boolean;
  error: string | null;
  persons: PersonCandidate[];
  rootAncestors: RootAncestorConfig[];
  activeProbandId: string | null;
  selectedPersonId: string | null;
  scopeType: string;
  selectedGapType: string;
  selectedStatus: string;
  searchQuery: string;
  sortBy: 'priority' | 'name' | 'generation';
}>();

const emit = defineEmits<{
  (e: 'update:scopeType', val: string): void;
  (e: 'update:activeProbandId', id: string): void;
  (e: 'update:selectedPersonId', id: string): void;
  (e: 'update:selectedGapType', val: string): void;
  (e: 'update:selectedStatus', val: string): void;
  (e: 'update:searchQuery', val: string): void;
  (e: 'update:sortBy', val: 'priority' | 'name' | 'generation'): void;
  (e: 'refresh'): void;
  (e: 'update-task', task: ResearchTaskDto, status: TaskStatus, notes?: string | null): void;
  (e: 'navigate-tree', personId: string): void;
  (e: 'navigate-table', personId: string): void;
  (e: 'open-details', personId: string, taskId?: string): void;
}>();

// Darstellungsmodus: 'grouped' (nach Personen-Dossier) oder 'list' (flache Liste)
const viewMode = ref<'grouped' | 'list'>('grouped');

// Filter: Erledigte Lücken ausblenden für maximalen Fokus
const hideCompleted = ref<boolean>(false);

// Ausgewählter Task für fokussierte Lücken-Highlights
const selectedTaskId = ref<string | null>(null);

function handleSelectPerson(personId: string) {
  selectedTaskId.value = null;
  emit('update:selectedPersonId', personId);
  emit('open-details', personId);
}

function handleSelectTask(personId: string, taskId: string) {
  selectedTaskId.value = taskId;
  emit('update:selectedPersonId', personId);
  emit('open-details', personId, taskId);
}

// Ausgeklappte Lücken-Akkordeons
const expandedTaskIds = ref<Set<string>>(new Set());

function toggleAccordion(taskId: string) {
  const next = new Set(expandedTaskIds.value);
  if (next.has(taskId)) {
    next.delete(taskId);
  } else {
    next.add(taskId);
  }
  expandedTaskIds.value = next;
}

function isExpanded(taskId: string): boolean {
  return expandedTaskIds.value.has(taskId);
}

// Recherche-Portale
const { getEnabledPortals, generatePortalUrl } = useResearchPortals();
const enabledPortals = computed(() => getEnabledPortals());

const personPickerFilter = ref<string>('');

const filteredPersonCandidates = computed(() => {
  const q = personPickerFilter.value.trim().toLowerCase();
  if (!q) {
    return props.persons.slice(0, 150);
  }
  return props.persons
    .filter(p => {
      const name = `${p.given_name || ''} ${p.surname || ''}`.toLowerCase();
      return name.includes(q) || p.id.toLowerCase().includes(q);
    })
    .slice(0, 150);
});

// Gruppierung der Tasks nach Person für die differenzierte Betrachtung im Dossier
const groupedPersons = computed<PersonTaskGroup[]>(() => {
  const map = new Map<string, PersonTaskGroup>();

  for (const task of props.tasks) {
    let group = map.get(task.person_id);
    if (!group) {
      group = {
        person_id: task.person_id,
        person_name: task.person_name,
        proband_code: task.proband_code,
        generation: task.generation,
        person_birth_date: task.person_birth_date,
        person_birth_place: task.person_birth_place,
        person_death_date: task.person_death_date,
        person_death_place: task.person_death_place,
        person_sex: task.person_sex,
        tasks: [],
        open_count: 0,
        highest_priority_score: 0,
        highest_priority_label: 'low',
      };
      map.set(task.person_id, group);
    }
    group.tasks.push(task);
    if (task.status === 'open' || task.status === 'in_progress') {
      group.open_count++;
    }
    if (task.priority_score > group.highest_priority_score) {
      group.highest_priority_score = task.priority_score;
      group.highest_priority_label = task.priority_label;
    }
  }

  const list = Array.from(map.values());
  if (props.sortBy === 'priority') {
    list.sort((a, b) => b.highest_priority_score - a.highest_priority_score);
  } else if (props.sortBy === 'name') {
    list.sort((a, b) => a.person_name.localeCompare(b.person_name));
  } else if (props.sortBy === 'generation') {
    list.sort((a, b) => (a.generation ?? 999) - (b.generation ?? 999));
  }
  return list;
});

const displayedGroupedPersons = computed<PersonTaskGroup[]>(() => {
  if (!hideCompleted.value) {
    return groupedPersons.value;
  }
  return groupedPersons.value.filter(grp => grp.open_count > 0);
});

function getPersonNames(personId: string, fallbackName: string): { given: string; surname: string } {
  const p = props.persons.find(cand => cand.id === personId);
  if (p) {
    return {
      given: p.given_name || '',
      surname: p.surname || '',
    };
  }
  const parts = fallbackName.trim().split(/\s+/);
  if (parts.length > 1) {
    return {
      given: parts.slice(0, -1).join(' '),
      surname: parts[parts.length - 1],
    };
  }
  return { given: fallbackName, surname: '' };
}

async function openPortalForPerson(portal: ResearchPortalConfig, grp: PersonTaskGroup) {
  const names = getPersonNames(grp.person_id, grp.person_name);
  const url = generatePortalUrl(portal, {
    givenName: names.given,
    surname: names.surname,
    birthDate: grp.person_birth_date,
    deathDate: grp.person_death_date,
    birthPlace: grp.person_birth_place,
    deathPlace: grp.person_death_place,
  });
  if (url) {
    await handleExternalLink(url);
  }
}

async function openPortalForTask(portal: ResearchPortalConfig, task: ResearchTaskDto) {
  const names = getPersonNames(task.person_id, task.person_name);
  const url = generatePortalUrl(portal, {
    givenName: names.given,
    surname: names.surname,
    birthDate: task.person_birth_date,
    deathDate: task.person_death_date,
    birthPlace: task.person_birth_place,
    deathPlace: task.person_death_place,
  });
  if (url) {
    await handleExternalLink(url);
  }
}

function markAllCompletedForPerson(grp: PersonTaskGroup) {
  for (const task of grp.tasks) {
    if (task.status !== 'completed' && task.status !== 'ignored') {
      emit('update-task', task, 'completed', task.notes);
    }
  }
}

function filterByPerson(personId: string, scope: 'single_person' | 'person_ancestors' | 'person_descendants' = 'single_person') {
  emit('update:selectedPersonId', personId);
  emit('update:scopeType', scope);
}

onMounted(() => {
  emit('refresh');
});

// Local editing state for task notes
const editingNotesTaskId = ref<string | null>(null);
const localNotes = ref<Record<string, string>>({});

function startEditingNotes(task: ResearchTaskDto) {
  editingNotesTaskId.value = task.id;
  localNotes.value[task.id] = task.notes || '';
}

function saveNotes(task: ResearchTaskDto) {
  const noteVal = localNotes.value[task.id] ?? '';
  emit('update-task', task, task.status as TaskStatus, noteVal);
  editingNotesTaskId.value = null;
}

function cancelEditingNotes() {
  editingNotesTaskId.value = null;
}

function handleStatusChange(task: ResearchTaskDto, newStatus: TaskStatus) {
  emit('update-task', task, newStatus, task.notes);
}

async function handleExternalLink(url: string | null) {
  if (!url) return;
  try {
    await openUrl(url);
  } catch (e) {
    console.error('Failed to open external URL:', e);
  }
}

function getPriorityLabelText(label: string) {
  switch (label) {
    case 'urgent':
      return t('research.priorityUrgent', 'Dringend');
    case 'high':
      return t('research.priorityHigh', 'Hoch');
    case 'medium':
      return t('research.priorityMedium', 'Mittel');
    default:
      return t('research.priorityLow', 'Gering');
  }
}

function getGapTypeName(type: string) {
  switch (type) {
    case 'MISSING_PARENTS':
      return t('research.typeMissingParents', 'Eltern');
    case 'MISSING_DEATH':
      return t('research.typeMissingDeath', 'Tod');
    case 'MISSING_PLACE':
      return t('research.typeMissingPlace', 'Orte');
    case 'CHILD_GAP':
      return t('research.typeChildGap', 'Kinderlücke');
    default:
      return type;
  }
}
</script>

<template>
  <div class="research-container">
    <!-- 1. Header & KPI Dashboard -->
    <header class="research-header">
      <div class="research-header-top">
        <div class="header-titles">
          <h2 class="header-main-title">
            <span class="header-icon">🔬</span>
            {{ t('research.title', 'Forschungsassistent & Lücken-Finder') }}
          </h2>
          <p class="header-subtitle">
            {{ t('research.subtitle', 'Automatische Erkennung genealogischer Lücken mit konkreten Rechercheempfehlungen und Archiv-Links.') }}
          </p>
        </div>

        <button
          type="button"
          @click="emit('refresh')"
          :disabled="isLoading"
          class="btn-refresh"
          :title="t('research.refreshTooltip', 'Neu analysieren')"
        >
          <span class="refresh-spinner" :class="{ 'is-spinning': isLoading }">↻</span>
          {{ t('research.refresh', 'Aktualisieren') }}
        </button>
      </div>

      <!-- KPI Dashboard Kacheln -->
      <div class="kpi-grid">
        <div class="kpi-card kpi-total">
          <span class="kpi-label">{{ t('research.statTotal', 'Lücken gesamt') }}</span>
          <span class="kpi-value">{{ stats.total_gaps }}</span>
        </div>
        <div class="kpi-card kpi-open">
          <span class="kpi-label">{{ t('research.statOpen', 'Offen') }}</span>
          <span class="kpi-value text-amber">{{ stats.open_count }}</span>
        </div>
        <div class="kpi-card kpi-progress">
          <span class="kpi-label">{{ t('research.statInProgress', 'In Recherche') }}</span>
          <span class="kpi-value text-blue">{{ stats.in_progress_count }}</span>
        </div>
        <div class="kpi-card kpi-completed">
          <span class="kpi-label">{{ t('research.statCompleted', 'Erledigt') }}</span>
          <span class="kpi-value text-green">{{ stats.completed_count }}</span>
        </div>
        <div class="kpi-card kpi-ignored">
          <span class="kpi-label">{{ t('research.statIgnored', 'Ignoriert') }}</span>
          <span class="kpi-value text-muted">{{ stats.ignored_count }}</span>
        </div>
      </div>
    </header>

    <!-- 2. Filter- & Werkzeugleiste -->
    <div class="research-toolbar">
      <div class="toolbar-left">
        <!-- Scope Auswahl -->
        <div class="filter-group">
          <label class="filter-label">{{ t('research.scopeLabel', 'Bereich:') }}</label>
          <select
            :value="scopeType"
            @change="emit('update:scopeType', ($event.target as HTMLSelectElement).value)"
            class="filter-select"
          >
            <option value="all">{{ t('research.scopeAll', 'Gesamter Stammbaum') }}</option>
            <optgroup label="Bezug zum Probanden">
              <option value="proband_ancestors">{{ t('research.scopeProbandAncestors', 'Vorfahren des Probanden') }}</option>
              <option value="proband_descendants">{{ t('research.scopeProbandDescendants', 'Nachkommen des Probanden') }}</option>
            </optgroup>
            <optgroup label="Bezug zu gewählter Person">
              <option value="single_person">{{ t('research.scopeSinglePerson', 'Nur gewählte Person') }}</option>
              <option value="person_ancestors">{{ t('research.scopePersonAncestors', 'Vorfahren der gewählten Person') }}</option>
              <option value="person_descendants">{{ t('research.scopePersonDescendants', 'Nachkommen der gewählten Person') }}</option>
            </optgroup>
          </select>
        </div>

        <!-- Proband-Auswahl (aktiv bei Probanden-Scope) -->
        <div v-if="scopeType === 'proband_ancestors' || scopeType === 'proband_descendants'" class="filter-group highlight-picker">
          <label class="filter-label">🌳 {{ t('research.activeProbandLabel', 'Proband:') }}</label>
          <select
            :value="activeProbandId ?? ''"
            @change="emit('update:activeProbandId', ($event.target as HTMLSelectElement).value)"
            class="filter-select filter-select-active"
          >
            <option v-if="rootAncestors.length === 0" value="" disabled>
              {{ t('research.noProbandConfigured', 'Kein Proband definiert') }}
            </option>
            <option v-for="r in rootAncestors" :key="r.person_id" :value="r.person_id">
              [{{ r.starting_code }}] {{ r.surname || 'N.N.' }}, {{ r.given_name || 'N.N.' }} ({{ r.person_id }})
            </option>
          </select>
        </div>

        <!-- Personen-Auswahl (aktiv bei Einzelfigur/Personen-Scope) -->
        <div v-if="scopeType.startsWith('person_') || scopeType === 'single_person'" class="filter-group highlight-picker">
          <label class="filter-label">👤 {{ t('research.personLabel', 'Person:') }}</label>
          <input
            type="text"
            v-model="personPickerFilter"
            :placeholder="t('research.searchPersonFilter', 'Filtern...')"
            class="filter-input-small"
          />
          <select
            :value="selectedPersonId ?? ''"
            @change="emit('update:selectedPersonId', ($event.target as HTMLSelectElement).value)"
            class="filter-select filter-select-active"
          >
            <option value="" disabled>{{ t('research.selectPersonPrompt', 'Person auswählen...') }}</option>
            <option v-for="p in filteredPersonCandidates" :key="p.id" :value="p.id">
              {{ p.surname || 'N.N.' }}, {{ p.given_name || 'N.N.' }} ({{ p.id }})
            </option>
          </select>
        </div>

        <!-- Ansichts-Modus Toggle (Personen-Dossiers vs. Liste) -->
        <div class="pill-group view-mode-pills">
          <button
            type="button"
            @click="viewMode = 'grouped'"
            :class="['pill-btn', { active: viewMode === 'grouped' }]"
            :title="t('research.viewModeGrouped', 'Personen-Forschungsdossiers anzeigen')"
          >
            👥 {{ t('research.viewModeGrouped', 'Personen-Dossiers') }}
          </button>
          <button
            type="button"
            @click="viewMode = 'list'"
            :class="['pill-btn', { active: viewMode === 'list' }]"
            :title="t('research.viewModeList', 'Alle Lücken als flache Liste anzeigen')"
          >
            📑 {{ t('research.viewModeList', 'Einzelliste') }}
          </button>
        </div>

        <!-- Schnell-Schalter: Erledigte ausblenden -->
        <label class="toggle-hide-completed" :title="t('research.hideCompletedTitle', 'Bereits erledigte oder ignorierte Lücken ausblenden')">
          <input type="checkbox" v-model="hideCompleted" />
          <span>{{ t('research.hideCompleted', 'Erledigte ausblenden') }}</span>
        </label>

        <!-- Lückentyp Filter -->
        <div class="pill-group">
          <button
            type="button"
            @click="emit('update:selectedGapType', 'all')"
            :class="['pill-btn', { active: selectedGapType === 'all' }]"
          >
            {{ t('common.all', 'Alle Typen') }}
          </button>
          <button
            type="button"
            @click="emit('update:selectedGapType', 'MISSING_PARENTS')"
            :class="['pill-btn', { active: selectedGapType === 'MISSING_PARENTS' }]"
          >
            {{ t('research.typeMissingParents', 'Eltern') }}
          </button>
          <button
            type="button"
            @click="emit('update:selectedGapType', 'MISSING_DEATH')"
            :class="['pill-btn', { active: selectedGapType === 'MISSING_DEATH' }]"
          >
            {{ t('research.typeMissingDeath', 'Tod') }}
          </button>
          <button
            type="button"
            @click="emit('update:selectedGapType', 'MISSING_PLACE')"
            :class="['pill-btn', { active: selectedGapType === 'MISSING_PLACE' }]"
          >
            {{ t('research.typeMissingPlace', 'Orte') }}
          </button>
          <button
            type="button"
            @click="emit('update:selectedGapType', 'CHILD_GAP')"
            :class="['pill-btn', { active: selectedGapType === 'CHILD_GAP' }]"
          >
            {{ t('research.typeChildGap', 'Kinderlücken') }}
          </button>
        </div>

        <!-- Status Filter -->
        <div class="pill-group">
          <button
            type="button"
            @click="emit('update:selectedStatus', 'all')"
            :class="['pill-btn', { active: selectedStatus === 'all' }]"
          >
            {{ t('research.statusAll', 'Alle Status') }}
          </button>
          <button
            type="button"
            @click="emit('update:selectedStatus', 'open')"
            :class="['pill-btn', { active: selectedStatus === 'open' }]"
          >
            {{ t('research.statusOpen', 'Offen') }}
          </button>
          <button
            type="button"
            @click="emit('update:selectedStatus', 'in_progress')"
            :class="['pill-btn', { active: selectedStatus === 'in_progress' }]"
          >
            {{ t('research.statusInProgress', 'In Recherche') }}
          </button>
          <button
            type="button"
            @click="emit('update:selectedStatus', 'completed')"
            :class="['pill-btn', { active: selectedStatus === 'completed' }]"
          >
            {{ t('research.statusCompleted', 'Erledigt') }}
          </button>
          <button
            type="button"
            @click="emit('update:selectedStatus', 'ignored')"
            :class="['pill-btn', { active: selectedStatus === 'ignored' }]"
          >
            {{ t('research.statusIgnored', 'Ignoriert') }}
          </button>
        </div>
      </div>

      <div class="toolbar-right">
        <!-- Freitext-Suchfeld -->
        <div class="search-wrap">
          <span class="search-icon">🔍</span>
          <input
            type="text"
            :value="searchQuery"
            @input="emit('update:searchQuery', ($event.target as HTMLInputElement).value)"
            :placeholder="t('research.searchPlaceholder', 'Suche nach Person, Ort, Titel...')"
            class="search-input"
          />
        </div>

        <!-- Sortierung -->
        <div class="filter-group">
          <label class="filter-label">{{ t('research.sortLabel', 'Sortierung:') }}</label>
          <select
            :value="sortBy"
            @change="emit('update:sortBy', ($event.target as HTMLSelectElement).value as any)"
            class="filter-select"
          >
            <option value="priority">{{ t('research.sortPriority', 'Nach Priorität') }}</option>
            <option value="name">{{ t('research.sortName', 'Nach Name') }}</option>
            <option value="generation">{{ t('research.sortGeneration', 'Nach Generation') }}</option>
          </select>
        </div>
      </div>
    </div>

    <!-- 3. Haupt-Inhaltsbereich -->
    <main class="research-content">
      <!-- Fehler-Meldung -->
      <div v-if="error" class="alert-box alert-error">
        <span>⚠️ {{ error }}</span>
        <button type="button" @click="emit('refresh')" class="btn-retry">{{ t('common.retry', 'Erneut versuchen') }}</button>
      </div>

      <!-- Lade-Zustand -->
      <div v-if="isLoading" class="state-container">
        <div class="big-spinner">↻</div>
        <p class="state-text">{{ t('research.analyzingTree', 'Stammbaum wird auf Lücken analysiert...') }}</p>
      </div>

      <!-- Leer-Zustand -->
      <div v-else-if="tasks.length === 0" class="state-container">
        <div class="empty-icon-wrap">✓</div>
        <h3 class="empty-title">{{ t('research.noGapsFound', 'Keine Lücken gefunden') }}</h3>
        <p class="empty-desc">
          {{ t('research.noGapsHint', 'Für die ausgewählten Filterkriterien wurden keine offenen genealogischen Lücken erkannt.') }}
        </p>
      </div>

      <!-- Leer-Zustand bei aktivem "Erledigte ausblenden" Filter -->
      <div v-else-if="viewMode === 'grouped' && displayedGroupedPersons.length === 0" class="state-container">
        <div class="empty-icon-wrap">🎉</div>
        <h3 class="empty-title">{{ t('research.allCompletedInScope', 'Hervorragend!') }}</h3>
        <p class="empty-desc">
          {{ t('research.allCompletedHint', 'Alle Lücken für diesen Bereich wurden als erledigt oder ignoriert markiert.') }}
        </p>
      </div>

      <!-- ANSICHT 1: PERSONEN-FORSCHUNGSDOSSIERS (Kompakt, scannbar, zentralisierte Portale) -->
      <div v-else-if="viewMode === 'grouped'" class="grouped-dossiers-list">
        <div
          v-for="grp in displayedGroupedPersons"
          :key="grp.person_id"
          class="person-dossier-card"
          :class="{
            'all-resolved': grp.open_count === 0,
            'is-selected-dossier': selectedPersonId === grp.person_id
          }"
        >
          <!-- DOSSIER HEADER: Name, Vitaldaten, Health Indicator, Schnellnavigation -->
          <div class="dossier-header">
            <div class="dossier-main-info">
              <div class="person-name-row">
                <span class="person-gender-badge">{{ grp.person_sex === 'F' ? '♀' : '♂' }}</span>
                <h3
                  class="person-title-name"
                  @click="handleSelectPerson(grp.person_id)"
                  :title="t('research.openDrawerTitle', 'Personendetails öffnen')"
                >
                  {{ grp.person_name }}
                </h3>

                <span v-if="grp.proband_code" class="badge badge-henry" :title="t('table.henryCode', 'Henry Code')">
                  {{ grp.proband_code }} (Gen. {{ grp.generation ?? '?' }})
                </span>

                <!-- Health / Completeness Meter -->
                <span v-if="grp.open_count === 0" class="badge-health badge-health-done">
                  ✓ {{ t('research.allResolved', 'Alle Lücken geschlossen') }}
                </span>
                <span v-else class="badge-health badge-health-open">
                  ⚠️ {{ grp.open_count }} {{ t('research.gapsOpenCount', 'offen') }} / {{ grp.tasks.length }}
                </span>
              </div>

              <!-- Vitaldaten Zeile (Geburt / Tod / Orte) -->
              <div
                class="person-vitals-row"
                v-if="grp.person_birth_date || grp.person_death_date || grp.person_birth_place || grp.person_death_place"
              >
                <span v-if="grp.person_birth_date || grp.person_birth_place" class="vital-item">
                  <span class="vital-symbol">*</span>
                  {{ grp.person_birth_date || '' }}
                  {{ grp.person_birth_place ? 'in ' + grp.person_birth_place : '' }}
                </span>
                <span v-if="(grp.person_birth_date || grp.person_birth_place) && (grp.person_death_date || grp.person_death_place)" class="vital-sep">·</span>
                <span v-if="grp.person_death_date || grp.person_death_place" class="vital-item">
                  <span class="vital-symbol">†</span>
                  {{ grp.person_death_date || '' }}
                  {{ grp.person_death_place ? 'in ' + grp.person_death_place : '' }}
                </span>
              </div>
            </div>

            <!-- Header Action Controls -->
            <div class="dossier-header-actions">
              <!-- Batch Action: Alle erledigt -->
              <button
                v-if="grp.open_count > 0"
                type="button"
                class="btn-dossier-batch"
                @click="markAllCompletedForPerson(grp)"
                :title="t('research.markAllCompletedTitle', 'Alle offenen Lücken dieser Person als erledigt markieren')"
              >
                ✓ {{ t('research.markAllCompleted', 'Alle als erledigt') }}
              </button>

              <!-- Scope Quick-Buttons -->
              <div class="scope-mini-group">
                <button
                  type="button"
                  class="btn-mini-scope"
                  @click="filterByPerson(grp.person_id, 'single_person')"
                  :title="t('research.scopeSinglePerson', 'Nur diese Person analysieren')"
                >
                  🎯 Nur diese
                </button>
                <button
                  type="button"
                  class="btn-mini-scope"
                  @click="filterByPerson(grp.person_id, 'person_ancestors')"
                  :title="t('research.scopePersonAncestors', 'Vorfahren dieser Person analysieren')"
                >
                  🌿 Vorfahren
                </button>
                <button
                  type="button"
                  class="btn-mini-scope"
                  @click="filterByPerson(grp.person_id, 'person_descendants')"
                  :title="t('research.scopePersonDescendants', 'Nachkommen dieser Person analysieren')"
                >
                  🌱 Nachkommen
                </button>
              </div>

              <!-- Jump Navigation -->
              <div class="app-jump-group">
                <button
                  type="button"
                  @click="emit('navigate-tree', grp.person_id)"
                  class="btn-jump-action"
                  :title="t('research.jumpTreeTitle', 'Im Stammbaum zentrieren')"
                >
                  🌳 Baum
                </button>
                <button
                  type="button"
                  @click="emit('navigate-table', grp.person_id)"
                  class="btn-jump-action"
                  :title="t('research.jumpTableTitle', 'In Tabelle filtern')"
                >
                  📋 Tabelle
                </button>
                <button
                  type="button"
                  @click="handleSelectPerson(grp.person_id)"
                  class="btn-jump-action btn-jump-primary"
                  :title="t('research.openDrawerTitle', 'Detail-Seitenleiste öffnen')"
                >
                  🔍 Details
                </button>
              </div>
            </div>
          </div>

          <!-- DOSSIER PORTALS BAR: Einmalige Recherche-Leiste für die Person -->
          <div class="dossier-portals-bar">
            <span class="portals-bar-label">🌐 {{ t('research.researchInLabel', 'Recherchieren in:') }}</span>
            <div class="portals-buttons-wrap">
              <button
                v-for="portal in enabledPortals"
                :key="portal.id"
                type="button"
                class="btn-portal-search"
                @click="openPortalForPerson(portal, grp)"
                :title="(locale === 'de' ? portal.description_de : portal.description_en) + ' (öffnet Browser)'"
              >
                <span class="portal-btn-icon">{{ portal.icon || '🔎' }}</span>
                <span class="portal-btn-name">{{ portal.name }}</span>
                <span class="portal-btn-arrow">↗</span>
              </button>

              <span v-if="enabledPortals.length === 0" class="no-portals-hint">
                {{ t('research.noPortalsActive', 'Keine Recherche-Portale aktiv. In den Einstellungen konfigurieren.') }}
              </span>
            </div>
          </div>

          <!-- DOSSIER GAP CHECKLIST: Kompakte Matrix mit 1-Klick-Status & aufklappbaren Details -->
          <div class="dossier-gap-checklist">
            <div
              v-for="task in grp.tasks"
              :key="task.id"
              class="gap-check-row"
              :class="{
                'is-completed': task.status === 'completed',
                'is-ignored': task.status === 'ignored',
                'is-in-progress': task.status === 'in_progress',
                'is-expanded': isExpanded(task.id),
                'is-selected-task': selectedTaskId === task.id
              }"
            >
              <div class="gap-row-main" @click="toggleAccordion(task.id); handleSelectTask(grp.person_id, task.id)">
                <!-- Spalte 1: Lückentyp Badge & Kurztext -->
                <div class="gap-cell-info">
                  <span :class="['badge-gap-type', 'type-' + task.gap_type.toLowerCase()]">
                    {{ getGapTypeName(task.gap_type) }}
                  </span>
                  <strong class="gap-title-text">{{ task.title }}</strong>

                  <!-- Konkreter Archivhinweis als diskreter Badge -->
                  <span v-if="task.archive_hint" class="pill-archive-hint" :title="task.archive_hint">
                    🏛️ {{ task.archive_hint }}
                  </span>
                </div>

                <!-- Spalte 2: Priorität -->
                <div class="gap-cell-prio">
                  <span :class="['badge-prio-mini', 'prio-' + task.priority_label]">
                    {{ getPriorityLabelText(task.priority_label) }} ({{ task.priority_score }})
                  </span>
                </div>

                <!-- Spalte 3: Interaktiver 1-Klick Status-Wähler -->
                <div class="gap-cell-status" @click.stop>
                  <select
                    :value="task.status"
                    @change="handleStatusChange(task, ($event.target as HTMLSelectElement).value as TaskStatus)"
                    class="status-pill-select"
                    :class="'select-status-' + task.status"
                  >
                    <option value="open">🟠 {{ t('research.statusOpen', 'Offen') }}</option>
                    <option value="in_progress">🔵 {{ t('research.statusInProgress', 'In Recherche') }}</option>
                    <option value="completed">🟢 {{ t('research.statusCompleted', 'Erledigt') }}</option>
                    <option value="ignored">⚪ {{ t('research.statusIgnored', 'Ignoriert') }}</option>
                  </select>
                </div>

                <!-- Spalte 4: Aufklapp-Pfeil -->
                <div class="gap-cell-toggle">
                  <button
                    type="button"
                    class="btn-accordion-chevron"
                    :title="isExpanded(task.id) ? t('common.collapse', 'Einklappen') : t('common.expand', 'Ausklappen')"
                  >
                    {{ isExpanded(task.id) ? '▲' : '▼' }}
                  </button>
                </div>
              </div>

              <!-- Ausgeklappter Detailbereich (Empfehlung & Notizfeld) -->
              <div v-if="isExpanded(task.id)" class="gap-row-details">
                <p class="gap-desc-full">{{ task.description }}</p>

                <div class="gap-advice-box">
                  <div class="gap-advice-title">💡 {{ t('research.adviceTitle', 'Empfohlene nächste Schritte:') }}</div>
                  <p class="gap-advice-text">{{ task.advice }}</p>
                </div>

                <!-- Notizen zu dieser Lücke -->
                <div class="gap-notes-box">
                  <div v-if="editingNotesTaskId !== task.id">
                    <div v-if="task.notes" class="notes-preview">
                      <div class="notes-text-wrap">
                        <span class="notes-kicker">📝 {{ t('research.notesLabel', 'Recherche-Notiz:') }}</span>
                        <p class="notes-body">{{ task.notes }}</p>
                      </div>
                      <button type="button" @click="startEditingNotes(task)" class="btn-notes-edit">
                        ✏️ {{ t('common.edit', 'Bearbeiten') }}
                      </button>
                    </div>
                    <div v-else>
                      <button type="button" @click="startEditingNotes(task)" class="btn-notes-add">
                        + {{ t('research.addNote', 'Recherche-Notiz hinzufügen...') }}
                      </button>
                    </div>
                  </div>
                  <div v-else class="notes-editing-wrap">
                    <textarea
                      v-model="localNotes[task.id]"
                      rows="2"
                      class="notes-textarea"
                      :placeholder="t('research.notesPlaceholder', 'Eigene Forschungsnotizen (z.B. Archiv-Signatur, Stand der Anfrage)...')"
                    ></textarea>
                    <div class="notes-btn-row">
                      <button type="button" @click="cancelEditingNotes" class="btn-notes-cancel">{{ t('common.cancel', 'Abbrechen') }}</button>
                      <button type="button" @click="saveNotes(task)" class="btn-notes-save">{{ t('common.save', 'Speichern') }}</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ANSICHT 2: FLACHE EINZELLISTE (Für Gesamtübersicht nach Priorität) -->
      <div v-else class="task-cards-list">
        <div
          v-for="task in tasks"
          :key="task.id"
          class="task-card"
          :class="[
            'status-' + task.status,
            'prio-' + task.priority_label,
            {
              'is-completed': task.status === 'completed',
              'is-selected-task': selectedTaskId === task.id
            }
          ]"
          @click="handleSelectTask(task.person_id, task.id)"
        >
          <!-- Karten-Header -->
          <div class="card-header">
            <div class="card-person-info">
              <span
                class="person-title-link"
                @click.stop="handleSelectPerson(task.person_id)"
                :title="t('research.openDrawerTitle', 'Personendetails öffnen')"
              >
                {{ task.person_name }}
              </span>

              <span v-if="task.proband_code" class="badge badge-henry" :title="t('table.henryCode', 'Henry Code')">
                {{ task.proband_code }} (Gen. {{ task.generation ?? '?' }})
              </span>

              <span :class="['badge-gap-type', 'type-' + task.gap_type.toLowerCase()]">
                {{ getGapTypeName(task.gap_type) }}
              </span>

              <span :class="['badge-prio-mini', 'prio-' + task.priority_label]">
                {{ getPriorityLabelText(task.priority_label) }} ({{ task.priority_score }})
              </span>
            </div>

            <!-- Status Dropdown -->
            <div class="card-status-select-wrap">
              <select
                :value="task.status"
                @change="handleStatusChange(task, ($event.target as HTMLSelectElement).value as TaskStatus)"
                class="status-pill-select"
                :class="'select-status-' + task.status"
              >
                <option value="open">🟠 {{ t('research.statusOpen', 'Offen') }}</option>
                <option value="in_progress">🔵 {{ t('research.statusInProgress', 'In Recherche') }}</option>
                <option value="completed">🟢 {{ t('research.statusCompleted', 'Erledigt') }}</option>
                <option value="ignored">⚪ {{ t('research.statusIgnored', 'Ignoriert') }}</option>
              </select>
            </div>
          </div>

          <h4 class="card-task-title">{{ task.title }}</h4>
          <p class="card-desc">{{ task.description }}</p>

          <!-- Ratschlag -->
          <div class="card-advice-box">
            <div class="advice-title">💡 {{ t('research.adviceTitle', 'Empfohlene nächste Schritte:') }}</div>
            <p class="advice-text">{{ task.advice }}</p>

            <div v-if="task.archive_hint" class="archive-hint-callout">
              <strong>🏛️ {{ t('research.archiveHintLabel', 'Archiv-Tipp:') }}</strong>
              <span>{{ task.archive_hint }}</span>
            </div>
          </div>

          <!-- Dynamische Recherche-Portale -->
          <div class="card-portals-row">
            <span class="portals-bar-label">🌐 {{ t('research.researchInLabel', 'Recherchieren in:') }}</span>
            <div class="portals-buttons-wrap">
              <button
                v-for="portal in enabledPortals"
                :key="portal.id"
                type="button"
                class="btn-portal-search"
                @click="openPortalForTask(portal, task)"
                :title="(locale === 'de' ? portal.description_de : portal.description_en) + ' ↗'"
              >
                <span>{{ portal.icon || '🔎' }}</span>
                <span>{{ portal.name }} ↗</span>
              </button>
            </div>
          </div>

          <!-- Notizen -->
          <div class="notes-container">
            <div v-if="editingNotesTaskId !== task.id">
              <div v-if="task.notes" class="notes-preview">
                <div class="notes-text-wrap">
                  <span class="notes-kicker">📝 {{ t('research.notesLabel', 'Recherche-Notiz:') }}</span>
                  <p class="notes-body">{{ task.notes }}</p>
                </div>
                <button type="button" @click="startEditingNotes(task)" class="btn-notes-edit">
                  ✏️ {{ t('common.edit', 'Bearbeiten') }}
                </button>
              </div>
              <div v-else>
                <button type="button" @click="startEditingNotes(task)" class="btn-notes-add">
                  + {{ t('research.addNote', 'Recherche-Notiz hinzufügen...') }}
                </button>
              </div>
            </div>
            <div v-else class="notes-editing-wrap">
              <textarea
                v-model="localNotes[task.id]"
                rows="2"
                class="notes-textarea"
                :placeholder="t('research.notesPlaceholder', 'Eigene Forschungsnotizen (z.B. Archiv-Signatur, Stand der Anfrage)...')"
              ></textarea>
              <div class="notes-btn-row">
                <button type="button" @click="cancelEditingNotes" class="btn-notes-cancel">{{ t('common.cancel', 'Abbrechen') }}</button>
                <button type="button" @click="saveNotes(task)" class="btn-notes-save">{{ t('common.save', 'Speichern') }}</button>
              </div>
            </div>
          </div>

          <!-- Aktionen -->
          <div class="card-footer-actions">
            <button
              type="button"
              @click="emit('navigate-tree', task.person_id)"
              class="btn-action"
              :title="t('research.jumpTreeTitle', 'Im Stammbaum zentrieren')"
            >
              🌳 {{ t('research.jumpTree', 'Im Baum zeigen') }}
            </button>
            <button
              type="button"
              @click="emit('navigate-table', task.person_id)"
              class="btn-action"
              :title="t('research.jumpTableTitle', 'In Tabelle filtern')"
            >
              📋 {{ t('research.jumpTable', 'In Tabelle zeigen') }}
            </button>
            <button
              type="button"
              @click.stop="handleSelectTask(task.person_id, task.id)"
              class="btn-action btn-action-primary"
              :title="t('research.openDrawerTitle', 'Detail-Seitenleiste öffnen')"
            >
              🔍 {{ t('research.openDrawer', 'Details öffnen') }}
            </button>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.research-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background-color: #f8fafc;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: #1e293b;
}

/* 1. Header & KPI */
.research-header {
  background-color: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  padding: 16px 24px 12px 24px;
  flex-shrink: 0;
}
.research-header-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}
.header-main-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 1.25rem;
  font-weight: 700;
  color: #0f172a;
  margin: 0;
}
.header-icon {
  font-size: 1.4rem;
}
.header-subtitle {
  margin: 3px 0 0 0;
  font-size: 0.84rem;
  color: #64748b;
}
.btn-refresh {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  font-size: 0.85rem;
  font-weight: 600;
  color: #1e293b;
  background-color: #f1f5f9;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn-refresh:hover:not(:disabled) {
  background-color: #e2e8f0;
}
.refresh-spinner {
  display: inline-block;
  font-size: 1rem;
}
.refresh-spinner.is-spinning {
  animation: spin 1s linear infinite;
}

/* KPI Dashboard */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
}
.kpi-card {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.kpi-label {
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #64748b;
}
.kpi-value {
  font-size: 1.35rem;
  font-weight: 700;
  color: #0f172a;
}
.text-amber { color: #d97706; }
.text-blue { color: #2563eb; }
.text-green { color: #16a34a; }
.text-muted { color: #64748b; }

/* 2. Toolbar */
.research-toolbar {
  background-color: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  padding: 10px 24px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.toolbar-left, .toolbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.filter-group {
  display: flex;
  align-items: center;
  gap: 6px;
}
.filter-label {
  font-size: 0.8rem;
  font-weight: 600;
  color: #475569;
}
.filter-select {
  padding: 5px 10px;
  font-size: 0.82rem;
  color: #1e293b;
  background-color: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  outline: none;
}
.highlight-picker {
  background: #f0fdf4;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid #bbf7d0;
}
.filter-select-active {
  border-color: #16a34a;
  font-weight: 600;
}
.filter-input-small {
  padding: 4px 8px;
  font-size: 0.8rem;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  width: 90px;
}

/* Pills */
.pill-group {
  display: inline-flex;
  background-color: #f1f5f9;
  border-radius: 6px;
  padding: 2px;
  border: 1px solid #e2e8f0;
}
.pill-btn {
  padding: 4px 10px;
  font-size: 0.78rem;
  font-weight: 500;
  color: #475569;
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.pill-btn:hover {
  color: #0f172a;
}
.pill-btn.active {
  background-color: #ffffff;
  color: #0f172a;
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}
.view-mode-pills .pill-btn.active {
  background-color: #2563eb;
  color: #ffffff;
}

/* Toggle Hide Completed */
.toggle-hide-completed {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.78rem;
  font-weight: 600;
  color: #475569;
  background: #f8fafc;
  padding: 4px 8px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
}
.toggle-hide-completed input {
  cursor: pointer;
}

/* Search */
.search-wrap {
  position: relative;
  display: flex;
  align-items: center;
}
.search-icon {
  position: absolute;
  left: 8px;
  font-size: 0.85rem;
  color: #94a3b8;
  pointer-events: none;
}
.search-input {
  padding: 5px 10px 5px 28px;
  font-size: 0.82rem;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  width: 220px;
}

/* 3. Main Content */
.research-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
}

/* States */
.state-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 280px;
  text-align: center;
}
.big-spinner {
  font-size: 2.2rem;
  color: #2563eb;
  animation: spin 1s linear infinite;
  margin-bottom: 12px;
}
.empty-icon-wrap {
  font-size: 2.4rem;
  margin-bottom: 8px;
}
.empty-title {
  font-size: 1.15rem;
  font-weight: 700;
  color: #1e293b;
  margin: 0 0 6px 0;
}
.empty-desc {
  font-size: 0.85rem;
  color: #64748b;
  max-width: 440px;
  margin: 0;
}

/* DOSSIER CARD (PERSONEN-FORSCHUNGSDOSSIER) */
.grouped-dossiers-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.person-dossier-card {
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  overflow: hidden;
  transition: all 0.15s ease;
}
.person-dossier-card.all-resolved {
  border-color: #bbf7d0;
  background: #fafdfa;
}
.person-dossier-card.is-selected-dossier {
  border-color: #3b82f6 !important;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25) !important;
}

/* Dossier Header */
.dossier-header {
  padding: 12px 16px;
  background: #ffffff;
  border-bottom: 1px solid #f1f5f9;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
}
.dossier-main-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.person-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.person-gender-badge {
  font-size: 1rem;
  font-weight: 700;
  color: #64748b;
}
.person-title-name {
  font-size: 1.05rem;
  font-weight: 700;
  color: #0f172a;
  margin: 0;
  cursor: pointer;
  transition: color 0.15s ease;
}
.person-title-name:hover {
  color: #2563eb;
  text-decoration: underline;
}
.badge-henry {
  background: #f1f5f9;
  color: #475569;
  font-size: 0.72rem;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 4px;
  border: 1px solid #e2e8f0;
}
.badge-health {
  font-size: 0.72rem;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 12px;
}
.badge-health-done {
  background: #dcfce7;
  color: #15803d;
}
.badge-health-open {
  background: #fef3c7;
  color: #b45309;
}

/* Vitaldaten Zeile */
.person-vitals-row {
  font-size: 0.8rem;
  color: #64748b;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.vital-symbol {
  font-weight: 700;
  color: #475569;
}
.vital-sep {
  color: #cbd5e1;
}

/* Dossier Header Actions */
.dossier-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.btn-dossier-batch {
  padding: 4px 10px;
  font-size: 0.76rem;
  font-weight: 600;
  color: #15803d;
  background: #dcfce7;
  border: 1px solid #86efac;
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn-dossier-batch:hover {
  background: #bbf7d0;
}
.scope-mini-group, .app-jump-group {
  display: inline-flex;
  gap: 4px;
}
.btn-mini-scope, .btn-jump-action {
  padding: 4px 8px;
  font-size: 0.75rem;
  font-weight: 500;
  color: #475569;
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn-mini-scope:hover, .btn-jump-action:hover {
  background: #e2e8f0;
  color: #0f172a;
}
.btn-jump-primary {
  background: #eff6ff;
  border-color: #bfdbfe;
  color: #1e40af;
  font-weight: 600;
}
.btn-jump-primary:hover {
  background: #dbeafe;
}

/* DOSSIER PORTALS BAR (Einmalige Recherche-Leiste) */
.dossier-portals-bar {
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  padding: 7px 16px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.portals-bar-label {
  font-size: 0.75rem;
  font-weight: 700;
  color: #475569;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.portals-buttons-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.btn-portal-search {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  font-size: 0.75rem;
  font-weight: 600;
  color: #1e293b;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn-portal-search:hover {
  background: #f1f5f9;
  border-color: #3b82f6;
  color: #2563eb;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}
.portal-btn-icon {
  font-size: 0.85rem;
}
.portal-btn-arrow {
  font-size: 0.7rem;
  color: #94a3b8;
}
.no-portals-hint {
  font-size: 0.74rem;
  color: #94a3b8;
  font-style: italic;
}

/* DOSSIER GAP CHECKLIST (Matrix) */
.dossier-gap-checklist {
  display: flex;
  flex-direction: column;
}
.gap-check-row {
  border-bottom: 1px solid #f1f5f9;
  transition: background-color 0.12s ease;
}
.gap-check-row:last-child {
  border-bottom: none;
}
.gap-check-row:hover {
  background-color: #f8fafc;
}
.gap-check-row.is-selected-task {
  background-color: #eff6ff !important;
  border-left: 3px solid #2563eb !important;
}
.gap-check-row.is-completed {
  opacity: 0.65;
  background-color: #fcfdfc;
}
.gap-check-row.is-completed .gap-title-text {
  text-decoration: line-through;
  color: #64748b;
}
.gap-row-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  gap: 12px;
  cursor: pointer;
  user-select: none;
}
.gap-cell-info {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
  flex-wrap: wrap;
}
.badge-gap-type {
  font-size: 0.7rem;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  white-space: nowrap;
}
.type-missing_parents { background: #fee2e2; color: #991b1b; }
.type-missing_death { background: #fef3c7; color: #92400e; }
.type-missing_place { background: #e0f2fe; color: #075985; }
.type-child_gap { background: #f3e8ff; color: #6b21a8; }

.gap-title-text {
  font-size: 0.84rem;
  color: #1e293b;
}
.pill-archive-hint {
  font-size: 0.72rem;
  background: #f1f5f9;
  color: #475569;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 1px 8px;
  white-space: nowrap;
}

.gap-cell-prio {
  flex-shrink: 0;
}
.badge-prio-mini {
  font-size: 0.68rem;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
}
.prio-urgent { background: #fee2e2; color: #b91c1c; }
.prio-high { background: #ffedd5; color: #c2410c; }
.prio-medium { background: #fef9c3; color: #854d0e; }
.prio-low { background: #f1f5f9; color: #475569; }

.gap-cell-status {
  flex-shrink: 0;
}
.status-pill-select {
  padding: 3px 8px;
  font-size: 0.75rem;
  font-weight: 600;
  border-radius: 14px;
  border: 1px solid transparent;
  cursor: pointer;
  outline: none;
}
.select-status-open {
  background: #fef3c7;
  color: #92400e;
  border-color: #fde68a;
}
.select-status-in_progress {
  background: #dbeafe;
  color: #1e40af;
  border-color: #bfdbfe;
}
.select-status-completed {
  background: #dcfce7;
  color: #15803d;
  border-color: #bbf7d0;
}
.select-status-ignored {
  background: #f1f5f9;
  color: #64748b;
  border-color: #cbd5e1;
}

.gap-cell-toggle {
  flex-shrink: 0;
}
.btn-accordion-chevron {
  background: transparent;
  border: none;
  font-size: 0.7rem;
  color: #94a3b8;
  cursor: pointer;
  padding: 2px 4px;
}
.gap-check-row:hover .btn-accordion-chevron {
  color: #3b82f6;
}

/* Accordion Details */
.gap-row-details {
  padding: 8px 16px 14px 44px;
  background: #f8fafc;
  border-top: 1px dashed #e2e8f0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.gap-desc-full {
  margin: 0;
  font-size: 0.8rem;
  color: #475569;
}
.gap-advice-box {
  background: #ffffff;
  border-left: 3px solid #3b82f6;
  border-radius: 0 4px 4px 0;
  padding: 8px 12px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}
.gap-advice-title {
  font-size: 0.76rem;
  font-weight: 700;
  color: #1e3a8a;
  margin-bottom: 2px;
}
.gap-advice-text {
  font-size: 0.78rem;
  color: #334155;
  margin: 0;
  line-height: 1.4;
}

/* Notes inside row */
.gap-notes-box {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 8px 10px;
}
.notes-preview {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}
.notes-text-wrap {
  flex: 1;
}
.notes-kicker {
  font-size: 0.72rem;
  font-weight: 700;
  color: #64748b;
  text-transform: uppercase;
}
.notes-body {
  font-size: 0.78rem;
  color: #1e293b;
  margin: 2px 0 0 0;
  white-space: pre-wrap;
}
.btn-notes-edit, .btn-notes-add {
  background: transparent;
  border: none;
  font-size: 0.74rem;
  color: #2563eb;
  cursor: pointer;
  font-weight: 500;
  padding: 0;
}
.btn-notes-edit:hover, .btn-notes-add:hover {
  text-decoration: underline;
}
.notes-editing-wrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.notes-textarea {
  width: 100%;
  padding: 6px 8px;
  font-size: 0.78rem;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  box-sizing: border-box;
  font-family: inherit;
  resize: vertical;
}
.notes-btn-row {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
.btn-notes-cancel, .btn-notes-save {
  padding: 3px 8px;
  font-size: 0.74rem;
  border-radius: 4px;
  cursor: pointer;
}
.btn-notes-cancel {
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  color: #475569;
}
.btn-notes-save {
  background: #2563eb;
  border: 1px solid #2563eb;
  color: #ffffff;
  font-weight: 600;
}

/* FLAT LIST CARDS (ANSICHT 2) */
.task-cards-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.task-card {
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 14px 18px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.task-card.is-completed {
  opacity: 0.65;
}
.task-card.is-selected-task {
  border-color: #3b82f6 !important;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25) !important;
}
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.card-person-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.person-title-link {
  font-weight: 700;
  font-size: 0.95rem;
  color: #0f172a;
  cursor: pointer;
}
.person-title-link:hover {
  color: #2563eb;
  text-decoration: underline;
}
.card-task-title {
  font-size: 0.95rem;
  font-weight: 700;
  margin: 0;
  color: #1e293b;
}
.card-desc {
  font-size: 0.82rem;
  color: #475569;
  margin: 0;
}
.card-advice-box {
  background: #f8fafc;
  border-left: 3px solid #3b82f6;
  border-radius: 0 4px 4px 0;
  padding: 8px 12px;
}
.advice-title {
  font-size: 0.76rem;
  font-weight: 700;
  color: #1e3a8a;
  margin-bottom: 2px;
}
.advice-text {
  font-size: 0.78rem;
  color: #334155;
  margin: 0;
}
.archive-hint-callout {
  margin-top: 6px;
  font-size: 0.75rem;
  color: #475569;
  background: #f1f5f9;
  padding: 4px 8px;
  border-radius: 4px;
}
.card-portals-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.notes-container {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 8px 10px;
}
.card-footer-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  border-top: 1px solid #f1f5f9;
  padding-top: 8px;
}
.btn-action {
  padding: 4px 10px;
  font-size: 0.76rem;
  font-weight: 500;
  color: #475569;
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn-action:hover {
  background: #e2e8f0;
  color: #0f172a;
}
.btn-action-primary {
  background: #eff6ff;
  border-color: #bfdbfe;
  color: #1e40af;
  font-weight: 600;
}
.btn-action-primary:hover {
  background: #dbeafe;
}

/* Animations */
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
