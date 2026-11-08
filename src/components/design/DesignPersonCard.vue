<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { DesignCardConfig } from '../../types/design';
import {
  CARD_WIDTH,
  type CardBox,
  type RenderedCardData,
} from '../../composables/useDesignLayout';

const { t } = useI18n();

defineProps<{
  cardBox: CardBox;
  cardData?: RenderedCardData;
  cardConfig: DesignCardConfig;
  isSelected: boolean;
  hasBranchWidth: boolean;
  inPartnerPath: boolean;
  hasDescendants: boolean;
  isExpanded: boolean;
  canRegroup: boolean;
  groupCardCount: number;
  cardIndexInGroup: number;
  groupLevel: number;
  isGroupDocked: boolean;
  isMultiSiblingGroup: boolean;
  isOriginGroup: boolean;
  isGroupDragging: boolean;
}>();

const emit = defineEmits<{
  (e: 'select'): void;
  (e: 'group-descendants'): void;
  (e: 'toggle-descendants'): void;
  (e: 'regroup-siblings'): void;
  (e: 'ungroup-left'): void;
  (e: 'ungroup-right'): void;
  (e: 'move-left'): void;
  (e: 'move-right'): void;
  (e: 'move-up'): void;
  (e: 'move-down'): void;
  (e: 'detach'): void;
}>();

function getLineStyle(bold: boolean, italic: boolean) {
  return {
    fontWeight: bold ? 'bold' : 'normal',
    fontStyle: italic ? 'italic' : 'normal',
  };
}
</script>

<template>
  <div
    class="design-person-card"
    :class="{
      selected: isSelected,
      'has-branch-width': hasBranchWidth,
      'in-partner-path': inPartnerPath,
      male: cardBox.person.sex === 'M',
      female: cardBox.person.sex === 'F',
      'is-multi-sibling-group': isMultiSiblingGroup,
      'is-origin-group': isOriginGroup,
      'is-docked': isGroupDocked,
      'is-group-dragging': isGroupDragging,
      'is-subtree-readonly': cardBox.isReadOnly,
      'is-subtree-anchor': cardBox.isSubtreeAnchor,
    }"
    :style="{ width: CARD_WIDTH + 'px', height: cardBox.height + 'px' }"
    @click.stop="emit('select')"
  >
    <!-- Button zum Gruppieren der Nachkommen des Eintrags & Reservierten Bereich setzen: sichtbar wenn Nachkommen vorhanden -->
    <button
      v-if="hasDescendants"
      class="group-descendants-card-btn"
      :class="{ 'is-selected': isSelected }"
      :title="t('design_group_descendants_tooltip')"
      @mousedown.stop
      @click.stop="emit('group-descendants')"
    >
      👥
    </button>

    <!-- Button zum Ein- und Ausklappen der Nachfahren: sichtbar wenn Nachkommen vorhanden -->
    <button
      v-if="hasDescendants"
      class="descendant-toggle-btn"
      :class="{ 'is-expanded': isExpanded }"
      :title="isExpanded ? t('collapse_children_tooltip') : t('expand_children_tooltip')"
      @mousedown.stop
      @click.stop="emit('toggle-descendants')"
    >
      {{ isExpanded ? '▼' : '▲' }}
    </button>

    <!-- Zeile #1: Henry ID & Badges -->
    <div class="d-card-top" :style="getLineStyle(cardConfig.line1Bold, cardConfig.line1Italic)">
      <span v-if="cardConfig.showHenryId && cardData?.henryCode" class="d-henry-badge">
        [{{ cardData.henryCode }}]
      </span>
      <span v-if="cardConfig.showGeneration && cardBox.generation" class="d-gen-badge">
        Gen. {{ cardBox.generation }}
      </span>
      <span
        v-if="cardBox.isSubtreeAnchor"
        class="d-subtree-anchor-badge"
        :title="t('design_subtree_badge_tooltip')"
      >
        🌿 {{ cardBox.linkedSubLayoutName }}
      </span>
    </div>

    <!-- Zeile #2: Vorname (in der Kachel wird nur noch der Vorname angezeigt) -->
    <div
      class="d-card-name"
      :style="getLineStyle(cardConfig.line2Bold, cardConfig.line2Italic)"
      :title="cardData?.fullName"
    >
      {{ cardData?.firstName }}
    </div>

    <!-- Zeile #3: Geburts-, Tauf- und Todesdaten mit vorn angestellten Icons -->
    <div
      v-if="cardData?.hasLine3"
      class="d-card-line-3"
      :class="{ 'd-card-line-3-single': cardConfig.lifeDatesLayout === 'single' }"
      :style="getLineStyle(cardConfig.line3Bold, cardConfig.line3Italic)"
    >
      <span v-if="cardData.birthText" class="d-date-item nowrap-date">
        {{ cardData.birthText }}
      </span>
      <span v-if="cardData.chrText" class="d-date-item nowrap-date">
        {{ cardData.chrText }}
      </span>
      <span v-if="cardData.deathText" class="d-date-item nowrap-date">
        {{ cardData.deathText }}
      </span>
    </div>

    <!-- Zeilen #4 & #5: Ehen / Ehepartner (Status-Icon + Name, Hochzeits/Scheidungsdatum, Geburts/Todesdatum) -->
    <div
      v-if="cardData?.hasMarriage"
      class="d-card-marriages-block"
    >
      <div
        v-for="(spInfo, sIdx) in (cardData.spouses || [])"
        :key="'sp-' + sIdx"
        class="d-marriage-entry"
      >
        <!-- Linke Spalte: Status-Icon (⚭ verbundene Ringe / ⚮ getrennte Ringe) & Zähler -->
        <div class="d-spouse-status-col">
          <span v-if="cardConfig.showMarriageCounter" class="d-marriage-counter">({{ sIdx + 1 }})</span>
          <span
            class="d-spouse-status-icon"
            :title="(spInfo.isDivorced || spInfo.divorceDate) ? t('divorced') : t('married')"
          >{{ (spInfo.isDivorced || spInfo.divorceDate) ? '⚮' : '⚭' }}</span>
        </div>

        <!-- Rechte Spalte: Name, Hochzeits/Scheidungsdatum, Lebensdaten eingerückt auf einer Höhe zum Namen -->
        <div class="d-spouse-details-col">
          <!-- Row 1: Name Ehepartner [Henry ID] -->
          <div
            v-if="(cardConfig.showSpouseName && spInfo.name) || (cardConfig.showHenryId && spInfo.henry)"
            class="d-spouse-name-row"
            :style="getLineStyle(cardConfig.line4Bold, cardConfig.line4Italic)"
          >
            <span v-if="cardConfig.showSpouseName && spInfo.name" class="d-spouse-name">{{ spInfo.name }}</span>
            <span v-if="cardConfig.showHenryId && spInfo.henry" class="d-spouse-henry">[{{ spInfo.henry }}]</span>
          </div>

          <!-- Row 2: Hochzeits-, Scheidungs-, Geburts- und Todesdatum (in einer Zeile bei single layout) -->
          <div
            v-if="spInfo.dateItems.length > 0"
            class="d-spouse-dates-row"
            :class="{ 'd-spouse-dates-multi': cardConfig.lifeDatesLayout === 'multi' }"
            :style="getLineStyle(cardConfig.line5Bold, cardConfig.line5Italic)"
          >
            <span
              v-for="(item, dIdx) in spInfo.dateItems"
              :key="item.key"
              class="nowrap-date d-spouse-date-item"
              :class="{ 'd-divorce-badge': item.isDivorce }"
            >
              {{ item.text }}<span v-if="cardConfig.lifeDatesLayout === 'single' && dIdx < spInfo.dateItems.length - 1" class="d-date-sep">, </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Personen-Boxen: Jede Kachel passt sich dynamisch ihrem Inhalt an */
.design-person-card {
  position: relative;
  background: white;
  border: 3px solid #1e293b;
  border-bottom: 3.5px solid #64748b;
  padding: 5px 6px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: 2px;
  cursor: grab;
  overflow: visible;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
}
.design-person-card + .design-person-card {
  margin-left: -3px;
}
.design-person-card:active {
  cursor: grabbing;
}
.design-person-card.male {
  border-bottom: 3.5px solid #2980b9 !important;
}
.design-person-card.female {
  border-bottom: 3.5px solid #e84393 !important;
}
.design-person-card.selected {
  background: #fffde7 !important;
  box-shadow: inset 0 0 0 2px #f39c12;
}
.design-person-card.has-branch-width {
  box-shadow: inset 0 0 0 2px #8e44ad;
}
.design-person-card.in-partner-path {
  background: #fef5e7;
}

/* Zustände der Gruppe auf die Kacheln übertragen */
.design-person-card.is-multi-sibling-group {
  border-top-width: 3.5px;
  border-left-width: 3.5px;
  border-right-width: 3.5px;
}
.design-person-card.is-origin-group {
  border-top-color: #0e6251;
  border-left-color: #0e6251;
  border-right-color: #0e6251;
}
.design-person-card.is-docked {
  box-shadow: 0 0 0 1.5px #27ae60;
}
.design-person-card.is-group-dragging {
  border-color: #e67e22 !important;
  box-shadow: 0 8px 22px rgba(230, 126, 34, 0.35) !important;
}

/* Button auf dem Eintrag zum Gruppieren der Nachkommen je Ebene */
.group-descendants-card-btn {
  position: absolute;
  top: -12px;
  left: 6px;
  width: 24px;
  height: 18px;
  padding: 0;
  font-size: 0.68rem;
  line-height: 1;
  background: #2563eb;
  color: white;
  border: 1px solid #1d4ed8;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 35;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
  transition: transform 0.15s, background 0.15s;
}
.group-descendants-card-btn:hover {
  background: #1d4ed8;
  transform: scale(1.15);
}

/* Button zum Ein- und Ausklappen der Nachfahren direkt am oberen Rand des Kästchens */
.descendant-toggle-btn {
  position: absolute;
  top: -12px;
  right: 6px;
  width: 22px;
  height: 18px;
  padding: 0;
  font-size: 0.65rem;
  font-weight: bold;
  line-height: 1;
  background: #34495e;
  color: white;
  border: 1px solid #1e293b;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 35;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
  transition: transform 0.15s, background 0.15s;
}
.descendant-toggle-btn:hover {
  background: #2980b9;
  transform: scale(1.15);
}
.descendant-toggle-btn.is-expanded {
  background: #64748b;
}

.d-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 3px;
}
.d-henry-badge {
  background: #34495e;
  color: white;
  font-size: 0.65rem;
  font-weight: bold;
  padding: 1px 4px;
  border-radius: 3px;
}
.d-gen-badge {
  font-size: 0.65rem;
  color: #64748b;
  font-weight: bold;
}
.d-card-mini-btns {
  display: flex;
  gap: 1px;
  margin-left: auto;
}
.d-mini-btn {
  background: #f1f5f9;
  color: #475569;
  border: 1px solid #cbd5e1;
  border-radius: 2px;
  padding: 0 3px;
  font-size: 0.58rem;
  line-height: 1.2;
  cursor: pointer;
}
.d-mini-btn:hover:not(:disabled) {
  background: #3498db;
  color: white;
  border-color: #2980b9;
}
.d-mini-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.d-mini-btn.d-mini-ungroup {
  background: #fff8e1;
  color: #b7791f;
  border-color: #fbd38d;
}
.d-mini-btn.d-mini-ungroup:hover:not(:disabled) {
  background: #e67e22;
  color: white;
  border-color: #d35400;
}
.d-mini-btn.d-mini-detach {
  background: #ebf8ff;
  color: #2b6cb0;
  border-color: #bee3f8;
}
.d-mini-btn.d-mini-detach:hover:not(:disabled) {
  background: #3182ce;
  color: white;
  border-color: #2b6cb0;
}
.d-mini-btn.d-mini-regroup {
  background: #eafaf1;
  color: #1e8449;
  border-color: #a3e4d7;
  font-weight: bold;
}
.d-mini-btn.d-mini-regroup:hover:not(:disabled) {
  background: #27ae60;
  color: white;
  border-color: #1e8449;
}

.d-card-name {
  font-size: 0.78rem;
  color: #1e293b;
  white-space: normal;
  word-break: break-word;
  overflow-wrap: break-word;
  text-align: center;
  line-height: 1.25;
  margin: 2px 0;
}
.d-card-line-3 {
  font-size: 0.65rem;
  color: #475569;
  text-align: center;
  line-height: 1.2;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.d-card-line-3-single {
  flex-direction: row !important;
  flex-wrap: wrap !important;
  justify-content: center !important;
  gap: 5px !important;
}
.nowrap-date {
  white-space: nowrap;
}
.d-spouse-henry {
  font-size: 0.62rem;
  font-weight: 700;
  color: #d97706;
}
.d-card-marriages-block {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 2px;
  border-top: 1px dashed #cbd5e1;
  padding-top: 2px;
}
.d-marriage-entry {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 4px;
  line-height: 1.2;
}
.d-spouse-status-col {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  padding-top: 1px;
}
.d-spouse-status-icon {
  font-size: 0.78rem;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #475569;
  user-select: none;
}
.d-spouse-status-icon.is-divorced {
  color: #c0392b;
}
.d-spouse-details-col {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  flex-grow: 1;
  min-width: 0;
  text-align: left;
}
.d-spouse-name-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px;
  font-size: 0.66rem;
  color: #1e293b;
  line-height: 1.2;
}
.d-spouse-name {
  font-weight: 600;
  color: #1e293b;
}
.d-spouse-dates-row {
  font-size: 0.65rem;
  color: #475569;
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px;
  line-height: 1.2;
}
.d-spouse-dates-row.d-spouse-dates-multi {
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
}
.d-spouse-date-item {
  color: #475569;
  font-size: 0.65rem;
}
.d-marriage-counter {
  font-weight: 700;
  color: #2563eb;
  font-size: 0.66rem;
}
.d-divorce-badge {
  color: #c0392b;
}
.d-subtree-anchor-badge {
  background: #059669;
  color: #ffffff;
  font-size: 0.65rem;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 3px;
  margin-left: 2px;
  white-space: nowrap;
}
.design-person-card.is-subtree-readonly {
  background-color: #f8fafc;
}
.design-person-card.is-subtree-anchor {
  border-bottom: 2px solid #059669;
}
</style>

