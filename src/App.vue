<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useI18n } from 'vue-i18n';
import TreeNode from './components/TreeNode.vue';

const { t, locale } = useI18n();

interface ProbandData { henry_code: string; generation: number; }
interface SpouseConnection { id: string; date: string | null; place: string | null; divorce_date: string | null; is_divorced: boolean; }
interface RelationInfo { type: 'spouse' | 'parent'; date?: string | null; place?: string | null; is_divorced?: boolean; divorce_date?: string | null; }

interface Person {
  id: string; given_name: string | null; surname: string | null; sex: string | null;
  birth_date: string | null; birth_place: string | null; death_date: string | null; death_place: string | null;
  proband_data: Record<string, ProbandData>; gedcom_extra: Record<string, any>;
  spouses: SpouseConnection[]; parent_ids: string[];
}

interface TreeNodeData {
  person: Person; 
  active_henry: string; 
  active_gen: number; 
  children: TreeNodeData[];
  spouse_nodes: TreeNodeData[]; 
  parent_nodes: TreeNodeData[];
  is_side_branch: boolean; 
  side_branch_type: 'spouse' | 'parent' | null; 
  relation_info: RelationInfo | null;
}

interface RelativePerson { id: string; given_name: string | null; surname: string | null; henry_code: string | null; birth_date: string | null; death_date: string | null; }
interface SpouseInfo { family_id: string; partner_id: string | null; partner_name: string | null; partner_henry: string | null; partner_birth: string | null; partner_death: string | null; marriage_date: string | null; divorce_date: string | null; is_divorced: boolean; }
interface PersonDetails { parents: RelativePerson[]; siblings: RelativePerson[]; spouses: SpouseInfo[]; children: RelativePerson[]; notes: string[]; gedcom_tags: Record<string, string>; }
interface ColumnConfig { key: keyof Person | 'henry_code' | 'generation'; labelKey: string; visible: boolean; }
interface RootAncestorConfig { person_id: string; starting_code: string; given_name: string | null; surname: string | null; }
interface ColumnFilter { text: string; dateOp: 'before' | 'after' | 'between'; date1: string; date2: string; }

const currentView = ref<'table' | 'tree'>('table');
const trees = ref<string[]>([]);
const activeTree = ref<string>('');
const newTreeName = ref<string>('');

const persons = ref<Person[]>([]);
const rootAncestors = ref<RootAncestorConfig[]>([]);
const editedPersons = ref<Map<string, Person>>(new Map());
const selectedPerson = ref<Person | null>(null);
const personDetails = ref<PersonDetails | null>(null);

// Eltern-Bearbeitung im Edit Mode
const selectedFatherId = ref<string>('');
const selectedMotherId = ref<string>('');
const parentEditError = ref<string>('');

// Stammbaum löschen (2-Stufen-Sicherheitsabfrage)
const showDeleteTreeModal = ref<boolean>(false);
const deleteModalStep = ref<1 | 2>(1);
const treeToDelete = ref<string>('');
const cancelDeleteBtn1 = ref<HTMLButtonElement | null>(null);
const cancelDeleteBtn2 = ref<HTMLButtonElement | null>(null);

const selectedRootId = ref<string>('');
const newRootCode = ref<string>('1');
const rootSearchQuery = ref<string>('');
const treeSearchQuery = ref<string>('');
const currentTreeRootId = ref<string | null>(null);
const activeProbandTab = ref<string | null>(null);

// Modal-State für allgemeines Anlegen
const showAddModal = ref<boolean>(false);
const newRelType = ref<string>('none');
const newRelTarget = ref<string | null>(null);
const newRelTargetName = ref<string>('');
const newRelGiven = ref<string>('');
const newRelSurname = ref<string>('');
const newRelSex = ref<string>('M');
const newRelBirthDate = ref<string>('');
const newRelBirthPlace = ref<string>('');
const newRelDeathDate = ref<string>('');
const newRelDeathPlace = ref<string>('');

const isEditing = ref<boolean>(false);
const showSettings = ref<boolean>(false);
const showColDropdown = ref<boolean>(false);
const statusMessage = ref<string>('');
const isLoading = ref<boolean>(false);

const expandedNodes = ref<Map<string, boolean>>(new Map());
const expandedSideNodes = ref<Map<string, { spouses: boolean, parents: boolean }>>(new Map());
const isDetailsOpen = ref<boolean>(true);

// Canvas Panning & Zooming
const pan = ref({ x: 0, y: 0 });
const zoom = ref(1);
let isDragging = false;
let dragStart = { x: 0, y: 0 };

function startDrag(e: MouseEvent) { isDragging = true; dragStart = { x: e.clientX - pan.value.x, y: e.clientY - pan.value.y }; }
function onDrag(e: MouseEvent) { if (!isDragging) return; pan.value.x = e.clientX - dragStart.x; pan.value.y = e.clientY - dragStart.y; }
function stopDrag() { isDragging = false; }
function handleZoom(e: WheelEvent) { e.preventDefault(); if (e.deltaY < 0) zoom.value = Math.min(zoom.value + 0.05, 2.5); else zoom.value = Math.max(zoom.value - 0.05, 0.2); }
function resetZoomPan() { pan.value = { x: 0, y: 0 }; zoom.value = 1; currentTreeRootId.value = null; }

watch(currentView, () => { selectedPerson.value = null; personDetails.value = null; isDetailsOpen.value = false; });

const columns = ref<ColumnConfig[]>([
  { key: 'henry_code', labelKey: 'col_henry', visible: true },
  { key: 'generation', labelKey: 'col_gen', visible: true },
  { key: 'surname', labelKey: 'col_surname', visible: true },
  { key: 'given_name', labelKey: 'col_given', visible: true },
  { key: 'birth_date', labelKey: 'col_birth', visible: true },
  { key: 'death_date', labelKey: 'col_death', visible: true },
  { key: 'sex', labelKey: 'col_sex', visible: false },
  { key: 'id', labelKey: 'col_id', visible: false }
]);

const sortKey = ref<string>('henry_code');
const sortAsc = ref<boolean>(true);
const columnFilters = ref<Record<string, ColumnFilter>>({});

columns.value.forEach(c => { columnFilters.value[c.key] = { text: '', dateOp: 'before', date1: '', date2: '' }; });

function sortBy(key: string) { if (sortKey.value === key) sortAsc.value = !sortAsc.value; else { sortKey.value = key; sortAsc.value = true; } }
function extractYear(val: any): number { if (!val) return 0; const match = String(val).match(/\d{4}/); return match ? parseInt(match[0], 10) : 0; }
function getCode(p: Person) { return activeProbandTab.value ? p.proband_data[activeProbandTab.value]?.henry_code : null; }
function getGen(p: Person) { return activeProbandTab.value ? p.proband_data[activeProbandTab.value]?.generation : null; }
function getPersonAttr(person: Person, key: keyof Person | 'henry_code' | 'generation'): any { if (key === 'henry_code') return getCode(person); if (key === 'generation') return getGen(person); return (person as any)[key]; }
function getRelCode(relId: string | null) { if (!relId || !activeProbandTab.value) return null; const p = persons.value.find(x => x.id === relId); return p ? getCode(p) : null; }

const malePersons = computed(() => {
  return persons.value.filter(p => p.sex === 'M' && (!selectedPerson.value || p.id !== selectedPerson.value.id));
});

const femalePersons = computed(() => {
  return persons.value.filter(p => p.sex === 'F' && (!selectedPerson.value || p.id !== selectedPerson.value.id));
});

watch(personDetails, (details) => {
  parentEditError.value = '';
  if (details && details.parents) {
    const father = details.parents.find(p => {
      const full = persons.value.find(x => x.id === p.id);
      return full?.sex === 'M';
    });
    const mother = details.parents.find(p => {
      const full = persons.value.find(x => x.id === p.id);
      return full?.sex === 'F';
    });
    selectedFatherId.value = father ? father.id : (details.parents[0]?.id || '');
    selectedMotherId.value = mother ? mother.id : (details.parents.length > 1 ? details.parents[1].id : '');
  } else {
    selectedFatherId.value = '';
    selectedMotherId.value = '';
  }
});

const displayPersons = computed(() => {
  let filtered = persons.value;
  if (activeProbandTab.value) filtered = filtered.filter(p => p.proband_data[activeProbandTab.value!]);
  
  filtered = filtered.filter(p => {
    for (const col of columns.value) {
      if (!col.visible) continue;
      const filter = columnFilters.value[col.key];
      const val = getPersonAttr(p, col.key);
      if (col.key.includes('date')) {
        if (filter.date1) {
          const valYear = extractYear(val); const f1 = extractYear(filter.date1);
          if (valYear === 0) return false;
          if (filter.dateOp === 'before' && valYear >= f1) return false;
          if (filter.dateOp === 'after' && valYear <= f1) return false;
          if (filter.dateOp === 'between') { const f2 = extractYear(filter.date2); if (valYear < f1 || valYear > f2) return false; }
        }
      } else {
        if (filter.text && String(val || '').toLowerCase().indexOf(filter.text.toLowerCase()) === -1) return false;
      }
    }
    return true;
  });

  filtered.sort((a, b) => {
    const valA = getPersonAttr(a, sortKey.value as any) || ''; const valB = getPersonAttr(b, sortKey.value as any) || '';
    if (valA < valB) return sortAsc.value ? -1 : 1; if (valA > valB) return sortAsc.value ? 1 : -1; return 0;
  });
  return filtered;
});

const treeSearchResults = computed(() => {
  const query = treeSearchQuery.value.toLowerCase().trim(); if (!query) return [];
  const pList = activeProbandTab.value ? persons.value.filter(p => p.proband_data[activeProbandTab.value!]) : persons.value;
  return pList.filter(p => p.id.toLowerCase().includes(query) || (p.surname || '').toLowerCase().includes(query) || (p.given_name || '').toLowerCase().includes(query)).slice(0, 10);
});

const hierarchicalTree = computed<TreeNodeData[]>(() => {
  const pList = activeProbandTab.value ? persons.value.filter(p => p.proband_data[activeProbandTab.value!]) : persons.value;
  const pid = activeProbandTab.value; if (!pid) return [];

  const childrenMap = new Map<string, Person[]>();
  pList.forEach(p => {
    const hCode = p.proband_data[pid]?.henry_code;
    if (hCode && hCode.length > 1) {
      const parentCode = hCode.slice(0, -1);
      if (!childrenMap.has(parentCode)) childrenMap.set(parentCode, []);
      childrenMap.get(parentCode)!.push(p);
    }
  });

  let roots: Person[] = [];
  if (currentTreeRootId.value) { const r = pList.find(p => p.id === currentTreeRootId.value); if (r) roots = [r]; } 
  else { const r = pList.find(p => p.id === pid); if (r) roots = [r]; }

  if (!roots.length) return [];
  
  function buildNode(person: Person, isSideBranch = false, branchType: 'spouse' | 'parent' | null = null, relInfo: RelationInfo | null = null, visited = new Set<string>()): TreeNodeData {
    const currentVisited = new Set(visited); currentVisited.add(person.id);
    const hCode = person.proband_data[pid!]?.henry_code || ''; const gen = person.proband_data[pid!]?.generation || 0;
    
    let childrenNodes: TreeNodeData[] = []; let spouseNodes: TreeNodeData[] = []; let parentNodes: TreeNodeData[] = [];

    if (!isSideBranch) {
      const childrenPersons = childrenMap.get(hCode) || [];
      childrenNodes.push(...childrenPersons.map(c => buildNode(c, false, null, null, currentVisited)));
    }

    const sideExp = expandedSideNodes.value.get(person.id);
    if (sideExp?.spouses) {
      person.spouses.forEach(spConn => {
        if (!currentVisited.has(spConn.id)) {
          const sp = persons.value.find(p => p.id === spConn.id);
          if (sp) {
            const rInfo: RelationInfo = { type: 'spouse', date: spConn.date, place: spConn.place, is_divorced: spConn.is_divorced, divorce_date: spConn.divorce_date };
            spouseNodes.push(buildNode(sp, true, 'spouse', rInfo, currentVisited));
          }
        }
      });
    }
    if (sideExp?.parents) {
      person.parent_ids.forEach(parentId => {
        if (!currentVisited.has(parentId)) {
          const pa = persons.value.find(p => p.id === parentId);
          if (pa) parentNodes.push(buildNode(pa, true, 'parent', null, currentVisited));
        }
      });
    }
    return { person, active_henry: hCode, active_gen: gen, children: childrenNodes, spouse_nodes: spouseNodes, parent_nodes: parentNodes, is_side_branch: isSideBranch, side_branch_type: branchType, relation_info: relInfo };
  }
  return roots.map(r => buildNode(r));
});

const filteredPersons = computed(() => {
  const query = rootSearchQuery.value.toLowerCase().trim(); if (!query) return persons.value;
  return persons.value.filter(p => p.id.toLowerCase().includes(query) || (p.surname || '').toLowerCase().includes(query) || (p.given_name || '').toLowerCase().includes(query));
});

function setProbandTab(personId: string | null) { activeProbandTab.value = personId; resetZoomPan(); expandedSideNodes.value.clear(); if (personId) { const root = persons.value.find(p => p.id === personId); if (root) expandedNodes.value.set(root.id, true); } }
watch(rootAncestors, (newVal) => {
  if (newVal.length > 0) {
    if (!activeProbandTab.value || !newVal.some(r => r.person_id === activeProbandTab.value)) {
      setProbandTab(newVal[0].person_id);
    }
  } else {
    setProbandTab(null);
  }
});

function jumpToTreePerson(personId: string) {
  const target = persons.value.find(p => p.id === personId); if (!target || !activeProbandTab.value) return;
  selectedPerson.value = target; treeSearchQuery.value = ''; pan.value = { x: 0, y: 0 }; 
  const tCode = target.proband_data[activeProbandTab.value]?.henry_code;
  
  if (tCode && tCode.length > 1) {
    const parentCode = tCode.slice(0, -1); const parent = persons.value.find(p => p.proband_data[activeProbandTab.value!]?.henry_code === parentCode);
    if (parent) { currentTreeRootId.value = parent.id; expandedNodes.value.set(parent.id, true); } else currentTreeRootId.value = target.id;
  } else currentTreeRootId.value = target.id;
  
  expandedNodes.value.set(target.id, true);
  if (tCode) {
    const children = persons.value.filter(p => { const cCode = p.proband_data[activeProbandTab.value!]?.henry_code; return cCode && cCode.startsWith(tCode) && cCode.length === tCode.length + 1; });
    children.forEach(c => expandedNodes.value.set(c.id, true));
  }
}

function loadParentGeneration(rootNode: TreeNodeData) {
  if (!activeProbandTab.value) return;
  let parentIdToLoad: string | null = null;
  
  if (rootNode.active_henry && rootNode.active_henry.length > 1) {
    const parentCode = rootNode.active_henry.slice(0, -1);
    const parent = persons.value.find(p => p.proband_data[activeProbandTab.value!]?.henry_code === parentCode);
    if (parent) parentIdToLoad = parent.id;
  }
  
  if (!parentIdToLoad && rootNode.person.parent_ids.length > 0) {
    parentIdToLoad = rootNode.person.parent_ids[0]; // Stammahne-Fallback
  }

  if (parentIdToLoad) {
    currentTreeRootId.value = parentIdToLoad; 
    expandedNodes.value.set(parentIdToLoad, true); 
    pan.value = { x: 0, y: 0 };
    const children = persons.value.filter(p => p.parent_ids.includes(parentIdToLoad!));
    children.forEach(c => expandedNodes.value.set(c.id, true));
  }
}

function toggleTreeNode(personId: string) { const currentState = expandedNodes.value.get(personId) || false; expandedNodes.value.set(personId, !currentState); }
function toggleSideNode(personId: string, type: 'spouses' | 'parents') { const current = expandedSideNodes.value.get(personId) || { spouses: false, parents: false }; current[type] = !current[type]; expandedSideNodes.value.set(personId, current); if (current[type]) expandedNodes.value.set(personId, true); }
function changeLanguage(lang: string) { locale.value = lang; }

async function loadTrees() { try { trees.value = await invoke<string[]>('get_trees'); } catch (e) {} }

function resetTreeViewState() {
  selectedPerson.value = null;
  personDetails.value = null;
  isDetailsOpen.value = false;
  isEditing.value = false;
  parentEditError.value = '';
  currentTreeRootId.value = null;
  expandedNodes.value.clear();
  expandedSideNodes.value.clear();
  treeSearchQuery.value = '';
  rootSearchQuery.value = '';
  selectedRootId.value = '';
  selectedFatherId.value = '';
  selectedMotherId.value = '';
  activeProbandTab.value = null;
  columns.value.forEach(c => {
    columnFilters.value[c.key] = { text: '', dateOp: 'before', date1: '', date2: '' };
  });
}

async function handleTreeSwitch() {
  try {
    resetTreeViewState();
    if (!activeTree.value) {
      persons.value = [];
      editedPersons.value = new Map();
      rootAncestors.value = [];
      currentView.value = 'table';
      return;
    }
    await invoke('switch_tree', { treeName: activeTree.value });
    await loadPersons();
    await loadRootAncestors();
    if (rootAncestors.value.length > 0) {
      setProbandTab(rootAncestors.value[0].person_id);
    } else {
      setProbandTab(null);
      currentView.value = 'table';
    }
    statusMessage.value = `Stammbaum geladen.`;
  } catch (error) {
    statusMessage.value = `Fehler beim Wechseln: ${error}`;
  }
}

async function createNewTree() {
  const name = newTreeName.value.trim();
  if (!name) return;
  try {
    activeTree.value = name;
    newTreeName.value = '';
    await handleTreeSwitch();
    await loadTrees();
    statusMessage.value = `Stammbaum '${name}' erstellt.`;
  } catch (error) {
    statusMessage.value = `Fehler beim Erstellen: ${error}`;
  }
}
async function loadPersons() { try { const res = await invoke<Person[]>('get_all_persons'); persons.value = res; editedPersons.value = new Map(res.map(p => [p.id, { ...p }])); } catch (error) {} }
async function loadRootAncestors() { try { rootAncestors.value = await invoke<RootAncestorConfig[]>('get_root_ancestors'); } catch (e) {} }
async function addRootAncestor() { if (!selectedRootId.value || !newRootCode.value) return; try { isLoading.value = true; await invoke('add_root_ancestor', { personId: selectedRootId.value, startingCode: newRootCode.value }); selectedRootId.value = ''; newRootCode.value = '1'; await invoke('calculate_henry_codes_from_roots'); await loadPersons(); await loadRootAncestors(); } catch (e) {} finally { isLoading.value = false; } }
async function removeRootAncestor(personId: string) { try { isLoading.value = true; await invoke('remove_root_ancestor', { personId }); await invoke('calculate_henry_codes_from_roots'); await loadPersons(); await loadRootAncestors(); } catch (e) {} finally { isLoading.value = false; } }
async function calculateCodes() { try { isLoading.value = true; statusMessage.value = 'Berechne Henry-Codes...'; await invoke('calculate_henry_codes_from_roots'); await loadPersons(); await loadRootAncestors(); showSettings.value = false; statusMessage.value = 'Berechnet.'; } catch (e) {} finally { isLoading.value = false; } }
async function loadDetails(personId: string) { try { personDetails.value = await invoke<PersonDetails>('get_person_details', { personId }); } catch (error) {} }
watch(selectedPerson, (newVal) => { if (newVal) { loadDetails(newVal.id); isDetailsOpen.value = true; } else { personDetails.value = null; } });
async function handleImport() {
  try {
    const selected = await open({ multiple: false, filters: [{ name: 'GEDCOM Dateien', extensions: ['ged'] }] });
    if (selected && typeof selected === 'string') {
      isLoading.value = true;
      statusMessage.value = 'Importiere...';
      if (!activeTree.value) {
        const stem = selected.split(/[\\/]/).pop()?.replace(/\.ged$/i, '').trim() || 'stammbaum';
        activeTree.value = stem;
        await invoke('switch_tree', { treeName: stem });
      }
      const count = await invoke<number>('import_gedcom_file', { filePath: selected });
      await loadTrees();
      if (!activeTree.value && trees.value.length > 0) {
        activeTree.value = trees.value[0];
      }
      statusMessage.value = `${count} Personen importiert.`;
      await loadPersons();
      await loadRootAncestors();
    }
  } catch (error) {
    statusMessage.value = `Importfehler: ${error}`;
  } finally {
    isLoading.value = false;
  }
}
function toggleEditMode() { if (isEditing.value) editedPersons.value = new Map(persons.value.map(p => [p.id, { ...p }])); isEditing.value = !isEditing.value; parentEditError.value = ''; }
async function saveChanges() { try { isLoading.value = true; for (const [_, person] of editedPersons.value.entries()) await invoke('update_person', { person }); statusMessage.value = 'Gespeichert.'; isEditing.value = false; await loadPersons(); } catch (error) {} finally { isLoading.value = false; } }

// Eltern im Edit-Mode speichern (inklusive Rekursionsprüfung)
async function savePersonParents() {
  if (!selectedPerson.value) return;
  parentEditError.value = '';
  try {
    isLoading.value = true;
    await invoke('update_person_parents', {
      personId: selectedPerson.value.id,
      fatherId: selectedFatherId.value || null,
      motherId: selectedMotherId.value || null
    });
    statusMessage.value = t('parents_saved');
    await loadPersons();
    await loadDetails(selectedPerson.value.id);
  } catch (err: any) {
    parentEditError.value = String(err);
    statusMessage.value = `Fehler: ${err}`;
  } finally {
    isLoading.value = false;
  }
}

// 2-Stufen Sicherheitsabfrage zum Löschen des Stammbaums
function startDeleteTree() {
  if (!activeTree.value) return;
  treeToDelete.value = activeTree.value;
  deleteModalStep.value = 1;
  showDeleteTreeModal.value = true;
  focusCancelButton();
}

function proceedDeleteStep2() {
  deleteModalStep.value = 2;
  focusCancelButton();
}

function cancelDeleteTree() {
  showDeleteTreeModal.value = false;
  deleteModalStep.value = 1;
}

function focusCancelButton() {
  nextTick(() => {
    setTimeout(() => {
      if (deleteModalStep.value === 1 && cancelDeleteBtn1.value) {
        cancelDeleteBtn1.value.focus();
      } else if (deleteModalStep.value === 2 && cancelDeleteBtn2.value) {
        cancelDeleteBtn2.value.focus();
      }
    }, 50);
  });
}

async function confirmDeleteTree() {
  const deletedName = treeToDelete.value;
  try {
    isLoading.value = true;
    const remaining = await invoke<string[]>('delete_tree', { treeName: deletedName });
    showDeleteTreeModal.value = false;
    trees.value = remaining;
    if (remaining.length > 0) {
      activeTree.value = remaining[0];
      await handleTreeSwitch();
    } else {
      activeTree.value = '';
      resetTreeViewState();
      persons.value = [];
      editedPersons.value = new Map();
      rootAncestors.value = [];
      currentView.value = 'table';
    }
    statusMessage.value = `Stammbaum '${deletedName}' wurde entfernt.`;
  } catch (err) {
    showDeleteTreeModal.value = false;
    statusMessage.value = `Fehler beim Löschen: ${err}`;
  } finally {
    isLoading.value = false;
  }
}

function openAddModal() {
  if (selectedPerson.value) {
    newRelTarget.value = selectedPerson.value.id;
    newRelTargetName.value = `${selectedPerson.value.given_name || 'N.N.'} ${selectedPerson.value.surname || ''}`;
    newRelType.value = 'child';
    newRelSurname.value = selectedPerson.value.surname || '';
  } else {
    newRelTarget.value = null;
    newRelTargetName.value = '';
    newRelType.value = 'none';
    newRelSurname.value = '';
  }
  newRelGiven.value = ''; newRelSex.value = 'M';
  newRelBirthDate.value = ''; newRelBirthPlace.value = '';
  newRelDeathDate.value = ''; newRelDeathPlace.value = '';
  showAddModal.value = true;
}

async function handleAddPerson() { 
  if (!newRelGiven.value) return; 
  try { 
    isLoading.value = true;
    if (!activeTree.value) {
      activeTree.value = 'stammbaum';
      await invoke('switch_tree', { treeName: 'stammbaum' });
      await loadTrees();
    }
    await invoke('add_person', { 
      targetPersonId: newRelType.value === 'none' ? null : newRelTarget.value, 
      relationType: newRelType.value === 'none' ? null : newRelType.value, 
      givenName: newRelGiven.value, 
      surname: newRelSurname.value, 
      sex: newRelSex.value, 
      birthDate: newRelBirthDate.value || null, 
      birthPlace: newRelBirthPlace.value || null,
      deathDate: newRelDeathDate.value || null, 
      deathPlace: newRelDeathPlace.value || null 
    }); 
    showAddModal.value = false; 
    await loadPersons(); 
    await loadRootAncestors();
    if (newRelTarget.value) await loadDetails(newRelTarget.value); 
  } catch (error) {} finally { isLoading.value = false; } 
}

// @ts-ignore
const moveColumn = (index: number, direction: 'up' | 'down') => { const targetIndex = direction === 'up' ? index - 1 : index + 1; if (targetIndex >= 0 && targetIndex < columns.value.length) { const temp = columns.value[index]; columns.value[index] = columns.value[targetIndex]; columns.value[targetIndex] = temp; } };

onMounted(async () => {
  await loadTrees();
  if (trees.value.length > 0) {
    activeTree.value = trees.value[0];
    await handleTreeSwitch();
  } else {
    activeTree.value = '';
    persons.value = [];
    rootAncestors.value = [];
  }
});
</script>

<template>
  <main class="container">
    <div class="header-row">
      <h1>{{ t('title') }} <span v-if="activeTree" class="tree-badge">({{ activeTree }})</span></h1>
      <div class="lang-switcher">
        <div class="view-toggle">
          <button @click="currentView = 'table'" :class="{ active: currentView === 'table' }">📋 {{ t('view_table') }}</button>
          <button @click="currentView = 'tree'" :class="{ active: currentView === 'tree' }" :disabled="!activeProbandTab">🌳 {{ t('view_tree') }}</button>
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
        <button v-if="isEditing" @click="saveChanges" class="btn-save" :disabled="isLoading">{{ t('save_changes') }}</button>
        
        <button @click="openAddModal" class="btn-add-rel">➕ Neue Person anlegen</button>
      </div>
      <span class="status">{{ statusMessage }}</span>
    </div>

    <div class="proband-tabs" v-if="rootAncestors.length > 0">
      <button class="tab-btn" :class="{ active: activeProbandTab === null }" @click="setProbandTab(null); currentView = 'table'">{{ t('all_views') }}</button>
      <button v-for="r in rootAncestors" :key="r.person_id" class="tab-btn" :class="{ active: activeProbandTab === r.person_id }" @click="setProbandTab(r.person_id)">
        [{{ r.starting_code }}] {{ r.surname || 'N.N.' }}, {{ r.given_name || 'N.N.' }}
      </button>
    </div>

    <!-- Modal: Person anlegen -->
    <div class="modal-overlay" v-if="showAddModal" @click.self="showAddModal = false">
      <div class="modal-content add-modal">
        <h2>{{ newRelTarget ? 'Verwandten anlegen' : 'Neue unabhängige Person anlegen' }}</h2>
        <div v-if="newRelTarget" style="margin-bottom:10px; font-size: 0.9rem; color:#7f8c8d;">Bezugsperson: <strong>{{ newRelTargetName }}</strong></div>
        
        <label>Verhältnis:</label>
        <select v-model="newRelType" class="w-100 mt-1 mb-1">
          <option value="none">Keine (Unabhängige Person)</option>
          <option v-if="newRelTarget" value="child">Kind</option>
          <option v-if="newRelTarget" value="parent">Elternteil</option>
          <option v-if="newRelTarget" value="spouse">Ehepartner</option>
        </select>
        
        <div style="display: flex; gap: 10px;">
          <div style="flex:1;">
            <label>Vorname:</label><input v-model="newRelGiven" class="w-100 mt-1 mb-1" />
          </div>
          <div style="flex:1;">
            <label>Nachname:</label><input v-model="newRelSurname" class="w-100 mt-1 mb-1" />
          </div>
        </div>
        <label>Geschlecht:</label>
        <select v-model="newRelSex" class="w-100 mt-1 mb-1"><option value="M">M</option><option value="F">F</option><option value="U">U</option></select>
        
        <div style="display: flex; gap: 10px;">
          <div style="flex:1;">
            <label>Geburtsdatum:</label><input v-model="newRelBirthDate" class="w-100 mt-1 mb-1" placeholder="z.B. 1990-05-20" />
          </div>
          <div style="flex:1;">
            <label>Geburtsort:</label><input v-model="newRelBirthPlace" class="w-100 mt-1 mb-1" />
          </div>
        </div>
        <div style="display: flex; gap: 10px;">
          <div style="flex:1;">
            <label>Todesdatum:</label><input v-model="newRelDeathDate" class="w-100 mt-1 mb-1" placeholder="Optional" />
          </div>
          <div style="flex:1;">
            <label>Todesort:</label><input v-model="newRelDeathPlace" class="w-100 mt-1 mb-1" />
          </div>
        </div>

        <div class="d-flex mt-1">
          <button @click="handleAddPerson" class="flex-grow">Anlegen</button>
          <button @click="showAddModal = false" class="btn-close-modal">Abbrechen</button>
        </div>
      </div>
    </div>

    <!-- Settings Modal -->
    <div class="modal-overlay" v-if="showSettings" @click.self="showSettings = false">
      <div class="modal-content settings-modal-content">
        <h2>⚙️ {{ t('settings') }}</h2>
        
        <div class="settings-section">
          <h3>Spaltenanzeige (Tabelle)</h3>
          <div class="custom-multi-select">
            <div class="select-header" @click="showColDropdown = !showColDropdown">
              Spalten auswählen ({{ columns.filter(c => c.visible).length }}) <span style="float:right">▼</span>
            </div>
            <div class="select-dropdown" v-if="showColDropdown">
              <div v-for="(col, index) in columns" :key="col.key" class="select-item">
                <label><input type="checkbox" v-model="col.visible" /> {{ t(col.labelKey) }}</label>
                <div class="order-btns">
                  <button @click.stop="moveColumn(index, 'up')" :disabled="index === 0">▲</button>
                  <button @click.stop="moveColumn(index, 'down')" :disabled="index === columns.length - 1">▼</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h3>{{ t('tree_management') }}</h3>
          <label>{{ t('active_tree') }}:</label>
          <div v-if="trees.length > 0 && activeTree" class="d-flex align-items-center mb-1">
            <select v-model="activeTree" @change="handleTreeSwitch" class="flex-grow">
              <option v-for="tree in trees" :key="tree" :value="tree">{{ tree }}</option>
            </select>
            <button class="btn-danger btn-delete-tree" @click="startDeleteTree" :title="t('delete_tree')">
              🗑️ {{ t('delete_tree') }}
            </button>
          </div>
          <div v-else class="no-active-tree mb-1">
            {{ t('no_active_tree') }}
          </div>
          <label>{{ t('new_tree') }}:</label>
          <div class="d-flex"><input v-model="newTreeName" :placeholder="t('new_tree_placeholder')" class="flex-grow" /><button @click="createNewTree">{{ t('create_btn') }}</button></div>
        </div>
        
        <div class="settings-section">
          <h3>{{ t('root_ancestor_config') }}</h3>
          <div class="proband-list-box mb-1">
            <label><strong>{{ t('proband_list') }}:</strong></label>
            <ul v-if="rootAncestors.length > 0" class="proband-list">
              <li v-for="r in rootAncestors" :key="r.person_id">
                <span class="proband-info">[{{ r.starting_code }}] {{ r.surname || 'N.N.' }}, {{ r.given_name || 'N.N.' }} <small>({{ r.person_id }})</small></span>
                <button class="btn-sm btn-danger" @click="removeRootAncestor(r.person_id)">{{ t('remove') }}</button>
              </li>
            </ul>
            <div v-else class="sub-empty mt-1">{{ t('no_probands') }}</div>
          </div>
          <label><strong>{{ t('add_proband') }}:</strong></label>
          <input v-model="rootSearchQuery" :placeholder="t('search_placeholder')" class="w-100 mt-1 mb-1" />
          <select v-model="selectedRootId" class="w-100 mb-1" size="4"><option v-for="p in filteredPersons" :key="p.id" :value="p.id">{{ p.surname || 'N.N.' }}, {{ p.given_name || 'N.N.' }} ({{ p.id }})</option></select>
          <div class="d-flex align-items-center mt-1">
            <input v-model="newRootCode" :placeholder="t('starting_code')" class="flex-grow" />
            <button @click="addRootAncestor" :disabled="!selectedRootId || !newRootCode">{{ t('add_btn') }}</button>
          </div>
          <button class="mt-1 btn-full btn-calculate" @click="calculateCodes" :disabled="rootAncestors.length === 0">{{ t('calc_codes_btn') }}</button>
        </div>
        <button class="btn-close" @click="showSettings = false">{{ t('close') }}</button>
      </div>
    </div>

    <!-- Modal: Stammbaum entfernen (2-stufige Sicherheitsabfrage, liegt über dem Einstellungsfenster) -->
    <div class="modal-overlay delete-modal-overlay" v-if="showDeleteTreeModal" @click.self="cancelDeleteTree" @keydown.esc="cancelDeleteTree">
      <div class="modal-content delete-modal">
        <div v-if="deleteModalStep === 1">
          <h2>⚠️ {{ t('delete_tree_title') }}</h2>
          <p class="delete-msg">
            Soll der ausgewählte Stammbaum <strong>&laquo;{{ treeToDelete }}&raquo;</strong> entfernt werden?
          </p>
          <div class="modal-actions-delete">
            <button class="btn-confirm-plain" @click="proceedDeleteStep2">
              {{ t('confirm') }}
            </button>
            <button ref="cancelDeleteBtn1" class="btn-cancel-highlight" @click="cancelDeleteTree" autofocus>
              {{ t('cancel') }}
            </button>
          </div>
        </div>

        <div v-else-if="deleteModalStep === 2">
          <h2>🚨 {{ t('delete_tree_final_title') }}</h2>
          <p class="delete-msg danger-text">
            Der ausgewählte Stammbaum <strong>&laquo;{{ treeToDelete }}&raquo;</strong> wird endgültig entfernt.
          </p>
          <div class="modal-actions-delete">
            <button class="btn-confirm-danger" @click="confirmDeleteTree">
              {{ t('confirm') }}
            </button>
            <button ref="cancelDeleteBtn2" class="btn-cancel-highlight" @click="cancelDeleteTree" autofocus>
              {{ t('cancel') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="workspace" :class="{ 'tree-mode': currentView === 'tree' }">
      
      <!-- 1. Tabellen-Ansicht -->
      <div class="table-container" v-if="currentView === 'table'">
        <table>
          <thead>
            <tr>
              <th v-for="col in columns.filter(c => c.visible)" :key="col.key">
                <div class="th-header" @click="sortBy(col.key)">
                  {{ t(col.labelKey) }}
                  <span class="sort-icon">{{ sortKey === col.key ? (sortAsc ? '▲' : '▼') : '↕' }}</span>
                </div>
                <div class="filter-controls" @click.stop>
                  <template v-if="col.key.includes('date')">
                    <select v-model="columnFilters[col.key].dateOp" class="filter-sel">
                      <option value="before">Vor</option><option value="after">Nach</option><option value="between">Zwischen</option>
                    </select>
                    <input type="text" v-model="columnFilters[col.key].date1" placeholder="Jahr..." class="filter-inp" />
                    <input type="text" v-model="columnFilters[col.key].date2" v-if="columnFilters[col.key].dateOp === 'between'" placeholder="Jahr..." class="filter-inp mt-1" />
                  </template>
                  <template v-else>
                    <input type="text" v-model="columnFilters[col.key].text" placeholder="Suche..." class="filter-inp" />
                  </template>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="person in displayPersons" :key="person.id" @click="selectedPerson = person" :class="{ active: selectedPerson?.id === person.id }">
              <template v-for="col in columns.filter(c => c.visible)" :key="col.key">
                <td>
                  <template v-if="!isEditing">
                    <span v-if="col.key === 'henry_code'"><strong>{{ getCode(person) || '-' }}</strong></span>
                    <span v-else-if="col.key === 'generation'">{{ getGen(person) ?? '-' }}</span>
                    <span v-else-if="col.key === 'id'"><small>{{ person.id }}</small></span>
                    <span v-else>{{ getPersonAttr(person, col.key) || (col.key === 'given_name' ? 'N.N.' : '-') }}</span>
                  </template>
                  <template v-else>
                    <input v-if="col.key === 'surname'" v-model="editedPersons.get(person.id)!.surname" />
                    <input v-else-if="col.key === 'given_name'" v-model="editedPersons.get(person.id)!.given_name" />
                    <select v-else-if="col.key === 'sex'" v-model="editedPersons.get(person.id)!.sex"><option value="M">M</option><option value="F">F</option><option value="U">U</option></select>
                    <span v-else>{{ getPersonAttr(person, col.key) ?? '-' }}</span>
                  </template>
                </td>
              </template>
            </tr>
            <tr v-if="displayPersons.length === 0"><td :colspan="columns.filter(c => c.visible).length" class="empty">{{ t('no_data') }}</td></tr>
          </tbody>
        </table>
      </div>

      <!-- 2. Grafische Stammbaum-Ansicht (Volle Breite) -->
      <div class="tree-wrapper" v-if="currentView === 'tree' && activeProbandTab">
        
        <div class="tree-tools" @mousedown.stop>
          <div class="tree-search-wrapper">
            <input v-model="treeSearchQuery" :placeholder="t('tree_search_placeholder')" />
            <ul v-if="treeSearchQuery && treeSearchResults.length > 0" class="search-dropdown">
              <li v-for="res in treeSearchResults" :key="'s-'+res.id" @click="jumpToTreePerson(res.id)">
                {{ res.surname || 'N.N.' }}, {{ res.given_name || 'N.N.' }} [{{ getCode(res) || '-' }}]
              </li>
            </ul>
          </div>
        </div>

        <div class="tree-viewport" @mousedown="startDrag" @mousemove="onDrag" @mouseup="stopDrag" @mouseleave="stopDrag" @wheel="handleZoom">
          <div v-if="hierarchicalTree.length === 0" class="empty">{{ t('no_data') }}</div>
          <div v-else class="tree-transform" :style="{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }">
            <div class="css-tree">
              <ul>
                <TreeNode 
                  v-for="root in hierarchicalTree" :key="root.person.id" :node="root" :is-root="true" :selected-id="selectedPerson?.id || ''"
                  :expanded-nodes="expandedNodes" :expanded-side-nodes="expandedSideNodes"
                  @select="p => selectedPerson = p" @toggle="toggleTreeNode" @toggle-side="toggleSideNode" 
                  @load-parent="loadParentGeneration" @jump-to="jumpToTreePerson"
                />
              </ul>
            </div>
          </div>
          
          <div class="floating-zoom-controls" @mousedown.stop @wheel.stop>
            <button @click="zoom = Math.max(zoom - 0.1, 0.2)" title="Rauszoomen">➖</button>
            <span>{{ Math.round(zoom * 100) }}%</span>
            <button @click="zoom = Math.min(zoom + 0.1, 2.5)" title="Reinzoomen">➕</button>
            <div class="divider"></div>
            <button @click="resetZoomPan" class="btn-nav-reset">{{ t('reset_root') }}</button>
          </div>
        </div>
      </div>

      <!-- Rechte Spalte: Detailansicht -->
      <div class="details-pane" :class="{ 'is-open': isDetailsOpen }">
        
        <button v-if="currentView === 'tree'" class="details-toggle-btn" @click="isDetailsOpen = !isDetailsOpen" title="Details ein/ausblenden">
          <span class="icon">{{ isDetailsOpen ? '▶' : '◀' }}</span>
          <span class="toggle-text" v-if="!isDetailsOpen">Details</span>
        </button>

        <div class="details-scroll-area">
          <template v-if="selectedPerson">
            <h2>{{ t('details_title') }}: {{ selectedPerson.surname }}, {{ selectedPerson.given_name }}</h2>
            
            <div class="detail-section">
              <h3>{{ t('section_life') }}</h3>
              <table class="detail-table">
                <tbody>
                  <tr><td><strong>ID (XREF)</strong></td><td>{{ selectedPerson.id }}</td></tr>
                  <tr><td><strong>{{ t('col_henry') }}</strong></td><td>{{ getCode(selectedPerson) || '-' }}</td></tr>
                  <tr><td><strong>{{ t('col_gen') }}</strong></td><td>{{ getGen(selectedPerson) ?? '-' }}</td></tr>
                  <tr><td><strong>{{ t('col_sex') }}</strong></td><td>{{ selectedPerson.sex || '-' }}</td></tr>
                  <tr><td><strong>{{ t('birth') }}</strong></td><td>{{ selectedPerson.birth_date || '-' }} <span v-if="selectedPerson.birth_place">({{ selectedPerson.birth_place }})</span></td></tr>
                  <tr><td><strong>{{ t('death') }}</strong></td><td>{{ selectedPerson.death_date || '-' }} <span v-if="selectedPerson.death_place">({{ selectedPerson.death_place }})</span></td></tr>
                </tbody>
              </table>
            </div>

            <div class="detail-section" v-if="personDetails && personDetails.notes.length > 0">
              <h3>{{ t('section_notes') }}</h3>
              <ul class="notes-list"><li v-for="(note, idx) in personDetails.notes" :key="idx">{{ note }}</li></ul>
            </div>

            <div class="detail-section" v-if="personDetails">
              <h3>{{ t('section_relations') }}</h3>
              
              <h4>{{ t('parents') }}</h4>

              <!-- Edit-Modus: Verwandtschaftsverhältnisse editieren -->
              <div v-if="isEditing" class="edit-parents-box">
                <div v-if="parentEditError" class="parent-error-alert">
                  ⚠️ {{ parentEditError }}
                </div>
                <div class="form-group mb-1">
                  <label><strong>{{ t('father') }}:</strong></label>
                  <select v-model="selectedFatherId" class="w-100">
                    <option value="">{{ t('no_parent') }}</option>
                    <option v-for="p in malePersons" :key="'f-'+p.id" :value="p.id">
                      {{ p.surname || 'N.N.' }}, {{ p.given_name || 'N.N.' }} ({{ p.id }})
                    </option>
                  </select>
                </div>
                <div class="form-group mb-1">
                  <label><strong>{{ t('mother') }}:</strong></label>
                  <select v-model="selectedMotherId" class="w-100">
                    <option value="">{{ t('no_parent') }}</option>
                    <option v-for="p in femalePersons" :key="'m-'+p.id" :value="p.id">
                      {{ p.surname || 'N.N.' }}, {{ p.given_name || 'N.N.' }} ({{ p.id }})
                    </option>
                  </select>
                </div>
                <button class="btn-save-parents" @click="savePersonParents" :disabled="isLoading">
                  💾 {{ t('save_parents') }}
                </button>
              </div>

              <!-- Lese-Modus: Eltern auflisten -->
              <ul class="relation-list" v-else-if="personDetails.parents.length > 0">
                <li v-for="p in personDetails.parents" :key="p.id">
                  <strong>{{ p.surname }}, {{ p.given_name }}</strong>
                  <span class="badge ml-1" v-if="getRelCode(p.id)">[{{ getRelCode(p.id) }}]</span>
                  <div class="marriage-info">(* {{ p.birth_date || '?' }}<span v-if="p.death_date"> - † {{ p.death_date }}</span>)</div>
                </li>
              </ul>
              <p v-else class="sub-empty">-</p>

              <h4>{{ t('spouses') }}</h4>
              <ul class="relation-list" v-if="personDetails.spouses.length > 0">
                <li v-for="sp in personDetails.spouses" :key="sp.family_id">
                  <strong>{{ sp.partner_name || 'Unbekannt' }}</strong>
                  <span class="badge ml-1" v-if="getRelCode(sp.partner_id)">[{{ getRelCode(sp.partner_id) }}]</span>
                  <div class="marriage-info">(* {{ sp.partner_birth || '?' }}<span v-if="sp.partner_death"> - † {{ sp.partner_death }}</span>)</div>
                  <div class="marriage-info">💍 {{ t('wedding_date') }}: {{ sp.marriage_date || '-' }} <span v-if="sp.is_divorced"> | ❌ {{ t('divorce_date') }}: {{ sp.divorce_date }}</span></div>
                </li>
              </ul><p v-else class="sub-empty">-</p>

              <h4>{{ t('children') }}</h4>
              <ul class="relation-list" v-if="personDetails.children.length > 0">
                <li v-for="c in personDetails.children" :key="c.id">
                  <strong>{{ c.surname }}, {{ c.given_name }}</strong>
                  <span class="badge ml-1" v-if="getRelCode(c.id)">[{{ getRelCode(c.id) }}]</span>
                  <div class="marriage-info">(* {{ c.birth_date || '?' }}<span v-if="c.death_date"> - † {{ c.death_date }}</span>)</div>
                </li>
              </ul><p v-else class="sub-empty">-</p>
            </div>
          </template>

          <template v-else>
            <div class="placeholder"><p>{{ t('select_prompt') }}</p></div>
          </template>
        </div>
      </div>
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

.proband-tabs { display: flex; gap: 0.5rem; margin-bottom: 1rem; border-bottom: 2px solid #ecf0f1; padding-bottom: 0.5rem; overflow-x: auto; }
.tab-btn { background: #f8f9fa; color: #2c3e50; border: 1px solid #bdc3c7; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; font-size: 0.9rem; white-space: nowrap; }
.tab-btn:hover { background: #e9ecef; }
.tab-btn.active { background: #3498db; color: white; border-color: #2980b9; font-weight: bold; }

.w-100 { width: 100%; padding: 0.4rem; border: 1px solid #bdc3c7; border-radius: 3px; box-sizing: border-box; }
.mt-1 { margin-top: 1rem; display: inline-block; }
.mb-1 { margin-bottom: 0.5rem; display: inline-block; }
.d-flex { display: flex; gap: 0.5rem; }
.align-items-center { align-items: center; }
.flex-grow { flex-grow: 1; padding: 0.4rem; border: 1px solid #bdc3c7; border-radius: 3px; }
.modal-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal-content { background: white; padding: 2rem; border-radius: 8px; width: 450px; box-shadow: 0 4px 15px rgba(0,0,0,0.2); }
.add-modal { width: 600px; }
.settings-modal-content { width: 550px; max-height: 90vh; overflow-y: auto; }
.modal-content h2 { margin-top: 0; color: #2c3e50; border-bottom: 2px solid #ecf0f1; padding-bottom: 0.5rem; font-size: 1.1rem; }
.settings-section { margin-top: 1.5rem; background: #f8f9fa; padding: 1rem; border-radius: 4px; border: 1px solid #e9ecef; }
.settings-section h3 { margin-top: 0; font-size: 1rem; color: #34495e; }
.btn-full { width: 100%; margin-top: 1rem; }
.btn-calculate { background-color: #e67e22; }
.btn-close { width: 100%; margin-top: 1.5rem; background-color: #7f8c8d; }
.btn-close-modal { background-color: #7f8c8d; }
.proband-list-box { background: white; border: 1px solid #bdc3c7; border-radius: 4px; padding: 0.5rem; max-height: 150px; overflow-y: auto; }
.proband-list { list-style: none; padding: 0; margin: 0.5rem 0 0 0; }
.proband-list li { display: flex; justify-content: space-between; align-items: center; padding: 0.4rem 0; border-bottom: 1px solid #ecf0f1; font-size: 0.85rem; }
.proband-info { flex-grow: 1; }
.btn-sm { padding: 0.2rem 0.5rem; font-size: 0.75rem; }
.btn-danger { background-color: #e74c3c; }
.btn-danger:hover:not(:disabled) { background-color: #c0392b; }
.btn-delete-tree { white-space: nowrap; margin-left: 0.5rem; }
.no-active-tree {
  padding: 0.5rem 0.75rem;
  background: #ecf0f1;
  color: #7f8c8d;
  border: 1px dashed #bdc3c7;
  border-radius: 4px;
  font-style: italic;
  font-size: 0.9rem;
}

/* Lösch-Modal */
.delete-modal-overlay {
  z-index: 1200 !important;
  background: rgba(0, 0, 0, 0.65) !important;
}
.delete-modal { width: 480px; text-align: center; }
.delete-msg { font-size: 1.05rem; line-height: 1.5; margin: 1.5rem 0; color: #2c3e50; }
.danger-text { color: #c0392b; font-weight: bold; font-size: 1.1rem; }
.modal-actions-delete { display: flex; justify-content: center; gap: 1.5rem; margin-top: 1.5rem; align-items: center; }
.btn-confirm-plain { background-color: #ecf0f1; color: #7f8c8d; border: 1px solid #bdc3c7; font-weight: normal; padding: 0.6rem 1.2rem; border-radius: 4px; }
.btn-confirm-plain:hover { background-color: #bdc3c7; color: #2c3e50; }
.btn-confirm-danger { background-color: #e74c3c; color: white; font-weight: normal; padding: 0.6rem 1.2rem; border: none; border-radius: 4px; }
.btn-confirm-danger:hover { background-color: #c0392b; }
.btn-cancel-highlight {
  background-color: #2980b9 !important;
  color: white !important;
  font-weight: bold;
  font-size: 1.05rem !important;
  padding: 0.7rem 1.8rem !important;
  border: 3px solid #1abc9c !important;
  border-radius: 6px;
  box-shadow: 0 0 10px rgba(52, 152, 219, 0.6);
  cursor: pointer;
  transition: transform 0.1s, box-shadow 0.2s;
}
.btn-cancel-highlight:hover { transform: scale(1.03); background-color: #1f618d !important; }
.btn-cancel-highlight:focus {
  outline: 3px solid #f39c12 !important;
  box-shadow: 0 0 12px rgba(243, 156, 18, 0.8) !important;
}

/* Eltern-Bearbeitung */
.edit-parents-box {
  background: #fff8e1;
  border: 1px solid #ffe082;
  padding: 12px;
  border-radius: 6px;
  margin-bottom: 12px;
}
.parent-error-alert {
  background: #ffcdd2;
  color: #b71c1c;
  border: 1px solid #e57373;
  padding: 8px 10px;
  border-radius: 4px;
  font-size: 0.85rem;
  margin-bottom: 10px;
  font-weight: bold;
  line-height: 1.4;
}
.btn-save-parents {
  background-color: #27ae60 !important;
  width: 100%;
  margin-top: 6px;
  padding: 0.5rem;
}
.btn-save-parents:hover:not(:disabled) {
  background-color: #219653 !important;
}

/* Custom Multi-Select Dropdown */
.custom-multi-select { position: relative; width: 100%; }
.select-header { padding: 0.5rem; text-align: left; background: white; border: 1px solid #bdc3c7; border-radius: 4px; cursor: pointer; font-size: 0.9rem; }
.select-dropdown { position: absolute; top: 100%; left: 0; width: 100%; background: white; border: 1px solid #bdc3c7; border-radius: 4px; margin-top: 4px; z-index: 100; max-height: 220px; overflow-y: auto; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
.select-item { display: flex; justify-content: space-between; align-items: center; padding: 0.4rem 0.8rem; border-bottom: 1px solid #ecf0f1; font-size: 0.85rem; }
.select-item:last-child { border-bottom: none; }
.order-btns button { background: #7f8c8d; padding: 2px 6px; font-size: 0.6rem; margin-left: 4px; color: white; border: none; border-radius: 3px; cursor: pointer; }

/* Workspace */
.workspace { display: grid; grid-template-columns: 2fr 1fr; gap: 1.5rem; position: relative; }
.workspace.tree-mode { display: block; height: 75vh; overflow: hidden; border: 1px solid #dcdde1; border-radius: 4px; background: white; }

/* Table Container & Filter */
.table-container { overflow-y: auto; max-height: 70vh; border: 1px solid #dcdde1; border-radius: 4px; background: white; }
th { background-color: #f5f6fa; font-weight: bold; color: #2f3640; position: sticky; top: 0; z-index: 1; vertical-align: top; }
.th-header { display: flex; justify-content: space-between; cursor: pointer; padding-bottom: 5px; border-bottom: 1px solid #dcdde1; margin-bottom: 5px; }
.sort-icon { color: #7f8c8d; font-size: 0.8rem; }
.filter-controls { font-weight: normal; }
.filter-inp, .filter-sel { width: 100%; box-sizing: border-box; font-size: 0.8rem; padding: 4px; border: 1px solid #bdc3c7; border-radius: 3px; }

/* Tree Wrapper & Viewport */
.tree-wrapper { display: flex; flex-direction: column; height: 100%; position: relative; }
.tree-tools { display: flex; justify-content: space-between; align-items: center; padding: 15px; border-bottom: 1px solid #dcdde1; z-index: 10; background: white; }
.tree-search-wrapper { position: relative; width: 350px; }
.tree-search-wrapper input { width: 100%; padding: 0.5rem; border: 1px solid #bdc3c7; border-radius: 4px; box-sizing: border-box; }
.search-dropdown { position: absolute; top: 100%; left: 0; width: 100%; background: white; border: 1px solid #bdc3c7; border-radius: 4px; max-height: 250px; overflow-y: auto; z-index: 100; list-style: none; padding: 0; margin: 0; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
.search-dropdown li { padding: 0.6rem; cursor: pointer; border-bottom: 1px solid #ecf0f1; font-size: 0.85rem; }
.search-dropdown li:hover { background: #e3f2fd; }

.tree-viewport { flex-grow: 1; overflow: hidden; cursor: grab; background: #fafafa; position: relative; user-select: none; -webkit-user-select: none; }
.tree-viewport.dragging { cursor: grabbing; }
.tree-transform { transform-origin: top center; width: 100%; }

.floating-zoom-controls { position: absolute; bottom: 20px; left: 20px; background: rgba(255, 255, 255, 0.95); padding: 10px 15px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.15); display: flex; align-items: center; gap: 0.5rem; z-index: 50; border: 1px solid #bdc3c7; }
.floating-zoom-controls button { background: #ecf0f1; color: #2c3e50; border: 1px solid #bdc3c7; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 1rem; }
.floating-zoom-controls button:hover { background: #dcdde1; }
.floating-zoom-controls span { font-size: 0.85rem; font-weight: bold; width: 45px; text-align: center; }
.divider { width: 1px; height: 20px; background: #bdc3c7; margin: 0 5px; }
.btn-nav-reset { background-color: #7f8c8d !important; color: white !important; font-size: 0.85rem !important; }

/* Details Pane */
.details-pane { background: white; display: flex; flex-direction: column; position: relative; }
.workspace:not(.tree-mode) .details-pane { border: 1px solid #dcdde1; border-radius: 4px; max-height: 70vh; }
.workspace.tree-mode .details-pane { position: absolute; top: 0; right: 0; height: 100%; width: 380px; z-index: 100; border-left: 1px solid #dcdde1; box-shadow: -4px 0 15px rgba(0,0,0,0.1); transform: translateX(100%); transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); background: rgba(255, 255, 255, 0.98); }
.workspace.tree-mode .details-pane.is-open { transform: translateX(0); }
.details-scroll-area { padding: 1.2rem; overflow-y: auto; flex-grow: 1; display: flex; flex-direction: column; }
.placeholder { margin: auto; display: flex; align-items: center; justify-content: center; color: #718093; text-align: center; height: 100%; }

.details-toggle-btn { position: absolute; left: -40px; bottom: 20px; width: 40px; background: white; border: 1px solid #dcdde1; border-right: none; border-radius: 15px 0 0 15px; box-shadow: -3px 0 8px rgba(0,0,0,0.08); cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #2c3e50; z-index: 101; padding: 15px 5px; transition: background 0.2s ease; }
.details-toggle-btn:hover { background: #f8f9fa; }
.details-toggle-btn .icon { font-size: 0.9rem; margin-bottom: 5px; }
.details-toggle-btn .toggle-text { writing-mode: vertical-rl; text-orientation: mixed; font-size: 0.85rem; font-weight: bold; letter-spacing: 2px; color: #7f8c8d; }

:deep(.css-tree ul) { padding-top: 35px; position: relative; display: flex; justify-content: center; padding-left: 0; }
:deep(.css-tree li) { float: left; text-align: center; list-style-type: none; position: relative; padding: 35px 10px 0 10px; }
:deep(.css-tree li::before), :deep(.css-tree li::after) { content: ''; position: absolute; top: 0; right: 50%; border-top: 2px solid #bdc3c7; width: 50%; height: 35px; }
:deep(.css-tree li::after) { right: auto; left: 50%; border-left: 2px solid #bdc3c7; }
:deep(.css-tree li:only-child::after), :deep(.css-tree li:only-child::before) { display: none; }
:deep(.css-tree li:only-child) { padding-top: 0; }
:deep(.css-tree li:first-child::before), :deep(.css-tree li:last-child::after) { border: 0 none; }
:deep(.css-tree li:last-child::before) { border-right: 2px solid #bdc3c7; border-radius: 0 5px 0 0; }
:deep(.css-tree li:first-child::after) { border-radius: 5px 0 0 0; }
:deep(.css-tree ul ul::before) { content: ''; position: absolute; top: 0; left: 50%; border-left: 2px solid #bdc3c7; width: 0; height: 35px; }

table { width: 100%; border-collapse: collapse; text-align: left; }
th, td { padding: 0.6rem 0.8rem; border-bottom: 1px solid #dcdde1; font-size: 0.9rem; }
tr { cursor: pointer; }
tr:hover { background-color: #f1f2f6; }
tr.active { background-color: #e3f2fd !important; }
.detail-section { margin-bottom: 1.5rem; }
.detail-section h3 { font-size: 1.1rem; border-bottom: 2px solid #3498db; padding-bottom: 0.3rem; color: #2c3e50; margin-bottom: 0.75rem; }
.detail-section h4 { font-size: 0.95rem; margin: 0.5rem 0 0.2rem 0; color: #34495e; }
.detail-table { width: 100%; border: 1px solid #e9ecef; }
.detail-table td { padding: 0.4rem 0.6rem; border-bottom: 1px solid #e9ecef; font-size: 0.85rem; }
.relation-list { margin: 0; padding-left: 1.2rem; font-size: 0.85rem; }
.relation-list li { margin-bottom: 8px; }
.badge { background: #34495e; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; }
.ml-1 { margin-left: 5px; }
.marriage-info { font-size: 0.75rem; color: #7f8c8d; margin-top: 2px; }
</style>