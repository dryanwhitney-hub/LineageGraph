<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
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
    showSettings.value = false;
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

function openFreeTreeView() {
  setProbandTab(null);
  currentView.value = 'tree';
}

function changeLanguage(lang: string) {
  locale.value = lang;
}

watch(currentView, () => {
  selectedPerson.value = null;
  personDetails.value = null;
  isDetailsOpen.value = false;
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
    isDetailsOpen.value = true;
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
  <main class="container">
    <div class="header-row">
      <h1>{{ t('title') }} <span v-if="activeTree" class="tree-badge">({{ activeTree }})</span></h1>
      <div class="lang-switcher">
        <div class="view-toggle">
          <button @click="currentView = 'table'" :class="{ active: currentView === 'table' }">📋 {{ t('view_table') }}</button>
          <button @click="currentView = 'tree'" :class="{ active: currentView === 'tree' }">🌳 {{ t('view_tree') }}</button>
          <button @click="currentView = 'design'" :class="{ active: currentView === 'design' }">📐 {{ t('view_design') }}</button>
          <button @click="currentView = 'export'" :class="{ active: currentView === 'export' }">📦 {{ t('view_export') }}</button>
        </div>
        <button class="btn-settings" @click="showSettings = true; loadRootAncestors()">⚙️ {{ t('settings') }}</button>
        <button @click="changeLanguage('de')" :class="{ active: locale === 'de' }">DE</button>
        <button @click="changeLanguage('en')" :class="{ active: locale === 'en' }">EN</button>
      </div>
    </div>

    <div class="toolbar">
      <div class="actions">
        <button @click="handleImport" :disabled="isLoading">{{ t('import_btn') }}</button>
        <button @click="toggleEditMode" :class="{ active: isEditing }">{{ isEditing ? t('edit_toggle_off') : t('edit_toggle_on') }}</button>
        <button v-if="isEditing" @click="saveChanges" class="btn-save" :disabled="isLoading || hasInvalidEditedPerson">{{ t('save_changes') }}</button>

        <button @click="openAddModal" class="btn-add-rel">➕ Neue Person anlegen</button>
      </div>
      <span class="status">{{ statusMessage }}</span>
    </div>

    <div class="proband-selector-bar" v-if="currentView !== 'export' && (rootAncestors.length > 0 || persons.length > 0)">
      <label for="proband-view-select" class="proband-select-label">
        🌳 <strong>{{ t('proband_view_label') }}:</strong>
      </label>
      <select
        id="proband-view-select"
        class="proband-select-dropdown"
        :value="activeProbandTab ?? ''"
        @change="onProbandSelectChange(($event.target as HTMLSelectElement).value)"
      >
        <option v-if="currentView !== 'design'" value="">{{ t('free_view_option') }}</option>
        <option v-else value="" disabled>{{ t('please_select') }}</option>
        <option v-for="r in rootAncestors" :key="r.person_id" :value="r.person_id">
          [{{ r.starting_code }}] {{ r.surname || 'N.N.' }}, {{ r.given_name || 'N.N.' }} ({{ r.person_id }})
        </option>
      </select>
      <button
        v-if="currentView !== 'design'"
        class="btn-free-view"
        :class="{ active: currentView === 'tree' && !activeProbandTab }"
        @click="openFreeTreeView"
      >
        🧭 {{ t('free_tree_btn') }}
      </button>
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

    <!-- Modal: Stammbaum entfernen (2-stufige Sicherheitsabfrage, liegt über dem Einstellungsfenster) -->
    <DeleteTreeModal
      :visible="showDeleteTreeModal"
      :tree-name="treeToDelete"
      @cancel="cancelDeleteTree"
      @confirm="confirmDeleteTree"
    />

    <!-- Modal: GEDCOM-Import-Assistent (Neu, Ersetzen, Update/Merge) -->
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

    <div class="workspace" :class="{ 'tree-mode': currentView === 'tree' || currentView === 'design' || currentView === 'export' }">
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
        @clear-save-error="saveErrorAlert = ''"
        @link-spouses="({ personId, partnerId }) => linkSpouses(partnerId, personId)"
        @unlink-family="({ personId, familyId }) => unlinkFamily(familyId, personId)"
        @add-child-link="({ parentId, childId }) => addChildLink(childId, parentId)"
        @remove-child-link="({ parentId, childId }) => removeChildLink(childId, parentId)"
      />

      <!-- 2. Grafische Stammbaum-Ansicht (Volle Breite) -->
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

      <!-- 3. Stammbaum Design-Mode (Ursprung unten -> nach oben, Geschwistergruppen & Ebenen frei verschiebbar, Linienbrücken) -->
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

      <!-- 4. Interaktiver HTML-Export & Browser-Vorschau -->
      <ExportView
        v-if="currentView === 'export'"
        :persons="persons"
        :root-ancestors="rootAncestors"
        :active-proband-id="activeProbandTab"
        @select-proband="pid => setProbandTab(pid)"
      />

      <!-- Rechte Spalte: Detailansicht (im Design-Mode und Export-Bereich nicht angezeigt) -->
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

<style scoped>
.container { padding: 2rem; font-family: Arial, sans-serif; max-width: 1600px; margin: 0 auto; }
.header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
h1 { font-size: 1.8rem; margin: 0; color: #2c3e50; }
.tree-badge { font-size: 1.1rem; color: #7f8c8d; font-weight: normal; }
.lang-switcher { display: flex; gap: 0.5rem; align-items: center; }
.view-toggle { display: flex; background: #ecf0f1; border-radius: 4px; padding: 2px; margin-right: 1rem; }
.view-toggle button { background: transparent; color: #7f8c8d; border: none; padding: 0.4rem 0.8rem; font-size: 0.85rem; border-radius: 3px; }
.view-toggle button.active { background: #3498db; color: white; font-weight: bold; }
.view-toggle button:disabled { opacity: 0.5; cursor: not-allowed; }
.lang-switcher > button { padding: 0.3rem 0.6rem; background-color: #ecf0f1; color: #2c3e50; border: 1px solid #bdc3c7; border-radius: 4px; cursor: pointer; font-weight: bold; }
.lang-switcher > button.active { background-color: #3498db; color: white; border-color: #2980b9; }
.btn-settings { background-color: #95a5a6 !important; color: white !important; border: none !important; margin-right: 1rem; }
.btn-add-rel { background-color: #27ae60 !important; }
.toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; }
.actions { display: flex; gap: 1rem; }
button { padding: 0.5rem 1rem; background-color: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; }
button:hover:not(:disabled) { background-color: #2980b9; }
button:disabled { background-color: #95a5a6; cursor: not-allowed; }
.btn-save { background-color: #2ecc71 !important; }

.proband-selector-bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
  background: #f8f9fa;
  border: 1px solid #dcdde1;
  border-radius: 6px;
  padding: 0.55rem 0.9rem;
}
.proband-select-label {
  font-size: 0.9rem;
  color: #2c3e50;
  white-space: nowrap;
}
.proband-select-dropdown {
  min-width: 280px;
  max-width: 480px;
  padding: 0.45rem 0.7rem;
  border: 1px solid #3498db;
  border-radius: 4px;
  background: white;
  color: #2c3e50;
  font-size: 0.9rem;
  font-weight: bold;
  cursor: pointer;
}
.proband-select-dropdown:focus {
  outline: 2px solid rgba(52, 152, 219, 0.4);
}
.btn-free-view {
  background-color: #8e44ad;
  color: white;
  font-size: 0.85rem;
  padding: 0.45rem 0.85rem;
  border-radius: 4px;
}
.btn-free-view:hover:not(:disabled) {
  background-color: #732d91;
}
.btn-free-view.active {
  background-color: #6c3483;
  box-shadow: 0 0 0 2px rgba(142, 68, 173, 0.35);
}

/* Workspace */
.workspace { display: grid; grid-template-columns: 2fr 1fr; gap: 1.5rem; position: relative; }
.workspace.tree-mode { display: block; height: 75vh; overflow: hidden; border: 1px solid #dcdde1; border-radius: 4px; background: white; }
</style>
