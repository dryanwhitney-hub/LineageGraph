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

  // Manuelle Kachelhöhe
  customCardHeightEnabled?: boolean;
  customCardHeight?: number;
}

export interface DesignBackgroundConfig {
  visible: boolean;
  scale: number; // in Prozent, z. B. 100 für 100%
  opacity: number; // in Prozent, z. B. 45 für 45%
  x: number; // Horizontale Position auf dem Canvas in Pixel
  y: number; // Vertikale Position auf dem Canvas in Pixel
  naturalWidth?: number;
  naturalHeight?: number;
  fileName?: string;
}

export const DEFAULT_BACKGROUND_CONFIG: DesignBackgroundConfig = {
  visible: true,
  scale: 100,
  opacity: 45,
  x: 0,
  y: 0,
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

  showMarriageCounter: true,
  showMarriageDate: true,
  showSpouseName: true,

  showSpouseBirthDate: false,
  showSpouseBirthPlace: false,
  showSpouseDeathDate: false,
  showSpouseDeathPlace: false,
  showDivorce: true,

  customCardHeightEnabled: false,
  customCardHeight: 180,
};

export function computeCardHeight(cfg: DesignCardConfig, maxSpouseCount: number = 0): number {
  if (cfg.customCardHeightEnabled && typeof cfg.customCardHeight === 'number' && cfg.customCardHeight > 0) {
    return Math.max(60, Math.min(500, cfg.customCardHeight));
  }

  let h = 16; // padding top 6px + bottom 6px + 4px safety buffer

  // Line #1: Henry ID & Gen badge row
  if (cfg.showHenryId || cfg.showGeneration) {
    h += 20;
  }

  // Line #2: Name (mandatory - accommodates up to 2 wrapped lines with line-height 1.25 and vertical margins)
  h += 40;

  // Line #3: Lebensdaten
  const hasBirth = cfg.showBirthDate;
  const hasChr = cfg.showChrDate;
  const hasDeath = cfg.showDeathDate;
  const activeDatesCount = [hasBirth, hasChr, hasDeath].filter(Boolean).length;

  if (activeDatesCount > 0) {
    if (cfg.lifeDatesLayout === 'single') {
      h += 20;
    } else {
      h += activeDatesCount * 18;
    }
  }

  // Marriage information (Status-Icon + Name, Hochzeits-/Scheidungs-/Geburts-/Todesdatum)
  const hasMarriage = cfg.showSpouseName || cfg.showMarriageCounter || cfg.showMarriageDate || cfg.showDivorce || cfg.showSpouseBirthDate || cfg.showSpouseDeathDate;

  if (hasMarriage && maxSpouseCount > 0) {
    let perMarriage = 0;
    // Spouse Name: allow 34px to comfortably accommodate 2-line wrapped spouse names
    if (cfg.showSpouseName || cfg.showMarriageCounter) perMarriage += 34;

    const hasAnyMarriageDate = cfg.showMarriageDate || cfg.showDivorce;
    const hasAnyLifeDate = cfg.showSpouseBirthDate || cfg.showSpouseDeathDate;

    if (cfg.lifeDatesLayout === 'single') {
      if (hasAnyMarriageDate && hasAnyLifeDate) {
        // Both marriage and life dates active -> wraps to 2 lines
        perMarriage += 36;
      } else if (hasAnyMarriageDate || hasAnyLifeDate) {
        // Marriage date and divorce date together may also need 2 lines if long
        perMarriage += (cfg.showMarriageDate && cfg.showDivorce) ? 34 : 20;
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

    // 8px divider + (perMarriage + 6px entry gap) per spouse
    h += 8 + (perMarriage + 6) * Math.min(4, maxSpouseCount);
  }

  return Math.max(50, h);
}

export function computeCardWidthForPerson(name: string): number {
  const cleanName = (name || 'N.N.').trim();
  const words = cleanName.split(/\s+/).filter(Boolean);
  let maxWordLen = 0;
  words.forEach(w => {
    if (w.length > maxWordLen) maxWordLen = w.length;
  });

  const halfNameLen = Math.ceil(cleanName.length / 2);
  const effectiveLen = Math.max(maxWordLen, halfNameLen);

  const calculatedW = Math.round(effectiveLen * 7.5 + 16);
  return Math.max(110, Math.min(220, calculatedW));
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

const dateCache = new Map<string, string>();

/**
 * Passt das Format eines Datums (GEDCOM, ISO oder numerisch) an die aktuelle Sprache an:
 * - 'de': TT.MM.JJJJ (bzw. Monatsname auf Deutsch, ca., vor, nach, zw. ... u. ...)
 * - 'en': DD MMM YYYY (z. B. 12 May 1875, abt., bef., aft., bet. ... and ...)
 */
export function formatLocalizedDate(raw: string | null | undefined, currentLocale: string = 'de'): string {
  if (!raw) return '';
  const sRaw = raw.trim();
  if (!sRaw) return '';

  const cacheKey = `${sRaw}___${currentLocale}`;
  const cached = dateCache.get(cacheKey);
  if (cached !== undefined) return cached;

  let s = sRaw;
  const isEn = currentLocale.startsWith('en');

  function formatSingleDate(chunk: string): string {
    const c = chunk.trim();
    if (!c) return '';

    // "DD MMM YYYY" / "D MMM YYYY" e.g. "12 MAY 1875" oder "12 MAI 1875"
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

    // "MMM YYYY" e.g. "MAY 1875" oder "MAI 1875"
    const myWordMatch = c.match(/^([A-Za-zÄÖÜäöü.]+)\s+(\d{3,4})$/);
    if (myWordMatch) {
      const monKey = myWordMatch[1].toUpperCase().replace(/\./g, '');
      const year = myWordMatch[2];
      const mInfo = GEDCOM_MONTHS[monKey];
      if (mInfo) {
        return isEn ? `${mInfo.enName} ${year}` : `${mInfo.deName} ${year}`;
      }
    }

    // "DD.MM.YYYY" / "D.M.YYYY"
    const dotMatch = c.match(/^(\d{1,2})\.(\d{1,2})\.(\d{3,4})$/);
    if (dotMatch) {
      const day = dotMatch[1].padStart(2, '0');
      const mon = dotMatch[2].padStart(2, '0');
      const year = dotMatch[3];
      if (isEn) {
        const monNums = Object.values(GEDCOM_MONTHS).find(m => m.deNum === mon);
        const monName = monNums ? monNums.enName : mon;
        return `${parseInt(dotMatch[1], 10)} ${monName} ${year}`;
      } else {
        return `${day}.${mon}.${year}`;
      }
    }

    // "YYYY-MM-DD"
    const isoMatch = c.match(/^(\d{3,4})-(\d{1,2})-(\d{1,2})$/);
    if (isoMatch) {
      const year = isoMatch[1];
      const mon = isoMatch[2].padStart(2, '0');
      const day = isoMatch[3].padStart(2, '0');
      if (isEn) {
        const monNums = Object.values(GEDCOM_MONTHS).find(m => m.deNum === mon);
        const monName = monNums ? monNums.enName : mon;
        return `${parseInt(isoMatch[3], 10)} ${monName} ${year}`;
      } else {
        return `${day}.${mon}.${year}`;
      }
    }

    return c;
  }

  // GEDCOM-Präfixe sprachlich übersetzen
  s = s.replace(/\b(ABT|CA|CAL|EST)\b\.?/gi, isEn ? 'abt.' : 'ca.');
  s = s.replace(/\b(BEF|VOR)\b\.?/gi, isEn ? 'bef.' : 'vor');
  s = s.replace(/\b(AFT|NACH)\b\.?/gi, isEn ? 'aft.' : 'nach');
  s = s.replace(/\bBET\b\s+(.*?)\s+\bAND\b\s+(.*)/i, (_, d1, d2) => {
    return isEn
      ? `bet. ${formatSingleDate(d1)} and ${formatSingleDate(d2)}`
      : `zw. ${formatSingleDate(d1)} u. ${formatSingleDate(d2)}`;
  });
  s = s.replace(/\bFROM\b\s+(.*?)\s+\bTO\b\s+(.*)/i, (_, d1, d2) => {
    return isEn
      ? `from ${formatSingleDate(d1)} to ${formatSingleDate(d2)}`
      : `von ${formatSingleDate(d1)} bis ${formatSingleDate(d2)}`;
  });

  const result = formatSingleDate(s);
  dateCache.set(cacheKey, result);
  return result;
}
