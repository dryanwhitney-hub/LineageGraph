import type { Person } from '../composables/usePersons';
import {
  resolveGenealogyTree,
  readPersonOccupation,
  type ResolvedLineageResult,
} from '../domain/design/lineageResolver';
import type {
  DesignDocumentModel,
  DesignTreeBundle,
  LineagePolicy,
} from '../domain/design/sceneTypes';
import { getLocaleDefinition, type SupportedLocale } from '../locales/registry';
import type { ExportPersonInput } from './htmlExport';
import {
  cleanupRenderedMaskOutput,
  escapeHtmlText,
  escapeLatexText,
  evaluateMaskAst,
  parseMaskAst,
  type AstNode,
} from './latexAst';

export type LatexSourceMode = 'design_document' | 'root_ancestor' | 'custom_person';
export type LatexExportMode = LatexSourceMode;
export type LatexExportDirection = 'descendants' | 'ancestors';
export type AncestorSortPattern =
  | 'kekule_patrilineal'
  | 'matrilineal_recursive'
  | 'generation_kekule';
export type UnknownParentPreset = 'classic' | 'archival' | 'short' | 'custom';

export interface LatexTemplateConfig {
  id: string;
  name: string;
  description?: string;
  codeMask: string;
  nameMask: string;
  entryMask: string;
  spouseMask: string;
  documentClass: 'scrartcl' | 'scrbook' | 'article';
  paperSize: 'a4paper' | 'a5paper' | 'letterpaper';
  fontSize: '10pt' | '11pt' | '12pt';
  marginMm: number;
  entrySpacingEm: number;
  indentStepEm: number;
  showGenerationBadge: boolean;
  includeHeaderInfo: boolean;
  enableIndexGeneration: boolean;
  enableBranchOverviewTable: boolean;
}

export interface LatexTemplateEntry {
  id: string;
  name: string;
  created_at: string;
  config_data: string;
}

export interface LatexRootAncestorInput {
  person_id: string;
  starting_code: string;
  given_name: string | null;
  surname: string | null;
}

export interface LatexExportOptions {
  sourceMode: LatexSourceMode;
  rootPersonId: string;
  startCode: string;
  lineagePolicy: LineagePolicy;
  designBundle?: DesignTreeBundle | null;
  rootAncestors?: LatexRootAncestorInput[];
  direction: LatexExportDirection;
  maxGenerations: number;
  ancestorSortPattern: AncestorSortPattern;
  unknownParentPreset: UnknownParentPreset;
  customUnknownFatherText: string;
  customUnknownMotherText: string;
  enableBranchSplit: boolean;
  branchSplitGeneration: number;
  selectedBranchIds: string[]; // Person IDs of chosen branch anchors (across any generation)
  baseFileName: string;
  treeSubdir?: string;
  textsSubdir?: string;
  customDocumentTitle: string;
  customDocumentSubtitle: string;
  template: LatexTemplateConfig;
  locale: SupportedLocale;
}

export interface DetectedBranchInfo {
  personId: string;
  code: string;
  safeFileCode: string;
  name: string;
  surname: string;
  givenName: string;
  birthDate: string;
  deathDate: string;
  generation: number;
  descendantCount: number;
  fileName: string;
  isDesignSubtree: boolean;
  isAutoDeferred?: boolean;
}

export interface GenerationSummary {
  generation: number;
  count: number;
  branchesWithChildrenCount: number;
}

export type LatexFileRole = 'master' | 'format' | 'structure' | 'data' | 'intro';

export interface GeneratedLatexFile {
  fileName: string;
  label: string;
  role: LatexFileRole;
  isMasterFile: boolean;
  isMainFile: boolean;
  branchCode?: string;
  branchPersonName?: string;
  entryCount: number;
  maxGeneration: number;
  texContent: string;
  previewHtml: string;
}

export interface LatexExportResult {
  baseFileName: string;
  treeSubdir: string;
  textsSubdir: string;
  masterFileName: string;
  structureFileName: string;
  files: GeneratedLatexFile[];
  totalEntries: number;
  maxGenerationReached: number;
  unknownBranchesStopped: number;
  bridgeRefsCount: number;
  detectedGenerations: GenerationSummary[];
  allAvailableBranches: DetectedBranchInfo[];
  activeSplitBranches: DetectedBranchInfo[];
}

export interface LatexVariableDefinition {
  token: string;
  shorthandExample?: string;
  labelKey: string;
  labelDe: string;
  labelEn: string;
  example: string;
  category: 'identity' | 'vital' | 'family' | 'extra';
}

export const LATEX_VARIABLE_DEFINITIONS: LatexVariableDefinition[] = [
  {
    token: '{ordnungs_id}',
    labelKey: 'var_ordnungs_id',
    labelDe: 'Ordnungs-Code (Henry / Kekulé)',
    labelEn: 'Order Code (Henry / Kekulé)',
    example: '121',
    category: 'identity',
  },
  {
    token: '{henry_id}',
    labelKey: 'var_henry_id',
    labelDe: 'Henry-Code (Stammahn)',
    labelEn: 'Henry Code (Root Ancestor)',
    example: '121',
    category: 'identity',
  },
  {
    token: '{kekule_id}',
    labelKey: 'var_kekule_id',
    labelDe: 'Kekulé-Nr. (Vorfahren)',
    labelEn: 'Kekulé No. (Ancestors)',
    example: '4',
    category: 'identity',
  },
  {
    token: '{nachname}',
    labelKey: 'var_nachname',
    labelDe: 'Nachname',
    labelEn: 'Surname',
    example: 'Froning',
    category: 'identity',
  },
  {
    token: '{vorname}',
    shorthandExample: '{, ?vorname}',
    labelKey: 'var_vorname',
    labelDe: 'Vorname',
    labelEn: 'Given Name',
    example: 'Johann Henrich',
    category: 'identity',
  },
  {
    token: '{vollname}',
    labelKey: 'var_vollname',
    labelDe: 'Vor- & Nachname',
    labelEn: 'Full Name',
    example: 'Johann Henrich Froning',
    category: 'identity',
  },
  {
    token: '{generation}',
    labelKey: 'var_generation',
    labelDe: 'Generation (z.B. Gen. 3)',
    labelEn: 'Generation (e.g. Gen. 3)',
    example: 'Gen. 3',
    category: 'identity',
  },
  {
    token: '{generation_badge}',
    labelKey: 'var_generation_badge',
    labelDe: 'Generations-Badge (falls aktiv)',
    labelEn: 'Generation Badge (if enabled)',
    example: '[Gen. 3]',
    category: 'identity',
  },
  {
    token: '{sohn_tochter}',
    labelKey: 'var_sohn_tochter',
    labelDe: 'Sohn / Tochter',
    labelEn: 'Son / Daughter',
    example: 'Sohn',
    category: 'identity',
  },
  {
    token: '{rolle}',
    labelKey: 'var_rolle',
    labelDe: 'Verwandtschaftsrolle',
    labelEn: 'Relationship Role',
    example: 'Vater',
    category: 'identity',
  },
  {
    token: '{xref}',
    labelKey: 'var_xref',
    labelDe: 'GEDCOM-ID',
    labelEn: 'GEDCOM ID',
    example: '@I12@',
    category: 'identity',
  },
  {
    token: '{implex}',
    labelKey: 'var_implex',
    labelDe: 'Implex-Hinweis (mit Seitenzahl)',
    labelEn: 'Implex Notice (with page ref)',
    example: '[Implex → 112, S. 14]',
    category: 'identity',
  },
  {
    token: '{stamm_verweis}',
    labelKey: 'var_stamm_verweis',
    labelDe: 'Stamm- / Brücken-Querverweis',
    labelEn: 'Branch / Bridge Cross-Reference',
    example: '→ Stamm [12], S. 24',
    category: 'identity',
  },
  {
    token: '{lebensdaten}',
    labelKey: 'var_lebensdaten',
    labelDe: 'Lebensdaten komplett (* / †)',
    labelEn: 'Vital Dates (* / †)',
    example: '* 12.04.1820 in Coesfeld, † 03.11.1891 in Münster',
    category: 'vital',
  },
  {
    token: '{geburtsdatum}',
    labelKey: 'var_geburtsdatum',
    labelDe: 'Geburtsdatum',
    labelEn: 'Birth Date',
    example: '12.04.1820',
    category: 'vital',
  },
  {
    token: '{geburtsort}',
    labelKey: 'var_geburtsort',
    labelDe: 'Geburtsort',
    labelEn: 'Birth Place',
    example: 'Coesfeld',
    category: 'vital',
  },
  {
    token: '{taufe}',
    labelKey: 'var_taufe',
    labelDe: 'Taufe komplett',
    labelEn: 'Baptism Block',
    example: '~ 14.04.1820 in St. Lamberti',
    category: 'vital',
  },
  {
    token: '{sterbedatum}',
    labelKey: 'var_sterbedatum',
    labelDe: 'Sterbedatum',
    labelEn: 'Death Date',
    example: '03.11.1891',
    category: 'vital',
  },
  {
    token: '{sterbeort}',
    labelKey: 'var_sterbeort',
    labelDe: 'Sterbeort',
    labelEn: 'Death Place',
    example: 'Münster',
    category: 'vital',
  },
  {
    token: '{beerdigung}',
    labelKey: 'var_beerdigung',
    labelDe: 'Beerdigung komplett',
    labelEn: 'Burial Block',
    example: '▭ 06.11.1891 in Münster',
    category: 'vital',
  },
  {
    token: '{ehepartner}',
    labelKey: 'var_ehepartner',
    labelDe: 'Ehepartner inline (falls im Slot #5 gewünscht)',
    labelEn: 'Spouses inline (optional in Slot #5)',
    example: '⚭ Anna Maria Meyer',
    category: 'family',
  },
  {
    token: '{hochzeit}',
    labelKey: 'var_hochzeit',
    labelDe: 'Hochzeit komplett (⚭)',
    labelEn: 'Marriage Block (⚭)',
    example: '⚭ 18.05.1845 in Coesfeld',
    category: 'family',
  },
  {
    token: '{scheidung}',
    labelKey: 'var_scheidung',
    labelDe: 'Scheidung komplett (⚮)',
    labelEn: 'Divorce Block (⚮)',
    example: '⚮ 15.06.1985 in Münster',
    category: 'family',
  },
  {
    token: '{kinder_anzahl}',
    labelKey: 'var_kinder_anzahl',
    labelDe: 'Anzahl Kinder',
    labelEn: 'Children Count',
    example: '4',
    category: 'family',
  },
  {
    token: '{beruf}',
    shorthandExample: '{, ?beruf}',
    labelKey: 'var_beruf',
    labelDe: 'Beruf / Stand (Rohwert)',
    labelEn: 'Occupation (Raw)',
    example: 'Ackersmann',
    category: 'extra',
  },
  {
    token: '{religion}',
    shorthandExample: '{ [?religion]}',
    labelKey: 'var_religion',
    labelDe: 'Konfession (Rohwert)',
    labelEn: 'Religion (Raw)',
    example: 'kath.',
    category: 'extra',
  },
  {
    token: '{wohnort}',
    shorthandExample: '{ (wh. ?wohnort)}',
    labelKey: 'var_wohnort',
    labelDe: 'Wohnort (Rohwert)',
    labelEn: 'Residence (Raw)',
    example: 'Münster',
    category: 'extra',
  },
  {
    token: '{notizen}',
    labelKey: 'var_notizen',
    labelDe: 'Notizen / Anmerkungen (Rohwert)',
    labelEn: 'Notes (Raw)',
    example: 'Pächter auf Hof Schulze',
    category: 'extra',
  },
];

export const DEFAULT_LATEX_TEMPLATES: LatexTemplateConfig[] = [
  {
    id: 'builtin_book_classic',
    name: 'Klassischer Buchdruck (Kompakt)',
    description: 'Sauberes 3-Slot-Satzbild für Familienchroniken mit Register und Stamm-Übersicht.',
    codeMask: '{if ordnungs_id}[{ordnungs_id}]{endif}',
    nameMask: '{nachname}{, ?vorname}',
    entryMask:
      '{if generation_badge}\\textsf{\\footnotesize {generation_badge}} {endif}{?lebensdaten}{, ?beruf}{ (wh. ?wohnort)}{ [?religion]}{if implex} \\emph{\\footnotesize{implex}}{endif}{if stamm_verweis}\\newline\\emph{\\footnotesize{stamm_verweis}}{endif}{if notizen}\\newline\\footnotesize{Anm.: {notizen}}{endif}',
    spouseMask:
      '\\textbf{{partner_name}}{ ?partner_lebensdaten}{, ?partner_beruf}{, ?hochzeit}{, ?scheidung}{ ?partner_verweis}',
    documentClass: 'scrbook',
    paperSize: 'a4paper',
    fontSize: '11pt',
    marginMm: 22,
    entrySpacingEm: 0.45,
    indentStepEm: 1.15,
    showGenerationBadge: true,
    includeHeaderInfo: true,
    enableIndexGeneration: true,
    enableBranchOverviewTable: true,
  },
  {
    id: 'builtin_chronicle_narrative',
    name: 'Chronik & Familienbuch (Narrativ)',
    description: 'Ausführliche Lebensläufe mit Taufe, Beerdigung und abgesetzten Anmerkungen.',
    codeMask: '{if ordnungs_id}{ordnungs_id}.{endif}',
    nameMask: '{vollname}',
    entryMask:
      '{if generation_badge}\\textit{({generation})} {endif}{if geburtsdatum}* {geburtsdatum}{ in ?geburtsort}{endif}{if taufe}, {taufe}{endif}{if sterbedatum}, † {sterbedatum}{ in ?sterbeort}{endif}{if beerdigung}, {beerdigung}{endif}{if beruf}. Beruf: {beruf}{endif}{if wohnort}, wohnhaft in {wohnort}{endif}{if religion} ({religion}){endif}.{if implex}\\newline\\emph{\\footnotesize{implex}}{endif}{if stamm_verweis}\\newline\\emph{\\footnotesize{stamm_verweis}}{endif}{if notizen}\\newline\\footnotesize\\textit{Anmerkung:} {notizen}{endif}',
    spouseMask:
      '\\textbf{{partner_name}}{ ?partner_lebensdaten}{, ?partner_beruf}{ — ?hochzeit}{, ?scheidung}{ ?partner_verweis}',
    documentClass: 'scrbook',
    paperSize: 'a4paper',
    fontSize: '11pt',
    marginMm: 25,
    entrySpacingEm: 0.55,
    indentStepEm: 1.25,
    showGenerationBadge: false,
    includeHeaderInfo: true,
    enableIndexGeneration: true,
    enableBranchOverviewTable: true,
  },
  {
    id: 'builtin_register_tabular',
    name: 'Register-Stil (Nachname hervorgehoben)',
    description: 'Kapitälchen-Nachnamen und knappe Eckdaten für große Nachkommenverzeichnisse.',
    codeMask: '{if ordnungs_id}[{ordnungs_id}]{endif}',
    nameMask: '\\textsc{{nachname}}{, ?vorname}',
    entryMask:
      '{?lebensdaten}{, ?beruf}{if stamm_verweis} \\emph{\\footnotesize{stamm_verweis}}{endif}{if implex} \\emph{\\footnotesize{implex}}{endif}',
    spouseMask: '{partner_name}{ ?partner_lebensdaten}{, ?hochzeit}{ ?partner_verweis}',
    documentClass: 'scrartcl',
    paperSize: 'a4paper',
    fontSize: '10pt',
    marginMm: 18,
    entrySpacingEm: 0.35,
    indentStepEm: 1.0,
    showGenerationBadge: false,
    includeHeaderInfo: true,
    enableIndexGeneration: true,
    enableBranchOverviewTable: true,
  },
  {
    id: 'builtin_research_dossier',
    name: 'Forschungsbericht (Alle Details & GEDCOM-ID)',
    description: 'Enthält GEDCOM-XREF, vollständige Daten, Notizen und Konfession für Arbeitsmappen.',
    codeMask: '{if ordnungs_id}[{ordnungs_id}]{endif}{if xref} \\texttt{\\tiny {xref}}{endif}',
    nameMask: '{nachname}{, ?vorname}',
    entryMask:
      '{if generation_badge}[{generation}] {endif}{?lebensdaten}{, ?taufe}{, ?beerdigung}{, ?beruf}{ (wh. ?wohnort)}{ [?religion]}{if kinder_anzahl > 0} ({kinder_anzahl} Kinder){endif}{if implex}\\newline\\emph{\\footnotesize{implex}}{endif}{if stamm_verweis}\\newline\\emph{\\footnotesize{stamm_verweis}}{endif}{if notizen}\\newline\\footnotesize{notizen}{endif}',
    spouseMask:
      '\\textbf{{partner_name}}{ ?partner_lebensdaten}{, ?partner_beruf}{, ?hochzeit}{, ?scheidung}{ ?partner_verweis}',
    documentClass: 'scrartcl',
    paperSize: 'a4paper',
    fontSize: '10pt',
    marginMm: 18,
    entrySpacingEm: 0.45,
    indentStepEm: 1.1,
    showGenerationBadge: true,
    includeHeaderInfo: true,
    enableIndexGeneration: true,
    enableBranchOverviewTable: true,
  },
  {
    id: 'builtin_minimal_tree',
    name: 'Minimalistisch (Strukturbaum)',
    description: 'Reine Namen und Jahreszahlen für eine maximale Übersicht auf wenigen Seiten.',
    codeMask: '{if ordnungs_id}{ordnungs_id}{endif}',
    nameMask: '{vollname}',
    entryMask:
      '{if geburtsjahr || sterbejahr}({geburtsjahr}–{sterbejahr}){endif}{if stamm_verweis} \\emph{\\footnotesize{stamm_verweis}}{endif}',
    spouseMask: '{partner_name}{ ?hochzeit}',
    documentClass: 'scrartcl',
    paperSize: 'a4paper',
    fontSize: '10pt',
    marginMm: 16,
    entrySpacingEm: 0.25,
    indentStepEm: 0.95,
    showGenerationBadge: false,
    includeHeaderInfo: false,
    enableIndexGeneration: false,
    enableBranchOverviewTable: false,
  },
];

export function normalizeLatexTemplateConfig(
  raw: Partial<LatexTemplateConfig> & { id?: string; name?: string }
): LatexTemplateConfig {
  const fallback = DEFAULT_LATEX_TEMPLATES[0];
  const entryMask = typeof raw.entryMask === 'string' ? raw.entryMask : fallback.entryMask;
  const legacyHadNameInEntry =
    entryMask.includes('{nachname}') || entryMask.includes('{vollname}');

  return {
    id: raw.id || `tpl_${Date.now()}`,
    name: raw.name || fallback.name,
    description: raw.description,
    codeMask:
      typeof raw.codeMask === 'string'
        ? raw.codeMask
        : legacyHadNameInEntry
          ? '{if ordnungs_id}[{ordnungs_id}]{endif}'
          : fallback.codeMask,
    nameMask:
      typeof raw.nameMask === 'string'
        ? raw.nameMask
        : legacyHadNameInEntry
          ? ''
          : fallback.nameMask,
    entryMask,
    spouseMask: typeof raw.spouseMask === 'string' ? raw.spouseMask : fallback.spouseMask,
    documentClass: raw.documentClass || fallback.documentClass,
    paperSize: raw.paperSize || fallback.paperSize,
    fontSize: raw.fontSize || fallback.fontSize,
    marginMm: typeof raw.marginMm === 'number' ? raw.marginMm : fallback.marginMm,
    entrySpacingEm:
      typeof raw.entrySpacingEm === 'number' ? raw.entrySpacingEm : fallback.entrySpacingEm,
    indentStepEm: typeof raw.indentStepEm === 'number' ? raw.indentStepEm : fallback.indentStepEm,
    showGenerationBadge:
      typeof raw.showGenerationBadge === 'boolean'
        ? raw.showGenerationBadge
        : fallback.showGenerationBadge,
    includeHeaderInfo:
      typeof raw.includeHeaderInfo === 'boolean'
        ? raw.includeHeaderInfo
        : fallback.includeHeaderInfo,
    enableIndexGeneration:
      typeof raw.enableIndexGeneration === 'boolean'
        ? raw.enableIndexGeneration
        : fallback.enableIndexGeneration,
    enableBranchOverviewTable:
      typeof raw.enableBranchOverviewTable === 'boolean'
        ? raw.enableBranchOverviewTable
        : fallback.enableBranchOverviewTable,
  };
}

export function compareHenryCodes(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return -1;
  if (!b) return 1;

  if (a.includes('.') || b.includes('.')) {
    const segsA = a.split('.');
    const segsB = b.split('.');
    const len = Math.max(segsA.length, segsB.length);
    for (let i = 0; i < len; i++) {
      if (i >= segsA.length) return -1;
      if (i >= segsB.length) return 1;
      const numA = parseInt(segsA[i], 10);
      const numB = parseInt(segsB[i], 10);
      if (!Number.isNaN(numA) && !Number.isNaN(numB)) {
        if (numA !== numB) return numA - numB;
      } else {
        const cmp = segsA[i].localeCompare(segsB[i]);
        if (cmp !== 0) return cmp;
      }
    }
    return 0;
  }

  const parseTokens = (s: string): number[] => {
    const tokens: number[] = [];
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (ch >= '1' && ch <= '9') {
        tokens.push(parseInt(ch, 10));
        i++;
      } else if (ch >= 'A' && ch <= 'Z' && ch !== 'X') {
        tokens.push(ch.charCodeAt(0) - 'A'.charCodeAt(0) + 10);
        i++;
      } else if (ch === 'X') {
        i++;
        let numStr = '';
        while (i < s.length && s[i] >= '0' && s[i] <= '9') {
          numStr += s[i];
          i++;
        }
        tokens.push(numStr ? parseInt(numStr, 10) : 100);
      } else {
        tokens.push(ch.charCodeAt(0));
        i++;
      }
    }
    return tokens;
  };

  const tokA = parseTokens(a);
  const tokB = parseTokens(b);
  const minLen = Math.min(tokA.length, tokB.length);
  for (let i = 0; i < minLen; i++) {
    if (tokA[i] !== tokB[i]) return tokA[i] - tokB[i];
  }
  return tokA.length - tokB.length;
}

export function sanitizeLatexFileSlug(raw: string): string {
  return (raw || 'Chronik')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae')
    .replace(/Ö/g, 'Oe')
    .replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') || 'Chronik';
}

export function sanitizeLatexLabel(raw: string): string {
  return (raw || 'node')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_');
}

function toRoman(num: number): string {
  if (num <= 0) return '';
  const map: Array<[number, string]> = [
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let rem = num;
  let out = '';
  for (const [val, sym] of map) {
    while (rem >= val) {
      out += sym;
      rem -= val;
    }
  }
  return out;
}

function extractYear(dateStr?: string | null): string {
  if (!dateStr) return '';
  const m = /\b(\d{4})\b/.exec(dateStr);
  return m ? m[1] : '';
}

function readGedcomTagValue(person: ExportPersonInput | Person | undefined, tag: string): {
  date: string;
  place: string;
  text: string;
} {
  if (!person?.gedcom_extra) return { date: '', place: '', text: '' };
  const entry = person.gedcom_extra[tag];
  if (!entry) return { date: '', place: '', text: '' };
  if (typeof entry === 'string') return { date: '', place: '', text: entry.trim() };
  if (typeof entry === 'object' && entry !== null) {
    const obj = entry as Record<string, unknown>;
    return {
      date: typeof obj.DATE === 'string' ? obj.DATE.trim() : '',
      place: typeof obj.PLAC === 'string' ? obj.PLAC.trim() : '',
      text:
        typeof obj._val === 'string'
          ? obj._val.trim()
          : typeof obj.value === 'string'
            ? obj.value.trim()
            : '',
    };
  }
  return { date: '', place: '', text: '' };
}

function readPersonNotes(person: ExportPersonInput | Person | undefined): string {
  if (!person?.gedcom_extra) return '';
  const note = person.gedcom_extra.NOTE;
  if (typeof note === 'string') return note.trim();
  if (Array.isArray(note)) {
    return note
      .map(n => (typeof n === 'string' ? n.trim() : typeof n?._val === 'string' ? n._val.trim() : ''))
      .filter(Boolean)
      .join(' ');
  }
  if (typeof note === 'object' && note !== null) {
    const val = (note as Record<string, unknown>)._val || (note as Record<string, unknown>).value;
    return typeof val === 'string' ? val.trim() : '';
  }
  return '';
}

function formatLifeDatesText(
  birthDate?: string | null,
  birthPlace?: string | null,
  deathDate?: string | null,
  deathPlace?: string | null,
  locale: SupportedLocale = 'de'
): string {
  const inWord = locale === 'en' ? 'in' : locale === 'fr' ? 'à' : locale === 'pt' ? 'em' : 'in';
  const parts: string[] = [];
  if (birthDate || birthPlace) {
    let b = '*';
    if (birthDate) b += ` ${birthDate}`;
    if (birthPlace) b += ` ${inWord} ${birthPlace}`;
    parts.push(b);
  }
  if (deathDate || deathPlace) {
    let d = '†';
    if (deathDate) d += ` ${deathDate}`;
    if (deathPlace) d += ` ${inWord} ${deathPlace}`;
    parts.push(d);
  }
  return parts.join(', ');
}

function toDomainPersons(persons: ExportPersonInput[]): Person[] {
  const childrenByParent = new Map<string, string[]>();
  for (const p of persons) {
    for (const pid of p.parent_ids || []) {
      const arr = childrenByParent.get(pid) || [];
      if (!arr.includes(p.id)) arr.push(p.id);
      childrenByParent.set(pid, arr);
    }
  }
  return persons.map(p => ({
    id: p.id,
    given_name: p.given_name,
    surname: p.surname,
    sex: p.sex,
    birth_date: p.birth_date,
    birth_place: p.birth_place,
    death_date: p.death_date,
    death_place: p.death_place,
    gedcom_extra: p.gedcom_extra || {},
    spouses: p.spouses || [],
    parent_ids: p.parent_ids || [],
    children_ids: (p as unknown as Person).children_ids || childrenByParent.get(p.id) || [],
    proband_data: (p as unknown as Person).proband_data || {},
  }));
}

function createSyntheticDoc(rootPersonId: string, lineagePolicy: LineagePolicy): DesignDocumentModel {
  const now = new Date().toISOString();
  return {
    id: `latex_synth_${rootPersonId}`,
    name: 'LaTeX Export',
    rootPersonId,
    documentKind: 'master',
    growthDirection: 'top_down',
    lineagePolicy,
    routingStyle: 'orthogonal_bus',
    enableLineBridges: true,
    cardDensityProfile: 'standard',
    cardConfig: {} as DesignDocumentModel['cardConfig'],
    bgAssetId: null,
    bgConfig: {} as DesignDocumentModel['bgConfig'],
    createdAt: now,
    updatedAt: now,
    personRules: {},
    groupRules: {},
    subtreeMounts: {},
    edgeWaypoints: {},
  };
}

interface GlobalStammahnEntry {
  henryCode: string;
  rootAncestorId: string;
  rootAncestorName: string;
  labelKey: string;
}

function adjustStartCode(code: string, startCode: string): string {
  const trimmed = (startCode || '1').trim();
  if (!trimmed || trimmed === '1') return code;
  if (code.startsWith('1')) {
    return trimmed + code.slice(1);
  }
  return code;
}

function buildGlobalStammahnHenryLookup(
  domainPersons: Person[],
  rootAncestors: LatexRootAncestorInput[],
  lineagePolicy: LineagePolicy,
  locale: SupportedLocale
): Map<string, GlobalStammahnEntry> {
  const lookup = new Map<string, GlobalStammahnEntry>();
  const personMap = new Map(domainPersons.map(p => [p.id, p]));

  for (const ra of rootAncestors) {
    const doc = createSyntheticDoc(ra.person_id, lineagePolicy);
    const resolved = resolveGenealogyTree(doc, domainPersons, locale, ra.person_id, doc);
    const rootPerson = personMap.get(ra.person_id);
    const raName = [rootPerson?.given_name || ra.given_name, rootPerson?.surname || ra.surname]
      .filter(Boolean)
      .join(' ')
      .trim() || ra.person_id;

    for (const [pid, meta] of resolved.resolvedMeta.entries()) {
      if (!lookup.has(pid)) {
        const finalCode = adjustStartCode(meta.henryCode, ra.starting_code || '1');
        lookup.set(pid, {
          henryCode: finalCode,
          rootAncestorId: ra.person_id,
          rootAncestorName: raName,
          labelKey: `pers:${sanitizeLatexLabel(finalCode)}`,
        });
      }
    }
  }
  return lookup;
}

interface ResolvedExportNode {
  person: Person;
  henryCode: string; // Empty when non-Stammahn
  kekuleCode: string;
  orderCode: string; // henryCode or kekuleCode
  zweigCode: string; // Internal tree path for sorting
  generation: number;
  parentId: string | null;
  childrenIds: string[];
  labelKey: string;
  implexNoticeLatex: string;
  implexNoticeHtml: string;
  bridgeNoticeLatex: string;
  bridgeNoticeHtml: string;
  isBridgeStop?: boolean;
  roleLabel?: string;
}

interface UnifiedTreeBuild {
  nodesById: Map<string, ResolvedExportNode>;
  orderedRootId: string;
  unknownBranchesStopped: number;
  bridgeRefsCount: number;
  isStammahnExport: boolean;
  designSubtreeRootIds: Set<string>;
}

function collectDesignTreeNodes(
  bundle: DesignTreeBundle,
  domainPersons: Person[],
  locale: SupportedLocale
): {
  resolved: ResolvedLineageResult;
  subtreeAnchorIds: Set<string>;
  extraMeta: Map<string, { henryCode: string; generation: number; childrenIds: string[]; parentId: string | null }>;
} {
  const masterResolved = resolveGenealogyTree(
    bundle.rootDocument,
    domainPersons,
    locale,
    bundle.rootDocument.rootPersonId,
    bundle.rootDocument
  );
  const subtreeAnchorIds = new Set<string>();
  const extraMeta = new Map<
    string,
    { henryCode: string; generation: number; childrenIds: string[]; parentId: string | null }
  >();

  for (const [pid, meta] of masterResolved.resolvedMeta.entries()) {
    extraMeta.set(pid, {
      henryCode: meta.henryCode,
      generation: meta.generation,
      childrenIds: [...meta.childrenIds],
      parentId: meta.resolvedParentId,
    });
  }

  const visitedDocs = new Set<string>([bundle.rootDocument.id]);
  const mountQueue = Object.values(bundle.rootDocument.subtreeMounts || {});

  while (mountQueue.length > 0) {
    const mount = mountQueue.shift()!;
    subtreeAnchorIds.add(mount.anchorPersonId);
    const subDoc = bundle.subDocuments[mount.subDocumentId];
    if (!subDoc || visitedDocs.has(subDoc.id)) continue;
    visitedDocs.add(subDoc.id);

    const subResolved = resolveGenealogyTree(
      subDoc,
      domainPersons,
      locale,
      bundle.rootDocument.rootPersonId,
      bundle.rootDocument
    );
    for (const [pid, meta] of subResolved.resolvedMeta.entries()) {
      const existing = extraMeta.get(pid);
      if (!existing) {
        extraMeta.set(pid, {
          henryCode: meta.henryCode,
          generation: meta.generation,
          childrenIds: [...meta.childrenIds],
          parentId: meta.resolvedParentId,
        });
      } else {
        for (const cid of meta.childrenIds) {
          if (!existing.childrenIds.includes(cid)) existing.childrenIds.push(cid);
        }
      }
    }
    for (const nestedMount of Object.values(subDoc.subtreeMounts || {})) {
      mountQueue.push(nestedMount);
    }
  }

  return { resolved: masterResolved, subtreeAnchorIds, extraMeta };
}

function buildUnifiedExportTree(
  domainPersons: Person[],
  options: LatexExportOptions,
  globalStammahnLookup: Map<string, GlobalStammahnEntry>
): UnifiedTreeBuild {
  const personMap = new Map(domainPersons.map(p => [p.id, p]));
  const nodesById = new Map<string, ResolvedExportNode>();
  let unknownBranchesStopped = 0;
  let bridgeRefsCount = 0;

  const isStammahnExport =
    options.sourceMode === 'design_document' || options.sourceMode === 'root_ancestor';

  // Ancestor mode (Kekule)
  if (options.sourceMode === 'custom_person' && options.direction === 'ancestors') {
    const startPerson = personMap.get(options.rootPersonId);
    if (!startPerson) {
      return {
        nodesById,
        orderedRootId: options.rootPersonId,
        unknownBranchesStopped: 0,
        bridgeRefsCount: 0,
        isStammahnExport: false,
        designSubtreeRootIds: new Set(),
      };
    }

    const queue: Array<{ personId: string; kekule: number; gen: number; role: string }> = [
      { personId: startPerson.id, kekule: 1, gen: 1, role: 'Proband' },
    ];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur.gen > options.maxGenerations) continue;
      const p = personMap.get(cur.personId);
      if (!p) continue;

      const nodeKey = `${p.id}#k${cur.kekule}`;
      const isImplex = visited.has(p.id);
      visited.add(p.id);

      const bridge = globalStammahnLookup.get(p.id);
      if (bridge) bridgeRefsCount++;

      const kekStr = String(cur.kekule);
      const labelKey = bridge ? bridge.labelKey : `pers:k${kekStr}_${sanitizeLatexLabel(p.id)}`;

      nodesById.set(nodeKey, {
        person: p,
        henryCode: bridge?.henryCode || '',
        kekuleCode: kekStr,
        orderCode: kekStr,
        zweigCode: kekStr,
        generation: cur.gen,
        parentId: null,
        childrenIds: [],
        labelKey,
        implexNoticeLatex: isImplex
          ? `[Implex: bereits unter Kekulé ${kekStr}]`
          : '',
        implexNoticeHtml: isImplex ? `[Implex]` : '',
        bridgeNoticeLatex: bridge
          ? `\\textrightarrow~Hauptstamm ${escapeLatexText(bridge.rootAncestorName)}: [${escapeLatexText(bridge.henryCode)}], S.~\\pageref{${bridge.labelKey}}`
          : '',
        bridgeNoticeHtml: bridge
          ? `→ Hauptstamm ${escapeHtmlText(bridge.rootAncestorName)}: [${escapeHtmlText(bridge.henryCode)}]`
          : '',
        roleLabel: cur.role,
      });

      if (!isImplex && cur.gen < options.maxGenerations) {
        const parents = (p.parent_ids || []).map(id => personMap.get(id)).filter(Boolean) as Person[];
        const father = parents.find(x => x.sex === 'M') || (p.father_id ? personMap.get(p.father_id) : undefined);
        const mother = parents.find(x => x.sex === 'F') || (p.mother_id ? personMap.get(p.mother_id) : undefined);
        if (!father) unknownBranchesStopped++;
        if (!mother) unknownBranchesStopped++;
        if (father) {
          queue.push({
            personId: father.id,
            kekule: cur.kekule * 2,
            gen: cur.gen + 1,
            role: options.locale === 'en' ? 'Father' : 'Vater',
          });
        }
        if (mother) {
          queue.push({
            personId: mother.id,
            kekule: cur.kekule * 2 + 1,
            gen: cur.gen + 1,
            role: options.locale === 'en' ? 'Mother' : 'Mutter',
          });
        }
      }
    }

    return {
      nodesById,
      orderedRootId: `${startPerson.id}#k1`,
      unknownBranchesStopped,
      bridgeRefsCount,
      isStammahnExport: false,
      designSubtreeRootIds: new Set(),
    };
  }

  // Descendants mode (Design Studio, Root Ancestor, or Custom Person Side-Lineage)
  let resolved: ResolvedLineageResult;
  const designSubtreeRootIds = new Set<string>();
  let combinedMeta: Map<
    string,
    { henryCode: string; generation: number; childrenIds: string[]; parentId: string | null }
  >;

  if (options.sourceMode === 'design_document' && options.designBundle) {
    const collected = collectDesignTreeNodes(options.designBundle, domainPersons, options.locale);
    resolved = collected.resolved;
    combinedMeta = collected.extraMeta;
    for (const aid of collected.subtreeAnchorIds) designSubtreeRootIds.add(aid);
  } else {
    const doc = createSyntheticDoc(options.rootPersonId, options.lineagePolicy);
    resolved = resolveGenealogyTree(doc, domainPersons, options.locale, options.rootPersonId, doc);
    combinedMeta = new Map();
    for (const [pid, meta] of resolved.resolvedMeta.entries()) {
      combinedMeta.set(pid, {
        henryCode: meta.henryCode,
        generation: meta.generation,
        childrenIds: [...meta.childrenIds],
        parentId: meta.resolvedParentId,
      });
    }
  }

  const rootId = resolved.rootPersonId;

  // Traverse in genealogical order up to maxGenerations
  const visit = (personId: string, parentId: string | null, zweigPath: string) => {
    const meta = combinedMeta.get(personId);
    const resMeta = resolved.resolvedMeta.get(personId);
    const person = personMap.get(personId);
    if (!meta || !person) return;
    if (meta.generation > options.maxGenerations) return;

    const realHenry = isStammahnExport
      ? adjustStartCode(meta.henryCode, options.startCode)
      : '';
    const bridge = !isStammahnExport ? globalStammahnLookup.get(personId) : undefined;
    if (bridge) bridgeRefsCount++;

    const labelKey = isStammahnExport
      ? `pers:${sanitizeLatexLabel(realHenry || personId)}`
      : bridge
        ? bridge.labelKey
        : `pers:${sanitizeLatexLabel(personId)}`;

    // Implex notice from Design Studio / resolver
    const implexBadges = resMeta?.implexBadges || [];
    const activeImplex = implexBadges.find(b => !b.isBranchAttachedHere);
    const implexNoticeLatex = activeImplex
      ? `[Implex: Weiterführung unter [${escapeLatexText(activeImplex.partnerCode)}] ${escapeLatexText(activeImplex.partnerName)}, S.~\\pageref{pers:${sanitizeLatexLabel(activeImplex.partnerCode)}}]`
      : '';
    const implexNoticeHtml = activeImplex
      ? `[Implex: → [${escapeHtmlText(activeImplex.partnerCode)}] ${escapeHtmlText(activeImplex.partnerName)}]`
      : '';

    const bridgeNoticeLatex = bridge
      ? `\\textrightarrow~Hauptstamm ${escapeLatexText(bridge.rootAncestorName)}: [${escapeLatexText(bridge.henryCode)}], S.~\\pageref{${bridge.labelKey}}`
      : '';
    const bridgeNoticeHtml = bridge
      ? `→ Hauptstamm ${escapeHtmlText(bridge.rootAncestorName)}: [${escapeHtmlText(bridge.henryCode)}]`
      : '';

    // In custom_person mode, if this person is already covered in the Stammahn tree (and isn't the root),
    // we bridge-reference them and do not duplicate their entire Stammahn subtree.
    const isBridgeStop = Boolean(bridge && personId !== rootId);
    const validChildren = isBridgeStop
      ? []
      : meta.childrenIds.filter(cid => {
          const cm = combinedMeta.get(cid);
          return cm && cm.generation <= options.maxGenerations;
        });

    nodesById.set(personId, {
      person,
      henryCode: realHenry,
      kekuleCode: '',
      orderCode: realHenry,
      zweigCode: zweigPath,
      generation: meta.generation,
      parentId,
      childrenIds: validChildren,
      labelKey,
      implexNoticeLatex,
      implexNoticeHtml,
      bridgeNoticeLatex,
      bridgeNoticeHtml,
      isBridgeStop,
    });

    validChildren.forEach((cid, idx) => {
      visit(cid, personId, `${zweigPath}.${idx + 1}`);
    });
  };

  visit(rootId, null, '1');

  return {
    nodesById,
    orderedRootId: rootId,
    unknownBranchesStopped,
    bridgeRefsCount,
    isStammahnExport,
    designSubtreeRootIds,
  };
}

function buildPersonEvalContext(
  node: ResolvedExportNode,
  nodesById: Map<string, ResolvedExportNode>,
  options: LatexExportOptions,
  globalStammahnLookup: Map<string, GlobalStammahnEntry>,
  branchContinuationTarget: DetectedBranchInfo | undefined,
  spouseMaskAst: AstNode[],
  allPersonMap: Map<string, Person>,
  emitIndex: boolean
): {
  rawVars: Record<string, string>;
  latexVars: Record<string, string>;
  previewVars: Record<string, string>;
  renderedSpousesLatex: string[];
  renderedSpousesHtml: string[];
  indexCommandsLatex: string;
} {
  const p = node.person;
  const surname = (p.surname || '').trim();
  const givenName = (p.given_name || '').trim();
  const fullName = [givenName, surname].filter(Boolean).join(' ') || 'N.N.';

  const birthDate = (p.birth_date || '').trim();
  const birthPlace = (p.birth_place || '').trim();
  const deathDate = (p.death_date || '').trim();
  const deathPlace = (p.death_place || '').trim();
  const birthYear = extractYear(birthDate);
  const deathYear = extractYear(deathDate);
  const lifeDates = formatLifeDatesText(birthDate, birthPlace, deathDate, deathPlace, options.locale);

  const bap = readGedcomTagValue(p, 'BAPM');
  const chr = readGedcomTagValue(p, 'CHR');
  const bapDate = bap.date || chr.date;
  const bapPlace = bap.place || chr.place;
  const baptismBlock =
    bapDate || bapPlace ? `~ ${[bapDate, bapPlace ? `in ${bapPlace}` : ''].filter(Boolean).join(' ')}` : '';

  const bur = readGedcomTagValue(p, 'BURI');
  const burialBlock =
    bur.date || bur.place ? `▭ ${[bur.date, bur.place ? `in ${bur.place}` : ''].filter(Boolean).join(' ')}` : '';

  const occu = readPersonOccupation(p);
  const reli = readGedcomTagValue(p, 'RELI').text;
  const resi = readGedcomTagValue(p, 'RESI');
  const residence = [resi.place, resi.text].filter(Boolean).join(', ');
  const notes = readPersonNotes(p);

  const genLabel = `Gen. ${node.generation}`;
  const genRoman = toRoman(node.generation);
  const genBadge = options.template.showGenerationBadge ? `[${genLabel}]` : '';
  const sonDaughter =
    p.sex === 'M'
      ? options.locale === 'en'
        ? 'Son'
        : 'Sohn'
      : p.sex === 'F'
        ? options.locale === 'en'
          ? 'Daughter'
          : 'Tochter'
        : '';

  // Combined stamm_verweis: either branch continuation or bridge ref
  let stammVerweisLatex = '';
  let stammVerweisHtml = '';
  if (branchContinuationTarget) {
    const secRef = `stamm:${branchContinuationTarget.safeFileCode}`;
    const labelText =
      options.locale === 'en'
        ? `Branch continues in section “Branch [${escapeLatexText(branchContinuationTarget.code)}]”, p.~\\pageref{${secRef}}`
        : `Stamm wird fortgeführt in Abschnitt „Stamm [${escapeLatexText(branchContinuationTarget.code)}]“, S.~\\pageref{${secRef}}`;
    stammVerweisLatex = `\\textrightarrow~${labelText}`;
    stammVerweisHtml = `<span class="preview-branch-link" data-target-branch="${escapeHtmlText(branchContinuationTarget.fileName)}">→ Stamm [${escapeHtmlText(branchContinuationTarget.code)}] (${escapeHtmlText(branchContinuationTarget.fileName)})</span>`;
  } else if (node.bridgeNoticeLatex) {
    stammVerweisLatex = node.bridgeNoticeLatex;
    stammVerweisHtml = node.bridgeNoticeHtml;
  }

  // Render spouses via spouseMaskAst
  const renderedSpousesLatex: string[] = [];
  const renderedSpousesHtml: string[] = [];
  const spouseIndexPlaces = new Set<string>();
  const spouseIndexNames = new Set<string>();

  const spouses = p.spouses || [];
  spouses.forEach((sp, idx) => {
    const spPerson = allPersonMap.get(sp.id);
    const spSurname = (spPerson?.surname || '').trim();
    const spGiven = (spPerson?.given_name || '').trim();
    const spName = [spGiven, spSurname].filter(Boolean).join(' ') || 'N.N.';
    const spLife = formatLifeDatesText(
      spPerson?.birth_date,
      spPerson?.birth_place,
      spPerson?.death_date,
      spPerson?.death_place,
      options.locale
    );
    const spOccu = spPerson ? readPersonOccupation(spPerson) : '';
    const mDate = (sp.date || '').trim();
    const mPlace = (sp.place || '').trim();
    const hochzeit =
      mDate || mPlace ? `⚭ ${[mDate, mPlace ? `in ${mPlace}` : ''].filter(Boolean).join(' ')}` : '';
    const dDate = (sp.divorce_date || '').trim();
    const dPlace = '';
    const scheidung = dDate ? `⚮ ${dDate}` : sp.is_divorced ? '⚮' : '';

    if (spSurname) spouseIndexNames.add(`${spSurname}, ${spGiven || 'N.N.'}`);
    if (mPlace) spouseIndexPlaces.add(mPlace);
    if (spPerson?.birth_place) spouseIndexPlaces.add(spPerson.birth_place);
    if (spPerson?.death_place) spouseIndexPlaces.add(spPerson.death_place);

    // Bridge or internal ref for spouse
    const spInTree = nodesById.get(sp.id);
    const spBridge = globalStammahnLookup.get(sp.id);
    let partnerVerweisLatex = '';
    let partnerVerweisHtml = '';
    if (spBridge && !options.sourceMode.startsWith('root') && options.sourceMode !== 'design_document') {
      partnerVerweisLatex = `[\\textrightarrow\\ Stamm ${escapeLatexText(spBridge.rootAncestorName)}: ${escapeLatexText(spBridge.henryCode)}, S.~\\pageref{${spBridge.labelKey}}]`;
      partnerVerweisHtml = `[→ ${escapeHtmlText(spBridge.henryCode)}]`;
    } else if (spInTree && spInTree.henryCode) {
      partnerVerweisLatex = `[\\textrightarrow\\ [${escapeLatexText(spInTree.henryCode)}], S.~\\pageref{${spInTree.labelKey}}]`;
      partnerVerweisHtml = `[→ ${escapeHtmlText(spInTree.henryCode)}]`;
    }

    const spRaw: Record<string, string> = {
      ehe_nummer: spouses.length > 1 ? `${idx + 1}.` : '',
      partner_name: spName,
      partner_vorname: spGiven,
      partner_nachname: spSurname,
      partner_lebensdaten: spLife,
      partner_geburtsdatum: spPerson?.birth_date || '',
      partner_geburtsort: spPerson?.birth_place || '',
      partner_sterbedatum: spPerson?.death_date || '',
      partner_sterbeort: spPerson?.death_place || '',
      partner_beruf: spOccu,
      hochzeit,
      hochzeitsdatum: mDate,
      hochzeitsort: mPlace,
      scheidung,
      scheidungsdatum: dDate,
      scheidungsort: dPlace,
      partner_verweis: partnerVerweisLatex ? '1' : '',
    };
    const spLatex: Record<string, string> = {};
    const spHtml: Record<string, string> = {};
    for (const [k, v] of Object.entries(spRaw)) {
      spLatex[k] = escapeLatexText(v);
      spHtml[k] = escapeHtmlText(v);
    }
    spLatex.partner_verweis = partnerVerweisLatex;
    spHtml.partner_verweis = partnerVerweisHtml;

    const evalSp = evaluateMaskAst(spouseMaskAst, {
      rawVars: spRaw,
      latexVars: spLatex,
      previewVars: spHtml,
    });
    const cleaned = cleanupRenderedMaskOutput(evalSp.latex, evalSp.html);
    if (cleaned.latex) {
      renderedSpousesLatex.push(cleaned.latex);
      renderedSpousesHtml.push(cleaned.html);
    }
  });

  const rawVars: Record<string, string> = {
    henry_id: node.henryCode,
    kekule_id: node.kekuleCode,
    ordnungs_id: node.orderCode,
    zweig_id: node.zweigCode,
    nachname: surname,
    vorname: givenName,
    vollname: fullName,
    sohn_tochter: sonDaughter,
    geschlecht: p.sex || '',
    generation: genLabel,
    generation_roemisch: genRoman,
    generation_badge: genBadge,
    rolle: node.roleLabel || '',
    xref: p.id,
    implex: node.implexNoticeLatex ? '1' : '',
    stamm_verweis: stammVerweisLatex ? '1' : '',
    lebensdaten: lifeDates,
    geburtsdatum: birthDate,
    geburtsjahr: birthYear,
    geburtsort: birthPlace,
    taufdatum: bapDate,
    taufort: bapPlace,
    taufe: baptismBlock,
    sterbedatum: deathDate,
    sterbejahr: deathYear,
    sterbeort: deathPlace,
    beerdigungsdatum: bur.date,
    beerdigungsort: bur.place,
    beerdigung: burialBlock,
    hochzeit: spouses[0]?.date ? `⚭ ${spouses[0].date}` : '',
    hochzeitsdatum: spouses[0]?.date || '',
    hochzeitsort: spouses[0]?.place || '',
    scheidung: spouses[0]?.divorce_date ? `⚮ ${spouses[0].divorce_date}` : '',
    scheidungsdatum: spouses[0]?.divorce_date || '',
    scheidungsort: '',
    ehepartner: renderedSpousesLatex.join('; '),
    beruf: occu,
    religion: reli,
    wohnort: residence,
    notizen: notes,
    kinder_anzahl: String(node.childrenIds.length),
    ist_stamm_anker: branchContinuationTarget ? '1' : '',
    hat_kinder: node.childrenIds.length > 0 ? '1' : '',
  };

  const latexVars: Record<string, string> = {};
  const previewVars: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawVars)) {
    latexVars[k] = escapeLatexText(v);
    previewVars[k] = escapeHtmlText(v);
  }
  // Rich LaTeX/HTML tokens that should not be double-escaped
  latexVars.implex = node.implexNoticeLatex;
  previewVars.implex = escapeHtmlText(node.implexNoticeHtml);
  latexVars.stamm_verweis = stammVerweisLatex;
  previewVars.stamm_verweis = stammVerweisHtml;
  latexVars.ehepartner = renderedSpousesLatex.join('; ');
  previewVars.ehepartner = renderedSpousesHtml.join('; ');

  // Index commands (\index[personen]{...} & \index[orte]{...})
  let indexCommandsLatex = '';
  if (emitIndex) {
    const idxCmds: string[] = [];
    if (surname) {
      idxCmds.push(`\\index[personen]{${escapeLatexText(`${surname}, ${givenName || 'N.N.'}`)}}`);
    }
    for (const spN of spouseIndexNames) {
      idxCmds.push(`\\index[personen]{${escapeLatexText(spN)}}`);
    }
    const places = new Set<string>([birthPlace, bapPlace, deathPlace, bur.place, residence, ...spouseIndexPlaces]);
    for (const pl of places) {
      const cleanPl = pl.trim();
      if (cleanPl) {
        idxCmds.push(`\\index[orte]{${escapeLatexText(cleanPl)}}`);
      }
    }
    indexCommandsLatex = idxCmds.join('');
  }

  return {
    rawVars,
    latexVars,
    previewVars,
    renderedSpousesLatex,
    renderedSpousesHtml,
    indexCommandsLatex,
  };
}

function generateFormatFile(
  textsSubdir: string,
  options: LatexExportOptions
): GeneratedLatexFile {
  const tpl = options.template;
  const locDef = getLocaleDefinition(options.locale);
  const isBook = tpl.documentClass === 'scrbook';

  const lines: string[] = [
    `% ============================================================================`,
    `% LineageGraph Globale Buch-Formatierung (Buchformat.tex — GESCHÜTZT)`,
    `% Zentrale Einstellungen für Satzspiegel, Pakete, Makros & Intro-Umgebung.`,
    `% Kann bei Bedarf über die Checkbox im Export-Dialog neu geschrieben werden.`,
    `% ============================================================================`,
    `\\usepackage[utf8]{inputenc}`,
    `\\usepackage[T1]{fontenc}`,
    `\\usepackage{lmodern}`,
    `\\usepackage[${locDef.latexBabel || 'ngerman'}]{babel}`,
    `\\usepackage[left=${tpl.marginMm}mm,right=${tpl.marginMm}mm,top=${tpl.marginMm}mm,bottom=${tpl.marginMm}mm${isBook ? ',bindingoffset=8mm' : ''}]{geometry}`,
    `\\usepackage{microtype}`,
    `\\usepackage{graphicx}`,
    `\\graphicspath{{Bilder/}{${textsSubdir}/Bilder/}}`,
    `\\usepackage{textcomp}`,
    `\\usepackage{longtable,booktabs,array}`,
    `\\usepackage[hidelinks]{hyperref}`,
  ];

  if (tpl.documentClass === 'scrbook' || tpl.documentClass === 'scrartcl') {
    lines.push(
      `\\usepackage[automark]{scrlayer-scrpage}`,
      `\\pagestyle{scrheadings}`,
      `\\clearpairofpagestyles`,
      `\\ohead{\\headmark}`,
      `\\ofoot{\\pagemark}`
    );
  }

  if (tpl.enableIndexGeneration) {
    lines.push(
      `\\usepackage{imakeidx}`,
      `\\makeindex[name=personen,title={Personenregister},columns=2,intoc]`,
      `\\makeindex[name=orte,title={Ortsregister},columns=2,intoc]`
    );
  }

  lines.push(
    ``,
    `% --- Typografie & Einrückungsmaße aus der LineageGraph-Vorlage ---`,
    `\\newlength{\\genIndentBase}`,
    `\\setlength{\\genIndentBase}{${tpl.indentStepEm}em}`,
    `\\newlength{\\genEntrySep}`,
    `\\setlength{\\genEntrySep}{${tpl.entrySpacingEm}em}`,
    `\\newlength{\\genSepDeeper}`,
    `\\setlength{\\genSepDeeper}{\\genEntrySep}`,
    `\\newlength{\\genSepSame}`,
    `\\setlength{\\genSepSame}{0.7\\genEntrySep}`,
    `\\newlength{\\genSepShallower}`,
    `\\setlength{\\genSepShallower}{1.5\\genEntrySep}`,
    `\\newlength{\\genSepMarriage}`,
    `\\setlength{\\genSepMarriage}{0.3\\genEntrySep}`,
    `\\newcount\\lgPrevGen`,
    `\\lgPrevGen=-1`,
    `\\newcommand{\\genEheSym}{\\ensuremath{\\infty}}`,
    ``,
    `% --- Bedingter Seitenumbruch für Intro-Dateien ---`,
    `% Misst automatisch, ob zwischen \\begin{stammEinleitung}...\\end{stammEinleitung}`,
    `% sichtbarer Inhalt (Text, Bilder, mehrseitige Kapitel) steht.`,
    `% Nur wenn Inhalt vorhanden ist, folgt ein \\clearpage vor der Stammfolge.`,
    `\\newcount\\lgIntroStartPage`,
    `\\newdimen\\lgIntroStartTotal`,
    `\\newenvironment{stammEinleitung}{%`,
    `  \\par`,
    `  \\global\\lgPrevGen=-1\\relax`,
    `  \\lgIntroStartPage=\\value{page}%`,
    `  \\lgIntroStartTotal=\\pagetotal`,
    `}{%`,
    `  \\par`,
    `  \\ifnum\\value{page}>\\lgIntroStartPage`,
    `    \\clearpage`,
    `  \\else`,
    `    \\ifdim\\dimexpr\\pagetotal-\\lgIntroStartTotal\\relax>2pt`,
    `      \\clearpage`,
    `    \\fi`,
    `  \\fi`,
    `}`,
    ``,
    `% --- Strukturiertes 5-Argumente Personenmakro (minipage-frei mit \\hangindent) ---`,
    `% #1 = Einrückungsstufe (0, 1, 2, ...) | #2 = Label-Key | #3 = Code-Slot | #4 = Name-Slot | #5 = Details-Slot`,
    `\\newcommand{\\genealogieEintrag}[5]{%`,
    `  \\par`,
    `  \\ifnum\\lgPrevGen<0`,
    `    \\vspace{\\genSepSame}%`,
    `  \\else`,
    `    \\ifnum#1>\\lgPrevGen`,
    `      \\vspace{\\genSepDeeper}%`,
    `    \\else`,
    `      \\ifnum#1<\\lgPrevGen`,
    `        \\vspace{\\genSepShallower}%`,
    `      \\else`,
    `        \\vspace{\\genSepSame}%`,
    `      \\fi`,
    `    \\fi`,
    `  \\fi`,
    `  \\global\\lgPrevGen=#1\\relax`,
    `  \\begingroup`,
    `  \\edef\\currentIndent{\\the\\dimexpr #1\\genIndentBase\\relax}%`,
    `  \\edef\\currentHang{\\the\\dimexpr #1\\genIndentBase + 1.5em\\relax}%`,
    `  \\noindent\\hangindent=\\currentHang\\hangafter=1\\hspace*{\\currentIndent}%`,
    `  \\phantomsection\\label{#2}%`,
    `  \\if\\relax\\detokenize{#3}\\relax\\else\\textbf{#3}\\space\\fi%`,
    `  \\if\\relax\\detokenize{#4}\\relax\\else\\textbf{#4}\\space\\fi%`,
    `  #5\\par%`,
    `  \\endgroup`,
    `}`,
    ``,
    `% --- Strukturiertes 3-Argumente Ehemakro (minipage-frei mit \\hangindent) ---`,
    `% #1 = Einrückungsstufe | #2 = Ehesymbol/Nummer | #3 = Ehepartner-Details`,
    `\\newcommand{\\genealogieEhe}[3]{%`,
    `  \\par\\nopagebreak\\vspace{\\genSepMarriage}%`,
    `  \\begingroup`,
    `  \\edef\\currentIndent{\\the\\dimexpr #1\\genIndentBase + 1.5em\\relax}%`,
    `  \\edef\\currentHang{\\the\\dimexpr #1\\genIndentBase + 2.8em\\relax}%`,
    `  \\noindent\\hangindent=\\currentHang\\hangafter=1\\hspace*{\\currentIndent}%`,
    `  \\textbf{#2}\\space #3\\par%`,
    `  \\endgroup`,
    `}`,
    ``
  );

  const texContent = lines.join('\n');
  const previewHtml = `
    <div class="master-doc-preview">
      <h3>🎨 Globale Formatierung: <code>Buchformat.tex</code></h3>
      <p class="preview-meta-note">🛡️ Zentrale Formatierungsdatei (Standard-Buchsatz mit <code>microtype</code>, <code>scrlayer-scrpage</code>, <code>graphicx</code> und <code>stammEinleitung</code>).</p>
      <div class="preview-info-grid">
        <div><strong>Seitenränder:</strong> ${tpl.marginMm} mm ${isBook ? '(+ 8 mm Bindekorrektur)' : ''}</div>
        <div><strong>Einrückung / Abstand:</strong> ${tpl.indentStepEm} em / ${tpl.entrySpacingEm} em</div>
        <div><strong>Bildpfade:</strong> <code>Bilder/</code>, <code>${escapeHtmlText(textsSubdir)}/Bilder/</code></div>
        <div><strong>Register (imakeidx):</strong> ${tpl.enableIndexGeneration ? 'Personen & Orte aktiv' : 'Deaktiviert'}</div>
      </div>
      <pre class="preview-code-snippet">${escapeHtmlText(lines.slice(0, 36).join('\n'))}\n...</pre>
    </div>
  `;

  return {
    fileName: 'Buchformat.tex',
    label: 'Format (Buchformat.tex)',
    role: 'format',
    isMasterFile: false,
    isMainFile: false,
    entryCount: 0,
    maxGeneration: 0,
    texContent,
    previewHtml,
  };
}

function generateMasterFile(
  baseFileName: string,
  structureFileName: string,
  textsSubdir: string,
  options: LatexExportOptions,
  rootName: string
): GeneratedLatexFile {
  const tpl = options.template;
  const isBook = tpl.documentClass === 'scrbook';
  const title = options.customDocumentTitle.trim() || `Familienchronik ${rootName}`;
  const subtitle = options.customDocumentSubtitle.trim() || 'Genealogisches Familienbuch';
  const masterName = `${baseFileName}_gesamt.tex`;

  const docOpts = isBook
    ? `${tpl.fontSize},${tpl.paperSize},twoside=true,open=right`
    : `${tpl.fontSize},${tpl.paperSize}`;

  const lines: string[] = [
    `% ============================================================================`,
    `% LineageGraph Master-Dokument (Schicht 1 — GESCHÜTZT vor Überschreiben)`,
    `% Beschreibt nur den Buchrahmen, Titel, globale Formatierung & Kapitel-Abfolge.`,
    `% Eigene Kapitel im Ordner '${textsSubdir}/' mit \\input{${textsSubdir}/...} einbinden.`,
    `% ============================================================================`,
    `\\documentclass[${docOpts}]{${tpl.documentClass}}`,
    ``,
    `\\input{Buchformat}`,
    ``,
    `\\title{${escapeLatexText(title)}}`,
    ...(isBook || tpl.documentClass === 'scrartcl'
      ? [`\\subtitle{${escapeLatexText(subtitle)}}`]
      : []),
    `\\author{}`,
    `\\date{\\today}`,
    ``,
    `\\begin{document}`,
  ];

  if (isBook) {
    lines.push(
      `\\frontmatter`,
      ...(tpl.includeHeaderInfo ? [`\\maketitle`, `\\tableofcontents`] : []),
      `% --- Eigene Vorspann-Kapitel (römische Seitenzahlen):`,
      `% \\input{${textsSubdir}/Vorwort}`,
      ``,
      `\\mainmatter`,
      `% --- Eigene Hauptkapitel vor der Stammfolge:`,
      `% \\input{${textsSubdir}/Geschichte}`,
      ``,
      `% --- Automatisch orchestrierte Stammfolge (lädt Texte/*_intro.tex -> Stammbaum/*):`,
      `\\input{${structureFileName.replace(/\.tex$/, '')}}`,
      ``,
      `% --- Eigene Kapitel nach der Stammfolge:`,
      `% \\input{${textsSubdir}/Anhang}`
    );
    if (tpl.enableIndexGeneration) {
      lines.push(
        ``,
        `\\backmatter`,
        `\\printindex[personen]`,
        `\\printindex[orte]`
      );
    }
  } else {
    lines.push(
      ...(tpl.includeHeaderInfo ? [`\\maketitle`, `\\tableofcontents`, `\\newpage`] : []),
      `% --- Eigene Kapitel vor der Stammfolge:`,
      `% \\input{${textsSubdir}/Vorwort}`,
      ``,
      `\\input{${structureFileName.replace(/\.tex$/, '')}}`,
      ``,
      `% --- Eigene Kapitel nach der Stammfolge:`,
      `% \\input{${textsSubdir}/Anhang}`
    );
    if (tpl.enableIndexGeneration) {
      lines.push(``, `\\clearpage`, `\\printindex[personen]`, `\\printindex[orte]`);
    }
  }

  lines.push(``, `\\end{document}`, ``);

  const texContent = lines.join('\n');
  const previewHtml = `
    <div class="master-doc-preview">
      <h3>📘 Master-Dokument: <code>${escapeHtmlText(masterName)}</code></h3>
      <p class="preview-meta-note">🛡️ Schlankes Rahmen-Dokument im Stammverzeichnis (wird beim Synchronisieren geschützt). Formatierung liegt in <code>Buchformat.tex</code>.</p>
      <div class="preview-info-grid">
        <div><strong>Dokumentklasse:</strong> <code>${escapeHtmlText(tpl.documentClass)}</code> (${escapeHtmlText(tpl.paperSize)}, ${escapeHtmlText(tpl.fontSize)})</div>
        <div><strong>Buchsatz:</strong> ${isBook ? 'twoside, frontmatter/mainmatter/backmatter' : 'einseitig'}</div>
        <div><strong>Stammfolge-Einbindung:</strong> <code>\\input{${escapeHtmlText(structureFileName.replace(/\.tex$/, ''))}}</code></div>
        <div><strong>Register:</strong> ${tpl.enableIndexGeneration ? 'Personen & Orte aktiv' : 'Deaktiviert'}</div>
      </div>
      <pre class="preview-code-snippet">${escapeHtmlText(texContent)}</pre>
    </div>
  `;

  return {
    fileName: masterName,
    label: `Master (${masterName})`,
    role: 'master',
    isMasterFile: true,
    isMainFile: false,
    entryCount: 0,
    maxGeneration: 0,
    texContent,
    previewHtml,
  };
}

function generateIntroWrapperFile(
  introFileName: string,
  dataFileName: string,
  headingCmd: string,
  headingTitle: string,
  labelKey: string,
  tabLabel: string
): GeneratedLatexFile {
  const lines: string[] = [
    `% ============================================================================`,
    `% Geschützte Intro- & Kapitel-Datei (${introFileName})`,
    `% Sie können zwischen \\begin{stammEinleitung} und \\end{stammEinleitung} beliebig`,
    `% viel eigenen Text und Bilder (\\includegraphics{...}) ergänzen.`,
    `% Bei vorhandenem Text setzt LaTeX automatisch einen Seitenumbruch vor den Daten.`,
    `% ============================================================================`,
    `${headingCmd}{${escapeLatexText(headingTitle)}}`,
    `\\label{${labelKey}}`,
    ``,
    `\\begin{stammEinleitung}`,
    `% Optionaler Einleitungstext zu diesem Abschnitt`,
    `\\end{stammEinleitung}`,
    ``,
    `\\input{${dataFileName.replace(/\.tex$/, '')}}`,
    ``,
  ];

  const texContent = lines.join('\n');
  const previewHtml = `
    <div class="master-doc-preview">
      <h3>✍️ Intro-Hülle: <code>${escapeHtmlText(introFileName)}</code></h3>
      <p class="preview-meta-note">🛡️ Geschützt: Wird nur angelegt, falls noch nicht vorhanden. Eigener Text in <code>stammEinleitung</code> erzwingt automatisch einen Seitenumbruch vor <code>${escapeHtmlText(dataFileName)}</code>.</p>
      <pre class="preview-code-snippet">${escapeHtmlText(texContent)}</pre>
    </div>
  `;

  return {
    fileName: introFileName,
    label: tabLabel,
    role: 'intro',
    isMasterFile: false,
    isMainFile: false,
    entryCount: 0,
    maxGeneration: 0,
    texContent,
    previewHtml,
  };
}

function generateStructureFile(
  baseFileName: string,
  treeSubdir: string,
  textsSubdir: string,
  mainDataFileName: string,
  activeBranches: DetectedBranchInfo[],
  options: LatexExportOptions,
  rootNode: ResolvedExportNode | undefined,
  mainEntryCount: number
): GeneratedLatexFile {
  const structureFileName = `${treeSubdir}/${baseFileName}_stammfolge.tex`;
  const lines: string[] = [
    `% ============================================================================`,
    `% LineageGraph Auto-Gliederung (Schicht 2 — AUTO-UPDATE)`,
    `% Lädt automatisch alle geschützten Intro-Dateien aus '${textsSubdir}/' in`,
    `% genealogischer Reihenfolge. Neue Stämme werden automatisch eingehängt.`,
    `% Optional können Sie zwischen Stämmen freie Dateien '*_nach.tex' ablegen.`,
    `% ============================================================================`,
    ``,
  ];

  const htmlParts: string[] = [
    `<div class="structure-preview">`,
    `<h3>📑 Auto-Gliederung & Stamm-Übersicht (<code>${escapeHtmlText(structureFileName)}</code>)</h3>`,
  ];

  if (options.template.enableBranchOverviewTable && activeBranches.length > 0) {
    lines.push(
      `\\section*{Stamm-Übersicht}`,
      `\\begin{longtable}{@{}l>{\\raggedright\\arraybackslash}p{3.8cm}>{\\raggedright\\arraybackslash}p{3.4cm}rr@{}}`,
      `\\toprule`,
      `\\textbf{Stamm} & \\textbf{Stammmutter / Stammvater} & \\textbf{Lebensdaten} & \\textbf{Personen} & \\textbf{Seite} \\\\`,
      `\\midrule`,
      `\\endhead`,
      `\\bottomrule`,
      `\\endfoot`
    );

    htmlParts.push(
      `<table class="preview-overview-table"><thead><tr><th>Stamm</th><th>Stamm-Oberhaupt</th><th>Lebensdaten</th><th>Personen</th><th>Datei / Seite</th></tr></thead><tbody>`
    );

    for (const b of activeBranches) {
      const life = [b.birthDate ? `* ${b.birthDate}` : '', b.deathDate ? `† ${b.deathDate}` : '']
        .filter(Boolean)
        .join(', ');
      lines.push(
        `{[}${escapeLatexText(b.code)}{]} & ${escapeLatexText(b.name)} & ${escapeLatexText(life || '—')} & ${b.descendantCount} & S.~\\pageref{stamm:${b.safeFileCode}} \\\\`
      );
      htmlParts.push(
        `<tr><td><strong>[${escapeHtmlText(b.code)}]</strong></td><td>${escapeHtmlText(b.name)}</td><td>${escapeHtmlText(life || '—')}</td><td>${b.descendantCount}</td><td><code>${escapeHtmlText(b.fileName)}</code></td></tr>`
      );
    }

    lines.push(`\\end{longtable}`, ``);
    htmlParts.push(`</tbody></table>`);
  }

  const rootLabel = rootNode
    ? [rootNode.person.given_name, rootNode.person.surname].filter(Boolean).join(' ')
    : baseFileName;
  const mainIntroNoExt = `${textsSubdir}/${baseFileName}_intro`;
  const mainAfterHook = `${textsSubdir}/${baseFileName}_nach.tex`;

  lines.push(
    `% --- Hauptstamm / Vorlauf ---`,
    `\\input{${mainIntroNoExt}}`,
    `\\InputIfFileExists{${mainAfterHook}}{}{}`,
    ``
  );

  htmlParts.push(
    `<div class="preview-structure-item"><strong>Hauptstamm / Vorlauf:</strong> ${escapeHtmlText(rootLabel)} (${mainEntryCount} Einträge) → <code>${escapeHtmlText(mainIntroNoExt)}.tex</code> → <code>${escapeHtmlText(mainDataFileName)}</code></div>`
  );

  for (const b of activeBranches) {
    const introNoExt = `${textsSubdir}/${baseFileName}-${b.safeFileCode}_intro`;
    const afterHook = `${textsSubdir}/${baseFileName}-${b.safeFileCode}_nach.tex`;
    const kindLabel = b.isAutoDeferred ? 'Zweig' : 'Stamm';
    lines.push(
      `% --- ${kindLabel} [${b.code}]: ${escapeLatexText(b.name)} ---`,
      `\\input{${introNoExt}}`,
      `\\InputIfFileExists{${afterHook}}{}{}`,
      ``
    );
    htmlParts.push(
      `<div class="preview-structure-item"><strong>${kindLabel} [${escapeHtmlText(b.code)}]:</strong> ${escapeHtmlText(b.name)} (${b.descendantCount} Einträge) → <code>${escapeHtmlText(introNoExt)}.tex</code> → <code>${escapeHtmlText(b.fileName)}</code></div>`
    );
  }

  htmlParts.push(`</div>`);

  return {
    fileName: structureFileName,
    label: `Gliederung (${baseFileName}_stammfolge.tex)`,
    role: 'structure',
    isMasterFile: false,
    isMainFile: false,
    entryCount: activeBranches.length + 1,
    maxGeneration: 0,
    texContent: lines.join('\n'),
    previewHtml: htmlParts.join('\n'),
  };
}

function renderBranchDataFile(
  fileName: string,
  label: string,
  isMainFile: boolean,
  branchInfo: DetectedBranchInfo | undefined,
  startPersonId: string,
  nodesById: Map<string, ResolvedExportNode>,
  splitRootSet: Set<string>,
  branchByPersonId: Map<string, DetectedBranchInfo>,
  options: LatexExportOptions,
  globalStammahnLookup: Map<string, GlobalStammahnEntry>,
  allPersonMap: Map<string, Person>
): GeneratedLatexFile {
  const codeAst = parseMaskAst(options.template.codeMask);
  const nameAst = parseMaskAst(options.template.nameMask);
  const entryAst = parseMaskAst(options.template.entryMask);
  const spouseAst = parseMaskAst(options.template.spouseMask);
  const emitInlineSpouses = options.template.entryMask.includes('{ehepartner}');

  const texLines: string[] = [
    `% ============================================================================`,
    `% LineageGraph Reine Daten-Datei (Schicht 3 — AUTO-UPDATE)`,
    `% Datei: ${fileName}`,
    `% ============================================================================`,
    ``,
  ];
  const htmlEntries: string[] = [];

  let entryCount = 0;
  let maxGen = 0;

  const renderNode = (personId: string, indentLevel: number, isBranchStart: boolean) => {
    const node = nodesById.get(personId);
    if (!node) return;

    entryCount++;
    if (node.generation > maxGen) maxGen = node.generation;

    // If this node is a split-branch root (and NOT the root of THIS current file),
    // we render them as a child with a continuation pointer and STOP descending here!
    const isSplitHere = !isBranchStart && splitRootSet.has(personId);
    const continuationTarget = isSplitHere ? branchByPersonId.get(personId) : undefined;

    const ctx = buildPersonEvalContext(
      node,
      nodesById,
      options,
      globalStammahnLookup,
      continuationTarget,
      spouseAst,
      allPersonMap,
      options.template.enableIndexGeneration
    );

    const codeEval = cleanupRenderedMaskOutput(
      ...(() => {
        const r = evaluateMaskAst(codeAst, ctx);
        return [r.latex, r.html] as const;
      })()
    );
    const nameEval = cleanupRenderedMaskOutput(
      ...(() => {
        const r = evaluateMaskAst(nameAst, ctx);
        return [r.latex, r.html] as const;
      })()
    );
    const entryEval = cleanupRenderedMaskOutput(
      ...(() => {
        const r = evaluateMaskAst(entryAst, ctx);
        return [r.latex, r.html] as const;
      })()
    );

    const nameWithIndex = `${nameEval.latex}${ctx.indexCommandsLatex}`;

    texLines.push(
      `\\genealogieEintrag{${indentLevel}}{${node.labelKey}}{${codeEval.latex}}{${nameWithIndex}}{${entryEval.latex}}`
    );

    if (!emitInlineSpouses && ctx.renderedSpousesLatex.length > 0) {
      ctx.renderedSpousesLatex.forEach((spTex, sIdx) => {
        const marriageSym = ctx.renderedSpousesLatex.length > 1 ? `\\genEheSym~${sIdx + 1}.` : `\\genEheSym`;
        texLines.push(`\\genealogieEhe{${indentLevel}}{${marriageSym}}{${spTex}}`);
      });
    }

    // Visual HTML preview entry
    const spousesHtmlBlock =
      !emitInlineSpouses && ctx.renderedSpousesHtml.length > 0
        ? ctx.renderedSpousesHtml
            .map((spH, sIdx) => {
              const sym = ctx.renderedSpousesHtml.length > 1 ? `⚭ ${sIdx + 1}.` : `⚭`;
              return `<div class="preview-spouse-row"><span class="preview-marriage-sym">${sym}</span> ${spH}</div>`;
            })
            .join('')
        : '';

    htmlEntries.push(`
      <div class="preview-entry" style="--entry-indent: ${indentLevel};" data-gen="${node.generation}">
        <div class="preview-entry-main">
          ${codeEval.html ? `<span class="preview-code">${codeEval.html}</span>` : ''}
          ${nameEval.html ? `<span class="preview-name">${nameEval.html}</span>` : ''}
          <span class="preview-details">${entryEval.html}</span>
        </div>
        ${spousesHtmlBlock}
      </div>
    `);

    if (!isSplitHere) {
      for (const cid of node.childrenIds) {
        renderNode(cid, indentLevel + 1, false);
      }
    }
  };

  if (options.sourceMode === 'custom_person' && options.direction === 'ancestors') {
    // Render sorted Kekule list
    const sortedNodes = Array.from(nodesById.values()).sort(
      (a, b) => Number(a.kekuleCode) - Number(b.kekuleCode)
    );
    for (const node of sortedNodes) {
      entryCount++;
      if (node.generation > maxGen) maxGen = node.generation;
      const ctx = buildPersonEvalContext(
        node,
        nodesById,
        options,
        globalStammahnLookup,
        undefined,
        spouseAst,
        allPersonMap,
        options.template.enableIndexGeneration
      );
      const codeRes = evaluateMaskAst(codeAst, ctx);
      const nameRes = evaluateMaskAst(nameAst, ctx);
      const entryRes = evaluateMaskAst(entryAst, ctx);
      const cClean = cleanupRenderedMaskOutput(codeRes.latex, codeRes.html);
      const nClean = cleanupRenderedMaskOutput(nameRes.latex, nameRes.html);
      const eClean = cleanupRenderedMaskOutput(entryRes.latex, entryRes.html);
      const indent = Math.max(0, node.generation - 1);

      texLines.push(
        `\\genealogieEintrag{${indent}}{${node.labelKey}}{${cClean.latex}}{${nClean.latex}${ctx.indexCommandsLatex}}{${eClean.latex}}`
      );
      htmlEntries.push(`
        <div class="preview-entry" style="--entry-indent: ${indent};" data-gen="${node.generation}">
          <div class="preview-entry-main">
            ${cClean.html ? `<span class="preview-code">${cClean.html}</span>` : ''}
            ${nClean.html ? `<span class="preview-name">${nClean.html}</span>` : ''}
            <span class="preview-details">${eClean.html}</span>
          </div>
        </div>
      `);
    }
  } else {
    renderNode(startPersonId, 0, true);
  }

  return {
    fileName,
    label,
    role: 'data',
    isMasterFile: false,
    isMainFile,
    branchCode: branchInfo?.code,
    branchPersonName: branchInfo?.name,
    entryCount,
    maxGeneration: maxGen,
    texContent: texLines.join('\n') + '\n',
    previewHtml: `<div class="preview-entries-list">${htmlEntries.join('\n')}</div>`,
  };
}

export function generateLatexExport(
  persons: ExportPersonInput[],
  options: LatexExportOptions
): LatexExportResult {
  const domainPersons = toDomainPersons(persons);
  const allPersonMap = new Map(domainPersons.map(p => [p.id, p]));

  const globalStammahnLookup = buildGlobalStammahnHenryLookup(
    domainPersons,
    options.rootAncestors || [],
    options.lineagePolicy,
    options.locale
  );

  const tree = buildUnifiedExportTree(domainPersons, options, globalStammahnLookup);
  const rootNode = tree.nodesById.get(tree.orderedRootId);
  const rootSurname = rootNode?.person.surname || rootNode?.person.given_name || 'Chronik';
  const baseFileName = sanitizeLatexFileSlug(options.baseFileName || `Chronik_${rootSurname}`);
  const treeSubdir = sanitizeLatexFileSlug(options.treeSubdir || 'Stammbaum');
  const textsSubdir = sanitizeLatexFileSlug(options.textsSubdir || 'Texte');
  const structureFileName = `${treeSubdir}/${baseFileName}_stammfolge.tex`;
  const mainDataFileName = `${treeSubdir}/${baseFileName}.tex`;

  // Compute generation summary & all available branch candidates (any person with children, gen >= 2)
  const genStats = new Map<number, { count: number; withChildren: number }>();
  const allAvailableBranches: DetectedBranchInfo[] = [];

  for (const node of tree.nodesById.values()) {
    const st = genStats.get(node.generation) || { count: 0, withChildren: 0 };
    st.count++;
    if (node.childrenIds.length > 0) st.withChildren++;
    genStats.set(node.generation, st);

    if (node.generation >= 2 && node.childrenIds.length > 0) {
      // Count descendants in subtree
      let descCount = 0;
      const countSub = (pid: string) => {
        const n = tree.nodesById.get(pid);
        if (!n) return;
        descCount++;
        for (const c of n.childrenIds) countSub(c);
      };
      countSub(node.person.id);

      const code = node.henryCode || node.zweigCode;
      const safeFileCode = sanitizeLatexLabel(code);
      allAvailableBranches.push({
        personId: node.person.id,
        code,
        safeFileCode,
        name: [node.person.given_name, node.person.surname].filter(Boolean).join(' ') || 'N.N.',
        surname: node.person.surname || '',
        givenName: node.person.given_name || '',
        birthDate: node.person.birth_date || '',
        deathDate: node.person.death_date || '',
        generation: node.generation,
        descendantCount: descCount,
        fileName: `${treeSubdir}/${baseFileName}-${safeFileCode}.tex`,
        isDesignSubtree: tree.designSubtreeRootIds.has(node.person.id),
      });
    }
  }

  allAvailableBranches.sort((a, b) => compareHenryCodes(a.code, b.code));

  const detectedGenerations: GenerationSummary[] = Array.from(genStats.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([generation, s]) => ({
      generation,
      count: s.count,
      branchesWithChildrenCount: s.withChildren,
    }));

  // Determine active split branches
  const splitRootSet = new Set<string>();
  if (options.enableBranchSplit) {
    if (options.selectedBranchIds.length > 0) {
      for (const id of options.selectedBranchIds) {
        if (tree.nodesById.has(id)) splitRootSet.add(id);
      }
    } else {
      for (const b of allAvailableBranches) {
        if (b.isDesignSubtree || b.generation === options.branchSplitGeneration) {
          splitRootSet.add(b.personId);
        }
      }
    }
  }

  // Reihenfolge-Wahrung: Geschwister ohne eigenen Sub-Baum (z.B. 15 zwischen 14 und 16),
  // die nach einem ausgelagerten Geschwister-Stamm unter demselben Elternteil folgen,
  // werden ebenfalls in exakter genealogischer Reihenfolge zwischen den Kapiteln eingeordnet.
  const deferredSiblingSet = new Set<string>();
  if (options.enableBranchSplit && splitRootSet.size > 0) {
    for (const parentNode of tree.nodesById.values()) {
      let seenSplitSibling = false;
      for (const cid of parentNode.childrenIds) {
        if (splitRootSet.has(cid)) {
          seenSplitSibling = true;
        } else if (seenSplitSibling) {
          deferredSiblingSet.add(cid);
        }
      }
    }
  }

  const effectiveSplitRootSet = new Set<string>([...splitRootSet, ...deferredSiblingSet]);
  const branchInfoMap = new Map(allAvailableBranches.map(b => [b.personId, b]));
  for (const defId of deferredSiblingSet) {
    if (!branchInfoMap.has(defId)) {
      const node = tree.nodesById.get(defId);
      if (node) {
        const code = node.henryCode || node.zweigCode;
        const safeFileCode = sanitizeLatexLabel(code);
        branchInfoMap.set(defId, {
          personId: node.person.id,
          code,
          safeFileCode,
          name: [node.person.given_name, node.person.surname].filter(Boolean).join(' ') || 'N.N.',
          surname: node.person.surname || '',
          givenName: node.person.given_name || '',
          birthDate: node.person.birth_date || '',
          deathDate: node.person.death_date || '',
          generation: node.generation,
          descendantCount: 1,
          fileName: `${treeSubdir}/${baseFileName}-${safeFileCode}.tex`,
          isDesignSubtree: false,
          isAutoDeferred: true,
        });
      }
    } else {
      const existing = branchInfoMap.get(defId)!;
      branchInfoMap.set(defId, { ...existing, isAutoDeferred: true });
    }
  }

  const activeSplitBranches = Array.from(effectiveSplitRootSet)
    .map(id => branchInfoMap.get(id))
    .filter((b): b is DetectedBranchInfo => Boolean(b))
    .sort((a, b) => compareHenryCodes(a.code, b.code));
  const branchByPersonId = new Map(activeSplitBranches.map(b => [b.personId, b]));

  const files: GeneratedLatexFile[] = [];
  const rootFullName = rootNode
    ? [rootNode.person.given_name, rootNode.person.surname].filter(Boolean).join(' ')
    : baseFileName;

  // Layer 1: Master & Globale Formatierung (im Stammverzeichnis)
  const masterFile = generateMasterFile(
    baseFileName,
    structureFileName,
    textsSubdir,
    options,
    rootFullName
  );
  const formatFile = generateFormatFile(textsSubdir, options);
  files.push(masterFile);
  files.push(formatFile);

  // Layer 3a: Main / Precursor data file (in treeSubdir)
  const mainDataFile = renderBranchDataFile(
    mainDataFileName,
    activeSplitBranches.length > 0 ? `Vorlauf (${baseFileName}.tex)` : `Stammfolge (${baseFileName}.tex)`,
    true,
    undefined,
    tree.orderedRootId,
    tree.nodesById,
    effectiveSplitRootSet,
    branchByPersonId,
    options,
    globalStammahnLookup,
    allPersonMap
  );

  // Layer 2: Structure file (in treeSubdir)
  const structureFile = generateStructureFile(
    baseFileName,
    treeSubdir,
    textsSubdir,
    mainDataFileName,
    activeSplitBranches,
    options,
    rootNode,
    mainDataFile.entryCount
  );
  files.push(structureFile);
  files.push(mainDataFile);

  // Geschützte Intro-Hülle für Hauptstamm (in textsSubdir)
  const isBook = options.template.documentClass === 'scrbook';
  files.push(
    generateIntroWrapperFile(
      `${textsSubdir}/${baseFileName}_intro.tex`,
      mainDataFileName,
      isBook ? '\\chapter' : '\\section',
      `Hauptstamm: ${rootFullName}`,
      'stamm:hauptstamm',
      `Intro (Hauptstamm)`
    )
  );

  // Layer 3b: Split Branch data files & ihre Intro-Hüllen
  for (const b of activeSplitBranches) {
    const labelPrefix = b.isAutoDeferred ? 'Zweig' : 'Stamm';
    const branchFile = renderBranchDataFile(
      b.fileName,
      `${labelPrefix} [${b.code}] (${b.name})`,
      false,
      b,
      b.personId,
      tree.nodesById,
      effectiveSplitRootSet,
      branchByPersonId,
      options,
      globalStammahnLookup,
      allPersonMap
    );
    files.push(branchFile);

    const life = [b.birthDate ? `* ${b.birthDate}` : '', b.deathDate ? `† ${b.deathDate}` : '']
      .filter(Boolean)
      .join(', ');
    const titleSuffix = life ? ` (${life})` : '';
    const branchHeading = b.isAutoDeferred
      ? isBook
        ? '\\section'
        : '\\subsection'
      : isBook
        ? '\\chapter'
        : '\\section';
    files.push(
      generateIntroWrapperFile(
        `${textsSubdir}/${baseFileName}-${b.safeFileCode}_intro.tex`,
        b.fileName,
        branchHeading,
        `${labelPrefix} [${b.code}] — ${b.name}${titleSuffix}`,
        `stamm:${b.safeFileCode}`,
        `Intro [${b.code}]`
      )
    );
  }

  const maxGenerationReached = Math.max(
    0,
    ...Array.from(tree.nodesById.values()).map(n => n.generation)
  );

  return {
    baseFileName,
    treeSubdir,
    textsSubdir,
    masterFileName: masterFile.fileName,
    structureFileName: structureFile.fileName,
    files,
    totalEntries: tree.nodesById.size,
    maxGenerationReached,
    unknownBranchesStopped: tree.unknownBranchesStopped,
    bridgeRefsCount: tree.bridgeRefsCount,
    detectedGenerations,
    allAvailableBranches,
    activeSplitBranches,
  };
}

export const LATEX_SAMPLE_PERSONS: ExportPersonInput[] = [
  {
    id: 'I_SAMPLE_1',
    given_name: 'Johann Henrich',
    surname: 'Froning',
    sex: 'M',
    birth_date: '12.04.1820',
    birth_place: 'Coesfeld',
    death_date: '03.11.1891',
    death_place: 'Münster',
    spouses: [
      {
        id: 'I_SAMPLE_SP1',
        date: '18.05.1845',
        place: 'Coesfeld',
        divorce_date: null,
        is_divorced: false,
      },
    ],
    parent_ids: [],
    gedcom_extra: {
      OCCU: 'Ackersmann',
      RELI: 'kath.',
      RESI: { PLAC: 'Coesfeld-Stevede' },
      NOTE: 'Erbte den Hof im Jahr 1848.',
    },
  },
  {
    id: 'I_SAMPLE_SP1',
    given_name: 'Anna Maria',
    surname: 'Meyer',
    sex: 'F',
    birth_date: '02.08.1824',
    birth_place: 'Billerbeck',
    death_date: '19.01.1889',
    death_place: 'Coesfeld',
    spouses: [],
    parent_ids: [],
    gedcom_extra: {},
  },
  {
    id: 'I_SAMPLE_2',
    given_name: 'Bernard Heinrich',
    surname: 'Froning',
    sex: 'M',
    birth_date: '15.03.1846',
    birth_place: 'Coesfeld',
    death_date: '22.09.1912',
    death_place: 'Dülmen',
    spouses: [],
    parent_ids: ['I_SAMPLE_1', 'I_SAMPLE_SP1'],
    gedcom_extra: {
      OCCU: 'Schmiedemeister',
      RELI: 'kath.',
      RESI: { PLAC: 'Dülmen' },
    },
  },
];

export function generateSampleLatexPreview(
  template: LatexTemplateConfig,
  locale: SupportedLocale = 'de'
): { texContent: string; previewHtml: string } {
  const res = generateLatexExport(LATEX_SAMPLE_PERSONS, {
    sourceMode: 'root_ancestor',
    rootPersonId: 'I_SAMPLE_1',
    startCode: '1',
    lineagePolicy: 'patrilinear',
    rootAncestors: [
      {
        person_id: 'I_SAMPLE_1',
        starting_code: '1',
        given_name: 'Johann Henrich',
        surname: 'Froning',
      },
    ],
    direction: 'descendants',
    maxGenerations: 5,
    ancestorSortPattern: 'kekule_patrilineal',
    unknownParentPreset: 'classic',
    customUnknownFatherText: 'N.N.',
    customUnknownMotherText: 'N.N.',
    enableBranchSplit: false,
    branchSplitGeneration: 3,
    selectedBranchIds: [],
    baseFileName: 'Muster_Chronik',
    customDocumentTitle: 'Muster-Chronik',
    customDocumentSubtitle: 'Vorschau',
    template,
    locale,
  });

  const mainFile = res.files.find(f => f.isMainFile) || res.files[0];
  return {
    texContent: mainFile?.texContent || '',
    previewHtml: mainFile?.previewHtml || '',
  };
}
