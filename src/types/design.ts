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
  showOnlyYears: false,

  showMarriageCounter: true,
  showMarriageDate: true,
  showSpouseName: true,

  showSpouseBirthDate: false,
  showSpouseBirthPlace: false,
  showSpouseDeathDate: false,
  showSpouseDeathPlace: false,
  showDivorce: true,
};

export function computeCardHeight(cfg: DesignCardConfig, maxSpouseCount: number = 0): number {
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

export interface PersonHeightInput {
  given_name?: string | null;
  surname?: string | null;
  sex?: string | null;
  birth_date?: string | null;
  birth_place?: string | null;
  death_date?: string | null;
  death_place?: string | null;
  chr_date?: string | null;
  chr_place?: string | null;
  has_henry_code?: boolean;
  generation?: number;
  spouses?: {
    id: string;
    given_name?: string | null;
    surname?: string | null;
    date?: string | null;
    divorce_date?: string | null;
    is_divorced?: boolean;
    birth_date?: string | null;
    birth_place?: string | null;
    death_date?: string | null;
    death_place?: string | null;
    has_henry_code?: boolean;
  }[];
}

/**
 * Berechnet die minimal benötigte Kachelhöhe für eine Person dynamisch anhand ihres konkreten Inhalts.
 * Sie ist möglichst gering, aber stets so groß, dass alle Inhalte der Kachel vollständig dargestellt werden.
 */
export function computePersonCardNeededHeight(
  p: PersonHeightInput,
  cfg: DesignCardConfig,
  currentLocale: string = 'de'
): number {
  // Basis-Polsterung: oben 5px + unten 5px + Geschlechterbalken 3px + 2px Rahmen = 15px
  let needed = 15;

  // Zeile #1: Henry-ID & Generations-Badge
  const showHenry = cfg.showHenryId && Boolean(p.has_henry_code);
  const showGen = cfg.showGeneration && Boolean(p.generation);
  if (showHenry || showGen) {
    needed += 18;
  }

  // Zeile #2: Vorname (in der Kachel wird nur der Vorname angezeigt)
  const firstName = (p.given_name || 'N.N.').trim();
  if (firstName.length > 18 || (firstName.includes(' ') && firstName.length > 13)) {
    needed += 30; // 2 Zeilen Umbruch
  } else {
    needed += 16; // 1 Zeile
  }

  // Zeile #3: Lebensdaten (Geburt, Taufe, Tod)
  const dateTexts: string[] = [];
  if (cfg.showBirthDate && p.birth_date) {
    const bDate = formatLocalizedDate(p.birth_date, currentLocale, cfg.showOnlyYears);
    const bPlace = cfg.showBirthPlace && p.birth_place ? ` (${p.birth_place})` : '';
    dateTexts.push(`* ${bDate}${bPlace}`);
  }
  if (cfg.showChrDate && p.chr_date) {
    const cDate = formatLocalizedDate(p.chr_date, currentLocale, cfg.showOnlyYears);
    const cPlace = cfg.showChrPlace && p.chr_place ? ` (${p.chr_place})` : '';
    dateTexts.push(`~ ${cDate}${cPlace}`);
  }
  if (cfg.showDeathDate && p.death_date) {
    const dDate = formatLocalizedDate(p.death_date, currentLocale, cfg.showOnlyYears);
    const dPlace = cfg.showDeathPlace && p.death_place ? ` (${p.death_place})` : '';
    dateTexts.push(`† ${dDate}${dPlace}`);
  }

  if (dateTexts.length > 0) {
    if (cfg.lifeDatesLayout === 'single') {
      const totalLen = dateTexts.join(', ').length;
      if (totalLen > 52) {
        needed += 40; // 3 Zeilen
      } else if (totalLen > 24) {
        needed += 26; // 2 Zeilen
      } else {
        needed += 14; // 1 Zeile
      }
    } else {
      needed += dateTexts.length * 13;
    }
  }

  // Zeilen #4 & #5: Ehen / Ehepartner
  const showMarriage =
    cfg.showSpouseName ||
    cfg.showMarriageCounter ||
    cfg.showMarriageDate ||
    cfg.showDivorce ||
    cfg.showSpouseBirthDate ||
    cfg.showSpouseDeathDate;

  if (p.spouses && p.spouses.length > 0 && showMarriage) {
    needed += 6; // Trennlinie & Abstand
    p.spouses.forEach((sp, spIdx) => {
      let spH = 0;
      // Name
      if (cfg.showSpouseName || (cfg.showHenryId && sp.has_henry_code)) {
        const spName = `${sp.given_name || ''} ${sp.surname || ''}`.trim() || 'N.N.';
        const prefix = p.spouses!.length > 1 && cfg.showMarriageCounter ? `(${spIdx + 1}) ` : '';
        const fullSpName = prefix + spName;
        spH += fullSpName.length > 20 ? 26 : 14;
      }
      // Daten
      const spDates: string[] = [];
      if (cfg.showMarriageDate && sp.date) {
        spDates.push(`oo ${formatLocalizedDate(sp.date, currentLocale, cfg.showOnlyYears)}`);
      }
      if (cfg.showDivorce && (sp.is_divorced || sp.divorce_date)) {
        const divDate = sp.divorce_date
          ? formatLocalizedDate(sp.divorce_date, currentLocale, cfg.showOnlyYears)
          : (currentLocale === 'en' ? 'div.' : 'gesch.');
        spDates.push(`o|o ${divDate}`);
      }
      if (cfg.showSpouseBirthDate && sp.birth_date) {
        const bPlace = cfg.showSpouseBirthPlace && sp.birth_place ? ` (${sp.birth_place})` : '';
        spDates.push(`* ${formatLocalizedDate(sp.birth_date, currentLocale, cfg.showOnlyYears)}${bPlace}`);
      }
      if (cfg.showSpouseDeathDate && sp.death_date) {
        const dPlace = cfg.showSpouseDeathPlace && sp.death_place ? ` (${sp.death_place})` : '';
        spDates.push(`† ${formatLocalizedDate(sp.death_date, currentLocale, cfg.showOnlyYears)}${dPlace}`);
      }
      if (spDates.length > 0) {
        if (cfg.lifeDatesLayout === 'multi') {
          spH += spDates.length * 12;
        } else {
          const totalDateLen = spDates.join(', ').length;
          spH += totalDateLen > 26 ? 24 : 13;
        }
      }
      needed += Math.max(16, spH) + 4; // Abstand zwischen Partnern
    });
  }

  // Sicherheitsabstand von 4px, damit Text niemals anstößt
  return Math.max(50, needed + 4);
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
export function formatLocalizedDate(
  raw: string | null | undefined,
  currentLocale: string = 'de',
  onlyYear: boolean = false
): string {
  if (!raw) return '';
  const sRaw = raw.trim();
  if (!sRaw) return '';

  const cacheKey = `${sRaw}___${currentLocale}___${onlyYear ? 'Y' : 'F'}`;
  const cached = dateCache.get(cacheKey);
  if (cached !== undefined) return cached;

  let s = sRaw;
  const isEn = currentLocale.startsWith('en');

  function formatSingleDate(chunk: string): string {
    const c = chunk.trim();
    if (!c) return '';

    if (onlyYear) {
      // Find 3-4 digit year in chunk (e.g. 1875 or 850)
      const yearMatch = c.match(/\b(\d{3,4})\b/);
      if (yearMatch) {
        return yearMatch[1];
      }
      return c;
    }

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

  // Präfixe wie "ca. ", "abt. ", "vor ", "bef. ", "nach ", "aft. " beibehalten
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
