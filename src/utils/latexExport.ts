import {
  type ExportPersonInput,
  parseBirthSortKey,
  generateNextHenryCode,
} from './htmlExport';

export type LatexExportMode = 'proband' | 'custom';
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
}

export interface LatexExportOptions {
  mode: LatexExportMode;
  rootPersonId: string;
  startCode: string;
  direction: LatexExportDirection;
  maxGenerations: number;
  ancestorSortPattern: AncestorSortPattern;
  unknownParentPreset: UnknownParentPreset;
  customUnknownFatherText: string;
  customUnknownMotherText: string;
  enableBranchSplit: boolean;
  branchSplitGeneration: number;
  selectedBranchIds: string[]; // If empty when enableBranchSplit=true, all branches at branchSplitGeneration are exported
  includeBranchInputsInMain: boolean;
  customDocumentTitle: string;
  customDocumentSubtitle: string;
  template: LatexTemplateConfig;
  locale: 'de' | 'en';
}

export interface DetectedBranchInfo {
  personId: string;
  henryCode: string;
  name: string;
  surname: string;
  givenName: string;
  birthDate: string;
  deathDate: string;
  generation: number;
  descendantCount: number;
  fileName: string;
}

export interface GenerationSummary {
  generation: number;
  count: number;
  branchesWithChildrenCount: number;
}

export interface GeneratedLatexFile {
  fileName: string;
  label: string;
  isMasterFile: boolean;
  isMainFile: boolean;
  branchHenryCode?: string;
  branchPersonName?: string;
  entryCount: number;
  maxGeneration: number;
  texContent: string;
  previewHtml: string;
}

export interface LatexExportResult {
  baseSurname: string;
  masterFileName: string;
  files: GeneratedLatexFile[];
  totalEntries: number;
  maxGenerationReached: number;
  unknownBranchesStopped: number;
  detectedGenerations: GenerationSummary[];
  detectedBranchesAtSelectedGen: DetectedBranchInfo[];
}

/**
 * Vergleicht zwei Henry-Codes bzw. Ordnungscodes für eine natürliche genealogische Sortierung:
 * - Generation für Generation (z. B. 11 vor 12, 19 vor 1A, 1A vor 1B).
 * - Frühere Geschwister und alle deren Nachkommen vor späteren Geschwistern (z. B. 11, 111, 112 vor 12).
 * - Unterstützt auch punktgetrennte Pfade (z. B. 1.2 vor 1.10).
 */
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
      if (!isNaN(numA) && !isNaN(numB)) {
        if (numA !== numB) return numA - numB;
      } else {
        const cmp = segsA[i].localeCompare(segsB[i]);
        if (cmp !== 0) return cmp;
      }
    }
    return 0;
  }

  function parseHenryTokens(s: string): number[] {
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
  }

  const tokA = parseHenryTokens(a);
  const tokB = parseHenryTokens(b);
  const minLen = Math.min(tokA.length, tokB.length);
  for (let i = 0; i < minLen; i++) {
    if (tokA[i] !== tokB[i]) {
      return tokA[i] - tokB[i];
    }
  }
  return tokA.length - tokB.length;
}

export interface LatexVariableDefinition {
  token: string;
  labelKey: string;
  labelDe: string;
  labelEn: string;
  example: string;
  category: 'identity' | 'vital' | 'family' | 'extra';
}

export const LATEX_VARIABLE_DEFINITIONS: LatexVariableDefinition[] = [
  {
    token: '{henry_id}',
    labelKey: 'var_henry_id',
    labelDe: 'Henry-Code (Proband)',
    labelEn: 'Henry Code (Proband)',
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
    token: '{ordnungs_id}',
    labelKey: 'var_ordnungs_id',
    labelDe: 'Ordnungscode (Auto)',
    labelEn: 'Order Code (Auto)',
    example: '1.2.1',
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
    token: '{sohn_tochter}',
    labelKey: 'var_sohn_tochter',
    labelDe: 'Kennzeichnung als Sohn / Tochter',
    labelEn: 'Designation (Son / Daughter)',
    example: 'Sohn',
    category: 'identity',
  },
  {
    token: '{geschlecht}',
    labelKey: 'var_geschlecht',
    labelDe: 'Geschlecht',
    labelEn: 'Sex',
    example: 'm',
    category: 'identity',
  },
  {
    token: '{generation}',
    labelKey: 'var_generation',
    labelDe: 'Generation',
    labelEn: 'Generation',
    example: 'Gen. 3',
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
    labelDe: 'Implex-Hinweis',
    labelEn: 'Implex Notice',
    example: '[Implex]',
    category: 'identity',
  },
  {
    token: '{lebensdaten}',
    labelKey: 'var_lebensdaten',
    labelDe: 'Lebensdaten komplett (* / †)',
    labelEn: 'Vital Dates Block (* / †)',
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
    token: '{geburtsjahr}',
    labelKey: 'var_geburtsjahr',
    labelDe: 'Geburtsjahr',
    labelEn: 'Birth Year',
    example: '1820',
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
    token: '{taufdatum}',
    labelKey: 'var_taufdatum',
    labelDe: 'Taufdatum',
    labelEn: 'Baptism Date',
    example: '14.04.1820',
    category: 'vital',
  },
  {
    token: '{taufort}',
    labelKey: 'var_taufort',
    labelDe: 'Taufort',
    labelEn: 'Baptism Place',
    example: 'St. Lamberti',
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
    token: '{sterbejahr}',
    labelKey: 'var_sterbejahr',
    labelDe: 'Sterbejahr',
    labelEn: 'Death Year',
    example: '1891',
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
    token: '{scheidung}',
    labelKey: 'var_scheidung',
    labelDe: 'Scheidungsinformation (⚮)',
    labelEn: 'Divorce Information (⚮)',
    example: '⚮ 15.06.1985 in Münster',
    category: 'family',
  },
  {
    token: '{scheidungsdatum}',
    labelKey: 'var_scheidungsdatum',
    labelDe: 'Scheidungsdatum',
    labelEn: 'Divorce Date',
    example: '15.06.1985',
    category: 'family',
  },
  {
    token: '{partner_henry_id}',
    labelKey: 'var_partner_henry_id',
    labelDe: 'Henry-Code des Ehepartners',
    labelEn: 'Partner Henry Code',
    example: '121',
    category: 'family',
  },
  {
    token: '{ehen_gesamt}',
    labelKey: 'var_ehen_gesamt',
    labelDe: 'Gesamtzahl Ehen',
    labelEn: 'Total Marriages',
    example: '2',
    category: 'family',
  },
  {
    token: '{ehepartner}',
    labelKey: 'var_ehepartner',
    labelDe: 'Ehepartner-Zeile(n) (⚭)',
    labelEn: 'Spouse Line(s) (⚭)',
    example: '⚭ 1848 Anna Maria Schulze (* 1824, † 1899)',
    category: 'family',
  },
  {
    token: '{eltern}',
    labelKey: 'var_eltern',
    labelDe: 'Eltern (Vater & Mutter)',
    labelEn: 'Parents (Father & Mother)',
    example: 'Eltern: Bernhard Froning u. Catharina Wesseling',
    category: 'family',
  },
  {
    token: '{eltern_genau}',
    labelKey: 'var_eltern_genau',
    labelDe: 'Genaue Eltern (inkl. Ehekennzeichnung bei Mehrfachehe)',
    labelEn: 'Exact Parents (incl. marriage info in case of remarriage)',
    example: 'Eltern (aus 2. Ehe): Bernhard Froning u. Catharina Wesseling',
    category: 'family',
  },
  {
    token: '{aus_ehe}',
    labelKey: 'var_aus_ehe',
    labelDe: 'Ehe-Herkunft ("aus 1. Ehe", "aus 2. Ehe" bei Mehrfachehe)',
    labelEn: 'Marriage of Origin ("from 1st marriage", "from 2nd marriage")',
    example: 'aus 2. Ehe',
    category: 'family',
  },
  {
    token: '{eltern_ehe_nr}',
    labelKey: 'var_eltern_ehe_nr',
    labelDe: 'Ehenummer der Eltern (1, 2, ...)',
    labelEn: 'Parents Marriage Number (1, 2, ...)',
    example: '2',
    category: 'family',
  },
  {
    token: '{vater}',
    labelKey: 'var_vater',
    labelDe: 'Name des Vaters',
    labelEn: 'Father Name',
    example: 'Bernhard Froning',
    category: 'family',
  },
  {
    token: '{mutter}',
    labelKey: 'var_mutter',
    labelDe: 'Name der Mutter',
    labelEn: 'Mother Name',
    example: 'Catharina Wesseling',
    category: 'family',
  },
  {
    token: '{kinder_anzahl}',
    labelKey: 'var_kinder_anzahl',
    labelDe: 'Anzahl Kinder',
    labelEn: 'Children Count',
    example: '5',
    category: 'family',
  },
  {
    token: '{beruf}',
    labelKey: 'var_beruf',
    labelDe: 'Beruf',
    labelEn: 'Occupation',
    example: 'Ackersmann',
    category: 'extra',
  },
  {
    token: '{religion}',
    labelKey: 'var_religion',
    labelDe: 'Religion / Konfession',
    labelEn: 'Religion',
    example: 'rk.',
    category: 'extra',
  },
  {
    token: '{wohnort}',
    labelKey: 'var_wohnort',
    labelDe: 'Wohnort',
    labelEn: 'Residence',
    example: 'Goxel',
    category: 'extra',
  },
  {
    token: '{notizen}',
    labelKey: 'var_notizen',
    labelDe: 'Notizen',
    labelEn: 'Notes',
    example: 'Hofübernahme 1848',
    category: 'extra',
  },
];

export const BUILTIN_LATEX_TEMPLATES: LatexTemplateConfig[] = [
  {
    id: 'builtin-genealogie-stammfolge',
    name: 'Genealogische Stammfolge (Standard)',
    description: 'Entspricht dem Referenz-Layout mit \\genealogieEintrag & \\genealogieEhe, hängendem Einzug und dynamischen Generationsabständen.',
    entryMask:
      '({generation}{if sohn_tochter}, {sohn_tochter}{endif}{if aus_ehe}, {aus_ehe}{endif}){if implex} \\textbf{[Implex: {implex}]}{endif} — {lebensdaten}{beruf}{religion}{wohnort}{notizen}',
    spouseMask:
      '⚭ {heiratsinfo}: \\textit{{partner_name}} {partner_lebensdaten}{if ist_geschieden} \\textbf{⚮} {scheidung}{endif}{partner_eltern}',
    documentClass: 'scrbook',
    paperSize: 'a4paper',
    fontSize: '11pt',
    marginMm: 25,
    entrySpacingEm: 0.3,
    indentStepEm: 1.5,
    showGenerationBadge: true,
    includeHeaderInfo: true,
  },
  {
    id: 'builtin-classic-stammliste',
    name: 'Klassische Stammliste (Kompakt)',
    description: 'Fettdruck für Code & Familienname in der Maske, Genealogiezeichen (*, †, ≈, ⚭, ⚮).',
    entryMask:
      '\\textbf{[{henry_id}] {nachname}}, {vorname} ({generation}){if sohn_tochter} — {sohn_tochter}{endif}{if implex} \\textbf{[Implex]}{endif} — {lebensdaten}{beruf}{ehepartner}',
    spouseMask:
      '\\newline \\textit{⚭ {heiratsinfo}: {partner_name}} {partner_lebensdaten}{if ist_geschieden} \\textit{(⚮ {scheidung})}{endif}{partner_eltern}',
    documentClass: 'scrbook',
    paperSize: 'a4paper',
    fontSize: '11pt',
    marginMm: 25,
    entrySpacingEm: 0.4,
    indentStepEm: 1.5,
    showGenerationBadge: true,
    includeHeaderInfo: true,
  },
  {
    id: 'builtin-compact-chronik',
    name: 'Kompakte Chronik (Einzeilig)',
    description: 'Platzsparende Darstellung mit Genealogiezeichen (*, †, ⚭, ⚮), fokussiert auf Namen und Jahre.',
    entryMask:
      '\\textbf{[{henry_id}]} \\textsc{{nachname}}, {vorname} (* {geburtsjahr}, † {sterbejahr}){if ist_geschieden} ⚮{endif} {ehepartner}',
    spouseMask: ' — ⚭ {heiratsjahr} {partner_name}{if ist_geschieden} (⚮ {scheidungsdatum}){endif}',
    documentClass: 'scrartcl',
    paperSize: 'a4paper',
    fontSize: '10pt',
    marginMm: 16,
    entrySpacingEm: 0.25,
    indentStepEm: 1.3,
    showGenerationBadge: false,
    includeHeaderInfo: true,
  },
  {
    id: 'builtin-detailed-familienbuch',
    name: 'Ausführliches Familienbuch',
    description: 'Mehrzeiliger Eintrag mit {sohn_tochter}, Taufe (≈), Ehen (⚭), Scheidung (⚮) und Conditionals.',
    entryMask:
      '\\textbf{[{henry_id}] {vollname}} \\textit{({rolle} {generation}, {sohn_tochter})}{if implex} \\textbf{[Implex: {implex}]}{endif}{if ehen_gesamt > 1} \\textbf{({ehen_gesamt} Ehen)}{endif}\\newline {lebensdaten}{beruf}{religion}{wohnort}{ehepartner}{notizen}',
    spouseMask:
      '\\newline \\textbf{⚭ {ehe_nr}. Ehe} {heiratsinfo}: \\textit{{partner_name}} {partner_lebensdaten}{if ist_geschieden} \\textbf{⚮} {scheidung}{endif}{partner_eltern}',
    documentClass: 'scrbook',
    paperSize: 'a4paper',
    fontSize: '11pt',
    marginMm: 22,
    entrySpacingEm: 0.6,
    indentStepEm: 1.6,
    showGenerationBadge: true,
    includeHeaderInfo: true,
  },
  {
    id: 'builtin-ahnenliste-kekule',
    name: 'Ahnenliste (Vorfahren nach Kekulé)',
    description: 'Optimiert für Vorfahren-Exporte mit Kekulé-Nummerierung, Verwandtschaftsrolle und Genealogiezeichen.',
    entryMask:
      '\\textbf{[{kekule_id}] {rolle}: {nachname}}, {vorname} ({generation}){if sohn_tochter} ({sohn_tochter}){endif} — {lebensdaten}{beruf}{ehepartner}',
    spouseMask:
      '\\newline \\textit{⚭ {heiratsinfo}: {partner_name}} {partner_lebensdaten}{if ist_geschieden} \\textit{(⚮ {scheidung})}{endif}',
    documentClass: 'scrartcl',
    paperSize: 'a4paper',
    fontSize: '11pt',
    marginMm: 20,
    entrySpacingEm: 0.4,
    indentStepEm: 1.5,
    showGenerationBadge: true,
    includeHeaderInfo: true,
  },
];

/**
 * Escapes arbitrary user/GEDCOM strings so they are 100% safe inside LaTeX documents.
 * Preserves recognized genealogy symbols (*, †, ≈, ⚭, ⚮).
 */
export function escapeLatexText(input: string | null | undefined): string {
  if (!input) return '';
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    switch (ch) {
      case '\\':
        out += '\\textbackslash{}';
        break;
      case '{':
        out += '\\{';
        break;
      case '}':
        out += '\\}';
        break;
      case '$':
        out += '\\$';
        break;
      case '&':
        out += '\\&';
        break;
      case '#':
        out += '\\#';
        break;
      case '^':
        out += '\\textasciicircum{}';
        break;
      case '_':
        out += '\\_';
        break;
      case '~':
        out += '\\textasciitilde{}';
        break;
      case '%':
        out += '\\%';
        break;
      default:
        out += ch;
        break;
    }
  }
  return out;
}

/**
 * Sanitizes a surname or person identifier for use as a filesystem-safe filename stem.
 */
export function sanitizeExportBaseName(raw: string | null | undefined, fallback = 'Stammbaum'): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return fallback;
  const cleaned = trimmed
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

function readGedcomSub(extra: Record<string, any> | undefined, tag: string, subKey: string): string {
  if (!extra || !extra[tag]) return '';
  const entry = extra[tag];
  if (typeof entry === 'string') {
    return subKey === '_val' ? entry : '';
  }
  if (typeof entry === 'object' && entry !== null) {
    const val = entry[subKey];
    return typeof val === 'string' ? val : '';
  }
  return '';
}

function extractYear(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const m = dateStr.match(/\b(\d{3,4})\b/);
  return m ? m[1] : '';
}

function getFullName(p: ExportPersonInput | undefined, fallback = 'N.N.'): string {
  if (!p) return fallback;
  const fn = (p.given_name || '').trim();
  const ln = (p.surname || '').trim();
  const full = `${fn} ${ln}`.trim();
  return full || fallback;
}

function resolveFatherMother(
  person: ExportPersonInput,
  personMap: Map<string, ExportPersonInput>
): { father: ExportPersonInput | undefined; mother: ExportPersonInput | undefined } {
  const pids = person.parent_ids || [];
  if (pids.length === 0) return { father: undefined, mother: undefined };
  if (pids.length === 1) {
    const p0 = personMap.get(pids[0]);
    if (p0?.sex === 'F') return { father: undefined, mother: p0 };
    return { father: p0, mother: undefined };
  }
  const p0 = personMap.get(pids[0]);
  const p1 = personMap.get(pids[1]);
  if (p0?.sex === 'F' && p1?.sex === 'M') {
    return { father: p1, mother: p0 };
  }
  return { father: p0, mother: p1 };
}

function getAncestorRoleLabel(
  genOffset: number,
  isFemale: boolean,
  locale: 'de' | 'en'
): string {
  if (genOffset === 0) {
    return locale === 'en' ? 'Starting Entry' : 'Ausgangsperson';
  }
  if (genOffset === 1) {
    return locale === 'en' ? (isFemale ? 'Mother' : 'Father') : isFemale ? 'Mutter' : 'Vater';
  }
  if (genOffset === 2) {
    return locale === 'en'
      ? isFemale
        ? 'Grandmother'
        : 'Grandfather'
      : isFemale
      ? 'Großmutter'
      : 'Großvater';
  }
  if (genOffset === 3) {
    return locale === 'en'
      ? isFemale
        ? 'Great-Grandmother'
        : 'Great-Grandfather'
      : isFemale
      ? 'Urgroßmutter'
      : 'Urgroßvater';
  }
  const urPrefix = 'Ur-'.repeat(Math.max(1, genOffset - 2));
  return locale === 'en'
    ? `${'Great-'.repeat(genOffset - 1)}Grand${isFemale ? 'mother' : 'father'}`
    : `${urPrefix}${isFemale ? 'Großmutter' : 'Großvater'}`;
}

export function resolveUnknownParentText(
  isMother: boolean,
  genOffset: number,
  options: LatexExportOptions
): string {
  const role = getAncestorRoleLabel(genOffset, isMother, options.locale);
  if (options.unknownParentPreset === 'custom') {
    const raw = isMother
      ? options.customUnknownMotherText.trim()
      : options.customUnknownFatherText.trim();
    if (raw) {
      return raw.replace(/\{rolle\}/g, role);
    }
  }
  if (options.unknownParentPreset === 'archival') {
    return options.locale === 'en'
      ? `${role}: Not documented in records — branch ends here`
      : `${role}: Urkundlich nicht dokumentiert — Zweig endet hier`;
  }
  if (options.unknownParentPreset === 'short') {
    return options.locale === 'en' ? `${role}: Unknown` : `${role}: Nicht bekannt`;
  }
  // Default 'classic'
  return options.locale === 'en'
    ? `${role}: N.N. (not known — branch ends here)`
    : `${role}: N.N. (nicht bekannt — Zweig endet hier)`;
}

/**
 * Condition evaluation engine for format masks.
 * Supports:
 * - {if condition}...{else}...{endif}
 * - {wenn bedingung}...{sonst}...{endwenn}
 * Condition expressions:
 * - "eintrag == implex" / "implex" / "ist_implex"
 * - "ehen_gesamt > 1" / "ehen_gesamt == 0"
 * - "geschieden" / "ist_geschieden"
 * - "sohn_tochter == 'Sohn'"
 * - "kinder_anzahl > 0"
 * - presence checks: "beruf", "sterbedatum", "notizen", "eltern", etc.
 */
export function evaluateCondition(expr: string, ctx: Record<string, any>): boolean {
  const trimmed = expr.trim();
  if (!trimmed) return false;

  const compMatch = trimmed.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (compMatch) {
    const rawLhs = compMatch[1].trim();
    const op = compMatch[2];
    const rawRhs = compMatch[3].trim();

    const cleanRhs = rawRhs.replace(/^['"]|['"]$/g, '');
    const lhsLower = rawLhs.toLowerCase();
    const rhsLower = cleanRhs.toLowerCase();

    // Special aliases
    if (lhsLower === 'eintrag' && rhsLower === 'implex') {
      const isImp = Boolean(ctx.implex || ctx.ist_implex);
      return op === '==' ? isImp : !isImp;
    }
    if ((lhsLower === 'gesamtzahl ehen' || lhsLower === 'gesamtzahl_ehen') && !isNaN(Number(rhsLower))) {
      const ehen = Number(ctx.ehen_gesamt ?? 0);
      const target = Number(rhsLower);
      if (op === '==') return ehen === target;
      if (op === '!=') return ehen !== target;
      if (op === '>') return ehen > target;
      if (op === '>=') return ehen >= target;
      if (op === '<') return ehen < target;
      if (op === '<=') return ehen <= target;
    }

    const lhsVal = ctx[lhsLower] ?? ctx[rawLhs];
    const numLhs = Number(lhsVal);
    const numRhs = Number(cleanRhs);
    const bothNumbers = !isNaN(numLhs) && !isNaN(numRhs) && cleanRhs !== '';

    if (bothNumbers) {
      if (op === '==') return numLhs === numRhs;
      if (op === '!=') return numLhs !== numRhs;
      if (op === '>') return numLhs > numRhs;
      if (op === '>=') return numLhs >= numRhs;
      if (op === '<') return numLhs < numRhs;
      if (op === '<=') return numLhs <= numRhs;
    }

    const strLhs = String(lhsVal ?? '').toLowerCase();
    if (op === '==') return strLhs === rhsLower;
    if (op === '!=') return strLhs !== rhsLower;
    return false;
  }

  // Unary / truthy check
  let key = trimmed.toLowerCase();
  let negate = false;
  if (key.startsWith('!')) {
    negate = true;
    key = key.slice(1).trim();
  }

  if (key === 'implex' || key === 'ist_implex') {
    const isImp = Boolean(ctx.implex || ctx.ist_implex);
    return negate ? !isImp : isImp;
  }
  if (key === 'geschieden' || key === 'ist_geschieden') {
    const isDiv = Boolean(ctx.ist_geschieden || ctx.geschieden || ctx.scheidungsdatum);
    return negate ? !isDiv : isDiv;
  }

  const val = ctx[key] ?? ctx[trimmed];
  const truthy = Boolean(val && val !== '0' && val !== 0 && val !== '');
  return negate ? !truthy : truthy;
}

export function evaluateConditionals(template: string, ctx: Record<string, any>): string {
  const condRegex = /\{(?:if|wenn)\s+([^{}]+?)\}([\s\S]*?)(?:\{(?:else|sonst)\}([\s\S]*?))?\{(?:endif|endwenn)\}/i;
  let result = template;
  let iterations = 0;
  while (condRegex.test(result) && iterations < 30) {
    result = result.replace(condRegex, (_match, expr, truthyBlock, falsyBlock = '') => {
      const isTrue = evaluateCondition(expr, ctx);
      return isTrue ? truthyBlock : falsyBlock;
    });
    iterations++;
  }
  return result;
}

interface InternalExportItem {
  indentLevel: number; // Pure level step: 0 for generation 1, 1 for gen 2, 2 for gen 3...
  generationNumber: number;
  isUnknownPlaceholder: boolean;
  unknownText?: string;
  person?: ExportPersonInput;
  henryCode?: string;
  kekuleId?: number;
  orderCode?: string;
  roleLabel?: string;
  childrenCount: number;
  isImplex?: boolean;
  implexNotice?: string;
}

/**
 * Formats a single spouse using the configured `spouseMask`, supporting genealogy symbols & conditionals.
 */
function renderSpouseItemLatex(
  spConn: {
    id: string;
    date: string | null;
    place: string | null;
    divorce_date: string | null;
    is_divorced: boolean;
  },
  order: number,
  personMap: Map<string, ExportPersonInput>,
  spouseMask: string,
  locale: 'de' | 'en',
  henryMap?: Map<string, { code: string; generation: number }>
): string {
  const spPerson = personMap.get(spConn.id);
  const partnerHenryId = escapeLatexText(henryMap?.get(spConn.id)?.code || '');
  const partnerName = escapeLatexText(
    getFullName(spPerson, locale === 'en' ? 'Unknown' : 'Unbekannt')
  );
  const mDate = escapeLatexText(spConn.date || '');
  const mPlace = escapeLatexText(spConn.place || '');
  const mYear = escapeLatexText(extractYear(spConn.date));

  let heiratsInfo = '';
  if (mDate && mPlace) {
    heiratsInfo = `${mDate} in ${mPlace}`;
  } else if (mDate) {
    heiratsInfo = mDate;
  } else if (mPlace) {
    heiratsInfo = `in ${mPlace}`;
  }

  // Divorce info with ⚮
  const isDivorced = Boolean(spConn.is_divorced || spConn.divorce_date);
  const divDateStr = escapeLatexText(spConn.divorce_date || '');
  let scheidungInfo = '';
  if (isDivorced) {
    scheidungInfo = divDateStr
      ? (locale === 'en' ? `div. ${divDateStr}` : `gesch. ${divDateStr}`)
      : (locale === 'en' ? 'divorced' : 'geschieden');
  }

  let partnerLebensdaten = '';
  if (spPerson) {
    const bDate = escapeLatexText(spPerson.birth_date || '');
    const bPlace = escapeLatexText(spPerson.birth_place || '');
    const dDate = escapeLatexText(spPerson.death_date || '');
    const dPlace = escapeLatexText(spPerson.death_place || '');
    const parts: string[] = [];
    if (bDate || bPlace) {
      parts.push(`* ${[bDate, bPlace ? `in ${bPlace}` : ''].filter(Boolean).join(' ')}`);
    }
    if (dDate || dPlace) {
      parts.push(`† ${[dDate, dPlace ? `in ${dPlace}` : ''].filter(Boolean).join(' ')}`);
    }
    if (parts.length > 0) {
      partnerLebensdaten = `(${parts.join(', ')})`;
    }
  }

  let partnerEltern = '';
  if (spPerson) {
    const { father, mother } = resolveFatherMother(spPerson, personMap);
    const pNames = [
      father ? escapeLatexText(getFullName(father, '')) : '',
      mother ? escapeLatexText(getFullName(mother, '')) : '',
    ].filter(Boolean);
    if (pNames.length > 0) {
      partnerEltern =
        locale === 'en' ? ` [Parents: ${pNames.join(' \\& ')}]` : ` [Eltern: ${pNames.join(' u. ')}]`;
    }
  }

  const spouseCtx: Record<string, any> = {
    partner_henry_id: partnerHenryId,
    ehe_nr: order,
    heiratsinfo: heiratsInfo,
    heiratsdatum: mDate,
    heiratsort: mPlace,
    heiratsjahr: mYear,
    partner_name: partnerName,
    partner_lebensdaten: partnerLebensdaten,
    partner_eltern: partnerEltern,
    scheidung: scheidungInfo,
    scheidungsdatum: divDateStr,
    ist_geschieden: isDivorced,
    geschieden: isDivorced,
  };

  const processedMask = evaluateConditionals(spouseMask, spouseCtx);

  let out = processedMask
    .replace(/\{partner_henry_id\}/g, partnerHenryId)
    .replace(/\{ehe_nr\}/g, String(order))
    .replace(/\{heiratsinfo\}/g, heiratsInfo)
    .replace(/\{heiratsdatum\}/g, mDate)
    .replace(/\{heiratsort\}/g, mPlace)
    .replace(/\{heiratsjahr\}/g, mYear)
    .replace(/\{partner_name\}/g, partnerName)
    .replace(/\{partner_lebensdaten\}/g, partnerLebensdaten)
    .replace(/\{partner_eltern\}/g, partnerEltern)
    .replace(/\{scheidung\}/g, scheidungInfo)
    .replace(/\{scheidungsdatum\}/g, divDateStr)
    .replace(/\{ist_geschieden\}/g, isDivorced ? (locale === 'en' ? 'Yes' : 'Ja') : (locale === 'en' ? 'No' : 'Nein'));

  // Clean up punctuation
  out = out
    .replace(/:\s*:/g, ':')
    .replace(/⚭\s*:\s*/g, '⚭ ')
    .replace(/\s+/g, ' ');

  return out;
}

function getOrdinalSuffix(n: number): string {
  if (n === 1) return 'st';
  if (n === 2) return 'nd';
  if (n === 3) return 'rd';
  return 'th';
}

/**
 * Substitutes template variables and evaluates conditionals for an entry, returning clean LaTeX code.
 */
function renderPersonEntryLatex(
  item: InternalExportItem,
  personMap: Map<string, ExportPersonInput>,
  options: LatexExportOptions,
  henryMap?: Map<string, { code: string; generation: number }>
): string {
  if (item.isUnknownPlaceholder) {
    const escapedUnknown = escapeLatexText(item.unknownText || '');
    return `\\textit{${escapedUnknown}}`;
  }

  const p = item.person!;
  const tpl = options.template;
  const loc = options.locale;

  const givenName = escapeLatexText((p.given_name || '').trim() || 'N.N.');
  const surname = escapeLatexText((p.surname || '').trim() || 'N.N.');
  const fullName = escapeLatexText(getFullName(p, 'N.N.'));

  // Sex & Sohn / Tochter designation
  const sexStr =
    p.sex === 'M'
      ? 'm'
      : p.sex === 'F'
      ? (loc === 'en' ? 'f' : 'w')
      : '';

  // Kennzeichnung als Sohn / Tochter:
  // Für die Ausgangsperson (Gen. 1) oder Personen ohne Eltern im Baum leer lassen,
  // damit Bedingung {if sohn_tochter} Gen. 1 ohne ', Sohn' ausgibt.
  const isRootOrHasNoParents =
    item.generationNumber === 1 ||
    !p.parent_ids ||
    p.parent_ids.length === 0;

  const sohnTochter = isRootOrHasNoParents
    ? ''
    : p.sex === 'M'
    ? (loc === 'en' ? 'Son' : 'Sohn')
    : p.sex === 'F'
    ? (loc === 'en' ? 'Daughter' : 'Tochter')
    : (loc === 'en' ? 'Child' : 'Kind');

  const henryId = escapeLatexText(item.henryCode || '');
  const kekuleId = item.kekuleId !== undefined ? String(item.kekuleId) : '';
  const orderCode = escapeLatexText(item.orderCode || item.henryCode || kekuleId || '');
  const genLabel = `Gen. ${item.generationNumber}`;
  const roleLabel = escapeLatexText(item.roleLabel || '');
  const xref = escapeLatexText(p.id);

  const bDate = escapeLatexText(p.birth_date || '');
  const bYear = escapeLatexText(extractYear(p.birth_date));
  const bPlace = escapeLatexText(p.birth_place || '');

  const chrDate = escapeLatexText(
    readGedcomSub(p.gedcom_extra, 'CHR', 'DATE') ||
      readGedcomSub(p.gedcom_extra, 'BAPM', 'DATE')
  );
  const chrPlace = escapeLatexText(
    readGedcomSub(p.gedcom_extra, 'CHR', 'PLAC') ||
      readGedcomSub(p.gedcom_extra, 'BAPM', 'PLAC')
  );

  const dDate = escapeLatexText(p.death_date || '');
  const dYear = escapeLatexText(extractYear(p.death_date));
  const dPlace = escapeLatexText(p.death_place || '');

  // Genealogical symbols (*, ≈, †) in vital dates block
  const vitalParts: string[] = [];
  if (bDate || bPlace) {
    vitalParts.push(`* ${[bDate, bPlace ? `in ${bPlace}` : ''].filter(Boolean).join(' ')}`);
  }
  if (chrDate || chrPlace) {
    vitalParts.push(`≈ ${[chrDate, chrPlace ? `in ${chrPlace}` : ''].filter(Boolean).join(' ')}`);
  }
  if (dDate || dPlace) {
    vitalParts.push(`† ${[dDate, dPlace ? `in ${dPlace}` : ''].filter(Boolean).join(' ')}`);
  }
  const lebensdaten = vitalParts.join(', ');

  const rawOccu = readGedcomSub(p.gedcom_extra, 'OCCU', '_val');
  const rawReli = readGedcomSub(p.gedcom_extra, 'RELI', '_val');
  const rawResi =
    readGedcomSub(p.gedcom_extra, 'RESI', 'PLAC') ||
    readGedcomSub(p.gedcom_extra, 'RESI', '_val');
  const rawNote = readGedcomSub(p.gedcom_extra, 'NOTE', '_val');

  const beruf = rawOccu ? `, ${escapeLatexText(rawOccu)}` : '';
  const religion = rawReli ? `, ${escapeLatexText(rawReli)}` : '';
  const wohnort = rawResi
    ? `, ${loc === 'en' ? 'res.' : 'wh.'} ${escapeLatexText(rawResi)}`
    : '';
  const notizen = rawNote ? ` \\newline \\footnotesize{Anm.: ${escapeLatexText(rawNote)}}` : '';

  // Parents & Multi-marriage handling
  const { father, mother } = resolveFatherMother(p, personMap);
  const fatherName = father ? escapeLatexText(getFullName(father, '')) : '';
  const motherName = mother ? escapeLatexText(getFullName(mother, '')) : '';
  const parentNames = [fatherName, motherName].filter(Boolean);
  const eltern =
    parentNames.length > 0
      ? `${loc === 'en' ? 'Parents' : 'Eltern'}: ${parentNames.join(' u. ')}`
      : '';

  // Ermitteln, ob bei den Eltern eine Mehrfachehe vorliegt und aus welcher Ehe das Kind stammt
  let parentsMarriageOrder = 0;
  let hasMultipleMarriagesOnParents = false;

  if (father && mother) {
    const fSpouses = father.spouses || [];
    const mSpouses = mother.spouses || [];

    if (fSpouses.length > 1 || mSpouses.length > 1) {
      hasMultipleMarriagesOnParents = true;
      const fIdx = fSpouses.findIndex(s => s.id === mother.id);
      if (fIdx >= 0) {
        parentsMarriageOrder = fIdx + 1;
      } else {
        const mIdx = mSpouses.findIndex(s => s.id === father.id);
        if (mIdx >= 0) {
          parentsMarriageOrder = mIdx + 1;
        }
      }
    }
  } else if (father && !mother) {
    const fSpouses = father.spouses || [];
    if (fSpouses.length > 1) {
      hasMultipleMarriagesOnParents = true;
    }
  } else if (mother && !father) {
    const mSpouses = mother.spouses || [];
    if (mSpouses.length > 1) {
      hasMultipleMarriagesOnParents = true;
    }
  }

  const elternEheNr = parentsMarriageOrder > 0 ? String(parentsMarriageOrder) : '';
  const ausEhe =
    parentsMarriageOrder > 0
      ? (loc === 'en'
          ? `from ${parentsMarriageOrder}${getOrdinalSuffix(parentsMarriageOrder)} marriage`
          : `aus ${parentsMarriageOrder}. Ehe`)
      : '';

  let elternGenau = eltern;
  if (parentNames.length > 0 && parentsMarriageOrder > 0) {
    elternGenau =
      loc === 'en'
        ? `Parents (${ausEhe}): ${parentNames.join(' \\& ')}`
        : `Eltern (${ausEhe}): ${parentNames.join(' u. ')}`;
  }

  const totalMarriages = (p.spouses || []).length;
  const anyDivorce = (p.spouses || []).some(s => s.is_divorced || s.divorce_date);
  const firstDivorce = (p.spouses || []).find(s => s.is_divorced || s.divorce_date);
  const divorceDateStr = escapeLatexText(firstDivorce?.divorce_date || '');
  const scheidungStr = anyDivorce
    ? (divorceDateStr
        ? `⚮ ${loc === 'en' ? 'div.' : 'gesch.'} ${divorceDateStr}`
        : (loc === 'en' ? '⚮ divorced' : '⚮ geschieden'))
    : '';

  const isImplex = Boolean(item.isImplex);
  const implexNotice = escapeLatexText(item.implexNotice || (isImplex ? 'Implex' : ''));

  const kinderAnzahl = item.childrenCount;
  const kinderStr =
    kinderAnzahl > 0
      ? `${kinderAnzahl} ${
          kinderAnzahl === 1
            ? (loc === 'en' ? 'child' : 'Kind')
            : (loc === 'en' ? 'children' : 'Kinder')
        }`
      : '';

  // First partner Henry code for use in entry mask
  const firstSpouseId = (p.spouses || [])[0]?.id;
  const firstPartnerHenryId = escapeLatexText(
    firstSpouseId && henryMap?.get(firstSpouseId)?.code ? henryMap.get(firstSpouseId)!.code : ''
  );

  // Spouses rendered using spouseMask
  const spousesRendered = (p.spouses || [])
    .map((sp, idx) =>
      renderSpouseItemLatex(sp, idx + 1, personMap, tpl.spouseMask, loc, henryMap)
    )
    .join('');

  // Context for conditional evaluations
  const evalCtx: Record<string, any> = {
    partner_henry_id: firstPartnerHenryId,
    henry_id: item.henryCode || '',
    kekule_id: item.kekuleId ?? '',
    ordnungs_id: item.orderCode || item.henryCode || item.kekuleId || '',
    nachname: surname,
    vorname: givenName,
    vollname: fullName,
    sohn_tochter: sohnTochter,
    geschlecht: sexStr,
    sex: p.sex || '',
    generation: item.generationNumber,
    rolle: roleLabel,
    xref: p.id,
    lebensdaten,
    geburtsdatum: bDate,
    geburtsjahr: bYear,
    geburtsort: bPlace,
    taufdatum: chrDate,
    taufort: chrPlace,
    sterbedatum: dDate,
    sterbejahr: dYear,
    sterbeort: dPlace,
    scheidung: scheidungStr,
    scheidungsdatum: divorceDateStr,
    ist_geschieden: anyDivorce,
    geschieden: anyDivorce,
    ehen_gesamt: totalMarriages,
    ehe_anzahl: totalMarriages,
    implex: isImplex,
    ist_implex: isImplex,
    eintrag: isImplex ? 'implex' : 'normal',
    eltern,
    eltern_genau: elternGenau,
    aus_ehe: ausEhe,
    eltern_ehe_nr: elternEheNr,
    eltern_mehrfachehe: hasMultipleMarriagesOnParents,
    ist_mehrfachehe_eltern: hasMultipleMarriagesOnParents,
    vater: fatherName,
    mutter: motherName,
    kinder_anzahl: kinderAnzahl,
    beruf: rawOccu || '',
    religion: rawReli || '',
    wohnort: rawResi || '',
    notizen: rawNote || '',
  };

  // Evaluate conditionals ({if ...}...{else}...{endif})
  const evaluatedMask = evaluateConditionals(tpl.entryMask, evalCtx);

  let result = evaluatedMask
    .replace(/\{partner_henry_id\}/g, firstPartnerHenryId)
    .replace(/\{henry_id\}/g, henryId)
    .replace(/\{kekule_id\}/g, kekuleId)
    .replace(/\{ordnungs_id\}/g, orderCode)
    .replace(/\{nachname\}/g, surname)
    .replace(/\{vorname\}/g, givenName)
    .replace(/\{vollname\}/g, fullName)
    .replace(/\{sohn_tochter\}/g, sohnTochter)
    .replace(/\{geschlecht\}/g, sexStr)
    .replace(/\{generation\}/g, genLabel)
    .replace(/\{rolle\}/g, roleLabel)
    .replace(/\{xref\}/g, xref)
    .replace(/\{lebensdaten\}/g, lebensdaten)
    .replace(/\{geburtsdatum\}/g, bDate || '–')
    .replace(/\{geburtsjahr\}/g, bYear || '–')
    .replace(/\{geburtsort\}/g, bPlace)
    .replace(/\{taufdatum\}/g, chrDate)
    .replace(/\{taufort\}/g, chrPlace)
    .replace(/\{sterbedatum\}/g, dDate || '–')
    .replace(/\{sterbejahr\}/g, dYear || '–')
    .replace(/\{sterbeort\}/g, dPlace)
    .replace(/\{scheidung\}/g, scheidungStr)
    .replace(/\{scheidungsdatum\}/g, divorceDateStr)
    .replace(/\{ist_geschieden\}/g, anyDivorce ? (loc === 'en' ? 'Yes' : 'Ja') : (loc === 'en' ? 'No' : 'Nein'))
    .replace(/\{ehen_gesamt\}/g, String(totalMarriages))
    .replace(/\{ehepartner\}/g, spousesRendered)
    .replace(/\{eltern_genau\}/g, elternGenau)
    .replace(/\{aus_ehe\}/g, ausEhe)
    .replace(/\{eltern_ehe_nr\}/g, elternEheNr)
    .replace(/\{eltern\}/g, eltern)
    .replace(/\{vater\}/g, fatherName)
    .replace(/\{mutter\}/g, motherName)
    .replace(/\{kinder_anzahl\}/g, kinderStr)
    .replace(/\{beruf\}/g, beruf)
    .replace(/\{religion\}/g, religion)
    .replace(/\{wohnort\}/g, wohnort)
    .replace(/\{notizen\}/g, notizen)
    .replace(/\{implex\}/g, implexNotice)
    .replace(/\{ist_implex\}/g, isImplex ? (loc === 'en' ? 'Yes' : 'Ja') : (loc === 'en' ? 'No' : 'Nein'));

  // Clean up empty brackets when {henry_id} or {kekule_id} is not present in custom mode
  result = result
    .replace(/\[\s*\]\s*/g, '')
    .replace(/\\textbf\{\s*\}\s*/g, '')
    .replace(/\(\s*\)\s*/g, '')
    .replace(/\s+—\s*$/g, '')
    .trim();

  if (
    options.mode === 'custom' &&
    options.direction === 'ancestors' &&
    item.indentLevel > 0 &&
    roleLabel &&
    !tpl.entryMask.includes('{rolle}')
  ) {
    const kekuleBadge = kekuleId && !tpl.entryMask.includes('{kekule_id}') ? ` [${kekuleId}]` : '';
    result = `\\textbf{${roleLabel}${kekuleBadge}:} ${result}`;
  }

  return result;
}

/**
 * Converts a rendered LaTeX entry string into clean HTML for the visual preview sheet.
 */
function convertLatexEntryToPreviewHtml(latexStr: string): string {
  let html = latexStr
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Unescape LaTeX escaped symbols for preview display
  html = html
    .replace(/\\&amp;/g, '&amp;')
    .replace(/\\%/g, '%')
    .replace(/\\\$/g, '$')
    .replace(/\\#/g, '#')
    .replace(/\\_/g, '_')
    .replace(/\\\{/g, '{')
    .replace(/\\\}/g, '}');

  // Math symbols
  html = html
    .replace(/\$\\infty\$/g, '⚭')
    .replace(/\\infty\\?\s*/g, '⚭ ')
    .replace(/\$\\dagger\$/g, '†')
    .replace(/\\dagger\\?\s*/g, '† ')
    .replace(/\$\\approx\$/g, '≈')
    .replace(/\\rightarrow\\?\s*/g, '→ ');

  // Formatting commands (iteratively resolve nested single-level braces)
  for (let pass = 0; pass < 3; pass++) {
    html = html
      .replace(/\\textbf\{([^{}]*)\}/g, '<strong>$1</strong>')
      .replace(/\\textit\{([^{}]*)\}/g, '<em>$1</em>')
      .replace(/\\textsc\{([^{}]*)\}/g, '<span style="font-variant: small-caps;">$1</span>')
      .replace(/\\underline\{([^{}]*)\}/g, '<u>$1</u>')
      .replace(/\\footnotesize\{([^{}]*)\}/g, '<span style="font-size: 0.85em; color: #475569;">$1</span>')
      .replace(/\\small\{([^{}]*)\}/g, '<span style="font-size: 0.92em;">$1</span>')
      .replace(/\\large\{([^{}]*)\}/g, '<span style="font-size: 1.12em;">$1</span>');
  }

  html = html
    .replace(/\\newline\s*/g, '<br/>')
    .replace(/\\quad\s*/g, '&emsp;');

  return html;
}

/**
 * Generates the central preamble and format options block for the overarching master document.
 * Strictly adheres to the reference Stammfolgen layout: scrbook, 2.5/3cm margins,
 * \genIndentBase = 0.35cm, dynamic vertical sep distances (\genSepDeeper, \genSepSame, \genSepShallower, \genSepMarriage),
 * and the macros \genealogieEintrag[4] and \genealogieEhe[3].
 */
function generateMasterPreamble(
  options: LatexExportOptions,
  docTitle?: string,
  docSubtitle?: string
): string {
  const tpl = options.template;
  const docClass = tpl.documentClass || 'scrbook';
  const paper = tpl.paperSize || 'a4paper';
  const fontSize = tpl.fontSize || '11pt';
  const localeLang = options.locale === 'en' ? 'english' : 'ngerman';

  const lines: string[] = [];
  lines.push(`% ============================================================================`);
  lines.push(`% Übergeordnete Klammer-Datei (Master): Formatierungsoptionen & Gesamtstruktur`);
  lines.push(`% Generiert mit Stammbaum - Druckformat Export (LaTeX)`);
  lines.push(`% Vorlage: ${tpl.name}`);
  lines.push(`% ============================================================================`);
  lines.push(`\\documentclass[${fontSize},${paper},${localeLang}]{${docClass}}`);
  lines.push(`\\usepackage[utf8]{inputenc}`);
  lines.push(`\\usepackage[T1]{fontenc}`);
  lines.push(`\\usepackage{lmodern}`);
  lines.push(`\\usepackage{babel}`);
  lines.push(`\\usepackage{geometry}`);
  lines.push(`\\geometry{left=2.5cm,right=2.5cm,top=3cm,bottom=3cm}`);
  lines.push(`\\usepackage{graphicx}`);
  lines.push(`\\usepackage{hyperref}`);
  lines.push(`\\usepackage{makecell}`);
  lines.push(`\\usepackage{newunicodechar}`);
  lines.push(``);
  lines.push(`% --- Genealogische Zeichen (*, †, ≈, ⚭, ⚮) Deklaration für LaTeX ---`);
  lines.push(`\\DeclareUnicodeCharacter{2020}{\\ensuremath{\\dagger}}% †`);
  lines.push(`\\DeclareUnicodeCharacter{2248}{\\ensuremath{\\approx}}% ≈`);
  lines.push(`\\DeclareUnicodeCharacter{26AD}{\\ensuremath{\\infty}}% ⚭ (Ehe / Heirat)`);
  lines.push(`\\DeclareUnicodeCharacter{26AE}{\\ensuremath{\\circ\\vert\\circ}}% ⚮ (Scheidung)`);
  lines.push(``);
  lines.push(`% =============================================================`);
  lines.push(`% ZENTRALE FORMATIERUNGS-EINSTELLUNGEN FÜR DIE STAMMFOLGEN`);
  lines.push(`% =============================================================`);
  lines.push(`\\newlength{\\genIndentBase}`);
  lines.push(`\\setlength{\\genIndentBase}{0.35cm}    % Grund-Einzug pro Generationsebene`);
  lines.push(``);
  lines.push(`% --- Vertikale Abstände zwischen den Einträgen ---`);
  lines.push(`\\newlength{\\genSepDeeper}`);
  lines.push(`\\setlength{\\genSepDeeper}{0.30em}     % Abstand, wenn Generation erhöht wird (zu Kindern)`);
  lines.push(``);
  lines.push(`\\newlength{\\genSepSame}`);
  lines.push(`\\setlength{\\genSepSame}{0.20em}       % Abstand, wenn Generation gleich bleibt (zu Geschwistern)`);
  lines.push(``);
  lines.push(`\\newlength{\\genSepShallower}`);
  lines.push(`\\setlength{\\genSepShallower}{0.55em}  % Abstand bei Rücksprung zu früherer Generation`);
  lines.push(``);
  lines.push(`\\newlength{\\genSepMarriage}`);
  lines.push(`\\setlength{\\genSepMarriage}{0.15em}   % Abstand nach/zwischen Eheeinträgen`);
  lines.push(``);
  lines.push(`% Makro für Personeneinträge: #1=Generation, #2=Henry-Code, #3=Name, #4=Daten & Details`);
  lines.push(`\\newcommand{\\genealogieEintrag}[4]{%`);
  lines.push(`\t\\begingroup`);
  lines.push(`\t\\edef\\currentIndent{\\the\\dimexpr #1\\genIndentBase\\relax}%`);
  lines.push(`\t\\edef\\currentHang{\\the\\dimexpr #1\\genIndentBase + 1.1cm\\relax}%`);
  lines.push(`\t\\noindent\\hangindent=\\currentHang\\hangafter=1\\hspace*{\\currentIndent}%`);
  lines.push(`\t#2 \\textbf{#3}#4\\par%`);
  lines.push(`\t\\endgroup`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`% Makro für Eheeinträge: #1=Generation, #2=Ehenummer, #3=Partner & Details`);
  lines.push(`\\newcommand{\\genealogieEhe}[3]{%`);
  lines.push(`\t\\begingroup`);
  lines.push(`\t\\edef\\currentIndent{\\the\\dimexpr #1\\genIndentBase + 0.3cm\\relax}%`);
  lines.push(`\t\\edef\\currentHang{\\the\\dimexpr #1\\genIndentBase + 1.0cm\\relax}%`);
  lines.push(`\t\\noindent\\hangindent=\\currentHang\\hangafter=1\\hspace*{\\currentIndent}%`);
  lines.push(`\t(#2) #3\\par%`);
  lines.push(`\t\\endgroup`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`% Kompatibilität für ältere Vorlagenaufrufe`);
  lines.push(`\\newcommand{\\stammbaumeintrag}[2]{\\genealogieEintrag{#1}{}{}{#2}}`);
  lines.push(``);
  lines.push(`\\begin{document}`);

  if (tpl.includeHeaderInfo && docTitle?.trim()) {
    lines.push(`\\section*{${escapeLatexText(docTitle)}}`);
    if (docSubtitle?.trim()) {
      lines.push(`\\textbf{${escapeLatexText(docSubtitle)}}\\\\[6pt]`);
    }
    lines.push(`\\hrule\\vspace{8pt}`);
    lines.push(``);
  }

  return lines.join('\n');
}

/**
 * Builds the standalone content for a specific file (proband main tree or branch),
 * utilizing \genealogieEintrag and \genealogieEhe with dynamic vertical spacing
 * and clean variable evaluation.
 */
function buildLatexContentAndPreview(
  items: InternalExportItem[],
  personMap: Map<string, ExportPersonInput>,
  options: LatexExportOptions,
  docTitle?: string,
  docSubtitle?: string,
  henryMap?: Map<string, { code: string; generation: number }>
): { entryCommands: string[]; previewHtml: string } {
  const tpl = options.template;
  const entryCommands: string[] = [];
  const previewRowsHtml: string[] = [];
  let prevIndent = -1;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    let sepClass = '';

    // Vertikaler Abstand je nach Generationssprung
    if (prevIndent >= 0) {
      if (item.indentLevel > prevIndent) {
        entryCommands.push('\\vspace{\\genSepDeeper}');
        sepClass = ' sep-deeper';
      } else if (item.indentLevel === prevIndent) {
        entryCommands.push('\\vspace{\\genSepSame}');
        sepClass = ' sep-same';
      } else {
        entryCommands.push('\\vspace{\\genSepShallower}');
        sepClass = ' sep-shallower';
      }
    }
    prevIndent = item.indentLevel;

    if (item.isUnknownPlaceholder) {
      const escapedUnknown = escapeLatexText(item.unknownText || '');
      entryCommands.push(`\\genealogieEintrag{${item.indentLevel}}{}{}{\\textit{${escapedUnknown}}}`);
      previewRowsHtml.push(
        `<div class="latex-preview-entry is-unknown-entry${sepClass}" style="--indent-step: ${item.indentLevel};">
          <span class="latex-preview-level-marker">Gen. ${item.generationNumber}</span>
          <div class="latex-preview-entry-body"><em>${escapedUnknown}</em></div>
        </div>`
      );
      continue;
    }

    const p = item.person!;
    const surname = escapeLatexText((p.surname || '').trim() || 'N.N.');
    const givenName = escapeLatexText((p.given_name || '').trim() || 'N.N.');

    const maskContainsName =
      tpl.entryMask.includes('{nachname}') || tpl.entryMask.includes('{vollname}');
    const maskContainsSpouse = tpl.entryMask.includes('{ehepartner}');

    if (maskContainsName) {
      // Benutzerdefiniertes Masken-Layout mit individuellem Namensaufbau
      const entryLatex = renderPersonEntryLatex(item, personMap, options, henryMap);
      entryCommands.push(`\\genealogieEintrag{${item.indentLevel}}{}{}{${entryLatex}}`);

      const rowHtml = convertLatexEntryToPreviewHtml(entryLatex);
      const implexClass = item.isImplex ? ' is-implex-entry' : '';
      previewRowsHtml.push(
        `<div class="latex-preview-entry${implexClass}${sepClass}" style="--indent-step: ${item.indentLevel};">
          <span class="latex-preview-level-marker">Gen. ${item.generationNumber}</span>
          <div class="latex-preview-entry-body">${rowHtml}</div>
        </div>`
      );
    } else {
      // Standard Referenz-Format: #1=Gen, #2=Code, #3=Name (fett), #4=Details
      let code = '';
      if (item.henryCode) {
        code = `[${escapeLatexText(item.henryCode)}] `;
      } else if (item.kekuleId !== undefined && item.kekuleId !== null) {
        code = `(${item.kekuleId}) `;
      } else if (item.orderCode) {
        code = `[${escapeLatexText(item.orderCode)}] `;
      }

      const name = `${surname}, ${givenName}`;
      const detailsLatex = renderPersonEntryLatex(item, personMap, options, henryMap);
      let detailsStr = '';
      if (detailsLatex) {
        detailsStr = detailsLatex.startsWith(',') || detailsLatex.startsWith('.')
          ? detailsLatex
          : ` ${detailsLatex}`;
      }

      entryCommands.push(`\\genealogieEintrag{${item.indentLevel}}{${code}}{${name}}{${detailsStr}}`);

      const previewCode = code;
      const previewName = `<strong>${name}</strong>`;
      const previewDetails = convertLatexEntryToPreviewHtml(detailsStr);
      const implexClass = item.isImplex ? ' is-implex-entry' : '';

      previewRowsHtml.push(
        `<div class="latex-preview-entry${implexClass}${sepClass}" style="--indent-step: ${item.indentLevel};">
          <span class="latex-preview-level-marker">Gen. ${item.generationNumber}</span>
          <div class="latex-preview-entry-body">${previewCode}${previewName}${previewDetails}</div>
        </div>`
      );

      // Separate Eheeinträge mit \genealogieEhe, falls nicht in entryMask eingebettet
      if (!maskContainsSpouse && p.spouses && p.spouses.length > 0) {
        p.spouses.forEach((sp, spIdx) => {
          const spOrder = spIdx + 1;
          const spLatex = renderSpouseItemLatex(
            sp,
            spOrder,
            personMap,
            tpl.spouseMask,
            options.locale,
            henryMap
          );
          entryCommands.push(`\\vspace{\\genSepMarriage}`);
          entryCommands.push(`\\genealogieEhe{${item.indentLevel}}{${spOrder}}{${spLatex}}`);

          const spPreview = convertLatexEntryToPreviewHtml(spLatex);
          previewRowsHtml.push(
            `<div class="latex-preview-marriage" style="--indent-step: ${item.indentLevel};">
              <span class="ehe-nr">(${spOrder})</span> <span class="ehe-details">${spPreview}</span>
            </div>`
          );
        });
      }
    }
  }

  const previewHtml = `
    <div class="latex-sheet-page">
      ${
        tpl.includeHeaderInfo && docTitle?.trim()
          ? `<div class="latex-sheet-header">
              <h1>${escapeLatexText(docTitle).replace(/\\&/g, '&').replace(/\\_/g, '_')}</h1>
              ${docSubtitle?.trim() ? `<p class="latex-sheet-subtitle">${escapeLatexText(docSubtitle).replace(/\\&/g, '&').replace(/\\_/g, '_')}</p>` : ''}
              <hr/>
            </div>`
          : ''
      }
      <div class="latex-sheet-content">
        ${previewRowsHtml.join('\n')}
      </div>
    </div>
  `;

  return { entryCommands, previewHtml };
}

/**
 * Wraps content entries into an individual subdocument file.
 * The format and layout declarations are centralized in the master document,
 * so subdocuments only contain clean content entries.
 */
function wrapIndividualFileContent(
  entryCommands: string[],
  fileName?: string
): string {
  const lines: string[] = [];
  if (fileName) {
    lines.push(`% Inhaltsdatei: ${fileName}`);
    lines.push(`% Formatierungs- und Layoutdeklarationen befinden sich im Gesamtdokument.`);
    lines.push(``);
  }
  lines.push(...entryCommands);
  return lines.join('\n');
}

/**
 * Generates the complete LaTeX export result:
 * 1. Übergeordnete Klammer-Datei (<baseSurname>_gesamt.tex) mit ausgelagerten Formatierungsoptionen
 * 2. Hauptdatei (<baseSurname>.tex)
 * 3. Ggf. Stamm-Dateien (<baseSurname>-<HenryID>.tex)
 */
export function generateLatexExport(
  persons: ExportPersonInput[],
  options: LatexExportOptions
): LatexExportResult {
  const personMap = new Map<string, ExportPersonInput>();
  for (const p of persons) {
    personMap.set(p.id, p);
  }

  const childrenByParent = new Map<string, string[]>();
  for (const p of persons) {
    for (const pid of p.parent_ids || []) {
      let list = childrenByParent.get(pid);
      if (!list) {
        list = [];
        childrenByParent.set(pid, list);
      }
      if (!list.includes(p.id)) {
        list.push(p.id);
      }
    }
  }

  const rootPerson = personMap.get(options.rootPersonId);
  if (!rootPerson) {
    return {
      baseSurname: 'Export',
      masterFileName: 'Export_gesamt.tex',
      files: [],
      totalEntries: 0,
      maxGenerationReached: 0,
      unknownBranchesStopped: 0,
      detectedGenerations: [],
      detectedBranchesAtSelectedGen: [],
    };
  }

  const baseSurname = sanitizeExportBaseName(
    rootPerson.surname || rootPerson.given_name || rootPerson.id,
    'Stammbaum'
  );
  const masterFileName = `${baseSurname}_gesamt.tex`;

  // Determine effective title and subtitle (subtitle is omitted if empty)
  const defaultTitle =
    options.mode === 'proband'
      ? (options.locale === 'en'
          ? `Descendants of ${getFullName(rootPerson)} [${options.startCode || '1'}]`
          : `Stammliste ${getFullName(rootPerson)} [${options.startCode || '1'}]`)
      : (options.direction === 'descendants'
          ? (options.locale === 'en'
              ? `Descendants of ${getFullName(rootPerson)}`
              : `Nachkommenliste ${getFullName(rootPerson)}`)
          : (options.locale === 'en'
              ? `Ancestors of ${getFullName(rootPerson)}`
              : `Ahnenliste ${getFullName(rootPerson)}`));

  const effectiveTitle = options.customDocumentTitle.trim() || defaultTitle;
  const effectiveSubtitle = options.customDocumentSubtitle.trim(); // Empty string if user left it blank

  // ==========================================================================
  // MODUS 1: DEFINIERTER PROBAND (Henry-Code + optionale Stämme)
  // ==========================================================================
  if (options.mode === 'proband') {
    const cleanStartCode = (options.startCode || '1').trim() || '1';

    // 1. Biological descendants
    const treeMembers = new Set<string>([rootPerson.id]);
    const memberQ: string[] = [rootPerson.id];
    while (memberQ.length > 0) {
      const currId = memberQ.shift()!;
      for (const cid of childrenByParent.get(currId) || []) {
        if (cid !== currId && !treeMembers.has(cid)) {
          treeMembers.add(cid);
          memberQ.push(cid);
        }
      }
    }

    // 2. Henry codes & parent-child map with Implex detection
    const henryMap = new Map<string, { code: string; generation: number }>();
    const treeChildrenMap = new Map<string, string[]>();
    const implexNoticeMap = new Map<string, string>();
    const visited = new Set<string>();
    const bfsQueue: { id: string; code: string; generation: number }[] = [
      { id: rootPerson.id, code: cleanStartCode, generation: 1 },
    ];

    while (bfsQueue.length > 0) {
      const { id: currId, code, generation } = bfsQueue.shift()!;
      if (visited.has(currId)) continue;
      visited.add(currId);
      henryMap.set(currId, { code, generation });

      const candidates = childrenByParent.get(currId) || [];
      const continuing: string[] = [];

      for (const cid of candidates) {
        if (cid === currId) continue;
        const cPerson = personMap.get(cid);
        if (!cPerson) continue;
        const { father, mother } = resolveFatherMother(cPerson, personMap);
        const fatherInTree = father ? treeMembers.has(father.id) : false;
        const motherInTree = mother ? treeMembers.has(mother.id) : false;

        let shouldContinue = false;
        if (fatherInTree) {
          shouldContinue = father!.id === currId;
          if (motherInTree && mother!.id === currId && father!.id !== currId) {
            implexNoticeMap.set(
              currId,
              options.locale === 'en'
                ? `Implex: child continues under father ${getFullName(father)}`
                : `Implex: Kinder weitergeführt bei Vater ${getFullName(father)}`
            );
          }
        } else if (motherInTree) {
          shouldContinue = mother!.id === currId;
        } else {
          shouldContinue = true;
        }

        if (shouldContinue && !visited.has(cid) && !continuing.includes(cid)) {
          continuing.push(cid);
        }
      }

      // Chronological sort by birth date
      continuing.sort((aId, bId) => {
        const kA = parseBirthSortKey(personMap.get(aId)?.birth_date);
        const kB = parseBirthSortKey(personMap.get(bId)?.birth_date);
        for (let i = 0; i < 3; i++) {
          if (kA[i] !== kB[i]) return kA[i] - kB[i];
        }
        return aId.localeCompare(bId);
      });

      treeChildrenMap.set(currId, continuing);

      for (let i = 0; i < continuing.length; i++) {
        bfsQueue.push({
          id: continuing[i],
          code: generateNextHenryCode(code, i + 1),
          generation: generation + 1,
        });
      }
    }

    // Subtree count
    const descendantCountMap = new Map<string, number>();
    function countDescendants(nodeId: string): number {
      const kids = treeChildrenMap.get(nodeId) || [];
      let count = 0;
      for (const kid of kids) {
        count += 1 + countDescendants(kid);
      }
      descendantCountMap.set(nodeId, count);
      return count;
    }
    countDescendants(rootPerson.id);

    // Generations summary
    const genBuckets = new Map<number, string[]>();
    let maxGenOverall = 1;
    henryMap.forEach((info, pid) => {
      if (info.generation > maxGenOverall) maxGenOverall = info.generation;
      if (!genBuckets.has(info.generation)) genBuckets.set(info.generation, []);
      genBuckets.get(info.generation)!.push(pid);
    });

    const detectedGenerations: GenerationSummary[] = [];
    for (let g = 1; g <= maxGenOverall; g++) {
      const pIds = genBuckets.get(g) || [];
      const withKids = pIds.filter(id => (treeChildrenMap.get(id)?.length || 0) > 0).length;
      detectedGenerations.push({
        generation: g,
        count: pIds.length,
        branchesWithChildrenCount: withKids,
      });
    }

    const targetSplitGen = Math.max(2, options.branchSplitGeneration || 2);
    const branchCandidatesIds = (genBuckets.get(targetSplitGen) || []).slice();
    branchCandidatesIds.sort((a, b) => {
      const cA = henryMap.get(a)?.code || '';
      const cB = henryMap.get(b)?.code || '';
      return compareHenryCodes(cA, cB);
    });

    const detectedBranchesAtSelectedGen: DetectedBranchInfo[] = branchCandidatesIds.map(pid => {
      const p = personMap.get(pid)!;
      const h = henryMap.get(pid)!;
      return {
        personId: pid,
        henryCode: h.code,
        name: getFullName(p, 'N.N.'),
        surname: p.surname || baseSurname,
        givenName: p.given_name || 'N.N.',
        birthDate: p.birth_date || '',
        deathDate: p.death_date || '',
        generation: h.generation,
        descendantCount: descendantCountMap.get(pid) || 0,
        fileName: `${baseSurname}-${h.code}.tex`,
      };
    });

    const activeSplitBranchIds = new Set<string>();
    if (options.enableBranchSplit && detectedBranchesAtSelectedGen.length > 0) {
      if (options.selectedBranchIds && options.selectedBranchIds.length > 0) {
        options.selectedBranchIds.forEach(id => activeSplitBranchIds.add(id));
      } else {
        detectedBranchesAtSelectedGen.forEach(b => activeSplitBranchIds.add(b.personId));
      }
    }

    // Traverse main tree
    const mainItems: InternalExportItem[] = [];
    let mainMaxGen = 1;

    function traverseProbandMain(currId: string, indentLevel: number) {
      const p = personMap.get(currId);
      const h = henryMap.get(currId);
      if (!p || !h) return;
      if (h.generation > mainMaxGen) mainMaxGen = h.generation;

      const kids = treeChildrenMap.get(currId) || [];
      const isSplitRoot = activeSplitBranchIds.has(currId);
      const hasImplex = implexNoticeMap.has(currId) || (p.spouses || []).some(s => henryMap.has(s.id));

      mainItems.push({
        indentLevel,
        generationNumber: h.generation,
        isUnknownPlaceholder: false,
        person: p,
        henryCode: h.code,
        orderCode: h.code,
        roleLabel:
          h.generation === 1
            ? (options.locale === 'en' ? 'Proband' : 'Proband / Stammahn')
            : undefined,
        childrenCount: kids.length,
        isImplex: hasImplex,
        implexNotice: implexNoticeMap.get(currId),
      });

      if (isSplitRoot) {
        // Stop here in main file; branch goes into its own file `<baseSurname>-<HenryCode>.tex`
        // NOTE: The note "Stamm wird geführt in Datei..." has been removed as requested!
        return;
      }

      for (const cid of kids) {
        traverseProbandMain(cid, indentLevel + 1);
      }
    }

    traverseProbandMain(rootPerson.id, 0);

    const mainFileContentObj = buildLatexContentAndPreview(
      mainItems,
      personMap,
      options,
      effectiveTitle,
      effectiveSubtitle,
      henryMap
    );

    const mainFileName = `${baseSurname}.tex`;
    const mainTexWrapped = wrapIndividualFileContent(
      mainFileContentObj.entryCommands,
      mainFileName
    );

    // Generate separate branch files if enabled
    const branchFiles: GeneratedLatexFile[] = [];
    const branchItemsByFile = new Map<string, InternalExportItem[]>();

    if (options.enableBranchSplit) {
      for (const bInfo of detectedBranchesAtSelectedGen) {
        if (!activeSplitBranchIds.has(bInfo.personId)) continue;

        const branchItems: InternalExportItem[] = [];
        let branchMaxGen = bInfo.generation;

        function traverseBranch(currId: string, indentLevel: number) {
          const p = personMap.get(currId);
          const h = henryMap.get(currId);
          if (!p || !h) return;
          if (h.generation > branchMaxGen) branchMaxGen = h.generation;
          const kids = treeChildrenMap.get(currId) || [];
          const hasImplex = implexNoticeMap.has(currId) || (p.spouses || []).some(s => henryMap.has(s.id));

          branchItems.push({
            indentLevel,
            generationNumber: h.generation,
            isUnknownPlaceholder: false,
            person: p,
            henryCode: h.code,
            orderCode: h.code,
            roleLabel:
              currId === bInfo.personId
                ? (options.locale === 'en' ? `Branch Root` : `Stammherr / Stammmutter`)
                : undefined,
            childrenCount: kids.length,
            isImplex: hasImplex,
            implexNotice: implexNoticeMap.get(currId),
          });

          for (const cid of kids) {
            traverseBranch(cid, indentLevel + 1);
          }
        }

        traverseBranch(bInfo.personId, 0);
        branchItemsByFile.set(bInfo.fileName, branchItems);

        const bTitle =
          options.locale === 'en'
            ? `Branch [${bInfo.henryCode}] — ${bInfo.name}`
            : `Stamm [${bInfo.henryCode}] — ${bInfo.name}`;
        const bSubtitle = effectiveSubtitle
          ? `${effectiveSubtitle} (Gen. ${bInfo.generation})`
          : '';

        const bContentObj = buildLatexContentAndPreview(
          branchItems,
          personMap,
          options,
          bTitle,
          bSubtitle,
          henryMap
        );

        const bTexWrapped = wrapIndividualFileContent(
          bContentObj.entryCommands,
          bInfo.fileName
        );

        branchFiles.push({
          fileName: bInfo.fileName,
          label: `[${bInfo.henryCode}] ${bInfo.name}`,
          isMasterFile: false,
          isMainFile: false,
          branchHenryCode: bInfo.henryCode,
          branchPersonName: bInfo.name,
          entryCount: branchItems.length,
          maxGeneration: branchMaxGen,
          texContent: bTexWrapped,
          previewHtml: bContentObj.previewHtml,
        });
      }
    }

    // Subdokumente (Stamm-Dateien) strikt nach Henry-ID sortieren
    branchFiles.sort((a, b) => compareHenryCodes(a.branchHenryCode || '', b.branchHenryCode || ''));

    // Build the Übergeordnete Klammer-Datei (Master File)
    const masterPreamble = generateMasterPreamble(options, effectiveTitle, effectiveSubtitle);
    const masterLines: string[] = [];
    masterLines.push(masterPreamble);
    masterLines.push(`% --- Einbindung der Hauptinhaltsdatei ---`);
    masterLines.push(`\\input{${baseSurname}}`);
    if (branchFiles.length > 0) {
      masterLines.push(``);
      masterLines.push(`% --- Einbindung der ausgelagerten Stamm-Dateien (sortiert nach Henry-ID) ---`);
      for (const bf of branchFiles) {
        const cleanStem = bf.fileName.replace(/\.tex$/i, '');
        masterLines.push(`\\input{${cleanStem}}`);
      }
    }
    masterLines.push(``);
    masterLines.push(`\\end{document}`);

    // Combined visual preview for the master file
    const masterCombinedItems = [...mainItems];
    for (const bf of branchFiles) {
      const bItems = branchItemsByFile.get(bf.fileName) || [];
      masterCombinedItems.push(...bItems);
    }
    const masterCombinedPreview = buildLatexContentAndPreview(
      masterCombinedItems,
      personMap,
      options,
      effectiveTitle,
      effectiveSubtitle,
      henryMap
    ).previewHtml;

    const masterFileObj: GeneratedLatexFile = {
      fileName: masterFileName,
      label:
        options.locale === 'en'
          ? `Master File (${masterFileName})`
          : `Klammer-Datei (${masterFileName})`,
      isMasterFile: true,
      isMainFile: false,
      entryCount: henryMap.size,
      maxGeneration: maxGenOverall,
      texContent: masterLines.join('\n'),
      previewHtml: masterCombinedPreview,
    };

    const mainFileObj: GeneratedLatexFile = {
      fileName: mainFileName,
      label:
        options.locale === 'en'
          ? `Main File (${mainFileName})`
          : `Hauptdatei (${mainFileName})`,
      isMasterFile: false,
      isMainFile: true,
      entryCount: mainItems.length,
      maxGeneration: mainMaxGen,
      texContent: mainTexWrapped,
      previewHtml: mainFileContentObj.previewHtml,
    };

    const files = [masterFileObj, mainFileObj, ...branchFiles];

    return {
      baseSurname,
      masterFileName,
      files,
      totalEntries: henryMap.size,
      maxGenerationReached: maxGenOverall,
      unknownBranchesStopped: 0,
      detectedGenerations,
      detectedBranchesAtSelectedGen,
    };
  }

  // ==========================================================================
  // MODUS 2: BELIEBIGER EINTRAG (Nachkommen oder Vorfahren)
  // ==========================================================================
  const maxGenLimit = Math.max(1, Math.min(30, options.maxGenerations || 5));

  if (options.direction === 'descendants') {
    // Nachkommen ohne eigenen Henry-Code, chronologisch sortiert, eingerückt je Generationsstufe
    const items: InternalExportItem[] = [];
    const visited = new Set<string>();
    let maxGenReached = 1;

    function traverseCustomDescendants(
      currId: string,
      indentLevel: number,
      genNumber: number,
      orderPath: string
    ) {
      if (visited.has(currId)) return;
      visited.add(currId);

      const p = personMap.get(currId);
      if (!p) return;
      if (genNumber > maxGenReached) maxGenReached = genNumber;

      const rawKids = (childrenByParent.get(currId) || []).filter(
        cid => cid !== currId && personMap.has(cid)
      );
      rawKids.sort((aId, bId) => {
        const kA = parseBirthSortKey(personMap.get(aId)?.birth_date);
        const kB = parseBirthSortKey(personMap.get(bId)?.birth_date);
        for (let i = 0; i < 3; i++) {
          if (kA[i] !== kB[i]) return kA[i] - kB[i];
        }
        return aId.localeCompare(bId);
      });

      items.push({
        indentLevel,
        generationNumber: genNumber,
        isUnknownPlaceholder: false,
        person: p,
        henryCode: '', // Explicit: no Henry code in arbitrary mode
        orderCode: orderPath,
        roleLabel:
          genNumber === 1
            ? (options.locale === 'en' ? 'Starting Entry' : 'Ausgangsperson')
            : undefined,
        childrenCount: rawKids.length,
      });

      if (genNumber >= maxGenLimit) {
        return;
      }

      rawKids.forEach((cid, idx) => {
        const nextOrder = orderPath ? `${orderPath}.${idx + 1}` : String(idx + 1);
        traverseCustomDescendants(cid, indentLevel + 1, genNumber + 1, nextOrder);
      });
    }

    traverseCustomDescendants(rootPerson.id, 0, 1, '1');

    const contentObj = buildLatexContentAndPreview(
      items,
      personMap,
      options,
      effectiveTitle,
      effectiveSubtitle
    );

    const mainTexWrapped = wrapIndividualFileContent(
      contentObj.entryCommands,
      `${baseSurname}.tex`
    );

    // Master Klammer-Datei
    const masterPreamble = generateMasterPreamble(options, effectiveTitle, effectiveSubtitle);
    const masterTex = `${masterPreamble}\n% --- Einbindung der Inhaltsdatei ---\n\\input{${baseSurname}}\n\n\\end{document}`;

    const masterFileObj: GeneratedLatexFile = {
      fileName: masterFileName,
      label:
        options.locale === 'en'
          ? `Master File (${masterFileName})`
          : `Klammer-Datei (${masterFileName})`,
      isMasterFile: true,
      isMainFile: false,
      entryCount: items.length,
      maxGeneration: maxGenReached,
      texContent: masterTex,
      previewHtml: contentObj.previewHtml,
    };

    const mainFileObj: GeneratedLatexFile = {
      fileName: `${baseSurname}.tex`,
      label: `${baseSurname}.tex`,
      isMasterFile: false,
      isMainFile: true,
      entryCount: items.length,
      maxGeneration: maxGenReached,
      texContent: mainTexWrapped,
      previewHtml: contentObj.previewHtml,
    };

    return {
      baseSurname,
      masterFileName,
      files: [masterFileObj, mainFileObj],
      totalEntries: items.length,
      maxGenerationReached: maxGenReached,
      unknownBranchesStopped: 0,
      detectedGenerations: [],
      detectedBranchesAtSelectedGen: [],
    };
  } else {
    // Vorfahren (Ahnenliste mit Zweigabbruch bei Unbekannt)
    const items: InternalExportItem[] = [];
    let maxGenReached = 1;
    let unknownBranchesStopped = 0;

    if (options.ancestorSortPattern === 'generation_kekule') {
      interface AncQueueNode {
        person: ExportPersonInput | null;
        isMother: boolean;
        genOffset: number;
        kekuleId: number;
      }
      const queue: AncQueueNode[] = [
        { person: rootPerson, isMother: rootPerson.sex === 'F', genOffset: 0, kekuleId: 1 },
      ];

      while (queue.length > 0) {
        const curr = queue.shift()!;
        const genNum = curr.genOffset + 1;
        if (genNum > maxGenReached) maxGenReached = genNum;

        if (!curr.person) {
          unknownBranchesStopped++;
          items.push({
            indentLevel: curr.genOffset,
            generationNumber: genNum,
            isUnknownPlaceholder: true,
            unknownText: resolveUnknownParentText(curr.isMother, curr.genOffset, options),
            kekuleId: curr.kekuleId,
            childrenCount: 0,
          });
          continue;
        }

        const p = curr.person;
        const isFem = p.sex === 'F';
        items.push({
          indentLevel: curr.genOffset,
          generationNumber: genNum,
          isUnknownPlaceholder: false,
          person: p,
          henryCode: '',
          kekuleId: curr.kekuleId,
          orderCode: String(curr.kekuleId),
          roleLabel: getAncestorRoleLabel(curr.genOffset, isFem, options.locale),
          childrenCount: (childrenByParent.get(p.id) || []).length,
        });

        if (genNum < maxGenLimit) {
          const { father, mother } = resolveFatherMother(p, personMap);
          queue.push({
            person: father || null,
            isMother: false,
            genOffset: curr.genOffset + 1,
            kekuleId: curr.kekuleId * 2,
          });
          queue.push({
            person: mother || null,
            isMother: true,
            genOffset: curr.genOffset + 1,
            kekuleId: curr.kekuleId * 2 + 1,
          });
        }
      }
    } else {
      const visitedAnc = new Set<string>();

      function traverseAncestorsRecursive(
        person: ExportPersonInput | undefined,
        isMother: boolean,
        genOffset: number,
        kekuleId: number
      ) {
        const genNum = genOffset + 1;
        if (genNum > maxGenReached) maxGenReached = genNum;

        if (!person) {
          unknownBranchesStopped++;
          items.push({
            indentLevel: genOffset,
            generationNumber: genNum,
            isUnknownPlaceholder: true,
            unknownText: resolveUnknownParentText(isMother, genOffset, options),
            kekuleId,
            childrenCount: 0,
          });
          return;
        }

        const isFem = person.sex === 'F';
        items.push({
          indentLevel: genOffset,
          generationNumber: genNum,
          isUnknownPlaceholder: false,
          person,
          henryCode: '',
          kekuleId,
          orderCode: String(kekuleId),
          roleLabel: getAncestorRoleLabel(genOffset, isFem, options.locale),
          childrenCount: (childrenByParent.get(person.id) || []).length,
        });

        if (genNum >= maxGenLimit) {
          return;
        }

        if (visitedAnc.has(person.id)) {
          return;
        }
        visitedAnc.add(person.id);

        const { father, mother } = resolveFatherMother(person, personMap);
        if (options.ancestorSortPattern === 'matrilineal_recursive') {
          traverseAncestorsRecursive(mother, true, genOffset + 1, kekuleId * 2 + 1);
          traverseAncestorsRecursive(father, false, genOffset + 1, kekuleId * 2);
        } else {
          // Default: Kekulé patrilinear (Vater vor Mutter)
          traverseAncestorsRecursive(father, false, genOffset + 1, kekuleId * 2);
          traverseAncestorsRecursive(mother, true, genOffset + 1, kekuleId * 2 + 1);
        }

        visitedAnc.delete(person.id);
      }

      traverseAncestorsRecursive(rootPerson, rootPerson.sex === 'F', 0, 1);
    }

    const contentObj = buildLatexContentAndPreview(
      items,
      personMap,
      options,
      effectiveTitle,
      effectiveSubtitle
    );

    const mainTexWrapped = wrapIndividualFileContent(
      contentObj.entryCommands,
      `${baseSurname}.tex`
    );

    const masterPreamble = generateMasterPreamble(options, effectiveTitle, effectiveSubtitle);
    const masterTex = `${masterPreamble}\n% --- Einbindung der Inhaltsdatei ---\n\\input{${baseSurname}}\n\n\\end{document}`;

    const masterFileObj: GeneratedLatexFile = {
      fileName: masterFileName,
      label:
        options.locale === 'en'
          ? `Master File (${masterFileName})`
          : `Klammer-Datei (${masterFileName})`,
      isMasterFile: true,
      isMainFile: false,
      entryCount: items.length,
      maxGeneration: maxGenReached,
      texContent: masterTex,
      previewHtml: contentObj.previewHtml,
    };

    const mainFileObj: GeneratedLatexFile = {
      fileName: `${baseSurname}.tex`,
      label: `${baseSurname}.tex`,
      isMasterFile: false,
      isMainFile: true,
      entryCount: items.length,
      maxGeneration: maxGenReached,
      texContent: mainTexWrapped,
      previewHtml: contentObj.previewHtml,
    };

    return {
      baseSurname,
      masterFileName,
      files: [masterFileObj, mainFileObj],
      totalEntries: items.length,
      maxGenerationReached: maxGenReached,
      unknownBranchesStopped,
      detectedGenerations: [],
      detectedBranchesAtSelectedGen: [],
    };
  }
}

/**
 * Erzeugt eine schlanke, reine Formatierungs-Vorschau mit generischen Beispieldaten
 * (ohne jeglichen Bezug zu realen Personendaten oder Familienkontext).
 * Zeigt über 3 Generationen typografische Einzüge, Namens- und Lebensdaten,
 * einfache und mehrfache Ehen, Scheidung sowie Kindstatus.
 */
export function generateSampleLatexPreview(
  template: LatexTemplateConfig,
  locale: 'de' | 'en'
): { previewHtml: string; texContent: string; entryCount: number } {
  const isEn = locale === 'en';

  const samplePersons: ExportPersonInput[] = [
    // Generation 1: Proband
    {
      id: 'sample-p1',
      given_name: isEn ? 'John' : 'Max',
      surname: isEn ? 'Sample' : 'Mustermann',
      sex: 'm',
      birth_date: '15.03.1890',
      birth_place: isEn ? 'Sampletown' : 'Musterstadt',
      death_date: '10.04.1965',
      death_place: isEn ? 'Example City' : 'Beispielort',
      gedcom_extra: {
        CHR: { DATE: '22.03.1890', PLAC: isEn ? 'Sampletown' : 'Musterstadt' },
        OCCU: { _val: isEn ? 'Architect' : 'Musterberuf' },
        RELI: { _val: isEn ? 'Anglican' : 'ev.' },
        RESI: { PLAC: isEn ? 'Sampletown' : 'Musterstadt' },
        NOTE: {
          _val: isEn
            ? 'Sample footnote demonstrating formatting and notes'
            : 'Beispielhafte Fußnote zur Demonstration von Masken und Formatierung',
        },
      },
      parent_ids: [],
      spouses: [
        {
          id: 'sample-sp1',
          date: '24.08.1915',
          place: isEn ? 'Sampletown' : 'Musterstadt',
          divorce_date: null,
          is_divorced: false,
        },
      ],
    },
    // Partner von Generation 1
    {
      id: 'sample-sp1',
      given_name: isEn ? 'Jane' : 'Erika',
      surname: isEn ? 'Sample (née Smith)' : 'Musterfrau',
      sex: 'f',
      birth_date: '12.06.1893',
      birth_place: isEn ? 'Sampletown' : 'Musterstadt',
      death_date: '05.02.1970',
      death_place: isEn ? 'Example City' : 'Beispielort',
      gedcom_extra: {},
      parent_ids: [],
      spouses: [],
    },

    // Generation 2: Sohn mit Partner
    {
      id: 'sample-p2',
      given_name: 'Alexander',
      surname: isEn ? 'Sample' : 'Mustermann',
      sex: 'm',
      birth_date: '14.05.1918',
      birth_place: isEn ? 'Sampletown' : 'Musterstadt',
      death_date: '22.11.1984',
      death_place: isEn ? 'Sampletown' : 'Musterstadt',
      gedcom_extra: {
        CHR: { DATE: '20.05.1918', PLAC: isEn ? 'Sampletown' : 'Musterstadt' },
        OCCU: { _val: isEn ? 'Civil Engineer' : 'Ingenieur' },
        RELI: { _val: 'ev.' },
        RESI: { PLAC: isEn ? 'Sampletown' : 'Musterstadt' },
      },
      parent_ids: ['sample-p1', 'sample-sp1'],
      spouses: [
        {
          id: 'sample-sp2',
          date: '12.06.1942',
          place: isEn ? 'Example City' : 'Beispielort',
          divorce_date: null,
          is_divorced: false,
        },
      ],
    },
    // Partner von Kind 1
    {
      id: 'sample-sp2',
      given_name: 'Sophie',
      surname: isEn ? 'Miller' : 'Beispiel',
      sex: 'f',
      birth_date: '18.09.1920',
      birth_place: isEn ? 'Example City' : 'Beispielort',
      death_date: '30.07.1995',
      death_place: isEn ? 'Example City' : 'Beispielort',
      gedcom_extra: {},
      parent_ids: [],
      spouses: [],
    },

    // Generation 2: Tochter mit Mehrfachehe und Scheidung
    {
      id: 'sample-p3',
      given_name: 'Clara',
      surname: isEn ? 'Sample' : 'Mustermann',
      sex: 'f',
      birth_date: '08.09.1922',
      birth_place: isEn ? 'Sampletown' : 'Musterstadt',
      death_date: '17.01.2005',
      death_place: isEn ? 'Sampletown' : 'Musterstadt',
      gedcom_extra: {},
      parent_ids: ['sample-p1', 'sample-sp1'],
      spouses: [
        {
          id: 'sample-sp3a',
          date: '10.05.1946',
          place: isEn ? 'Sampletown' : 'Musterstadt',
          divorce_date: '15.08.1952',
          is_divorced: true,
        },
        {
          id: 'sample-sp3b',
          date: '03.04.1955',
          place: isEn ? 'Example City' : 'Beispielort',
          divorce_date: null,
          is_divorced: false,
        },
      ],
    },
    // Partner 1 von Kind 2 (geschieden)
    {
      id: 'sample-sp3a',
      given_name: 'Martin',
      surname: isEn ? 'Walker' : 'Probe',
      sex: 'm',
      birth_date: '19.01.1920',
      birth_place: isEn ? 'Sampletown' : 'Musterstadt',
      death_date: null,
      death_place: null,
      gedcom_extra: {},
      parent_ids: [],
      spouses: [],
    },
    // Partner 2 von Kind 2
    {
      id: 'sample-sp3b',
      given_name: isEn ? 'William' : 'Wilhelm',
      surname: isEn ? 'Taylor' : 'Testmann',
      sex: 'm',
      birth_date: '28.07.1919',
      birth_place: isEn ? 'Example City' : 'Beispielort',
      death_date: '14.12.1988',
      death_place: isEn ? 'Example City' : 'Beispielort',
      gedcom_extra: {},
      parent_ids: [],
      spouses: [],
    },

    // Generation 3: Enkelkind
    {
      id: 'sample-p4',
      given_name: 'Felix',
      surname: isEn ? 'Sample' : 'Mustermann',
      sex: 'm',
      birth_date: '03.02.1945',
      birth_place: isEn ? 'Example City' : 'Beispielort',
      death_date: null,
      death_place: null,
      gedcom_extra: {},
      parent_ids: ['sample-p2', 'sample-sp2'],
      spouses: [],
    },
  ];

  const docTitle = isEn
    ? 'Formatting & Layout Preview (Sample Data)'
    : 'Formatierungs- & Layout-Vorschau (Beispieldaten)';
  const docSubtitle = isEn
    ? 'Generic sample records for testing indentation, text masks, and variables'
    : 'Generische Beispieldaten zur Prüfung von Einzügen, Textmasken und Variablen';

  const exportResult = generateLatexExport(samplePersons, {
    mode: 'proband',
    rootPersonId: 'sample-p1',
    startCode: '1',
    direction: 'descendants',
    maxGenerations: 4,
    ancestorSortPattern: 'kekule_patrilineal',
    unknownParentPreset: 'classic',
    customUnknownFatherText: '',
    customUnknownMotherText: '',
    enableBranchSplit: false,
    branchSplitGeneration: 2,
    selectedBranchIds: [],
    includeBranchInputsInMain: true,
    customDocumentTitle: docTitle,
    customDocumentSubtitle: docSubtitle,
    template,
    locale,
  });

  const previewHtml = exportResult.files[0]?.previewHtml || '';
  const texContent = exportResult.files[0]?.texContent || '';

  return {
    previewHtml,
    texContent,
    entryCount: 4,
  };
}
