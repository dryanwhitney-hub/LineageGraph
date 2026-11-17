import { formatLocalizedDate, type DesignCardConfig } from '../../types/design';
import type { ResolvedPersonMeta } from './lineageResolver';
import type { CardDensityProfile, SceneSpouseRow } from './sceneTypes';

export interface DensityProfileSpec {
  id: CardDensityProfile;
  cardWidth: number;
  horizontalPadding: number;
  nameFontSize: number;
  metaFontSize: number;
  lineHeightName: number;
  lineHeightMeta: number;
  onlyYearsOverride?: boolean;
  hidePlaces?: boolean;
}

export const DENSITY_PROFILE_SPECS: Record<CardDensityProfile, DensityProfileSpec> = {
  detail: {
    id: 'detail',
    cardWidth: 184,
    horizontalPadding: 9,
    nameFontSize: 12,
    metaFontSize: 10,
    lineHeightName: 15,
    lineHeightMeta: 13,
  },
  standard: {
    id: 'standard',
    cardWidth: 170,
    horizontalPadding: 8,
    nameFontSize: 11.5,
    metaFontSize: 9.5,
    lineHeightName: 14,
    lineHeightMeta: 12.5,
  },
  compact_years: {
    id: 'compact_years',
    cardWidth: 136,
    horizontalPadding: 6,
    nameFontSize: 11,
    metaFontSize: 9,
    lineHeightName: 13,
    lineHeightMeta: 11.5,
    onlyYearsOverride: true,
    hidePlaces: true,
  },
  narrow: {
    id: 'narrow',
    cardWidth: 112,
    horizontalPadding: 5,
    nameFontSize: 10,
    metaFontSize: 8.5,
    lineHeightName: 12,
    lineHeightMeta: 11,
    onlyYearsOverride: true,
    hidePlaces: true,
  },
};

let cachedCanvasCtx: CanvasRenderingContext2D | null = null;
const FONT_FAMILY = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (cachedCanvasCtx) return cachedCanvasCtx;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    cachedCanvasCtx = canvas.getContext('2d');
    return cachedCanvasCtx;
  }
  return null;
}

export function measureTextWidth(
  text: string,
  fontSizePx: number,
  bold: boolean = false,
  italic: boolean = false
): number {
  if (!text) return 0;
  const ctx = getMeasureContext();
  if (ctx) {
    const style = italic ? 'italic' : 'normal';
    const weight = bold ? '700' : '400';
    ctx.font = `${style} ${weight} ${fontSizePx}px ${FONT_FAMILY}`;
    return ctx.measureText(text).width;
  }
  return text.length * fontSizePx * (bold ? 0.56 : 0.52);
}

export function wrapTextToWidth(
  text: string,
  maxWidth: number,
  fontSizePx: number,
  bold: boolean = false,
  italic: boolean = false
): string[] {
  const clean = text.trim();
  if (!clean) return [];
  const words = clean.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (measureTextWidth(candidate, fontSizePx, bold, italic) <= maxWidth) {
      current = candidate;
    } else {
      if (current) {
        lines.push(current);
        current = w;
      } else {
        // Einzelwort breiter als maxWidth -> hart umbrechen
        let slice = '';
        for (const ch of w) {
          if (measureTextWidth(slice + ch, fontSizePx, bold, italic) > maxWidth && slice) {
            lines.push(slice);
            slice = ch;
          } else {
            slice += ch;
          }
        }
        current = slice;
      }
    }
  }
  if (current) lines.push(current);
  return lines;
}

export interface ComputedCardMetrics {
  width: number;
  height: number;
  lifeLines: string[];
  spouses: SceneSpouseRow[];
  occupationText?: string;
  nameLineCount: number;
}

function readGedcomTagVal(extra: Record<string, any> | undefined, tag: string, key: string): string {
  if (!extra || !extra[tag]) return '';
  const entry = Array.isArray(extra[tag]) ? extra[tag][0] : extra[tag];
  if (!entry) return '';
  const val = entry[key];
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object' && typeof val._val === 'string') return val._val;
  return '';
}

export function computeCardMetricsForPerson(
  meta: ResolvedPersonMeta,
  profile: CardDensityProfile,
  cfg: DesignCardConfig,
  locale: string = 'de'
): ComputedCardMetrics {
  const spec = DENSITY_PROFILE_SPECS[profile] || DENSITY_PROFILE_SPECS.standard;
  const width = spec.cardWidth;
  // 3px border (1.5px * 2) + 2px Subpixel-Puffer, damit DOM-Umbrüche nie schmaler sind als die Messung
  const innerW = Math.max(40, width - spec.horizontalPadding * 2 - 5);
  const onlyYears = Boolean(cfg.showOnlyYears);
  const compactMode = cfg.dynamicCompactHeight !== false;

  const p = meta.person;
  const displayName = `${p.given_name || ''} ${p.surname || ''}`.trim() || 'N.N.';
  const nameLines = wrapTextToWidth(
    displayName,
    innerW,
    spec.nameFontSize,
    cfg.line2Bold,
    cfg.line2Italic
  );
  const nameLineCount = Math.max(1, nameLines.length);

  // Lebensdaten gemäß aktiver Kachel-Konfiguration aufbereiten
  // (Ortsangaben erscheinen auch dann, wenn nur der Ort ohne Datum aktiviert ist)
  const rawLifeChunks: string[] = [];
  const birthDateText =
    cfg.showBirthDate && p.birth_date
      ? formatLocalizedDate(p.birth_date, locale, onlyYears)
      : '';
  const birthPlaceText = cfg.showBirthPlace && p.birth_place ? p.birth_place.trim() : '';
  if (birthDateText || birthPlaceText) {
    rawLifeChunks.push(
      `* ${birthDateText}${birthDateText && birthPlaceText ? ` (${birthPlaceText})` : birthPlaceText}`
    );
  }

  const rawChrDate =
    readGedcomTagVal(p.gedcom_extra, 'CHR', 'DATE') ||
    readGedcomTagVal(p.gedcom_extra, 'BAPM', 'DATE');
  const rawChrPlace =
    readGedcomTagVal(p.gedcom_extra, 'CHR', 'PLAC') ||
    readGedcomTagVal(p.gedcom_extra, 'BAPM', 'PLAC');
  const chrDateText =
    cfg.showChrDate && rawChrDate ? formatLocalizedDate(rawChrDate, locale, onlyYears) : '';
  const chrPlaceText = cfg.showChrPlace && rawChrPlace ? rawChrPlace.trim() : '';
  if (chrDateText || chrPlaceText) {
    rawLifeChunks.push(
      `~ ${chrDateText}${chrDateText && chrPlaceText ? ` (${chrPlaceText})` : chrPlaceText}`
    );
  }

  const deathDateText =
    cfg.showDeathDate && p.death_date
      ? formatLocalizedDate(p.death_date, locale, onlyYears)
      : '';
  const deathPlaceText = cfg.showDeathPlace && p.death_place ? p.death_place.trim() : '';
  if (deathDateText || deathPlaceText) {
    rawLifeChunks.push(
      `† ${deathDateText}${deathDateText && deathPlaceText ? ` (${deathPlaceText})` : deathPlaceText}`
    );
  }

  let lifeLines: string[] = [];
  if (rawLifeChunks.length > 0) {
    if (cfg.lifeDatesLayout === 'single') {
      const joined = rawLifeChunks.join(', ');
      lifeLines = wrapTextToWidth(joined, innerW, spec.metaFontSize, cfg.line3Bold, cfg.line3Italic);
    } else {
      for (const ch of rawLifeChunks) {
        lifeLines.push(
          ...wrapTextToWidth(ch, innerW, spec.metaFontSize, cfg.line3Bold, cfg.line3Italic)
        );
      }
    }
  }

  const occupationText =
    cfg.showOccupation && meta.occupationText ? meta.occupationText : undefined;

  const occuLines = occupationText
    ? wrapTextToWidth(occupationText, innerW, spec.metaFontSize, cfg.line3Bold, cfg.line3Italic)
    : [];

  // Ehepartner-Zeilen an Config anpassen
  const showAnyMarriage =
    cfg.showSpouseName ||
    cfg.showMarriageCounter ||
    cfg.showMarriageDate ||
    cfg.showDivorce ||
    cfg.showSpouseBirthDate ||
    cfg.showSpouseBirthPlace ||
    cfg.showSpouseDeathDate ||
    cfg.showSpouseDeathPlace ||
    cfg.showHenryId;

  const renderedSpouses: SceneSpouseRow[] = showAnyMarriage
    ? meta.spouses.map(sp => {
        return {
          ...sp,
          fullName: cfg.showSpouseName ? sp.fullName : '',
        };
      })
    : [];

  // Höhe exakt passend zu CSS-Padding, Border (3px), Line-Heights und Flex-Gaps berechnen
  const vPad = profile === 'narrow' ? 8 : profile === 'compact_years' ? 10 : 12;
  let h = vPad + 5; // Border (3px) + vertikales Padding + 2px Sicherheitsreserve

  // #1 Henry & Gen Header (inkl. margin-top: 2px & 2px Card-Flex-Gap)
  const showHeader = (cfg.showHenryId && Boolean(meta.henryCode)) || (cfg.showGeneration && meta.generation > 0);
  if (showHeader || !compactMode) {
    h += 18;
  }

  // #2 Name (CSS line-height: 1.25 + 2px Card-Flex-Gap)
  const nameLineH = Math.max(spec.lineHeightName, Math.ceil(spec.nameFontSize * 1.25));
  h += nameLineCount * nameLineH + 2;

  // #3 Lebensdaten + Beruf (CSS line-height: 1.25, 1px Item-Gap, + 2px Card-Flex-Gap)
  const metaLineH = Math.max(spec.lineHeightMeta, Math.ceil(spec.metaFontSize * 1.28));
  if (lifeLines.length > 0 || occuLines.length > 0) {
    const totalLifeItems = lifeLines.length + occuLines.length;
    h += totalLifeItems * metaLineH + Math.max(0, totalLifeItems - 1) * 1 + 2;
  } else if (!compactMode) {
    h += metaLineH + 2;
  }

  // #4 & #5 Ehen + Implex-Badges
  if (renderedSpouses.length > 0) {
    // .d-card-marriages: margin-top: 2px + padding-top: 2px + border-top: 1px + Row-Gaps
    h += 5 + Math.max(0, renderedSpouses.length - 1) * 2;
    const spouseHeaderLineH = Math.max(spec.lineHeightMeta, Math.ceil(spec.metaFontSize * 1.25));
    const spouseDateLineH = Math.max(spec.lineHeightMeta - 1, Math.ceil((spec.metaFontSize - 0.5) * 1.25));

    for (const sp of renderedSpouses) {
      let spH = 0;
      let hasHeader = false;
      const headerPieces: string[] = [];
      if (cfg.showMarriageCounter) headerPieces.push(`${sp.orderIndex}.`);
      if (cfg.showHenryId && sp.henryCode) headerPieces.push(`[${sp.henryCode}]`);
      if (cfg.showSpouseName && sp.fullName) headerPieces.push(sp.fullName);
      if (headerPieces.length > 0) {
        hasHeader = true;
        const spNameLines = wrapTextToWidth(
          `${cfg.showDivorce && sp.divorceText ? '⚮' : '⚭'} ${headerPieces.join(' ')}`,
          innerW,
          spec.metaFontSize,
          cfg.line4Bold,
          cfg.line4Italic
        );
        spH += Math.max(1, spNameLines.length) * spouseHeaderLineH;
      }
      const spDates: string[] = [];
      if (cfg.showMarriageDate && sp.marriageText) {
        spDates.push(sp.marriageText);
      }
      if (cfg.showDivorce && sp.divorceText) {
        spDates.push(sp.divorceText);
      }
      if ((cfg.showSpouseBirthDate || cfg.showSpouseBirthPlace) && sp.birthText) {
        spDates.push(sp.birthText);
      }
      if ((cfg.showSpouseDeathDate || cfg.showSpouseDeathPlace) && sp.deathText) {
        spDates.push(sp.deathText);
      }
      if (spDates.length > 0) {
        if (hasHeader) spH += 1; // .d-marriage-row gap: 1px
        if (cfg.lifeDatesLayout === 'single') {
          const wrapped = wrapTextToWidth(
            spDates.join(', '),
            innerW,
            spec.metaFontSize - 0.5,
            cfg.line5Bold,
            cfg.line5Italic
          );
          spH += Math.max(1, wrapped.length) * spouseDateLineH;
        } else {
          let dateLineCount = 0;
          for (const sd of spDates) {
            const wrapped = wrapTextToWidth(
              sd,
              innerW,
              spec.metaFontSize - 0.5,
              cfg.line5Bold,
              cfg.line5Italic
            );
            dateLineCount += Math.max(1, wrapped.length);
          }
          spH += dateLineCount * spouseDateLineH + Math.max(0, spDates.length - 1) * 1;
        }
      }
      h += Math.max(14, spH) + 2;
    }
  }

  const minCardH = profile === 'narrow' ? 40 : 46;
  return {
    width,
    height: Math.max(minCardH, Math.ceil(h)),
    lifeLines,
    spouses: renderedSpouses,
    occupationText,
    nameLineCount,
  };
}

export function computeCapsuleCardMetrics(
  profile: CardDensityProfile,
  name: string,
  personCount: number,
  generationSpan: number
): { width: number; height: number } {
  const spec = DENSITY_PROFILE_SPECS[profile] || DENSITY_PROFILE_SPECS.standard;
  const width = Math.max(spec.cardWidth, 160);
  const titleLines = wrapTextToWidth(name, width - 20, spec.nameFontSize, true, false);
  const h = 44 + Math.max(1, titleLines.length) * spec.lineHeightName + (personCount > 0 || generationSpan > 0 ? 18 : 0);
  return { width, height: Math.max(72, h) };
}
