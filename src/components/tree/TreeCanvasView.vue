<script lang="ts">
import { nextTick, type Ref } from 'vue';

export function centerTreeOnPerson(personId: string, pan: Ref<{ x: number; y: number }>) {
  function doCenter() {
    const viewportEl = document.querySelector('.tree-viewport') as HTMLElement | null;
    if (!viewportEl) return;

    let targetEl = viewportEl.querySelector(`[data-person-id="${personId}"]`) as HTMLElement | null;
    if (!targetEl) {
      targetEl = viewportEl.querySelector('.node-card.active') as HTMLElement | null;
    }
    if (!targetEl) return;

    const vRect = viewportEl.getBoundingClientRect();
    const tRect = targetEl.getBoundingClientRect();

    const vCenterX = vRect.left + vRect.width / 2;
    const vCenterY = vRect.top + vRect.height / 2;

    const tCenterX = tRect.left + tRect.width / 2;
    const tCenterY = tRect.top + tRect.height / 2;

    const deltaX = vCenterX - tCenterX;
    const deltaY = vCenterY - tCenterY;

    if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) {
      pan.value.x = Math.round(pan.value.x + deltaX);
      pan.value.y = Math.round(pan.value.y + deltaY);
    }
  }

  nextTick(() => {
    requestAnimationFrame(() => {
      doCenter();
      setTimeout(() => {
        doCenter();
      }, 60);
      setTimeout(() => {
        doCenter();
      }, 180);
    });
  });
}
</script>

<script setup lang="ts">
import { ref, computed, toRef } from 'vue';
import { useI18n } from 'vue-i18n';
import TreeNode from '../TreeNode.vue';
import FreeQueryModal from '../modals/FreeQueryModal.vue';
import ShortestPathModal from '../modals/ShortestPathModal.vue';
import {
  comparePersonsByBirth,
  type Person,
  type RelationInfo,
  type TreeNodeData,
} from '../../composables/usePersons';
import { getParentHenryCode } from '../../composables/useShortestPath';

const props = defineProps<{
  persons: Person[];
  activeProbandTab: string | null;
  currentTreeRootId: string | null;
  freeInitialRootId: string | null;
  selectedPerson: Person | null;
  expandedNodes: Map<string, boolean>;
  expandedSideNodes: Map<string, { spouses: boolean; parents: boolean }>;
  expandedFromChildMap: Map<string, string>;
  activePartnerPath: Person[];
  highlightedPathIds: Set<string>;
  shortestPathIncludeSpouses: boolean;
  pan: { x: number; y: number };
  zoom: number;
  getActiveStartCode: () => string;
  getCode: (person: Person) => string | null;
}>();

const emit = defineEmits<{
  'update:currentTreeRootId': [val: string | null];
  'update:freeInitialRootId': [val: string | null];
  'update:selectedPerson': [val: Person | null];
  'update:activeProbandTab': [val: string | null];
  'update:zoom': [val: number];
  'clear-partner-path': [];
  'jump-to': [personId: string];
  'show-partner-path': [personAId: string, personBId: string];
}>();

const { t } = useI18n();

const treeSearchQuery = ref<string>('');
const panRef = toRef(props, 'pan');

// Canvas Panning & Zooming
let isDragging = false;
let dragStart = { x: 0, y: 0 };

function startDrag(e: MouseEvent) {
  isDragging = true;
  dragStart = { x: e.clientX - props.pan.x, y: e.clientY - props.pan.y };
}

function onDrag(e: MouseEvent) {
  if (!isDragging) return;
  props.pan.x = e.clientX - dragStart.x;
  props.pan.y = e.clientY - dragStart.y;
}

function stopDrag() {
  isDragging = false;
}

function handleZoom(e: WheelEvent) {
  e.preventDefault();
  if (e.deltaY < 0) {
    emit('update:zoom', Math.min(props.zoom + 0.05, 2.5));
  } else {
    emit('update:zoom', Math.max(props.zoom - 0.05, 0.2));
  }
}

function resetZoomPan() {
  props.pan.x = 0;
  props.pan.y = 0;
  emit('update:zoom', 1);
  props.expandedFromChildMap.clear();
  emit('update:currentTreeRootId', props.activeProbandTab ? null : props.freeInitialRootId);
}

const treeSearchResults = computed(() => {
  const rawQuery = treeSearchQuery.value.toLowerCase().trim();
  if (!rawQuery) return [];
  const cleanQuery = rawQuery.replace(/[\[\]]/g, '').trim();

  const pList = props.activeProbandTab
    ? props.persons.filter(p => p.proband_data[props.activeProbandTab!])
    : props.persons;

  return pList
    .filter(p => {
      // 1. Namen (Vorname, Nachname und kombinierter Name)
      const given = (p.given_name || '').toLowerCase();
      const surname = (p.surname || '').toLowerCase();
      const fullName = `${given} ${surname}`.trim();
      const reversedName = `${surname} ${given}`.trim();
      if (
        given.includes(rawQuery) ||
        surname.includes(rawQuery) ||
        fullName.includes(rawQuery) ||
        reversedName.includes(rawQuery)
      ) {
        return true;
      }

      // 2. ID
      if (
        p.id.toLowerCase().includes(rawQuery) ||
        (cleanQuery && p.id.toLowerCase().includes(cleanQuery))
      ) {
        return true;
      }

      // 3. Henry-Code (im aktiven Stammahn oder über alle Probanden)
      const activeHenry = props.activeProbandTab
        ? p.proband_data[props.activeProbandTab]?.henry_code
        : null;
      if (activeHenry) {
        const hLower = activeHenry.toLowerCase();
        if (hLower.includes(cleanQuery) || `[${hLower}]`.includes(rawQuery)) {
          return true;
        }
      }
      for (const pb of Object.values(p.proband_data || {})) {
        if (pb.henry_code) {
          const hLower = pb.henry_code.toLowerCase();
          if (hLower.includes(cleanQuery) || `[${hLower}]`.includes(rawQuery)) {
            return true;
          }
        }
      }

      return false;
    })
    .slice(0, 15);
});

const hierarchicalTree = computed<TreeNodeData[]>(() => {
  const pid = props.activeProbandTab;
  const pList = pid ? props.persons.filter(p => p.proband_data[pid]) : props.persons;
  const startCode = props.getActiveStartCode();

  const childrenMap = new Map<string, Person[]>();
  if (pid) {
    pList.forEach(p => {
      const hCode = p.proband_data[pid]?.henry_code;
      if (hCode) {
        const parentCode = getParentHenryCode(hCode, startCode);
        if (parentCode) {
          if (!childrenMap.has(parentCode)) childrenMap.set(parentCode, []);
          childrenMap.get(parentCode)!.push(p);
        }
      }
    });

    // Nachkommen in jedem Zweig chronologisch nach Geburt sortieren
    childrenMap.forEach(list => {
      list.sort(comparePersonsByBirth);
    });
  }

  let roots: Person[] = [];
  if (props.currentTreeRootId) {
    const r = props.persons.find(p => p.id === props.currentTreeRootId);
    if (r) roots = [r];
  } else if (pid) {
    const r = pList.find(p => p.id === pid) || props.persons.find(p => p.id === pid);
    if (r) roots = [r];
  } else {
    // Freie Ansicht ohne ausgewählte Startperson beginnt leer (mit Abfragemaske)
    return [];
  }

  if (!roots.length) return [];

  function buildNode(
    person: Person,
    isSideBranch = false,
    branchType: 'spouse' | 'parent' | null = null,
    relInfo: RelationInfo | null = null,
    visited = new Set<string>()
  ): TreeNodeData {
    const currentVisited = new Set(visited);
    currentVisited.add(person.id);
    const hCode = pid ? person.proband_data[pid]?.henry_code || '' : '';
    const gen = pid ? person.proband_data[pid]?.generation || 0 : 0;

    const childrenNodes: TreeNodeData[] = [];
    const spouseNodes: TreeNodeData[] = [];
    const parentNodes: TreeNodeData[] = [];

    if (!isSideBranch) {
      let childrenPersons: Person[] = [];
      if (pid && hCode) {
        childrenPersons = (childrenMap.get(hCode) || []).filter(c => !currentVisited.has(c.id));
        if (props.activePartnerPath.length > 0) {
          const existingChildIds = new Set(childrenPersons.map(c => c.id));
          const extraChildren = props.persons.filter(c => {
            if (
              currentVisited.has(c.id) ||
              existingChildIds.has(c.id) ||
              !props.highlightedPathIds.has(c.id)
            )
              return false;
            if (c.parent_ids.includes(person.id)) return true;
            if (props.shortestPathIncludeSpouses) {
              return person.spouses.some(
                sp => props.highlightedPathIds.has(sp.id) && c.parent_ids.includes(sp.id)
              );
            }
            return false;
          });
          if (extraChildren.length > 0) {
            childrenPersons = [...childrenPersons, ...extraChildren].sort(comparePersonsByBirth);
          }
        }
      } else {
        childrenPersons = props.persons
          .filter(c => {
            if (currentVisited.has(c.id)) return false;
            if (c.parent_ids.includes(person.id)) return true;
            if (
              props.activePartnerPath.length > 0 &&
              props.shortestPathIncludeSpouses &&
              props.highlightedPathIds.has(c.id)
            ) {
              return person.spouses.some(
                sp => props.highlightedPathIds.has(sp.id) && c.parent_ids.includes(sp.id)
              );
            }
            return false;
          })
          .sort(comparePersonsByBirth);
      }
      childrenNodes.push(
        ...childrenPersons.map(c => buildNode(c, false, null, null, currentVisited))
      );
    }

    const sideExp = props.expandedSideNodes.get(person.id);
    if (sideExp?.spouses) {
      const addedSpouseIds = new Set<string>();
      person.spouses.forEach(spConn => {
        if (!currentVisited.has(spConn.id) && !addedSpouseIds.has(spConn.id)) {
          const sp = props.persons.find(p => p.id === spConn.id);
          if (sp) {
            addedSpouseIds.add(spConn.id);
            const rInfo: RelationInfo = {
              type: 'spouse',
              date: spConn.date,
              place: spConn.place,
              is_divorced: spConn.is_divorced,
              divorce_date: spConn.divorce_date,
              partner_id: person.id,
            };
            spouseNodes.push(buildNode(sp, true, 'spouse', rInfo, currentVisited));
          }
        }
      });

      props.persons
        .filter(c => c.parent_ids.includes(person.id))
        .forEach(c => {
          c.parent_ids.forEach(coParentId => {
            if (
              coParentId !== person.id &&
              !currentVisited.has(coParentId) &&
              !addedSpouseIds.has(coParentId)
            ) {
              const coParent = props.persons.find(p => p.id === coParentId);
              if (coParent) {
                addedSpouseIds.add(coParentId);
                const rInfo: RelationInfo = {
                  type: 'spouse',
                  date: null,
                  place: null,
                  is_divorced: false,
                  divorce_date: null,
                  partner_id: person.id,
                };
                spouseNodes.push(buildNode(coParent, true, 'spouse', rInfo, currentVisited));
              }
            }
          });
        });
    }
    if (sideExp?.parents) {
      person.parent_ids.forEach(parentId => {
        if (!currentVisited.has(parentId)) {
          const pa = props.persons.find(p => p.id === parentId);
          if (pa) parentNodes.push(buildNode(pa, true, 'parent', null, currentVisited));
        }
      });
    }
    return {
      person,
      active_henry: hCode,
      active_gen: gen,
      children: childrenNodes,
      spouse_nodes: spouseNodes,
      parent_nodes: parentNodes,
      is_side_branch: isSideBranch,
      side_branch_type: branchType,
      relation_info: relInfo,
    };
  }
  return roots.map(r => buildNode(r));
});

function startFreeTreeWithPerson(person: Person) {
  emit('update:activeProbandTab', null);
  emit('update:freeInitialRootId', person.id);
  emit('update:currentTreeRootId', person.id);
  emit('update:selectedPerson', person);
  props.expandedNodes.clear();
  props.expandedSideNodes.clear();
  props.expandedFromChildMap.clear();
  props.expandedNodes.set(person.id, true);
  props.pan.x = 0;
  props.pan.y = 0;
  emit('update:zoom', 1);
}

function resetFreeTreeQuery() {
  emit('update:currentTreeRootId', null);
  emit('update:freeInitialRootId', null);
  props.expandedNodes.clear();
  props.expandedSideNodes.clear();
  props.expandedFromChildMap.clear();
  props.pan.x = 0;
  props.pan.y = 0;
  emit('update:zoom', 1);
}

// Klappt rekursiv alle Nachkommengenerationen unterhalb einer Person ein
function collapseDescendantsOf(personId: string, visited = new Set<string>()) {
  if (visited.has(personId)) return;
  visited.add(personId);
  props.expandedNodes.set(personId, false);
  const children = props.persons.filter(p => p.parent_ids.includes(personId));
  children.forEach(c => collapseDescendantsOf(c.id, visited));
}

function loadParentGeneration(rootNode: TreeNodeData) {
  let parentIdToLoad: string | null = null;
  const pid = props.activeProbandTab;
  const startCode = props.getActiveStartCode();
  const parentCode =
    pid && rootNode.active_henry ? getParentHenryCode(rootNode.active_henry, startCode) : null;

  if (pid && parentCode) {
    const parent = props.persons.find(p => p.proband_data[pid]?.henry_code === parentCode);
    if (parent) parentIdToLoad = parent.id;
  }

  if (!parentIdToLoad && rootNode.person.parent_ids.length > 0) {
    // Bevorzuge den Vater (M) als Hauptknoten, falls vorhanden, sonst ersten Elternteil
    const father = rootNode.person.parent_ids
      .map(id => props.persons.find(p => p.id === id))
      .find(p => p?.sex === 'M');
    parentIdToLoad = father ? father.id : rootNode.person.parent_ids[0];
  }

  if (parentIdToLoad) {
    const originChildId = rootNode.person.id;
    props.expandedFromChildMap.set(parentIdToLoad, originChildId);
    emit('update:currentTreeRootId', parentIdToLoad);
    props.expandedNodes.set(parentIdToLoad, true);
    // Ehepartner des geladenen Elternteils einblenden, damit beide Eltern direkt sichtbar sind
    const currentSide = props.expandedSideNodes.get(parentIdToLoad) || {
      spouses: false,
      parents: false,
    };
    currentSide.spouses = true;
    props.expandedSideNodes.set(parentIdToLoad, currentSide);
    props.pan.x = 0;
    props.pan.y = 0;

    // Nachkommengenerationen des ausgewählten Eintrags bleiben im Zustand wie zuvor; nur Geschwisterkinder einklappen
    const children = props.persons.filter(p => p.parent_ids.includes(parentIdToLoad!));
    children.forEach(c => {
      if (c.id === originChildId) {
        return;
      }
      collapseDescendantsOf(c.id);
    });

    // Auch falls Kinder über den Henry-Code zugeordnet sind: Nachkommen des gewählten Eintrags unberührt lassen
    if (pid) {
      const parentObj = props.persons.find(p => p.id === parentIdToLoad);
      const pCode = parentObj?.proband_data[pid]?.henry_code;
      if (pCode) {
        props.persons.forEach(p => {
          const cCode = p.proband_data[pid]?.henry_code;
          if (cCode && getParentHenryCode(cCode, startCode) === pCode) {
            if (p.id === originChildId) {
              return;
            }
            collapseDescendantsOf(p.id);
          }
        });
      }
    }

    // Fokus auf dem ausgewählten Eintrag beibehalten
    centerTreeOnPerson(originChildId, panRef);
  }
}

// Schließt alle Vorfahren-Knoten oberhalb eines bestimmten Eintrags (stopAtPersonId)
function closeAncestorChainAbove(stopAtPersonId: string) {
  let curr = props.currentTreeRootId;
  const visited = new Set<string>();
  while (curr && curr !== stopAtPersonId && !visited.has(curr)) {
    visited.add(curr);
    const nextChild = props.expandedFromChildMap.get(curr);
    props.expandedNodes.set(curr, false);
    props.expandedSideNodes.set(curr, { spouses: false, parents: false });
    props.expandedFromChildMap.delete(curr);
    const children = props.persons.filter(p => p.parent_ids.includes(curr!));
    children.forEach(c => {
      if (c.id !== nextChild) {
        collapseDescendantsOf(c.id);
        props.expandedSideNodes.set(c.id, { spouses: false, parents: false });
      }
    });
    if (nextChild) {
      curr = nextChild;
    } else {
      break;
    }
  }
}

// Klappt alle Vorfahrengenerationen oberhalb des gewählten Eintrags ein
function collapseAncestors(personId: string) {
  closeAncestorChainAbove(personId);
  emit('update:currentTreeRootId', personId);
  props.pan.x = 0;
  props.pan.y = 0;
}

// Wechselt in der Freien Ansicht den "führenden" Elterneintrag und schließt alle expandierten Knoten des zuvor ausgewählten Elternteils
function switchLeadingParent(currentLeadId: string, newLeadId: string) {
  if (props.activeProbandTab) return;

  const activeChildId = props.expandedFromChildMap.get(currentLeadId);
  let targetLeadId = newLeadId;

  if (activeChildId) {
    const activeChild = props.persons.find(p => p.id === activeChildId);
    if (activeChild && !activeChild.parent_ids.includes(targetLeadId)) {
      const otherParentId = activeChild.parent_ids.find(id => id !== currentLeadId);
      if (otherParentId) targetLeadId = otherParentId;
    }
  }

  // 1. Alle Vorfahren-Knoten oberhalb des bisherigen führenden Elternteils schließen
  closeAncestorChainAbove(currentLeadId);

  // 2. Den bisherigen führenden Elternteil selbst sowie dessen Seitenäste und nicht zum aktiven Pfad gehörende Nachkommen schließen
  props.expandedNodes.set(currentLeadId, false);
  props.expandedSideNodes.set(currentLeadId, { spouses: false, parents: false });
  props.expandedFromChildMap.delete(currentLeadId);

  const prevChildren = props.persons.filter(p => p.parent_ids.includes(currentLeadId));
  prevChildren.forEach(c => {
    if (
      !activeChildId ||
      c.id !== activeChildId ||
      !props.expandedFromChildMap.has(activeChildId)
    ) {
      collapseDescendantsOf(c.id);
      props.expandedSideNodes.set(c.id, { spouses: false, parents: false });
    }
  });

  // 3. Neuen führenden Elternteil als aktuelle Wurzel setzen und den bisherigen Elternteil seitlich als Partner einblenden
  emit('update:currentTreeRootId', targetLeadId);
  props.expandedSideNodes.set(targetLeadId, { spouses: true, parents: false });

  if (activeChildId) {
    const activeChild = props.persons.find(p => p.id === activeChildId);
    if (activeChild && activeChild.parent_ids.includes(targetLeadId)) {
      props.expandedFromChildMap.set(targetLeadId, activeChildId);
      props.expandedNodes.set(targetLeadId, true);
      const newChildren = props.persons.filter(p => p.parent_ids.includes(targetLeadId));
      newChildren.forEach(c => {
        if (c.id === activeChildId && props.expandedFromChildMap.has(activeChildId)) {
          props.expandedNodes.set(activeChildId, true);
        } else {
          collapseDescendantsOf(c.id);
        }
      });
    } else {
      collapseDescendantsOf(activeChildId);
      props.expandedFromChildMap.clear();
      props.expandedNodes.set(targetLeadId, false);
      emit('update:freeInitialRootId', targetLeadId);
    }
  } else {
    props.expandedNodes.set(targetLeadId, false);
    emit('update:freeInitialRootId', targetLeadId);
  }

  props.pan.x = 0;
  props.pan.y = 0;
}

function toggleTreeNode(personId: string) {
  const currentState = props.expandedNodes.get(personId) || false;
  if (currentState) {
    collapseDescendantsOf(personId);
  } else {
    props.expandedNodes.set(personId, true);
  }
}

function toggleSideNode(personId: string, type: 'spouses' | 'parents') {
  const current = props.expandedSideNodes.get(personId) || { spouses: false, parents: false };
  current[type] = !current[type];
  props.expandedSideNodes.set(personId, current);
}

function handleSearchSelect(personId: string) {
  treeSearchQuery.value = '';
  emit('jump-to', personId);
}
</script>

<template>
  <div class="tree-wrapper">
    <div class="tree-tools" @mousedown.stop v-if="activeProbandTab || currentTreeRootId">
      <div class="tree-tools-left">
        <div class="tree-search-wrapper">
          <input
            v-model="treeSearchQuery"
            :placeholder="t('tree_search_placeholder')"
            @keydown.enter="
              treeSearchResults.length > 0 && handleSearchSelect(treeSearchResults[0].id)
            "
          />
          <ul v-if="treeSearchQuery && treeSearchResults.length > 0" class="search-dropdown">
            <li
              v-for="res in treeSearchResults"
              :key="'s-' + res.id"
              @click="handleSearchSelect(res.id)"
            >
              {{ res.surname || 'N.N.' }}, {{ res.given_name || 'N.N.' }}
              <span v-if="getCode(res)">[{{ getCode(res) }}]</span>
              <small v-else>({{ res.id }})</small>
            </li>
          </ul>
        </div>

        <button
          v-if="!activeProbandTab && currentTreeRootId"
          class="btn-new-free-query"
          @click="resetFreeTreeQuery"
        >
          🔍 {{ t('free_new_query') }}
        </button>
      </div>

      <ShortestPathModal
        mode="banner"
        :active-partner-path="activePartnerPath"
        :selected-person-id="selectedPerson?.id || ''"
        :get-code="getCode"
        @clear-path="emit('clear-partner-path')"
        @jump-to="emit('jump-to', $event)"
      />
    </div>

    <!-- Freie Ansicht: Initiale Abfragemaske (leer beginnend ohne ausgewählte Startperson) -->
    <FreeQueryModal
      v-if="!activeProbandTab && !currentTreeRootId"
      :persons="persons"
      @select-person="startFreeTreeWithPerson"
    />

    <div
      v-else
      class="tree-viewport"
      @mousedown="startDrag"
      @mousemove="onDrag"
      @mouseup="stopDrag"
      @mouseleave="stopDrag"
      @wheel="handleZoom"
    >
      <div v-if="hierarchicalTree.length === 0" class="empty">{{ t('no_data') }}</div>
      <div
        v-else
        class="tree-transform"
        :style="{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }"
      >
        <div class="css-tree">
          <ul>
            <TreeNode
              v-for="root in hierarchicalTree"
              :key="root.person.id"
              :node="root"
              :is-root="true"
              :selected-id="selectedPerson?.id || ''"
              :expanded-nodes="expandedNodes"
              :expanded-side-nodes="expandedSideNodes"
              :highlighted-path-ids="highlightedPathIds"
              :is-free-view="!activeProbandTab"
              @select="p => emit('update:selectedPerson', p)"
              @toggle="toggleTreeNode"
              @toggle-side="toggleSideNode"
              @load-parent="loadParentGeneration"
              @collapse-ancestors="collapseAncestors"
              @switch-leading-parent="switchLeadingParent"
              @jump-to="emit('jump-to', $event)"
              @show-partner-path="(a, b) => emit('show-partner-path', a, b)"
            />
          </ul>
        </div>
      </div>

      <div class="floating-zoom-controls" @mousedown.stop @wheel.stop>
        <button @click="emit('update:zoom', Math.max(zoom - 0.1, 0.2))" :title="t('export_design_zoom_out')">
          ➖
        </button>
        <span>{{ Math.round(zoom * 100) }}%</span>
        <button @click="emit('update:zoom', Math.min(zoom + 0.1, 2.5))" :title="t('export_design_zoom_in')">
          ➕
        </button>
        <div class="divider"></div>
        <button @click="resetZoomPan" class="btn-nav-reset">{{ t('reset_root') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tree-wrapper {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
  background: #f8fafc;
}
.tree-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: space-between;
  align-items: center;
  padding: 0.55rem 1rem;
  border-bottom: 1px solid #e2e8f0;
  z-index: 10;
  background: #ffffff;
  flex-shrink: 0;
}
.tree-tools-left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.tree-search-wrapper {
  position: relative;
  width: 320px;
}
.tree-search-wrapper input {
  width: 100%;
  padding: 0.4rem 0.65rem;
  border: 1px solid #cbd5e1;
  border-radius: 7px;
  font-size: 0.82rem;
  color: #0f172a;
  background: #f8fafc;
  box-sizing: border-box;
}
.tree-search-wrapper input:focus {
  outline: none;
  border-color: #2563eb;
  background: #ffffff;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
}
.search-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  width: 100%;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 7px;
  max-height: 250px;
  overflow-y: auto;
  z-index: 100;
  list-style: none;
  padding: 0;
  margin: 0;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.14);
}
.search-dropdown li {
  padding: 0.5rem 0.7rem;
  cursor: pointer;
  border-bottom: 1px solid #f1f5f9;
  font-size: 0.82rem;
  color: #1e293b;
}
.search-dropdown li:hover {
  background: #eff6ff;
}
button {
  padding: 0.4rem 0.8rem;
  background-color: #2563eb;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
}
button:hover:not(:disabled) {
  background-color: #1d4ed8;
}
.btn-new-free-query {
  background-color: #eff6ff;
  color: #1d4ed8;
  border: 1px solid #bfdbfe;
  font-size: 0.8rem;
  padding: 0.38rem 0.75rem;
  border-radius: 6px;
}
.btn-new-free-query:hover:not(:disabled) {
  background-color: #dbeafe;
}
.tree-viewport {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  cursor: grab;
  background: #f8fafc;
  position: relative;
  user-select: none;
  -webkit-user-select: none;
}
.tree-viewport.dragging {
  cursor: grabbing;
}
.tree-transform {
  transform-origin: top center;
  width: 100%;
}
.floating-zoom-controls {
  position: absolute;
  bottom: 16px;
  left: 16px;
  background: rgba(255, 255, 255, 0.96);
  padding: 6px 10px;
  border-radius: 9px;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.12);
  display: flex;
  align-items: center;
  gap: 0.4rem;
  z-index: 50;
  border: 1px solid #cbd5e1;
}
.floating-zoom-controls button {
  background: #f8fafc;
  color: #334155;
  border: 1px solid #cbd5e1;
  padding: 0.22rem 0.55rem;
  border-radius: 6px;
  font-size: 0.85rem;
}
.floating-zoom-controls button:hover {
  background: #e2e8f0;
}
.floating-zoom-controls span {
  font-size: 0.8rem;
  font-weight: 700;
  color: #0f172a;
  width: 44px;
  text-align: center;
}
.divider {
  width: 1px;
  height: 18px;
  background: #cbd5e1;
  margin: 0 3px;
}
.btn-nav-reset {
  background-color: #334155 !important;
  color: white !important;
  font-size: 0.78rem !important;
  border-color: #1e293b !important;
}
.btn-nav-reset:hover {
  background-color: #0f172a !important;
}
:deep(.css-tree > ul) {
  padding-top: 35px;
  position: relative;
  display: flex;
  justify-content: center;
  padding-left: 0;
  margin: 0;
}
:deep(.css-tree li) {
  text-align: center;
  list-style-type: none;
  position: relative;
}
</style>

