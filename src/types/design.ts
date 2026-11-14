export interface DesignCardConfig {
  // Formatierungen pro Zeile (#1 bis #5)
  line1Bold: boolean;
  line1Italic: boolean;
  line2Bold: boolean;
  line2Italic: boolean;
  line3Bold: boolean;
  line3Italic: boolean;
  line4Bold: boolean;
  line4Italic: boolean;
  line5Bold: boolean;
  line5Italic: boolean;

  // #1
  showHenryId: boolean;
  showGeneration: boolean;

  // #2: Name ist Pflichtfeld (mandatory)

  // #3
  lifeDatesLayout: 'multi' | 'single';
  showBirthDate: boolean;
  showBirthPlace: boolean;
  showDeathDate: boolean;
  showDeathPlace: boolean;
  showChrDate: boolean;
  showChrPlace: boolean;
  showOnlyYears?: boolean;
  showOccupation?: boolean;

  // #4: Ehe & Partner
  showMarriageCounter: boolean;
  showMarriageDate: boolean;
  showSpouseName: boolean;

  // #5
  showSpouseBirthDate: boolean;
  showSpouseBirthPlace: boolean;
  showSpouseDeathDate: boolean;
  showSpouseDeathPlace: boolean;
  showDivorce: boolean;

  // Kompakte Platzersparnis: Leere Zeilen kosten keinen vertikalen Platz
  dynamicCompactHeight?: boolean;
}

export interface DesignBackgroundConfig {
  visible: boolean;
  scale: number; // in Prozent, z. B. 100 für 100%
  opacity: number; // in Prozent, z. B. 45 für 45%
  x: number; // Horizontale Position relativ zum Baumzentrum in Pixel
  y: number; // Vertikale Position relativ zum Baum in Pixel
  naturalWidth?: number;
  naturalHeight?: number;
  fileName?: string;
  lockAspectRatio?: boolean;
  locked?: boolean;
}

export const DEFAULT_BACKGROUND_CONFIG: DesignBackgroundConfig = {
  visible: true,
  scale: 100,
  opacity: 45,
  x: 0,
  y: 0,
  lockAspectRatio: true,
  locked: true,
};

export const DEFAULT_CARD_CONFIG: DesignCardConfig = {
  line1Bold: false,
  line1Italic: false,
  line2Bold: true,
  line2Italic: false,
  line3Bold: false,
  line3Italic: false,
  line4Bold: true,
  line4Italic: false,
  line5Bold: false,
  line5Italic: false,

  showHenryId: true,
  showGeneration: true,

  lifeDatesLayout: 'single',
  showBirthDate: true,
  showBirthPlace: false,
  showDeathDate: true,
  showDeathPlace: false,
  showChrDate: false,
  showChrPlace: false,
  showOnlyYears: false,
  showOccupation: false,

  showMarriageCounter: true,
  showMarriageDate: true,
  showSpouseName: true,

  showSpouseBirthDate: false,
  showSpouseBirthPlace: false,
  showSpouseDeathDate: false,
  showSpouseDeathPlace: false,
  showDivorce: true,

  dynamicCompactHeight: true,
};

/**
 * Grobe Vorschau-Höhe für die Einstellungs-Vorschaukarte (z. B. SettingsModal).
 */
export function computeCardHeight(cfg: DesignCardConfig, maxSpouseCount: number = 0): number {
  let h = 16;

  if (cfg.showHenryId || cfg.showGeneration) {
    h += 20;
  }

  h += 40;

  const activeDatesCount = [cfg.showBirthDate, cfg.showChrDate, cfg.showDeathDate].filter(Boolean).length;
  if (activeDatesCount > 0) {
    h += cfg.lifeDatesLayout === 'single' ? 20 : activeDatesCount * 18;
  }

  const hasMarriage =
    cfg.showSpouseName ||
    cfg.showMarriageCounter ||
    cfg.showMarriageDate ||
    cfg.showDivorce ||
    cfg.showSpouseBirthDate ||
    cfg.showSpouseDeathDate;

  if (hasMarriage && maxSpouseCount > 0) {
    let perMarriage = 0;
    if (cfg.showSpouseName || cfg.showMarriageCounter) perMarriage += 34;

    const hasAnyMarriageDate = cfg.showMarriageDate || cfg.showDivorce;
    const hasAnyLifeDate = cfg.showSpouseBirthDate || cfg.showSpouseDeathDate;

    if (cfg.lifeDatesLayout === 'single') {
      if (hasAnyMarriageDate && hasAnyLifeDate) {
        perMarriage += 36;
      } else if (hasAnyMarriageDate || hasAnyLifeDate) {
        perMarriage += cfg.showMarriageDate && cfg.showDivorce ? 34 : 20;
      }
    } else {
      const activeSpouseDatesCount = [
        cfg.showMarriageDate,
        cfg.showDivorce,
        cfg.showSpouseBirthDate,
        cfg.showSpouseDeathDate,
      ].filter(Boolean).length;
      perMarriage += activeSpouseDatesCount * 18;
    }

    h += 8 + (perMarriage + 6) * Math.min(4, maxSpouseCount);
  }

  return Math.max(50, h);
}

const GEDCOM_MONTHS: Record<string, { deNum: string; deName: string; enName: string }> = {
  JAN: { deNum: '01', deName: 'Jan.', enName: 'Jan' },
  FEB: { deNum: '02', deName: 'Feb.', enName: 'Feb' },
  MAR: { deNum: '03', deName: 'März', enName: 'Mar' },
  MÄR: { deNum: '03', deName: 'März', enName: 'Mar' },
  APR: { deNum: '04', deName: 'Apr.', enName: 'Apr' },
  MAY: { deNum: '05', deName: 'Mai', enName: 'May' },
  MAI: { deNum: '05', deName: 'Mai', enName: 'May' },
  JUN: { deNum: '06', deName: 'Juni', enName: 'Jun' },
  JUL: { deNum: '07', deName: 'Juli', enName: 'Jul' },
  AUG: { deNum: '08', deName: 'Aug.', enName: 'Aug' },
  SEP: { deNum: '09', deName: 'Sep.', enName: 'Sep' },
  OCT: { deNum: '10', deName: 'Okt.', enName: 'Oct' },
  OKT: { deNum: '10', deName: 'Okt.', enName: 'Oct' },
  NOV: { deNum: '11', deName: 'Nov.', enName: 'Nov' },
  DEC: { deNum: '12', deName: 'Dez.', enName: 'Dec' },
  DEZ: { deNum: '12', deName: 'Dez.', enName: 'Dec' },
};

import { formatDisplayDate } from '../composables/useDateFormat';

const dateCache = new Map<string, string>();

/**
 * Passt das Format eines Datums (GEDCOM, ISO oder numerisch) an die aktuelle Sprache und das gewählte Datumsformat an.
 */
export function formatLocalizedDate(
  raw: string | null | undefined,
  currentLocale: string = 'de',
  onlyYear: boolean = false
): string {
  if (!raw) return '';
  const sRaw = raw.trim();
  if (!sRaw) return '';

  if (!onlyYear) {
    return formatDisplayDate(sRaw, undefined, currentLocale);
  }

  const cacheKey = `${sRaw}___${currentLocale}___${onlyYear ? 'Y' : 'F'}`;
  const cached = dateCache.get(cacheKey);
  if (cached !== undefined) return cached;

  let s = sRaw;
  const isEn = currentLocale.startsWith('en');

  function formatSingleDate(chunk: string): string {
    const c = chunk.trim();
    if (!c) return '';

    if (onlyYear) {
      const yearMatch = c.match(/\b(\d{3,4})\b/);
      if (yearMatch) return yearMatch[1];
      return c;
    }

    const dmyWordMatch = c.match(/^(\d{1,2})\s+([A-Za-zÄÖÜäöü.]+)\s+(\d{3,4})$/);
    if (dmyWordMatch) {
      const day = dmyWordMatch[1].padStart(2, '0');
      const monKey = dmyWordMatch[2].toUpperCase().replace(/\./g, '');
      const year = dmyWordMatch[3];
      const mInfo = GEDCOM_MONTHS[monKey];
      if (mInfo) {
        return isEn
          ? `${parseInt(dmyWordMatch[1], 10)} ${mInfo.enName} ${year}`
          : `${day}.${mInfo.deNum}.${year}`;
      }
    }

    const myWordMatch = c.match(/^([A-Za-zÄÖÜäöü.]+)\s+(\d{3,4})$/);
    if (myWordMatch) {
      const monKey = myWordMatch[1].toUpperCase().replace(/\./g, '');
      const year = myWordMatch[2];
      const mInfo = GEDCOM_MONTHS[monKey];
      if (mInfo) {
        return isEn ? `${mInfo.enName} ${year}` : `${mInfo.deName} ${year}`;
      }
    }

    const dotMatch = c.match(/^(\d{1,2})\.(\d{1,2})\.(\d{3,4})$/);
    if (dotMatch) {
      const day = dotMatch[1].padStart(2, '0');
      const mon = dotMatch[2].padStart(2, '0');
      const year = dotMatch[3];
      if (isEn) {
        const monNums = Object.values(GEDCOM_MONTHS).find(m => m.deNum === mon);
        const monName = monNums ? monNums.enName : mon;
        return `${parseInt(dotMatch[1], 10)} ${monName} ${year}`;
      }
      return `${day}.${mon}.${year}`;
    }

    const isoMatch = c.match(/^(\d{3,4})-(\d{1,2})-(\d{1,2})$/);
    if (isoMatch) {
      const year = isoMatch[1];
      const mon = isoMatch[2].padStart(2, '0');
      const day = isoMatch[3].padStart(2, '0');
      if (isEn) {
        const monNums = Object.values(GEDCOM_MONTHS).find(m => m.deNum === mon);
        const monName = monNums ? monNums.enName : mon;
        return `${parseInt(isoMatch[3], 10)} ${monName} ${year}`;
      }
      return `${day}.${mon}.${year}`;
    }

    return c;
  }

  s = s.replace(/\b(ABT|CA|CAL|EST)\b\.?/gi, isEn ? 'abt.' : 'ca.');
  s = s.replace(/\b(BEF|VOR)\b\.?/gi, isEn ? 'bef.' : 'vor');
  s = s.replace(/\b(AFT|NACH)\b\.?/gi, isEn ? 'aft.' : 'nach');
  s = s.replace(/\bBET\b\s+(.*?)\s+\bAND\b\s+(.*)/i, (_, d1, d2) =>
    isEn
      ? `bet. ${formatSingleDate(d1)} and ${formatSingleDate(d2)}`
      : `zw. ${formatSingleDate(d1)} u. ${formatSingleDate(d2)}`
  );
  s = s.replace(/\bFROM\b\s+(.*?)\s+\bTO\b\s+(.*)/i, (_, d1, d2) =>
    isEn
      ? `from ${formatSingleDate(d1)} to ${formatSingleDate(d2)}`
      : `von ${formatSingleDate(d1)} bis ${formatSingleDate(d2)}`
  );

  let prefix = '';
  const prefixMatch = s.match(/^(ca\.|abt\.|vor|bef\.|nach|aft\.)\s*/i);
  if (prefixMatch) {
    prefix = prefixMatch[0];
    s = s.slice(prefix.length).trim();
  }

  const result = prefix + formatSingleDate(s);
  dateCache.set(cacheKey, result);
  return result;
}

export * from '../domain/design/sceneTypes';
