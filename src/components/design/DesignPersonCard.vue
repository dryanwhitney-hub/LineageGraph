<script setup lang="ts">
import type { ScenePersonCard } from '../../domain/design/sceneTypes';

const props = defineProps<{
  card: ScenePersonCard;
  dragDeltaX?: number;
  isSelected: boolean;
  isHighlighted: boolean;
  isDimmed?: boolean;
  isGroupDragging?: boolean;
  isLockedInParent?: boolean;
}>();

const emit = defineEmits<{
  (e: 'select', personId: string): void;
  (e: 'enter-subtree', subDocumentId: string): void;
  (e: 'card-mousedown', event: MouseEvent): void;
}>();

function getLineStyle(bold: boolean, italic: boolean) {
  return {
    fontWeight: bold ? '700' : '400',
    fontStyle: italic ? 'italic' : 'normal',
  };
}

function onDoubleClick() {
  if (props.card.isCapsule && props.card.capsuleMeta) {
    emit('enter-subtree', props.card.capsuleMeta.subDocumentId);
  } else if (props.card.subDocumentId) {
    emit('enter-subtree', props.card.subDocumentId);
  }
}
</script>

<template>
  <div
    class="design-person-card"
    :class="{
      selected: isSelected,
      'is-highlighted': isHighlighted,
      'is-dimmed': isDimmed,
      male: card.sex === 'M' && !card.isCapsule,
      female: card.sex === 'F' && !card.isCapsule,
      'is-capsule': card.isCapsule,
      'is-subtree-member': card.isSubtreeMember && !card.isCapsule,
      'is-locked-in-parent': isLockedInParent && !card.isCapsule,
      'is-group-dragging': isGroupDragging,
      'density-compact': card.densityProfile === 'compact_years',
      'density-narrow': card.densityProfile === 'narrow',
      'density-detail': card.densityProfile === 'detail',
    }"
    :style="{
      left: card.x + 'px',
      top: card.y + 'px',
      width: card.width + 'px',
      height: card.height + 'px',
    }"
    @mousedown.stop="e => emit('card-mousedown', e)"
    @click.stop="emit('select', card.personId)"
    @dblclick.stop="onDoubleClick"
  >
    <!-- Verweis-Kapsel Modus für ausgelagerten Sub-Baum -->
    <template v-if="card.isCapsule && card.capsuleMeta">
      <div class="capsule-accent-bar"></div>
      <div class="capsule-kicker">📁 SUB-BAUM KAPSEL</div>
      <div class="capsule-title" :title="card.capsuleMeta.name">
        {{ card.capsuleMeta.name }}
      </div>
      <div class="capsule-stats">
        {{ card.capsuleMeta.personCount }} Pers. · {{ card.capsuleMeta.generationSpan }} Gen.
      </div>
      <button
        type="button"
        class="capsule-open-btn"
        title="Sub-Baum im separaten Studio öffnen"
        @mousedown.stop
        @click.stop="emit('enter-subtree', card.capsuleMeta.subDocumentId)"
      >
        Öffnen →
      </button>
    </template>

    <!-- Normale Personenkachel -->
    <template v-else>
      <div class="person-accent-bar" :class="{ male: card.sex === 'M', female: card.sex === 'F' }"></div>

      <!-- Zeile #1: Henry-ID, Generation, Implex-Steuerung -->
      <div
        v-if="
          (card.cardConfig.showHenryId && card.henryCode) ||
          card.cardConfig.showGeneration ||
          card.isSubtreeMember ||
          card.cardConfig.dynamicCompactHeight === false
        "
        class="d-card-top"
        :class="{ 'is-bold': card.cardConfig.line1Bold, 'is-italic': card.cardConfig.line1Italic }"
        :style="getLineStyle(card.cardConfig.line1Bold, card.cardConfig.line1Italic)"
      >
        <span v-if="card.cardConfig.showHenryId && card.henryCode" class="d-henry-badge">
          [{{ card.henryCode }}]
        </span>
        <span v-if="card.cardConfig.showGeneration" class="d-gen-badge">
          Gen. {{ card.generation }}
        </span>
        <span v-if="card.isSubtreeMember" class="d-subtree-pill" title="Mitglied eines Sub-Baums">
          🌿
        </span>
      </div>

      <!-- Zeile #2: Name (Pflichtfeld) -->
      <div
        class="d-card-name"
        :class="{ 'is-bold': card.cardConfig.line2Bold, 'is-italic': card.cardConfig.line2Italic }"
        :style="getLineStyle(card.cardConfig.line2Bold, card.cardConfig.line2Italic)"
      >
        {{ card.fullName }}
      </div>

      <!-- Zeile #3: Lebensdaten & optional Beruf -->
      <div
        v-if="card.lifeLines.length > 0 || card.occupationText"
        class="d-card-life"
        :class="{
          'is-single-row': card.cardConfig.lifeDatesLayout === 'single',
          'is-bold': card.cardConfig.line3Bold,
          'is-italic': card.cardConfig.line3Italic,
        }"
        :style="getLineStyle(card.cardConfig.line3Bold, card.cardConfig.line3Italic)"
      >
        <span v-for="(line, idx) in card.lifeLines" :key="idx" class="d-life-item">
          {{ line }}
        </span>
        <span v-if="card.occupationText" class="d-occupation">
          {{ card.occupationText }}
        </span>
      </div>

      <!-- Zeile #4 & #5: Unbegrenzte Ehen / Partnerschaften -->
      <div v-if="card.spouses.length > 0" class="d-card-marriages">
        <div
          v-for="sp in card.spouses"
          :key="sp.partnerId + '-' + sp.orderIndex"
          class="d-marriage-row"
        >
          <div
            v-if="
              card.cardConfig.showSpouseName ||
              card.cardConfig.showMarriageCounter ||
              (card.cardConfig.showHenryId && sp.henryCode)
            "
            class="d-marriage-header"
            :class="{ 'is-bold': card.cardConfig.line4Bold, 'is-italic': card.cardConfig.line4Italic }"
            :style="getLineStyle(card.cardConfig.line4Bold, card.cardConfig.line4Italic)"
          >
            <span
              class="d-marriage-symbol"
              :class="{ 'is-divorced': Boolean(card.cardConfig.showDivorce && sp.divorceText) }"
            >
              {{ card.cardConfig.showDivorce && sp.divorceText ? '⚮' : '⚭' }}
            </span>
            <span v-if="card.cardConfig.showMarriageCounter" class="d-marriage-idx">
              {{ sp.orderIndex }}.
            </span>
            <span v-if="card.cardConfig.showHenryId && sp.henryCode" class="d-spouse-henry">
              [{{ sp.henryCode }}]
            </span>
            <span v-if="card.cardConfig.showSpouseName && sp.fullName" class="d-spouse-name">
              {{ sp.fullName }}
            </span>
          </div>

          <div
            v-if="
              (card.cardConfig.showMarriageDate && sp.marriageText) ||
              (card.cardConfig.showDivorce && sp.divorceText) ||
              ((card.cardConfig.showSpouseBirthDate || card.cardConfig.showSpouseBirthPlace) && sp.birthText) ||
              ((card.cardConfig.showSpouseDeathDate || card.cardConfig.showSpouseDeathPlace) && sp.deathText)
            "
            class="d-marriage-dates"
            :class="{
              'is-single-row': card.cardConfig.lifeDatesLayout === 'single',
              'is-bold': card.cardConfig.line5Bold,
              'is-italic': card.cardConfig.line5Italic,
            }"
            :style="getLineStyle(card.cardConfig.line5Bold, card.cardConfig.line5Italic)"
          >
            <span v-if="card.cardConfig.showMarriageDate && sp.marriageText" class="d-marriage-date">
              {{ sp.marriageText }}
            </span>
            <span v-if="card.cardConfig.showDivorce && sp.divorceText" class="d-divorce-text">
              {{ sp.divorceText }}
            </span>
            <span v-if="(card.cardConfig.showSpouseBirthDate || card.cardConfig.showSpouseBirthPlace) && sp.birthText">
              {{ sp.birthText }}
            </span>
            <span v-if="(card.cardConfig.showSpouseDeathDate || card.cardConfig.showSpouseDeathPlace) && sp.deathText">
              {{ sp.deathText }}
            </span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.design-person-card {
  position: absolute;
  background: #ffffff;
  border: 1.5px solid #cbd5e1;
  border-radius: 7px;
  padding: 6px 8px 6px 8px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 2px;
  cursor: grab;
  overflow: hidden;
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.08);
  transition: box-shadow 0.14s ease, border-color 0.14s ease, opacity 0.15s ease;
  z-index: 12;
  user-select: none;
}

.design-person-card:hover {
  border-color: #64748b;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.14);
  z-index: 18;
}

.design-person-card:active {
  cursor: grabbing;
}

.design-person-card.male {
  border-color: #93c5fd;
}

.design-person-card.female {
  border-color: #fbcfe8;
}

.design-person-card.is-subtree-member {
  background: #faf5ff;
  border-color: #c084fc;
}

.design-person-card.is-locked-in-parent {
  cursor: pointer;
}

.d-implex-pill.is-locked {
  opacity: 0.65;
  cursor: not-allowed;
}

.design-person-card.selected {
  border-color: #f59e0b !important;
  background: #fffdf2 !important;
  box-shadow: 0 0 0 2.5px rgba(245, 158, 11, 0.45), 0 8px 20px rgba(245, 158, 11, 0.2) !important;
  z-index: 25;
}

.design-person-card.is-highlighted {
  border-color: #ea580c !important;
  box-shadow: 0 0 0 2px rgba(234, 88, 12, 0.35);
  z-index: 22;
}

.design-person-card.is-dimmed {
  opacity: 0.4;
}

.design-person-card.is-group-dragging {
  z-index: 40 !important;
  box-shadow: 0 12px 26px rgba(15, 23, 42, 0.25) !important;
  transition: none !important;
}

.person-accent-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3.5px;
  background: #94a3b8;
}
.person-accent-bar.male {
  background: #2563eb;
}
.person-accent-bar.female {
  background: #db2777;
}

/* Verweis-Kapsel */
.design-person-card.is-capsule {
  background: #fffbeb;
  border: 2px dashed #d97706;
  justify-content: space-between;
  align-items: center;
  text-align: center;
  padding: 8px;
}

.capsule-accent-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: #f59e0b;
}

.capsule-kicker {
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.04em;
  color: #b45309;
  margin-top: 2px;
}

.capsule-title {
  font-size: 12px;
  font-weight: 700;
  color: #0f172a;
  line-height: 1.25;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.capsule-stats {
  font-size: 9.5px;
  font-weight: 600;
  color: #78350f;
}

.capsule-open-btn {
  border: 1px solid #d97706;
  background: #fef3c7;
  color: #92400e;
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
}
.capsule-open-btn:hover {
  background: #f59e0b;
  color: #ffffff;
}

/* Inhalte (mittig zentriert & sofortige Typografie-Vererbung) */
.d-card-top {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 2px;
  font-size: 9px;
  color: #64748b;
  text-align: center;
}

.d-henry-badge {
  background: #334155;
  color: #ffffff;
  font-size: 8.5px;
  font-weight: inherit;
  font-style: inherit;
  padding: 0 4px;
  border-radius: 3px;
  line-height: 1.35;
}

.d-gen-badge {
  font-weight: inherit;
  font-style: inherit;
}

.d-subtree-pill {
  font-size: 9px;
}

.d-implex-row {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  justify-content: center;
  text-align: center;
}

.d-implex-pill {
  font-size: 8.5px;
  font-weight: 700;
  border-radius: 999px;
  padding: 1px 5px;
  cursor: pointer;
  border: 1px solid #f59e0b;
  background: #fef3c7;
  color: #92400e;
}
.d-implex-pill.is-here {
  border-color: #16a34a;
  background: #dcfce7;
  color: #166534;
}

.d-card-name {
  font-size: 11.5px;
  font-weight: 400;
  color: #0f172a;
  text-align: center;
  line-height: 1.2;
  word-break: break-word;
}

.density-detail .d-card-name {
  font-size: 12px;
}
.density-compact .d-card-name {
  font-size: 11px;
}
.density-narrow .d-card-name {
  font-size: 10px;
}

.d-card-life {
  font-size: 9.5px;
  color: #475569;
  text-align: center;
  line-height: 1.25;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
}
.d-card-life.is-single-row {
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px;
}
.density-compact .d-card-life {
  font-size: 9px;
}
.density-narrow .d-card-life {
  font-size: 8.5px;
}

.d-occupation {
  color: #64748b;
  font-style: inherit;
  font-weight: inherit;
}

.d-card-marriages {
  margin-top: 2px;
  padding-top: 2px;
  border-top: 1px dashed #cbd5e1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.d-marriage-row {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 1px;
  font-size: 9px;
  color: #334155;
  line-height: 1.2;
}
.density-narrow .d-marriage-row {
  font-size: 8.5px;
}

.d-marriage-header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: center;
  text-align: center;
  gap: 3px;
}

.d-marriage-symbol {
  color: #475569;
  font-weight: inherit;
  font-style: inherit;
}
.d-marriage-symbol.is-divorced {
  color: #dc2626;
}

.d-marriage-idx {
  color: #2563eb;
  font-weight: inherit;
  font-style: inherit;
}

.d-spouse-henry {
  color: #d97706;
  font-weight: inherit;
  font-style: inherit;
}

.d-spouse-name {
  color: #0f172a;
  font-weight: inherit;
  font-style: inherit;
}

.d-marriage-dates {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 1px;
  padding-left: 0;
  font-size: 8.5px;
  color: #64748b;
}
.d-marriage-dates.is-single-row {
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px;
}

.d-divorce-text {
  color: #dc2626;
}

.is-bold,
.is-bold * {
  font-weight: 700 !important;
}

.is-italic,
.is-italic * {
  font-style: italic !important;
}
</style>
