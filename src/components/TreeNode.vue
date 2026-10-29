<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';

interface ProbandData { henry_code: string; generation: number; }
interface SpouseConnection { id: string; date: string | null; place: string | null; divorce_date: string | null; is_divorced: boolean; }
interface RelationInfo { type: 'spouse' | 'parent'; partner_id?: string | null; date?: string | null; place?: string | null; is_divorced?: boolean; divorce_date?: string | null; }

interface Person {
  id: string; 
  given_name: string | null; 
  surname: string | null; 
  sex: string | null;
  birth_date: string | null; 
  birth_place: string | null; 
  death_date: string | null; 
  death_place: string | null;
  proband_data: Record<string, ProbandData>; 
  gedcom_extra: Record<string, any>;
  spouses: SpouseConnection[]; 
  parent_ids: string[];
}

interface TreeNodeData {
  person: Person; 
  active_henry: string; 
  active_gen: number; 
  children: TreeNodeData[];
  spouse_nodes: TreeNodeData[]; 
  parent_nodes: TreeNodeData[];
  is_side_branch: boolean; 
  side_branch_type: 'spouse' | 'parent' | null; 
  relation_info: RelationInfo | null;
}

interface ArrowPoint {
  x: number;
  y: number;
}

const props = defineProps<{
  node: TreeNodeData;
  selectedId: string;
  expandedNodes: Map<string, boolean>;
  expandedSideNodes: Map<string, { spouses: boolean, parents: boolean }>;
  highlightedPathIds?: Set<string>;
  isRoot?: boolean;
  isFreeView?: boolean;
}>();

const emit = defineEmits<{
  (e: 'select', person: Person): void;
  (e: 'toggle', personId: string): void;
  (e: 'toggle-side', personId: string, type: 'spouses' | 'parents'): void;
  (e: 'load-parent', node: TreeNodeData): void;
  (e: 'collapse-ancestors', personId: string): void;
  (e: 'switch-leading-parent', currentLeadId: string, newLeadId: string): void;
  (e: 'jump-to', personId: string): void;
  (e: 'show-partner-path', partnerAId: string, partnerBId: string): void;
}>();

const liRef = ref<HTMLElement | null>(null);
const mainCardRef = ref<HTMLElement | null>(null);
const parentsListRef = ref<HTMLElement | null>(null);
const spousesListRef = ref<HTMLElement | null>(null);
const childrenListRef = ref<HTMLElement | null>(null);

const mainPaths = ref<string[]>([]);
const mainArrows = ref<ArrowPoint[]>([]);
const spousePaths = ref<string[]>([]);
const spouseArrows = ref<ArrowPoint[]>([]);
const highlightPaths = ref<string[]>([]);
const highlightArrows = ref<ArrowPoint[]>([]);

const extraRightMargin = ref<number>(0);
const childrenTopMargin = ref<number>(52);

const hasMarriageInfo = computed(() => {
  if (props.node.side_branch_type !== 'spouse') return false;
  const r = props.node.relation_info;
  return Boolean(
    r?.date ||
    r?.place ||
    r?.is_divorced ||
    r?.divorce_date ||
    props.node.person.death_date
  );
});

const marriageDatePlaceText = computed(() => {
  const r = props.node.relation_info;
  if (!r) return '';
  const parts: string[] = [];
  if (r.date) parts.push(r.date);
  if (r.place) parts.push(r.place);
  return parts.join(', ');
});

const divorceText = computed(() => {
  const r = props.node.relation_info;
  if (!r) return '';
  if (r.divorce_date) return `gesch. ${r.divorce_date}`;
  if (r.is_divorced) return 'gesch.';
  return '';
});

function handleBadgeClick() {
  if (!props.node.is_side_branch) return;
  emit('jump-to', props.node.person.id);
}

function handleSwitchFromMain() {
  const firstSpouseId = props.node.spouse_nodes[0]?.person.id || props.node.person.spouses[0]?.id;
  if (firstSpouseId) {
    emit('switch-leading-parent', props.node.person.id, firstSpouseId);
  }
}

function arrowPointsStr(pt: ArrowPoint, size = 5): string {
  // Pfeilspitze nach unten auf (pt.x, pt.y)
  return `${pt.x},${pt.y} ${pt.x - size},${pt.y - size * 1.4} ${pt.x + size},${pt.y - size * 1.4}`;
}

function getRelativeBox(el: HTMLElement, rootEl: HTMLElement, scale: number) {
  const r = el.getBoundingClientRect();
  const rootR = rootEl.getBoundingClientRect();
  const left = (r.left - rootR.left) / scale;
  const top = (r.top - rootR.top) / scale;
  const width = r.width / scale;
  const height = r.height / scale;
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    centerX: left + width / 2,
    centerY: top + height / 2,
  };
}

function updateConnectors() {
  if (props.node.side_branch_type === 'spouse' || !liRef.value || !mainCardRef.value) {
    mainPaths.value = [];
    mainArrows.value = [];
    spousePaths.value = [];
    spouseArrows.value = [];
    highlightPaths.value = [];
    highlightArrows.value = [];
    extraRightMargin.value = 0;
    return;
  }

  const rootEl = liRef.value;
  const rootRect = rootEl.getBoundingClientRect();
  const scale = rootEl.offsetWidth > 0 ? rootRect.width / rootEl.offsetWidth : 1;
  if (scale <= 0) return;

  const mainBox = getRelativeBox(mainCardRef.value, rootEl, scale);

  const newMainPaths: string[] = [];
  const newMainArrows: ArrowPoint[] = [];
  const newSpousePaths: string[] = [];
  const newSpouseArrows: ArrowPoint[] = [];
  const newHighlightPaths: string[] = [];
  const newHighlightArrows: ArrowPoint[] = [];

  const isMainHighlighted = Boolean(props.highlightedPathIds?.has(props.node.person.id));

  // 1. Verbindung von eingeblendeten Eltern (oben) mittig in die Hauptbox
  if (parentsListRef.value && props.node.parent_nodes.length > 0) {
    const parentCards = Array.from(
      parentsListRef.value.querySelectorAll<HTMLElement>(':scope > li > .node-cluster > .cluster-main-row > .main-card-anchor > .node-card')
    );
    if (parentCards.length > 0) {
      const pBoxes = parentCards.map(el => getRelativeBox(el, rootEl, scale));
      const maxParentBottom = Math.max(...pBoxes.map(b => b.bottom));
      const midY = (maxParentBottom + mainBox.top) / 2;

      const allX = [...pBoxes.map(b => b.centerX), mainBox.centerX];
      const minX = Math.min(...allX);
      const maxX = Math.max(...allX);

      pBoxes.forEach((pb, pIdx) => {
        newMainPaths.push(`M ${pb.centerX} ${pb.bottom} L ${pb.centerX} ${midY}`);
        const pNode = props.node.parent_nodes[pIdx];
        if (isMainHighlighted && pNode && props.highlightedPathIds?.has(pNode.person.id)) {
          newHighlightPaths.push(`M ${pb.centerX} ${pb.bottom} L ${pb.centerX} ${midY}`);
          const hMinX = Math.min(pb.centerX, mainBox.centerX);
          const hMaxX = Math.max(pb.centerX, mainBox.centerX);
          if (hMaxX > hMinX) {
            newHighlightPaths.push(`M ${hMinX} ${midY} L ${hMaxX} ${midY}`);
          }
          newHighlightPaths.push(`M ${mainBox.centerX} ${midY} L ${mainBox.centerX} ${mainBox.top}`);
          newHighlightArrows.push({ x: mainBox.centerX, y: mainBox.top });
        }
      });
      if (maxX > minX) {
        newMainPaths.push(`M ${minX} ${midY} L ${maxX} ${midY}`);
      }
      newMainPaths.push(`M ${mainBox.centerX} ${midY} L ${mainBox.centerX} ${mainBox.top}`);
      newMainArrows.push({ x: mainBox.centerX, y: mainBox.top });
    }
  }

  // 2. Seitliche Verbindung zu Ehepartnern (rechts neben der Hauptbox, farblich abgesetzt)
  interface MeasuredSpouse {
    personId: string;
    box: ReturnType<typeof getRelativeBox>;
  }
  const measuredSpouses: MeasuredSpouse[] = [];
  let maxSpouseBottom = mainBox.bottom;
  let maxSpouseRight = mainBox.right;

  if (spousesListRef.value && props.node.spouse_nodes.length > 0) {
    const spouseLis = Array.from(spousesListRef.value.querySelectorAll<HTMLElement>(':scope > li.is-spouse-node'));
    spouseLis.forEach((sLi, idx) => {
      const sCard = sLi.querySelector<HTMLElement>(':scope > .node-cluster > .cluster-main-row > .main-card-anchor > .node-card');
      const spouseNodeData = props.node.spouse_nodes[idx];
      if (sCard && spouseNodeData) {
        const sBox = getRelativeBox(sCard, rootEl, scale);
        measuredSpouses.push({ personId: spouseNodeData.person.id, box: sBox });
        if (sBox.bottom > maxSpouseBottom) maxSpouseBottom = sBox.bottom;
        if (sBox.right > maxSpouseRight) maxSpouseRight = sBox.right;
      }
    });

    if (measuredSpouses.length > 0) {
      const spouseLineY = mainBox.top + 14;
      const lastSpouseCenterX = Math.max(...measuredSpouses.map(s => s.box.centerX));
      // Horizontale Linie von der rechten Kante der Hauptbox bis zum letzten Ehepartner
      newSpousePaths.push(`M ${mainBox.right} ${spouseLineY} L ${lastSpouseCenterX} ${spouseLineY}`);
      // Vertikale Abzweigung nach unten in jeden Ehepartner mit Pfeilspitze
      measuredSpouses.forEach(s => {
        newSpousePaths.push(`M ${s.box.centerX} ${spouseLineY} L ${s.box.centerX} ${s.box.top}`);
        newSpouseArrows.push({ x: s.box.centerX, y: s.box.top });
        if (isMainHighlighted && props.highlightedPathIds?.has(s.personId)) {
          newHighlightPaths.push(`M ${mainBox.right} ${spouseLineY} L ${s.box.centerX} ${spouseLineY}`);
          newHighlightPaths.push(`M ${s.box.centerX} ${spouseLineY} L ${s.box.centerX} ${s.box.top}`);
          newHighlightArrows.push({ x: s.box.centerX, y: s.box.top });
        }
      });
    }
  }

  // Prüfen, wie viele Ehepartner gemeinsame sichtbare Kinder haben, um den vertikalen Abstand für die Linienführung zu reservieren
  const hasVisibleChildren = Boolean(
    props.expandedNodes.get(props.node.person.id) &&
    props.node.children.length > 0
  );

  let activeSpouseChildGroups = 0;
  if (hasVisibleChildren && measuredSpouses.length > 0) {
    measuredSpouses.forEach(s => {
      const hasChildHere = props.node.children.some(c => c.person.parent_ids.includes(s.personId));
      if (hasChildHere) activeSpouseChildGroups++;
    });
  }

  const spouseOverhangY = Math.max(0, Math.ceil(maxSpouseBottom - mainBox.bottom));
  const desiredChildrenTopMargin = spouseOverhangY + 62 + activeSpouseChildGroups * 12;
  if (Math.abs(childrenTopMargin.value - desiredChildrenTopMargin) > 1) {
    childrenTopMargin.value = desiredChildrenTopMargin;
  }

  // Rechten Überhang der Ehepartner berechnen, damit Nachbarknoten nicht überlappt werden,
  // die Hauptbox selbst aber mittig über ihren Kindern bleibt.
  const nominalRight = rootEl.offsetWidth;
  const neededExtraRight = Math.max(0, Math.ceil(maxSpouseRight - nominalRight + 16));
  if (Math.abs(extraRightMargin.value - neededExtraRight) > 2) {
    extraRightMargin.value = neededExtraRight;
  }

  // 3. Verbindung von der Hauptbox (mittig) und von den Ehepartnern zu den Kindern
  if (hasVisibleChildren && childrenListRef.value) {
    const childLis = Array.from(childrenListRef.value.querySelectorAll<HTMLElement>(':scope > li'));
    interface MeasuredChild {
      person: Person;
      box: ReturnType<typeof getRelativeBox>;
    }
    const measuredChildren: MeasuredChild[] = [];
    childLis.forEach((cLi, idx) => {
      const cCard = cLi.querySelector<HTMLElement>(':scope > .node-cluster > .cluster-main-row > .main-card-anchor > .node-card');
      const childData = props.node.children[idx];
      if (cCard && childData) {
        measuredChildren.push({
          person: childData.person,
          box: getRelativeBox(cCard, rootEl, scale),
        });
      }
    });

    if (measuredChildren.length > 0) {
      const minChildTopY = Math.min(...measuredChildren.map(c => c.box.top));
      const totalRoutingLevels = 1 + activeSpouseChildGroups;
      const mainBranchY = minChildTopY - (32 + (totalRoutingLevels - 1) * 11);

      // Hauptverbindung: Mitte Unterkante Personeneintrag -> mainBranchY -> Mitte Oberkante jedes eigenen Kindes (über dessen Top-Button)
      const ownMeasuredChildren = measuredChildren.filter(c =>
        c.person.parent_ids.includes(props.node.person.id) ||
        !measuredSpouses.some(s => c.person.parent_ids.includes(s.personId))
      );

      if (ownMeasuredChildren.length > 0) {
        newMainPaths.push(`M ${mainBox.centerX} ${mainBox.bottom} L ${mainBox.centerX} ${mainBranchY}`);

        const allMainX = [mainBox.centerX, ...ownMeasuredChildren.map(c => c.box.centerX)];
        const minMainX = Math.min(...allMainX);
        const maxMainX = Math.max(...allMainX);
        if (maxMainX > minMainX) {
          newMainPaths.push(`M ${minMainX} ${mainBranchY} L ${maxMainX} ${mainBranchY}`);
        }

        ownMeasuredChildren.forEach(c => {
          const targetTopY = c.box.top - 12;
          newMainPaths.push(`M ${c.box.centerX} ${mainBranchY} L ${c.box.centerX} ${targetTopY}`);
          newMainArrows.push({ x: c.box.centerX, y: targetTopY });
        });

        // Highlight für Verbindungslinien auf dem "Kürzesten Pfad" zwischen Hauptknoten und eigenen Kindern
        if (isMainHighlighted) {
          const highlightedChildren = ownMeasuredChildren.filter(c => props.highlightedPathIds?.has(c.person.id));
          if (highlightedChildren.length > 0) {
            newHighlightPaths.push(`M ${mainBox.centerX} ${mainBox.bottom} L ${mainBox.centerX} ${mainBranchY}`);
            const allHX = [mainBox.centerX, ...highlightedChildren.map(hc => hc.box.centerX)];
            const minHX = Math.min(...allHX);
            const maxHX = Math.max(...allHX);
            if (maxHX > minHX) {
              newHighlightPaths.push(`M ${minHX} ${mainBranchY} L ${maxHX} ${mainBranchY}`);
            }
            highlightedChildren.forEach(hc => {
              const targetTopY = hc.box.top - 12;
              newHighlightPaths.push(`M ${hc.box.centerX} ${mainBranchY} L ${hc.box.centerX} ${targetTopY}`);
              newHighlightArrows.push({ x: hc.box.centerX, y: targetTopY });
            });
          }
        }
      }

      // Ehepartner-Kind-Verbindungen: Unterkante Ehepartner -> eigene horizontale Ebene -> rechts neben dem Hauptpfeil des Kindes
      let spouseLevelIdx = 0;
      measuredSpouses.forEach(s => {
        const spouseChildren = measuredChildren.filter(c => c.person.parent_ids.includes(s.personId));
        if (spouseChildren.length > 0) {
          const barY = mainBranchY + 11 * (spouseLevelIdx + 1);
          spouseLevelIdx++;

          const childTargetXs = spouseChildren.map(c => c.box.centerX + 26);
          const allSpouseChildX = [s.box.centerX, ...childTargetXs];
          const minSX = Math.min(...allSpouseChildX);
          const maxSX = Math.max(...allSpouseChildX);

          // Vertikal von der Mitte der Ehepartner-Unterkante bis zur horizontalen Verteilungslinie
          newSpousePaths.push(`M ${s.box.centerX} ${s.box.bottom} L ${s.box.centerX} ${barY}`);
          // Horizontal zu den zugehörigen Kindern
          if (maxSX > minSX) {
            newSpousePaths.push(`M ${minSX} ${barY} L ${maxSX} ${barY}`);
          }
          // Vertikal nach unten auf jedes zugehörige Kind mit Pfeilspitze
          spouseChildren.forEach((c, cIdx) => {
            const tx = childTargetXs[cIdx];
            newSpousePaths.push(`M ${tx} ${barY} L ${tx} ${c.box.top}`);
            newSpouseArrows.push({ x: tx, y: c.box.top });
          });

          // Falls Ehepartner und eines seiner Kinder Teil des "Kürzesten Pfades" sind, auch diese Verbindung hervorheben
          if (props.highlightedPathIds?.has(s.personId)) {
            const highlightedSpouseChildren = spouseChildren.filter(c => props.highlightedPathIds?.has(c.person.id));
            if (highlightedSpouseChildren.length > 0) {
              newHighlightPaths.push(`M ${s.box.centerX} ${s.box.bottom} L ${s.box.centerX} ${barY}`);
              const hChildTargetXs = highlightedSpouseChildren.map(c => c.box.centerX + 26);
              const allHSX = [s.box.centerX, ...hChildTargetXs];
              const minHSX = Math.min(...allHSX);
              const maxHSX = Math.max(...allHSX);
              if (maxHSX > minHSX) {
                newHighlightPaths.push(`M ${minHSX} ${barY} L ${maxHSX} ${barY}`);
              }
              highlightedSpouseChildren.forEach((hc, hcIdx) => {
                const tx = hChildTargetXs[hcIdx];
                newHighlightPaths.push(`M ${tx} ${barY} L ${tx} ${hc.box.top}`);
                newHighlightArrows.push({ x: tx, y: hc.box.top });
              });
            }
          }
        }
      });
    }
  }

  mainPaths.value = newMainPaths;
  mainArrows.value = newMainArrows;
  spousePaths.value = newSpousePaths;
  spouseArrows.value = newSpouseArrows;
  highlightPaths.value = newHighlightPaths;
  highlightArrows.value = newHighlightArrows;
}

let resizeObserver: ResizeObserver | null = null;
let rafId: number | null = null;
let timerId: ReturnType<typeof setTimeout> | null = null;

function scheduleConnectorUpdate() {
  nextTick(() => {
    updateConnectors();
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      updateConnectors();
      if (timerId !== null) clearTimeout(timerId);
      timerId = setTimeout(() => {
        updateConnectors();
      }, 45);
    });
  });
}

onMounted(() => {
  scheduleConnectorUpdate();
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      scheduleConnectorUpdate();
    });
    if (liRef.value) resizeObserver.observe(liRef.value);
    if (mainCardRef.value) resizeObserver.observe(mainCardRef.value);
  }
  window.addEventListener('resize', scheduleConnectorUpdate);
});

onBeforeUnmount(() => {
  if (resizeObserver) resizeObserver.disconnect();
  if (rafId !== null) cancelAnimationFrame(rafId);
  if (timerId !== null) clearTimeout(timerId);
  window.removeEventListener('resize', scheduleConnectorUpdate);
});

watch(
  () => [
    props.node,
    props.expandedNodes.get(props.node.person.id),
    props.expandedSideNodes.get(props.node.person.id)?.spouses,
    props.expandedSideNodes.get(props.node.person.id)?.parents,
    props.node.children.length,
    props.node.spouse_nodes.length,
    props.node.parent_nodes.length,
    extraRightMargin.value,
    childrenTopMargin.value,
    props.highlightedPathIds ? Array.from(props.highlightedPathIds).join(',') : '',
  ],
  () => {
    scheduleConnectorUpdate();
    nextTick(() => {
      if (resizeObserver) {
        if (spousesListRef.value) resizeObserver.observe(spousesListRef.value);
        if (childrenListRef.value) resizeObserver.observe(childrenListRef.value);
        if (parentsListRef.value) resizeObserver.observe(parentsListRef.value);
      }
    });
  },
  { deep: true }
);
</script>

<template>
  <li
    ref="liRef"
    class="tree-node-li"
    :class="{
      'is-side-branch-node': node.is_side_branch,
      'is-spouse-node': node.side_branch_type === 'spouse',
      'is-parent-node': node.side_branch_type === 'parent'
    }"
    :style="!node.is_side_branch && extraRightMargin > 0 ? { marginRight: `${extraRightMargin}px` } : undefined"
  >
    <!-- Präzise SVG-Linienführung für Eltern-, Nachkommen- und Ehepartner-Verbindungen -->
    <svg
      v-if="node.side_branch_type !== 'spouse'"
      class="node-connectors-svg"
    >
      <!-- Ehepartner- & Ehepartner-Kind-Linien (farblich abgesetzt im Hintergrund) -->
      <path
        v-for="(d, idx) in spousePaths"
        :key="'sp-path-' + idx"
        :d="d"
        class="connector-line-spouse"
      />
      <polygon
        v-for="(pt, idx) in spouseArrows"
        :key="'sp-arr-' + idx"
        :points="arrowPointsStr(pt, 5)"
        class="connector-arrow-spouse"
      />

      <!-- Hauptlinien zu Eltern & Nachkommen (mittig zur Eintragsbox) -->
      <path
        v-for="(d, idx) in mainPaths"
        :key="'main-path-' + idx"
        :d="d"
        class="connector-line-main"
      />
      <polygon
        v-for="(pt, idx) in mainArrows"
        :key="'main-arr-' + idx"
        :points="arrowPointsStr(pt, 5.5)"
        class="connector-arrow-main"
      />

      <!-- Hervorgehobene Verbindungslinien & Pfeilspitzen für die Ansicht "Kürzester Pfad" -->
      <path
        v-for="(d, idx) in highlightPaths"
        :key="'hl-path-' + idx"
        :d="d"
        class="connector-line-highlight"
      />
      <polygon
        v-for="(pt, idx) in highlightArrows"
        :key="'hl-arr-' + idx"
        :points="arrowPointsStr(pt, 6)"
        class="connector-arrow-highlight"
      />
    </svg>

    <!-- Info-Box für die Ehedaten auf der Verbindungslinie zum Ehepartner (farblich passend zur Ehepartner-Linie) -->
    <div v-if="node.side_branch_type === 'spouse'" class="marriage-label-slot">
      <div v-if="hasMarriageInfo" class="marriage-label">
        <div v-if="marriageDatePlaceText" class="mar-line">
          ⚭ {{ marriageDatePlaceText }}
        </div>
        <div v-if="node.person.death_date" class="mar-line">
          † {{ node.person.death_date }}
        </div>
        <div v-if="divorceText" class="mar-line">
          ⚮ {{ divorceText }}
        </div>
      </div>
    </div>

    <div class="node-cluster">
      
      <!-- 1. ELTERN (Vertikal mittig über der Hauptbox) -->
      <ul
        ref="parentsListRef"
        class="cluster-parents side-list"
        v-if="node.parent_nodes && node.parent_nodes.length > 0"
      >
        <TreeNode 
          v-for="p in node.parent_nodes" :key="'p-'+p.person.id" :node="p" :selected-id="selectedId"
          :expanded-nodes="expandedNodes" :expanded-side-nodes="expandedSideNodes"
          :highlighted-path-ids="highlightedPathIds"
          :is-free-view="isFreeView"
          @select="p => emit('select', p)" @toggle="id => emit('toggle', id)"
          @toggle-side="(id, type) => emit('toggle-side', id, type)" @load-parent="n => emit('load-parent', n)"
          @collapse-ancestors="id => emit('collapse-ancestors', id)"
          @switch-leading-parent="(curr, next) => emit('switch-leading-parent', curr, next)"
          @jump-to="id => emit('jump-to', id)"
          @show-partner-path="(a, b) => emit('show-partner-path', a, b)"
        />
      </ul>

      <!-- 2. HAUPTKNOTEN & EHEPARTNER -->
      <div class="cluster-main-row">
        <div class="main-card-anchor">
          <div
            ref="mainCardRef"
            class="node-card"
            :data-person-id="node.person.id"
            :class="{
              'main-person-card': !node.is_side_branch,
              'active': selectedId === node.person.id,
              'side-branch-card': node.is_side_branch,
              'spouse-branch-card': node.side_branch_type === 'spouse',
              'path-highlight-card': highlightedPathIds?.has(node.person.id)
            }"
            @click.stop="emit('select', node.person)"
          >
            <!-- Top-Button: Bei aktuellem Wurzelknoten Elterngeneration ausklappen (▲), bei ausgeklappten Vorfahren alle Vorfahrengenerationen zu diesem Eintrag einklappen (▼) -->
            <button
              v-if="!node.is_side_branch && isRoot && (node.active_henry.length > 1 || node.person.parent_ids.length > 0)"
              class="expand-btn expand-parent-btn"
              @click.stop="emit('load-parent', node)"
              title="Elterngeneration ausklappen"
            >▲</button>
            <button
              v-else-if="!node.is_side_branch && !isRoot"
              class="expand-btn expand-parent-btn"
              @click.stop="emit('collapse-ancestors', node.person.id)"
              title="Alle Vorfahrengenerationen zu diesem Eintrag einklappen"
            >▼</button>
            
            <div class="node-header">
              <strong>{{ node.person.surname || 'N.N.' }}, {{ node.person.given_name || 'N.N.' }}</strong>
              <span 
                class="badge" 
                :class="{ 'clickable-badge': node.is_side_branch, 'spouse-path-badge': node.side_branch_type === 'spouse' }"
                @click.stop="handleBadgeClick"
                :title="node.is_side_branch ? 'Eintrag und zugehörige Generationen im Stammbaum öffnen' : ''"
                v-if="node.active_henry"
              >
                [{{ node.active_henry }}] <template v-if="node.side_branch_type === 'spouse'">🔗</template>
              </span>
            </div>
            <div class="dates">(* {{ node.person.birth_date || '?' }}<span v-if="node.person.death_date"> - † {{ node.person.death_date }}</span>)</div>
            
            <div class="side-actions" v-if="!node.is_side_branch && (node.person.spouses.length > 0 || node.spouse_nodes.length > 0)">
              <button @click.stop="emit('toggle-side', node.person.id, 'spouses')" class="side-btn" :class="{ 'active': expandedSideNodes.get(node.person.id)?.spouses }" title="Ehepartner ein-/ausblenden">💍 {{ Math.max(node.person.spouses.length, node.spouse_nodes.length) }}</button>
              <button
                v-if="isFreeView && (node.spouse_nodes.length > 0 || node.person.spouses.length > 0)"
                @click.stop="handleSwitchFromMain"
                class="side-btn switch-lead-btn"
                title="Führenden Elterneintrag wechseln (schließt expandierte Knoten dieses Elternteils)"
              >⇄</button>
            </div>

            <div class="side-actions" v-if="isFreeView && node.side_branch_type === 'spouse' && node.relation_info?.partner_id">
              <button
                @click.stop="emit('switch-leading-parent', node.relation_info.partner_id, node.person.id)"
                class="side-btn switch-lead-btn"
                title="Als führenden Elterneintrag wechseln (schließt expandierte Knoten des anderen Elternteils)"
              >⇄ Als führend</button>
            </div>
            
            <button
              v-if="!node.is_side_branch && node.children.length > 0"
              class="expand-btn expand-child-btn"
              @click.stop="emit('toggle', node.person.id)"
              :title="expandedNodes.get(node.person.id) ? 'Alle Nachkommengenerationen zu diesem Eintrag einklappen' : 'Nachkommen ausklappen'"
            >
              {{ expandedNodes.get(node.person.id) ? '▲' : '▼' }}
            </button>
          </div>

          <!-- Ehepartner seitlich rechts an der Hauptbox geführt, ohne die Mittelachse der Hauptbox zu verschieben -->
          <ul
            ref="spousesListRef"
            class="cluster-spouses side-list"
            v-if="node.spouse_nodes && node.spouse_nodes.length > 0"
          >
            <TreeNode 
              v-for="s in node.spouse_nodes" :key="'s-'+s.person.id" :node="s" :selected-id="selectedId"
              :expanded-nodes="expandedNodes" :expanded-side-nodes="expandedSideNodes"
              :highlighted-path-ids="highlightedPathIds"
              :is-free-view="isFreeView"
              @select="p => emit('select', p)" @toggle="id => emit('toggle', id)"
              @toggle-side="(id, type) => emit('toggle-side', id, type)" @load-parent="n => emit('load-parent', n)"
              @collapse-ancestors="id => emit('collapse-ancestors', id)"
              @switch-leading-parent="(curr, next) => emit('switch-leading-parent', curr, next)"
              @jump-to="id => emit('jump-to', id)"
              @show-partner-path="(a, b) => emit('show-partner-path', a, b)"
            />
          </ul>
        </div>
      </div>
    </div>

    <!-- 3. KINDER (nach Geburt sortiert, mittig unter der Hauptbox) -->
    <ul
      ref="childrenListRef"
      class="children-list"
      v-if="expandedNodes.get(node.person.id) && node.children.length > 0 && !node.is_side_branch"
      :style="{ paddingTop: `${childrenTopMargin}px` }"
    >
      <TreeNode 
        v-for="child in node.children" :key="child.person.id" :node="child" :selected-id="selectedId"
        :expanded-nodes="expandedNodes" :expanded-side-nodes="expandedSideNodes"
        :highlighted-path-ids="highlightedPathIds"
        :is-root="false"
        :is-free-view="isFreeView"
        @select="p => emit('select', p)" @toggle="(id) => emit('toggle', id)"
        @toggle-side="(id, type) => emit('toggle-side', id, type)" @load-parent="n => emit('load-parent', n)"
        @collapse-ancestors="id => emit('collapse-ancestors', id)"
        @switch-leading-parent="(curr, next) => emit('switch-leading-parent', curr, next)"
        @jump-to="id => emit('jump-to', id)"
        @show-partner-path="(a, b) => emit('show-partner-path', a, b)"
      />
    </ul>
  </li>
</template>

<style scoped>
.tree-node-li {
  position: relative;
  list-style-type: none;
  text-align: center;
  padding: 0 14px;
}

/* SVG Overlay für Verbindungslinien */
.node-connectors-svg {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
  z-index: 1;
}

.connector-line-main {
  fill: none;
  stroke: #2c3e50;
  stroke-width: 1.8px;
  stroke-linecap: square;
  stroke-linejoin: miter;
}

.connector-arrow-main {
  fill: #2c3e50;
}

.connector-line-spouse {
  fill: none;
  stroke: #95a5a6;
  stroke-width: 1.6px;
  stroke-linecap: square;
  stroke-linejoin: miter;
}

.connector-arrow-spouse {
  fill: #95a5a6;
}

.connector-line-highlight {
  fill: none;
  stroke: #e67e22;
  stroke-width: 3px;
  stroke-linecap: square;
  stroke-linejoin: miter;
  filter: drop-shadow(0 0 3px rgba(230, 126, 34, 0.45));
}

.connector-arrow-highlight {
  fill: #e67e22;
  filter: drop-shadow(0 0 3px rgba(230, 126, 34, 0.45));
}

.node-cluster {
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
  z-index: 2;
}

.cluster-main-row {
  display: flex;
  justify-content: center;
  align-items: flex-start;
  position: relative;
}

.main-card-anchor {
  position: relative;
  display: inline-block;
}

/* Side Lists */
.side-list {
  padding: 0 !important;
  margin: 0;
  display: flex;
  list-style: none;
}

.cluster-parents {
  gap: 18px;
  margin-bottom: 34px;
  padding: 0 !important;
  justify-content: center;
}

.cluster-spouses {
  position: absolute;
  left: calc(100% + 28px);
  top: 26px;
  gap: 22px;
  align-items: stretch;
  z-index: 2;
}

.children-list {
  position: relative;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-left: 0;
  margin: 0;
}

/* Nebenäste (Ehepartner / Eltern) */
li.is-side-branch-node {
  padding: 0 !important;
  margin: 0 !important;
  float: none !important;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
}

/* Slot für Ehedaten auf der vertikalen Zuführung zum Ehepartner */
.marriage-label-slot {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding-top: 4px;
  padding-bottom: 10px;
  min-height: 14px;
  width: 100%;
}

/* Farblich zur Ehepartner-Linie passende Info-Box (nicht rot) */
.marriage-label {
  position: relative;
  background: #f8fafb;
  border: 1px solid #95a5a6;
  color: #576574;
  font-size: 0.68rem;
  padding: 3px 8px;
  border-radius: 4px;
  white-space: nowrap;
  z-index: 3;
  text-align: center;
  line-height: 1.35;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
}

.mar-line {
  display: block;
}

/* Karten Design */
.node-card {
  display: inline-block;
  background: white;
  border: 2px solid #2c3e50;
  padding: 15px 12px 20px 12px;
  border-radius: 6px;
  min-width: 175px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.08);
  cursor: pointer;
  position: relative;
  z-index: 2;
  transition: border-color 0.2s ease, background-color 0.2s ease;
}
.node-card:hover { border-color: #3498db; }
.node-card.active {
  border-color: #2980b9;
  background: #e3f2fd;
  box-shadow: 0 0 0 3px rgba(41, 128, 185, 0.4), 0 4px 12px rgba(0, 0, 0, 0.12);
}

.side-branch-card {
  background-color: #fcfcfc;
  border: 1.6px solid #95a5a6;
  box-shadow: 0 1px 4px rgba(0,0,0,0.05);
}

.spouse-branch-card {
  border-color: #95a5a6;
}

.path-highlight-card {
  border-color: #e67e22 !important;
  border-style: solid !important;
  background: #fff8e1 !important;
  box-shadow: 0 0 12px rgba(230, 126, 34, 0.5) !important;
}

.node-header { display: flex; flex-direction: column; align-items: center; margin-bottom: 5px; }
.badge { background: #34495e; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; margin-top: 4px; }
.clickable-badge { cursor: pointer; transition: background 0.2s, transform 0.1s; }
.clickable-badge:hover { background: #e67e22; color: white; transform: scale(1.05); }
.spouse-path-badge { background: #576574; }
.spouse-path-badge:hover { background: #2980b9; }

.dates { font-size: 0.75rem; color: #7f8c8d; margin-bottom: 5px; }
.side-actions { display: flex; justify-content: center; gap: 6px; margin-top: 5px; }
.side-btn { background: #ecf0f1; border: 1px solid #bdc3c7; border-radius: 4px; font-size: 0.75rem; padding: 2px 8px; cursor: pointer; color: #2c3e50; transition: all 0.2s; }
.side-btn:hover { background: #dcdde1; }
.side-btn.active { background: #7f8c8d; color: white; border-color: #7f8c8d; }
.switch-lead-btn { background: #f3e5f5; border-color: #ab47bc; color: #6a1b9a; font-weight: bold; }
.switch-lead-btn:hover { background: #e1bee7; border-color: #8e24aa; color: #4a148c; }
.expand-btn { position: absolute; left: 50%; transform: translateX(-50%); background: #ecf0f1; border: 1px solid #bdc3c7; border-radius: 12px; font-size: 0.7rem; padding: 2px 10px; cursor: pointer; color: #2c3e50; box-shadow: 0 1px 3px rgba(0,0,0,0.1); z-index: 4; }
.expand-btn:hover { background: #dcdde1; }
.expand-child-btn { bottom: -12px; }
.expand-parent-btn { top: -12px; }
.shifted-parent-btn { left: 26px; }
</style>