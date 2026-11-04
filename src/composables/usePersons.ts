import { ref, computed, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { DEFAULT_CARD_CONFIG, type DesignCardConfig } from '../types/design';
import type { AddPersonPayload } from '../components/modals/AddPersonModal.vue';

export interface ProbandData {
  henry_code: string;
  generation: number;
}

export interface SpouseConnection {
  id: string;
  date: string | null;
  place: string | null;
  divorce_date: string | null;
  is_divorced: boolean;
}

export interface RelationInfo {
  type: 'spouse' | 'parent';
  date?: string | null;
  place?: string | null;
  is_divorced?: boolean;
  divorce_date?: string | null;
  partner_id?: string | null;
}

export interface Person {
  id: string;
  given_name: string | null;
  surname: string | null;
  sex: string | null;
  birth_date: string | null;
  birth_place: string | null;
  death_date: string | null;
  death_place: string | null;
  proband_data: Record<string, ProbandData>;
  gedcom_extra: Record<string, any>;
  spouses: SpouseConnection[];
  parent_ids: string[];
}

export interface TreeNodeData {
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

export interface RelativePerson {
  id: string;
  given_name: string | null;
  surname: string | null;
  henry_code: string | null;
  birth_date: string | null;
  death_date: string | null;
}

export interface SpouseInfo {
  family_id: string;
  partner_id: string | null;
  partner_name: string | null;
  partner_henry: string | null;
  partner_birth: string | null;
  partner_death: string | null;
  marriage_date: string | null;
  divorce_date: string | null;
  is_divorced: boolean;
}

export interface PersonDetails {
  parents: RelativePerson[];
  siblings: RelativePerson[];
  spouses: SpouseInfo[];
  children: RelativePerson[];
  notes: string[];
  gedcom_tags: Record<string, string>;
}

export interface ColumnConfig {
  key: string;
  labelKey: string;
  visible: boolean;
  detailVisible: boolean;
  editable: boolean;
  isDate?: boolean;
  customLabel?: string;
}

export interface RootAncestorConfig {
  person_id: string;
  starting_code: string;
  given_name: string | null;
  surname: string | null;
}

export interface ColumnFilter {
  text: string;
  dateOp: 'before' | 'after' | 'between';
  date1: string;
  date2: string;
}

export const KNOWN_GEDCOM_TAGS = new Set([
  'NAME',
  'SEX',
  'BIRT',
  'DEAT',
  'CHR',
  'BURI',
  'OCCU',
  'RELI',
  'TITL',
  'RESI',
  'NOTE',
  'SOUR',
  'CHAN',
  'FAMC',
  'FAMS',
]);

export function isValidGedcomXref(val: string | null | undefined): boolean {
  if (!val) return false;
  const s = val.trim();
  if (!s) return false;
  // GEDCOM XREF: 1-20 Zeichen (Buchstaben, Ziffern, Unterstrich, Bindestrich, Punkt, Doppelpunkt)
  // Optional in @...@ eingefasst (3-22 Zeichen)
  // Erstes Zeichen nach @ bzw. am Anfang: [A-Za-z0-9_] (darf nicht mit # oder Symbolen beginnen)
  const regex = /^(?:@[A-Za-z0-9_][A-Za-z0-9_.:-]{0,19}@|[A-Za-z0-9_][A-Za-z0-9_.:-]{0,19})$/;
  return regex.test(s);
}

export function normalizeGedcomXref(val: string | null | undefined): string {
  if (!val) return '';
  const s = val.trim();
  if (s.startsWith('@') && s.endsWith('@') && s.length >= 3) {
    return s.slice(1, -1);
  }
  return s;
}

export function clonePerson(p: Person): Person {
  return {
    ...p,
    proband_data: p.proband_data ? JSON.parse(JSON.stringify(p.proband_data)) : {},
    gedcom_extra: p.gedcom_extra ? JSON.parse(JSON.stringify(p.gedcom_extra)) : {},
    spouses: p.spouses ? [...p.spouses] : [],
    parent_ids: p.parent_ids ? [...p.parent_ids] : [],
  };
}

export function extractYear(val: any): number {
  if (!val) return 0;
  const match = String(val).match(/\d{4}/);
  return match ? parseInt(match[0], 10) : 0;
}

export function readGedcomSub(
  extra: Record<string, any> | undefined,
  tag: string,
  subKey: string
): string | null {
  if (!extra || !extra[tag]) return null;
  const entry = extra[tag];
  if (typeof entry === 'object' && entry !== null) {
    if (
      entry[subKey] !== undefined &&
      entry[subKey] !== null &&
      String(entry[subKey]).trim() !== ''
    ) {
      return String(entry[subKey]);
    }
    if (subKey === '_val') {
      const parts = Object.entries(entry).map(([k, v]) =>
        k === '_val' ? String(v) : `${k}: ${v}`
      );
      return parts.join(', ') || null;
    }
    return null;
  }
  return subKey === '_val' ? String(entry) : null;
}

export function writeGedcomSub(person: Person, tag: string, subKey: string, value: string) {
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

export function parseBirthSortKey(dateStr: string | null | undefined): [number, number, number] {
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
    JAN: 1,
    FEB: 2,
    MAR: 3,
    MÄR: 3,
    MAER: 3,
    APR: 4,
    MAY: 5,
    MAI: 5,
    JUN: 6,
    JUL: 7,
    AUG: 8,
    SEP: 9,
    OCT: 10,
    OKT: 10,
    NOV: 11,
    DEC: 12,
    DEZ: 12,
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

export function comparePersonsByBirth(a: Person, b: Person): number {
  const [ya, ma, da] = parseBirthSortKey(a.birth_date);
  const [yb, mb, db] = parseBirthSortKey(b.birth_date);
  if (ya !== yb) return ya - yb;
  if (ma !== mb) return ma - mb;
  if (da !== db) return da - db;
  return a.id.localeCompare(b.id);
}

export interface UsePersonsOptions {
  onIdRenamed?: (oldId: string, newId: string) => void;
  onCodesCalculated?: () => void;
  onResetTreeViewState?: () => void;
  onSetProbandTab?: (personId: string | null) => void;
  onEnsureTableView?: () => void;
}

export function usePersons(
  t: (key: string, named?: Record<string, unknown>) => string,
  options?: UsePersonsOptions
) {
  const trees = ref<string[]>([]);
  const activeTree = ref<string>('');
  const newTreeName = ref<string>('');

  const persons = ref<Person[]>([]);
  const rootAncestors = ref<RootAncestorConfig[]>([]);
  const editedPersons = ref<Map<string, Person>>(new Map());
  const selectedPerson = ref<Person | null>(null);
  const personDetails = ref<PersonDetails | null>(null);

  const selectedFatherId = ref<string>('');
  const selectedMotherId = ref<string>('');
  const parentEditError = ref<string>('');

  const selectedRootId = ref<string>('');
  const newRootCode = ref<string>('1');
  const rootSearchQuery = ref<string>('');
  const activeProbandTab = ref<string | null>(null);

  const isEditing = ref<boolean>(false);
  const saveErrorAlert = ref<string>('');
  const statusMessage = ref<string>('');
  const isLoading = ref<boolean>(false);

  // Stammbaum löschen (2-Stufen-Sicherheitsabfrage)
  const showDeleteTreeModal = ref<boolean>(false);
  const treeToDelete = ref<string>('');

  // Modal-State für allgemeines Anlegen
  const showAddModal = ref<boolean>(false);
  const addPersonError = ref<string>('');

  // Design-Mode Konfiguration (inkl. Persistenz in localStorage)
  const designConfig = ref({
    horizontalLaneGap: 16,
    autoSubLanes: true,
    enableLineBridges: true,
    bridgeRadius: 8,
    minimizeBridges: true,
    cardConfig: { ...DEFAULT_CARD_CONFIG } as DesignCardConfig,
  });

  try {
    const savedDesignCfg = localStorage.getItem('stammbaum_design_config');
    if (savedDesignCfg) {
      const parsed = JSON.parse(savedDesignCfg);
      designConfig.value = {
        ...designConfig.value,
        ...parsed,
        cardConfig: {
          ...DEFAULT_CARD_CONFIG,
          ...(parsed.cardConfig || {}),
        },
      };
    }
  } catch {}

  watch(
    designConfig,
    newVal => {
      try {
        localStorage.setItem('stammbaum_design_config', JSON.stringify(newVal));
      } catch {}
    },
    { deep: true }
  );

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
    { key: 'id', labelKey: 'col_id', visible: true, detailVisible: true, editable: true },
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
    { key: 'chan', labelKey: 'col_chan', visible: false, detailVisible: true, editable: false },
  ]);

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
        const isUid = rawTag === '_UID' || rawTag === 'UID';
        columns.value.push({
          key: colKey,
          labelKey: colKey,
          customLabel: `GEDCOM: ${rawTag}`,
          visible: false,
          detailVisible: true,
          editable: !isUid,
        });
      }
    });
    ensureColumnFilters();
  }

  const activeTableColumns = computed(() => {
    return columns.value.filter(
      c => c.visible && (c.key !== 'henry_code' || activeProbandTab.value !== null)
    );
  });

  const activeDetailColumns = computed(() => {
    return columns.value.filter(
      c => c.detailVisible && (c.key !== 'henry_code' || activeProbandTab.value !== null)
    );
  });

  function sortBy(key: string) {
    if (sortKey.value === key) sortAsc.value = !sortAsc.value;
    else {
      sortKey.value = key;
      sortAsc.value = true;
    }
  }

  function getCode(p: Person) {
    return activeProbandTab.value ? p.proband_data[activeProbandTab.value]?.henry_code : null;
  }

  function getGen(p: Person) {
    return activeProbandTab.value ? p.proband_data[activeProbandTab.value]?.generation : null;
  }

  function getPersonAttr(person: Person, key: string): any {
    if (key === 'henry_code') return getCode(person);
    if (key === 'generation') return getGen(person);
    if (key in person) return (person as any)[key];
    const extra = person.gedcom_extra;
    switch (key) {
      case 'chr_date':
        return readGedcomSub(extra, 'CHR', 'DATE');
      case 'chr_place':
        return readGedcomSub(extra, 'CHR', 'PLAC');
      case 'buri_date':
        return readGedcomSub(extra, 'BURI', 'DATE');
      case 'buri_place':
        return readGedcomSub(extra, 'BURI', 'PLAC');
      case 'occu':
        return readGedcomSub(extra, 'OCCU', '_val');
      case 'reli':
        return readGedcomSub(extra, 'RELI', '_val');
      case 'titl':
        return readGedcomSub(extra, 'TITL', '_val');
      case 'resi':
        return readGedcomSub(extra, 'RESI', '_val') || readGedcomSub(extra, 'RESI', 'PLAC');
      case 'note':
        return readGedcomSub(extra, 'NOTE', '_val');
      case 'sour':
        return readGedcomSub(extra, 'SOUR', '_val');
      case 'chan':
        return readGedcomSub(extra, 'CHAN', 'DATE') || readGedcomSub(extra, 'CHAN', '_val');
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
      case 'id':
        person.id = value;
        break;
      case 'surname':
        person.surname = valOrNull;
        break;
      case 'given_name':
        person.given_name = valOrNull;
        break;
      case 'sex':
        person.sex = valOrNull;
        break;
      case 'birth_date':
        person.birth_date = valOrNull;
        break;
      case 'birth_place':
        person.birth_place = valOrNull;
        break;
      case 'death_date':
        person.death_date = valOrNull;
        break;
      case 'death_place':
        person.death_place = valOrNull;
        break;
      case 'chr_date':
        writeGedcomSub(person, 'CHR', 'DATE', value);
        break;
      case 'chr_place':
        writeGedcomSub(person, 'CHR', 'PLAC', value);
        break;
      case 'buri_date':
        writeGedcomSub(person, 'BURI', 'DATE', value);
        break;
      case 'buri_place':
        writeGedcomSub(person, 'BURI', 'PLAC', value);
        break;
      case 'occu':
        writeGedcomSub(person, 'OCCU', '_val', value);
        break;
      case 'reli':
        writeGedcomSub(person, 'RELI', '_val', value);
        break;
      case 'titl':
        writeGedcomSub(person, 'TITL', '_val', value);
        break;
      case 'resi':
        writeGedcomSub(person, 'RESI', '_val', value);
        break;
      case 'note':
        writeGedcomSub(person, 'NOTE', '_val', value);
        break;
      case 'sour':
        writeGedcomSub(person, 'SOUR', '_val', value);
        break;
      default:
        if (key === 'ged__UID' || key === 'ged_UID' || key.toLowerCase() === 'ged__uid') {
          return;
        }
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

  const hasInvalidEditedPerson = computed(() => {
    if (!isEditing.value) return false;
    for (const [origId, editedPerson] of editedPersons.value.entries()) {
      const orig = persons.value.find(p => p.id === origId);
      if (!orig) continue;
      const isDifferent =
        editedPerson.id !== orig.id ||
        editedPerson.given_name !== orig.given_name ||
        editedPerson.surname !== orig.surname ||
        editedPerson.sex !== orig.sex ||
        editedPerson.birth_date !== orig.birth_date ||
        editedPerson.birth_place !== orig.birth_place ||
        editedPerson.death_date !== orig.death_date ||
        editedPerson.death_place !== orig.death_place ||
        JSON.stringify(editedPerson.gedcom_extra || {}) !== JSON.stringify(orig.gedcom_extra || {});
      if (isDifferent && !isValidGedcomXref(editedPerson.id)) {
        return true;
      }
    }
    return false;
  });

  const malePersons = computed(() => {
    return persons.value.filter(
      p => p.sex === 'M' && (!selectedPerson.value || p.id !== selectedPerson.value.id)
    );
  });

  const femalePersons = computed(() => {
    return persons.value.filter(
      p => p.sex === 'F' && (!selectedPerson.value || p.id !== selectedPerson.value.id)
    );
  });

  watch(personDetails, details => {
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
      selectedFatherId.value = father ? father.id : details.parents[0]?.id || '';
      selectedMotherId.value = mother
        ? mother.id
        : details.parents.length > 1
          ? details.parents[1].id
          : '';
    } else {
      selectedFatherId.value = '';
      selectedMotherId.value = '';
    }
  });

  const displayPersons = computed(() => {
    let filtered = persons.value;
    if (activeProbandTab.value)
      filtered = filtered.filter(p => p.proband_data[activeProbandTab.value!]);

    filtered = filtered.filter(p => {
      for (const col of activeTableColumns.value) {
        const filter = columnFilters.value[col.key];
        if (!filter) continue;
        const val = getPersonAttr(p, col.key);
        if (col.isDate || col.key.includes('date')) {
          if (filter.date1) {
            const valYear = extractYear(val);
            const f1 = extractYear(filter.date1);
            if (valYear === 0) return false;
            if (filter.dateOp === 'before' && valYear >= f1) return false;
            if (filter.dateOp === 'after' && valYear <= f1) return false;
            if (filter.dateOp === 'between') {
              const f2 = extractYear(filter.date2);
              if (valYear < f1 || valYear > f2) return false;
            }
          }
        } else {
          if (
            filter.text &&
            String(val || '')
              .toLowerCase()
              .indexOf(filter.text.toLowerCase()) === -1
          )
            return false;
        }
      }
      return true;
    });

    const effectiveSortKey =
      sortKey.value === 'henry_code' && !activeProbandTab.value ? 'surname' : sortKey.value;
    filtered.sort((a, b) => {
      const valA = getPersonAttr(a, effectiveSortKey) ?? '';
      const valB = getPersonAttr(b, effectiveSortKey) ?? '';
      if (valA < valB) return sortAsc.value ? -1 : 1;
      if (valA > valB) return sortAsc.value ? 1 : -1;
      return 0;
    });
    return filtered;
  });

  const filteredPersons = computed(() => {
    const query = rootSearchQuery.value.toLowerCase().trim();
    if (!query) return persons.value;
    return persons.value.filter(
      p =>
        p.id.toLowerCase().includes(query) ||
        (p.surname || '').toLowerCase().includes(query) ||
        (p.given_name || '').toLowerCase().includes(query)
    );
  });

  async function loadTrees() {
    try {
      trees.value = await invoke<string[]>('get_trees');
    } catch (e) {}
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

  async function loadRootAncestors() {
    try {
      rootAncestors.value = await invoke<RootAncestorConfig[]>('get_root_ancestors');
    } catch (e) {}
  }

  async function addRootAncestor() {
    if (!selectedRootId.value || !newRootCode.value) return;
    try {
      isLoading.value = true;
      await invoke('add_root_ancestor', {
        personId: selectedRootId.value,
        startingCode: newRootCode.value,
      });
      selectedRootId.value = '';
      newRootCode.value = '1';
      await invoke('calculate_henry_codes_from_roots');
      await loadPersons();
      await loadRootAncestors();
    } catch (e) {
    } finally {
      isLoading.value = false;
    }
  }

  async function removeRootAncestor(personId: string) {
    try {
      isLoading.value = true;
      await invoke('remove_root_ancestor', { personId });
      await invoke('calculate_henry_codes_from_roots');
      await loadPersons();
      await loadRootAncestors();
    } catch (e) {
    } finally {
      isLoading.value = false;
    }
  }

  async function calculateCodes() {
    try {
      isLoading.value = true;
      statusMessage.value = 'Berechne Henry-Codes...';
      await invoke('calculate_henry_codes_from_roots');
      await loadPersons();
      await loadRootAncestors();
      options?.onCodesCalculated?.();
      statusMessage.value = 'Berechnet.';
    } catch (e) {
    } finally {
      isLoading.value = false;
    }
  }

  async function loadDetails(personId: string) {
    try {
      personDetails.value = await invoke<PersonDetails>('get_person_details', { personId });
    } catch (error) {}
  }

  async function handleImport() {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'GEDCOM Dateien', extensions: ['ged'] }],
      });
      if (selected && typeof selected === 'string') {
        isLoading.value = true;
        statusMessage.value = 'Importiere...';
        if (!activeTree.value) {
          const stem =
            selected
              .split(/[\\/]/)
              .pop()
              ?.replace(/\.ged$/i, '')
              .trim() || 'stammbaum';
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
      saveErrorAlert.value = '';
      editedPersons.value = new Map(persons.value.map(p => [p.id, clonePerson(p)]));
    }
    isEditing.value = !isEditing.value;
    parentEditError.value = '';
    saveErrorAlert.value = '';
  }

  async function saveChanges() {
    saveErrorAlert.value = '';

    // 1. Sammle alle geänderten Personen
    const updates: { original_id: string; person: Person }[] = [];
    for (const [origId, editedPerson] of editedPersons.value.entries()) {
      const origPerson = persons.value.find(p => p.id === origId);
      if (!origPerson) continue;

      const isDifferent =
        editedPerson.id !== origPerson.id ||
        editedPerson.given_name !== origPerson.given_name ||
        editedPerson.surname !== origPerson.surname ||
        editedPerson.sex !== origPerson.sex ||
        editedPerson.birth_date !== origPerson.birth_date ||
        editedPerson.birth_place !== origPerson.birth_place ||
        editedPerson.death_date !== origPerson.death_date ||
        editedPerson.death_place !== origPerson.death_place ||
        JSON.stringify(editedPerson.gedcom_extra || {}) !==
          JSON.stringify(origPerson.gedcom_extra || {});

      if (isDifferent) {
        updates.push({ original_id: origId, person: clonePerson(editedPerson) });
      }
    }

    if (updates.length === 0) {
      isEditing.value = false;
      statusMessage.value = t('changes_saved');
      return;
    }

    // 2. Gesamtheitliche Konsistenzprüfung vor dem Speichern
    for (const u of updates) {
      const trimmedId = (u.person.id || '').trim();
      const name = `${u.person.given_name || 'N.N.'} ${u.person.surname || ''}`.trim();
      if (!trimmedId) {
        const msg = t('id_required_for', { name });
        saveErrorAlert.value = msg;
        statusMessage.value = msg;
        return;
      }
      if (!isValidGedcomXref(trimmedId)) {
        const msg = t('xref_format_error', { id: trimmedId });
        saveErrorAlert.value = msg;
        statusMessage.value = msg;
        return;
      }
    }

    // IDs normalisieren (z.B. @I123@ -> I123)
    for (const u of updates) {
      u.person.id = normalizeGedcomXref(u.person.id);
    }

    // Duplikate innerhalb der geänderten Liste prüfen
    const targetIdMap = new Map<string, string>();
    for (const u of updates) {
      const newId = u.person.id;
      const name = `${u.person.given_name || 'N.N.'} ${u.person.surname || ''}`.trim();
      if (targetIdMap.has(newId)) {
        const first = targetIdMap.get(newId)!;
        const msg = t('id_duplicate_in_batch', { id: newId, nameA: first, nameB: name });
        saveErrorAlert.value = msg;
        statusMessage.value = msg;
        return;
      }
      targetIdMap.set(newId, name);
    }

    // Kollisionsprüfung gegen bestehende, unberührte Datensätze im Stammbaum
    const batchOrigIds = new Set(updates.map(u => u.original_id));
    for (const u of updates) {
      const newId = u.person.id;
      if (newId !== u.original_id) {
        if (!batchOrigIds.has(newId)) {
          const existing = persons.value.find(p => p.id === newId);
          if (existing) {
            const existingName =
              `${existing.given_name || 'N.N.'} ${existing.surname || ''}`.trim();
            const msg = t('id_already_used', { id: newId, name: existingName });
            saveErrorAlert.value = msg;
            statusMessage.value = msg;
            return;
          }
        }
      }
    }

    // 3. Atomares Speichern über Backend
    try {
      isLoading.value = true;
      await invoke('update_persons_batch', { updates });

      for (const u of updates) {
        const newId = u.person.id;
        if (newId !== u.original_id) {
          if (selectedPerson.value && selectedPerson.value.id === u.original_id) {
            selectedPerson.value.id = newId;
          }
          if (activeProbandTab.value === u.original_id) {
            activeProbandTab.value = newId;
          }
          options?.onIdRenamed?.(u.original_id, newId);
        }
      }

      statusMessage.value = t('changes_saved');
      isEditing.value = false;
      saveErrorAlert.value = '';
      await loadPersons();
      await loadRootAncestors();
      if (selectedPerson.value) {
        await loadDetails(selectedPerson.value.id);
      }
    } catch (error: any) {
      saveErrorAlert.value = String(error);
      statusMessage.value = `Fehler beim Speichern: ${error}`;
    } finally {
      isLoading.value = false;
    }
  }

  async function savePersonParents() {
    if (!selectedPerson.value) return;
    parentEditError.value = '';
    try {
      isLoading.value = true;
      await invoke('update_person_parents', {
        personId: selectedPerson.value.id,
        fatherId: selectedFatherId.value || null,
        motherId: selectedMotherId.value || null,
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

  function calculateNextIdFromPersons(): string {
    let maxNum: number | null = null;
    let bestPrefix = 'I';
    persons.value.forEach(p => {
      const trimmed = (p.id || '').trim().replace(/^@+|@+$/g, '');
      const match = trimmed.match(/^([^0-9]*)(\d+)$/);
      if (match) {
        const prefix = match[1];
        const num = parseInt(match[2], 10);
        if (!isNaN(num)) {
          if (maxNum === null || num > maxNum) {
            maxNum = num;
            bestPrefix = prefix;
          }
        }
      }
    });
    if (maxNum !== null) {
      return `${bestPrefix}${maxNum + 1}`;
    }
    return 'I1';
  }

  function moveColumn(index: number, direction: 'up' | 'down') {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex >= 0 && targetIndex < columns.value.length) {
      const temp = columns.value[index];
      columns.value[index] = columns.value[targetIndex];
      columns.value[targetIndex] = temp;
    }
  }

  function resetPersonViewState() {
    selectedPerson.value = null;
    personDetails.value = null;
    isEditing.value = false;
    parentEditError.value = '';
    rootSearchQuery.value = '';
    selectedRootId.value = '';
    selectedFatherId.value = '';
    selectedMotherId.value = '';
    activeProbandTab.value = null;
    columns.value.forEach(c => {
      columnFilters.value[c.key] = { text: '', dateOp: 'before', date1: '', date2: '' };
    });
    options?.onResetTreeViewState?.();
  }

  async function handleTreeSwitch() {
    try {
      resetPersonViewState();
      if (!activeTree.value) {
        persons.value = [];
        editedPersons.value = new Map();
        rootAncestors.value = [];
        options?.onEnsureTableView?.();
        return;
      }
      await invoke('switch_tree', { treeName: activeTree.value });
      await loadRootAncestors();
      if (rootAncestors.value.length > 0) {
        await invoke('calculate_henry_codes_from_roots');
      }
      await loadPersons();
      if (rootAncestors.value.length > 0) {
        options?.onSetProbandTab?.(rootAncestors.value[0].person_id);
      } else {
        options?.onSetProbandTab?.(null);
        options?.onEnsureTableView?.();
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

  function startDeleteTree() {
    if (!activeTree.value) return;
    treeToDelete.value = activeTree.value;
    showDeleteTreeModal.value = true;
  }

  function cancelDeleteTree() {
    showDeleteTreeModal.value = false;
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
        resetPersonViewState();
        persons.value = [];
        editedPersons.value = new Map();
        rootAncestors.value = [];
        options?.onEnsureTableView?.();
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
    addPersonError.value = '';
    showAddModal.value = true;
  }

  async function handleAddPerson(payload: AddPersonPayload) {
    addPersonError.value = '';
    try {
      isLoading.value = true;
      if (!activeTree.value) {
        activeTree.value = 'stammbaum';
        await invoke('switch_tree', { treeName: 'stammbaum' });
        await loadTrees();
      }
      await invoke('add_person', { ...payload });
      showAddModal.value = false;
      await loadPersons();
      await loadRootAncestors();
      if (payload.targetPersonId) await loadDetails(payload.targetPersonId);
    } catch (error: any) {
      addPersonError.value = String(error);
    } finally {
      isLoading.value = false;
    }
  }

  async function initTrees() {
    await loadTrees();
    if (trees.value.length > 0) {
      activeTree.value = trees.value[0];
      await handleTreeSwitch();
    } else {
      activeTree.value = '';
      persons.value = [];
      rootAncestors.value = [];
    }
  }

  return {
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
    ensureColumnFilters,
    getColLabel,
    syncDynamicColumns,
    sortBy,
    getCode,
    getGen,
    getPersonAttr,
    setPersonAttr,
    getRelCode,
    getActiveStartCode,
    loadTrees,
    loadPersons,
    loadRootAncestors,
    addRootAncestor,
    removeRootAncestor,
    calculateCodes,
    loadDetails,
    handleImport,
    toggleEditMode,
    saveChanges,
    savePersonParents,
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
  };
}
