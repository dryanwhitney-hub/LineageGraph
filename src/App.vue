<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useI18n } from 'vue-i18n';
import TreeNode from './components/TreeNode.vue';

const { t, locale } = useI18n();

interface ProbandData { henry_code: string; generation: number; }
interface SpouseConnection { id: string; date: string | null; place: string | null; divorce_date: string | null; is_divorced: boolean; }
interface RelationInfo { type: 'spouse' | 'parent'; date?: string | null; place?: string | null; is_divorced?: boolean; divorce_date?: string | null; partner_id?: string | null; }

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
interface ColumnConfig { key: string; labelKey: string; visible: boolean; detailVisible: boolean; editable: boolean; isDate?: boolean; customLabel?: string; }
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

// Direkter Pfad zwischen Ehepartnern im Stammbaum
const activePartnerPath = ref<Person[]>([]);
const highlightedPathIds = computed<Set<string>>(() => new Set(activePartnerPath.value.map(p => p.id)));
const shortestPathIncludeSpouses = ref<boolean>(false);
const shortestPathEndpoints = ref<{ aId: string; bId: string } | null>(null);

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
const shortestPathSearchQuery = ref<string>('');
const currentTreeRootId = ref<string | null>(null);
const activeProbandTab = ref<string | null>(null);

// Freie Stammbaum-Ansicht (Abfragemaske ohne Stammahn)
const freeQuerySurname = ref<string>('');
const freeQueryGiven = ref<string>('');
const freeQueryBirth = ref<string>('');
const freeQueryId = ref<string>('');
const freeInitialRootId = ref<string | null>(null);

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
const showDetailAttrDropdown = ref<boolean>(false);
const statusMessage = ref<string>('');
const isLoading = ref<boolean>(false);

const expandedNodes = ref<Map<string, boolean>>(new Map());
const expandedSideNodes = ref<Map<string, { spouses: boolean, parents: boolean }>>(new Map());
const expandedFromChildMap = ref<Map<string, string>>(new Map());
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
function resetZoomPan() { pan.value = { x: 0, y: 0 }; zoom.value = 1; expandedFromChildMap.value.clear(); currentTreeRootId.value = activeProbandTab.value ? null : freeInitialRootId.value; }

watch(currentView, () => { selectedPerson.value = null; personDetails.value = null; isDetailsOpen.value = false; });

const columns = ref<ColumnConfig[]>([
  { key: 'henry_code', labelKey: 'col_henry', visible: true, detailVisible: true, editable: false },
  { key: 'generation', labelKey: 'col_gen', visible: true, detailVisible: true, editable: false },
  { key: 'surname', labelKey: 'col_surname', visible: true, detailVisible: true, editable: true },
  { key: 'given_name', labelKey: 'col_given', visible: true, detailVisible: true, editable: true },
  { key: 'birth_date', labelKey: 'col_birth', visible: true, detailVisible: true, editable: true, isDate: true },
  { key: 'birth_place', labelKey: 'col_birth_place', visible: true, detailVisible: true, editable: true },
  { key: 'death_date', labelKey: 'col_death', visible: true, detailVisible: true, editable: true, isDate: true },
  { key: 'death_place', labelKey: 'col_death_place', visible: true, detailVisible: true, editable: true },
  { key: 'sex', labelKey: 'col_sex', visible: false, detailVisible: true, editable: true },
  { key: 'id', labelKey: 'col_id', visible: false, detailVisible: true, editable: false },
  { key: 'chr_date', labelKey: 'col_chr_date', visible: false, detailVisible: true, editable: true, isDate: true },
  { key: 'chr_place', labelKey: 'col_chr_place', visible: false, detailVisible: true, editable: true },
  { key: 'buri_date', labelKey: 'col_buri_date', visible: false, detailVisible: true, editable: true, isDate: true },
  { key: 'buri_place', labelKey: 'col_buri_place', visible: false, detailVisible: true, editable: true },
  { key: 'occu', labelKey: 'col_occu', visible: false, detailVisible: true, editable: true },
  { key: 'reli', labelKey: 'col_reli', visible: false, detailVisible: true, editable: true },
  { key: 'titl', labelKey: 'col_titl', visible: false, detailVisible: true, editable: true },
  { key: 'resi', labelKey: 'col_resi', visible: false, detailVisible: true, editable: true },
  { key: 'note', labelKey: 'col_note', visible: false, detailVisible: true, editable: true },
  { key: 'sour', labelKey: 'col_sour', visible: false, detailVisible: true, editable: true },
  { key: 'chan', labelKey: 'col_chan', visible: false, detailVisible: true, editable: false }
]);

// Spalte Henry-Code in der Tabelle nur anzeigen, wenn ein Stammahn aktiv ausgewählt ist
const activeTableColumns = computed(() => {
  return columns.value.filter(c => c.visible && (c.key !== 'henry_code' || activeProbandTab.value !== null));
});

// Attribute in den Eintragsdetails entsprechend der Konfiguration anzeigen
const activeDetailColumns = computed(() => {
  return columns.value.filter(c => c.detailVisible && (c.key !== 'henry_code' || activeProbandTab.value !== null));
});

const sortKey = ref<string>('henry_code');
const sortAsc = ref<boolean>(true);
const columnFilters = ref<Record<string, ColumnFilter>>({});

function ensureColumnFilters() {
  columns.value.forEach(c => {
    if (!columnFilters.value[c.key]) {
      columnFilters.value[c.key] = { text: '', dateOp: 'before', date1: '', date2: '' };
    }
  });
}
ensureColumnFilters();

function getColLabel(col: ColumnConfig): string {
  return col.customLabel ? col.customLabel : t(col.labelKey);
}

const KNOWN_GEDCOM_TAGS = new Set(['NAME', 'SEX', 'BIRT', 'DEAT', 'CHR', 'BURI', 'OCCU', 'RELI', 'TITL', 'RESI', 'NOTE', 'SOUR', 'CHAN', 'FAMC', 'FAMS']);

function syncDynamicColumns(personList: Person[]) {
  const extraKeys = new Set<string>();
  personList.forEach(p => {
    if (p.gedcom_extra && typeof p.gedcom_extra === 'object') {
      Object.keys(p.gedcom_extra).forEach(k => {
        if (!KNOWN_GEDCOM_TAGS.has(k)) {
          extraKeys.add(`ged_${k}`);
        }
      });
    }
  });
  extraKeys.forEach(colKey => {
    if (!columns.value.some(c => c.key === colKey)) {
      const rawTag = colKey.replace(/^ged_/, '');
      columns.value.push({
        key: colKey,
        labelKey: colKey,
        customLabel: `GEDCOM: ${rawTag}`,
        visible: false,
        detailVisible: true,
        editable: true
      });
    }
  });
  ensureColumnFilters();
}

function clonePerson(p: Person): Person {
  return {
    ...p,
    proband_data: p.proband_data ? JSON.parse(JSON.stringify(p.proband_data)) : {},
    gedcom_extra: p.gedcom_extra ? JSON.parse(JSON.stringify(p.gedcom_extra)) : {},
    spouses: p.spouses ? [...p.spouses] : [],
    parent_ids: p.parent_ids ? [...p.parent_ids] : []
  };
}

function sortBy(key: string) { if (sortKey.value === key) sortAsc.value = !sortAsc.value; else { sortKey.value = key; sortAsc.value = true; } }
function extractYear(val: any): number { if (!val) return 0; const match = String(val).match(/\d{4}/); return match ? parseInt(match[0], 10) : 0; }
function getCode(p: Person) { return activeProbandTab.value ? p.proband_data[activeProbandTab.value]?.henry_code : null; }
function getGen(p: Person) { return activeProbandTab.value ? p.proband_data[activeProbandTab.value]?.generation : null; }

function readGedcomSub(extra: Record<string, any> | undefined, tag: string, subKey: string): string | null {
  if (!extra || !extra[tag]) return null;
  const entry = extra[tag];
  if (typeof entry === 'object' && entry !== null) {
    if (entry[subKey] !== undefined && entry[subKey] !== null && String(entry[subKey]).trim() !== '') {
      return String(entry[subKey]);
    }
    if (subKey === '_val') {
      const parts = Object.entries(entry).map(([k, v]) => k === '_val' ? String(v) : `${k}: ${v}`);
      return parts.join(', ') || null;
    }
    return null;
  }
  return subKey === '_val' ? String(entry) : null;
}

function writeGedcomSub(person: Person, tag: string, subKey: string, value: string) {
  if (!person.gedcom_extra || typeof person.gedcom_extra !== 'object') {
    person.gedcom_extra = {};
  }
  if (!person.gedcom_extra[tag] || typeof person.gedcom_extra[tag] !== 'object') {
    person.gedcom_extra[tag] = {};
  }
  const trimmed = value.trim();
  if (trimmed) {
    person.gedcom_extra[tag][subKey] = value;
  } else {
    delete person.gedcom_extra[tag][subKey];
    if (Object.keys(person.gedcom_extra[tag]).length === 0) {
      delete person.gedcom_extra[tag];
    }
  }
}

function getPersonAttr(person: Person, key: string): any {
  if (key === 'henry_code') return getCode(person);
  if (key === 'generation') return getGen(person);
  if (key in person) return (person as any)[key];
  const extra = person.gedcom_extra;
  switch (key) {
    case 'chr_date': return readGedcomSub(extra, 'CHR', 'DATE');
    case 'chr_place': return readGedcomSub(extra, 'CHR', 'PLAC');
    case 'buri_date': return readGedcomSub(extra, 'BURI', 'DATE');
    case 'buri_place': return readGedcomSub(extra, 'BURI', 'PLAC');
    case 'occu': return readGedcomSub(extra, 'OCCU', '_val');
    case 'reli': return readGedcomSub(extra, 'RELI', '_val');
    case 'titl': return readGedcomSub(extra, 'TITL', '_val');
    case 'resi': return readGedcomSub(extra, 'RESI', '_val') || readGedcomSub(extra, 'RESI', 'PLAC');
    case 'note': return readGedcomSub(extra, 'NOTE', '_val');
    case 'sour': return readGedcomSub(extra, 'SOUR', '_val');
    case 'chan': return readGedcomSub(extra, 'CHAN', 'DATE') || readGedcomSub(extra, 'CHAN', '_val');
    default:
      if (key.startsWith('ged_')) {
        const rawTag = key.slice(4);
        return readGedcomSub(extra, rawTag, '_val');
      }
      return null;
  }
}

function setPersonAttr(person: Person, key: string, value: string) {
  const valOrNull = value === '' ? null : value;
  switch (key) {
    case 'surname': person.surname = valOrNull; break;
    case 'given_name': person.given_name = valOrNull; break;
    case 'sex': person.sex = valOrNull; break;
    case 'birth_date': person.birth_date = valOrNull; break;
    case 'birth_place': person.birth_place = valOrNull; break;
    case 'death_date': person.death_date = valOrNull; break;
    case 'death_place': person.death_place = valOrNull; break;
    case 'chr_date': writeGedcomSub(person, 'CHR', 'DATE', value); break;
    case 'chr_place': writeGedcomSub(person, 'CHR', 'PLAC', value); break;
    case 'buri_date': writeGedcomSub(person, 'BURI', 'DATE', value); break;
    case 'buri_place': writeGedcomSub(person, 'BURI', 'PLAC', value); break;
    case 'occu': writeGedcomSub(person, 'OCCU', '_val', value); break;
    case 'reli': writeGedcomSub(person, 'RELI', '_val', value); break;
    case 'titl': writeGedcomSub(person, 'TITL', '_val', value); break;
    case 'resi': writeGedcomSub(person, 'RESI', '_val', value); break;
    case 'note': writeGedcomSub(person, 'NOTE', '_val', value); break;
    case 'sour': writeGedcomSub(person, 'SOUR', '_val', value); break;
    default:
      if (key.startsWith('ged_')) {
        const rawTag = key.slice(4);
        writeGedcomSub(person, rawTag, '_val', value);
      }
      break;
  }
}

function getRelCode(relId: string | null) {
  if (!relId || !activeProbandTab.value) return null;
  const p = persons.value.find(x => x.id === relId);
  return p ? getCode(p) : null;
}

function getActiveStartCode(): string {
  if (!activeProbandTab.value) return '1';
  const r = rootAncestors.value.find(x => x.person_id === activeProbandTab.value);
  return r ? r.starting_code : '1';
}

function getParentHenryCode(hCode: string, startCode: string): string | null {
  if (!hCode || hCode === startCode || hCode.length <= startCode.length) return null;
  const xMatch = hCode.match(/^(.*?)X\d+$/);
  if (xMatch && xMatch[1].length >= startCode.length) {
    return xMatch[1];
  }
  return hCode.slice(0, -1);
}

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
    for (const col of activeTableColumns.value) {
      const filter = columnFilters.value[col.key];
      if (!filter) continue;
      const val = getPersonAttr(p, col.key);
      if (col.isDate || col.key.includes('date')) {
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

  const effectiveSortKey = (sortKey.value === 'henry_code' && !activeProbandTab.value) ? 'surname' : sortKey.value;
  filtered.sort((a, b) => {
    const valA = getPersonAttr(a, effectiveSortKey) ?? '';
    const valB = getPersonAttr(b, effectiveSortKey) ?? '';
    if (valA < valB) return sortAsc.value ? -1 : 1;
    if (valA > valB) return sortAsc.value ? 1 : -1;
    return 0;
  });
  return filtered;
});

const treeSearchResults = computed(() => {
  const query = treeSearchQuery.value.toLowerCase().trim(); if (!query) return [];
  const pList = activeProbandTab.value ? persons.value.filter(p => p.proband_data[activeProbandTab.value!]) : persons.value;
  return pList.filter(p => p.id.toLowerCase().includes(query) || (p.surname || '').toLowerCase().includes(query) || (p.given_name || '').toLowerCase().includes(query)).slice(0, 10);
});

function parseBirthSortKey(dateStr: string | null | undefined): [number, number, number] {
  if (!dateStr) return [9999, 99, 99];
  const s = dateStr.trim().toUpperCase();
  if (!s) return [9999, 99, 99];

  // 1. ISO-Format: YYYY-MM-DD oder YYYY/MM/DD
  const isoMatch = s.match(/\b(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?\b/);
  if (isoMatch) {
    return [
      parseInt(isoMatch[1], 10),
      parseInt(isoMatch[2], 10),
      isoMatch[3] ? parseInt(isoMatch[3], 10) : 99,
    ];
  }

  // 2. Deutsches Format: DD.MM.YYYY
  const deMatch = s.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);
  if (deMatch) {
    return [
      parseInt(deMatch[3], 10),
      parseInt(deMatch[2], 10),
      parseInt(deMatch[1], 10),
    ];
  }

  // 3. GEDCOM-Format (z.B. "20 MAY 1950", "ABT 1890")
  const yearMatch = s.match(/\b(\d{4})\b/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : 9999;

  const monthMap: Record<string, number> = {
    JAN: 1, FEB: 2, MAR: 3, MÄR: 3, MAER: 3, APR: 4, MAY: 5, MAI: 5,
    JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, OKT: 10, NOV: 11, DEC: 12, DEZ: 12,
  };
  let month = 99;
  for (const [mKey, mVal] of Object.entries(monthMap)) {
    if (new RegExp(`\\b${mKey}`, 'i').test(s)) {
      month = mVal;
      break;
    }
  }

  let day = 99;
  const withoutYear = yearMatch ? s.replace(yearMatch[0], ' ') : s;
  const dayMatch = withoutYear.match(/\b([0-2]?\d|3[01])\b/);
  if (dayMatch) {
    const d = parseInt(dayMatch[1], 10);
    if (d >= 1 && d <= 31) day = d;
  }

  return [year, month, day];
}

function comparePersonsByBirth(a: Person, b: Person): number {
  const [ya, ma, da] = parseBirthSortKey(a.birth_date);
  const [yb, mb, db] = parseBirthSortKey(b.birth_date);
  if (ya !== yb) return ya - yb;
  if (ma !== mb) return ma - mb;
  if (da !== db) return da - db;
  return a.id.localeCompare(b.id);
}

const freeQueryResults = computed(() => {
  const sSurname = freeQuerySurname.value.toLowerCase().trim();
  const sGiven = freeQueryGiven.value.toLowerCase().trim();
  const sBirth = freeQueryBirth.value.toLowerCase().trim();
  const sId = freeQueryId.value.toLowerCase().trim();

  return persons.value
    .filter(p => {
      if (sSurname && !(p.surname || '').toLowerCase().includes(sSurname)) return false;
      if (sGiven && !(p.given_name || '').toLowerCase().includes(sGiven)) return false;
      if (sBirth && !(p.birth_date || '').toLowerCase().includes(sBirth) && !(p.birth_place || '').toLowerCase().includes(sBirth)) return false;
      if (sId && !p.id.toLowerCase().includes(sId)) return false;
      return true;
    })
    .slice(0, 30);
});

const hierarchicalTree = computed<TreeNodeData[]>(() => {
  const pid = activeProbandTab.value;
  const pList = pid ? persons.value.filter(p => p.proband_data[pid]) : persons.value;
  const startCode = getActiveStartCode();

  const childrenMap = new Map<string, Person[]>();
  if (pid) {
    pList.forEach(p => {
      const hCode = p.proband_data[pid]?.henry_code;
      if (hCode) {
        const parentCode = getParentHenryCode(hCode, startCode);
        if (parentCode) {
          if (!childrenMap.has(parentCode)) childrenMap.set(parentCode, []);
          childrenMap.get(parentCode)!.push(p);
        }
      }
    });

    // Nachkommen in jedem Zweig chronologisch nach Geburt sortieren
    childrenMap.forEach(list => {
      list.sort(comparePersonsByBirth);
    });
  }

  let roots: Person[] = [];
  if (currentTreeRootId.value) {
    const r = persons.value.find(p => p.id === currentTreeRootId.value);
    if (r) roots = [r];
  } else if (pid) {
    const r = pList.find(p => p.id === pid) || persons.value.find(p => p.id === pid);
    if (r) roots = [r];
  } else {
    // Freie Ansicht ohne ausgewählte Startperson beginnt leer (mit Abfragemaske)
    return [];
  }

  if (!roots.length) return [];
  
  function buildNode(person: Person, isSideBranch = false, branchType: 'spouse' | 'parent' | null = null, relInfo: RelationInfo | null = null, visited = new Set<string>()): TreeNodeData {
    const currentVisited = new Set(visited); currentVisited.add(person.id);
    const hCode = pid ? (person.proband_data[pid]?.henry_code || '') : '';
    const gen = pid ? (person.proband_data[pid]?.generation || 0) : 0;
    
    let childrenNodes: TreeNodeData[] = []; let spouseNodes: TreeNodeData[] = []; let parentNodes: TreeNodeData[] = [];

    if (!isSideBranch) {
      let childrenPersons: Person[] = [];
      if (pid && hCode) {
        childrenPersons = (childrenMap.get(hCode) || []).filter(c => !currentVisited.has(c.id));
        // Falls ein "Kürzester Pfad" aktiv ist, stelle sicher, dass auf dem Pfad liegende leibliche Kinder
        // (sowie bei aktivierter Ehepartner-Option auch auf dem Pfad liegende Kinder eines Ehepartners) erscheinen
        if (activePartnerPath.value.length > 0) {
          const existingChildIds = new Set(childrenPersons.map(c => c.id));
          const extraChildren = persons.value.filter(c => {
            if (currentVisited.has(c.id) || existingChildIds.has(c.id) || !highlightedPathIds.value.has(c.id)) return false;
            if (c.parent_ids.includes(person.id)) return true;
            if (shortestPathIncludeSpouses.value) {
              return person.spouses.some(sp => highlightedPathIds.value.has(sp.id) && c.parent_ids.includes(sp.id));
            }
            return false;
          });
          if (extraChildren.length > 0) {
            childrenPersons = [...childrenPersons, ...extraChildren].sort(comparePersonsByBirth);
          }
        }
      } else {
        // Freie Ansicht oder Vorfahren oberhalb des Stammahnen: alle leiblichen Kinder chronologisch nach Geburt
        childrenPersons = persons.value
          .filter(c => {
            if (currentVisited.has(c.id)) return false;
            if (c.parent_ids.includes(person.id)) return true;
            if (activePartnerPath.value.length > 0 && shortestPathIncludeSpouses.value && highlightedPathIds.value.has(c.id)) {
              return person.spouses.some(sp => highlightedPathIds.value.has(sp.id) && c.parent_ids.includes(sp.id));
            }
            return false;
          })
          .sort(comparePersonsByBirth);
      }
      childrenNodes.push(...childrenPersons.map(c => buildNode(c, false, null, null, currentVisited)));
    }

    const sideExp = expandedSideNodes.value.get(person.id);
    if (sideExp?.spouses) {
      const addedSpouseIds = new Set<string>();
      person.spouses.forEach(spConn => {
        if (!currentVisited.has(spConn.id) && !addedSpouseIds.has(spConn.id)) {
          const sp = persons.value.find(p => p.id === spConn.id);
          if (sp) {
            addedSpouseIds.add(spConn.id);
            const rInfo: RelationInfo = {
              type: 'spouse',
              date: spConn.date,
              place: spConn.place,
              is_divorced: spConn.is_divorced,
              divorce_date: spConn.divorce_date,
              partner_id: person.id
            };
            spouseNodes.push(buildNode(sp, true, 'spouse', rInfo, currentVisited));
          }
        }
      });

      // Auch Co-Elternteile gemeinsamer Kinder berücksichtigen, falls nicht explizit als Ehepartner hinterlegt
      persons.value
        .filter(c => c.parent_ids.includes(person.id))
        .forEach(c => {
          c.parent_ids.forEach(coParentId => {
            if (coParentId !== person.id && !currentVisited.has(coParentId) && !addedSpouseIds.has(coParentId)) {
              const coParent = persons.value.find(p => p.id === coParentId);
              if (coParent) {
                addedSpouseIds.add(coParentId);
                const rInfo: RelationInfo = {
                  type: 'spouse',
                  date: null,
                  place: null,
                  is_divorced: false,
                  divorce_date: null,
                  partner_id: person.id
                };
                spouseNodes.push(buildNode(coParent, true, 'spouse', rInfo, currentVisited));
              }
            }
          });
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

const shortestPathSearchResults = computed(() => {
  const query = shortestPathSearchQuery.value.toLowerCase().trim();
  if (!query || !selectedPerson.value) return [];
  const pid = activeProbandTab.value;
  const pList = (pid && !shortestPathIncludeSpouses.value)
    ? persons.value.filter(p => p.proband_data[pid])
    : persons.value;
  return pList
    .filter(p => p.id !== selectedPerson.value!.id && (
      p.id.toLowerCase().includes(query) ||
      (p.surname || '').toLowerCase().includes(query) ||
      (p.given_name || '').toLowerCase().includes(query) ||
      (pid && (p.proband_data[pid]?.henry_code || '').toLowerCase().includes(query))
    ))
    .slice(0, 10);
});

watch(shortestPathIncludeSpouses, () => {
  if (shortestPathEndpoints.value && activePartnerPath.value.length > 0) {
    showPartnerPath(shortestPathEndpoints.value.aId, shortestPathEndpoints.value.bId);
  }
});

function startShortestPathTo(targetId: string) {
  if (!selectedPerson.value) return;
  shortestPathSearchQuery.value = '';
  showPartnerPath(selectedPerson.value.id, targetId);
}

function clearPartnerPath() {
  activePartnerPath.value = [];
  shortestPathEndpoints.value = null;
}

function getTreeAncestorChain(person: Person, pid: string, startCode: string): Person[] {
  const chain: Person[] = [person];
  let currCode = person.proband_data[pid]?.henry_code;
  while (currCode) {
    const parentCode = getParentHenryCode(currCode, startCode);
    if (!parentCode) break;
    const parent = persons.value.find(p => p.proband_data[pid]?.henry_code === parentCode);
    if (!parent) break;
    chain.push(parent);
    currCode = parentCode;
  }
  return chain;
}

// Erstellt per Breitensuche (BFS) eine Map aller Vorfahren einer Person (ancestorId -> kürzeste Kette [person, ..., ancestor])
function buildAncestorPathsMap(startPerson: Person): Map<string, Person[]> {
  const map = new Map<string, Person[]>();
  const queue: { person: Person; chain: Person[] }[] = [{ person: startPerson, chain: [startPerson] }];
  map.set(startPerson.id, [startPerson]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const parentId of current.person.parent_ids) {
      if (!map.has(parentId)) {
        const parentObj = persons.value.find(p => p.id === parentId);
        if (parentObj) {
          const nextChain = [...current.chain, parentObj];
          map.set(parentId, nextChain);
          queue.push({ person: parentObj, chain: nextChain });
        }
      }
    }
  }
  return map;
}

// Findet per Breitensuche (BFS) den kürzesten Pfad zwischen zwei Personen unter Einbeziehung von Eltern-, Kind- und Ehepartner-Verbindungen
function findShortestPathWithSpouses(personA: Person, personB: Person, pid: string | null, startCode: string): Person[] {
  if (personA.id === personB.id) return [personA];

  const personById = new Map<string, Person>();
  persons.value.forEach(p => personById.set(p.id, p));

  const visited = new Set<string>([personA.id]);
  const queue: { person: Person; path: Person[] }[] = [{ person: personA, path: [personA] }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const u = current.person;

    if (u.id === personB.id) {
      return current.path;
    }

    const neighborIds: string[] = [];

    // 1. Eltern
    u.parent_ids.forEach(parentId => neighborIds.push(parentId));
    if (pid) {
      const uCode = u.proband_data[pid]?.henry_code;
      if (uCode) {
        const pCode = getParentHenryCode(uCode, startCode);
        if (pCode) {
          const hp = persons.value.find(p => p.proband_data[pid]?.henry_code === pCode);
          if (hp) neighborIds.push(hp.id);
        }
      }
    }

    // 2. Kinder
    persons.value.forEach(c => {
      if (c.parent_ids.includes(u.id)) {
        neighborIds.push(c.id);
      } else if (pid) {
        const uCode = u.proband_data[pid]?.henry_code;
        const cCode = c.proband_data[pid]?.henry_code;
        if (uCode && cCode && getParentHenryCode(cCode, startCode) === uCode) {
          neighborIds.push(c.id);
        }
      }
    });

    // 3. Ehepartner & Co-Elternteile
    u.spouses.forEach(s => neighborIds.push(s.id));
    persons.value.forEach(other => {
      if (other.spouses.some(s => s.id === u.id)) {
        neighborIds.push(other.id);
      }
      if (other.parent_ids.includes(u.id)) {
        other.parent_ids.forEach(coParentId => {
          if (coParentId !== u.id) neighborIds.push(coParentId);
        });
      }
    });

    for (const nId of neighborIds) {
      if (!visited.has(nId)) {
        const nObj = personById.get(nId);
        if (nObj) {
          visited.add(nId);
          const nextPath = [...current.path, nObj];
          if (nId === personB.id) {
            return nextPath;
          }
          queue.push({ person: nObj, path: nextPath });
        }
      }
    }
  }

  return [];
}

function isParentChildStep(parentCandidate: Person, childCandidate: Person, pid: string | null, startCode: string): boolean {
  if (childCandidate.parent_ids.includes(parentCandidate.id)) return true;
  if (pid) {
    const pCode = parentCandidate.proband_data[pid]?.henry_code;
    const cCode = childCandidate.proband_data[pid]?.henry_code;
    if (pCode && cCode && getParentHenryCode(cCode, startCode) === pCode) return true;
  }
  return false;
}

function areSpousesOrCoParents(a: Person, b: Person): boolean {
  if (a.spouses.some(s => s.id === b.id) || b.spouses.some(s => s.id === a.id)) return true;
  return persons.value.some(c => c.parent_ids.includes(a.id) && c.parent_ids.includes(b.id));
}

// Zeigt den kürzesten Pfad im Stammbaum zwischen zwei Personen an
function showPartnerPath(partnerAId: string, partnerBId: string) {
  const personA = persons.value.find(p => p.id === partnerAId);
  const personB = persons.value.find(p => p.id === partnerBId);
  if (!personA || !personB) return;

  shortestPathEndpoints.value = { aId: partnerAId, bId: partnerBId };

  const pid = activeProbandTab.value;
  const startCode = getActiveStartCode();

  let lcaPerson: Person | null = null;
  let fullPath: Person[] = [];

  if (shortestPathIncludeSpouses.value) {
    fullPath = findShortestPathWithSpouses(personA, personB, pid, startCode);
    if (fullPath.length > 0) {
      // Relative Generationsebene entlang des Pfades bestimmen (Elternteil = -1, Kind = +1, Ehepartner = 0)
      const levels: number[] = [0];
      for (let i = 0; i < fullPath.length - 1; i++) {
        const curr = fullPath[i];
        const next = fullPath[i + 1];
        if (isParentChildStep(next, curr, pid, startCode)) {
          levels.push(levels[i] - 1);
        } else if (isParentChildStep(curr, next, pid, startCode)) {
          levels.push(levels[i] + 1);
        } else {
          levels.push(levels[i]);
        }
      }
      const minLevel = Math.min(...levels);
      const topCandidates = fullPath.filter((_, idx) => levels[idx] === minLevel);
      // Bevorzuge als Wurzelknoten auf der höchsten Ebene einen Knoten mit Henry-Code im aktiven Stammahn-Tab
      // oder einen Knoten, der direkter Elternteil eines nachfolgenden Pfadknotens ist
      lcaPerson =
        (pid ? topCandidates.find(p => p.proband_data[pid]?.henry_code) : undefined) ||
        topCandidates.find(p => fullPath.some(other => other.id !== p.id && isParentChildStep(p, other, pid, startCode))) ||
        topCandidates[0];
    } else {
      lcaPerson = personA;
      fullPath = [personA, personB];
    }
  } else {
    // Nur Blutsverwandtschaft (Eltern-Kind-Linien ohne Ehepartner-Abkürzung)
    if (pid && personA.proband_data[pid]?.henry_code && personB.proband_data[pid]?.henry_code) {
      const chainA = getTreeAncestorChain(personA, pid, startCode);
      const chainB = getTreeAncestorChain(personB, pid, startCode);

      const setBIds = new Set(chainB.map(p => p.id));
      lcaPerson = chainA.find(p => setBIds.has(p.id)) || persons.value.find(p => p.id === pid) || chainA[chainA.length - 1];

      const idxA = chainA.findIndex(p => p.id === lcaPerson!.id);
      const idxB = chainB.findIndex(p => p.id === lcaPerson!.id);

      const pathAtoLCA = idxA >= 0 ? chainA.slice(0, idxA + 1) : chainA;
      const pathLCAtoB = idxB > 0 ? chainB.slice(0, idxB).reverse() : (idxB === -1 ? chainB.slice().reverse() : []);

      fullPath = [...pathAtoLCA, ...pathLCAtoB];
    } else {
      // Allgemeine Suche nach dem nächsten gemeinsamen Vorfahren über Eltern-Kind-Kanten
      const ancMapA = buildAncestorPathsMap(personA);
      const ancMapB = buildAncestorPathsMap(personB);

      let bestLcaId: string | null = null;
      let bestDist = Infinity;

      ancMapA.forEach((chainA, ancId) => {
        const chainB = ancMapB.get(ancId);
        if (chainB) {
          const totalDist = chainA.length + chainB.length;
          if (totalDist < bestDist) {
            bestDist = totalDist;
            bestLcaId = ancId;
          }
        }
      });

      if (bestLcaId) {
        const chainA = ancMapA.get(bestLcaId)!;
        const chainB = ancMapB.get(bestLcaId)!;
        lcaPerson = chainA[chainA.length - 1];
        fullPath = [...chainA, ...chainB.slice(0, -1).reverse()];
      } else {
        lcaPerson = personA;
        fullPath = [personA, personB];
      }
    }
  }

  if (!lcaPerson) return;

  activePartnerPath.value = fullPath;
  currentView.value = 'tree';
  currentTreeRootId.value = lcaPerson.id;
  pan.value = { x: 0, y: 0 };

  expandedNodes.value.clear();
  expandedSideNodes.value.clear();
  expandedFromChildMap.value.clear();

  const pathIdSet = new Set(fullPath.map(p => p.id));

  // Knoten auf dem Pfad nach unten aufklappen, wenn sie (oder bei aktivierter Ehepartner-Option ihr auf dem Pfad liegender Ehepartner) ein Kind im Pfad haben
  fullPath.forEach(p => {
    const hasOwnChildInPath = fullPath.some(other => other.id !== p.id && isParentChildStep(p, other, pid, startCode));
    const hasSpouseChildInPath = shortestPathIncludeSpouses.value && fullPath.some(sp =>
      sp.id !== p.id &&
      areSpousesOrCoParents(p, sp) &&
      fullPath.some(other => other.id !== sp.id && other.id !== p.id && isParentChildStep(sp, other, pid, startCode))
    );
    if (hasOwnChildInPath || hasSpouseChildInPath) {
      expandedNodes.value.set(p.id, true);
    }

    // Falls ein Ehepartner/Co-Elternteil von p ebenfalls Teil des Pfades ist, Ehepartner-Seitenast einblenden
    const hasSpouseInPath = fullPath.some(other => other.id !== p.id && areSpousesOrCoParents(p, other));
    if (hasSpouseInPath && pathIdSet.has(p.id)) {
      const side = expandedSideNodes.value.get(p.id) || { spouses: false, parents: false };
      side.spouses = true;
      expandedSideNodes.value.set(p.id, side);
    }
  });
}

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
  if (!val) {
    setProbandTab(null);
  } else {
    setProbandTab(val);
  }
}

function openFreeTreeView() {
  setProbandTab(null);
  currentView.value = 'tree';
}

function startFreeTreeWithPerson(person: Person) {
  activeProbandTab.value = null;
  freeInitialRootId.value = person.id;
  currentTreeRootId.value = person.id;
  selectedPerson.value = person;
  expandedNodes.value.clear();
  expandedSideNodes.value.clear();
  expandedFromChildMap.value.clear();
  expandedNodes.value.set(person.id, true);
  pan.value = { x: 0, y: 0 };
  zoom.value = 1;
}

function resetFreeTreeQuery() {
  currentTreeRootId.value = null;
  freeInitialRootId.value = null;
  expandedNodes.value.clear();
  expandedSideNodes.value.clear();
  expandedFromChildMap.value.clear();
  pan.value = { x: 0, y: 0 };
  zoom.value = 1;
}

watch(rootAncestors, (newVal) => {
  if (newVal.length > 0) {
    if (!activeProbandTab.value || !newVal.some(r => r.person_id === activeProbandTab.value)) {
      setProbandTab(newVal[0].person_id);
    }
  } else {
    setProbandTab(null);
  }
});

// Klappt rekursiv alle Nachkommengenerationen unterhalb einer Person ein
function collapseDescendantsOf(personId: string, visited = new Set<string>()) {
  if (visited.has(personId)) return;
  visited.add(personId);
  expandedNodes.value.set(personId, false);
  const children = persons.value.filter(p => p.parent_ids.includes(personId));
  children.forEach(c => collapseDescendantsOf(c.id, visited));
}

// Öffnet nur den gewählten Eintrag und die dazu nötigen Generationen im Stammbaum (ohne "Kürzesten Pfad")
function jumpToTreePerson(personId: string) {
  const target = persons.value.find(p => p.id === personId);
  if (!target) return;

  clearPartnerPath();
  selectedPerson.value = target;
  treeSearchQuery.value = '';
  currentView.value = 'tree';
  pan.value = { x: 0, y: 0 };

  expandedNodes.value.clear();
  expandedSideNodes.value.clear();
  expandedFromChildMap.value.clear();

  const pid = activeProbandTab.value;
  const startCode = getActiveStartCode();
  const tCode = pid ? target.proband_data[pid]?.henry_code : null;

  if (pid && tCode) {
    currentTreeRootId.value = null;
    const chain = getTreeAncestorChain(target, pid, startCode);
    // Alle Vorfahren-Generationen vom Stammahnen bis zum Elternteil von target öffnen, damit target sichtbar ist
    chain.slice(1).forEach(anc => {
      expandedNodes.value.set(anc.id, true);
    });
  } else if (pid) {
    // Falls target selbst keinen Henry-Code hat, prüfen ob ein Ehepartner im Baum des Stammahnen liegt
    const partnerWithCode = target.spouses
      .map(s => persons.value.find(p => p.id === s.id))
      .find(p => p && p.proband_data[pid]?.henry_code);
    if (partnerWithCode) {
      currentTreeRootId.value = null;
      const chain = getTreeAncestorChain(partnerWithCode, pid, startCode);
      chain.slice(1).forEach(anc => {
        expandedNodes.value.set(anc.id, true);
      });
      expandedSideNodes.value.set(partnerWithCode.id, { spouses: true, parents: false });
    } else {
      currentTreeRootId.value = target.id;
    }
  } else {
    // Freie Ansicht: Nötige Generationen von der aktuellen Wurzel zum Eintrag öffnen (oder Eintrag als Wurzel setzen)
    const baseRootId = freeInitialRootId.value || currentTreeRootId.value;
    const baseRoot = baseRootId ? persons.value.find(p => p.id === baseRootId) : null;
    if (baseRoot && baseRoot.id !== target.id) {
      const ancMapTarget = buildAncestorPathsMap(target);
      if (ancMapTarget.has(baseRoot.id)) {
        const chain = ancMapTarget.get(baseRoot.id)!;
        currentTreeRootId.value = baseRoot.id;
        chain.slice(1).forEach(anc => {
          expandedNodes.value.set(anc.id, true);
        });
      } else {
        const ancMapBase = buildAncestorPathsMap(baseRoot);
        let lcaId: string | null = null;
        let bestDist = Infinity;
        ancMapTarget.forEach((cT, aId) => {
          const cB = ancMapBase.get(aId);
          if (cB && cT.length + cB.length < bestDist) {
            bestDist = cT.length + cB.length;
            lcaId = aId;
          }
        });
        if (lcaId) {
          currentTreeRootId.value = lcaId;
          const chain = ancMapTarget.get(lcaId)!;
          chain.slice(1).forEach(anc => {
            expandedNodes.value.set(anc.id, true);
          });
        } else {
          currentTreeRootId.value = target.id;
          freeInitialRootId.value = target.id;
        }
      }
    } else {
      currentTreeRootId.value = target.id;
      freeInitialRootId.value = target.id;
    }
  }
}

function loadParentGeneration(rootNode: TreeNodeData) {
  let parentIdToLoad: string | null = null;
  const pid = activeProbandTab.value;
  const startCode = getActiveStartCode();
  const parentCode = (pid && rootNode.active_henry) ? getParentHenryCode(rootNode.active_henry, startCode) : null;
  
  if (pid && parentCode) {
    const parent = persons.value.find(p => p.proband_data[pid]?.henry_code === parentCode);
    if (parent) parentIdToLoad = parent.id;
  }
  
  if (!parentIdToLoad && rootNode.person.parent_ids.length > 0) {
    // Bevorzuge den Vater (M) als Hauptknoten, falls vorhanden, sonst ersten Elternteil
    const father = rootNode.person.parent_ids
      .map(id => persons.value.find(p => p.id === id))
      .find(p => p?.sex === 'M');
    parentIdToLoad = father ? father.id : rootNode.person.parent_ids[0];
  }

  if (parentIdToLoad) {
    const originChildId = rootNode.person.id;
    expandedFromChildMap.value.set(parentIdToLoad, originChildId);
    currentTreeRootId.value = parentIdToLoad;
    expandedNodes.value.set(parentIdToLoad, true);
    // Ehepartner des geladenen Elternteils einblenden, damit beide Eltern direkt sichtbar sind
    const currentSide = expandedSideNodes.value.get(parentIdToLoad) || { spouses: false, parents: false };
    currentSide.spouses = true;
    expandedSideNodes.value.set(parentIdToLoad, currentSide);
    pan.value = { x: 0, y: 0 };

    // Nur die Eltern und deren direkte Kinder (sowie ggf. bereits nach oben aufgeklappte Vorfahrenpfade) anzeigen, NICHT noch die Kindeskinder!
    const children = persons.value.filter(p => p.parent_ids.includes(parentIdToLoad!));
    children.forEach(c => {
      if (c.id === originChildId && expandedFromChildMap.value.has(originChildId)) {
        expandedNodes.value.set(originChildId, true);
      } else {
        collapseDescendantsOf(c.id);
      }
    });
    // Auch falls die Kinder über den Henry-Code zugeordnet sind, deren Nachkommen einklappen
    if (pid) {
      const parentObj = persons.value.find(p => p.id === parentIdToLoad);
      const pCode = parentObj?.proband_data[pid]?.henry_code;
      if (pCode) {
        persons.value.forEach(p => {
          const cCode = p.proband_data[pid]?.henry_code;
          if (cCode && getParentHenryCode(cCode, startCode) === pCode) {
            if (p.id === originChildId && expandedFromChildMap.value.has(originChildId)) {
              expandedNodes.value.set(originChildId, true);
            } else {
              collapseDescendantsOf(p.id);
            }
          }
        });
      }
    }
  }
}

// Schließt alle Vorfahren-Knoten oberhalb eines bestimmten Eintrags (stopAtPersonId)
function closeAncestorChainAbove(stopAtPersonId: string) {
  let curr = currentTreeRootId.value;
  const visited = new Set<string>();
  while (curr && curr !== stopAtPersonId && !visited.has(curr)) {
    visited.add(curr);
    const nextChild = expandedFromChildMap.value.get(curr);
    expandedNodes.value.set(curr, false);
    expandedSideNodes.value.set(curr, { spouses: false, parents: false });
    expandedFromChildMap.value.delete(curr);
    const children = persons.value.filter(p => p.parent_ids.includes(curr!));
    children.forEach(c => {
      if (c.id !== nextChild) {
        collapseDescendantsOf(c.id);
        expandedSideNodes.value.set(c.id, { spouses: false, parents: false });
      }
    });
    if (nextChild) {
      curr = nextChild;
    } else {
      break;
    }
  }
}

// Klappt alle Vorfahrengenerationen oberhalb des gewählten Eintrags ein
function collapseAncestors(personId: string) {
  closeAncestorChainAbove(personId);
  currentTreeRootId.value = personId;
  pan.value = { x: 0, y: 0 };
}

// Wechselt in der Freien Ansicht den "führenden" Elterneintrag und schließt alle expandierten Knoten des zuvor ausgewählten Elternteils
function switchLeadingParent(currentLeadId: string, newLeadId: string) {
  if (activeProbandTab.value) return;

  const activeChildId = expandedFromChildMap.value.get(currentLeadId);
  let targetLeadId = newLeadId;

  // Falls vom Hauptknoten aus gewechselt wurde und ein aktives Kind existiert, bevorzuge den anderen Elternteil dieses Kindes
  if (activeChildId) {
    const activeChild = persons.value.find(p => p.id === activeChildId);
    if (activeChild && !activeChild.parent_ids.includes(targetLeadId)) {
      const otherParentId = activeChild.parent_ids.find(id => id !== currentLeadId);
      if (otherParentId) targetLeadId = otherParentId;
    }
  }

  // 1. Alle Vorfahren-Knoten oberhalb des bisherigen führenden Elternteils schließen
  closeAncestorChainAbove(currentLeadId);

  // 2. Den bisherigen führenden Elternteil selbst sowie dessen Seitenäste und nicht zum aktiven Pfad gehörende Nachkommen schließen
  expandedNodes.value.set(currentLeadId, false);
  expandedSideNodes.value.set(currentLeadId, { spouses: false, parents: false });
  expandedFromChildMap.value.delete(currentLeadId);

  const prevChildren = persons.value.filter(p => p.parent_ids.includes(currentLeadId));
  prevChildren.forEach(c => {
    if (!activeChildId || c.id !== activeChildId || !expandedFromChildMap.value.has(activeChildId)) {
      collapseDescendantsOf(c.id);
      expandedSideNodes.value.set(c.id, { spouses: false, parents: false });
    }
  });

  // 3. Neuen führenden Elternteil als aktuelle Wurzel setzen und den bisherigen Elternteil seitlich als Partner einblenden
  currentTreeRootId.value = targetLeadId;
  expandedSideNodes.value.set(targetLeadId, { spouses: true, parents: false });

  if (activeChildId) {
    const activeChild = persons.value.find(p => p.id === activeChildId);
    if (activeChild && activeChild.parent_ids.includes(targetLeadId)) {
      expandedFromChildMap.value.set(targetLeadId, activeChildId);
      expandedNodes.value.set(targetLeadId, true);
      const newChildren = persons.value.filter(p => p.parent_ids.includes(targetLeadId));
      newChildren.forEach(c => {
        if (c.id === activeChildId && expandedFromChildMap.value.has(activeChildId)) {
          expandedNodes.value.set(activeChildId, true);
        } else {
          collapseDescendantsOf(c.id);
        }
      });
    } else {
      // Falls das bisherige Kind nicht zum neu gewählten Partner gehört, auch dessen Pfad schließen
      collapseDescendantsOf(activeChildId);
      expandedFromChildMap.value.clear();
      expandedNodes.value.set(targetLeadId, false);
      freeInitialRootId.value = targetLeadId;
    }
  } else {
    expandedNodes.value.set(targetLeadId, false);
    freeInitialRootId.value = targetLeadId;
  }

  pan.value = { x: 0, y: 0 };
}

function toggleTreeNode(personId: string) {
  const currentState = expandedNodes.value.get(personId) || false;
  if (currentState) {
    collapseDescendantsOf(personId);
  } else {
    expandedNodes.value.set(personId, true);
  }
}
function toggleSideNode(personId: string, type: 'spouses' | 'parents') { const current = expandedSideNodes.value.get(personId) || { spouses: false, parents: false }; current[type] = !current[type]; expandedSideNodes.value.set(personId, current); }
function changeLanguage(lang: string) { locale.value = lang; }

async function loadTrees() { try { trees.value = await invoke<string[]>('get_trees'); } catch (e) {} }

function resetTreeViewState() {
  selectedPerson.value = null;
  personDetails.value = null;
  isDetailsOpen.value = false;
  isEditing.value = false;
  parentEditError.value = '';
  activePartnerPath.value = [];
  currentTreeRootId.value = null;
  freeInitialRootId.value = null;
  freeQuerySurname.value = '';
  freeQueryGiven.value = '';
  freeQueryBirth.value = '';
  freeQueryId.value = '';
  expandedNodes.value.clear();
  expandedSideNodes.value.clear();
  expandedFromChildMap.value.clear();
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
    await loadRootAncestors();
    if (rootAncestors.value.length > 0) {
      await invoke('calculate_henry_codes_from_roots');
    }
    await loadPersons();
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
async function loadPersons() {
  try {
    const res = await invoke<Person[]>('get_all_persons');
    persons.value = res;
    syncDynamicColumns(res);
    editedPersons.value = new Map(res.map(p => [p.id, clonePerson(p)]));
    if (selectedPerson.value) {
      const updatedSelected = res.find(p => p.id === selectedPerson.value!.id);
      selectedPerson.value = updatedSelected || null;
    }
  } catch (error) {}
}
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
function toggleEditMode() {
  if (isEditing.value) {
    editedPersons.value = new Map(persons.value.map(p => [p.id, clonePerson(p)]));
  }
  isEditing.value = !isEditing.value;
  parentEditError.value = '';
}
async function saveChanges() {
  try {
    isLoading.value = true;
    for (const [_, person] of editedPersons.value.entries()) {
      await invoke('update_person', { person });
    }
    statusMessage.value = 'Gespeichert.';
    isEditing.value = false;
    await loadPersons();
    if (selectedPerson.value) {
      await loadDetails(selectedPerson.value.id);
    }
  } catch (error) {
    statusMessage.value = `Fehler beim Speichern: ${error}`;
  } finally {
    isLoading.value = false;
  }
}

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
          <button @click="currentView = 'tree'" :class="{ active: currentView === 'tree' }">🌳 {{ t('view_tree') }}</button>
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

    <div class="proband-selector-bar" v-if="rootAncestors.length > 0 || persons.length > 0">
      <label for="proband-view-select" class="proband-select-label">
        🌳 <strong>{{ t('proband_view_label') }}:</strong>
      </label>
      <select
        id="proband-view-select"
        class="proband-select-dropdown"
        :value="activeProbandTab ?? ''"
        @change="onProbandSelectChange(($event.target as HTMLSelectElement).value)"
      >
        <option value="">{{ t('free_view_option') }}</option>
        <option v-for="r in rootAncestors" :key="r.person_id" :value="r.person_id">
          [{{ r.starting_code }}] {{ r.surname || 'N.N.' }}, {{ r.given_name || 'N.N.' }} ({{ r.person_id }})
        </option>
      </select>
      <button
        class="btn-free-view"
        :class="{ active: currentView === 'tree' && !activeProbandTab }"
        @click="openFreeTreeView"
      >
        🧭 {{ t('free_tree_btn') }}
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
          <h3>{{ t('table_col_config') }}</h3>
          <div class="custom-multi-select">
            <div class="select-header" @click="showColDropdown = !showColDropdown">
              {{ t('select_table_cols') }} ({{ columns.filter(c => c.visible).length }} / {{ columns.length }}) <span style="float:right">▼</span>
            </div>
            <div class="select-dropdown" v-if="showColDropdown">
              <div v-for="(col, index) in columns" :key="col.key" class="select-item">
                <label>
                  <input type="checkbox" v-model="col.visible" />
                  {{ getColLabel(col) }}
                  <small v-if="!col.editable" class="readonly-hint">(schreibgeschützt)</small>
                </label>
                <div class="order-btns">
                  <button @click.stop="moveColumn(index, 'up')" :disabled="index === 0">▲</button>
                  <button @click.stop="moveColumn(index, 'down')" :disabled="index === columns.length - 1">▼</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h3>{{ t('detail_attr_config') }}</h3>
          <div class="custom-multi-select">
            <div class="select-header" @click="showDetailAttrDropdown = !showDetailAttrDropdown">
              {{ t('select_detail_attrs') }} ({{ columns.filter(c => c.detailVisible).length }} / {{ columns.length }}) <span style="float:right">▼</span>
            </div>
            <div class="select-dropdown" v-if="showDetailAttrDropdown">
              <div v-for="(col, index) in columns" :key="'det-cfg-' + col.key" class="select-item">
                <label>
                  <input type="checkbox" v-model="col.detailVisible" />
                  {{ getColLabel(col) }}
                  <small v-if="!col.editable" class="readonly-hint">(schreibgeschützt)</small>
                </label>
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
              <th v-for="col in activeTableColumns" :key="col.key">
                <div class="th-header" @click="sortBy(col.key)">
                  {{ getColLabel(col) }}
                  <span class="sort-icon">{{ sortKey === col.key ? (sortAsc ? '▲' : '▼') : '↕' }}</span>
                </div>
                <div class="filter-controls" @click.stop v-if="columnFilters[col.key]">
                  <template v-if="col.isDate || col.key.includes('date')">
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
              <template v-for="col in activeTableColumns" :key="col.key">
                <td>
                  <template v-if="!isEditing || !col.editable">
                    <span v-if="col.key === 'henry_code'"><strong>{{ getCode(person) || '-' }}</strong></span>
                    <span v-else-if="col.key === 'generation'">{{ getGen(person) ?? '-' }}</span>
                    <span v-else-if="col.key === 'id'"><small>{{ person.id }}</small></span>
                    <span v-else>{{ getPersonAttr(person, col.key) || (col.key === 'given_name' ? 'N.N.' : '-') }}</span>
                  </template>
                  <template v-else-if="editedPersons.get(person.id)">
                    <select
                      v-if="col.key === 'sex'"
                      :value="editedPersons.get(person.id)!.sex || 'U'"
                      @change="setPersonAttr(editedPersons.get(person.id)!, 'sex', ($event.target as HTMLSelectElement).value)"
                      @click.stop
                    >
                      <option value="M">M</option>
                      <option value="F">F</option>
                      <option value="U">U</option>
                    </select>
                    <input
                      v-else
                      :value="getPersonAttr(editedPersons.get(person.id)!, col.key) ?? ''"
                      @input="setPersonAttr(editedPersons.get(person.id)!, col.key, ($event.target as HTMLInputElement).value)"
                      @click.stop
                    />
                  </template>
                </td>
              </template>
            </tr>
            <tr v-if="displayPersons.length === 0"><td :colspan="Math.max(activeTableColumns.length, 1)" class="empty">{{ t('no_data') }}</td></tr>
          </tbody>
        </table>
      </div>

      <!-- 2. Grafische Stammbaum-Ansicht (Volle Breite) -->
      <div class="tree-wrapper" v-if="currentView === 'tree'">
        
        <div class="tree-tools" @mousedown.stop v-if="activeProbandTab || currentTreeRootId">
          <div class="tree-tools-left">
            <div class="tree-search-wrapper">
              <input v-model="treeSearchQuery" :placeholder="t('tree_search_placeholder')" />
              <ul v-if="treeSearchQuery && treeSearchResults.length > 0" class="search-dropdown">
                <li v-for="res in treeSearchResults" :key="'s-'+res.id" @click="jumpToTreePerson(res.id)">
                  {{ res.surname || 'N.N.' }}, {{ res.given_name || 'N.N.' }}
                  <span v-if="getCode(res)">[{{ getCode(res) }}]</span>
                  <small v-else>({{ res.id }})</small>
                </li>
              </ul>
            </div>

            <button v-if="!activeProbandTab && currentTreeRootId" class="btn-new-free-query" @click="resetFreeTreeQuery">
              🔍 {{ t('free_new_query') }}
            </button>
          </div>

          <div v-if="activePartnerPath.length > 0" class="partner-path-banner">
            <div class="partner-path-header">
              <strong>🔗 {{ t('partner_path_title') }}:</strong>
              <button class="btn-clear-path" @click="clearPartnerPath">✖ {{ t('clear_path') }}</button>
            </div>
            <div class="partner-path-steps">
              <template v-for="(stepPerson, idx) in activePartnerPath" :key="'path-' + stepPerson.id">
                <span
                  class="path-step-chip"
                  :class="{ 'is-selected': selectedPerson?.id === stepPerson.id }"
                  @click="selectedPerson = stepPerson"
                >
                  {{ stepPerson.given_name || 'N.N.' }} {{ stepPerson.surname || '' }}
                  <strong v-if="getCode(stepPerson)">[{{ getCode(stepPerson) }}]</strong>
                </span>
                <span v-if="idx < activePartnerPath.length - 1" class="path-arrow">↔</span>
              </template>
            </div>
          </div>
        </div>

        <!-- Freie Ansicht: Initiale Abfragemaske (leer beginnend ohne ausgewählte Startperson) -->
        <div v-if="!activeProbandTab && !currentTreeRootId" class="free-query-container" @mousedown.stop @wheel.stop>
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
                  @click="startFreeTreeWithPerson(p)"
                >
                  <div class="fq-person-main">
                    <strong>{{ p.surname || 'N.N.' }}, {{ p.given_name || 'N.N.' }}</strong>
                    <small class="fq-id">({{ p.id }})</small>
                    <span class="fq-dates">
                      <span v-if="p.birth_date || p.birth_place">* {{ p.birth_date || '?' }} {{ p.birth_place ? 'in ' + p.birth_place : '' }}</span>
                      <span v-if="p.death_date"> | † {{ p.death_date }}</span>
                    </span>
                  </div>
                  <button class="btn-sm btn-select-person" @click.stop="startFreeTreeWithPerson(p)">
                    {{ t('free_open_person') }}
                  </button>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div v-else class="tree-viewport" @mousedown="startDrag" @mousemove="onDrag" @mouseup="stopDrag" @mouseleave="stopDrag" @wheel="handleZoom">
          <div v-if="hierarchicalTree.length === 0" class="empty">{{ t('no_data') }}</div>
          <div v-else class="tree-transform" :style="{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }">
            <div class="css-tree">
              <ul>
                <TreeNode 
                  v-for="root in hierarchicalTree" :key="root.person.id" :node="root" :is-root="true" :selected-id="selectedPerson?.id || ''"
                  :expanded-nodes="expandedNodes" :expanded-side-nodes="expandedSideNodes" :highlighted-path-ids="highlightedPathIds"
                  :is-free-view="!activeProbandTab"
                  @select="p => selectedPerson = p" @toggle="toggleTreeNode" @toggle-side="toggleSideNode" 
                  @load-parent="loadParentGeneration" @collapse-ancestors="collapseAncestors"
                  @switch-leading-parent="switchLeadingParent"
                  @jump-to="jumpToTreePerson" @show-partner-path="showPartnerPath"
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
                  <tr v-for="col in activeDetailColumns" :key="'det-' + col.key">
                    <td><strong>{{ getColLabel(col) }}</strong></td>
                    <td>
                      <template v-if="!isEditing || !col.editable">
                        <span v-if="col.key === 'henry_code'"><strong>{{ getCode(selectedPerson) || '-' }}</strong></span>
                        <span v-else-if="col.key === 'generation'">{{ getGen(selectedPerson) ?? '-' }}</span>
                        <span v-else>{{ getPersonAttr(selectedPerson, col.key) || '-' }}</span>
                      </template>
                      <template v-else-if="editedPersons.get(selectedPerson.id)">
                        <select
                          v-if="col.key === 'sex'"
                          :value="editedPersons.get(selectedPerson.id)!.sex || 'U'"
                          @change="setPersonAttr(editedPersons.get(selectedPerson.id)!, 'sex', ($event.target as HTMLSelectElement).value)"
                          class="w-100"
                        >
                          <option value="M">M</option>
                          <option value="F">F</option>
                          <option value="U">U</option>
                        </select>
                        <input
                          v-else
                          :value="getPersonAttr(editedPersons.get(selectedPerson.id)!, col.key) ?? ''"
                          @input="setPersonAttr(editedPersons.get(selectedPerson.id)!, col.key, ($event.target as HTMLInputElement).value)"
                          class="w-100"
                        />
                      </template>
                    </td>
                  </tr>
                </tbody>
              </table>
              <button v-if="isEditing" class="btn-save w-100 mt-1" @click="saveChanges" :disabled="isLoading">
                {{ t('save_changes') }}
              </button>
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
                  <template v-if="getRelCode(sp.partner_id) || sp.partner_henry">
                    <span
                      v-if="sp.partner_id"
                      class="badge ml-1 clickable-henry"
                      :title="t('jump_to_spouse_tooltip')"
                      @click="jumpToTreePerson(sp.partner_id)"
                    >
                      [{{ getRelCode(sp.partner_id) || sp.partner_henry }}] 🔗
                    </span>
                    <span v-else class="badge ml-1">
                      [{{ getRelCode(sp.partner_id) || sp.partner_henry }}]
                    </span>
                  </template>
                  <span
                    v-else-if="sp.partner_id"
                    class="badge ml-1 clickable-henry"
                    :title="t('jump_to_spouse_tooltip')"
                    @click="jumpToTreePerson(sp.partner_id)"
                  >
                    🔗
                  </span>
                  <div class="marriage-info">(* {{ sp.partner_birth || '?' }}<span v-if="sp.partner_death"> - † {{ sp.partner_death }}</span>)</div>
                  <div class="marriage-info">💍 {{ t('wedding_date') }}: {{ sp.marriage_date || '-' }} <span v-if="sp.is_divorced || sp.divorce_date"> | 💔 {{ t('divorce_date') }}: {{ sp.divorce_date || 'Ja' }}</span></div>
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

        <!-- Fester Bereich ganz unten im Bereich der Eintragsdetails: Suchfeld für "Kürzesten Pfad" -->
        <div class="details-shortest-path-footer" v-if="selectedPerson">
          <label class="shortest-path-label">
            🔗 <strong>{{ t('shortest_path_search_label') }}:</strong>
          </label>
          <div class="shortest-path-controls-row">
            <div class="shortest-path-search-box">
              <input
                v-model="shortestPathSearchQuery"
                :placeholder="t('shortest_path_search_placeholder')"
                class="shortest-path-input"
              />
              <ul v-if="shortestPathSearchQuery && shortestPathSearchResults.length > 0" class="shortest-path-dropdown">
                <li
                  v-for="res in shortestPathSearchResults"
                  :key="'sp-search-' + res.id"
                  @click="startShortestPathTo(res.id)"
                >
                  <span>{{ res.surname || 'N.N.' }}, {{ res.given_name || 'N.N.' }}</span>
                  <strong v-if="getCode(res)" class="sp-code"> [{{ getCode(res) }}]</strong>
                  <small v-else class="sp-id"> ({{ res.id }})</small>
                </li>
              </ul>
            </div>
            <label class="spouse-path-slider-wrap" :title="t('shortest_path_spouse_slider_tooltip')">
              <input type="checkbox" v-model="shortestPathIncludeSpouses" class="spouse-path-checkbox" />
              <span class="spouse-path-slider"></span>
              <span class="spouse-path-slider-text">{{ t('shortest_path_spouse_slider') }}</span>
            </label>
          </div>
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
button:disabled { background-color: #95a5a6; cursor-not-allowed: true; cursor: not-allowed; }
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
.select-dropdown { position: absolute; top: 100%; left: 0; width: 100%; background: white; border: 1px solid #bdc3c7; border-radius: 4px; margin-top: 4px; z-index: 100; max-height: 260px; overflow-y: auto; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
.select-item { display: flex; justify-content: space-between; align-items: center; padding: 0.4rem 0.8rem; border-bottom: 1px solid #ecf0f1; font-size: 0.85rem; }
.select-item:last-child { border-bottom: none; }
.readonly-hint { color: #95a5a6; margin-left: 4px; font-style: italic; }
.order-btns button { background: #7f8c8d; padding: 2px 6px; font-size: 0.6rem; margin-left: 4px; color: white; border: none; border-radius: 3px; cursor: pointer; }

/* Workspace */
.workspace { display: grid; grid-template-columns: 2fr 1fr; gap: 1.5rem; position: relative; }
.workspace.tree-mode { display: block; height: 75vh; overflow: hidden; border: 1px solid #dcdde1; border-radius: 4px; background: white; }

/* Table Container & Filter */
.table-container { overflow-x: auto; overflow-y: auto; max-height: 70vh; border: 1px solid #dcdde1; border-radius: 4px; background: white; }
th { background-color: #f5f6fa; font-weight: bold; color: #2f3640; position: sticky; top: 0; z-index: 1; vertical-align: top; }
.th-header { display: flex; justify-content: space-between; cursor: pointer; padding-bottom: 5px; border-bottom: 1px solid #dcdde1; margin-bottom: 5px; }
.sort-icon { color: #7f8c8d; font-size: 0.8rem; }
.filter-controls { font-weight: normal; }
.filter-inp, .filter-sel { width: 100%; box-sizing: border-box; font-size: 0.8rem; padding: 4px; border: 1px solid #bdc3c7; border-radius: 3px; }

/* Tree Wrapper & Viewport */
.tree-wrapper { display: flex; flex-direction: column; height: 100%; position: relative; }
.tree-tools { display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between; align-items: center; padding: 12px 15px; border-bottom: 1px solid #dcdde1; z-index: 10; background: white; }
.tree-tools-left { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.tree-search-wrapper { position: relative; width: 320px; }
.tree-search-wrapper input { width: 100%; padding: 0.5rem; border: 1px solid #bdc3c7; border-radius: 4px; box-sizing: border-box; }
.search-dropdown { position: absolute; top: 100%; left: 0; width: 100%; background: white; border: 1px solid #bdc3c7; border-radius: 4px; max-height: 250px; overflow-y: auto; z-index: 100; list-style: none; padding: 0; margin: 0; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
.search-dropdown li { padding: 0.6rem; cursor: pointer; border-bottom: 1px solid #ecf0f1; font-size: 0.85rem; }
.search-dropdown li:hover { background: #e3f2fd; }

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
.btn-new-free-query {
  background-color: #8e44ad;
  color: white;
  font-size: 0.82rem;
  padding: 0.45rem 0.85rem;
  border-radius: 4px;
}
.btn-new-free-query:hover:not(:disabled) {
  background-color: #732d91;
}

/* Freie Ansicht: Initiale Abfragemaske */
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
.btn-select-person {
  background-color: #3498db;
  white-space: nowrap;
}

/* Partner Path Banner */
.partner-path-banner {
  flex: 1;
  min-width: 300px;
  background: #fff8e1;
  border: 1px solid #ffe082;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 0.82rem;
}
.partner-path-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
  color: #b7791f;
}
.btn-clear-path {
  background: #e67e22 !important;
  color: white !important;
  padding: 2px 8px !important;
  font-size: 0.75rem !important;
  border-radius: 4px;
}
.partner-path-steps {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}
.path-step-chip {
  background: white;
  border: 1px solid #f39c12;
  border-radius: 4px;
  padding: 2px 6px;
  cursor: pointer;
  color: #2c3e50;
  transition: background 0.15s;
}
.path-step-chip:hover, .path-step-chip.is-selected {
  background: #fef5e7;
  border-color: #d35400;
  font-weight: bold;
}
.path-arrow {
  color: #e67e22;
  font-weight: bold;
}

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
.workspace.tree-mode .details-pane { position: absolute; top: 0; right: 0; height: 100%; width: 400px; z-index: 100; border-left: 1px solid #dcdde1; box-shadow: -4px 0 15px rgba(0,0,0,0.1); transform: translateX(100%); transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); background: rgba(255, 255, 255, 0.98); }
.workspace.tree-mode .details-pane.is-open { transform: translateX(0); }
.details-scroll-area { padding: 1.2rem; overflow-y: auto; flex-grow: 1; display: flex; flex-direction: column; }
.placeholder { margin: auto; display: flex; align-items: center; justify-content: center; color: #718093; text-align: center; height: 100%; }

/* Fester Bereich ganz unten in den Eintragsdetails für "Kürzester Pfad" */
.details-shortest-path-footer {
  flex-shrink: 0;
  border-top: 2px solid #e9ecef;
  background: #f8f9fa;
  padding: 0.75rem 1.2rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.shortest-path-label {
  font-size: 0.85rem;
  color: #2c3e50;
}
.shortest-path-controls-row {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}
.shortest-path-search-box {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
}
.shortest-path-input {
  width: 100%;
  padding: 0.45rem 0.65rem;
  border: 1px solid #bdc3c7;
  border-radius: 4px;
  box-sizing: border-box;
  font-size: 0.85rem;
  background: white;
}
.shortest-path-input:focus {
  outline: 2px solid rgba(230, 126, 34, 0.35);
  border-color: #e67e22;
}
.spouse-path-slider-wrap {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  cursor: pointer;
  user-select: none;
  flex-shrink: 0;
  font-size: 0.78rem;
  color: #2c3e50;
}
.spouse-path-checkbox {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
  pointer-events: none;
}
.spouse-path-slider {
  position: relative;
  display: inline-block;
  width: 34px;
  height: 18px;
  background-color: #bdc3c7;
  border-radius: 18px;
  transition: background-color 0.2s ease;
  flex-shrink: 0;
}
.spouse-path-slider::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  background-color: white;
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  transition: transform 0.2s ease;
}
.spouse-path-checkbox:checked + .spouse-path-slider {
  background-color: #e67e22;
}
.spouse-path-checkbox:checked + .spouse-path-slider::after {
  transform: translateX(16px);
}
.spouse-path-slider-text {
  white-space: nowrap;
  font-weight: 600;
}
.shortest-path-dropdown {
  position: absolute;
  bottom: 100%;
  left: 0;
  width: 100%;
  background: white;
  border: 1px solid #bdc3c7;
  border-radius: 4px;
  max-height: 220px;
  overflow-y: auto;
  z-index: 120;
  list-style: none;
  padding: 0;
  margin: 0 0 4px 0;
  box-shadow: 0 -4px 10px rgba(0, 0, 0, 0.12);
}
.shortest-path-dropdown li {
  padding: 0.55rem 0.75rem;
  cursor: pointer;
  border-bottom: 1px solid #ecf0f1;
  font-size: 0.84rem;
  color: #2c3e50;
}
.shortest-path-dropdown li:last-child {
  border-bottom: none;
}
.shortest-path-dropdown li:hover {
  background: #fff8e1;
}
.sp-code {
  color: #d35400;
}
.sp-id {
  color: #7f8c8d;
}

.details-toggle-btn { position: absolute; left: -40px; bottom: 20px; width: 40px; background: white; border: 1px solid #dcdde1; border-right: none; border-radius: 15px 0 0 15px; box-shadow: -3px 0 8px rgba(0,0,0,0.08); cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #2c3e50; z-index: 101; padding: 15px 5px; transition: background 0.2s ease; }
.details-toggle-btn:hover { background: #f8f9fa; }
.details-toggle-btn .icon { font-size: 0.9rem; margin-bottom: 5px; }
.details-toggle-btn .toggle-text { writing-mode: vertical-rl; text-orientation: mixed; font-size: 0.85rem; font-weight: bold; letter-spacing: 2px; color: #7f8c8d; }

:deep(.css-tree > ul) { padding-top: 35px; position: relative; display: flex; justify-content: center; padding-left: 0; margin: 0; }
:deep(.css-tree li) { text-align: center; list-style-type: none; position: relative; }

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
.clickable-henry { background: #2980b9; cursor: pointer; transition: background 0.15s, transform 0.1s; display: inline-block; }
.clickable-henry:hover { background: #e67e22; transform: scale(1.05); }
.ml-1 { margin-left: 5px; }
.marriage-info { font-size: 0.75rem; color: #7f8c8d; margin-top: 2px; }
</style>