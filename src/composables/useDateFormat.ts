import { computed, ref } from 'vue';
import i18n from '../i18n';

export type DateFormatOption =
  | 'locale'
  | 'dd.mm.yyyy'
  | 'yyyy-mm-dd'
  | 'dd/mm/yyyy'
  | 'mm/dd/yyyy'
  | 'dd_mmm_yyyy'
  | 'gedcom';

export type ConcreteDateFormat = Exclude<DateFormatOption, 'locale'>;

export const DATE_FORMAT_STORAGE_KEY = 'lineagegraph_date_format';

const VALID_FORMATS: ReadonlySet<string> = new Set([
  'locale',
  'dd.mm.yyyy',
  'yyyy-mm-dd',
  'dd/mm/yyyy',
  'mm/dd/yyyy',
  'dd_mmm_yyyy',
  'gedcom',
]);

function loadInitialDateFormat(): DateFormatOption {
  try {
    const saved = localStorage.getItem(DATE_FORMAT_STORAGE_KEY);
    if (saved && VALID_FORMATS.has(saved)) {
      return saved as DateFormatOption;
    }
  } catch {
    // ignore storage errors
  }
  return 'locale';
}

const dateFormatState = ref<DateFormatOption>(loadInitialDateFormat());

export function resolveEffectiveFormat(
  option: DateFormatOption,
  localeCode: string
): ConcreteDateFormat {
  if (option !== 'locale') return option;
  const lang = (localeCode || 'de').toLowerCase().split('-')[0];
  switch (lang) {
    case 'en':
      return 'mm/dd/yyyy';
    case 'fr':
    case 'pt':
      return 'dd/mm/yyyy';
    case 'de':
    default:
      return 'dd.mm.yyyy';
  }
}

const GEDCOM_MONTHS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
] as const;

const LOCALIZED_MONTHS: Record<string, readonly string[]> = {
  de: ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sept.', 'Okt.', 'Nov.', 'Dez.'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  fr: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'],
  pt: ['jan.', 'fev.', 'mar.', 'abr.', 'mai.', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.'],
};

const MONTH_INPUT_MAP: Record<string, number> = {
  JAN: 1, JANUAR: 1, JANUARY: 1, JANVIER: 1, JANEIRO: 1,
  FEB: 2, FEBRUAR: 2, FEBRUARY: 2, FEV: 2, FÉV: 2, FEVR: 2, FÉVR: 2, FEVRIER: 2, FÉVRIER: 2, FEVEREIRO: 2,
  MAR: 3, MÄR: 3, MRZ: 3, MAER: 3, MAERZ: 3, MÄRZ: 3, MARCH: 3, MARS: 3, MARÇO: 3, MARCO: 3,
  APR: 4, APRIL: 4, AVR: 4, AVRIL: 4, ABR: 4, ABRIL: 4,
  MAY: 5, MAI: 5, MAIO: 5,
  JUN: 6, JUNI: 6, JUNE: 6, JUIN: 6, JUNHO: 6,
  JUL: 7, JULI: 7, JULY: 7, JUIL: 7, JUILLET: 7, JULHO: 7,
  AUG: 8, AUGUST: 8, AOÛ: 8, AOU: 8, AOÛT: 8, AOUT: 8, AGO: 8, AGOSTO: 8,
  SEP: 9, SEPT: 9, SEPTEMBER: 9, SEPTEMBRE: 9, SET: 9, SETEMBRO: 9,
  OCT: 10, OKT: 10, OKTOBER: 10, OCTOBER: 10, OCTOBRE: 10, OUT: 10, OUTUBRO: 10,
  NOV: 11, NOVEMBER: 11, NOVEMBRE: 11, NOVEMBRO: 11,
  DEC: 12, DEZ: 12, DEZEMBER: 12, DECEMBER: 12, DÉC: 12, DECEMBRE: 12, DÉCEMBRE: 12, DEZEMBRO: 12,
};

interface SimpleDate {
  year: number;
  month: number | null;
  day: number | null;
}

type DateExpr =
  | { kind: 'exact'; date: SimpleDate }
  | { kind: 'single'; qualifier: 'BEF' | 'AFT' | 'ABT' | 'CAL' | 'EST' | 'FROM' | 'TO'; date: SimpleDate }
  | { kind: 'between'; start: SimpleDate; end: SimpleDate }
  | { kind: 'period'; start: SimpleDate; end: SimpleDate }
  | { kind: 'interpreted'; date: SimpleDate; phrase: string }
  | { kind: 'phrase'; text: string };

const QUALIFIER_DISPLAY: Record<string, Record<string, string>> = {
  BEF: { de: 'vor', en: 'before', fr: 'avant', pt: 'antes de' },
  AFT: { de: 'nach', en: 'after', fr: 'après', pt: 'depois de' },
  ABT: { de: 'ca.', en: 'abt.', fr: 'env.', pt: 'cerca de' },
  CAL: { de: 'ber.', en: 'cal.', fr: 'calc.', pt: 'calc.' },
  EST: { de: 'gesch.', en: 'est.', fr: 'est.', pt: 'est.' },
  FROM: { de: 'ab', en: 'from', fr: 'depuis', pt: 'desde' },
  TO: { de: 'bis', en: 'to', fr: "jusqu'à", pt: 'até' },
  BET_START: { de: 'zwischen', en: 'between', fr: 'entre', pt: 'entre' },
  BET_MID: { de: 'und', en: 'and', fr: 'et', pt: 'e' },
  PERIOD_START: { de: 'von', en: 'from', fr: 'de', pt: 'de' },
  PERIOD_MID: { de: 'bis', en: 'to', fr: 'à', pt: 'até' },
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function parseSimpleDate(raw: string, preferMonthFirst: boolean): SimpleDate | null {
  const s = raw.trim();
  if (!s) return null;

  // ISO: YYYY-MM-DD or YYYY-MM
  const isoFull = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoFull) {
    const year = parseInt(isoFull[1], 10);
    const month = parseInt(isoFull[2], 10);
    const day = parseInt(isoFull[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return { year, month, day };
    }
  }
  const isoMonth = s.match(/^(\d{4})-(\d{1,2})$/);
  if (isoMonth) {
    const year = parseInt(isoMonth[1], 10);
    const month = parseInt(isoMonth[2], 10);
    if (month >= 1 && month <= 12) {
      return { year, month, day: null };
    }
  }

  // Dot-separated: DD.MM.YYYY or MM.YYYY
  const dotFull = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{3,4})$/);
  if (dotFull) {
    const day = parseInt(dotFull[1], 10);
    const month = parseInt(dotFull[2], 10);
    const year = parseInt(dotFull[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return { year, month, day };
    }
  }
  const dotMonth = s.match(/^(\d{1,2})\.(\d{3,4})$/);
  if (dotMonth) {
    const month = parseInt(dotMonth[1], 10);
    const year = parseInt(dotMonth[2], 10);
    if (month >= 1 && month <= 12) {
      return { year, month, day: null };
    }
  }

  // Slash-separated: YYYY/MM/DD, DD/MM/YYYY, MM/DD/YYYY, MM/YYYY
  const slashIso = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (slashIso) {
    const year = parseInt(slashIso[1], 10);
    const month = parseInt(slashIso[2], 10);
    const day = parseInt(slashIso[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return { year, month, day };
    }
  }
  const slashFull = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{3,4})$/);
  if (slashFull) {
    const a = parseInt(slashFull[1], 10);
    const b = parseInt(slashFull[2], 10);
    const year = parseInt(slashFull[3], 10);
    if (b > 12 && a >= 1 && a <= 12 && b <= 31) {
      return { year, month: a, day: b };
    }
    if (a > 12 && b >= 1 && b <= 12 && a <= 31) {
      return { year, month: b, day: a };
    }
    if (preferMonthFirst && a >= 1 && a <= 12 && b >= 1 && b <= 31) {
      return { year, month: a, day: b };
    }
    if (b >= 1 && b <= 12 && a >= 1 && a <= 31) {
      return { year, month: b, day: a };
    }
  }
  const slashMonth = s.match(/^(\d{1,2})\/(\d{3,4})$/);
  if (slashMonth) {
    const month = parseInt(slashMonth[1], 10);
    const year = parseInt(slashMonth[2], 10);
    if (month >= 1 && month <= 12) {
      return { year, month, day: null };
    }
  }

  // Space-separated: DD MMM YYYY, DD. MMM YYYY, MMM YYYY, YYYY
  const tokens = s
    .split(/\s+/)
    .map(t => t.replace(/[.,]+$/, ''))
    .filter(Boolean);

  if (tokens.length === 1 && /^\d{3,4}$/.test(tokens[0])) {
    return { year: parseInt(tokens[0], 10), month: null, day: null };
  }
  if (tokens.length === 2 && /^\d{3,4}$/.test(tokens[1])) {
    const m = MONTH_INPUT_MAP[tokens[0].toUpperCase()];
    if (m) {
      return { year: parseInt(tokens[1], 10), month: m, day: null };
    }
  }
  if (tokens.length === 3 && /^\d{1,2}$/.test(tokens[0]) && /^\d{3,4}$/.test(tokens[2])) {
    const day = parseInt(tokens[0], 10);
    const m = MONTH_INPUT_MAP[tokens[1].toUpperCase()];
    const year = parseInt(tokens[2], 10);
    if (m && day >= 1 && day <= 31) {
      return { year, month: m, day };
    }
  }

  return null;
}

function stripPrefixCI(s: string, prefixes: string[]): string | null {
  const lower = s.toLowerCase();
  for (const p of prefixes) {
    if (lower.startsWith(p)) {
      const rest = s.slice(p.length);
      if (rest.length === 0 || /^\s/.test(rest)) {
        const trimmed = rest.trim();
        if (trimmed) return trimmed;
      }
    }
  }
  return null;
}

function splitPairKeyword(s: string, keywords: string[]): [string, string] | null {
  const lower = s.toLowerCase();
  for (const kw of keywords) {
    const pat = ` ${kw} `;
    const idx = lower.indexOf(pat);
    if (idx > 0) {
      const left = s.slice(0, idx).trim();
      const right = s.slice(idx + pat.length).trim();
      if (left && right) return [left, right];
    }
  }
  return null;
}

function parseDateExpr(raw: string, preferMonthFirst: boolean): DateExpr | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('(') && trimmed.endsWith(')') && trimmed.length >= 2) {
    return { kind: 'phrase', text: trimmed.slice(1, -1).trim() };
  }

  const intRest = stripPrefixCI(trimmed, ['int']);
  if (intRest) {
    const pIdx = intRest.indexOf('(');
    if (pIdx > 0 && intRest.endsWith(')')) {
      const dPart = intRest.slice(0, pIdx).trim();
      const phrase = intRest.slice(pIdx + 1, -1).trim();
      const d = parseSimpleDate(dPart, preferMonthFirst);
      if (d) return { kind: 'interpreted', date: d, phrase };
    }
  }

  const betRest = stripPrefixCI(trimmed, ['bet', 'between', 'zwischen', 'zw.', 'zw', 'entre']);
  if (betRest) {
    const pair = splitPairKeyword(betRest, ['and', 'und', 'et', 'e']);
    if (pair) {
      const d1 = parseSimpleDate(pair[0], preferMonthFirst);
      const d2 = parseSimpleDate(pair[1], preferMonthFirst);
      if (d1 && d2) return { kind: 'between', start: d1, end: d2 };
    }
  }

  const fromToRest = stripPrefixCI(trimmed, ['from', 'von', 'de', 'desde']);
  if (fromToRest) {
    const pair = splitPairKeyword(fromToRest, ['to', 'bis', 'à', 'a', 'até', 'ate']);
    if (pair) {
      const d1 = parseSimpleDate(pair[0], preferMonthFirst);
      const d2 = parseSimpleDate(pair[1], preferMonthFirst);
      if (d1 && d2) return { kind: 'period', start: d1, end: d2 };
    }
  }

  const singlePrefixes: Array<['BEF' | 'AFT' | 'ABT' | 'CAL' | 'EST' | 'FROM' | 'TO', string[]]> = [
    ['BEF', ['bef', 'before', 'vor']],
    ['AFT', ['aft', 'after', 'nach', 'après', 'apres', 'depois de', 'depois']],
    ['ABT', ['abt', 'about', 'ca.', 'ca', 'cir.', 'cir', 'circa', 'um', 'etwa', 'ungefähr', 'ungefahr', 'approx.', 'approx', 'env.', 'environ', 'cerca de']],
    ['CAL', ['cal', 'calculated', 'ber.', 'berechnet', 'calculé', 'calcule', 'calculado']],
    ['EST', ['est', 'estimated', 'gesch.', 'geschätzt', 'geschatzt', 'estimé', 'estime', 'estimado']],
    ['FROM', ['from', 'ab', 'von', 'depuis', 'desde']],
    ['TO', ['to', 'bis', "jusqu'à", "jusqu'a", 'até', 'ate']],
  ];

  for (const [qual, prefixes] of singlePrefixes) {
    const rest = stripPrefixCI(trimmed, prefixes);
    if (rest) {
      const d = parseSimpleDate(rest, preferMonthFirst);
      if (d) return { kind: 'single', qualifier: qual, date: d };
    }
  }

  const exact = parseSimpleDate(trimmed, preferMonthFirst);
  if (exact) return { kind: 'exact', date: exact };

  return null;
}

function formatSimpleDateForDisplay(
  d: SimpleDate,
  format: ConcreteDateFormat,
  lang: string
): string {
  const { year, month, day } = d;
  if (!month) return `${year}`;

  switch (format) {
    case 'dd.mm.yyyy':
      return day ? `${pad2(day)}.${pad2(month)}.${year}` : `${pad2(month)}.${year}`;
    case 'yyyy-mm-dd':
      return day ? `${year}-${pad2(month)}-${pad2(day)}` : `${year}-${pad2(month)}`;
    case 'dd/mm/yyyy':
      return day ? `${pad2(day)}/${pad2(month)}/${year}` : `${pad2(month)}/${year}`;
    case 'mm/dd/yyyy':
      return day ? `${pad2(month)}/${pad2(day)}/${year}` : `${pad2(month)}/${year}`;
    case 'dd_mmm_yyyy': {
      const months = LOCALIZED_MONTHS[lang] ?? LOCALIZED_MONTHS.en;
      const mLabel = months[month - 1];
      if (!day) return `${mLabel} ${year}`;
      return lang === 'de' ? `${day}. ${mLabel} ${year}` : `${day} ${mLabel} ${year}`;
    }
    case 'gedcom': {
      const mGed = GEDCOM_MONTHS[month - 1];
      return day ? `${day} ${mGed} ${year}` : `${mGed} ${year}`;
    }
  }
}

function formatSimpleDateToGedcom(d: SimpleDate): string {
  if (d.day && d.month) {
    return `${d.day} ${GEDCOM_MONTHS[d.month - 1]} ${d.year}`;
  }
  if (d.month) {
    return `${GEDCOM_MONTHS[d.month - 1]} ${d.year}`;
  }
  return `${d.year}`;
}

/**
 * Formats any stored date string (GEDCOM, ISO, German, etc.) for display in the GUI
 * using the configured date format and active locale.
 */
export function formatDisplayDate(
  raw: string | null | undefined,
  formatOverride?: DateFormatOption,
  localeOverride?: string
): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return '';

  const activeLocale = (localeOverride || i18n.global.locale.value || 'de').toLowerCase().split('-')[0];
  const option = formatOverride ?? dateFormatState.value;
  const effective = resolveEffectiveFormat(option, activeLocale);

  // When parsing stored values, prefer DD/MM unless stored value is ambiguous and format is mm/dd/yyyy
  const expr = parseDateExpr(trimmed, effective === 'mm/dd/yyyy');
  if (!expr) return trimmed;

  const lang = activeLocale in LOCALIZED_MONTHS ? activeLocale : 'en';
  const useGedcomKw = effective === 'gedcom';

  switch (expr.kind) {
    case 'exact':
      return formatSimpleDateForDisplay(expr.date, effective, lang);
    case 'single': {
      const qLabel = useGedcomKw
        ? expr.qualifier
        : (QUALIFIER_DISPLAY[expr.qualifier]?.[lang] ?? expr.qualifier);
      return `${qLabel} ${formatSimpleDateForDisplay(expr.date, effective, lang)}`;
    }
    case 'between': {
      const sLabel = useGedcomKw ? 'BET' : QUALIFIER_DISPLAY.BET_START[lang];
      const mLabel = useGedcomKw ? 'AND' : QUALIFIER_DISPLAY.BET_MID[lang];
      return `${sLabel} ${formatSimpleDateForDisplay(expr.start, effective, lang)} ${mLabel} ${formatSimpleDateForDisplay(expr.end, effective, lang)}`;
    }
    case 'period': {
      const sLabel = useGedcomKw ? 'FROM' : QUALIFIER_DISPLAY.PERIOD_START[lang];
      const mLabel = useGedcomKw ? 'TO' : QUALIFIER_DISPLAY.PERIOD_MID[lang];
      return `${sLabel} ${formatSimpleDateForDisplay(expr.start, effective, lang)} ${mLabel} ${formatSimpleDateForDisplay(expr.end, effective, lang)}`;
    }
    case 'interpreted':
      return `${formatSimpleDateForDisplay(expr.date, effective, lang)} (${expr.phrase})`;
    case 'phrase':
      return expr.text;
  }
}

/**
 * Normalizes user input (in the active format or any recognized format, with localized or GEDCOM qualifiers)
 * into canonical GEDCOM 5.5.1 format for storage.
 */
export function normalizeDateInputToGedcom(
  input: string | null | undefined,
  formatOverride?: DateFormatOption,
  localeOverride?: string
): string {
  const trimmed = (input ?? '').trim();
  if (!trimmed) return '';

  const activeLocale = (localeOverride || i18n.global.locale.value || 'de').toLowerCase().split('-')[0];
  const option = formatOverride ?? dateFormatState.value;
  const effective = resolveEffectiveFormat(option, activeLocale);

  const expr = parseDateExpr(trimmed, effective === 'mm/dd/yyyy');
  if (!expr) return trimmed;

  switch (expr.kind) {
    case 'exact':
      return formatSimpleDateToGedcom(expr.date);
    case 'single':
      return `${expr.qualifier} ${formatSimpleDateToGedcom(expr.date)}`;
    case 'between':
      return `BET ${formatSimpleDateToGedcom(expr.start)} AND ${formatSimpleDateToGedcom(expr.end)}`;
    case 'period':
      return `FROM ${formatSimpleDateToGedcom(expr.start)} TO ${formatSimpleDateToGedcom(expr.end)}`;
    case 'interpreted':
      return `INT ${formatSimpleDateToGedcom(expr.date)} (${expr.phrase})`;
    case 'phrase':
      return `(${expr.text})`;
  }
}

export function setDateFormat(next: DateFormatOption): void {
  dateFormatState.value = next;
  try {
    localStorage.setItem(DATE_FORMAT_STORAGE_KEY, next);
  } catch {
    // ignore storage errors
  }
}

export function useDateFormat() {
  const effectiveFormat = computed<ConcreteDateFormat>(() =>
    resolveEffectiveFormat(dateFormatState.value, i18n.global.locale.value)
  );

  return {
    dateFormat: dateFormatState,
    effectiveFormat,
    setDateFormat,
    formatDate: (raw: string | null | undefined) => formatDisplayDate(raw),
    normalizeDateInput: (raw: string | null | undefined) => normalizeDateInputToGedcom(raw),
  };
}
