<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import DesignTree from './components/DesignTree.vue';
import ExportView from './components/ExportView.vue';
import PersonTableView from './components/table/PersonTableView.vue';
import TreeCanvasView from './components/tree/TreeCanvasView.vue';
import PersonDetailsDrawer from './components/details/PersonDetailsDrawer.vue';
import DeleteTreeModal from './components/modals/DeleteTreeModal.vue';
import AddPersonModal from './components/modals/AddPersonModal.vue';
import SettingsModal, { type SettingsTab } from './components/modals/SettingsModal.vue';
import GedcomImportModal from './components/modals/GedcomImportModal.vue';
import UpdateConfirmModal from './components/modals/UpdateConfirmModal.vue';
import { usePersons } from './composables/usePersons';
import { useShortestPath } from './composables/useShortestPath';
import { useAppUpdater } from './composables/useAppUpdater';

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

const currentView = ref<'table' | 'tree' | 'design' | 'export'>('table');
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

watch(currentView, newView => {
  if (newView === 'design' || newView === 'export') {
    isDetailsOpen.value = false;
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

      <nav class="view-toggle">
        <button @click="currentView = 'table'" :class="{ active: currentView === 'table' }">
          📋 {{ t('view_table') }}
        </button>
        <button @click="currentView = 'tree'" :class="{ active: currentView === 'tree' }">
          🌳 {{ t('view_tree') }}
        </button>
        <button @click="currentView = 'design'" :class="{ active: currentView === 'design' }">
          📐 {{ t('view_design') }}
        </button>
        <button @click="currentView = 'export'" :class="{ active: currentView === 'export' }">
          📦 {{ t('view_export') }}
        </button>
      </nav>

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
          {{ t('add_new_person_btn') }}
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
      :current-version="currentVersion"
      :new-version="newVersion"
      :release-notes="releaseNotes"
      :release-date="releaseDate"
      :is-downloading="isDownloading"
      :download-progress="downloadProgress"
      :error-message="updaterStatusType === 'error' ? updaterStatusMessage : null"
      @confirm="confirmInstall"
      @cancel="dismissConfirmModal"
    />

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

      <!-- Rechte Spalte: Detail-Drawer (nur in Tabelle & Stammbaum-Ansicht) -->
      <PersonDetailsDrawer
        :current-view="currentView"
        v-model:is-details-open="isDetailsOpen"
        :selected-person="selectedPerson"
        :person-details="personDetails"
        :active-detail-columns="activeDetailColumns"
        :all-persons="persons"
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
      />
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

/* Segmented View Navigation */
.view-toggle {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 8px;
  padding: 3px;
}

.view-toggle button {
  background: transparent;
  color: #94a3b8;
  border: none;
  padding: 0.36rem 0.85rem;
  font-size: 0.82rem;
  font-weight: 600;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.view-toggle button:hover:not(.active) {
  color: #f1f5f9;
  background: rgba(255, 255, 255, 0.06);
}

.view-toggle button.active {
  background: #2563eb;
  color: #ffffff;
  font-weight: 700;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
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
</style>
