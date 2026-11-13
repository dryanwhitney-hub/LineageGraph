export type DatePrecision = 'exact' | 'month_year' | 'year_only' | 'approx' | 'excluded' | 'empty';

export interface ParsedGedcomDate {
  raw: string;
  year: number | null;
  month: number | null; // 1..12
  day: number | null;   // 1..31
  precision: DatePrecision;
}

const MONTH_MAP: Record<string, number> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  MRZ: 3,
  APR: 4,
  MAY: 5,
  MAI: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  SEPT: 9,
  OCT: 10,
  OKT: 10,
  NOV: 11,
  DEC: 12,
  DEZ: 12,
};

const EXCLUDED_PREFIX_RE = /^(BEF|AFT|BET|FROM|TO|INT|VOR|NACH|ZWISCHEN|BIS)\b/i;
const APPROX_PREFIX_RE = /^(ABT|CA\.?|CAL|EST|CIR|UM)\s+/i;

/**
 * Parses a GEDCOM or ISO/German date string into structured components and precision.
 */
export function parseGedcomDate(raw: string | null | undefined): ParsedGedcomDate {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) {
    return { raw: '', year: null, month: null, day: null, precision: 'empty' };
  }

  // Range / boundary qualifiers are excluded from point-in-time & age calculations
  if (EXCLUDED_PREFIX_RE.test(trimmed) || /\b(AND|UND)\b/i.test(trimmed)) {
    return { raw: trimmed, year: null, month: null, day: null, precision: 'excluded' };
  }

  let isApprox = false;
  let cleaned = trimmed;
  if (APPROX_PREFIX_RE.test(cleaned)) {
    isApprox = true;
    cleaned = cleaned.replace(APPROX_PREFIX_RE, '').trim();
  }

  // Handle dual-dating like 1720/21 or 1720/1721 -> treat as approx first year
  const dualYearMatch = cleaned.match(/^(\d{4})\/\d{2,4}$/);
  if (dualYearMatch) {
    return {
      raw: trimmed,
      year: parseInt(dualYearMatch[1], 10),
      month: null,
      day: null,
      precision: 'approx',
    };
  }

  // ISO: YYYY-MM-DD
  const isoMatch = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10);
    const day = parseInt(isoMatch[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return {
        raw: trimmed,
        year,
        month,
        day,
        precision: isApprox ? 'approx' : 'exact',
      };
    }
  }

  // German: DD.MM.YYYY
  const deMatch = cleaned.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (deMatch) {
    const day = parseInt(deMatch[1], 10);
    const month = parseInt(deMatch[2], 10);
    const year = parseInt(deMatch[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return {
        raw: trimmed,
        year,
        month,
        day,
        precision: isApprox ? 'approx' : 'exact',
      };
    }
  }

  // GEDCOM: DD MMM YYYY
  const gedcomFullMatch = cleaned.match(/^(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{3,4})$/);
  if (gedcomFullMatch) {
    const day = parseInt(gedcomFullMatch[1], 10);
    const month = MONTH_MAP[gedcomFullMatch[2].toUpperCase()] ?? null;
    const year = parseInt(gedcomFullMatch[3], 10);
    if (month && day >= 1 && day <= 31) {
      return {
        raw: trimmed,
        year,
        month,
        day,
        precision: isApprox ? 'approx' : 'exact',
      };
    }
  }

  // GEDCOM: MMM YYYY
  const gedcomMonthYearMatch = cleaned.match(/^([A-Za-z]+)\.?\s+(\d{3,4})$/);
  if (gedcomMonthYearMatch) {
    const month = MONTH_MAP[gedcomMonthYearMatch[1].toUpperCase()] ?? null;
    const year = parseInt(gedcomMonthYearMatch[2], 10);
    if (month) {
      return {
        raw: trimmed,
        year,
        month,
        day: null,
        precision: isApprox ? 'approx' : 'month_year',
      };
    }
  }

  // ISO month: YYYY-MM or MM.YYYY
  const isoMonthMatch = cleaned.match(/^(\d{4})-(\d{1,2})$/);
  if (isoMonthMatch) {
    const year = parseInt(isoMonthMatch[1], 10);
    const month = parseInt(isoMonthMatch[2], 10);
    if (month >= 1 && month <= 12) {
      return {
        raw: trimmed,
        year,
        month,
        day: null,
        precision: isApprox ? 'approx' : 'month_year',
      };
    }
  }

  // Year only: YYYY (or 3-4 digits)
  const yearOnlyMatch = cleaned.match(/^(\d{3,4})$/);
  if (yearOnlyMatch) {
    return {
      raw: trimmed,
      year: parseInt(yearOnlyMatch[1], 10),
      month: null,
      day: null,
      precision: isApprox ? 'approx' : 'year_only',
    };
  }

  return { raw: trimmed, year: null, month: null, day: null, precision: 'excluded' };
}

/**
 * Checks if a parsed date is usable under the current exactness setting.
 */
export function isDateUsable(parsed: ParsedGedcomDate, onlyExactDates: boolean): boolean {
  if (parsed.year === null || parsed.precision === 'empty' || parsed.precision === 'excluded') {
    return false;
  }
  if (onlyExactDates) {
    return parsed.precision === 'exact';
  }
  return true;
}

/**
 * Computes fractional age in years between two parsed dates.
 * Returns null if dates are unusable or result is outside plausible human bounds [0, 115].
 */
export function computeAgeYears(
  birth: ParsedGedcomDate,
  event: ParsedGedcomDate,
  onlyExactDates: boolean
): number | null {
  if (!isDateUsable(birth, onlyExactDates) || !isDateUsable(event, onlyExactDates)) {
    return null;
  }
  if (birth.year === null || event.year === null) return null;

  let years: number;
  if (birth.month && birth.day && event.month && event.day) {
    const bTime = Date.UTC(birth.year, birth.month - 1, birth.day);
    const eTime = Date.UTC(event.year, event.month - 1, event.day);
    years = (eTime - bTime) / (365.2425 * 24 * 60 * 60 * 1000);
  } else if (birth.month && event.month) {
    years = event.year - birth.year + (event.month - birth.month) / 12;
  } else {
    years = event.year - birth.year;
  }

  if (years < 0 || years > 115) return null;
  return years;
}

/**
 * Computes fractional years between two events (e.g. sibling birth interval).
 */
export function computeIntervalYears(
  earlier: ParsedGedcomDate,
  later: ParsedGedcomDate,
  onlyExactDates: boolean
): number | null {
  if (!isDateUsable(earlier, onlyExactDates) || !isDateUsable(later, onlyExactDates)) {
    return null;
  }
  if (earlier.year === null || later.year === null) return null;

  let years: number;
  if (earlier.month && earlier.day && later.month && later.day) {
    const t1 = Date.UTC(earlier.year, earlier.month - 1, earlier.day);
    const t2 = Date.UTC(later.year, later.month - 1, later.day);
    years = (t2 - t1) / (365.2425 * 24 * 60 * 60 * 1000);
  } else if (earlier.month && later.month) {
    years = later.year - earlier.year + (later.month - earlier.month) / 12;
  } else {
    years = later.year - earlier.year;
  }

  if (years < 0 || years > 50) return null;
  return years;
}

/**
 * Returns the 1-based century for a year (e.g. 1842 -> 19).
 */
export function getCentury(year: number): number {
  return Math.floor((year - 1) / 100) + 1;
}
