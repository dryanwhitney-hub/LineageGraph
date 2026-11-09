import { ref, computed, watch, type Ref } from 'vue';
import type { Person, RootAncestorConfig } from './usePersons';
import { centerTreeOnPerson } from '../components/tree/TreeCanvasView.vue';

export function getParentHenryCode(hCode: string, startCode: string): string | null {
  if (!hCode || hCode === startCode || hCode.length <= startCode.length) return null;
  const xMatch = hCode.match(/^(.*?)X\d+$/);
  if (xMatch && xMatch[1].length >= startCode.length) {
    return xMatch[1];
  }
  return hCode.slice(0, -1);
}

export function getTreeAncestorChain(
  person: Person,
  allPersons: Person[],
  pid: string,
  startCode: string
): Person[] {
  const chain: Person[] = [person];
  let currCode = person.proband_data[pid]?.henry_code;
  while (currCode) {
    const parentCode = getParentHenryCode(currCode, startCode);
    if (!parentCode) break;
    const parent = allPersons.find(p => p.proband_data[pid]?.henry_code === parentCode);
    if (!parent) break;
    chain.push(parent);
    currCode = parentCode;
  }
  return chain;
}

// Erstellt per Breitensuche (BFS) eine Map aller Vorfahren einer Person (ancestorId -> kürzeste Kette [person, ..., ancestor])
export function buildAncestorPathsMap(
  startPerson: Person,
  allPersons: Person[]
): Map<string, Person[]> {
  const map = new Map<string, Person[]>();
  const queue: { person: Person; chain: Person[] }[] = [
    { person: startPerson, chain: [startPerson] },
  ];
  map.set(startPerson.id, [startPerson]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const parentId of current.person.parent_ids) {
      if (!map.has(parentId)) {
        const parentObj = allPersons.find(p => p.id === parentId);
        if (parentObj) {
          const nextChain = [...current.chain, parentObj];
          map.set(parentId, nextChain);
          queue.push({ person: parentObj, chain: nextChain });
        }
      }
    }
  }
  return map;
}

// Findet per Breitensuche (BFS) den kürzesten Pfad zwischen zwei Personen unter Einbeziehung von Eltern-, Kind- und Ehepartner-Verbindungen
export function findShortestPathWithSpouses(
  personA: Person,
  personB: Person,
  allPersons: Person[],
  pid: string | null,
  startCode: string
): Person[] {
  if (personA.id === personB.id) return [personA];

  const personById = new Map<string, Person>();
  allPersons.forEach(p => personById.set(p.id, p));

  const visited = new Set<string>([personA.id]);
  const queue: { person: Person; path: Person[] }[] = [{ person: personA, path: [personA] }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const u = current.person;

    if (u.id === personB.id) {
      return current.path;
    }

    const neighborIds: string[] = [];

    // 1. Eltern
    u.parent_ids.forEach(parentId => neighborIds.push(parentId));
    if (pid) {
      const uCode = u.proband_data[pid]?.henry_code;
      if (uCode) {
        const pCode = getParentHenryCode(uCode, startCode);
        if (pCode) {
          const hp = allPersons.find(p => p.proband_data[pid]?.henry_code === pCode);
          if (hp) neighborIds.push(hp.id);
        }
      }
    }

    // 2. Kinder
    allPersons.forEach(c => {
      if (c.parent_ids.includes(u.id)) {
        neighborIds.push(c.id);
      } else if (pid) {
        const uCode = u.proband_data[pid]?.henry_code;
        const cCode = c.proband_data[pid]?.henry_code;
        if (uCode && cCode && getParentHenryCode(cCode, startCode) === uCode) {
          neighborIds.push(c.id);
        }
      }
    });

    // 3. Ehepartner & Co-Elternteile
    u.spouses.forEach(s => neighborIds.push(s.id));
    allPersons.forEach(other => {
      if (other.spouses.some(s => s.id === u.id)) {
        neighborIds.push(other.id);
      }
      if (other.parent_ids.includes(u.id)) {
        other.parent_ids.forEach(coParentId => {
          if (coParentId !== u.id) neighborIds.push(coParentId);
        });
      }
    });

    for (const nId of neighborIds) {
      if (!visited.has(nId)) {
        const nObj = personById.get(nId);
        if (nObj) {
          visited.add(nId);
          const nextPath = [...current.path, nObj];
          if (nId === personB.id) {
            return nextPath;
          }
          queue.push({ person: nObj, path: nextPath });
        }
      }
    }
  }

  return [];
}

export function isParentChildStep(
  parentCandidate: Person,
  childCandidate: Person,
  pid: string | null,
  startCode: string
): boolean {
  if (childCandidate.parent_ids.includes(parentCandidate.id)) return true;
  if (pid) {
    const pCode = parentCandidate.proband_data[pid]?.henry_code;
    const cCode = childCandidate.proband_data[pid]?.henry_code;
    if (pCode && cCode && getParentHenryCode(cCode, startCode) === pCode) return true;
  }
  return false;
}

export function areSpousesOrCoParents(a: Person, b: Person, allPersons: Person[]): boolean {
  if (a.spouses.some(s => s.id === b.id) || b.spouses.some(s => s.id === a.id)) return true;
  return allPersons.some(c => c.parent_ids.includes(a.id) && c.parent_ids.includes(b.id));
}

export interface UseShortestPathOptions {
  persons: Ref<Person[]>;
  selectedPerson: Ref<Person | null>;
  activeProbandTab: Ref<string | null>;
  getActiveStartCode: () => string;
  currentView: Ref<'table' | 'tree' | 'design' | 'export' | 'research'>;
  currentTreeRootId: Ref<string | null>;
  freeInitialRootId: Ref<string | null>;
  pan: Ref<{ x: number; y: number }>;
  expandedNodes: Ref<Map<string, boolean>>;
  expandedSideNodes: Ref<Map<string, { spouses: boolean; parents: boolean }>>;
  expandedFromChildMap: Ref<Map<string, string>>;
  rootAncestors?: Ref<RootAncestorConfig[]>;
  setProbandTab?: (probandId: string | null) => void;
}

export function useShortestPath(options: UseShortestPathOptions) {
  const {
    persons,
    selectedPerson,
    activeProbandTab,
    getActiveStartCode,
    currentView,
    currentTreeRootId,
    freeInitialRootId,
    pan,
    expandedNodes,
    expandedSideNodes,
    expandedFromChildMap,
    rootAncestors,
    setProbandTab,
  } = options;

  const activePartnerPath = ref<Person[]>([]);
  const highlightedPathIds = computed<Set<string>>(
    () => new Set(activePartnerPath.value.map(p => p.id))
  );
  const shortestPathIncludeSpouses = ref<boolean>(false);
  const shortestPathEndpoints = ref<{ aId: string; bId: string } | null>(null);
  const shortestPathSearchQuery = ref<string>('');

  const shortestPathSearchResults = computed(() => {
    const query = shortestPathSearchQuery.value.toLowerCase().trim();
    if (!query || !selectedPerson.value) return [];
    const pid = activeProbandTab.value;
    const pList =
      pid && !shortestPathIncludeSpouses.value
        ? persons.value.filter(p => p.proband_data[pid])
        : persons.value;
    return pList
      .filter(
        p =>
          p.id !== selectedPerson.value!.id &&
          (p.id.toLowerCase().includes(query) ||
            (p.surname || '').toLowerCase().includes(query) ||
            (p.given_name || '').toLowerCase().includes(query) ||
            (pid && (p.proband_data[pid]?.henry_code || '').toLowerCase().includes(query)))
      )
      .slice(0, 10);
  });

  function clearPartnerPath() {
    activePartnerPath.value = [];
    shortestPathEndpoints.value = null;
  }

  function showPartnerPath(partnerAId: string, partnerBId: string) {
    const personA = persons.value.find(p => p.id === partnerAId);
    const personB = persons.value.find(p => p.id === partnerBId);
    if (!personA || !personB) return;

    shortestPathEndpoints.value = { aId: partnerAId, bId: partnerBId };

    const pid = activeProbandTab.value;
    const startCode = getActiveStartCode();

    let lcaPerson: Person | null = null;
    let fullPath: Person[] = [];

    if (shortestPathIncludeSpouses.value) {
      fullPath = findShortestPathWithSpouses(personA, personB, persons.value, pid, startCode);
      if (fullPath.length > 0) {
        // Relative Generationsebene entlang des Pfades bestimmen (Elternteil = -1, Kind = +1, Ehepartner = 0)
        const levels: number[] = [0];
        for (let i = 0; i < fullPath.length - 1; i++) {
          const curr = fullPath[i];
          const next = fullPath[i + 1];
          if (isParentChildStep(next, curr, pid, startCode)) {
            levels.push(levels[i] - 1);
          } else if (isParentChildStep(curr, next, pid, startCode)) {
            levels.push(levels[i] + 1);
          } else {
            levels.push(levels[i]);
          }
        }
        const minLevel = Math.min(...levels);
        const topCandidates = fullPath.filter((_, idx) => levels[idx] === minLevel);
        lcaPerson =
          (pid ? topCandidates.find(p => p.proband_data[pid]?.henry_code) : undefined) ||
          topCandidates.find(p =>
            fullPath.some(
              other => other.id !== p.id && isParentChildStep(p, other, pid, startCode)
            )
          ) ||
          topCandidates[0];
      } else {
        lcaPerson = personA;
        fullPath = [personA, personB];
      }
    } else {
      // Nur Blutsverwandtschaft (Eltern-Kind-Linien ohne Ehepartner-Abkürzung)
      if (pid && personA.proband_data[pid]?.henry_code && personB.proband_data[pid]?.henry_code) {
        const chainA = getTreeAncestorChain(personA, persons.value, pid, startCode);
        const chainB = getTreeAncestorChain(personB, persons.value, pid, startCode);

        const setBIds = new Set(chainB.map(p => p.id));
        lcaPerson =
          chainA.find(p => setBIds.has(p.id)) ||
          persons.value.find(p => p.id === pid) ||
          chainA[chainA.length - 1];

        const idxA = chainA.findIndex(p => p.id === lcaPerson!.id);
        const idxB = chainB.findIndex(p => p.id === lcaPerson!.id);

        const pathAtoLCA = idxA >= 0 ? chainA.slice(0, idxA + 1) : chainA;
        const pathLCAtoB =
          idxB > 0
            ? chainB.slice(0, idxB).reverse()
            : idxB === -1
              ? chainB.slice().reverse()
              : [];

        fullPath = [...pathAtoLCA, ...pathLCAtoB];
      } else {
        // Allgemeine Suche nach dem nächsten gemeinsamen Vorfahren über Eltern-Kind-Kanten
        const ancMapA = buildAncestorPathsMap(personA, persons.value);
        const ancMapB = buildAncestorPathsMap(personB, persons.value);

        let bestLcaId: string | null = null;
        let bestDist = Infinity;

        ancMapA.forEach((chainA, ancId) => {
          const chainB = ancMapB.get(ancId);
          if (chainB) {
            const totalDist = chainA.length + chainB.length;
            if (totalDist < bestDist) {
              bestDist = totalDist;
              bestLcaId = ancId;
            }
          }
        });

        if (bestLcaId) {
          const chainA = ancMapA.get(bestLcaId)!;
          const chainB = ancMapB.get(bestLcaId)!;
          lcaPerson = chainA[chainA.length - 1];
          fullPath = [...chainA, ...chainB.slice(0, -1).reverse()];
        } else {
          lcaPerson = personA;
          fullPath = [personA, personB];
        }
      }
    }

    if (!lcaPerson) return;

    activePartnerPath.value = fullPath;
    currentView.value = 'tree';
    currentTreeRootId.value = lcaPerson.id;
    pan.value = { x: 0, y: 0 };

    expandedNodes.value.clear();
    expandedSideNodes.value.clear();
    expandedFromChildMap.value.clear();

    const pathIdSet = new Set(fullPath.map(p => p.id));

    fullPath.forEach(p => {
      const hasOwnChildInPath = fullPath.some(
        other => other.id !== p.id && isParentChildStep(p, other, pid, startCode)
      );
      const hasSpouseChildInPath =
        shortestPathIncludeSpouses.value &&
        fullPath.some(
          sp =>
            sp.id !== p.id &&
            areSpousesOrCoParents(p, sp, persons.value) &&
            fullPath.some(
              other =>
                other.id !== sp.id &&
                other.id !== p.id &&
                isParentChildStep(sp, other, pid, startCode)
            )
        );
      if (hasOwnChildInPath || hasSpouseChildInPath) {
        expandedNodes.value.set(p.id, true);
      }

      const hasSpouseInPath = fullPath.some(
        other => other.id !== p.id && areSpousesOrCoParents(p, other, persons.value)
      );
      if (hasSpouseInPath && pathIdSet.has(p.id)) {
        const side = expandedSideNodes.value.get(p.id) || { spouses: false, parents: false };
        side.spouses = true;
        expandedSideNodes.value.set(p.id, side);
      }
    });
  }

  function startShortestPathTo(targetId: string) {
    if (!selectedPerson.value) return;
    shortestPathSearchQuery.value = '';
    showPartnerPath(selectedPerson.value.id, targetId);
  }

  // Öffnet nur den gewählten Eintrag und die dazu nötigen Generationen im Stammbaum (ohne "Kürzesten Pfad")
  function jumpToTreePerson(personId: string) {
    const target = persons.value.find(p => p.id === personId);
    if (!target) return;

    clearPartnerPath();
    selectedPerson.value = target;
    currentView.value = 'tree';

    expandedNodes.value.clear();
    expandedSideNodes.value.clear();
    expandedFromChildMap.value.clear();

    let pid = activeProbandTab.value;
    const startCode = getActiveStartCode();

    // 1. Prüfen, ob target (oder Ehepartner) im aktuell aktiven Probanden liegt
    const targetHasActiveCode = !!(pid && target.proband_data[pid]?.henry_code);
    const partnerHasActiveCode = !!(
      pid &&
      target.spouses.some(s => {
        const sp = persons.value.find(p => p.id === s.id);
        return sp && pid && sp.proband_data[pid]?.henry_code;
      })
    );

    if (!targetHasActiveCode && !partnerHasActiveCode && rootAncestors?.value) {
      // 2. Prüfen, ob target zu einem anderen konfigurierten Probanden gehört
      for (const ra of rootAncestors.value) {
        if (target.proband_data[ra.person_id]?.henry_code) {
          pid = ra.person_id;
          break;
        }
        const spMatch = target.spouses.some(s => {
          const sp = persons.value.find(p => p.id === s.id);
          return sp && sp.proband_data[ra.person_id]?.henry_code;
        });
        if (spMatch) {
          pid = ra.person_id;
          break;
        }
      }

      if (pid && pid !== activeProbandTab.value) {
        if (setProbandTab) {
          setProbandTab(pid);
        } else {
          activeProbandTab.value = pid;
        }
      }
    }

    const tCode = pid ? target.proband_data[pid]?.henry_code : null;

    if (pid && tCode) {
      currentTreeRootId.value = null;
      const chain = getTreeAncestorChain(target, persons.value, pid, startCode);
      // Alle Vorfahren-Generationen vom Stammahnen bis zum Elternteil von target öffnen, damit target sichtbar ist
      chain.slice(1).forEach(anc => {
        expandedNodes.value.set(anc.id, true);
      });
      expandedNodes.value.set(target.id, true);
    } else if (pid) {
      // Falls target selbst keinen Henry-Code hat, prüfen ob ein Ehepartner im Baum des Stammahnen liegt
      const partnerWithCode = target.spouses
        .map(s => persons.value.find(p => p.id === s.id))
        .find(p => p && p.proband_data[pid]?.henry_code);
      if (partnerWithCode) {
        currentTreeRootId.value = null;
        const chain = getTreeAncestorChain(partnerWithCode, persons.value, pid, startCode);
        chain.slice(1).forEach(anc => {
          expandedNodes.value.set(anc.id, true);
        });
        expandedSideNodes.value.set(partnerWithCode.id, { spouses: true, parents: false });
        expandedNodes.value.set(target.id, true);
      } else {
        // Nicht in diesem Probanden auffindbar -> In freie Ansicht wechseln
        if (setProbandTab) {
          setProbandTab(null);
        } else {
          activeProbandTab.value = null;
        }
        setupFreeTreeForTarget(target);
      }
    } else {
      // Freie Ansicht: Automatisch die Wurzel dieses Zweiges ermitteln und öffnen
      setupFreeTreeForTarget(target);
    }

    // Bildschirmausschnitt so setzen, dass der neu markierte Eintrag zentriert/fokussiert wird
    centerTreeOnPerson(target.id, pan);
  }

  function setupFreeTreeForTarget(target: Person) {
    const ancMap = buildAncestorPathsMap(target, persons.value);
    let oldestAncestorId = target.id;
    let maxDepth = 0;
    ancMap.forEach((chain, ancId) => {
      if (chain.length > maxDepth) {
        maxDepth = chain.length;
        oldestAncestorId = ancId;
      }
    });

    currentTreeRootId.value = oldestAncestorId;
    freeInitialRootId.value = oldestAncestorId;

    const chain = ancMap.get(oldestAncestorId);
    if (chain) {
      // chain ist [target, ..., oldestAncestor]
      chain.forEach(anc => {
        expandedNodes.value.set(anc.id, true);
      });
    }
    expandedNodes.value.set(target.id, true);
  }

  watch(shortestPathIncludeSpouses, () => {
    if (shortestPathEndpoints.value && activePartnerPath.value.length > 0) {
      showPartnerPath(shortestPathEndpoints.value.aId, shortestPathEndpoints.value.bId);
    }
  });

  return {
    activePartnerPath,
    highlightedPathIds,
    shortestPathIncludeSpouses,
    shortestPathEndpoints,
    shortestPathSearchQuery,
    shortestPathSearchResults,
    clearPartnerPath,
    showPartnerPath,
    startShortestPathTo,
    jumpToTreePerson,
  };
}

