import { formatLocalizedDate, type DesignCardConfig } from '../types/design';
import { DENSITY_PROFILE_SPECS, wrapTextToWidth } from '../domain/design/cardMetrics';
import type { SupportedLocale } from '../locales/registry';
import type {
  DesignSceneGraph,
  ScenePersonCard,
} from '../domain/design/sceneTypes';

export interface SceneExportOptions {
  includeGrid: boolean;
  includeBackground: boolean;
  onlyYears?: boolean;
  format: 'png' | 'jpg' | 'svg' | 'pdf';
  scale: number;
  pdfPaperSize?: 'auto' | 'a4' | 'a3' | 'a2' | 'a1' | 'a0';
  locale?: SupportedLocale;
}

export interface SceneExportResult {
  svgString: string;
  width: number;
  height: number;
  nodeCount: number;
}

function escapeXml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getEffectiveLifeLines(
  card: ScenePersonCard,
  forceOnlyYears: boolean | undefined,
  locale: SupportedLocale
): string[] {
  if (!forceOnlyYears) return card.lifeLines;
  // Kompakte Jahresdarstellung bei Bedarf erzwingen
  return card.lifeLines.map(line =>
    line.replace(/\b\d{2}\.\d{2}\.(\d{3,4})\b/g, '$1').replace(/\b(\d{1,2}\s+[A-Za-z]+\s+)(\d{3,4})\b/g, '$2')
  );
  void locale;
  void formatLocalizedDate;
}

function renderCardSvg(
  card: ScenePersonCard,
  ox: number,
  oy: number,
  forceOnlyYears: boolean | undefined,
  locale: SupportedLocale
): string {
  const x = card.x + ox;
  const y = card.y + oy;
  const w = card.width;
  const h = card.height;

  if (card.isCapsule && card.capsuleMeta) {
    const titleLines = wrapTextToWidth(card.capsuleMeta.name, w - 24, 12, true, false);
    const titleTspans = titleLines
      .map(
        (ln, i) =>
          `<tspan x="${x + w / 2}" dy="${i === 0 ? 0 : 15}">${escapeXml(ln)}</tspan>`
      )
      .join('');
    const statsLabel = `${card.capsuleMeta.personCount} Pers. · ${card.capsuleMeta.generationSpan} Gen.`;
    return `
      <g class="export-capsule-card">
        <rect x="${x + 3}" y="${y + 3}" width="${w}" height="${h}" rx="7" fill="#cbd5e1" opacity="0.7" />
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="#fffbeb" stroke="#d97706" stroke-width="1.8" stroke-dasharray="5 3" />
        <rect x="${x}" y="${y}" width="${w}" height="4" rx="2" fill="#f59e0b" />
        <text x="${x + w / 2}" y="${y + 20}" text-anchor="middle" font-size="9" font-weight="800" fill="#b45309">📁 SUB-BAUM KAPSEL</text>
        <text x="${x + w / 2}" y="${y + 37}" text-anchor="middle" font-size="12" font-weight="700" fill="#0f172a">${titleTspans}</text>
        <text x="${x + w / 2}" y="${y + h - 10}" text-anchor="middle" font-size="9.5" font-weight="600" fill="#78350f">${escapeXml(statsLabel)}</text>
      </g>`;
  }

  const cfg: DesignCardConfig = card.cardConfig;
  const spec = DENSITY_PROFILE_SPECS[card.densityProfile] || DENSITY_PROFILE_SPECS.standard;
  const innerW = w - spec.horizontalPadding * 2;
  const centerX = x + w / 2;

  const isMale = card.sex === 'M';
  const isFemale = card.sex === 'F';
  const accentColor = isMale ? '#2563eb' : isFemale ? '#db2777' : '#94a3b8';
  const borderColor = card.isSubtreeMember ? '#c084fc' : isMale ? '#93c5fd' : isFemale ? '#fbcfe8' : '#cbd5e1';
  const bgFill = card.isSubtreeMember ? '#faf5ff' : '#ffffff';

  const parts: string[] = [];
  parts.push(
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${bgFill}" stroke="${borderColor}" stroke-width="1.4" />`
  );
  parts.push(`<rect x="${x}" y="${y}" width="${w}" height="3" rx="1.5" fill="${accentColor}" />`);

  let curY = y + 14;

  // #1 Henry & Gen (mittig zentriert)
  const showHenry = cfg.showHenryId && Boolean(card.henryCode);
  const showGen = cfg.showGeneration && card.generation > 0;
  if (showHenry || showGen) {
    const fw = cfg.line1Bold ? '700' : '400';
    const fs = cfg.line1Italic ? 'italic' : 'normal';
    const topParts: string[] = [];
    if (showHenry) topParts.push(`[${card.henryCode}]`);
    if (showGen) topParts.push(`Gen. ${card.generation}`);
    parts.push(
      `<text x="${centerX}" y="${curY}" text-anchor="middle" font-size="9" font-weight="${fw}" font-style="${fs}" fill="#334155">${escapeXml(topParts.join('  '))}</text>`
    );
    curY += 15;
  }

  // #2 Name
  const nameLines = wrapTextToWidth(
    card.fullName || card.givenName || 'N.N.',
    innerW,
    spec.nameFontSize,
    cfg.line2Bold,
    cfg.line2Italic
  );
  const nameFw = cfg.line2Bold ? '700' : '400';
  const nameFs = cfg.line2Italic ? 'italic' : 'normal';
  const nameSvg = nameLines
    .map((ln, idx) => `<tspan x="${centerX}" dy="${idx === 0 ? 0 : spec.lineHeightName}">${escapeXml(ln)}</tspan>`)
    .join('');
  parts.push(
    `<text x="${centerX}" y="${curY}" text-anchor="middle" font-size="${spec.nameFontSize}" font-weight="${nameFw}" font-style="${nameFs}" fill="#0f172a">${nameSvg}</text>`
  );
  curY += Math.max(1, nameLines.length) * spec.lineHeightName + 2;

  // #3 Lebensdaten
  const effectiveLifeLines = getEffectiveLifeLines(card, forceOnlyYears, locale);
  if (effectiveLifeLines.length > 0) {
    const lFw = cfg.line3Bold ? '700' : '400';
    const lFs = cfg.line3Italic ? 'italic' : 'normal';
    const lifeSvg = effectiveLifeLines
      .map((ln, idx) => `<tspan x="${centerX}" dy="${idx === 0 ? 0 : spec.lineHeightMeta}">${escapeXml(ln)}</tspan>`)
      .join('');
    parts.push(
      `<text x="${centerX}" y="${curY}" text-anchor="middle" font-size="${spec.metaFontSize}" font-weight="${lFw}" font-style="${lFs}" fill="#475569">${lifeSvg}</text>`
    );
    curY += effectiveLifeLines.length * spec.lineHeightMeta + 2;
  }

  if (card.occupationText) {
    const occuLines = wrapTextToWidth(
      card.occupationText,
      innerW,
      spec.metaFontSize,
      cfg.line3Bold,
      cfg.line3Italic
    );
    if (occuLines.length > 0) {
      const oFw = cfg.line3Bold ? '700' : '400';
      const oFs = cfg.line3Italic ? 'italic' : 'normal';
      const oSvg = occuLines
        .map((ln, idx) => `<tspan x="${centerX}" dy="${idx === 0 ? 0 : spec.lineHeightMeta}">${escapeXml(ln)}</tspan>`)
        .join('');
      parts.push(
        `<text x="${centerX}" y="${curY}" text-anchor="middle" font-size="${spec.metaFontSize}" font-weight="${oFw}" font-style="${oFs}" fill="#64748b">${oSvg}</text>`
      );
      curY += occuLines.length * spec.lineHeightMeta + 2;
    }
  }

  // #4 & #5 Ehepartner
  if (card.spouses.length > 0) {
    parts.push(
      `<line x1="${x + spec.horizontalPadding}" y1="${curY - 4}" x2="${x + w - spec.horizontalPadding}" y2="${curY - 4}" stroke="#e2e8f0" stroke-width="0.8" stroke-dasharray="2 2" />`
    );
    curY += 5;

    for (const sp of card.spouses) {
      const headerPieces: string[] = [];
      if (cfg.showMarriageCounter) headerPieces.push(`${sp.orderIndex}.`);
      if (cfg.showHenryId && sp.henryCode) headerPieces.push(`[${sp.henryCode}]`);
      if (cfg.showSpouseName && sp.fullName) headerPieces.push(sp.fullName);
      if (headerPieces.length > 0) {
        const spHeaderText = `${cfg.showDivorce && sp.divorceText ? '⚮' : '⚭'} ${headerPieces.join(' ')}`;
        const spNameLines = wrapTextToWidth(
          spHeaderText,
          innerW,
          spec.metaFontSize,
          cfg.line4Bold,
          cfg.line4Italic
        );
        const sFw = cfg.line4Bold ? '700' : '400';
        const sFs = cfg.line4Italic ? 'italic' : 'normal';
        const sSvg = spNameLines
          .map((ln, idx) => `<tspan x="${centerX}" dy="${idx === 0 ? 0 : spec.lineHeightMeta}">${escapeXml(ln)}</tspan>`)
          .join('');
        parts.push(
          `<text x="${centerX}" y="${curY}" text-anchor="middle" font-size="${spec.metaFontSize}" font-weight="${sFw}" font-style="${sFs}" fill="#334155">${sSvg}</text>`
        );
        curY += Math.max(1, spNameLines.length) * spec.lineHeightMeta;
      }

      const spDates: string[] = [];
      if (cfg.showMarriageDate && sp.marriageText) spDates.push(sp.marriageText);
      if (cfg.showDivorce && sp.divorceText) spDates.push(sp.divorceText);
      if ((cfg.showSpouseBirthDate || cfg.showSpouseBirthPlace) && sp.birthText) {
        spDates.push(sp.birthText);
      }
      if ((cfg.showSpouseDeathDate || cfg.showSpouseDeathPlace) && sp.deathText) {
        spDates.push(sp.deathText);
      }

      if (spDates.length > 0) {
        const dFw = cfg.line5Bold ? '700' : '400';
        const dFs = cfg.line5Italic ? 'italic' : 'normal';
        const dateLines =
          cfg.lifeDatesLayout === 'single'
            ? wrapTextToWidth(spDates.join(', '), innerW, spec.metaFontSize - 0.5, cfg.line5Bold, cfg.line5Italic)
            : spDates;
        const dSvg = dateLines
          .map((ln, idx) => `<tspan x="${centerX}" dy="${idx === 0 ? 0 : spec.lineHeightMeta - 1}">${escapeXml(ln)}</tspan>`)
          .join('');
        parts.push(
          `<text x="${centerX}" y="${curY}" text-anchor="middle" font-size="${spec.metaFontSize - 0.5}" font-weight="${dFw}" font-style="${dFs}" fill="#64748b">${dSvg}</text>`
        );
        curY += dateLines.length * (spec.lineHeightMeta - 1);
      }
      curY += 4;
    }
  }

  return `<g class="export-person-card">${parts.join('')}</g>`;
}

export function generateSceneGraphSvg(
  scene: DesignSceneGraph,
  options: SceneExportOptions
): SceneExportResult {
  const ox = -scene.bounds.minX;
  const oy = -scene.bounds.minY;
  const width = scene.bounds.width;
  const height = scene.bounds.height;
  const locale = options.locale === 'en' ? 'en' : 'de';

  const svgChunks: string[] = [];

  // 1. Optionales Ebenenraster
  if (options.includeGrid) {
    for (const lvl of scene.levels) {
      const ly = lvl.topY + oy;
      svgChunks.push(
        `<rect x="0" y="${ly}" width="${width}" height="${lvl.height}" fill="${lvl.level % 2 === 0 ? '#f8fafc' : '#ffffff'}" opacity="0.65" />`
      );
      svgChunks.push(
        `<line x1="0" y1="${ly}" x2="${width}" y2="${ly}" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="4 4" />`
      );
      svgChunks.push(
        `<text x="12" y="${ly + 16}" font-size="11" font-weight="700" fill="#64748b">${escapeXml(lvl.label)}</text>`
      );
    }
  }

  // 2. Hintergrundbilder (Master & Sub-Bäume, Aspect-Ratio Lock)
  if (options.includeBackground) {
    for (const bg of scene.backgrounds) {
      svgChunks.push(
        `<image href="${escapeXml(bg.dataUrl)}" x="${bg.x + ox}" y="${bg.y + oy}" width="${bg.width}" height="${bg.height}" opacity="${bg.opacity}" preserveAspectRatio="xMidYMid meet" />`
      );
    }
  }

  // 3. Sub-Baum Rahmen
  for (const frame of scene.subtreeFrames) {
    const fx = frame.x + ox;
    const fy = frame.y + oy;
    svgChunks.push(
      `<rect x="${fx}" y="${fy}" width="${frame.width}" height="${frame.height}" rx="10" fill="rgba(168, 85, 247, 0.03)" stroke="#c084fc" stroke-width="1.5" stroke-dasharray="6 4" />`
    );
    svgChunks.push(
      `<text x="${fx + 10}" y="${fy + 16}" font-size="10.5" font-weight="700" fill="#7e22ce">${escapeXml(frame.subDocumentName)}</text>`
    );
  }

  // 4. Kanten / Verbindungslinien
  const edgeParts: string[] = [];
  for (const edge of scene.edges) {
    const strokeCol = edge.isSubtreeEdge ? '#9333ea' : '#64748b';
    edgeParts.push(
      `<g transform="translate(${ox}, ${oy})"><path d="${edge.svgPath}" fill="none" stroke="${strokeCol}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />`
    );
    if (edge.parentAnchor) {
      edgeParts.push(`<path d="${edge.parentAnchor.d}" fill="${strokeCol}" />`);
    }
    if (edge.childArrows) {
      for (const arr of edge.childArrows) {
        edgeParts.push(`<polygon points="${arr.points}" fill="${strokeCol}" />`);
      }
    }
    if (edge.marriageBadgeText && edge.marriageBadgePos) {
      edgeParts.push(
        `<rect x="${edge.marriageBadgePos.x - 13}" y="${edge.marriageBadgePos.y - 8}" width="26" height="15" rx="4" fill="#fef3c7" stroke="#f59e0b" stroke-width="1" />`
      );
      edgeParts.push(
        `<text x="${edge.marriageBadgePos.x}" y="${edge.marriageBadgePos.y + 3}" text-anchor="middle" font-size="9" font-weight="800" fill="#92400e">${escapeXml(edge.marriageBadgeText)}</text>`
      );
    }
    edgeParts.push('</g>');
  }
  svgChunks.push(`<g class="export-edges">${edgeParts.join('')}</g>`);

  // 5. Personenkacheln
  const cardParts = scene.cards.map(c =>
    renderCardSvg(c, ox, oy, options.onlyYears, locale)
  );
  svgChunks.push(`<g class="export-cards">${cardParts.join('')}</g>`);

  const bgRect =
    options.format === 'jpg' || options.format === 'pdf'
      ? `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff" />`
      : '';

  const svgString = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">${bgRect}${svgChunks.join('')}</svg>`;

  return {
    svgString,
    width,
    height,
    nodeCount: scene.cards.length,
  };
}

export async function renderSceneSvgToRaster(
  svgString: string,
  width: number,
  height: number,
  format: 'png' | 'jpg',
  scale: number = 2
): Promise<{ blob: Blob; effectiveScale: number; pixelWidth: number; pixelHeight: number }> {
  const MAX_DIM = 14000;
  const maxSafeScale = Math.min(scale, MAX_DIM / Math.max(1, width), MAX_DIM / Math.max(1, height));
  const effScale = Math.max(0.25, maxSafeScale);
  const pixelWidth = Math.max(1, Math.round(width * effScale));
  const pixelHeight = Math.max(1, Math.round(height * effScale));

  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = e => reject(new Error('SVG-Bild konnte nicht in Raster-Canvas geladen werden: ' + String(e)));
      i.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D Kontext nicht verfügbar.');

    if (format === 'jpg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, pixelWidth, pixelHeight);
    }
    ctx.scale(effScale, effScale);
    ctx.drawImage(img, 0, 0, width, height);

    const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
    const quality = format === 'jpg' ? 0.94 : undefined;
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Canvas Export leer.'))), mime, quality);
    });
    return { blob, effectiveScale: effScale, pixelWidth, pixelHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const DIN_POINTS: Record<'a4' | 'a3' | 'a2' | 'a1' | 'a0', [number, number]> = {
  a4: [595.28, 841.89],
  a3: [841.89, 1190.55],
  a2: [1190.55, 1683.78],
  a1: [1683.78, 2383.94],
  a0: [2383.94, 3370.39],
};

/**
 * Erzeugt eine direkt druckbare PDF-Datei (PDF 1.4) aus der hochauflösenden Stammbaum-Szene.
 */
export async function generateSceneGraphPdfBytes(
  svgString: string,
  width: number,
  height: number,
  scale: number = 2,
  paperSize: 'auto' | 'a4' | 'a3' | 'a2' | 'a1' | 'a0' = 'auto'
): Promise<Uint8Array> {
  const { blob, pixelWidth, pixelHeight } = await renderSceneSvgToRaster(
    svgString,
    width,
    height,
    'jpg',
    scale
  );
  const jpgBytes = new Uint8Array(await blob.arrayBuffer());

  // Seitenmaße in PDF Points (72 pt = 1 inch)
  let pageW: number;
  let pageH: number;
  if (paperSize === 'auto') {
    pageW = Math.max(200, width * 0.75);
    pageH = Math.max(200, height * 0.75);
  } else {
    const [shortSide, longSide] = DIN_POINTS[paperSize];
    if (width >= height) {
      pageW = longSide;
      pageH = shortSide;
    } else {
      pageW = shortSide;
      pageH = longSide;
    }
  }

  const margin = paperSize === 'auto' ? 12 : 24;
  const availW = pageW - margin * 2;
  const availH = pageH - margin * 2;
  const fitRatio = Math.min(availW / width, availH / height);
  const drawW = width * fitRatio;
  const drawH = height * fitRatio;
  const drawX = (pageW - drawW) / 2;
  const drawY = (pageH - drawH) / 2;

  const contentStreamStr = `q\n${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${drawX.toFixed(2)} ${drawY.toFixed(2)} cm\n/Im0 Do\nQ\n`;
  const encoder = new TextEncoder();

  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0]; // obj 0 unused
  let byteLen = 0;

  const pushStr = (s: string) => {
    const b = encoder.encode(s);
    chunks.push(b);
    byteLen += b.length;
  };
  const pushBytes = (b: Uint8Array) => {
    chunks.push(b);
    byteLen += b.length;
  };

  pushStr('%PDF-1.4\n');
  pushBytes(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  offsets.push(byteLen);
  pushStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  offsets.push(byteLen);
  pushStr('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

  offsets.push(byteLen);
  pushStr(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW.toFixed(2)} ${pageH.toFixed(2)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`
  );

  offsets.push(byteLen);
  pushStr(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pixelWidth} /Height ${pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpgBytes.length} >>\nstream\n`
  );
  pushBytes(jpgBytes);
  pushStr('\nendstream\nendobj\n');

  const contentBytes = encoder.encode(contentStreamStr);
  offsets.push(byteLen);
  pushStr(`5 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`);
  pushBytes(contentBytes);
  pushStr('endstream\nendobj\n');

  const xrefOffset = byteLen;
  pushStr(`xref\n0 ${offsets.length}\n`);
  pushStr('0000000000 65535 f \n');
  for (let i = 1; i < offsets.length; i++) {
    pushStr(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  pushStr(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  const out = new Uint8Array(byteLen);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}
