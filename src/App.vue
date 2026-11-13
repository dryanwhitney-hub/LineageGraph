<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import DesignTree from './components/DesignTree.vue';
import ExportView from './components/ExportView.vue';
import PersonTableView from './components/table/PersonTableView.vue';
import TreeCanvasView from './components/tree/TreeCanvasView.vue';
import PersonDetailsDrawer from './components/details/PersonDetailsDrawer.vue';
import DeleteTreeModal from './components/modals/DeleteTreeModal.vue';
import DeletePersonModal, { type DeletePersonTarget } from './components/modals/DeletePersonModal.vue';
import PersonMergeModal from './components/modals/PersonMergeModal.vue';
import AddPersonModal from './components/modals/AddPersonModal.vue';
import SettingsModal, { type SettingsTab } from './components/modals/SettingsModal.vue';
import GedcomImportModal from './components/modals/GedcomImportModal.vue';
import UpdateConfirmModal from './components/modals/UpdateConfirmModal.vue';
import ResearchAssistantView from './components/research/ResearchAssistantView.vue';
import StatisticsView from './components/stats/StatisticsView.vue';
import { usePersons, type Person, type PersonMergeFieldsDto } from './composables/usePersons';
import type { IsolatedBranchDto } from './types/research';
import { useShortestPath } from './composables/useShortestPath';
import { useAppUpdater } from './composables/useAppUpdater';
import { useResearchAssistant } from './composables/useResearchAssistant';

const { t, locale } = useI18n();

const {
  currentVersion,
  newVersion,
  releaseNotes,
  releaseDate,
  isDownloading,
  downloadProgress,
  statusMessage: updaterStatusMessage,
  statusType: updaterStatusType,
  showConfirmModal,
  checkForUpdates,
  confirmInstall,
  dismissConfirmModal,
} = useAppUpdater();

const currentView = ref<'table' | 'tree' | 'design' | 'export' | 'research' | 'stats'>('table');
const currentTreeRootId = ref<string | null>(null);
const freeInitialRootId = ref<string | null>(null);
const showSettings = ref<boolean>(false);
const activeSettingsTab = ref<SettingsTab>('general');
const isDetailsOpen = ref<boolean>(true);

const expandedNodes = ref<Map<string, boolean>>(new Map());
const expandedSideNodes = ref<Map<string, { spouses: boolean; parents: boolean }>>(new Map());
const expandedFromChildMap = ref<Map<string, string>>(new Map());

// Canvas Panning & Zooming
const pan = ref({ x: 0, y: 0 });
const zoom = ref(1);

const {
  trees,
  activeTree,
  newTreeName,
  persons,
  rootAncestors,
  editedPersons,
  selectedPerson,
  personDetails,
  selectedFatherId,
  selectedMotherId,
  parentEditError,
  selectedRootId,
  newRootCode,
  rootSearchQuery,
  activeProbandTab,
  isEditing,
  saveErrorAlert,
  statusMessage,
  isLoading,
  showDeleteTreeModal,
  treeToDelete,
  showAddModal,
  addPersonError,
  designConfig,
  columns,
  sortKey,
  sortAsc,
  columnFilters,
  tableQuickSearch,
  activeFilterCount,
  clearAllColumnFilters,
  activeTableColumns,
  activeDetailColumns,
  hasInvalidEditedPerson,
  malePersons,
  femalePersons,
  displayPersons,
  filteredPersons,
  getColLabel,
  sortBy,
  getCode,
  getGen,
  getPersonAttr,
  setPersonAttr,
  getRelCode,
  getActiveStartCode,
  loadRootAncestors,
  addRootAncestor,
  removeRootAncestor,
  calculateCodes,
  loadDetails,
  handleImport,
  selectedImportFilePath,
  isImportModalVisible,
  onImportModalCompleted,
  toggleEditMode,
  saveChanges,
  savePersonParents,
  editedSpouses,
  marriageEditError,
  relationActionError,
  setSpouseAttr,
  saveMarriageDetails,
  linkSpouses,
  unlinkFamily,
  addChildLink,
  removeChildLink,
  calculateNextIdFromPersons,
  moveColumn,
  handleTreeSwitch,
  createNewTree,
  startDeleteTree,
  cancelDeleteTree,
  confirmDeleteTree,
  openAddModal,
  handleAddPerson,
  initTrees,
  deletePerson,
  deletePersonsBatch,
  mergePersons,
  loadPersons,
} = usePersons(t, {
  onIdRenamed: (oldId, newId) => {
    if (currentTreeRootId.value === oldId) {
      currentTreeRootId.value = newId;
    }
  },
  onCodesCalculated: () => {
    // Keep settings modal open when recalculating Henry codes in the background
  },
  onResetTreeViewState: () => {
    isDetailsOpen.value = false;
    clearPartnerPath();
    currentTreeRootId.value = null;
    freeInitialRootId.value = null;
    expandedNodes.value.clear();
    expandedSideNodes.value.clear();
    expandedFromChildMap.value.clear();
  },
  onSetProbandTab: personId => {
    setProbandTab(personId);
  },
  onEnsureTableView: () => {
    currentView.value = 'table';
  },
});

const {
  activePartnerPath,
  highlightedPathIds,
  shortestPathIncludeSpouses,
  shortestPathSearchQuery,
  shortestPathSearchResults,
  clearPartnerPath,
  showPartnerPath,
  startShortestPathTo,
  jumpToTreePerson,
} = useShortestPath({
  persons,
  selectedPerson,
  activeProbandTab,
  getActiveStartCode,
  currentView,
  currentTreeRootId,
  freeInitialRootId,
  pan,
  expandedNodes,
  expandedSideNodes,
  expandedFromChildMap,
  rootAncestors,
  setProbandTab,
});

function setProbandTab(personId: string | null) {
  activeProbandTab.value = personId;
  clearPartnerPath();
  pan.value = { x: 0, y: 0 };
  zoom.value = 1;
  currentTreeRootId.value = null;
  freeInitialRootId.value = null;
  expandedNodes.value.clear();
  expandedSideNodes.value.clear();
  expandedFromChildMap.value.clear();
  if (personId) {
    const root = persons.value.find(p => p.id === personId);
    if (root) expandedNodes.value.set(root.id, true);
  }
}

function onProbandSelectChange(val: string) {
  setProbandTab(val || null);
}

async function onQuickTreeSelectChange(val: string) {
  if (val === '__manage__') {
    activeSettingsTab.value = 'general';
    showSettings.value = true;
    await loadRootAncestors();
    return;
  }
  activeTree.value = val;
  await handleTreeSwitch();
}

function changeLanguage(lang: string) {
  locale.value = lang;
}

async function openUserGuide() {
  try {
    await invoke('open_user_guide');
  } catch {
    try {
      await openUrl('https://github.com/dryanwhitney-hub/LineageGraph/blob/main/USER_GUIDE.md');
    } catch {
      window.open('https://github.com/dryanwhitney-hub/LineageGraph/blob/main/USER_GUIDE.md', '_blank');
    }
  }
}

const {
  stats: researchStats,
  isLoading: isResearchLoading,
  error: researchError,
  scopeType: researchScopeType,
  selectedGapType: selectedResearchGapType,
  selectedStatus: selectedResearchStatus,
  searchQuery: researchSearchQuery,
  sortBy: researchSortBy,
  filteredTasks: filteredResearchTasks,
  loadTasks: loadResearchTasks,
  updateTask: updateResearchTask,
  isolatedBranchesData,
  isLoadingBranches,
  errorBranches: researchBranchesError,
  loadIsolatedBranches,
} = useResearchAssistant(
  () => activeProbandTab.value,
  () => selectedPerson.value?.id || null
);

function onResearchNavigateTree(personId: string) {
  jumpToTreePerson(personId);
  isDetailsOpen.value = true;
}

// Person- und Zweig-Löschung
const showDeletePersonModal = ref(false);
const deletePersonTarget = ref<DeletePersonTarget | null>(null);
const isDeletingPerson = ref(false);

function handleRequestDeletePerson(personId: string) {
  const p = persons.value.find(item => item.id === personId);
  if (!p) return;
  deletePersonTarget.value = {
    type: 'person',
    id: personId,
    name: `${p.given_name || ''} ${p.surname || ''} (${personId})`.trim(),
    personIds: [personId],
  };
  showDeletePersonModal.value = true;
}

function handleRequestDeleteBranch(branch: IsolatedBranchDto) {
  const personIds = branch.persons.map(p => p.id);
  deletePersonTarget.value = {
    type: 'branch',
    id: String(branch.id),
    name: branch.name,
    personIds,
  };
  showDeletePersonModal.value = true;
}

async function handleConfirmDelete(personIds: string[]) {
  isDeletingPerson.value = true;
  try {
    if (personIds.length === 1) {
      await deletePerson(personIds[0]);
    } else {
      await deletePersonsBatch(personIds);
    }
    if (selectedPerson.value && personIds.includes(selectedPerson.value.id)) {
      selectedPerson.value = null;
    }
    await loadPersons();
    await loadResearchTasks();
    await loadIsolatedBranches();
    showDeletePersonModal.value = false;
  } catch (err) {
    console.error('Fehler beim Löschen:', err);
  } finally {
    isDeletingPerson.value = false;
  }
}

// Person Merge Modal & Picker
const showMergeModal = ref(false);
const mergeTargetPerson = ref<Person | null>(null);
const mergeSourcePerson = ref<Person | null>(null);
const isMergingPersons = ref(false);

const showMergePickerModal = ref(false);
const mergePickerSearchQuery = ref('');
const mergePickerInitiatorPerson = ref<Person | null>(null);

const mergePickerCandidates = computed(() => {
  const query = mergePickerSearchQuery.value.toLowerCase().trim();
  const initId = mergePickerInitiatorPerson.value?.id;
  return persons.value
    .filter(
      p =>
        p.id !== initId &&
        (!query ||
          p.id.toLowerCase().includes(query) ||
          (p.given_name || '').toLowerCase().includes(query) ||
          (p.surname || '').toLowerCase().includes(query))
    )
    .slice(0, 15);
});

function handleOpenMergeForPerson(personId: string) {
  const p = persons.value.find(item => item.id === personId);
  if (!p) return;
  mergePickerInitiatorPerson.value = p;
  mergePickerSearchQuery.value = '';
  showMergePickerModal.value = true;
}

function handleSelectMergeCandidate(candidate: Person) {
  showMergePickerModal.value = false;
  if (!mergePickerInitiatorPerson.value) return;
  mergeTargetPerson.value = mergePickerInitiatorPerson.value;
  mergeSourcePerson.value = candidate;
  showMergeModal.value = true;
}

function handleRequestMergeTwoPersons(targetId: string, sourceId: string) {
  const tPerson = persons.value.find(item => item.id === targetId);
  const sPerson = persons.value.find(item => item.id === sourceId);
  if (!tPerson || !sPerson) return;
  mergeTargetPerson.value = tPerson;
  mergeSourcePerson.value = sPerson;
  showMergeModal.value = true;
}

async function handleConfirmMerge(payload: {
  targetId: string;
  sourceId: string;
  fields: PersonMergeFieldsDto;
}) {
  isMergingPersons.value = true;
  try {
    await mergePersons(payload.targetId, payload.sourceId, payload.fields);
    await loadPersons();
    const updated = persons.value.find(p => p.id === payload.targetId);
    if (updated) {
      selectedPerson.value = updated;
    }
    await loadResearchTasks();
    await loadIsolatedBranches();
    showMergeModal.value = false;
  } catch (err) {
    console.error('Fehler bei der Zusammenführung:', err);
  } finally {
    isMergingPersons.value = false;
  }
}

function onResearchNavigateTable(personId: string) {
  const p = persons.value.find(item => item.id === personId);
  if (p) {
    selectedPerson.value = p;
    tableQuickSearch.value = `${p.given_name || ''} ${p.surname || ''}`.trim();
  }
  currentView.value = 'table';
  isDetailsOpen.value = true;
}

const selectedResearchTaskId = ref<string | null>(null);

const activePersonResearchGaps = computed(() => {
  if (!selectedPerson.value) return [];
  return filteredResearchTasks.value.filter(t => t.person_id === selectedPerson.value!.id);
});

function onResearchOpenDetails(personId: string, taskId?: string) {
  const p = persons.value.find(item => item.id === personId);
  if (p) {
    selectedPerson.value = p;
    selectedResearchTaskId.value = taskId || null;
    isDetailsOpen.value = true;
  }
}

watch(currentView, newView => {
  if (newView === 'design' || newView === 'export') {
    isDetailsOpen.value = false;
  }
  if (newView === 'research') {
    loadResearchTasks();
    loadIsolatedBranches();
  }
});

watch([activeTree, persons], () => {
  if (currentView.value === 'research') {
    loadResearchTasks();
    loadIsolatedBranches();
  }
});

watch(rootAncestors, newVal => {
  if (newVal.length > 0) {
    if (!activeProbandTab.value || !newVal.some(r => r.person_id === activeProbandTab.value)) {
      setProbandTab(newVal[0].person_id);
    }
  } else {
    setProbandTab(null);
  }
});

watch(selectedPerson, newVal => {
  if (newVal) {
    loadDetails(newVal.id);
    if (currentView.value === 'table' || currentView.value === 'tree') {
      isDetailsOpen.value = true;
    }
  } else {
    personDetails.value = null;
  }
});

onMounted(() => {
  initTrees();
  checkForUpdates(false);
});
</script>

<template>
  <main class="app-shell">
    <!-- Zeile 1: Globale Navigations- & Projekt-Leiste -->
    <header class="top-navbar">
      <div class="brand-and-tree">
        <div class="brand-logo">
          <span class="brand-icon">🌳</span>
          <h1 class="brand-title">{{ t('title') }}</h1>
        </div>

        <div class="quick-tree-wrapper" :title="t('quick_tree_switch_tooltip')">
          <span class="folder-icon">📁</span>
          <select
            class="quick-tree-select"
            :value="activeTree"
            @change="onQuickTreeSelectChange(($event.target as HTMLSelectElement).value)"
          >
            <option v-if="!activeTree" value="" disabled>{{ t('no_active_tree') }}</option>
            <option v-for="tr in trees" :key="tr" :value="tr">{{ tr }}</option>
            <option value="__manage__">{{ t('manage_trees_option') }}</option>
          </select>
        </div>
      </div>

      <div class="utility-bar">
        <span v-if="statusMessage" class="status-pill">{{ statusMessage }}</span>
        <button class="util-btn" @click="showSettings = true; loadRootAncestors()">
          ⚙️ {{ t('settings') }}
        </button>
        <button class="util-btn" @click="openUserGuide" :title="t('user_guide_tooltip')">
          📖 {{ t('user_guide_btn') }}
        </button>
        <div class="lang-segmented">
          <button @click="changeLanguage('de')" :class="{ active: locale === 'de' }">DE</button>
          <button @click="changeLanguage('en')" :class="{ active: locale === 'en' }">EN</button>
        </div>
      </div>
    </header>

    <div class="app-body">
      <aside class="nav-rail" :aria-label="t('view_navigation_aria')">
        <button
          @click="currentView = 'table'"
          :class="{ active: currentView === 'table' }"
          :title="t('view_table')"
        >
          <span class="rail-icon">📋</span>
          <span class="rail-label">{{ t('view_table') }}</span>
        </button>
        <button
          @click="currentView = 'tree'"
          :class="{ active: currentView === 'tree' }"
          :title="t('view_tree')"
        >
          <span class="rail-icon">🌳</span>
          <span class="rail-label">{{ t('view_tree') }}</span>
        </button>
        <button
          @click="currentView = 'design'"
          :class="{ active: currentView === 'design' }"
          :title="t('view_design')"
        >
          <span class="rail-icon">📐</span>
          <span class="rail-label">{{ t('view_design') }}</span>
        </button>
        <button
          @click="currentView = 'export'"
          :class="{ active: currentView === 'export' }"
          :title="t('view_export')"
        >
          <span class="rail-icon">📦</span>
          <span class="rail-label">{{ t('view_export') }}</span>
        </button>
        <button
          @click="currentView = 'research'"
          :class="{ active: currentView === 'research' }"
          :title="t('view_research')"
        >
          <span class="rail-icon">🔬</span>
          <span class="rail-label">{{ t('view_research') }}</span>
        </button>
        <button
          @click="currentView = 'stats'"
          :class="{ active: currentView === 'stats' }"
          :title="t('view_stats')"
        >
          <span class="rail-icon">📊</span>
          <span class="rail-label">{{ t('view_stats') }}</span>
        </button>
      </aside>

      <div class="app-main-column">
    <!-- Zeile 2: Kontextsensitive Arbeitsleiste (nur in Tabelle & Stammbaum-Ansicht) -->
    <div class="context-subbar" v-if="currentView === 'table' || currentView === 'tree'">
      <div class="subbar-left">
        <label for="proband-view-select" class="proband-select-label">
          🌳 {{ t('proband_view_selector_label') }}
        </label>
        <select
          id="proband-view-select"
          class="proband-select-dropdown"
          :value="activeProbandTab ?? ''"
          @change="onProbandSelectChange(($event.target as HTMLSelectElement).value)"
        >
          <option value="">{{ t('proband_free_view_option') }}</option>
          <option v-for="r in rootAncestors" :key="r.person_id" :value="r.person_id">
            [{{ r.starting_code }}] {{ r.surname || 'N.N.' }}, {{ r.given_name || 'N.N.' }} ({{ r.person_id }})
          </option>
        </select>
      </div>

      <div class="subbar-actions">
        <button class="subbar-btn" @click="handleImport" :disabled="isLoading">
          📥 {{ t('import_btn') }}
        </button>
        <button class="subbar-btn btn-add-rel" @click="openAddModal">
          ➕ {{ t('add_new_person_btn') }}
        </button>
        <div class="subbar-divider"></div>
        <button
          class="subbar-btn btn-edit-toggle"
          :class="{ active: isEditing }"
          @click="toggleEditMode"
        >
          ✏️ {{ t('edit_mode_label') }}
          <span class="edit-state-badge">{{ isEditing ? t('edit_mode_on') : t('edit_mode_off') }}</span>
        </button>
        <button
          v-if="isEditing"
          @click="saveChanges"
          class="subbar-btn btn-save"
          :disabled="isLoading || hasInvalidEditedPerson"
        >
          💾 {{ t('save_changes') }}
        </button>
      </div>
    </div>

    <!-- Modal: Person anlegen -->
    <AddPersonModal
      :visible="showAddModal"
      :selected-person="selectedPerson"
      :persons="persons"
      :columns="columns"
      :get-col-label="getColLabel"
      :fallback-next-id="calculateNextIdFromPersons"
      :server-error="addPersonError"
      @close="showAddModal = false"
      @submit="handleAddPerson"
    />

    <!-- Settings Modal -->
    <SettingsModal
      :visible="showSettings"
      v-model:active-tab="activeSettingsTab"
      :trees="trees"
      v-model:active-tree="activeTree"
      v-model:new-tree-name="newTreeName"
      :columns="columns"
      :root-ancestors="rootAncestors"
      :filtered-persons="filteredPersons"
      v-model:selected-root-id="selectedRootId"
      v-model:new-root-code="newRootCode"
      v-model:root-search-query="rootSearchQuery"
      :design-config="designConfig"
      :get-col-label="getColLabel"
      :move-column="moveColumn"
      @close="showSettings = false"
      @switch-tree="handleTreeSwitch"
      @start-delete-tree="startDeleteTree"
      @create-tree="createNewTree"
      @add-root-ancestor="addRootAncestor"
      @remove-root-ancestor="removeRootAncestor"
      @calculate-codes="calculateCodes"
    />

    <!-- Modal: Stammbaum entfernen -->
    <DeleteTreeModal
      :visible="showDeleteTreeModal"
      :tree-name="treeToDelete"
      @cancel="cancelDeleteTree"
      @confirm="confirmDeleteTree"
    />

    <!-- Modal: GEDCOM-Import-Assistent -->
    <GedcomImportModal
      :visible="isImportModalVisible"
      :file-path="selectedImportFilePath"
      :active-tree="activeTree"
      :persons="persons"
      @close="isImportModalVisible = false"
      @imported="onImportModalCompleted"
    />

    <!-- Modal: App-Aktualisierung Bestätigungsdialog -->
    <UpdateConfirmModal
      :visible="showConfirmModal"
      :currentVersion="currentVersion"
      :newVersion="newVersion"
      :releaseNotes="releaseNotes"
      :releaseDate="releaseDate"
      :isDownloading="isDownloading"
      :downloadProgress="downloadProgress"
      :errorMessage="updaterStatusType === 'error' ? updaterStatusMessage : null"
      @confirm="confirmInstall"
      @cancel="dismissConfirmModal"
    />

    <!-- Modal: Person oder Zweig entfernen -->
    <DeletePersonModal
      :visible="showDeletePersonModal"
      :target="deletePersonTarget"
      :is-deleting="isDeletingPerson"
      @cancel="showDeletePersonModal = false"
      @confirm="handleConfirmDelete"
    />

    <!-- Modal: Person zusammenführen (Merge Maske) -->
    <PersonMergeModal
      :visible="showMergeModal"
      :target-person="mergeTargetPerson"
      :source-person="mergeSourcePerson"
      :all-persons="persons"
      :is-merging="isMergingPersons"
      @close="showMergeModal = false"
      @confirm="handleConfirmMerge"
    />

    <!-- Modal: Personenauswahl für Zusammenführung (aus Detail-Drawer) -->
    <div
      v-if="showMergePickerModal"
      class="modal-overlay merge-picker-overlay"
      @click.self="showMergePickerModal = false"
      @keydown.esc="showMergePickerModal = false"
    >
      <div class="modal-content merge-picker-modal">
        <header class="merge-picker-header">
          <h3>🔀 {{ t('merge_picker_title', 'Zusammenführungspartner wählen') }}</h3>
          <button type="button" class="btn-picker-close" @click="showMergePickerModal = false">✕</button>
        </header>
        <p class="picker-instruction">
          {{ t('merge_picker_instruction', 'Wählen Sie die Person aus, mit der') }}
          <strong>{{ mergePickerInitiatorPerson?.given_name || 'N.N.' }} {{ mergePickerInitiatorPerson?.surname || 'N.N.' }} ({{ mergePickerInitiatorPerson?.id }})</strong>
          {{ t('merge_picker_instruction_suffix', 'zusammengeführt werden soll:') }}
        </p>
        <div class="picker-search-bar">
          <input
            type="text"
            v-model="mergePickerSearchQuery"
            class="picker-search-input"
            :placeholder="t('details_search_person_placeholder', 'Name oder ID suchen...')"
            autofocus
          />
        </div>
        <div class="picker-results-list">
          <div
            v-for="cand in mergePickerCandidates"
            :key="cand.id"
            class="picker-result-row"
            @click="handleSelectMergeCandidate(cand)"
          >
            <div class="cand-name">
              <strong>{{ cand.surname || 'N.N.' }}</strong>, {{ cand.given_name || 'N.N.' }}
              <span class="cand-id">({{ cand.id }})</span>
            </div>
            <div class="cand-meta">
              <span v-if="cand.birth_date">⭐ {{ cand.birth_date }}</span>
              <span v-if="cand.birth_place">({{ cand.birth_place }})</span>
              <span v-if="cand.death_date">✝ {{ cand.death_date }}</span>
            </div>
          </div>
          <div v-if="mergePickerCandidates.length === 0" class="picker-no-results">
            <em>{{ t('no_results', 'Keine passenden Personen gefunden') }}</em>
          </div>
        </div>
        <div class="picker-footer">
          <button type="button" class="btn-picker-cancel" @click="showMergePickerModal = false">
            {{ t('cancel', 'Abbrechen') }}
          </button>
        </div>
      </div>
    </div>

    <div class="workspace">
      <!-- 1. Tabellen-Ansicht -->
      <PersonTableView
        v-if="currentView === 'table'"
        :active-table-columns="activeTableColumns"
        :display-persons="displayPersons"
        :all-persons="persons"
        :selected-person="selectedPerson"
        :is-editing="isEditing"
        :edited-persons="editedPersons"
        :sort-key="sortKey"
        :sort-asc="sortAsc"
        :column-filters="columnFilters"
        v-model:quick-search="tableQuickSearch"
        :active-filter-count="activeFilterCount"
        :save-error-alert="saveErrorAlert"
        :male-persons="malePersons"
        :female-persons="femalePersons"
        :get-col-label="getColLabel"
        :get-code="getCode"
        :get-gen="getGen"
        :get-person-attr="getPersonAttr"
        :set-person-attr="setPersonAttr"
        @select="p => selectedPerson = p"
        @select-by-id="id => {
          const found = persons.find(p => p.id === id);
          if (found) selectedPerson = found;
        }"
        @sort="sortBy"
        @clear-all-filters="clearAllColumnFilters"
        @clear-save-error="saveErrorAlert = ''"
        @link-spouses="({ personId, partnerId }) => linkSpouses(partnerId, personId)"
        @unlink-family="({ personId, familyId }) => unlinkFamily(familyId, personId)"
        @add-child-link="({ parentId, childId }) => addChildLink(childId, parentId)"
        @remove-child-link="({ parentId, childId }) => removeChildLink(childId, parentId)"
      />

      <!-- 2. Grafische Stammbaum-Ansicht -->
      <TreeCanvasView
        v-if="currentView === 'tree'"
        :persons="persons"
        v-model:selected-person="selectedPerson"
        v-model:active-proband-tab="activeProbandTab"
        v-model:current-tree-root-id="currentTreeRootId"
        v-model:free-initial-root-id="freeInitialRootId"
        :expanded-nodes="expandedNodes"
        :expanded-side-nodes="expandedSideNodes"
        :expanded-from-child-map="expandedFromChildMap"
        :active-partner-path="activePartnerPath"
        :highlighted-path-ids="highlightedPathIds"
        :shortest-path-include-spouses="shortestPathIncludeSpouses"
        :pan="pan"
        v-model:zoom="zoom"
        :get-code="getCode"
        :get-active-start-code="getActiveStartCode"
        @jump-to="jumpToTreePerson"
        @clear-partner-path="clearPartnerPath"
        @show-partner-path="showPartnerPath"
      />

      <!-- 3. Stammbaum Design-Mode -->
      <DesignTree
        v-if="currentView === 'design'"
        :persons="persons"
        :root-ancestors="rootAncestors"
        :active-proband-id="activeProbandTab"
        :selected-id="selectedPerson?.id || ''"
        :highlighted-path-ids="highlightedPathIds"
        :horizontal-lane-gap="designConfig.horizontalLaneGap"
        :auto-sub-lanes="designConfig.autoSubLanes"
        :enable-line-bridges="designConfig.enableLineBridges"
        :bridge-radius="designConfig.bridgeRadius"
        :minimize-bridges="designConfig.minimizeBridges"
        :card-config="designConfig.cardConfig"
        @select="p => { selectedPerson = p; if (!p) activePartnerPath = []; }"
        @clear-selection="() => { selectedPerson = null; activePartnerPath = []; }"
        @select-proband="pid => setProbandTab(pid)"
        @open-settings="showSettings = true; activeSettingsTab = 'general'; loadRootAncestors()"
        @update-card-config="cfg => { designConfig.cardConfig = { ...designConfig.cardConfig, ...cfg }; }"
        @update-design-config="cfg => {
          if (cfg.cardConfig) {
            designConfig.cardConfig = { ...designConfig.cardConfig, ...cfg.cardConfig };
          }
          if (typeof cfg.horizontalLaneGap === 'number') designConfig.horizontalLaneGap = cfg.horizontalLaneGap;
          if (typeof cfg.autoSubLanes === 'boolean') designConfig.autoSubLanes = cfg.autoSubLanes;
          if (typeof cfg.enableLineBridges === 'boolean') designConfig.enableLineBridges = cfg.enableLineBridges;
          if (typeof cfg.bridgeRadius === 'number') designConfig.bridgeRadius = cfg.bridgeRadius;
          if (typeof cfg.minimizeBridges === 'boolean') designConfig.minimizeBridges = cfg.minimizeBridges;
        }"
        @jump-to="jumpToTreePerson"
      />

      <!-- 4. Export-Hub -->
      <ExportView
        v-if="currentView === 'export'"
        :persons="persons"
        :root-ancestors="rootAncestors"
        :active-proband-id="activeProbandTab"
        @select-proband="pid => setProbandTab(pid)"
      />

      <!-- 5. Forschungsassistent & Lücken-Finder -->
      <ResearchAssistantView
        v-if="currentView === 'research'"
        :tasks="filteredResearchTasks"
        :stats="researchStats"
        :is-loading="isResearchLoading"
        :error="researchError"
        :persons="persons"
        :root-ancestors="rootAncestors"
        :active-proband-id="activeProbandTab"
        :selected-person-id="selectedPerson?.id || null"
        :isolated-branches-data="isolatedBranchesData"
        :is-loading-branches="isLoadingBranches"
        :error-branches="researchBranchesError"
        v-model:scope-type="researchScopeType"
        v-model:selected-gap-type="selectedResearchGapType"
        v-model:selected-status="selectedResearchStatus"
        v-model:search-query="researchSearchQuery"
        v-model:sort-by="researchSortBy"
        @update:active-proband-id="pid => setProbandTab(pid)"
        @update:selected-person-id="pid => {
          const found = persons.find(p => p.id === pid);
          if (found) selectedPerson = found;
        }"
        @refresh="loadResearchTasks"
        @refresh-isolated="loadIsolatedBranches"
        @update-task="updateResearchTask"
        @navigate-tree="onResearchNavigateTree"
        @navigate-table="onResearchNavigateTable"
        @open-details="onResearchOpenDetails"
        @request-delete-branch="handleRequestDeleteBranch"
        @request-merge-persons="(targetId, sourceId) => handleRequestMergeTwoPersons(targetId, sourceId)"
      />

      <!-- 6. Statistik-Ansicht -->
      <StatisticsView
        v-if="currentView === 'stats'"
        :persons="persons"
        :root-ancestors="rootAncestors"
        :active-proband-id="activeProbandTab"
        @select-person="p => { selectedPerson = p; isDetailsOpen = true; }"
        @open-in-table="p => {
          selectedPerson = p;
          isDetailsOpen = true;
          currentView = 'table';
        }"
      />

      <!-- Rechte Spalte: Detail-Drawer (nur in Tabelle & Stammbaum-Ansicht) -->
      <PersonDetailsDrawer
        :current-view="currentView"
        v-model:is-details-open="isDetailsOpen"
        :selected-person="selectedPerson"
        :person-details="personDetails"
        :active-detail-columns="activeDetailColumns"
        :all-persons="persons"
        :active-research-gaps="activePersonResearchGaps"
        :selected-research-task-id="selectedResearchTaskId"
        :is-editing="isEditing"
        :is-loading="isLoading"
        :has-invalid-edited-person="hasInvalidEditedPerson"
        :edited-persons="editedPersons"
        :save-error-alert="saveErrorAlert"
        :parent-edit-error="parentEditError"
        :relation-action-error="relationActionError"
        v-model:selected-father-id="selectedFatherId"
        v-model:selected-mother-id="selectedMotherId"
        :male-persons="malePersons"
        :female-persons="femalePersons"
        :edited-spouses="editedSpouses"
        :marriage-edit-error="marriageEditError"
        v-model:shortest-path-search-query="shortestPathSearchQuery"
        v-model:shortest-path-include-spouses="shortestPathIncludeSpouses"
        :shortest-path-search-results="shortestPathSearchResults"
        :get-col-label="getColLabel"
        :get-code="getCode"
        :get-gen="getGen"
        :get-person-attr="getPersonAttr"
        :set-person-attr="setPersonAttr"
        :get-rel-code="getRelCode"
        @save-changes="saveChanges"
        @save-parents="savePersonParents"
        @update-spouse="({ familyId, field, value }) => setSpouseAttr(familyId, field, value)"
        @save-marriage="familyId => saveMarriageDetails(familyId)"
        @link-spouses="partnerId => linkSpouses(partnerId)"
        @unlink-family="familyId => unlinkFamily(familyId)"
        @add-child-link="childId => addChildLink(childId)"
        @remove-child-link="childId => removeChildLink(childId)"
        @jump-to="jumpToTreePerson"
        @start-shortest-path="startShortestPathTo"
        @delete-person="pid => handleRequestDeletePerson(pid)"
        @merge-person="pid => handleOpenMergeForPerson(pid)"
      />
      </div>
      </div>
    </div>
  </main>
</template>

<style>
*, *::before, *::after {
  box-sizing: border-box;
}
html, body, #app {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background-color: #f8fafc;
  color: #0f172a;
}
</style>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: #f8fafc;
}

/* Zeile 1: Top Navbar */
.top-navbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  height: 52px;
  padding: 0 1.1rem;
  background: #0f172a;
  color: #f8fafc;
  border-bottom: 1px solid #1e293b;
  flex-shrink: 0;
}

.brand-and-tree {
  display: flex;
  align-items: center;
  gap: 0.9rem;
}

.brand-logo {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.brand-icon {
  font-size: 1.25rem;
}

.brand-title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: #ffffff;
}

.quick-tree-wrapper {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 7px;
  padding: 0.22rem 0.55rem;
  transition: border-color 0.15s;
}

.quick-tree-wrapper:hover {
  border-color: #64748b;
}

.folder-icon {
  font-size: 0.82rem;
}

.quick-tree-select {
  background: transparent;
  color: #e2e8f0;
  border: none;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  outline: none;
  max-width: 200px;
}

.quick-tree-select option {
  background: #0f172a;
  color: #f8fafc;
}

/* App Body & Left Icon Sidebar Rail */
.app-body {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

.nav-rail {
  width: 70px;
  flex-shrink: 0;
  background: #0f172a;
  border-right: 1px solid #1e293b;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.35rem;
  padding: 0.65rem 0.4rem;
  overflow-y: auto;
}

.nav-rail button {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.22rem;
  background: transparent;
  color: #94a3b8;
  border: none;
  padding: 0.55rem 0.25rem;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.nav-rail button .rail-icon {
  font-size: 1.15rem;
  line-height: 1;
}

.nav-rail button .rail-label {
  font-size: 0.65rem;
  font-weight: 600;
  line-height: 1.1;
  text-align: center;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-rail button:hover:not(.active) {
  color: #f1f5f9;
  background: rgba(255, 255, 255, 0.08);
}

.nav-rail button.active {
  background: #2563eb;
  color: #ffffff;
  font-weight: 700;
  box-shadow: 0 2px 6px rgba(37, 99, 235, 0.35);
}

.app-main-column {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Utility Bar */
.utility-bar {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.status-pill {
  background: rgba(16, 185, 129, 0.18);
  border: 1px solid rgba(16, 185, 129, 0.4);
  color: #6ee7b7;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.util-btn {
  background: #1e293b;
  color: #cbd5e1;
  border: 1px solid #334155;
  border-radius: 6px;
  padding: 0.34rem 0.68rem;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.util-btn:hover {
  background: #334155;
  color: #ffffff;
}

.lang-segmented {
  display: flex;
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 6px;
  padding: 2px;
}

.lang-segmented button {
  background: transparent;
  color: #94a3b8;
  border: none;
  padding: 0.22rem 0.48rem;
  font-size: 0.73rem;
  font-weight: 700;
  border-radius: 4px;
  cursor: pointer;
}

.lang-segmented button.active {
  background: #2563eb;
  color: #ffffff;
}

/* Zeile 2: Context Subbar */
.context-subbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  min-height: 44px;
  padding: 0.35rem 1.1rem;
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.subbar-left {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.proband-select-label {
  font-size: 0.82rem;
  font-weight: 700;
  color: #334155;
  white-space: nowrap;
}

.proband-select-dropdown {
  min-width: 260px;
  max-width: 440px;
  padding: 0.34rem 0.65rem;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #f8fafc;
  color: #0f172a;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s;
}

.proband-select-dropdown:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.18);
}

.subbar-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.subbar-divider {
  width: 1px;
  height: 22px;
  background: #e2e8f0;
  margin: 0 0.15rem;
}

.subbar-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.36rem 0.78rem;
  background: #f8fafc;
  color: #1e293b;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.subbar-btn:hover:not(:disabled) {
  background: #f1f5f9;
  border-color: #94a3b8;
}

.subbar-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.btn-add-rel {
  background: #eff6ff;
  color: #1d4ed8;
  border-color: #bfdbfe;
}

.btn-add-rel:hover:not(:disabled) {
  background: #dbeafe;
  border-color: #93c5fd;
}

.btn-edit-toggle.active {
  background: #fef3c7;
  color: #92400e;
  border-color: #fcd34d;
}

.edit-state-badge {
  font-size: 0.7rem;
  font-weight: 800;
  padding: 0.08rem 0.38rem;
  border-radius: 4px;
  background: rgba(15, 23, 42, 0.08);
}

.btn-edit-toggle.active .edit-state-badge {
  background: #f59e0b;
  color: #ffffff;
}

.btn-save {
  background: #10b981;
  color: #ffffff;
  border-color: #059669;
  font-weight: 700;
}

.btn-save:hover:not(:disabled) {
  background: #059669;
}

/* Workspace */
.workspace {
  flex: 1;
  min-height: 0;
  display: flex;
  position: relative;
  overflow: hidden;
  background: #f8fafc;
}

/* Merge Picker Modal */
.merge-picker-overlay {
  position: fixed;
  inset: 0;
  background-color: rgba(15, 23, 42, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(2px);
}

.merge-picker-modal {
  background: #ffffff;
  border-radius: 12px;
  width: 90%;
  max-width: 500px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2);
  border: 1px solid #cbd5e1;
  overflow: hidden;
}

.merge-picker-header {
  padding: 14px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #e2e8f0;
  background: #f8fafc;
}

.merge-picker-header h3 {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  color: #0f172a;
}

.btn-picker-close {
  background: none;
  border: none;
  font-size: 1.1rem;
  color: #94a3b8;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
}
.btn-picker-close:hover {
  color: #0f172a;
  background: #e2e8f0;
}

.picker-instruction {
  padding: 12px 18px 0 18px;
  margin: 0;
  font-size: 0.88rem;
  color: #475569;
  line-height: 1.4;
}

.picker-search-bar {
  padding: 10px 18px;
}

.picker-search-bar .picker-search-input {
  width: 100%;
  padding: 8px 12px;
  font-size: 0.88rem;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  outline: none;
}
.picker-search-bar .picker-search-input:focus {
  border-color: #0284c7;
  box-shadow: 0 0 0 2px rgba(2, 132, 199, 0.15);
}

.picker-results-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 18px 12px 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.picker-result-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
  border-radius: 6px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  cursor: pointer;
  transition: all 0.15s ease;
}
.picker-result-row:hover {
  background: #f0f9ff;
  border-color: #93c5fd;
}

.cand-name {
  font-size: 0.88rem;
  color: #0f172a;
}

.cand-id {
  font-size: 0.78rem;
  color: #64748b;
  margin-left: 4px;
}

.cand-meta {
  font-size: 0.78rem;
  color: #64748b;
  display: flex;
  gap: 6px;
}

.picker-no-results {
  padding: 16px;
  text-align: center;
  color: #94a3b8;
  font-size: 0.85rem;
}

.picker-footer {
  padding: 10px 18px;
  border-top: 1px solid #e2e8f0;
  display: flex;
  justify-content: flex-end;
  background: #f8fafc;
}

.btn-picker-cancel {
  padding: 6px 14px;
  font-size: 0.85rem;
  font-weight: 600;
  color: #475569;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  cursor: pointer;
}
.btn-picker-cancel:hover {
  background: #f1f5f9;
}
</style>
