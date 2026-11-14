import type { Person } from '../../composables/usePersons';
import { tLocale } from '../../i18n';
import { formatLocalizedDate } from '../../types/design';
import type {
  DesignDocumentModel,
  LineagePolicy,
  ResolvedGroupNode,
  SceneImplexBadge,
  SceneSpouseRow,
} from './sceneTypes';

export interface ResolvedPersonMeta {
  person: Person;
  henryCode: string;
  generation: number;
  resolvedParentId: string | null;
  childrenIds: string[];
  spouses: SceneSpouseRow[];
  implexBadges: SceneImplexBadge[];
  occupationText?: string;
}

export interface ResolvedLineageResult {
  documentId: string;
  rootPersonId: string;
  personMap: Map<string, Person>;
  resolvedMeta: Map<string, ResolvedPersonMeta>;
  rootGroup: ResolvedGroupNode | null;
  allGroups: ResolvedGroupNode[];
  visiblePersonIds: Set<string>;
}

const MONTH_MAP: Record<string, number> = {
  JAN: 1, JANUAR: 1, JANUARY: 1,
  FEB: 2, FEBRUAR: 2, FEBRUARY: 2,
  MAR: 3, MÄR: 3, MAERZ: 3, MARCH: 3, MÄRZ: 3,
  APR: 4, APRIL: 4,
  MAY: 5, MAI: 5,
  JUN: 6, JUNI: 6, JUNE: 6,
  JUL: 7, JULI: 7, JULY: 7,
  AUG: 8, AUGUST: 8,
  SEP: 9, SEPT: 9, SEPTEMBER: 9,
  OCT: 10, OKT: 10, OCTOBER: 10, OKTOBER: 10,
  NOV: 11, NOVEMBER: 11,
  DEC: 12, DEZ: 12, DECEMBER: 12, DEZEMBER: 12,
};

export function parseBirthSortKey(dateStr?: string | null): [number, number, number] {
  const s = (dateStr || '').trim().toUpperCase();
  if (!s) return [9999, 99, 99];

  const clean = s.replace(/\b(ABT|CA|CAL|EST|BEF|VOR|AFT|NACH)\b\.?/g, '').trim();

  const dashParts = clean.split(/[-/]/);
  if (dashParts.length >= 2 && /^\d{3,4}$/.test(dashParts[0].trim())) {
    const y = parseInt(dashParts[0].trim(), 10);
    const m = dashParts[1] ? parseInt(dashParts[1].trim(), 10) || 99 : 99;
    const d = dashParts[2] ? parseInt(dashParts[2].trim().split(/\s+/)[0], 10) || 99 : 99;
    return [y, m, d];
  }

  const dotParts = clean.split('.');
  if (dotParts.length === 3) {
    const y = parseInt(dotParts[2].trim().split(/\s+/)[0], 10);
    if (!Number.isNaN(y) && y >= 100 && y <= 2999) {
      const d = parseInt(dotParts[0].replace(/\D/g, ''), 10) || 99;
      const m = parseInt(dotParts[1].trim(), 10) || 99;
      return [y, m, d];
    }
  }

  let year = 9999;
  let month = 99;
  let day = 99;
  const tokens = clean.split(/[\s,]+/).filter(Boolean);
  for (const tok of tokens) {
    if (MONTH_MAP[tok] !== undefined) {
      month = MONTH_MAP[tok];
    } else if (/^\d{1,2}$/.test(tok)) {
      const val = parseInt(tok, 10);
      if (val >= 1 && val <= 31 && day === 99) day = val;
    } else if (/^\d{3,4}$/.test(tok)) {
      year = parseInt(tok, 10);
    }
  }
  return [year, month, day];
}

export function compareBirthSortKeys(a?: string | null, b?: string | null): number {
  const ka = parseBirthSortKey(a);
  const kb = parseBirthSortKey(b);
  if (ka[0] !== kb[0]) return ka[0] - kb[0];
  if (ka[1] !== kb[1]) return ka[1] - kb[1];
  return ka[2] - kb[2];
}

function nextHenrySuffix(index1Based: number): string {
  if (index1Based >= 1 && index1Based <= 9) return String(index1Based);
  const letters = 'ABCDEFGHIJK';
  if (index1Based >= 10 && index1Based <= 20) return letters[index1Based - 10];
  return `X${index1Based}`;
}

export function readPersonOccupation(person: Person): string {
  const extra = person.gedcom_extra;
  if (!extra) return '';
  const occu = extra.OCCU;
  if (typeof occu === 'string') return occu.trim();
  if (typeof occu === 'object' && occu !== null) {
    const val = occu._val || occu.value || '';
    return typeof val === 'string' ? val.trim() : '';
  }
  return '';
}

function resolveFatherAndMother(person: Person, personMap: Map<string, Person>): {
  fatherId: string | null;
  motherId: string | null;
} {
  let fatherId: string | null = person.father_id || null;
  let motherId: string | null = person.mother_id || null;
  for (const pid of person.parent_ids || []) {
    const p = personMap.get(pid);
    if (!p) continue;
    if (!fatherId && p.sex === 'M') fatherId = pid;
    else if (!motherId && p.sex === 'F') motherId = pid;
  }
  return { fatherId, motherId };
}

function selectPrimaryParentForImplex(
  child: Person,
  inTreeParents: string[],
  personMap: Map<string, Person>,
  depthMap: Map<string, number>,
  doc: DesignDocumentModel,
  policyDoc?: DesignDocumentModel
): string {
  if (inTreeParents.length === 1) return inTreeParents[0];

  // 1. Explizite Regel am Kind oder an einem Elternteil prüfen (Policy-Dokument vorrangig)
  const checkImplexOverride = (ruleOwner: DesignDocumentModel | undefined): string | null => {
    if (!ruleOwner) return null;
    const childRuleParent = ruleOwner.personRules[child.id]?.implexActiveParentId;
    if (childRuleParent && inTreeParents.includes(childRuleParent)) {
      return childRuleParent;
    }
    for (const pid of inTreeParents) {
      const pRule = ruleOwner.personRules[pid]?.implexActiveParentId;
      if (pRule && inTreeParents.includes(pRule)) {
        return pRule;
      }
    }
    return null;
  };

  const overrideFromPolicy = policyDoc && policyDoc !== doc ? checkImplexOverride(policyDoc) : null;
  if (overrideFromPolicy) return overrideFromPolicy;
  const overrideFromDoc = checkImplexOverride(doc);
  if (overrideFromDoc) return overrideFromDoc;

  const { fatherId, motherId } = resolveFatherAndMother(child, personMap);
  const policy: LineagePolicy = policyDoc?.lineagePolicy || doc.lineagePolicy || 'patrilinear';

  if (policy === 'patrilinear') {
    if (fatherId && inTreeParents.includes(fatherId)) return fatherId;
    if (motherId && inTreeParents.includes(motherId)) return motherId;
  } else if (policy === 'matrilinear') {
    if (motherId && inTreeParents.includes(motherId)) return motherId;
    if (fatherId && inTreeParents.includes(fatherId)) return fatherId;
  } else {
    // 'oldest_branch': kürzere Generationstiefe ab Spitzenahn, danach älteres Geburtsdatum
    const sorted = [...inTreeParents].sort((a, b) => {
      const da = depthMap.get(a) ?? 999;
      const db = depthMap.get(b) ?? 999;
      if (da !== db) return da - db;
      return compareBirthSortKeys(personMap.get(a)?.birth_date, personMap.get(b)?.birth_date);
    });
    return sorted[0];
  }

  return inTreeParents[0];
}

export function resolveGenealogyTree(
  doc: DesignDocumentModel,
  persons: Person[],
  locale: string = 'de',
  masterRootPersonId?: string,
  policyDoc?: DesignDocumentModel
): ResolvedLineageResult {
  const personMap = new Map<string, Person>();
  const childrenByParent = new Map<string, Set<string>>();

  for (const p of persons) {
    personMap.set(p.id, p);
  }

  for (const p of persons) {
    for (const pid of p.parent_ids || []) {
      if (!childrenByParent.has(pid)) childrenByParent.set(pid, new Set());
      childrenByParent.get(pid)!.add(p.id);
    }
  }

  const rootPerson = personMap.get(doc.rootPersonId);
  if (!rootPerson) {
    return {
      documentId: doc.id,
      rootPersonId: doc.rootPersonId,
      personMap,
      resolvedMeta: new Map(),
      rootGroup: null,
      allGroups: [],
      visiblePersonIds: new Set(),
    };
  }

  const effectivePolicyDoc = policyDoc || doc;
  const effectivePolicy: LineagePolicy =
    effectivePolicyDoc.lineagePolicy || doc.lineagePolicy || 'patrilinear';
  const rawStammahnId =
    masterRootPersonId ||
    (policyDoc && policyDoc !== doc ? policyDoc.rootPersonId : doc.rootPersonId);
  const stammahnId = personMap.has(rawStammahnId) ? rawStammahnId : doc.rootPersonId;

  // Schritt 1: Globale BFS vom Stammahn (Spitzenahn), damit alle Implex-Zweige gemeinsam aufgelöst werden
  const stammahnDepthMap = new Map<string, number>();
  const runBfs = (startId: string) => {
    if (stammahnDepthMap.has(startId)) return;
    const queue: string[] = [startId];
    stammahnDepthMap.set(startId, 1);

    let qIdx = 0;
    while (qIdx < queue.length) {
      const curId = queue[qIdx++];
      const curDepth = stammahnDepthMap.get(curId) || 1;
      const rawChildren = Array.from(childrenByParent.get(curId) || []);
      rawChildren.sort((a, b) =>
        compareBirthSortKeys(personMap.get(a)?.birth_date, personMap.get(b)?.birth_date)
      );
      for (const cid of rawChildren) {
        if (!stammahnDepthMap.has(cid)) {
          stammahnDepthMap.set(cid, curDepth + 1);
          queue.push(cid);
        }
      }
    }
  };
  runBfs(stammahnId);
  if (!stammahnDepthMap.has(doc.rootPersonId)) {
    runBfs(doc.rootPersonId);
  }

  // Schritt 2: Ausgeblendete Personen (isHidden) markieren – Wurzeln bleiben immer sichtbar
  const hiddenSet = new Set<string>();
  for (const pid of stammahnDepthMap.keys()) {
    if (pid === doc.rootPersonId || pid === stammahnId) continue;
    if (doc.personRules[pid]?.isHidden || effectivePolicyDoc.personRules[pid]?.isHidden) {
      hiddenSet.add(pid);
    }
  }

  // Schritt 3: Eindeutigen primären Elternteil je Nachkomme im gesamten Stammahn-Baum bestimmen + Implex-Paare erfassen
  const resolvedParentByChild = new Map<string, string>();
  const resolvedChildrenByParent = new Map<string, string[]>();
  interface ImplexPairRecord {
    activeParentId: string;
    otherParentId: string;
    childIds: string[];
  }
  const implexRecords: ImplexPairRecord[] = [];
  const implexMap = new Map<string, ImplexPairRecord>();

  for (const cid of stammahnDepthMap.keys()) {
    if (cid === stammahnId || hiddenSet.has(cid)) continue;
    const child = personMap.get(cid);
    if (!child) continue;

    const candidateParents = (child.parent_ids || []).filter(
      pid => stammahnDepthMap.has(pid) && !hiddenSet.has(pid)
    );
    if (candidateParents.length === 0) continue;

    const primaryParent = selectPrimaryParentForImplex(
      child,
      candidateParents,
      personMap,
      stammahnDepthMap,
      doc,
      effectivePolicyDoc
    );
    resolvedParentByChild.set(cid, primaryParent);

    if (!resolvedChildrenByParent.has(primaryParent)) {
      resolvedChildrenByParent.set(primaryParent, []);
    }
    resolvedChildrenByParent.get(primaryParent)!.push(cid);

    if (candidateParents.length > 1) {
      for (const otherParent of candidateParents) {
        if (otherParent === primaryParent) continue;
        const pairKey = `${primaryParent}__${otherParent}`;
        let rec = implexMap.get(pairKey);
        if (!rec) {
          rec = { activeParentId: primaryParent, otherParentId: otherParent, childIds: [] };
          implexMap.set(pairKey, rec);
          implexRecords.push(rec);
        }
        rec.childIds.push(cid);
      }
    }
  }

  for (const [pid, kids] of resolvedChildrenByParent.entries()) {
    kids.sort((a, b) =>
      compareBirthSortKeys(personMap.get(a)?.birth_date, personMap.get(b)?.birth_date)
    );
    resolvedChildrenByParent.set(pid, kids);
  }

  // Schritt 4: Globale Henry-Codes & Generationen ab Stammahn berechnen, dann für doc.rootPersonId übernehmen
  const globalHenryByPerson = new Map<string, string>();
  const globalGenByPerson = new Map<string, number>();

  function assignGlobalCodes(
    personId: string,
    derivedHenryCode: string,
    derivedGen: number,
    visited: Set<string>,
    inheritedOverride: boolean = false
  ) {
    if (visited.has(personId)) return;
    visited.add(personId);
    const p = personMap.get(personId);
    if (!p) return;

    const hasImplexOverride =
      inheritedOverride ||
      Boolean(effectivePolicyDoc.personRules[personId]?.implexActiveParentId) ||
      Boolean(doc.personRules[personId]?.implexActiveParentId);
    const probandEntry = p.proband_data?.[stammahnId];
    const useProbandEntry =
      Boolean(probandEntry?.henry_code) &&
      !hasImplexOverride &&
      (personId === stammahnId || effectivePolicy === 'patrilinear');

    const effectiveHenryCode = useProbandEntry ? probandEntry!.henry_code : derivedHenryCode;
    const effectiveGen =
      useProbandEntry && typeof probandEntry!.generation === 'number' && probandEntry!.generation > 0
        ? probandEntry!.generation
        : derivedGen;

    globalHenryByPerson.set(personId, effectiveHenryCode);
    globalGenByPerson.set(personId, effectiveGen);

    const children = resolvedChildrenByParent.get(personId) || [];
    children.forEach((cid, idx) => {
      assignGlobalCodes(
        cid,
        `${effectiveHenryCode}${nextHenrySuffix(idx + 1)}`,
        effectiveGen + 1,
        visited,
        hasImplexOverride
      );
    });
  }

  const stammahnPerson = personMap.get(stammahnId);
  const stammahnProbandEntry = stammahnPerson?.proband_data?.[stammahnId];
  assignGlobalCodes(
    stammahnId,
    stammahnProbandEntry?.henry_code || '1',
    typeof stammahnProbandEntry?.generation === 'number' && stammahnProbandEntry.generation > 0
      ? stammahnProbandEntry.generation
      : 1,
    new Set(),
    false
  );

  // Sub-Bäume behalten immer die Henry-Codes & Generationen relativ zum ausgewählten Stammahn!
  const rootProbandEntry = rootPerson.proband_data?.[stammahnId];
  const rootInitialCode =
    globalHenryByPerson.get(doc.rootPersonId) || rootProbandEntry?.henry_code || '1';
  const rootInitialGen =
    globalGenByPerson.get(doc.rootPersonId) ||
    (typeof rootProbandEntry?.generation === 'number' && rootProbandEntry.generation > 0
      ? rootProbandEntry.generation
      : 1);

  const resolvedMeta = new Map<string, ResolvedPersonMeta>();
  const visiblePersonIds = new Set<string>();

  function assignCodesAndGen(
    personId: string,
    derivedHenryCode: string,
    derivedGen: number,
    visited: Set<string>,
    inheritedOverride: boolean = false
  ) {
    if (visited.has(personId)) return;
    visited.add(personId);
    const p = personMap.get(personId);
    if (!p) return;

    const hasImplexOverride =
      inheritedOverride ||
      Boolean(effectivePolicyDoc.personRules[personId]?.implexActiveParentId) ||
      Boolean(doc.personRules[personId]?.implexActiveParentId);
    const probandEntry = p.proband_data?.[stammahnId];
    const useProbandEntry =
      Boolean(probandEntry?.henry_code) &&
      !hasImplexOverride &&
      (personId === doc.rootPersonId || effectivePolicy === 'patrilinear');

    const effectiveHenryCode =
      globalHenryByPerson.get(personId) ||
      (useProbandEntry ? probandEntry!.henry_code : derivedHenryCode);
    const effectiveGen =
      globalGenByPerson.get(personId) ||
      (useProbandEntry && typeof probandEntry!.generation === 'number' && probandEntry!.generation > 0
        ? probandEntry!.generation
        : derivedGen);

    visiblePersonIds.add(personId);
    const children = resolvedChildrenByParent.get(personId) || [];

    resolvedMeta.set(personId, {
      person: p,
      henryCode: effectiveHenryCode,
      generation: effectiveGen,
      resolvedParentId: resolvedParentByChild.get(personId) || null,
      childrenIds: children,
      spouses: [],
      implexBadges: [],
      occupationText: readPersonOccupation(p) || undefined,
    });

    children.forEach((cid, idx) => {
      assignCodesAndGen(
        cid,
        `${effectiveHenryCode}${nextHenrySuffix(idx + 1)}`,
        effectiveGen + 1,
        visited,
        hasImplexOverride
      );
    });
  }

  assignCodesAndGen(doc.rootPersonId, rootInitialCode, rootInitialGen, new Set(), false);

  // Schritt 5: Ehepartner-Zeilen & Implex-Badges befüllen
  const onlyYears = Boolean(doc.cardConfig.showOnlyYears);
  for (const [pid, meta] of resolvedMeta.entries()) {
    const p = meta.person;
    const spouses = p.spouses || [];
    meta.spouses = spouses.map((sp, idx) => {
      const partner = personMap.get(sp.id);
      const partnerMeta = resolvedMeta.get(sp.id);
      const partnerName = partner
        ? `${partner.given_name || ''} ${partner.surname || ''}`.trim() || 'N.N.'
        : 'N.N.';

      const marrText = sp.date
        ? `⚭ ${formatLocalizedDate(sp.date, locale, onlyYears)}`
        : undefined;
      let divText: string | undefined;
      if (sp.is_divorced || sp.divorce_date) {
        divText = sp.divorce_date
          ? `⚮ ${formatLocalizedDate(sp.divorce_date, locale, onlyYears)}`
          : `⚮ ${tLocale('genealogy_divorced_abbr', locale)}`;
      }

      const bDatePart =
        doc.cardConfig.showSpouseBirthDate && partner?.birth_date
          ? formatLocalizedDate(partner.birth_date, locale, onlyYears)
          : '';
      const bPlacePart =
        doc.cardConfig.showSpouseBirthPlace && partner?.birth_place
          ? partner.birth_place.trim()
          : '';
      const birthText =
        bDatePart || bPlacePart
          ? `* ${bDatePart}${bDatePart && bPlacePart ? ` (${bPlacePart})` : bPlacePart}`
          : undefined;

      const dDatePart =
        doc.cardConfig.showSpouseDeathDate && partner?.death_date
          ? formatLocalizedDate(partner.death_date, locale, onlyYears)
          : '';
      const dPlacePart =
        doc.cardConfig.showSpouseDeathPlace && partner?.death_place
          ? partner.death_place.trim()
          : '';
      const deathText =
        dDatePart || dPlacePart
          ? `† ${dDatePart}${dDatePart && dPlacePart ? ` (${dPlacePart})` : dPlacePart}`
          : undefined;

      // Implex prüfen
      const impOutgoing = implexRecords.find(
        r => r.otherParentId === pid && r.activeParentId === sp.id
      );
      const impIncoming = implexRecords.find(
        r => r.activeParentId === pid && r.otherParentId === sp.id
      );

      return {
        partnerId: sp.id,
        orderIndex: idx + 1,
        fullName: partnerName,
        henryCode:
          partnerMeta?.henryCode ||
          globalHenryByPerson.get(sp.id) ||
          partner?.proband_data?.[stammahnId]?.henry_code,
        marriageText: marrText,
        divorceText: divText,
        birthText,
        deathText,
        implexTargetParentId: impOutgoing ? impOutgoing.activeParentId : impIncoming ? impIncoming.otherParentId : undefined,
        implexTargetCode: impOutgoing
          ? globalHenryByPerson.get(impOutgoing.activeParentId) ||
            resolvedMeta.get(impOutgoing.activeParentId)?.henryCode
          : impIncoming
          ? globalHenryByPerson.get(impIncoming.otherParentId) ||
            resolvedMeta.get(impIncoming.otherParentId)?.henryCode
          : undefined,
        implexIsHere: Boolean(impIncoming),
      };
    });

    // Implex-Badges explizit am Knoten sammeln (sowohl Ziel als auch Verweis – auch über Sub-Baum-Grenzen hinweg)
    for (const rec of implexRecords) {
      if (rec.otherParentId === pid) {
        const activePerson = personMap.get(rec.activeParentId);
        const activeCode =
          resolvedMeta.get(rec.activeParentId)?.henryCode ||
          globalHenryByPerson.get(rec.activeParentId) ||
          activePerson?.proband_data?.[stammahnId]?.henry_code;
        if (activePerson && activeCode) {
          meta.implexBadges.push({
            partnerId: rec.activeParentId,
            partnerName: `${activePerson.given_name || ''} ${activePerson.surname || ''}`.trim() || 'N.N.',
            partnerCode: activeCode,
            childCount: rec.childIds.length,
            isBranchAttachedHere: false,
            affectedChildIds: [...rec.childIds],
            chosenParentIdIfClicked: pid,
          });
        }
      } else if (rec.activeParentId === pid) {
        const otherPerson = personMap.get(rec.otherParentId);
        const otherCode =
          resolvedMeta.get(rec.otherParentId)?.henryCode ||
          globalHenryByPerson.get(rec.otherParentId) ||
          otherPerson?.proband_data?.[stammahnId]?.henry_code;
        if (otherPerson && otherCode) {
          meta.implexBadges.push({
            partnerId: rec.otherParentId,
            partnerName: `${otherPerson.given_name || ''} ${otherPerson.surname || ''}`.trim() || 'N.N.',
            partnerCode: otherCode,
            childCount: rec.childIds.length,
            isBranchAttachedHere: true,
            affectedChildIds: [...rec.childIds],
            chosenParentIdIfClicked: rec.otherParentId,
          });
        }
      }
    }
  }

  // Schritt 6: Geschwistergruppen aufbauen (inkl. Ehe-Trennung [I]/[II], Level-Offset, Wrapping-Regeln)
  const allGroups: ResolvedGroupNode[] = [];

  function buildGroupsForParent(parentId: string | null, members: string[], baseGen: number): ResolvedGroupNode[] {
    if (members.length === 0) return [];

    // Gruppierung nach Ehe, falls parentRule.splitChildrenByMarriage aktiv ist
    const parentRule = parentId ? doc.personRules[parentId] : undefined;
    const parentPerson = parentId ? personMap.get(parentId) : undefined;

    interface GroupBucket {
      groupKey: string;
      memberIds: string[];
      marriageIndex?: number;
      marriageLabel?: string;
      isSplit?: boolean;
    }

    const rawBuckets: GroupBucket[] = [];
    if (parentId && parentPerson && parentRule?.splitChildrenByMarriage && (parentPerson.spouses?.length || 0) > 1) {
      const spouseOrder = parentPerson.spouses.map(s => s.id);
      const byOtherParent = new Map<string, string[]>();
      for (const cid of members) {
        const child = personMap.get(cid);
        const otherP = (child?.parent_ids || []).find(p => p !== parentId) || '__unknown__';
        if (!byOtherParent.has(otherP)) byOtherParent.set(otherP, []);
        byOtherParent.get(otherP)!.push(cid);
      }

      const orderedOtherParents = Array.from(byOtherParent.keys()).sort((a, b) => {
        const ia = spouseOrder.indexOf(a);
        const ib = spouseOrder.indexOf(b);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      });

      const roman = ['I', 'II', 'III', 'IV', 'V', 'VI'];
      orderedOtherParents.forEach((otherId, idx) => {
        const romanLabel = roman[idx] || String(idx + 1);
        rawBuckets.push({
          groupKey: `${doc.id}::grp_${parentId}_m_${otherId}`,
          memberIds: byOtherParent.get(otherId) || [],
          marriageIndex: idx + 1,
          marriageLabel: `[${romanLabel}]`,
        });
      });
    } else {
      rawBuckets.push({
        groupKey: parentId ? `${doc.id}::grp_${parentId}` : `${doc.id}::grp_root`,
        memberIds: members,
      });
    }

    // Optionale benutzerdefinierte Gruppen-Splits über personRules[m].customGroupKey
    const finalBuckets: GroupBucket[] = [];
    for (const b of rawBuckets) {
      const subBuckets = new Map<string, string[]>();
      for (const mid of b.memberIds) {
        const cKey = doc.personRules[mid]?.customGroupKey || b.groupKey;
        if (!subBuckets.has(cKey)) subBuckets.set(cKey, []);
        subBuckets.get(cKey)!.push(mid);
      }
      if (subBuckets.size <= 1) {
        const key = Array.from(subBuckets.keys())[0] || b.groupKey;
        finalBuckets.push({ ...b, groupKey: key });
      } else {
        let sIdx = 0;
        for (const [k, mIds] of subBuckets.entries()) {
          finalBuckets.push({
            ...b,
            groupKey: k,
            memberIds: mIds,
            isSplit: sIdx > 0 || b.isSplit,
          });
          sIdx++;
        }
      }
    }

    return finalBuckets.map(bucket => {
      const grpRule = doc.groupRules[bucket.groupKey];
      const memberLevelOffsets = bucket.memberIds.map(mid => doc.personRules[mid]?.levelOffset || 0);
      const maxOffset = Math.max(0, ...memberLevelOffsets);
      const computedLevel = grpRule?.levelOverride ?? Math.max(1, baseGen + maxOffset);

      const node: ResolvedGroupNode = {
        groupKey: bucket.groupKey,
        ownerDocumentId: doc.id,
        anchorParentId: parentId,
        marriageIndex: bucket.marriageIndex,
        marriageLabel: bucket.marriageLabel,
        baseGeneration: baseGen,
        level: computedLevel,
        memberIds: bucket.memberIds,
        maxColumnsPerRow: grpRule?.maxColumnsPerRow ?? null,
        relativeDeltaX: grpRule?.relativeDeltaX ?? 0,
        dockTargetGroupKey: grpRule?.dockTargetGroupKey ?? null,
        isSubtree: doc.documentKind === 'subtree',
        subDocumentId: doc.documentKind === 'subtree' ? doc.id : undefined,
        isSplit: bucket.isSplit,
        childGroups: [],
      };
      allGroups.push(node);

      for (const mid of bucket.memberIds) {
        const childIds = resolvedChildrenByParent.get(mid) || [];
        if (childIds.length > 0) {
          const sub = buildGroupsForParent(mid, childIds, computedLevel + 1);
          node.childGroups.push(...sub);
        }
      }

      return node;
    });
  }

  const rootGroups = buildGroupsForParent(null, [doc.rootPersonId], 1);
  return {
    documentId: doc.id,
    rootPersonId: doc.rootPersonId,
    personMap,
    resolvedMeta,
    rootGroup: rootGroups[0] || null,
    allGroups,
    visiblePersonIds,
  };
}
