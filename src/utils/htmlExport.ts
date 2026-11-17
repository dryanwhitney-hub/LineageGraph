import { d3RawJs } from '../assets/vendor/d3.v7.min';
import { ICON_LIGHT_FAVICON_DATA_URL } from '../assets/faviconIconLight';
import packageJson from '../../package.json';
import { tLocale } from '../i18n';

const APP_VERSION = packageJson.version || '0.2.4';
const REPO_URL = 'https://github.com/dryanwhitney-hub/LineageGraph';
const DEVELOPER_NAME = 'David Whitney';
import {
  FALLBACK_LOCALE,
  SUPPORTED_LOCALES,
  getLocaleDefinition,
  resolveLocale,
  type SupportedLocale,
} from '../locales/registry';

const HTML_EXPORT_KEYS = [
  'searchPlaceholder',
  'noResults',
  'btnReset',
  'btnResetTip',
  'btnIsolate',
  'btnIsolateTip',
  'btnCollapse',
  'btnCollapseTip',
  'btnExpand',
  'btnExpandTip',
  'btnSpousesOn',
  'btnSpousesOff',
  'btnSpousesTip',
  'detailsHead',
  'detailsHint',
  'leg1',
  'leg2',
  'leg3',
  'badgeHenry',
  'badgeBranch',
  'badgeGen',
  'implexNoteTitle',
  'implexNoteBody',
  'seeLabel',
  'secBio',
  'secNotes',
  'secMarriages',
  'secChildren',
  'birth',
  'baptism',
  'death',
  'occupation',
  'religion',
  'residence',
  'father',
  'mother',
  'spouse',
  'spouseOf',
  'marriage',
  'divorce',
  'divorcedLabel',
  'yesLabel',
  'inPlace',
  'onDate',
  'marriedWith',
  'divorcedShort',
  'unknown',
  'mobileDetailsBtn',
  'menuBtn',
  'exportCredit',
  'infoBtn',
  'infoBtnTip',
  'infoAndFeedbackBtn',
  'infoAndFeedbackTip',
  'infoModalTitle',
  'exportDateLabel',
  'creatorLabel',
  'creatorContactLabel',
  'feedbackOpenBtn',
  'feedbackTitle',
  'feedbackRefLabel',
  'feedbackGeneralRef',
  'feedbackTabPerson',
  'feedbackTabSpouse',
  'feedbackTabChild',
  'feedbackTabNote',
  'firstName',
  'lastName',
  'sexLabel',
  'sexMale',
  'sexFemale',
  'sexUnknown',
  'dateLabel',
  'placeLabel',
  'feedbackNoteLabel',
  'feedbackNotePlaceholder',
  'feedbackSpouseSelect',
  'feedbackNewSpouse',
  'feedbackSpouseName',
  'feedbackChildHint',
  'feedbackChildParentsNote',
  'feedbackGeneralLabel',
  'feedbackGeneralPlaceholder',
  'feedbackSenderName',
  'feedbackSenderContact',
  'feedbackSendEmail',
  'feedbackCopyBtn',
  'feedbackCopied',
  'feedbackNoChanges',
  'zoomInTip',
  'zoomOutTip',
  'closeSidebarTip',
  'openSidebarTip',
  'mobileDetailsTip',
] as const;

export interface ExportSpouseConnection {
  id: string;
  date: string | null;
  place: string | null;
  divorce_date: string | null;
  is_divorced: boolean;
}

export interface ExportPersonInput {
  id: string;
  given_name: string | null;
  surname: string | null;
  sex: string | null;
  birth_date: string | null;
  birth_place: string | null;
  death_date: string | null;
  death_place: string | null;
  gedcom_extra: Record<string, any>;
  spouses: ExportSpouseConnection[];
  parent_ids: string[];
}

export interface ExportSpouseNode {
  order: number;
  name: string;
  marriage_date: string;
  marriage_place: string;
  divorce_date: string;
  birth_date: string;
  birth_place: string;
  death_date: string;
  death_place: string;
  father: string;
  mother: string;
  implex_code: string;
  implex_name: string;
}

export interface ExportTreeNode {
  id: string;
  henry_code: string;
  name: string;
  first_name: string;
  last_name: string;
  sex: string;
  branch: string | number;
  generation: number;
  birth_date: string;
  birth_place: string;
  baptism_date: string;
  baptism_place: string;
  death_date: string;
  death_place: string;
  occupation: string;
  religion: string;
  residence: string;
  notes: string;
  father: string;
  mother: string;
  spouses: ExportSpouseNode[];
  path_stopped: boolean;
  continued_code: string;
  continued_name: string;
  children: ExportTreeNode[];
}

export interface ExportStats {
  totalNodes: number;
  maxGeneration: number;
  implexCount: number;
  marriageCount: number;
  branchCount: number;
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

export function parseBirthSortKey(dateStr: string | null | undefined): [number, number, number] {
  const s = (dateStr || '').trim().toUpperCase();
  if (!s) return [9999, 99, 99];

  const partsDash = s.split(/[-/]/);
  if (partsDash.length >= 2 && partsDash[0].length === 4) {
    const y = parseInt(partsDash[0], 10);
    if (!isNaN(y)) {
      const m = partsDash[1] ? parseInt(partsDash[1], 10) || 99 : 99;
      const d = partsDash[2] ? parseInt(partsDash[2].split(/\s+/)[0], 10) || 99 : 99;
      return [y, m, d];
    }
  }

  const partsDot = s.split('.');
  if (partsDot.length === 3) {
    const yStr = partsDot[2].split(/\s+/)[0];
    const y = parseInt(yStr, 10);
    if (!isNaN(y) && y >= 100 && y <= 2999) {
      const d = parseInt(partsDot[0].replace(/\D/g, ''), 10) || 99;
      const m = parseInt(partsDot[1].trim(), 10) || 99;
      return [y, m, d];
    }
  }

  let year = 9999;
  let month = 99;
  let day = 99;

  const monthMap: Record<string, number> = {
    JAN: 1, JANUAR: 1, JANUARY: 1,
    FEB: 2, FEBRUAR: 2, FEBRUARY: 2,
    MAR: 3, 'MÄR': 3, MAER: 3, 'MÄRZ': 3, MARCH: 3,
    APR: 4, APRIL: 4,
    MAY: 5, MAI: 5,
    JUN: 6, JUNI: 6, JUNE: 6,
    JUL: 7, JULI: 7, JULY: 7,
    AUG: 8, AUGUST: 8,
    SEP: 9, SEPT: 9, SEPTEMBER: 9,
    OCT: 10, OKT: 10, OKTOBER: 10, OCTOBER: 10,
    NOV: 11, NOVEMBER: 11,
    DEC: 12, DEZ: 12, DEZEMBER: 12, DECEMBER: 12,
  };

  const tokens = s.split(/[^A-Z0-9ÄÖÜ]+/).filter(Boolean);
  for (const token of tokens) {
    if ((token.length === 4 || token.length === 3) && /^\d+$/.test(token)) {
      const y = parseInt(token, 10);
      if (y >= 100 && y <= 2999) {
        year = y;
        continue;
      }
    }
    if (monthMap[token] !== undefined) {
      month = monthMap[token];
      continue;
    }
    if (token.length <= 2 && /^\d+$/.test(token)) {
      const d = parseInt(token, 10);
      if (d >= 1 && d <= 31 && day === 99) {
        day = d;
      }
    }
  }

  return [year, month, day];
}

export function generateNextHenryCode(parentCode: string, childIndex: number): string {
  let suffix: string;
  if (childIndex >= 1 && childIndex <= 9) {
    suffix = String(childIndex);
  } else if (childIndex >= 10 && childIndex <= 20) {
    suffix = String.fromCharCode('A'.charCodeAt(0) + (childIndex - 10));
  } else {
    suffix = `X${childIndex}`;
  }
  return parentCode ? `${parentCode}${suffix}` : suffix;
}

function getFullName(p: ExportPersonInput | undefined, fallback = 'Unbekannt'): string {
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

export function buildInteractiveExportTree(
  persons: ExportPersonInput[],
  rootPersonId: string,
  startCode = '1'
): {
  rootNode: ExportTreeNode | null;
  stats: ExportStats;
  henryCodeMap: Map<string, { code: string; generation: number; branch: string | number }>;
} {
  const cleanStartCode = (startCode || '1').trim() || '1';
  const personMap = new Map<string, ExportPersonInput>();
  for (const p of persons) {
    personMap.set(p.id, p);
  }

  const rootPerson = personMap.get(rootPersonId);
  if (!rootPerson) {
    return {
      rootNode: null,
      stats: { totalNodes: 0, maxGeneration: 0, implexCount: 0, marriageCount: 0, branchCount: 0 },
      henryCodeMap: new Map(),
    };
  }

  // Build parent -> children map
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

  // 1. Find all biological descendants of rootPersonId (tree_members)
  const treeMembers = new Set<string>([rootPersonId]);
  const memberQueue: string[] = [rootPersonId];
  while (memberQueue.length > 0) {
    const currId = memberQueue.shift()!;
    const kids = childrenByParent.get(currId) || [];
    for (const cid of kids) {
      if (cid !== currId && !treeMembers.has(cid)) {
        treeMembers.add(cid);
        memberQueue.push(cid);
      }
    }
  }

  // 2. Assign Henry codes, generations, main branch, and parent-child tree links via BFS
  // Following patrilineal preference on implex (if father is in treeMembers, children continue under father;
  // otherwise under mother; if both are in treeMembers, mother's branch is marked path_stopped -> continued under father).
  const henryCodeMap = new Map<string, { code: string; generation: number; branch: string | number }>();
  const treeChildrenIds = new Map<string, string[]>();
  const continuedUnderIdMap = new Map<string, string>();
  const visited = new Set<string>();

  interface QueueItem {
    id: string;
    code: string;
    generation: number;
    branch: string | number;
  }

  const initialBranch: string | number = rootPerson.sex === 'F' ? 'Ahnin' : 'Stammvater';
  const queue: QueueItem[] = [
    { id: rootPersonId, code: cleanStartCode, generation: 1, branch: initialBranch },
  ];

  while (queue.length > 0) {
    const { id: currId, code, generation, branch } = queue.shift()!;
    if (visited.has(currId)) continue;
    visited.add(currId);

    henryCodeMap.set(currId, { code, generation, branch });

    const candidateChildren = childrenByParent.get(currId) || [];
    const continuingChildren: string[] = [];

    for (const cid of candidateChildren) {
      if (cid === currId) continue;
      const childPerson = personMap.get(cid);
      if (!childPerson) continue;

      const { father, mother } = resolveFatherMother(childPerson, personMap);
      const fatherInTree = father ? treeMembers.has(father.id) : false;
      const motherInTree = mother ? treeMembers.has(mother.id) : false;

      let shouldContinueHere = false;
      if (fatherInTree) {
        shouldContinueHere = father!.id === currId;
        // If current person is the mother and both parents are in treeMembers, record implex continuation under father
        if (motherInTree && mother!.id === currId && father!.id !== currId) {
          if (!continuedUnderIdMap.has(currId)) {
            continuedUnderIdMap.set(currId, father!.id);
          }
        }
      } else if (motherInTree) {
        shouldContinueHere = mother!.id === currId;
      } else {
        shouldContinueHere = true;
      }

      if (shouldContinueHere && !visited.has(cid) && !continuingChildren.includes(cid)) {
        continuingChildren.push(cid);
      }
    }

    // Sort children chronologically by birth date (with ID as tie-breaker)
    continuingChildren.sort((aId, bId) => {
      const pA = personMap.get(aId);
      const pB = personMap.get(bId);
      const kA = parseBirthSortKey(pA?.birth_date);
      const kB = parseBirthSortKey(pB?.birth_date);
      for (let i = 0; i < 3; i++) {
        if (kA[i] !== kB[i]) return kA[i] - kB[i];
      }
      return aId.localeCompare(bId);
    });

    treeChildrenIds.set(currId, continuingChildren);

    for (let idx = 0; idx < continuingChildren.length; idx++) {
      const childId = continuingChildren[idx];
      const nextCode = generateNextHenryCode(code, idx + 1);
      const nextGen = generation + 1;
      const nextBranch: string | number = generation === 1 ? idx + 1 : branch;
      queue.push({
        id: childId,
        code: nextCode,
        generation: nextGen,
        branch: nextBranch,
      });
    }
  }

  // 3. Build ExportTreeNode hierarchy recursively
  let totalNodes = 0;
  let maxGeneration = 0;
  let implexCount = 0;
  let marriageCount = 0;
  const branchSet = new Set<string | number>();

  function buildNode(personId: string): ExportTreeNode {
    const p = personMap.get(personId)!;
    const hInfo = henryCodeMap.get(personId)!;
    totalNodes++;
    if (hInfo.generation > maxGeneration) maxGeneration = hInfo.generation;
    if (typeof hInfo.branch === 'number') branchSet.add(hInfo.branch);

    // Parents with Henry codes if available
    const { father, mother } = resolveFatherMother(p, personMap);
    let fatherStr = '';
    if (father) {
      fatherStr = getFullName(father, '');
      const fCode = henryCodeMap.get(father.id)?.code;
      if (fatherStr && fCode) fatherStr += ` [${fCode}]`;
    }
    let motherStr = '';
    if (mother) {
      motherStr = getFullName(mother, '');
      const mCode = henryCodeMap.get(mother.id)?.code;
      if (motherStr && mCode) motherStr += ` [${mCode}]`;
    }

    // Spouses
    const spousesList: ExportSpouseNode[] = (p.spouses || []).map((spConn, idx) => {
      marriageCount++;
      const spPerson = personMap.get(spConn.id);
      const spName = getFullName(spPerson, 'Unbekannt');
      const spCode = henryCodeMap.get(spConn.id)?.code || '';

      let spFatherStr = '';
      let spMotherStr = '';
      if (spPerson) {
        const spParents = resolveFatherMother(spPerson, personMap);
        if (spParents.father) spFatherStr = getFullName(spParents.father, '');
        if (spParents.mother) spMotherStr = getFullName(spParents.mother, '');
      }

      const rawDivDate = (spConn.divorce_date || '').trim();
      const divorceDateVal = rawDivDate || (spConn.is_divorced ? 'Y' : '');

      return {
        order: idx + 1,
        name: spName,
        marriage_date: spConn.date || '',
        marriage_place: spConn.place || '',
        divorce_date: divorceDateVal,
        birth_date: spPerson?.birth_date || '',
        birth_place: spPerson?.birth_place || '',
        death_date: spPerson?.death_date || '',
        death_place: spPerson?.death_place || '',
        father: spFatherStr,
        mother: spMotherStr,
        implex_code: spCode && spCode !== cleanStartCode ? spCode : '',
        implex_name: spName,
      };
    });

    // Implex continuation (path_stopped)
    const continuedUnderId = continuedUnderIdMap.get(personId);
    let pathStopped = false;
    let continuedCode = '';
    let continuedName = '';
    if (continuedUnderId) {
      const cInfo = henryCodeMap.get(continuedUnderId);
      const cPerson = personMap.get(continuedUnderId);
      if (cInfo && cInfo.code) {
        pathStopped = true;
        continuedCode = cInfo.code;
        continuedName = getFullName(cPerson, '');
        implexCount++;
      }
    }

    const childIds = treeChildrenIds.get(personId) || [];
    const childNodes = childIds
      .filter(cid => henryCodeMap.has(cid))
      .map(cid => buildNode(cid));

    return {
      id: p.id,
      henry_code: hInfo.code,
      name: getFullName(p, 'Unbekannt'),
      first_name: p.given_name || '',
      last_name: p.surname || '',
      sex: p.sex || '',
      branch: hInfo.branch,
      generation: hInfo.generation,
      birth_date: p.birth_date || '',
      birth_place: p.birth_place || '',
      baptism_date: readGedcomSub(p.gedcom_extra, 'CHR', 'DATE'),
      baptism_place: readGedcomSub(p.gedcom_extra, 'CHR', 'PLAC'),
      death_date: p.death_date || '',
      death_place: p.death_place || '',
      occupation: readGedcomSub(p.gedcom_extra, 'OCCU', '_val'),
      religion: readGedcomSub(p.gedcom_extra, 'RELI', '_val'),
      residence:
        readGedcomSub(p.gedcom_extra, 'RESI', '_val') ||
        readGedcomSub(p.gedcom_extra, 'RESI', 'PLAC'),
      notes: readGedcomSub(p.gedcom_extra, 'NOTE', '_val'),
      father: fatherStr,
      mother: motherStr,
      spouses: spousesList,
      path_stopped: pathStopped,
      continued_code: continuedCode,
      continued_name: continuedName,
      children: childNodes,
    };
  }

  const rootNode = buildNode(rootPersonId);

  return {
    rootNode,
    stats: {
      totalNodes,
      maxGeneration,
      implexCount,
      marriageCount: Math.round(marriageCount / 2) || marriageCount,
      branchCount: branchSet.size,
    },
    henryCodeMap,
  };
}

export function generateInteractiveTreeHtml(
  rootNode: ExportTreeNode,
  options?: {
    customTitleDe?: string;
    customTitleEn?: string;
    defaultLang?: SupportedLocale;
    backgroundImageDataUrl?: string;
    backgroundImageOpacity?: number;
    creatorName?: string;
    creatorContact?: string;
    enableFeedbackForm?: boolean;
  }
): string {
  const familyLabel = (rootNode.last_name || rootNode.name || 'Familie').trim();
  const titleDe = (options?.customTitleDe || '').trim();
  const titleEn = (options?.customTitleEn || '').trim();
  const creatorName = (options?.creatorName || '').trim();
  const creatorContact = (options?.creatorContact || '').trim();
  const enableFeedbackForm = options?.enableFeedbackForm !== false;
  const rawBgUrl = (options?.backgroundImageDataUrl || '').trim();
  const safeBgDataUrl = rawBgUrl.startsWith('data:image/') ? escapeHtmlAttr(rawBgUrl) : '';
  const rawBgOpacity = options?.backgroundImageOpacity;
  const clampedBgOpacity =
    typeof rawBgOpacity === 'number' && Number.isFinite(rawBgOpacity)
      ? Math.min(100, Math.max(0, rawBgOpacity))
      : 100;
  const cssBgOpacity = Number((clampedBgOpacity / 100).toFixed(2));
  const initialLang = resolveLocale(options?.defaultLang) ?? FALLBACK_LOCALE;
  const initialBcp47 = getLocaleDefinition(initialLang).bcp47;

  const embeddedI18n: Record<string, Record<string, string>> = {};
  const embeddedBcp47: Record<string, string> = {};
  for (const loc of SUPPORTED_LOCALES) {
    const dict: Record<string, string> = {};
    if (loc.code === 'de' && titleDe) {
      dict.title = titleDe;
    } else if (loc.code === 'en' && titleEn) {
      dict.title = titleEn;
    } else {
      dict.title = tLocale('html_export.titleTemplate', loc.code, { family: familyLabel });
    }
    for (const key of HTML_EXPORT_KEYS) {
      dict[key] =
        key === 'exportCredit'
          ? tLocale(`html_export.${key}`, loc.code, { app: '{app}' })
          : tLocale(`html_export.${key}`, loc.code);
    }
    embeddedI18n[loc.code] = dict;
    embeddedBcp47[loc.code] = loc.bcp47;
  }

  const initialTitle = embeddedI18n[initialLang]?.title || familyLabel;
  const safeI18nJson = JSON.stringify(embeddedI18n).replace(/<\/script/gi, '<\\/script');
  const safeBcp47Json = JSON.stringify(embeddedBcp47).replace(/<\/script/gi, '<\\/script');
  const langOptionsHtml = SUPPORTED_LOCALES.map(
    (loc) =>
      `<button type="button" role="option" class="lang-option ${initialLang === loc.code ? 'active' : ''}" data-lang="${loc.code}" aria-selected="${initialLang === loc.code ? 'true' : 'false'}">
                <span class="lang-option-main">
                    <span class="lang-endonym">${escapeHtmlAttr(loc.endonym)}</span>
                    <span class="lang-iso">${loc.code.toUpperCase()}</span>${
                      'isBeta' in loc && loc.isBeta
                        ? `\n                    <span class="lang-beta">Beta</span>`
                        : ''
                    }
                </span>
                <span class="lang-check" aria-hidden="true">${initialLang === loc.code ? '✓' : ''}</span>
            </button>`
  ).join('\n            ');

  // Safely serialize D3 library and JSON data so "</script" cannot break the HTML parser
  const safeD3Js = d3RawJs.replace(/<\/script/gi, '<\\/script');
  const jsonStr = JSON.stringify(rootNode).replace(/<\/script/gi, '<\\/script');

  const exportDateIso = new Date().toISOString().slice(0, 10);
  const safeExportMetaJson = JSON.stringify({
    exportDateIso,
    creatorName,
    creatorContact,
    enableFeedbackForm,
  }).replace(/<\/script/gi, '<\\/script');

  return `<!DOCTYPE html>
<!-- Generated by LineageGraph v${APP_VERSION} (${REPO_URL}) · © 2026 ${DEVELOPER_NAME} · Exported: ${exportDateIso} -->
<html lang="${initialBcp47}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="default">
    <meta name="format-detection" content="telephone=no">
    <meta name="generator" content="LineageGraph ${escapeHtmlAttr(APP_VERSION)}">${
      creatorName ? `\n    <meta name="author" content="${escapeHtmlAttr(creatorName)}">` : ''
    }
    <link rel="icon" type="image/png" sizes="64x64" href="${ICON_LIGHT_FAVICON_DATA_URL}">
    <link rel="apple-touch-icon" href="${ICON_LIGHT_FAVICON_DATA_URL}">
    <title>${escapeHtmlAttr(initialTitle)} · LineageGraph</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        html, body {
            width: 100vw;
            height: 100vh;
            height: 100dvh;
            overflow: hidden;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            background-color: #f8fafc;
            color: #1e293b;
            margin: 0;
            padding: 0;
            position: relative;
            -webkit-text-size-adjust: 100%;
        }

        #toolbar {
            position: fixed;
            top: calc(16px + env(safe-area-inset-top, 0px));
            left: calc(16px + env(safe-area-inset-left, 0px));
            z-index: 100;
            background: #ffffff;
            padding: 8px 14px;
            border-radius: 8px;
            box-shadow: 0 4px 14px rgba(0,0,0,0.08);
            display: flex;
            gap: 8px;
            align-items: center;
            flex-wrap: wrap;
            max-width: calc(100vw - 430px);
        }

        #toolbar h1 {
            font-size: 15px;
            font-weight: 600;
            margin-right: 6px;
            color: #0f172a;
        }

        .lang-dropdown {
            position: relative;
            display: inline-flex;
            margin-right: 4px;
            flex-shrink: 0;
        }

        .lang-trigger {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            min-height: 36px;
            padding: 6px 10px;
            background: #f8fafc;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            color: #0f172a;
            font-size: 13px;
            font-weight: 700;
            cursor: pointer;
            touch-action: manipulation;
            -webkit-tap-highlight-color: transparent;
            transition: background 0.15s, border-color 0.15s;
        }

        .lang-trigger:hover,
        .lang-trigger[aria-expanded="true"] {
            background: #eef2ff;
            border-color: #93c5fd;
        }

        .lang-globe {
            width: 15px;
            height: 15px;
            color: #2563eb;
            flex-shrink: 0;
        }

        .lang-caret {
            font-size: 10px;
            color: #64748b;
            transition: transform 0.15s;
        }

        .lang-trigger[aria-expanded="true"] .lang-caret {
            transform: rotate(180deg);
        }

        .lang-menu {
            position: absolute;
            top: calc(100% + 6px);
            left: 0;
            min-width: 195px;
            background: #ffffff;
            border: 1px solid #cbd5e1;
            border-radius: 8px;
            padding: 4px;
            box-shadow: 0 12px 28px rgba(15, 23, 42, 0.16);
            z-index: 2000;
            display: none;
            flex-direction: column;
            gap: 2px;
        }

        .lang-menu.open {
            display: flex;
        }

        .lang-option {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            width: 100%;
            background: transparent;
            border: none;
            border-radius: 6px;
            padding: 8px 10px;
            font-size: 13px;
            color: #0f172a;
            text-align: left;
            cursor: pointer;
            transition: background 0.12s;
        }

        .lang-option:hover,
        .lang-option:focus-visible {
            background: #f1f5f9;
            outline: none;
        }

        .lang-option.active {
            background: #eff6ff;
            font-weight: 600;
        }

        .lang-option-main {
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }

        .lang-iso {
            font-size: 11px;
            font-weight: 700;
            color: #475569;
            background: #f1f5f9;
            border: 1px solid #cbd5e1;
            border-radius: 4px;
            padding: 1px 5px;
        }

        .lang-beta {
            font-size: 10px;
            font-weight: 700;
            color: #b45309;
            background: #fef3c7;
            border: 1px solid #fcd34d;
            border-radius: 999px;
            padding: 1px 6px;
        }

        .lang-check {
            color: #2563eb;
            font-weight: 700;
            font-size: 13px;
        }

        .search-wrapper {
            position: relative;
            width: 200px;
        }

        #search-input {
            width: 100%;
            min-height: 44px;
            padding: 8px 12px;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            font-size: 13px;
            outline: none;
            background: #ffffff;
            box-sizing: border-box;
            -webkit-appearance: none;
        }

        #search-input:focus {
            border-color: #2563eb;
            box-shadow: 0 0 0 2px rgba(37,99,235,0.15);
        }

        #search-results {
            position: absolute;
            top: 48px;
            left: 0;
            width: 300px;
            max-height: 280px;
            overflow-y: auto;
            -webkit-overflow-scrolling: touch;
            background: #ffffff;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            box-shadow: 0 6px 18px rgba(0,0,0,0.12);
            display: none;
            z-index: 200;
        }

        .search-item {
            min-height: 44px;
            padding: 10px 14px;
            border-bottom: 1px solid #f1f5f9;
            cursor: pointer;
            font-size: 13px;
            display: flex;
            flex-direction: column;
            justify-content: center;
            touch-action: manipulation;
        }

        .search-item:hover {
            background-color: #eff6ff;
        }

        .search-item .code {
            font-weight: 700;
            color: #2563eb;
            margin-right: 6px;
        }

        .search-item .meta {
            display: block;
            font-size: 11.5px;
            color: #64748b;
            margin-top: 2px;
        }

        .search-item-title {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 6px;
        }

        .search-item .spouse-badge {
            display: inline-flex;
            align-items: center;
            gap: 3px;
            padding: 1px 6px;
            border-radius: 999px;
            font-size: 11px;
            font-weight: 700;
            background: #fef3c7;
            color: #92400e;
            border: 1px solid #fde68a;
            flex-shrink: 0;
        }

        .search-item .spouse-context {
            display: block;
            font-size: 12px;
            color: #334155;
            margin-top: 2px;
        }

        button.btn {
            min-height: 36px;
            min-width: 36px;
            padding: 6px 11px;
            background: #f8fafc;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            font-size: 12.5px;
            color: #334155;
            cursor: pointer;
            transition: all 0.15s ease;
            white-space: nowrap;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 5px;
            touch-action: manipulation;
            -webkit-tap-highlight-color: transparent;
        }

        button:focus-visible {
            outline: 2px solid #2563eb;
            outline-offset: 2px;
        }

        button.btn:hover {
            background: #e2e8f0;
            color: #0f172a;
        }

        button.btn.active-toggle {
            background: #eff6ff;
            border-color: #2563eb;
            color: #1d4ed8;
            font-weight: 600;
        }

        .zoom-controls {
            position: fixed;
            bottom: calc(62px + env(safe-area-inset-bottom, 0px));
            left: calc(16px + env(safe-area-inset-left, 0px));
            z-index: 85;
            display: flex;
            flex-direction: column;
            background: rgba(255,255,255,0.94);
            border: 1px solid #cbd5e1;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.08);
            overflow: hidden;
        }

        .zoom-btn {
            width: 36px;
            height: 36px;
            border: none;
            background: transparent;
            color: #334155;
            font-size: 18px;
            font-weight: 600;
            line-height: 1;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            touch-action: manipulation;
            -webkit-tap-highlight-color: transparent;
        }

        .zoom-btn + .zoom-btn {
            border-top: 1px solid #e2e8f0;
        }

        .zoom-btn:hover {
            background: #eff6ff;
            color: #1d4ed8;
        }

        .toolbar-btn-group {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
        }

        .menu-dropdown-wrapper {
            display: none;
            position: relative;
        }

        .btn-menu-trigger {
            gap: 6px;
            font-weight: 600;
        }

        .btn-menu-trigger .menu-icon {
            font-size: 16px;
            line-height: 1;
        }

        .dropdown-menu-panel {
            position: absolute;
            top: calc(100% + 8px);
            right: 0;
            min-width: 220px;
            background: #ffffff;
            border: 1px solid #cbd5e1;
            border-radius: 8px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.15);
            display: none;
            flex-direction: column;
            padding: 6px;
            z-index: 300;
        }

        .dropdown-menu-panel.open {
            display: flex;
        }

        .dropdown-item {
            display: flex;
            align-items: center;
            gap: 10px;
            width: 100%;
            min-height: 44px;
            padding: 10px 14px;
            background: transparent;
            border: none;
            border-radius: 6px;
            font-size: 13.5px;
            color: #1e293b;
            cursor: pointer;
            text-align: left;
            transition: background 0.15s ease;
            touch-action: manipulation;
            -webkit-tap-highlight-color: transparent;
            box-sizing: border-box;
            white-space: nowrap;
        }

        .dropdown-item:hover, .dropdown-item:active {
            background: #eff6ff;
            color: #1d4ed8;
        }

        .dropdown-item.active-toggle {
            background: #eff6ff;
            color: #1d4ed8;
            font-weight: 600;
        }

        .dropdown-item .item-icon {
            font-size: 16px;
            width: 20px;
            text-align: center;
            flex-shrink: 0;
        }

        #bg-image-layer {
            position: fixed;
            inset: 0;
            width: 100vw;
            height: 100vh;
            height: 100dvh;
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: none;
            z-index: 0;
            overflow: hidden;
        }

        #bg-image-layer img {
            display: block;
            width: auto;
            height: auto;
            max-width: 100%;
            max-height: 100%;
            object-fit: contain;
            opacity: ${cssBgOpacity};
            user-select: none;
            -webkit-user-select: none;
            -webkit-user-drag: none;
        }

        #tree-container {
            position: absolute;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            height: 100dvh;
            cursor: grab;
            overflow: hidden;
            touch-action: none;
            -webkit-user-select: none;
            user-select: none;
            -webkit-tap-highlight-color: transparent;
            z-index: 1;
        }

        #tree-container svg {
            width: 100%;
            height: 100%;
            display: block;
            touch-action: none;
        }

        #tree-container:active {
            cursor: grabbing;
        }

        .node circle.in-circle {
            stroke-width: 2.2px;
            cursor: pointer;
            transition: r 0.2s, stroke 0.2s;
        }

        .node:hover circle.in-circle {
            r: 7.5px;
        }

        .node circle.touch-hitbox {
            cursor: pointer;
            -webkit-tap-highlight-color: transparent;
        }

        .node circle.out-pin {
            fill: #94a3b8;
            stroke: #64748b;
            stroke-width: 1px;
            transition: opacity 0.25s;
        }

        .node .text-group {
            cursor: pointer;
            -webkit-tap-highlight-color: transparent;
        }

        .node text {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            user-select: none;
        }

        .node .text-name {
            font-size: 12.5px;
            dominant-baseline: alphabetic;
        }

        .node .text-dates {
            font-size: 11px;
            fill: #64748b;
            dominant-baseline: hanging;
        }

        .node .text-spouse {
            font-size: 10px;
            fill: #475569;
            dominant-baseline: hanging;
            font-style: italic;
        }

        .node .henry-badge {
            font-weight: 700;
            fill: #1d4ed8;
        }

        .node.selected .text-name {
            font-weight: 700 !important;
            fill: #dc2626 !important;
        }

        .node.selected .text-name .henry-badge {
            fill: #dc2626 !important;
        }

        .node.selected circle.in-circle {
            stroke: #dc2626 !important;
            stroke-width: 3.5px;
        }

        .link {
            fill: none;
            stroke: #94a3b8;
            stroke-width: 1.5px;
            stroke-opacity: 0.8;
        }

        #sidebar {
            position: fixed;
            top: 0;
            right: 0;
            width: 400px;
            height: 100vh;
            height: 100dvh;
            background: #ffffff;
            border-left: 1px solid #e2e8f0;
            box-shadow: -4px 0 16px rgba(0,0,0,0.05);
            padding: calc(22px + env(safe-area-inset-top, 0px)) calc(22px + env(safe-area-inset-right, 0px)) calc(22px + env(safe-area-inset-bottom, 0px)) 22px;
            overflow-y: auto;
            -webkit-overflow-scrolling: touch;
            z-index: 90;
            transition: transform 0.3s ease;
            box-sizing: border-box;
        }

        #sidebar.collapsed-desktop {
            transform: translateX(100%);
        }

        #sidebar h2 {
            font-size: 17px;
            color: #0f172a;
            margin-bottom: 4px;
            padding-right: 48px;
        }

        .sidebar-close-btn {
            display: flex;
            position: absolute;
            top: calc(16px + env(safe-area-inset-top, 0px));
            right: calc(16px + env(safe-area-inset-right, 0px));
            background: #f1f5f9;
            color: #475569;
            border: 1px solid #e2e8f0;
            font-size: 16px;
            width: 44px;
            height: 44px;
            min-width: 44px;
            min-height: 44px;
            border-radius: 50%;
            cursor: pointer;
            align-items: center;
            justify-content: center;
            transition: all 0.15s ease;
            touch-action: manipulation;
            -webkit-tap-highlight-color: transparent;
        }

        .sidebar-close-btn:hover {
            background: #e2e8f0;
            color: #0f172a;
        }

        #desktop-reopen-sidebar-btn {
            display: none;
            position: fixed;
            top: calc(16px + env(safe-area-inset-top, 0px));
            right: calc(16px + env(safe-area-inset-right, 0px));
            z-index: 95;
            background: #ffffff;
            color: #1e293b;
            border: 1px solid #cbd5e1;
            box-shadow: 0 4px 12px rgba(15,23,42,0.1);
            min-height: 44px;
            padding: 8px 16px;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            align-items: center;
            gap: 6px;
            touch-action: manipulation;
        }

        #desktop-reopen-sidebar-btn:hover {
            background: #eff6ff;
            border-color: #93c5fd;
            color: #1d4ed8;
        }

        .child-jump-list {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .child-jump-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            min-height: 44px;
            padding: 10px 12px;
            font-size: 13px;
            cursor: pointer;
            transition: all 0.14s ease;
            touch-action: manipulation;
        }

        .child-jump-item:hover {
            background: #eff6ff;
            border-color: #93c5fd;
        }

        .child-jump-name {
            color: #1d4ed8;
            font-weight: 600;
        }

        .child-jump-dates {
            color: #64748b;
            font-size: 11.5px;
            white-space: nowrap;
        }

        .badge-line {
            display: flex;
            gap: 8px;
            margin-bottom: 16px;
            flex-wrap: wrap;
        }

        .badge {
            background: #eff6ff;
            color: #1d4ed8;
            font-weight: 600;
            font-size: 11.5px;
            padding: 3px 8px;
            border-radius: 4px;
        }

        .section-title {
            font-size: 11.5px;
            text-transform: uppercase;
            letter-spacing: 0.6px;
            color: #64748b;
            font-weight: 700;
            margin: 18px 0 8px 0;
            border-bottom: 1px solid #e2e8f0;
            padding-bottom: 4px;
        }

        .info-grid {
            display: grid;
            grid-template-columns: 115px 1fr;
            row-gap: 6px;
            column-gap: 8px;
            font-size: 12.5px;
        }

        .info-label {
            color: #64748b;
            font-weight: 500;
        }

        .info-val {
            color: #1e293b;
            word-break: break-word;
        }

        .spouse-card {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            padding: 10px 12px;
            margin-bottom: 10px;
            font-size: 12.5px;
            transition: border-color 0.25s ease, box-shadow 0.25s ease, background-color 0.25s ease;
        }

        .spouse-card.search-highlight {
            background: #fffbeb;
            border-color: #f59e0b;
            box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.22);
        }

        .spouse-card .sp-title {
            font-weight: 600;
            color: #0f172a;
            margin-bottom: 6px;
        }

        .implex-link {
            display: inline-flex;
            align-items: center;
            margin-top: 6px;
            min-height: 36px;
            color: #2563eb;
            text-decoration: underline;
            cursor: pointer;
            font-weight: 600;
            touch-action: manipulation;
        }

        .implex-link:hover {
            color: #1d4ed8;
        }

        .legend {
            position: fixed;
            bottom: calc(14px + env(safe-area-inset-bottom, 0px));
            left: calc(16px + env(safe-area-inset-left, 0px));
            background: rgba(255,255,255,0.94);
            padding: 8px 14px;
            border-radius: 6px;
            font-size: 11.5px;
            border: 1px solid #cbd5e1;
            display: flex;
            flex-wrap: wrap;
            gap: 8px 14px;
            max-width: calc(100vw - 400px);
            align-items: center;
            z-index: 80;
        }

        .legend-item {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            display: inline-block;
        }

        .legend-credit {
            padding-left: 12px;
            border-left: 1px solid #cbd5e1;
            color: #64748b;
            font-size: 11px;
            font-weight: 600;
            text-decoration: none;
            white-space: nowrap;
        }

        .legend-credit:hover {
            color: #2563eb;
            text-decoration: underline;
        }

        .sidebar-credit {
            margin-top: 20px;
            padding-top: 12px;
            border-top: 1px solid #e2e8f0;
            font-size: 11px;
            color: #64748b;
            line-height: 1.45;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }

        .sidebar-credit-icon {
            width: 24px;
            height: 24px;
            border-radius: 5px;
            border: 1px solid #e2e8f0;
            flex-shrink: 0;
            display: block;
        }

        .sidebar-credit a {
            color: #475569;
            font-weight: 600;
            text-decoration: none;
        }

        .sidebar-credit a:hover {
            color: #2563eb;
            text-decoration: underline;
        }

        /* Central Floating Mobile Details Button (bottom right) */
        #mobile-details-btn {
            display: none;
            position: fixed;
            bottom: calc(20px + env(safe-area-inset-bottom, 0px));
            right: calc(20px + env(safe-area-inset-right, 0px));
            z-index: 150;
            background: #2563eb;
            color: #ffffff;
            border: none;
            padding: 12px 20px;
            min-height: 48px;
            min-width: 48px;
            border-radius: 30px;
            font-size: 14px;
            font-weight: 600;
            box-shadow: 0 4px 16px rgba(37,99,235,0.35);
            cursor: pointer;
            align-items: center;
            gap: 8px;
            touch-action: manipulation;
            -webkit-tap-highlight-color: transparent;
        }

        #mobile-details-btn:active {
            background: #1d4ed8;
        }

        /* Responsive Breakpoints for Mobile UX */
        @media (max-width: 900px) {
            #toolbar {
                top: calc(8px + env(safe-area-inset-top, 0px));
                left: calc(8px + env(safe-area-inset-left, 0px));
                right: calc(8px + env(safe-area-inset-right, 0px));
                max-width: none;
                padding: 6px 10px;
                gap: 8px;
                display: flex;
                align-items: center;
                flex-wrap: nowrap;
                overflow: visible;
            }

            #toolbar h1 {
                display: none;
            }

            .lang-dropdown {
                flex-shrink: 0;
                margin-right: 0;
            }

            .lang-trigger {
                min-height: 44px;
            }

            .search-wrapper {
                flex: 1;
                min-width: 0;
                width: auto;
                position: relative;
            }

            #search-input {
                width: 100%;
                font-size: 16px; /* Prevents auto-zoom in iOS Safari */
            }

            #search-results {
                position: absolute;
                top: calc(100% + 6px);
                left: 0;
                width: 100%;
                min-width: 250px;
                max-width: calc(100vw - 28px);
                z-index: 300;
            }

            .toolbar-btn-group {
                display: none !important;
            }

            .menu-dropdown-wrapper {
                display: block;
                flex-shrink: 0;
            }

            .legend {
                display: none;
            }

            .btn-menu-trigger {
                min-height: 44px;
                min-width: 44px;
            }

            .zoom-controls {
                bottom: calc(20px + env(safe-area-inset-bottom, 0px));
                left: calc(14px + env(safe-area-inset-left, 0px));
            }

            .zoom-btn {
                width: 44px;
                height: 44px;
            }

            #sidebar {
                position: fixed;
                top: 0;
                right: 0;
                width: 100%;
                max-width: 420px;
                height: 100vh;
                height: 100dvh;
                transform: translateX(100%);
                z-index: 250;
                box-shadow: -8px 0 24px rgba(0,0,0,0.15);
            }

            #sidebar.open {
                transform: translateX(0);
            }

            .sidebar-close-btn {
                display: flex;
            }

            #mobile-details-btn {
                display: inline-flex;
            }
        }

        .sidebar-creator-meta {
            margin-top: 22px;
            padding: 10px 12px;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            font-size: 12px;
            color: #475569;
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .sidebar-creator-meta a {
            color: #2563eb;
            text-decoration: none;
            font-weight: 600;
        }

        .sidebar-creator-meta a:hover {
            text-decoration: underline;
        }

        .btn-feedback-inline {
            margin-top: 10px;
            width: 100%;
            min-height: 40px;
            padding: 8px 12px;
            background: #eff6ff;
            border: 1px solid #bfdbfe;
            border-radius: 6px;
            color: #1d4ed8;
            font-size: 12.5px;
            font-weight: 600;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            transition: background 0.15s, border-color 0.15s;
        }

        .btn-feedback-inline:hover {
            background: #dbeafe;
            border-color: #93c5fd;
        }

        .export-modal-backdrop {
            position: fixed;
            inset: 0;
            background: rgba(15, 23, 42, 0.52);
            z-index: 500;
            display: none;
            align-items: center;
            justify-content: center;
            padding: 16px;
        }

        .export-modal-backdrop.open {
            display: flex;
        }

        .export-modal-card {
            background: #ffffff;
            border-radius: 10px;
            box-shadow: 0 18px 44px rgba(15, 23, 42, 0.25);
            width: 100%;
            max-width: 580px;
            max-height: 90dvh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .export-modal-card.compact {
            max-width: 440px;
        }

        .export-modal-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 14px 18px;
            border-bottom: 1px solid #e2e8f0;
            background: #f8fafc;
        }

        .export-modal-header h3 {
            font-size: 15px;
            font-weight: 700;
            color: #0f172a;
            margin: 0;
        }

        .export-modal-close {
            width: 32px;
            height: 32px;
            border-radius: 6px;
            border: 1px solid #cbd5e1;
            background: #ffffff;
            color: #475569;
            font-size: 15px;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }

        .export-modal-close:hover {
            background: #f1f5f9;
            color: #0f172a;
        }

        .export-modal-body {
            padding: 16px 18px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 12px;
            font-size: 13px;
            color: #334155;
        }

        .info-meta-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 12px 14px;
        }

        .info-meta-row {
            display: flex;
            justify-content: space-between;
            gap: 12px;
            font-size: 13px;
        }

        .info-meta-label {
            color: #64748b;
            font-weight: 600;
        }

        .info-meta-value {
            color: #0f172a;
            text-align: right;
            word-break: break-word;
        }

        .feedback-context-bar {
            background: #eff6ff;
            border: 1px solid #bfdbfe;
            border-radius: 6px;
            padding: 8px 12px;
            font-size: 12.5px;
            color: #1e3a8a;
        }

        .feedback-tabs {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            border-bottom: 1px solid #e2e8f0;
            padding-bottom: 10px;
        }

        .feedback-tab-btn {
            padding: 6px 10px;
            border-radius: 6px;
            border: 1px solid #cbd5e1;
            background: #f8fafc;
            color: #475569;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
        }

        .feedback-tab-btn.active {
            background: #2563eb;
            border-color: #2563eb;
            color: #ffffff;
        }

        .feedback-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
        }

        .feedback-field {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .feedback-field.full {
            grid-column: 1 / -1;
        }

        .feedback-field label {
            font-size: 11.5px;
            font-weight: 600;
            color: #475569;
        }

        .feedback-field input,
        .feedback-field select,
        .feedback-field textarea {
            width: 100%;
            padding: 7px 10px;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            font-size: 13px;
            font-family: inherit;
            color: #0f172a;
            background: #ffffff;
        }

        .feedback-field input:focus,
        .feedback-field select:focus,
        .feedback-field textarea:focus {
            outline: none;
            border-color: #3b82f6;
            box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
        }

        .feedback-sender-box {
            border-top: 1px solid #e2e8f0;
            padding-top: 10px;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
        }

        .feedback-status-msg {
            font-size: 12px;
            font-weight: 600;
            padding: 6px 10px;
            border-radius: 6px;
            display: none;
        }

        .feedback-status-msg.success {
            display: block;
            background: #ecfdf5;
            color: #047857;
            border: 1px solid #a7f3d0;
        }

        .feedback-status-msg.error {
            display: block;
            background: #fef2f2;
            color: #b91c1c;
            border: 1px solid #fecaca;
        }

        .export-modal-footer {
            padding: 12px 18px;
            border-top: 1px solid #e2e8f0;
            background: #f8fafc;
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            justify-content: flex-end;
        }

        .btn-modal-primary {
            padding: 8px 14px;
            border-radius: 6px;
            border: 1px solid #2563eb;
            background: #2563eb;
            color: #ffffff;
            font-size: 12.5px;
            font-weight: 600;
            cursor: pointer;
        }

        .btn-modal-primary:hover {
            background: #1d4ed8;
        }

        .btn-modal-secondary {
            padding: 8px 14px;
            border-radius: 6px;
            border: 1px solid #cbd5e1;
            background: #ffffff;
            color: #1e293b;
            font-size: 12.5px;
            font-weight: 600;
            cursor: pointer;
        }

        .btn-modal-secondary:hover {
            background: #f1f5f9;
        }

        @media (max-width: 600px) {
            .feedback-grid,
            .feedback-sender-box {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>

    <div id="toolbar">
        <div class="lang-dropdown" id="lang-dropdown">
            <button type="button" class="lang-trigger" id="btn-lang-trigger" aria-haspopup="listbox" aria-expanded="false">
                <svg class="lang-globe" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="2" y1="12" x2="22" y2="12"></line>
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                </svg>
                <span id="lang-trigger-code">${initialLang.toUpperCase()}</span>
                <span class="lang-caret" aria-hidden="true">▾</span>
            </button>
            <div class="lang-menu" id="lang-menu" role="listbox">
                ${langOptionsHtml}
            </div>
        </div>
        <h1 id="ui-title">${escapeHtmlAttr(initialTitle)}</h1>
        <div class="search-wrapper">
            <input type="text" id="search-input" placeholder="Suche nach Name, Henry-Code, Ort...">
            <div id="search-results"></div>
        </div>

        <div class="toolbar-btn-group" id="toolbar-desktop-actions">
            <button type="button" class="btn" id="btn-isolate" title="Nur den ausgewählten Ast und dessen Vorfahren anzeigen">🔍 Äste isolieren</button>
            <button type="button" class="btn" id="btn-collapse" title="Alle Knoten im Stammbaum einklappen">📁 Einklappen</button>
            <button type="button" class="btn" id="btn-expand-step" title="Eine Generation weiter ausklappen">➕ +1 Generation</button>
            <button type="button" class="btn" id="btn-toggle-spouses" title="Anzeige der Ehepartner in den Knoten ein- oder ausschalten">👥 Ehepartner: Aus</button>
            <button type="button" class="btn" id="btn-export-info" title="Export-Infos, Ersteller & Korrektur/Ergänzung melden"><span id="ui-btn-info-icon">💬</span> <span id="ui-btn-info">Info & Feedback</span></button>
        </div>

        <div class="menu-dropdown-wrapper" id="menu-dropdown-wrapper">
            <button type="button" class="btn btn-menu-trigger" id="btn-mobile-menu" aria-haspopup="true" aria-expanded="false" title="Menü & Aktionen">
                <span class="menu-icon">☰</span>
                <span class="menu-label-text" id="ui-menu-label">Menü</span>
            </button>
            <div class="dropdown-menu-panel" id="toolbar-dropdown-menu">
                <button type="button" class="dropdown-item" id="m-btn-reset">
                    <span class="item-icon">🎯</span>
                    <span id="ui-m-reset">Zentrieren</span>
                </button>
                <button type="button" class="dropdown-item" id="m-btn-isolate">
                    <span class="item-icon">🔍</span>
                    <span id="ui-m-isolate">Äste isolieren</span>
                </button>
                <button type="button" class="dropdown-item" id="m-btn-collapse">
                    <span class="item-icon">📁</span>
                    <span id="ui-m-collapse">Einklappen</span>
                </button>
                <button type="button" class="dropdown-item" id="m-btn-expand-step">
                    <span class="item-icon">➕</span>
                    <span id="ui-m-expand">+1 Generation</span>
                </button>
                <button type="button" class="dropdown-item" id="m-btn-toggle-spouses">
                    <span class="item-icon">👥</span>
                    <span id="ui-m-spouses">Ehepartner: Aus</span>
                </button>
                <button type="button" class="dropdown-item" id="m-btn-export-info">
                    <span class="item-icon" id="ui-m-info-icon">💬</span>
                    <span id="ui-m-info">Info & Feedback</span>
                </button>
            </div>
        </div>
    </div>

    ${safeBgDataUrl ? `<div id="bg-image-layer" aria-hidden="true"><img src="${safeBgDataUrl}" alt="" /></div>\n    ` : ''}<div id="tree-container"></div>

    <div class="zoom-controls" aria-label="Zoom">
        <button type="button" class="zoom-btn" id="btn-zoom-in" title="Vergrößern" aria-label="Vergrößern">+</button>
        <button type="button" class="zoom-btn" id="btn-zoom-out" title="Verkleinern" aria-label="Verkleinern">−</button>
        <button type="button" class="zoom-btn" id="btn-reset" title="Ansicht auf den aktuell selektierten Eintrag zentrieren" aria-label="Zentrieren">⌖</button>
    </div>

    <button type="button" id="mobile-details-btn" title="Details des selektierten Eintrags anzeigen">
        <span>ℹ️</span> <span id="ui-mobile-details">Details</span>
    </button>

    <button type="button" id="desktop-reopen-sidebar-btn" title="Personen-Details einblenden">
        <span>◀</span> <span id="ui-desktop-details">Personen-Details</span>
    </button>

    <div id="sidebar">
        <button type="button" class="sidebar-close-btn" id="btn-close-sidebar" title="Details ein-/ausblenden">✕</button>
        <div id="details-content">
            <h2>Personen-Details</h2>
            <p style="font-size: 13px; color: #64748b; margin-top: 8px;">
                Klicken Sie im Stammbaum auf eine Person oder nutzen Sie das Suchfeld, um biografische Daten anzuzeigen.
            </p>
        </div>
        <div class="sidebar-creator-meta" id="ui-sidebar-creator-meta"></div>
        <div class="sidebar-credit" id="ui-sidebar-credit"></div>
    </div>

    <div class="legend">
        <div class="legend-item"><span class="dot" style="background:#3b82f6; border:2px solid #1d4ed8;"></span> <span id="ui-leg-1">Nachkommen vorhanden (zugeklappt)</span></div>
        <div class="legend-item"><span class="dot" style="background:#ffffff; border:2px solid #2563eb;"></span> <span id="ui-leg-2">Ausgeklappt / Blattknoten</span></div>
        <div class="legend-item"><span class="dot" style="background:#fde68a; border:2px solid #d97706;"></span> <span id="ui-leg-3">Implex-Verweis</span></div>
        <a class="legend-credit" href="${REPO_URL}" target="_blank" rel="noopener noreferrer" title="LineageGraph v${escapeHtmlAttr(APP_VERSION)}">LineageGraph</a>
    </div>

    <div class="export-modal-backdrop" id="export-info-modal" role="dialog" aria-modal="true" aria-labelledby="ui-info-modal-title">
        <div class="export-modal-card compact">
            <div class="export-modal-header">
                <h3 id="ui-info-modal-title">Export-Informationen</h3>
                <button type="button" class="export-modal-close" id="btn-close-info-modal" aria-label="Close">✕</button>
            </div>
            <div class="export-modal-body" id="export-info-modal-body"></div>
        </div>
    </div>

    <div class="export-modal-backdrop" id="feedback-modal" role="dialog" aria-modal="true" aria-labelledby="ui-feedback-modal-title">
        <div class="export-modal-card">
            <div class="export-modal-header">
                <h3 id="ui-feedback-modal-title">✏️ Korrektur oder Ergänzung melden</h3>
                <button type="button" class="export-modal-close" id="btn-close-feedback-modal" aria-label="Close">✕</button>
            </div>
            <div class="export-modal-body">
                <div class="feedback-context-bar" id="feedback-context-bar"></div>
                <div class="feedback-tabs" id="feedback-tabs"></div>
                <div id="feedback-tab-panel"></div>
                <div class="feedback-sender-box">
                    <div class="feedback-field">
                        <label id="ui-fb-sender-name-lbl" for="fb-sender-name">Ihr Name (optional)</label>
                        <input type="text" id="fb-sender-name" />
                    </div>
                    <div class="feedback-field">
                        <label id="ui-fb-sender-contact-lbl" for="fb-sender-contact">Ihre E-Mail / Telefon (optional)</label>
                        <input type="text" id="fb-sender-contact" />
                    </div>
                </div>
                <div class="feedback-status-msg" id="feedback-status-msg"></div>
            </div>
            <div class="export-modal-footer">
                <button type="button" class="btn-modal-secondary" id="btn-feedback-copy">📋 Text kopieren</button>
                <button type="button" class="btn-modal-primary" id="btn-feedback-email">✉️ Im E-Mail-Programm öffnen</button>
            </div>
        </div>
    </div>

    <!-- Self-contained Data Island & Inlined D3.js -->
    <script id="export-meta-json" type="application/json">
${safeExportMetaJson}
    </script>
    <script id="tree-data-json" type="application/json">
${jsonStr}
    </script>
    <script>
/* D3.js v7.9.2 - Fully Self-Contained Offline Bundle */
${safeD3Js}
    </script>
    <script>
const safeStorage = {
    _mem: {},
    getItem: function(key) {
        try {
            return window.localStorage ? window.localStorage.getItem(key) : (this._mem[key] || null);
        } catch (e) {
            return this._mem[key] || null;
        }
    },
    setItem: function(key, val) {
        try {
            if (window.localStorage) {
                window.localStorage.setItem(key, String(val));
            }
        } catch (e) {}
        this._mem[key] = String(val);
    }
};

const treeData = JSON.parse(document.getElementById("tree-data-json").textContent || "{}");

let currentLang = safeStorage.getItem("lineagegraph_export_lang") || ${JSON.stringify(initialLang)};
let showSpouses = safeStorage.getItem("lineagegraph_export_spouses") === "1";

const i18n = ${safeI18nJson};
const langBcp47 = ${safeBcp47Json};

function t(key) {
                    const dict = i18n[currentLang] || i18n.en || i18n.de;
                    return dict[key] || (i18n.en && i18n.en[key]) || (i18n.de && i18n.de[key]) || key;
}

const exportMeta = JSON.parse(document.getElementById("export-meta-json")?.textContent || "{}") || {};

function formatExportDate() {
                    const iso = exportMeta.exportDateIso || "";
                    if (!iso) return "";
                    try {
                        const parts = iso.split("-").map(Number);
                        if (parts.length === 3) {
                            const dt = new Date(parts[0], parts[1] - 1, parts[2]);
                            const loc = langBcp47[currentLang] || "de-DE";
                            return new Intl.DateTimeFormat(loc, { dateStyle: "medium" }).format(dt);
                        }
                    } catch (e) {}
                    return iso;
}

function isEmailAddress(val) {
                    return typeof val === "string" && /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(val.trim());
}

function renderCreatorMeta(hasSelectedPerson) {
                    const el = document.getElementById("ui-sidebar-creator-meta");
                    if (!el) return;
                    const dateStr = formatExportDate();
                    const rows = [];
                    if (dateStr) {
                        rows.push(\`<div><strong>\${escapeHtml(t("exportDateLabel"))}:</strong> \${escapeHtml(dateStr)}</div>\`);
                    }
                    if (exportMeta.creatorName) {
                        rows.push(\`<div><strong>\${escapeHtml(t("creatorLabel"))}:</strong> \${escapeHtml(exportMeta.creatorName)}</div>\`);
                    }
                    if (exportMeta.creatorContact) {
                        const c = exportMeta.creatorContact.trim();
                        const contactHtml = isEmailAddress(c)
                            ? \`<a href="mailto:\${escapeHtml(c)}">\${escapeHtml(c)}</a>\`
                            : escapeHtml(c);
                        rows.push(\`<div><strong>\${escapeHtml(t("creatorContactLabel"))}:</strong> \${contactHtml}</div>\`);
                    }
                    const showMetaFeedbackBtn = exportMeta.enableFeedbackForm && !(typeof hasSelectedPerson === "boolean" ? hasSelectedPerson : Boolean(selectedNode && selectedNode.data));
                    if (showMetaFeedbackBtn) {
                        rows.push(\`<button type="button" class="btn-feedback-inline" onclick="openFeedbackModal()">✏️ \${escapeHtml(t("feedbackOpenBtn"))}</button>\`);
                    }
                    el.innerHTML = rows.join("");
                    el.style.display = rows.length > 0 ? "flex" : "none";
}

const DATE_MONTH_MAP = {
                    JAN: 1, JANUAR: 1, JANUARY: 1, JANVIER: 1, JANEIRO: 1,
                    FEB: 2, FEBRUAR: 2, FEBRUARY: 2, FEV: 2, "FÉV": 2, FEVR: 2, "FÉVR": 2, FEVRIER: 2, "FÉVRIER": 2, FEVEREIRO: 2,
                    MAR: 3, "MÄR": 3, MRZ: 3, MAER: 3, MAERZ: 3, "MÄRZ": 3, MARCH: 3, MARS: 3, "MARÇO": 3, MARCO: 3,
                    APR: 4, APRIL: 4, AVR: 4, AVRIL: 4, ABR: 4, ABRIL: 4,
                    MAY: 5, MAI: 5, MAIO: 5,
                    JUN: 6, JUNI: 6, JUNE: 6, JUIN: 6, JUNHO: 6,
                    JUL: 7, JULI: 7, JULY: 7, JUIL: 7, JUILLET: 7, JULHO: 7,
                    AUG: 8, AUGUST: 8, "AOÛ": 8, AOU: 8, "AOÛT": 8, AOUT: 8, AGO: 8, AGOSTO: 8,
                    SEP: 9, SEPT: 9, SEPTEMBER: 9, SEPTEMBRE: 9, SET: 9, SETEMBRO: 9,
                    OCT: 10, OKT: 10, OKTOBER: 10, OCTOBER: 10, OCTOBRE: 10, OUT: 10, OUTUBRO: 10,
                    NOV: 11, NOVEMBER: 11, NOVEMBRE: 11, NOVEMBRO: 11,
                    DEC: 12, DEZ: 12, DEZEMBER: 12, DECEMBER: 12, "DÉC": 12, DECEMBRE: 12, "DÉCEMBRE": 12, DEZEMBRO: 12
};

const DATE_QUAL_DISPLAY = {
                    BEF: { de: "vor", en: "before", fr: "avant", pt: "antes de" },
                    AFT: { de: "nach", en: "after", fr: "après", pt: "depois de" },
                    ABT: { de: "ca.", en: "abt.", fr: "env.", pt: "cerca de" },
                    CAL: { de: "ber.", en: "cal.", fr: "calc.", pt: "calc." },
                    EST: { de: "gesch.", en: "est.", fr: "est.", pt: "est." }
};

function pad2Date(n) {
                    return n < 10 ? "0" + n : String(n);
}

function parseSimpleDateStr(raw) {
                    const s = (raw || "").trim();
                    if (!s) return null;
                    let m = s.match(/^(\\d{4})$/);
                    if (m) return { year: Number(m[1]), month: null, day: null };

                    m = s.match(/^(\\d{4})-(\\d{1,2})(?:-(\\d{1,2}))?$/);
                    if (m) {
                        const y = Number(m[1]), mo = Number(m[2]), d = m[3] ? Number(m[3]) : null;
                        if (mo >= 1 && mo <= 12 && (!d || (d >= 1 && d <= 31))) return { year: y, month: mo, day: d };
                    }

                    m = s.match(/^(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4})$/);
                    if (m) {
                        const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
                        if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return { year: y, month: mo, day: d };
                    }

                    m = s.match(/^(\\d{1,2})\\.(\\d{4})$/);
                    if (m) {
                        const mo = Number(m[1]), y = Number(m[2]);
                        if (mo >= 1 && mo <= 12) return { year: y, month: mo, day: null };
                    }

                    m = s.match(/^(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})$/);
                    if (m) {
                        const a = Number(m[1]), b = Number(m[2]), y = Number(m[3]);
                        if (a > 12 && b >= 1 && b <= 12) return { year: y, month: b, day: a };
                        if (b > 12 && a >= 1 && a <= 12) return { year: y, month: a, day: b };
                        if (b >= 1 && b <= 12 && a >= 1 && a <= 31) return { year: y, month: b, day: a };
                    }

                    m = s.match(/^(\\d{1,2})\\/(\\d{4})$/);
                    if (m) {
                        const mo = Number(m[1]), y = Number(m[2]);
                        if (mo >= 1 && mo <= 12) return { year: y, month: mo, day: null };
                    }

                    m = s.match(/^(?:(\\d{1,2})\\.?\\s+)?([A-Za-zÄÖÜäöüßÀ-ÿ]+)\\.?\\s+(\\d{4})$/);
                    if (m) {
                        const mo = DATE_MONTH_MAP[m[2].toUpperCase()];
                        if (mo) {
                            const d = m[1] ? Number(m[1]) : null;
                            if (!d || (d >= 1 && d <= 31)) return { year: Number(m[3]), month: mo, day: d };
                        }
                    }

                    m = s.match(/^([A-Za-zÄÖÜäöüßÀ-ÿ]+)\\.?\\s+(\\d{1,2}),\\s*(\\d{4})$/);
                    if (m) {
                        const mo = DATE_MONTH_MAP[m[1].toUpperCase()];
                        const d = Number(m[2]);
                        if (mo && d >= 1 && d <= 31) return { year: Number(m[3]), month: mo, day: d };
                    }
                    return null;
}

function formatSimpleDateForLocale(d, lang) {
                    if (!d.month) return String(d.year);
                    if (lang === "en") {
                        return d.day ? \`\${pad2Date(d.month)}/\${pad2Date(d.day)}/\${d.year}\` : \`\${pad2Date(d.month)}/\${d.year}\`;
                    }
                    if (lang === "fr" || lang === "pt") {
                        return d.day ? \`\${pad2Date(d.day)}/\${pad2Date(d.month)}/\${d.year}\` : \`\${pad2Date(d.month)}/\${d.year}\`;
                    }
                    return d.day ? \`\${pad2Date(d.day)}.\${pad2Date(d.month)}.\${d.year}\` : \`\${pad2Date(d.month)}.\${d.year}\`;
}

function localizeDateStr(str) {
                    const raw = (str || "").trim();
                    if (!raw) return "";
                    const lang = ["de", "en", "fr", "pt"].includes(currentLang) ? currentLang : "de";

                    let m = raw.match(/^(?:BET|BETWEEN|ZWISCHEN|ENTRE)\\s+(.+?)\\s+(?:AND|UND|ET|E)\\s+(.+)$/i);
                    if (m) {
                        const d1 = parseSimpleDateStr(m[1]), d2 = parseSimpleDateStr(m[2]);
                        if (d1 && d2) {
                            const words = { de: ["zwischen", "und"], en: ["between", "and"], fr: ["entre", "et"], pt: ["entre", "e"] }[lang];
                            return \`\${words[0]} \${formatSimpleDateForLocale(d1, lang)} \${words[1]} \${formatSimpleDateForLocale(d2, lang)}\`;
                        }
                    }

                    m = raw.match(/^(?:FROM|VON|DE)\\s+(.+?)\\s+(?:TO|BIS|À|A)\\s+(.+)$/i);
                    if (m) {
                        const d1 = parseSimpleDateStr(m[1]), d2 = parseSimpleDateStr(m[2]);
                        if (d1 && d2) {
                            const words = { de: ["von", "bis"], en: ["from", "to"], fr: ["de", "à"], pt: ["de", "a"] }[lang];
                            return \`\${words[0]} \${formatSimpleDateForLocale(d1, lang)} \${words[1]} \${formatSimpleDateForLocale(d2, lang)}\`;
                        }
                    }

                    const qualPatterns = [
                        { q: "BEF", re: /^(?:BEF\\.?|BEFORE|VOR|AVANT|ANTES\\s+DE)\\s+(.+)$/i },
                        { q: "AFT", re: /^(?:AFT\\.?|AFTER|NACH|APRÈS|APRES|DEPOIS\\s+DE)\\s+(.+)$/i },
                        { q: "ABT", re: /^(?:ABT\\.?|ABOUT|CA\\.?|CIRCA|UM|ETWA|ENV\\.?|ENVIRON|CERCA\\s+DE)\\s+(.+)$/i },
                        { q: "CAL", re: /^(?:CAL\\.?|BER\\.?|CALC\\.?)\\s+(.+)$/i },
                        { q: "EST", re: /^(?:EST\\.?|GESCH\\.?)\\s+(.+)$/i }
                    ];
                    for (let i = 0; i < qualPatterns.length; i++) {
                        const qm = raw.match(qualPatterns[i].re);
                        if (qm) {
                            const d = parseSimpleDateStr(qm[1]);
                            if (d) {
                                const qLabel = DATE_QUAL_DISPLAY[qualPatterns[i].q][lang];
                                return \`\${qLabel} \${formatSimpleDateForLocale(d, lang)}\`;
                            }
                        }
                    }

                    const exact = parseSimpleDateStr(raw);
                    if (exact) return formatSimpleDateForLocale(exact, lang);
                    return raw;
}

function updateStaticUI() {
                    document.title = t("title") + " · LineageGraph";
                    document.getElementById("ui-title").innerText = t("title");
                    document.getElementById("search-input").placeholder = t("searchPlaceholder");
                    const resetBtn = document.getElementById("btn-reset");
                    if (resetBtn) {
                        resetBtn.title = t("btnResetTip");
                        resetBtn.setAttribute("aria-label", t("btnReset"));
                    }
                    document.getElementById("btn-isolate").innerText = "🔍 " + t("btnIsolate");
                    document.getElementById("btn-isolate").title = t("btnIsolateTip");
                    document.getElementById("btn-collapse").innerText = "📁 " + t("btnCollapse");
                    document.getElementById("btn-collapse").title = t("btnCollapseTip");
                    document.getElementById("btn-expand-step").innerText = "➕ " + t("btnExpand");
                    document.getElementById("btn-expand-step").title = t("btnExpandTip");
                    const toggleBtn = document.getElementById("btn-toggle-spouses");
                    toggleBtn.innerText = "👥 " + (showSpouses ? t("btnSpousesOn") : t("btnSpousesOff"));
                    toggleBtn.title = t("btnSpousesTip");
                    toggleBtn.classList.toggle("active-toggle", showSpouses);
                    const hasFb = Boolean(exportMeta.enableFeedbackForm);
                    const infoIcon = hasFb ? "💬" : "ℹ️";
                    const infoLabel = hasFb ? t("infoAndFeedbackBtn") : t("infoBtn");
                    const infoTip = hasFb ? t("infoAndFeedbackTip") : t("infoBtnTip");
                    const infoBtn = document.getElementById("btn-export-info");
                    if (infoBtn) infoBtn.title = infoTip;
                    const uiBtnInfoIcon = document.getElementById("ui-btn-info-icon");
                    if (uiBtnInfoIcon) uiBtnInfoIcon.innerText = infoIcon;
                    const uiBtnInfo = document.getElementById("ui-btn-info");
                    if (uiBtnInfo) uiBtnInfo.innerText = infoLabel;
                    const uiMInfoIcon = document.getElementById("ui-m-info-icon");
                    if (uiMInfoIcon) uiMInfoIcon.innerText = infoIcon;
                    const uiMInfo = document.getElementById("ui-m-info");
                    if (uiMInfo) uiMInfo.innerText = infoLabel;
                    const zoomInBtn = document.getElementById("btn-zoom-in");
                    if (zoomInBtn) { zoomInBtn.title = t("zoomInTip"); zoomInBtn.setAttribute("aria-label", t("zoomInTip")); }
                    const zoomOutBtn = document.getElementById("btn-zoom-out");
                    if (zoomOutBtn) { zoomOutBtn.title = t("zoomOutTip"); zoomOutBtn.setAttribute("aria-label", t("zoomOutTip")); }
                    const closeSbBtn = document.getElementById("btn-close-sidebar");
                    if (closeSbBtn) closeSbBtn.title = t("closeSidebarTip");
                    const mobDetBtn = document.getElementById("mobile-details-btn");
                    if (mobDetBtn) mobDetBtn.title = t("mobileDetailsTip");
                    const deskOpenBtn = document.getElementById("desktop-reopen-sidebar-btn");
                    if (deskOpenBtn) deskOpenBtn.title = t("openSidebarTip");

                    const mLabel = document.getElementById("ui-menu-label");
                    if (mLabel) mLabel.innerText = t("menuBtn");
                    const mReset = document.getElementById("ui-m-reset");
                    if (mReset) mReset.innerText = t("btnReset");
                    const mIso = document.getElementById("ui-m-isolate");
                    if (mIso) mIso.innerText = t("btnIsolate");
                    const mCol = document.getElementById("ui-m-collapse");
                    if (mCol) mCol.innerText = t("btnCollapse");
                    const mExp = document.getElementById("ui-m-expand");
                    if (mExp) mExp.innerText = t("btnExpand");
                    const mSp = document.getElementById("ui-m-spouses");
                    if (mSp) mSp.innerText = showSpouses ? t("btnSpousesOn") : t("btnSpousesOff");
                    const mSpBtn = document.getElementById("m-btn-toggle-spouses");
                    if (mSpBtn) mSpBtn.classList.toggle("active-toggle", showSpouses);

                    document.getElementById("ui-leg-1").innerText = t("leg1");
                    document.getElementById("ui-leg-2").innerText = t("leg2");
                    document.getElementById("ui-leg-3").innerText = t("leg3");
                    const sbCredit = document.getElementById("ui-sidebar-credit");
                    if (sbCredit) {
                        const appLink = '<a href="${REPO_URL}" target="_blank" rel="noopener noreferrer">LineageGraph v${escapeHtmlAttr(APP_VERSION)}</a>';
                        const creditText = escapeHtml(t("exportCredit")).replace("{app}", appLink);
                        sbCredit.innerHTML = '<a href="${REPO_URL}" target="_blank" rel="noopener noreferrer" aria-label="LineageGraph"><img class="sidebar-credit-icon" src="${ICON_LIGHT_FAVICON_DATA_URL}" alt="LineageGraph" /></a><span>' + creditText + '</span>';
                    }
                    renderCreatorMeta();
                    if (document.getElementById("export-info-modal")?.classList.contains("open")) {
                        renderExportInfoModal();
                    }
                    document.getElementById("ui-mobile-details").innerText = t("mobileDetailsBtn");
                    const dReopen = document.getElementById("ui-desktop-details");
                    if (dReopen) dReopen.innerText = t("detailsHead");

                    if (selectedNode && selectedNode.data) {
                        renderDetails(selectedNode.data);
                    } else {
                        const cont = document.getElementById("details-content");
                        if (cont) {
                            cont.innerHTML = \`<h2>\${t("detailsHead")}</h2><p style="font-size: 13px; color: #64748b; margin-top: 8px;">\${t("detailsHint")}</p>\`;
                        }
                    }
                    update(root);
}

const langDropdown = document.getElementById("lang-dropdown");
const langTrigger = document.getElementById("btn-lang-trigger");
const langTriggerCode = document.getElementById("lang-trigger-code");
const langMenu = document.getElementById("lang-menu");
const langOptions = document.querySelectorAll(".lang-option");

if (!i18n[currentLang]) {
                    currentLang = ${JSON.stringify(initialLang)};
}

function syncLangDropdownUI() {
                    if (langTriggerCode) {
                        langTriggerCode.textContent = currentLang.toUpperCase();
                    }
                    langOptions.forEach((opt) => {
                        const isActive = opt.getAttribute("data-lang") === currentLang;
                        opt.classList.toggle("active", isActive);
                        opt.setAttribute("aria-selected", isActive ? "true" : "false");
                        const checkEl = opt.querySelector(".lang-check");
                        if (checkEl) checkEl.textContent = isActive ? "✓" : "";
                    });
}

function setLangMenuOpen(open) {
                    if (!langMenu || !langTrigger) return;
                    langMenu.classList.toggle("open", open);
                    langTrigger.setAttribute("aria-expanded", open ? "true" : "false");
}

syncLangDropdownUI();

if (langTrigger) {
                    langTrigger.addEventListener("click", (e) => {
                        e.stopPropagation();
                        const isOpen = langMenu && langMenu.classList.contains("open");
                        setLangMenuOpen(!isOpen);
                    });
}

langOptions.forEach((opt) => {
                    opt.addEventListener("click", () => {
                        const nextLang = opt.getAttribute("data-lang");
                        if (!nextLang) return;
                        currentLang = nextLang;
                        safeStorage.setItem("lineagegraph_export_lang", nextLang);
                        document.documentElement.lang = langBcp47[nextLang] || nextLang;
                        document.title = t("title");
                        syncLangDropdownUI();
                        setLangMenuOpen(false);
                        updateStaticUI();
                    });
});

document.addEventListener("click", (e) => {
                    if (langDropdown && !langDropdown.contains(e.target)) {
                        setLangMenuOpen(false);
                    }
});

document.addEventListener("keydown", (e) => {
                    if (e.key === "Escape") {
                        setLangMenuOpen(false);
                    }
});

const toggleSpousesBtn = document.getElementById("btn-toggle-spouses");
if (showSpouses) {
                    toggleSpousesBtn.classList.add("active-toggle");
}
toggleSpousesBtn.addEventListener("click", () => {
                    showSpouses = !showSpouses;
                    safeStorage.setItem("lineagegraph_export_spouses", showSpouses ? "1" : "0");
                    toggleSpousesBtn.innerText = "👥 " + (showSpouses ? t("btnSpousesOn") : t("btnSpousesOff"));
                    toggleSpousesBtn.classList.toggle("active-toggle", showSpouses);
                    const mSp = document.getElementById("ui-m-spouses");
                    if (mSp) mSp.innerText = showSpouses ? t("btnSpousesOn") : t("btnSpousesOff");
                    const mSpBtn = document.getElementById("m-btn-toggle-spouses");
                    if (mSpBtn) mSpBtn.classList.toggle("active-toggle", showSpouses);
                    update(selectedNode || root);
                    centerNode(selectedNode || root);
});

const container = document.getElementById("tree-container");
const svg = d3.select("#tree-container").append("svg").attr("width", "100%").attr("height", "100%");
const g = svg.append("g");

let isPanningOrDragging = false;
let dragStartX = 0, dragStartY = 0;

const zoom = d3.zoom()
                    .scaleExtent([0.15, 3.5])
                    .on("start", (event) => {
                        if (event.sourceEvent) {
                            const touch = event.sourceEvent.touches ? event.sourceEvent.touches[0] : event.sourceEvent;
                            dragStartX = touch.clientX; dragStartY = touch.clientY;
                        }
                    })
                    .on("zoom", (event) => {
                        g.attr("transform", event.transform);
                        if (event.sourceEvent) {
                            const touch = event.sourceEvent.touches ? event.sourceEvent.touches[0] : event.sourceEvent;
                            if (touch) {
                                const dist = Math.hypot(touch.clientX - dragStartX, touch.clientY - dragStartY);
                                if (dist > 6) {
                                    isPanningOrDragging = true;
                                }
                            }
                        }
                    })
                    .on("end", () => { setTimeout(() => { isPanningOrDragging = false; }, 60); });

svg.call(zoom);

const root = d3.hierarchy(treeData, d => d.children);
root.posX0 = 0;
root.posY0 = 0;

const allNodesFlat = [];
const nodeByHenry = {};

function indexNodes(d3Node) {
                    allNodesFlat.push(d3Node);
                    nodeByHenry[d3Node.data.henry_code] = d3Node;
                    const kids = d3Node.children || d3Node._children;
                    if (kids) kids.forEach(indexNodes);
}
indexNodes(root);

function collapse(d) {
                    if (d.children) {
                        d._children = d.children;
                        d._children.forEach(collapse);
                        d.children = null;
                    }
}
if (root.children) root.children.forEach(c => collapse(c));

let selectedNode = root;

function extractDatesLine(data) {
                    let b = data.birth_date ? \`* \${localizeDateStr(data.birth_date)}\` : "";
                    let d = data.death_date ? \`† \${localizeDateStr(data.death_date)}\` : "";
                    if (b && d) return \`\${b}, \${d}\`;
                    if (b) return b;
                    if (d) return d;
                    return "";
}

function getSpouseLines(data) {
                    if (!showSpouses || !data.spouses || data.spouses.length === 0) return [];
                    return data.spouses.map((sp, idx) => {
                        let prefix = data.spouses.length > 1 ? \`(\${idx + 1}) \` : "";
                        let text = \`\${prefix}⚭ \${sp.name}\`;
                        let details = [];
                        if (sp.marriage_date) details.push(\`⚭ \${localizeDateStr(sp.marriage_date)}\`);

                        if (sp.divorce_date) {
                            let divYear = sp.divorce_date.trim();
                            if (divYear.toUpperCase() === "Y") {
                                details.push(\`\${t("divorcedShort").trim()}\`);
                            } else {
                                let m = divYear.match(/(1[4-9]\\d{2}|20\\d{2})/);
                                let divStr = m ? m[1] : localizeDateStr(sp.divorce_date);
                                details.push(\`\${t("divorcedShort")}\${divStr}\`);
                            }
                        } else if (sp.death_date) {
                            let dYear = sp.death_date;
                            let m = dYear.match(/(1[4-9]\\d{2}|20\\d{2})/);
                            let dStr = m ? m[1] : localizeDateStr(sp.death_date);
                            details.push(\`† \${dStr}\`);
                        }
                        if (details.length > 0) text += \` (\${details.join(", ")})\`;
                        return text;
                    });
}

function getNodeHeight(d) {
                    const hasDates = !!extractDatesLine(d.data);
                    const spouseCount = (showSpouses && d.data.spouses) ? d.data.spouses.length : 0;
                    const topPadding = 20;
                    const bottomContent = (hasDates ? 16 : 0) + spouseCount * 16;
                    const bottomPadding = Math.max(14, bottomContent + 12);
                    return topPadding + bottomPadding + 14;
}

function getNodeTextWidth(d) {
                    if (d._measuredWidth && d._measuredWidth > 0 && d._lastSpouseState === showSpouses) {
                        return d._measuredWidth;
                    }
                    const line1 = \`\${d.data.henry_code ? d.data.henry_code + '. ' : ''}\${d.data.name}\${d.data.path_stopped ? " ↪" : ""}\`;
                    let maxEst = line1.length * 9.5;

                    const dates = extractDatesLine(d.data);
                    if (dates) {
                        const datesW = dates.length * 8.0;
                        if (datesW > maxEst) maxEst = datesW;
                    }

                    if (showSpouses && d.data.spouses && d.data.spouses.length > 0) {
                        const spLines = getSpouseLines(d.data);
                        for (const sp of spLines) {
                            const spW = sp.length * 7.8;
                            if (spW > maxEst) maxEst = spW;
                        }
                    }
                    return Math.max(160, Math.ceil(maxEst));
}

function layoutVerticalTree(rootNode) {
                    function calcSubtreeHeight(node) {
                        node._selfHeight = getNodeHeight(node);
                        if (!node.children || node.children.length === 0) {
                            node._subtreeHeight = node._selfHeight;
                            return node._subtreeHeight;
                        }
                        let totalKidsHeight = 0;
                        for (let i = 0; i < node.children.length; i++) {
                            totalKidsHeight += calcSubtreeHeight(node.children[i]);
                            if (i > 0) totalKidsHeight += 12;
                        }
                        node._subtreeHeight = Math.max(node._selfHeight, totalKidsHeight);
                        return node._subtreeHeight;
                    }
                    calcSubtreeHeight(rootNode);

                    function assignY(node, topY) {
                        if (!node.children || node.children.length === 0) {
                            const hasDates = !!extractDatesLine(node.data);
                            const spouseCount = (showSpouses && node.data.spouses) ? node.data.spouses.length : 0;
                            const topPadding = 18;
                            const bottomContent = (hasDates ? 14 : 0) + spouseCount * 14;
                            const bottomPadding = Math.max(12, bottomContent + 10);
                            const totalNodeH = topPadding + bottomPadding;
                            const extraSpace = Math.max(0, node._subtreeHeight - totalNodeH);
                            node.posY = topY + extraSpace / 2 + topPadding;
                            return;
                        }
                        let totalKidsHeight = 0;
                        for (let i = 0; i < node.children.length; i++) {
                            totalKidsHeight += node.children[i]._subtreeHeight;
                            if (i > 0) totalKidsHeight += 12;
                        }
                        let currentY = topY;
                        if (node._subtreeHeight > totalKidsHeight) {
                            currentY += (node._subtreeHeight - totalKidsHeight) / 2;
                        }
                        for (let i = 0; i < node.children.length; i++) {
                            const child = node.children[i];
                            assignY(child, currentY);
                            currentY += child._subtreeHeight + 12;
                        }
                        const firstY = node.children[0].posY;
                        const lastY = node.children[node.children.length - 1].posY;
                        node.posY = (firstY + lastY) / 2;
                    }
                    assignY(rootNode, 0);

                    const rootY = rootNode.posY;
                    function shiftY(node) {
                        node.posY -= rootY;
                        if (node.children) node.children.forEach(shiftY);
                    }
                    shiftY(rootNode);
}

function computeGenerationOffsets(visibleNodes) {
                    const maxGenWidth = {};
                    visibleNodes.forEach(d => {
                        const w = getNodeTextWidth(d);
                        if (!maxGenWidth[d.depth] || w > maxGenWidth[d.depth]) {
                            maxGenWidth[d.depth] = w;
                        }
                    });
                    const maxDepth = d3.max(visibleNodes, n => n.depth) || 0;
                    const levelXOffset = { 0: 0 };
                    for (let dep = 1; dep <= maxDepth + 1; dep++) {
                        const genWidth = Math.max(160, maxGenWidth[dep - 1] || 160);
                        // 12px circle-to-text gap + genWidth + 16px text-end margin + 85px connector corridor
                        levelXOffset[dep] = levelXOffset[dep - 1] + 12 + genWidth + 16 + 85;
                    }
                    visibleNodes.forEach(d => {
                        d.posX = levelXOffset[d.depth];
                    });
}

function escapeHtml(str) {
                    if (!str) return "";
                    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function refreshSelectionClasses() {
                    g.selectAll("g.node").classed("selected", d => d === selectedNode);
}

function renderLink(s, d) {
                    const sWidth = getNodeTextWidth(s);
                    let sX = (s.posX ?? 0) + 12 + sWidth + 10;
                    const sY = s.posY ?? 0;
                    const tX = d.posX ?? 0;
                    const tY = d.posY ?? 0;
                    // Strict forward enforcement: sX must never be past tX - 25px
                    if (sX >= tX - 25) {
                        sX = tX - 25;
                    }
                    const midX = (sX + tX) / 2;
                    return \`M \${sX} \${sY} C \${midX} \${sY}, \${midX} \${tY}, \${tX} \${tY}\`;
}

function update(source) {
                    const nodes = root.descendants();
                    const links = root.links();

                    layoutVerticalTree(root);
                    computeGenerationOffsets(nodes);

                    const t_anim = svg.transition().duration(350);
                    const node = g.selectAll("g.node").data(nodes, d => d.data.id);

                    const nodeEnter = node.enter().append("g")
                        .attr("class", d => "node" + (selectedNode === d ? " selected" : ""))
                        .attr("transform", () => \`translate(\${source.posX0 ?? source.posX ?? 0},\${source.posY0 ?? source.posY ?? 0})\`)
                        .style("opacity", 1e-6);

                    nodeEnter.append("circle")
                        .attr("class", "in-circle")
                        .attr("r", 1e-6)
                        .attr("cx", 0)
                        .attr("cy", 0)
                        .style("fill", d => d.data.path_stopped ? "#fde68a" : (d._children ? "#3b82f6" : "#ffffff"))
                        .style("stroke", d => d.data.path_stopped ? "#d97706" : (d._children ? "#1d4ed8" : "#2563eb"))
                        .on("click", (event, d) => {
                            event.stopPropagation();
                            if (isPanningOrDragging) return;
                            selectedNode = d;
                            refreshSelectionClasses();
                            if (d.children) { d._children = d.children; d.children = null; }
                            else if (d._children) { d.children = d._children; d._children = null; }
                            update(d);
                            renderDetails(d.data);
                        });

                    // Invisible touch target (diameter 44px) for iOS/Android finger touch
                    nodeEnter.append("circle")
                        .attr("class", "touch-hitbox")
                        .attr("r", 22)
                        .attr("cx", 0)
                        .attr("cy", 0)
                        .style("fill", "transparent")
                        .style("stroke", "transparent")
                        .style("cursor", "pointer")
                        .on("click", (event, d) => {
                            event.stopPropagation();
                            if (isPanningOrDragging) return;
                            selectedNode = d;
                            refreshSelectionClasses();
                            if (d.children) { d._children = d.children; d.children = null; }
                            else if (d._children) { d.children = d._children; d._children = null; }
                            update(d);
                            renderDetails(d.data);
                        });

                    const textGroup = nodeEnter.append("g")
                        .attr("class", "text-group")
                        .on("click", (event, d) => {
                            event.stopPropagation();
                            if (isPanningOrDragging) return;
                            selectedNode = d;
                            refreshSelectionClasses();
                            renderDetails(d.data);
                            if (d._children) {
                                d.children = d._children;
                                d._children = null;
                                update(d);
                            }
                        });

                    const textName = textGroup.append("text").attr("class", "text-name").attr("x", 12).attr("y", -6);
                    textName.append("tspan").attr("class", "henry-badge").text(d => d.data.henry_code ? (d.data.henry_code + ". ") : "");
                    textName.append("tspan").attr("class", "name-part").text(d => d.data.name);
                    textName.append("tspan").attr("fill", "#f59e0b").text(d => d.data.path_stopped ? " ↪" : "");

                    textGroup.append("text").attr("class", "text-dates").attr("x", 12).attr("y", 6);
                    textGroup.append("g").attr("class", "spouses-group");

                    const nodeUpdate = nodeEnter.merge(node);
                    nodeUpdate.classed("selected", d => d === selectedNode);

                    nodeUpdate.each(function(d) {
                        const group = d3.select(this);
                        let badgeWidth = 0;
                        const badgeText = d.data.henry_code ? (d.data.henry_code + ". ") : "";
                        if (badgeText.length > 0) {
                            const henryNode = group.select(".henry-badge").node();
                            const nameTextNode = group.select(".text-name").node();

                            // 1. Try getComputedTextLength on the tspan (standard SVG API, supported across all browsers)
                            if (henryNode && typeof henryNode.getComputedTextLength === "function") {
                                try {
                                    const len = henryNode.getComputedTextLength();
                                    if (len > 0 && len <= badgeText.length * 12) {
                                        badgeWidth = Math.ceil(len);
                                    }
                                } catch (e) {}
                            }

                            // 2. Try getSubStringLength on parent text element if tspan measurement is unavailable
                            if (badgeWidth === 0 && nameTextNode && typeof nameTextNode.getSubStringLength === "function") {
                                try {
                                    const len = nameTextNode.getSubStringLength(0, badgeText.length);
                                    if (len > 0 && len <= badgeText.length * 12) {
                                        badgeWidth = Math.ceil(len);
                                    }
                                } catch (e) {}
                            }

                            // 3. Fallback: Proportional character width estimation for Henry code (prevents WebKit parent getBBox bug)
                            if (badgeWidth === 0) {
                                let approx = 0;
                                for (let i = 0; i < badgeText.length; i++) {
                                    const ch = badgeText[i];
                                    if (ch === '.' || ch === ' ') approx += 3.8;
                                    else approx += 7.8;
                                }
                                badgeWidth = Math.ceil(approx);
                            }
                        }

                        const datesStr = extractDatesLine(d.data);
                        group.select(".text-dates")
                            .attr("x", 12 + badgeWidth)
                            .attr("y", 6)
                            .text(datesStr)
                            .style("display", datesStr ? "block" : "none");

                        const spLines = (showSpouses && d.data.spouses) ? getSpouseLines(d.data) : [];
                        const startY = datesStr ? 19 : 7;
                        const spGroup = group.select(".spouses-group");
                        const spSel = spGroup.selectAll("text.text-spouse").data(spLines);

                        spSel.enter()
                            .append("text")
                            .attr("class", "text-spouse")
                            .merge(spSel)
                            .attr("x", 12 + badgeWidth)
                            .attr("y", (s, idx) => startY + idx * 14)
                            .text(s => s)
                            .style("display", "block");

                        spSel.exit().remove();

                        try {
                            const bbox = this.querySelector(".text-group").getBBox();
                            if (bbox && bbox.width > 0) {
                                d._measuredWidth = Math.max(140, Math.ceil(bbox.width));
                                d._lastSpouseState = showSpouses;
                            }
                        } catch (e) {}
                    });

                    // Sofort nach dem DOM-Messen die horizontalen Generationen-Abstände exakt neu berechnen
                    computeGenerationOffsets(nodes);

                    nodeUpdate.transition(t_anim).attr("transform", d => \`translate(\${d.posX},\${d.posY})\`).style("opacity", 1);

                    nodeUpdate.select("circle.in-circle")
                        .attr("cx", 0)
                        .attr("cy", 0)
                        .attr("r", 7)
                        .style("fill", d => d.data.path_stopped ? "#fde68a" : (d.children ? "#ffffff" : (d._children ? "#3b82f6" : "#ffffff")))
                        .style("stroke", d => d.data.path_stopped ? "#d97706" : (d.children ? "#2563eb" : (d._children ? "#1d4ed8" : "#2563eb")));

                    const nodeExit = node.exit();
                    nodeExit.attr("pointer-events", "none");
                    nodeExit.transition(t_anim).attr("transform", () => \`translate(\${source.posX ?? 0},\${source.posY ?? 0})\`).style("opacity", 1e-6).remove();

                    const link = g.selectAll("path.link").data(links, d => d.target.data.id);
                    link.enter().insert("path", "g").attr("class", "link")
                        .attr("d", () => renderLink(source, source))
                        .merge(link)
                        .transition(t_anim)
                        .attr("d", d => renderLink(d.source, d.target));
                    link.exit().remove();

                    nodes.forEach(d => { d.posX0 = d.posX; d.posY0 = d.posY; });
}

function centerNode(d3Node) {
                    const target = d3Node || selectedNode || root;
                    const scale = 0.85;
                    const isMobile = window.innerWidth <= 900;
                    const sidebarEl = document.getElementById("sidebar");
                    const isDesktopCollapsed = sidebarEl && sidebarEl.classList.contains("collapsed-desktop");
                    const sidebarOffset = (isMobile || isDesktopCollapsed) ? 0 : 200;
                    const currentWidth = container.clientWidth || window.innerWidth;
                    const currentHeight = container.clientHeight || window.innerHeight;

                    const textWidth = getNodeTextWidth(target);
                    const textCenterX = (target.posX ?? 0) + 12 + (textWidth / 2);
                    const textCenterY = (target.posY ?? 0);

                    const x = -textCenterX * scale + (currentWidth - sidebarOffset) / 2;
                    const y = -textCenterY * scale + currentHeight / 2;

                    svg.transition().duration(500).call(
                        zoom.transform,
                        d3.zoomIdentity.translate(x, y).scale(scale)
                    );
}

function addInfoRow(label, val) {
                    if (!val) return "";
                    return \`<div class="info-label">\${escapeHtml(label)}:</div><div class="info-val">\${escapeHtml(val)}</div>\`;
}

function addPersonLinkRow(label, personName, fallbackNode) {
                    if (!personName) return "";
                    let matchedNode = allNodesFlat.find(n => n.data && n.data.name === personName);
                    if (!matchedNode && fallbackNode && fallbackNode.data && personName.includes(fallbackNode.data.name)) {
                        matchedNode = fallbackNode;
                    }
                    if (matchedNode && matchedNode.data && matchedNode.data.henry_code) {
                        const code = escapeHtml(matchedNode.data.henry_code);
                        return \`<div class="info-label">\${escapeHtml(label)}:</div><div class="info-val"><span class="implex-link" style="margin-top:0;" onclick="jumpToHenry('\${code}')">[\${code}] \${escapeHtml(personName)} ↗</span></div>\`;
                    }
                    return addInfoRow(label, personName);
}

function renderDetails(p) {
                    const sidebarContainer = document.getElementById("details-content");
                    if (!sidebarContainer) return;
                    const d3Node = (p && p.henry_code && nodeByHenry[p.henry_code]) ? nodeByHenry[p.henry_code] : selectedNode;
                    const parentNode = d3Node ? d3Node.parent : null;

                    let html = \`<h2>\${escapeHtml(p.name)}</h2>\`;
                    html += \`<div class="badge-line">
                        <span class="badge">\${t("badgeHenry")}: \${escapeHtml(p.henry_code)}</span>
                        <span class="badge">\${t("badgeBranch")}: \${escapeHtml(String(p.branch))}</span>
                        <span class="badge">\${t("badgeGen")}: \${escapeHtml(String(p.generation))}</span>
                    </div>\`;

                    if (p.path_stopped && p.continued_code) {
                        const linkText = \`\${t("seeLabel")} \${escapeHtml(p.continued_code)} \${escapeHtml(p.continued_name)}\`;
                        html += \`<div class="spouse-card" style="background:#fffbeb; border-color:#fde68a;">
                            <strong>\${t("implexNoteTitle")}:</strong> \${t("implexNoteBody")}<br>
                            <span class="implex-link" onclick="jumpToHenry('\${escapeHtml(p.continued_code)}')">
                                → \${linkText}
                            </span>
                        </div>\`;
                    }

                    html += \`<div class="section-title">\${t("secBio")}</div><div class="info-grid">\`;
                    const inWord = t("inPlace");
                    const birthStr = [localizeDateStr(p.birth_date), p.birth_place ? \`\${inWord} \${p.birth_place}\` : ""].filter(Boolean).join(" ");
                    const bapStr = [localizeDateStr(p.baptism_date), p.baptism_place ? \`\${inWord} \${p.baptism_place}\` : ""].filter(Boolean).join(" ");
                    const deathStr = [localizeDateStr(p.death_date), p.death_place ? \`\${inWord} \${p.death_place}\` : ""].filter(Boolean).join(" ");

                    html += addInfoRow(t("birth"), birthStr);
                    html += addInfoRow(t("baptism"), bapStr);
                    html += addInfoRow(t("death"), deathStr);
                    html += addInfoRow(t("occupation"), p.occupation);
                    html += addInfoRow(t("religion"), p.religion);
                    html += addInfoRow(t("residence"), p.residence);
                    html += addPersonLinkRow(t("father"), p.father, parentNode);
                    html += addPersonLinkRow(t("mother"), p.mother, parentNode);
                    html += \`</div>\`;

                    if (p.notes) {
                        html += \`<div class="section-title">\${t("secNotes")}</div>
                                 <div style="font-size:12.5px; color:#334155; line-height:1.45;">\${escapeHtml(p.notes)}</div>\`;
                    }

                    if (p.spouses && p.spouses.length > 0) {
                        html += \`<div class="section-title">\${t("secMarriages")} (\${p.spouses.length})</div>\`;
                        p.spouses.forEach((sp, idx) => {
                            const prefix = p.spouses.length > 1 ? \`(\${sp.order}) \` : "";
                            const mInfo = [localizeDateStr(sp.marriage_date) ? \`\${t("onDate")} \${localizeDateStr(sp.marriage_date)}\` : "", sp.marriage_place ? \`\${inWord} \${sp.marriage_place}\` : ""].filter(Boolean).join(" ");

                            let divStr = "";
                            if (sp.divorce_date) {
                                divStr = sp.divorce_date.toUpperCase() === "Y" ? t("yesLabel") : localizeDateStr(sp.divorce_date);
                            }

                            const spB = [localizeDateStr(sp.birth_date), sp.birth_place ? \`\${inWord} \${sp.birth_place}\` : ""].filter(Boolean).join(" ");
                            const spD = [localizeDateStr(sp.death_date), sp.death_place ? \`\${inWord} \${sp.death_place}\` : ""].filter(Boolean).join(" ");

                            html += \`<div class="spouse-card" data-spouse-index="\${idx}">
                                <div class="sp-title">\${prefix}⚭ \${t("spouse")}: \${escapeHtml(sp.name)}</div>
                                <div class="info-grid">
                                    \${addInfoRow(t("marriage"), mInfo)}
                                    \${addInfoRow(t("divorce"), divStr)}
                                    \${addInfoRow(t("birth"), spB)}
                                    \${addInfoRow(t("death"), spD)}
                                    \${addPersonLinkRow(t("father"), sp.father, null)}
                                    \${addPersonLinkRow(t("mother"), sp.mother, null)}
                                </div>\`;
                            if (sp.implex_code) {
                                const spLinkText = \`\${t("seeLabel")} \${escapeHtml(sp.implex_code)} \${escapeHtml(sp.implex_name)}\`;
                                html += \`<span class="implex-link" onclick="jumpToHenry('\${escapeHtml(sp.implex_code)}')">
                                    ↪ \${spLinkText}
                                </span>\`;
                            }
                            html += \`</div>\`;
                        });
                    }

                    // Kinder-Sektion mit klickbaren Sprunglinks
                    const childNodes = d3Node ? (d3Node.children || d3Node._children || []) : [];
                    if (childNodes.length > 0) {
                        html += \`<div class="section-title">\${t("secChildren")} (\${childNodes.length})</div><div class="child-jump-list">\`;
                        childNodes.forEach(cNode => {
                            const cd = cNode.data;
                            const cCode = escapeHtml(cd.henry_code || "");
                            const cDates = extractDatesLine(cd);
                            html += \`<div class="child-jump-item" onclick="jumpToHenry('\${cCode}')">
                                <span class="child-jump-name">[\${cCode}] \${escapeHtml(cd.name)} ↗</span>
                                <span class="child-jump-dates">\${escapeHtml(cDates)}</span>
                            </div>\`;
                        });
                        html += \`</div>\`;
                    }

                    if (exportMeta.enableFeedbackForm) {
                        html += \`<button type="button" class="btn-feedback-inline" onclick="openFeedbackModal()">✏️ \${escapeHtml(t("feedbackOpenBtn"))}</button>\`;
                    }

                    sidebarContainer.innerHTML = html;
                    renderCreatorMeta(true);
}

function expandPathTo(targetNode) {
                    let curr = targetNode.parent;
                    const ancestors = [];
                    while (curr) { ancestors.unshift(curr); curr = curr.parent; }
                    ancestors.forEach(anc => {
                        if (anc._children) { anc.children = anc._children; anc._children = null; }
                    });
}

function jumpToHenry(code, spouseIndex) {
                    const target = nodeByHenry[code];
                    if (!target) return;
                    const hasSpouseTarget = typeof spouseIndex === "number" && !Number.isNaN(spouseIndex);
                    if (hasSpouseTarget && !showSpouses) {
                        showSpouses = true;
                        safeStorage.setItem("lineagegraph_export_spouses", "1");
                        if (toggleSpousesBtn) {
                            toggleSpousesBtn.innerText = "👥 " + t("btnSpousesOn");
                            toggleSpousesBtn.classList.add("active-toggle");
                        }
                        const mSp = document.getElementById("ui-m-spouses");
                        const mSpBtn = document.getElementById("m-btn-toggle-spouses");
                        if (mSp) mSp.innerText = t("btnSpousesOn");
                        if (mSpBtn) mSpBtn.classList.add("active-toggle");
                    }
                    expandPathTo(target);
                    selectedNode = target;
                    update(root);
                    refreshSelectionClasses();
                    centerNode(target);
                    renderDetails(target.data);
                    if (hasSpouseTarget) {
                        const spCard = sidebarContainer.querySelector(\`.spouse-card[data-spouse-index="\${spouseIndex}"]\`);
                        if (spCard) {
                            spCard.classList.add("search-highlight");
                            spCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
                            setTimeout(() => spCard.classList.remove("search-highlight"), 2600);
                        }
                    }
}
window.jumpToHenry = jumpToHenry;

document.getElementById("btn-reset").addEventListener("click", () => centerNode(selectedNode || root));
document.getElementById("btn-isolate").addEventListener("click", () => {
                    const target = selectedNode || root;
                    const keepOpen = new Set();
                    let curr = target;
                    while (curr) { keepOpen.add(curr); curr = curr.parent; }
                    function collapseExceptPath(n) {
                        if (!keepOpen.has(n) && n !== target) collapse(n);
                        else {
                            if (n._children && keepOpen.has(n)) { n.children = n._children; n._children = null; }
                            if (n.children) n.children.forEach(collapseExceptPath);
                        }
                    }
                    collapseExceptPath(root);
                    update(root); refreshSelectionClasses(); centerNode(target);
});
document.getElementById("btn-collapse").addEventListener("click", () => {
                    if (root.children) root.children.forEach(collapse);
                    update(root); refreshSelectionClasses(); centerNode(root);
});
document.getElementById("btn-expand-step").addEventListener("click", () => {
                    const target = selectedNode || root;
                    let queue = [target];
                    let expandedAny = false;
                    while (queue.length > 0) {
                        let curr = queue.shift();
                        if (curr._children) { curr.children = curr._children; curr._children = null; expandedAny = true; }
                        else if (curr.children) { curr.children.forEach(c => queue.push(c)); }
                    }
                    update(target); refreshSelectionClasses();
});

document.getElementById("mobile-details-btn").addEventListener("click", () => {
                    if (selectedNode && selectedNode.data) {
                        renderDetails(selectedNode.data);
                    }
                    document.getElementById("sidebar").classList.add("open");
});

const searchInput = document.getElementById("search-input");
const searchResults = document.getElementById("search-results");

const mobileMenuBtn = document.getElementById("btn-mobile-menu");
const dropdownMenu = document.getElementById("toolbar-dropdown-menu");

function closeMobileMenu() {
                    if (dropdownMenu) dropdownMenu.classList.remove("open");
                    if (mobileMenuBtn) mobileMenuBtn.setAttribute("aria-expanded", "false");
}

function toggleMobileMenu(e) {
                    if (e) e.stopPropagation();
                    if (!dropdownMenu) return;
                    const willOpen = !dropdownMenu.classList.contains("open");
                    if (willOpen) {
                        dropdownMenu.classList.add("open");
                        if (mobileMenuBtn) mobileMenuBtn.setAttribute("aria-expanded", "true");
                        if (searchResults) searchResults.style.display = "none";
                    } else {
                        closeMobileMenu();
                    }
}

if (mobileMenuBtn) {
                    mobileMenuBtn.addEventListener("click", toggleMobileMenu);
}

document.getElementById("m-btn-reset")?.addEventListener("click", () => {
                    closeMobileMenu();
                    document.getElementById("btn-reset")?.click();
});
document.getElementById("m-btn-isolate")?.addEventListener("click", () => {
                    closeMobileMenu();
                    document.getElementById("btn-isolate")?.click();
});
document.getElementById("m-btn-collapse")?.addEventListener("click", () => {
                    closeMobileMenu();
                    document.getElementById("btn-collapse")?.click();
});
document.getElementById("m-btn-expand-step")?.addEventListener("click", () => {
                    closeMobileMenu();
                    document.getElementById("btn-expand-step")?.click();
});
document.getElementById("m-btn-toggle-spouses")?.addEventListener("click", () => {
                    closeMobileMenu();
                    document.getElementById("btn-toggle-spouses")?.click();
});

searchInput.addEventListener("focus", () => {
                    closeMobileMenu();
});

searchInput.addEventListener("input", () => {
                    closeMobileMenu();
                    const q = searchInput.value.trim().toLowerCase();
                    if (q.length < 2) { searchResults.style.display = "none"; return; }
                    const personMatches = [];
                    const spouseMatches = [];
                    allNodesFlat.forEach(n => {
                        const d = n.data;
                        const isPersonMatch =
                            d.name.toLowerCase().includes(q) ||
                            d.henry_code.toLowerCase().includes(q) ||
                            (d.birth_place && d.birth_place.toLowerCase().includes(q));
                        if (isPersonMatch) {
                            personMatches.push({ kind: "person", node: n });
                        }
                        if (d.spouses && d.spouses.length > 0) {
                            d.spouses.forEach((sp, idx) => {
                                const isSpouseMatch =
                                    (sp.name && sp.name.toLowerCase().includes(q)) ||
                                    (sp.birth_place && sp.birth_place.toLowerCase().includes(q)) ||
                                    (sp.marriage_place && sp.marriage_place.toLowerCase().includes(q));
                                if (isSpouseMatch) {
                                    spouseMatches.push({ kind: "spouse", node: n, spouse: sp, spouseIndex: idx });
                                }
                            });
                        }
                    });
                    const matches = [...personMatches, ...spouseMatches].slice(0, 25);

                    if (matches.length === 0) {
                        searchResults.innerHTML = \`<div class="search-item">\${t("noResults")}</div>\`;
                    } else {
                        searchResults.innerHTML = matches.map(m => {
                            const d = m.node.data;
                            if (m.kind === "spouse") {
                                const sp = m.spouse;
                                const spMeta = [sp.birth_date ? \`* \${localizeDateStr(sp.birth_date)}\` : "", sp.birth_place].filter(Boolean).join(\` \${t("inPlace")} \`);
                                const mDate = sp.marriage_date ? localizeDateStr(sp.marriage_date) : "";
                                return \`<div class="search-item" data-code="\${escapeHtml(d.henry_code)}" data-spouse-index="\${m.spouseIndex}">
                                    <div class="search-item-title">
                                        <span class="spouse-badge">💍 \${escapeHtml(t("spouse"))}</span>
                                        <strong>\${escapeHtml(sp.name)}</strong>
                                    </div>
                                    <span class="spouse-context">↳ \${escapeHtml(t("spouseOf"))} <span class="code">\${escapeHtml(d.henry_code)}</span> \${escapeHtml(d.name)}\${mDate ? \` (⚭ \${escapeHtml(mDate)})\` : ""}</span>
                                    \${spMeta ? \`<span class="meta">\${escapeHtml(spMeta)}</span>\` : ""}
                                </div>\`;
                            }
                            const meta = [d.birth_date ? \`* \${localizeDateStr(d.birth_date)}\` : "", d.birth_place].filter(Boolean).join(\` \${t("inPlace")} \`);
                            return \`<div class="search-item" data-code="\${escapeHtml(d.henry_code)}">
                                <div class="search-item-title"><span class="code">\${escapeHtml(d.henry_code)}</span> <strong>\${escapeHtml(d.name)}</strong></div>
                                \${meta ? \`<span class="meta">\${escapeHtml(meta)}</span>\` : ""}
                            </div>\`;
                        }).join("");
                    }
                    searchResults.style.display = "block";
});

searchResults.addEventListener("click", (e) => {
                    const item = e.target.closest(".search-item");
                    if (!item || !item.dataset.code) return;
                    searchResults.style.display = "none";
                    const spIdx = item.dataset.spouseIndex !== undefined ? Number(item.dataset.spouseIndex) : undefined;
                    jumpToHenry(item.dataset.code, spIdx);
});

document.addEventListener("click", (e) => {
                    if (!e.target.closest("#menu-dropdown-wrapper")) {
                        closeMobileMenu();
                    }
                    if (!e.target.closest(".search-wrapper")) {
                        searchResults.style.display = "none";
                    }
});

document.getElementById("btn-close-sidebar").addEventListener("click", () => {
                    const sb = document.getElementById("sidebar");
                    if (window.innerWidth <= 900) {
                        sb.classList.remove("open");
                    } else {
                        sb.classList.add("collapsed-desktop");
                        document.getElementById("desktop-reopen-sidebar-btn").style.display = "flex";
                    }
});

document.getElementById("desktop-reopen-sidebar-btn").addEventListener("click", () => {
                    const sb = document.getElementById("sidebar");
                    sb.classList.remove("collapsed-desktop");
                    document.getElementById("desktop-reopen-sidebar-btn").style.display = "none";
});

// --- Export Info Modal & Hybrid Feedback Form ---
function renderExportInfoModal() {
                    const titleEl = document.getElementById("ui-info-modal-title");
                    if (titleEl) titleEl.innerText = t("infoModalTitle");
                    const bodyEl = document.getElementById("export-info-modal-body");
                    if (!bodyEl) return;
                    const rows = [];
                    const dateStr = formatExportDate();
                    if (dateStr) {
                        rows.push(\`<div class="info-meta-row"><span class="info-meta-label">\${escapeHtml(t("exportDateLabel"))}</span><span class="info-meta-value">\${escapeHtml(dateStr)}</span></div>\`);
                    }
                    if (exportMeta.creatorName) {
                        rows.push(\`<div class="info-meta-row"><span class="info-meta-label">\${escapeHtml(t("creatorLabel"))}</span><span class="info-meta-value">\${escapeHtml(exportMeta.creatorName)}</span></div>\`);
                    }
                    if (exportMeta.creatorContact) {
                        const c = exportMeta.creatorContact.trim();
                        const contactHtml = isEmailAddress(c)
                            ? \`<a href="mailto:\${escapeHtml(c)}" style="color:#2563eb;font-weight:600;text-decoration:none;">\${escapeHtml(c)}</a>\`
                            : escapeHtml(c);
                        rows.push(\`<div class="info-meta-row"><span class="info-meta-label">\${escapeHtml(t("creatorContactLabel"))}</span><span class="info-meta-value">\${contactHtml}</span></div>\`);
                    }
                    let html = \`<div class="info-meta-list">\${rows.join("")}</div>\`;
                    if (exportMeta.enableFeedbackForm) {
                        html += \`<button type="button" class="btn-feedback-inline" onclick="closeExportInfoModal(); openFeedbackModal();">✏️ \${escapeHtml(t("feedbackOpenBtn"))}</button>\`;
                    }
                    const appLink = '<a href="${REPO_URL}" target="_blank" rel="noopener noreferrer" style="color:#475569;font-weight:600;text-decoration:none;">LineageGraph v${escapeHtmlAttr(APP_VERSION)}</a>';
                    html += \`<div style="font-size:11.5px;color:#64748b;text-align:center;margin-top:4px;">\${escapeHtml(t("exportCredit")).replace("{app}", appLink)}</div>\`;
                    bodyEl.innerHTML = html;
}

function openExportInfoModal() {
                    closeMobileMenu();
                    renderExportInfoModal();
                    document.getElementById("export-info-modal")?.classList.add("open");
}

function closeExportInfoModal() {
                    document.getElementById("export-info-modal")?.classList.remove("open");
}
window.closeExportInfoModal = closeExportInfoModal;

document.getElementById("btn-export-info")?.addEventListener("click", openExportInfoModal);
document.getElementById("m-btn-export-info")?.addEventListener("click", openExportInfoModal);
document.getElementById("btn-close-info-modal")?.addEventListener("click", closeExportInfoModal);
document.getElementById("export-info-modal")?.addEventListener("click", (e) => {
                    if (e.target === e.currentTarget) closeExportInfoModal();
});

let feedbackActiveTab = "person";
let feedbackTargetPerson = null;

function setFeedbackStatus(type, msg) {
                    const el = document.getElementById("feedback-status-msg");
                    if (!el) return;
                    el.className = "feedback-status-msg" + (type ? " " + type : "");
                    el.innerText = msg || "";
}

function renderFeedbackTabs() {
                    const tabsEl = document.getElementById("feedback-tabs");
                    if (!tabsEl) return;
                    const p = feedbackTargetPerson;
                    const tabs = [];
                    if (p) {
                        tabs.push({ id: "person", label: t("feedbackTabPerson") });
                        tabs.push({ id: "spouse", label: t("feedbackTabSpouse") });
                        tabs.push({ id: "child", label: t("feedbackTabChild") });
                    }
                    tabs.push({ id: "note", label: t("feedbackTabNote") });
                    if (!tabs.some(tb => tb.id === feedbackActiveTab)) {
                        feedbackActiveTab = tabs[0].id;
                    }
                    tabsEl.innerHTML = tabs.map(tb => \`<button type="button" class="feedback-tab-btn \${tb.id === feedbackActiveTab ? "active" : ""}" data-tab="\${tb.id}">\${escapeHtml(tb.label)}</button>\`).join("");
}

function renderFeedbackTabPanel() {
                    const panel = document.getElementById("feedback-tab-panel");
                    if (!panel) return;
                    const p = feedbackTargetPerson;
                    setFeedbackStatus("", "");

                    if (feedbackActiveTab === "person" && p) {
                        const curSex = (p.sex || "U").toUpperCase();
                        panel.innerHTML = \`<div class="feedback-grid">
                            <div class="feedback-field"><label>\${escapeHtml(t("firstName"))}</label><input type="text" id="fb-p-first" value="\${escapeHtml(p.first_name || "")}" /></div>
                            <div class="feedback-field"><label>\${escapeHtml(t("lastName"))}</label><input type="text" id="fb-p-last" value="\${escapeHtml(p.last_name || "")}" /></div>
                            <div class="feedback-field full"><label>\${escapeHtml(t("sexLabel"))}</label>
                                <select id="fb-p-sex">
                                    <option value="M" \${curSex === "M" ? "selected" : ""}>\${escapeHtml(t("sexMale"))}</option>
                                    <option value="F" \${curSex === "F" ? "selected" : ""}>\${escapeHtml(t("sexFemale"))}</option>
                                    <option value="U" \${curSex !== "M" && curSex !== "F" ? "selected" : ""}>\${escapeHtml(t("sexUnknown"))}</option>
                                </select>
                            </div>
                            <div class="feedback-field"><label>\${escapeHtml(t("birth"))} — \${escapeHtml(t("dateLabel"))}</label><input type="text" id="fb-p-bdate" value="\${escapeHtml(p.birth_date || "")}" /></div>
                            <div class="feedback-field"><label>\${escapeHtml(t("birth"))} — \${escapeHtml(t("placeLabel"))}</label><input type="text" id="fb-p-bplace" value="\${escapeHtml(p.birth_place || "")}" /></div>
                            <div class="feedback-field"><label>\${escapeHtml(t("baptism"))} — \${escapeHtml(t("dateLabel"))}</label><input type="text" id="fb-p-bpdate" value="\${escapeHtml(p.baptism_date || "")}" /></div>
                            <div class="feedback-field"><label>\${escapeHtml(t("baptism"))} — \${escapeHtml(t("placeLabel"))}</label><input type="text" id="fb-p-bpplace" value="\${escapeHtml(p.baptism_place || "")}" /></div>
                            <div class="feedback-field"><label>\${escapeHtml(t("death"))} — \${escapeHtml(t("dateLabel"))}</label><input type="text" id="fb-p-ddate" value="\${escapeHtml(p.death_date || "")}" /></div>
                            <div class="feedback-field"><label>\${escapeHtml(t("death"))} — \${escapeHtml(t("placeLabel"))}</label><input type="text" id="fb-p-dplace" value="\${escapeHtml(p.death_place || "")}" /></div>
                            <div class="feedback-field"><label>\${escapeHtml(t("occupation"))}</label><input type="text" id="fb-p-occ" value="\${escapeHtml(p.occupation || "")}" /></div>
                            <div class="feedback-field"><label>\${escapeHtml(t("residence"))}</label><input type="text" id="fb-p-res" value="\${escapeHtml(p.residence || "")}" /></div>
                            <div class="feedback-field full"><label>\${escapeHtml(t("feedbackNoteLabel"))}</label><textarea id="fb-p-note" rows="2" placeholder="\${escapeHtml(t("feedbackNotePlaceholder"))}">\${escapeHtml(p.notes || "")}</textarea></div>
                        </div>\`;
                    } else if (feedbackActiveTab === "spouse" && p) {
                        const spouses = p.spouses || [];
                        const opts = [\`<option value="-1">\${escapeHtml(t("feedbackNewSpouse"))}</option>\`]
                            .concat(spouses.map((sp, i) => \`<option value="\${i}">(\${sp.order}) \${escapeHtml(sp.name || t("unknown"))}</option>\`))
                            .join("");
                        panel.innerHTML = \`<div class="feedback-grid">
                            <div class="feedback-field full"><label>\${escapeHtml(t("feedbackSpouseSelect"))}</label><select id="fb-sp-select">\${opts}</select></div>
                            <div class="feedback-field full"><label>\${escapeHtml(t("feedbackSpouseName"))}</label><input type="text" id="fb-sp-name" /></div>
                            <div class="feedback-field"><label>\${escapeHtml(t("marriage"))} — \${escapeHtml(t("dateLabel"))}</label><input type="text" id="fb-sp-mdate" /></div>
                            <div class="feedback-field"><label>\${escapeHtml(t("marriage"))} — \${escapeHtml(t("placeLabel"))}</label><input type="text" id="fb-sp-mplace" /></div>
                            <div class="feedback-field"><label>\${escapeHtml(t("divorce"))}</label><input type="text" id="fb-sp-div" /></div>
                            <div class="feedback-field"><label>\${escapeHtml(t("birth"))} — \${escapeHtml(t("dateLabel"))}</label><input type="text" id="fb-sp-bdate" /></div>
                            <div class="feedback-field"><label>\${escapeHtml(t("birth"))} — \${escapeHtml(t("placeLabel"))}</label><input type="text" id="fb-sp-bplace" /></div>
                            <div class="feedback-field"><label>\${escapeHtml(t("death"))} — \${escapeHtml(t("dateLabel"))}</label><input type="text" id="fb-sp-ddate" /></div>
                            <div class="feedback-field"><label>\${escapeHtml(t("death"))} — \${escapeHtml(t("placeLabel"))}</label><input type="text" id="fb-sp-dplace" /></div>
                            <div class="feedback-field full"><label>\${escapeHtml(t("feedbackNoteLabel"))}</label><textarea id="fb-sp-note" rows="2" placeholder="\${escapeHtml(t("feedbackNotePlaceholder"))}"></textarea></div>
                        </div>\`;
                        const sel = document.getElementById("fb-sp-select");
                        const fillSpouse = (idx) => {
                            const sp = idx >= 0 ? spouses[idx] : null;
                            document.getElementById("fb-sp-name").value = sp ? (sp.name || "") : "";
                            document.getElementById("fb-sp-mdate").value = sp ? (sp.marriage_date || "") : "";
                            document.getElementById("fb-sp-mplace").value = sp ? (sp.marriage_place || "") : "";
                            document.getElementById("fb-sp-div").value = sp ? (sp.divorce_date || "") : "";
                            document.getElementById("fb-sp-bdate").value = sp ? (sp.birth_date || "") : "";
                            document.getElementById("fb-sp-bplace").value = sp ? (sp.birth_place || "") : "";
                            document.getElementById("fb-sp-ddate").value = sp ? (sp.death_date || "") : "";
                            document.getElementById("fb-sp-dplace").value = sp ? (sp.death_place || "") : "";
                        };
                        if (spouses.length > 0) {
                            sel.value = "0";
                            fillSpouse(0);
                        }
                        sel.addEventListener("change", () => fillSpouse(Number(sel.value)));
                    } else if (feedbackActiveTab === "child" && p) {
                        panel.innerHTML = \`<div class="feedback-grid">
                            <div class="feedback-field full" style="font-size:12px;color:#475569;">\${escapeHtml(t("feedbackChildHint"))} <strong>[\${escapeHtml(p.henry_code)}] \${escapeHtml(p.name)}</strong></div>
                            <div class="feedback-field"><label>\${escapeHtml(t("firstName"))}</label><input type="text" id="fb-ch-first" /></div>
                            <div class="feedback-field"><label>\${escapeHtml(t("lastName"))}</label><input type="text" id="fb-ch-last" value="\${escapeHtml(p.last_name || "")}" /></div>
                            <div class="feedback-field full"><label>\${escapeHtml(t("sexLabel"))}</label>
                                <select id="fb-ch-sex">
                                    <option value="M">\${escapeHtml(t("sexMale"))}</option>
                                    <option value="F">\${escapeHtml(t("sexFemale"))}</option>
                                    <option value="U" selected>\${escapeHtml(t("sexUnknown"))}</option>
                                </select>
                            </div>
                            <div class="feedback-field"><label>\${escapeHtml(t("birth"))} — \${escapeHtml(t("dateLabel"))}</label><input type="text" id="fb-ch-bdate" /></div>
                            <div class="feedback-field"><label>\${escapeHtml(t("birth"))} — \${escapeHtml(t("placeLabel"))}</label><input type="text" id="fb-ch-bplace" /></div>
                            <div class="feedback-field full"><label>\${escapeHtml(t("feedbackChildParentsNote"))}</label><input type="text" id="fb-ch-parents" /></div>
                            <div class="feedback-field full"><label>\${escapeHtml(t("feedbackNoteLabel"))}</label><textarea id="fb-ch-note" rows="2" placeholder="\${escapeHtml(t("feedbackNotePlaceholder"))}"></textarea></div>
                        </div>\`;
                    } else {
                        panel.innerHTML = \`<div class="feedback-grid">
                            <div class="feedback-field full"><label>\${escapeHtml(t("feedbackGeneralLabel"))}</label><textarea id="fb-gen-note" rows="5" placeholder="\${escapeHtml(t("feedbackGeneralPlaceholder"))}"></textarea></div>
                        </div>\`;
                    }
}

function buildFeedbackReport() {
                    const p = feedbackTargetPerson;
                    const lines = [];
                    const refText = p ? \`[\${p.henry_code}] \${p.name}\` : t("feedbackGeneralRef");
                    lines.push(\`\${t("title")} — \${t("feedbackTitle")}\`);
                    lines.push(\`\${t("exportDateLabel")}: \${formatExportDate()}\`);
                    lines.push(\`\${t("feedbackRefLabel")}: \${refText}\`);
                    lines.push("");

                    let hasContent = false;
                    const pushDiff = (label, oldVal, newVal) => {
                        const o = (oldVal || "").trim();
                        const n = (newVal || "").trim();
                        if (o !== n) {
                            hasContent = true;
                            lines.push(\`- \${label}: "\${o || "—"}" → "\${n || "—"}"\`);
                        }
                    };
                    const pushVal = (label, val) => {
                        const v = (val || "").trim();
                        if (v) {
                            hasContent = true;
                            lines.push(\`- \${label}: \${v}\`);
                        }
                    };

                    if (feedbackActiveTab === "person" && p) {
                        lines.push(\`[\${t("feedbackTabPerson")}]\`);
                        pushDiff(t("firstName"), p.first_name, document.getElementById("fb-p-first")?.value);
                        pushDiff(t("lastName"), p.last_name, document.getElementById("fb-p-last")?.value);
                        const origSex = ["M", "F"].includes((p.sex || "").toUpperCase()) ? (p.sex || "").toUpperCase() : "U";
                        pushDiff(t("sexLabel"), origSex, document.getElementById("fb-p-sex")?.value);
                        pushDiff(\`\${t("birth")} (\${t("dateLabel")})\`, p.birth_date, document.getElementById("fb-p-bdate")?.value);
                        pushDiff(\`\${t("birth")} (\${t("placeLabel")})\`, p.birth_place, document.getElementById("fb-p-bplace")?.value);
                        pushDiff(\`\${t("baptism")} (\${t("dateLabel")})\`, p.baptism_date, document.getElementById("fb-p-bpdate")?.value);
                        pushDiff(\`\${t("baptism")} (\${t("placeLabel")})\`, p.baptism_place, document.getElementById("fb-p-bpplace")?.value);
                        pushDiff(\`\${t("death")} (\${t("dateLabel")})\`, p.death_date, document.getElementById("fb-p-ddate")?.value);
                        pushDiff(\`\${t("death")} (\${t("placeLabel")})\`, p.death_place, document.getElementById("fb-p-dplace")?.value);
                        pushDiff(t("occupation"), p.occupation, document.getElementById("fb-p-occ")?.value);
                        pushDiff(t("residence"), p.residence, document.getElementById("fb-p-res")?.value);
                        pushDiff(t("feedbackNoteLabel"), p.notes, document.getElementById("fb-p-note")?.value);
                    } else if (feedbackActiveTab === "spouse" && p) {
                        const selIdx = Number(document.getElementById("fb-sp-select")?.value ?? -1);
                        const sp = selIdx >= 0 ? (p.spouses || [])[selIdx] : null;
                        lines.push(\`[\${t("feedbackTabSpouse")}: \${sp ? sp.name : t("feedbackNewSpouse")}]\`);
                        if (sp) {
                            pushDiff(t("feedbackSpouseName"), sp.name, document.getElementById("fb-sp-name")?.value);
                            pushDiff(\`\${t("marriage")} (\${t("dateLabel")})\`, sp.marriage_date, document.getElementById("fb-sp-mdate")?.value);
                            pushDiff(\`\${t("marriage")} (\${t("placeLabel")})\`, sp.marriage_place, document.getElementById("fb-sp-mplace")?.value);
                            pushDiff(t("divorce"), sp.divorce_date, document.getElementById("fb-sp-div")?.value);
                            pushDiff(\`\${t("birth")} (\${t("dateLabel")})\`, sp.birth_date, document.getElementById("fb-sp-bdate")?.value);
                            pushDiff(\`\${t("birth")} (\${t("placeLabel")})\`, sp.birth_place, document.getElementById("fb-sp-bplace")?.value);
                            pushDiff(\`\${t("death")} (\${t("dateLabel")})\`, sp.death_date, document.getElementById("fb-sp-ddate")?.value);
                            pushDiff(\`\${t("death")} (\${t("placeLabel")})\`, sp.death_place, document.getElementById("fb-sp-dplace")?.value);
                        } else {
                            pushVal(t("feedbackSpouseName"), document.getElementById("fb-sp-name")?.value);
                            pushVal(\`\${t("marriage")} (\${t("dateLabel")})\`, document.getElementById("fb-sp-mdate")?.value);
                            pushVal(\`\${t("marriage")} (\${t("placeLabel")})\`, document.getElementById("fb-sp-mplace")?.value);
                            pushVal(t("divorce"), document.getElementById("fb-sp-div")?.value);
                            pushVal(\`\${t("birth")} (\${t("dateLabel")})\`, document.getElementById("fb-sp-bdate")?.value);
                            pushVal(\`\${t("birth")} (\${t("placeLabel")})\`, document.getElementById("fb-sp-bplace")?.value);
                            pushVal(\`\${t("death")} (\${t("dateLabel")})\`, document.getElementById("fb-sp-ddate")?.value);
                            pushVal(\`\${t("death")} (\${t("placeLabel")})\`, document.getElementById("fb-sp-dplace")?.value);
                        }
                        pushVal(t("feedbackNoteLabel"), document.getElementById("fb-sp-note")?.value);
                    } else if (feedbackActiveTab === "child" && p) {
                        lines.push(\`[\${t("feedbackTabChild")}]\`);
                        pushVal(t("firstName"), document.getElementById("fb-ch-first")?.value);
                        const chLast = (document.getElementById("fb-ch-last")?.value || "").trim();
                        if (chLast && chLast !== (p.last_name || "").trim()) {
                            pushVal(t("lastName"), chLast);
                        }
                        const chSex = document.getElementById("fb-ch-sex")?.value;
                        if (chSex && chSex !== "U") pushVal(t("sexLabel"), chSex);
                        pushVal(\`\${t("birth")} (\${t("dateLabel")})\`, document.getElementById("fb-ch-bdate")?.value);
                        pushVal(\`\${t("birth")} (\${t("placeLabel")})\`, document.getElementById("fb-ch-bplace")?.value);
                        pushVal(t("feedbackChildParentsNote"), document.getElementById("fb-ch-parents")?.value);
                        pushVal(t("feedbackNoteLabel"), document.getElementById("fb-ch-note")?.value);
                    } else {
                        lines.push(\`[\${t("feedbackTabNote")}]\`);
                        pushVal(t("feedbackGeneralLabel"), document.getElementById("fb-gen-note")?.value);
                    }

                    if (!hasContent) return null;

                    const sName = (document.getElementById("fb-sender-name")?.value || "").trim();
                    const sContact = (document.getElementById("fb-sender-contact")?.value || "").trim();
                    if (sName || sContact) {
                        lines.push("");
                        if (sName) lines.push(\`\${t("feedbackSenderName")}: \${sName}\`);
                        if (sContact) lines.push(\`\${t("feedbackSenderContact")}: \${sContact}\`);
                    }

                    return {
                        subject: \`\${t("title")}: \${t("feedbackTitle")} (\${refText})\`,
                        body: lines.join("\\n"),
                    };
}

function openFeedbackModal() {
                    if (!exportMeta.enableFeedbackForm) return;
                    feedbackTargetPerson = (selectedNode && selectedNode.data) ? selectedNode.data : null;
                    feedbackActiveTab = feedbackTargetPerson ? "person" : "note";

                    document.getElementById("ui-feedback-modal-title").innerText = "✏️ " + t("feedbackTitle");
                    const refText = feedbackTargetPerson
                        ? \`[\${feedbackTargetPerson.henry_code}] \${feedbackTargetPerson.name}\`
                        : t("feedbackGeneralRef");
                    document.getElementById("feedback-context-bar").innerHTML = \`<strong>\${escapeHtml(t("feedbackRefLabel"))}:</strong> \${escapeHtml(refText)} · <strong>\${escapeHtml(t("exportDateLabel"))}:</strong> \${escapeHtml(formatExportDate())}\`;
                    document.getElementById("ui-fb-sender-name-lbl").innerText = t("feedbackSenderName");
                    document.getElementById("ui-fb-sender-contact-lbl").innerText = t("feedbackSenderContact");
                    document.getElementById("btn-feedback-copy").innerText = "📋 " + t("feedbackCopyBtn");

                    const emailBtn = document.getElementById("btn-feedback-email");
                    if (emailBtn) {
                        emailBtn.innerText = "✉️ " + t("feedbackSendEmail");
                        emailBtn.style.display = isEmailAddress(exportMeta.creatorContact) ? "inline-flex" : "none";
                    }

                    renderFeedbackTabs();
                    renderFeedbackTabPanel();
                    document.getElementById("feedback-modal")?.classList.add("open");
}
window.openFeedbackModal = openFeedbackModal;

function closeFeedbackModal() {
                    document.getElementById("feedback-modal")?.classList.remove("open");
}

document.getElementById("feedback-tabs")?.addEventListener("click", (e) => {
                    const btn = e.target.closest(".feedback-tab-btn");
                    if (!btn || !btn.dataset.tab) return;
                    feedbackActiveTab = btn.dataset.tab;
                    renderFeedbackTabs();
                    renderFeedbackTabPanel();
});

document.getElementById("btn-close-feedback-modal")?.addEventListener("click", closeFeedbackModal);
document.getElementById("feedback-modal")?.addEventListener("click", (e) => {
                    if (e.target === e.currentTarget) closeFeedbackModal();
});

document.addEventListener("keydown", (e) => {
                    if (e.key === "Escape") {
                        closeExportInfoModal();
                        closeFeedbackModal();
                    }
});

document.getElementById("btn-feedback-email")?.addEventListener("click", () => {
                    const report = buildFeedbackReport();
                    if (!report) {
                        setFeedbackStatus("error", t("feedbackNoChanges"));
                        return;
                    }
                    const targetEmail = (exportMeta.creatorContact || "").trim();
                    if (!isEmailAddress(targetEmail)) return;
                    const mailtoUrl = \`mailto:\${encodeURIComponent(targetEmail)}?subject=\${encodeURIComponent(report.subject)}&body=\${encodeURIComponent(report.body)}\`;
                    window.location.href = mailtoUrl;
});

document.getElementById("btn-feedback-copy")?.addEventListener("click", async () => {
                    const report = buildFeedbackReport();
                    if (!report) {
                        setFeedbackStatus("error", t("feedbackNoChanges"));
                        return;
                    }
                    const fullText = report.subject + "\\n\\n" + report.body;
                    try {
                        if (navigator.clipboard && navigator.clipboard.writeText) {
                            await navigator.clipboard.writeText(fullText);
                        } else {
                            throw new Error("clipboard_unavailable");
                        }
                        setFeedbackStatus("success", t("feedbackCopied"));
                    } catch (err) {
                        const ta = document.createElement("textarea");
                        ta.value = fullText;
                        ta.style.position = "fixed";
                        ta.style.opacity = "0";
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand("copy");
                        document.body.removeChild(ta);
                        setFeedbackStatus("success", t("feedbackCopied"));
                    }
});

document.getElementById("btn-zoom-in")?.addEventListener("click", () => {
                    svg.transition().duration(200).call(zoom.scaleBy, 1.3);
});
document.getElementById("btn-zoom-out")?.addEventListener("click", () => {
                    svg.transition().duration(200).call(zoom.scaleBy, 0.77);
});

function fitBackgroundImage() {
                    const layer = document.getElementById("bg-image-layer");
                    const img = layer ? layer.querySelector("img") : null;
                    if (!layer || !img || !img.naturalWidth || !img.naturalHeight) return;
                    const vw = layer.clientWidth || window.innerWidth;
                    const vh = layer.clientHeight || window.innerHeight;
                    const scale = Math.min(1, vw / img.naturalWidth, vh / img.naturalHeight);
                    img.style.width = Math.floor(img.naturalWidth * scale) + "px";
                    img.style.height = Math.floor(img.naturalHeight * scale) + "px";
}

function initBackgroundImageSizing() {
                    const layer = document.getElementById("bg-image-layer");
                    const img = layer ? layer.querySelector("img") : null;
                    if (!img) return;
                    if (img.complete) {
                        fitBackgroundImage();
                    } else {
                        img.addEventListener("load", fitBackgroundImage, { once: true });
                    }
                    window.addEventListener("resize", fitBackgroundImage);
                    window.addEventListener("orientationchange", fitBackgroundImage);
}

function initInteractiveTree() {
                    updateStaticUI();
                    initBackgroundImageSizing();
                    centerNode(root);
                    renderDetails(root.data);
}

if (document.readyState === "loading") {
                    document.addEventListener("DOMContentLoaded", () => {
                        setTimeout(initInteractiveTree, 50);
                    });
} else {
                    setTimeout(initInteractiveTree, 50);
}
    </script>
</body>
</html>`;
}

function escapeHtmlAttr(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

