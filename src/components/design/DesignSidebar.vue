<script setup lang="ts">
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { DesignBackgroundConfig, DesignLayoutType } from '../../types/design';
import type { DesignLayoutEntry } from '../../composables/useDesignHistory';
import {
  LEVEL_SIDEBAR_W,
  CANVAS_PAD_TOP,
  CANVAS_PAD_BOTTOM,
  type DesignPerson,
  type RootAncestorConfig,
} from '../../composables/useDesignLayout';

const { t } = useI18n();

const props = defineProps<{
  activeProbandId: string | null;
  rootAncestors: RootAncestorConfig[];
  autoLoadToast: string | null;
  canUndo: boolean;
  historyLength: number;
  bgImageData: string | null;
  bgConfig: DesignBackgroundConfig;
  isBgPopoverOpen: boolean;
  isBgDraggingOnCanvas: boolean;
  selectedDesignPerson: DesignPerson | null;
  hasSelectedDescendants: boolean;
  canDetachSelectedPerson: boolean;
  bridgesCount: number;
  enableLineBridges?: boolean;
  canvasWidth: number;
  canvasHeight: number;
  // Save & Load Modal props
  showSaveModal: boolean;
  isInitialOffer: boolean;
  activeProbandName: string;
  existingPresets: DesignLayoutEntry[];
  saveMode: 'new' | 'overwrite';
  selectedOverwriteId: string;
  saveFileName: string;
  isMatchingExistingName: boolean;
  totalLevels: number;
  siblingGroupsCount: number;
  branchWidthsCount: number;
  saveFeedbackMessage: string;
  isSaving: boolean;
  showLoadModal: boolean;
  loadFeedbackMessage: string;
  isLoadingLayouts: boolean;
  savedLayoutsList: DesignLayoutEntry[];
  formatDateStr: (iso: string) => string;
  setDesignFileInputRef: (el: HTMLInputElement | null) => void;
  // Subtree Layout Props
  currentLayoutType?: DesignLayoutType;
  currentLayoutName?: string;
  currentAnchorPersonId?: string | null;
  showLinkSubtreeModal?: boolean;
  availableSubtreeLayouts?: DesignLayoutEntry[];
  isLoadingSubtreeLayouts?: boolean;
  targetLinkAnchorPersonId?: string;
  targetLinkAnchorPersonName?: string;
  newDesignLayoutType?: DesignLayoutType;
  newDesignAnchorPersonId?: string;
  allPersonsList?: { id: string; name: string }[];
  isCurrentPersonSubtreeLinked?: boolean;
  linkedSubtreeLayoutName?: string;
  linkedSubtreeLayoutId?: string;
  // New Design Modal props
  showNewDesignModal?: boolean;
  newDesignProbandId?: string;
  newDesignFileName?: string;
  hasUnsavedChanges?: boolean;
}>();

const emit = defineEmits<{
  (e: 'select-proband', personId: string): void;
  (e: 'open-settings'): void;
  (e: 'undo'): void;
  (e: 'expand-all'): void;
  (e: 'collapse-all'): void;
  (e: 'reset-layout'): void;
  (e: 'return-to-master'): void;
  (e: 'open-link-subtree-modal', personId: string): void;
  (e: 'close-link-subtree-modal'): void;
  (e: 'link-subtree', anchorPersonId: string, entry: DesignLayoutEntry): void;
  (e: 'unlink-subtree', anchorPersonId: string): void;
  (e: 'open-subtree', layoutId: string): void;
  (e: 'create-subtree-for-person', personId: string): void;
  (e: 'update:newDesignLayoutType', type: DesignLayoutType): void;
  (e: 'update:newDesignAnchorPersonId', id: string): void;
  (e: 'close-new-design-modal'): void;
  (e: 'update:newDesignProbandId', id: string): void;
  (e: 'update:newDesignFileName', name: string): void;
  (e: 'confirm-create-new-design'): void;
  (e: 'update:isBgPopoverOpen', val: boolean): void;
  (e: 'update:isBgDraggingOnCanvas', val: boolean): void;
  (e: 'update:bgImageData', val: string | null): void;
  (e: 'save-proband-bg', dataUrl: string, config: DesignBackgroundConfig): void;
  (e: 'delete-proband-bg'): void;
  (e: 'group-descendants', personId: string): void;
  (e: 'detach-selected'): void;
  // Save & Load Modal emits
  (e: 'close-save-modal'): void;
  (e: 'save-mode-change', mode: 'new' | 'overwrite'): void;
  (e: 'update:selectedOverwriteId', id: string): void;
  (e: 'select-overwrite-preset'): void;
  (e: 'update:saveFileName', name: string): void;
  (e: 'save-to-db'): void;
  (e: 'export-to-file'): void;
  (e: 'close-load-modal'): void;
  (e: 'load-entry', entry: DesignLayoutEntry): void;
  (e: 'export-entry', entry: DesignLayoutEntry): void;
  (e: 'delete-entry', id: string): void;
  (e: 'open-external-file'): void;
  (e: 'file-input-change', event: Event): void;
}>();

const bgFileInputRef = ref<HTMLInputElement | null>(null);

const bgDisplayWidth = computed<number>(() => {
  const base = props.bgConfig.naturalWidth || 1200;
  return Math.max(20, Math.round(base * (props.bgConfig.scale / 100)));
});

const bgDisplayHeight = computed<number>(() => {
  const base = props.bgConfig.naturalHeight || 800;
  return Math.max(20, Math.round(base * (props.bgConfig.scale / 100)));
});

function triggerBgUpload() {
  bgFileInputRef.value?.click();
}

function onBgFileSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  processBgFile(file);
  input.value = '';
}

function processBgFile(file: File) {
  const validTypes = ['image/jpeg', 'image/png', 'image/svg+xml', 'image/webp'];
  const isSvgOrImg = validTypes.includes(file.type) || file.name.match(/\.(jpg|jpeg|png|svg|webp)$/i);
  if (!isSvgOrImg) {
    alert('Bitte eine Bilddatei im Format JPG, PNG, SVG oder WebP auswählen.');
    return;
  }

  const reader = new FileReader();
  reader.onload = e => {
    const dataUrl = e.target?.result as string;
    if (!dataUrl) return;

    emit('update:bgImageData', dataUrl);
    props.bgConfig.fileName = file.name;
    props.bgConfig.visible = true;

    const img = new Image();
    img.onload = () => {
      props.bgConfig.naturalWidth = img.naturalWidth || 1200;
      props.bgConfig.naturalHeight = img.naturalHeight || 800;

      // Wenn das Bild neu geladen wurde oder noch keine Position hat, im Canvas zentrieren
      if (props.bgConfig.x === 0 && props.bgConfig.y === 0) {
        centerBgImage();
      }

      emit('save-proband-bg', dataUrl, props.bgConfig);
    };
    img.src = dataUrl;
  };
  reader.readAsDataURL(file);
}

function centerBgImage() {
  props.bgConfig.x = Math.round((props.canvasWidth - bgDisplayWidth.value) / 2);
  props.bgConfig.y = Math.round((props.canvasHeight - bgDisplayHeight.value) / 2);
}

function alignBottomCenterBgImage() {
  props.bgConfig.x = Math.round((props.canvasWidth - bgDisplayWidth.value) / 2);
  props.bgConfig.y = Math.max(CANVAS_PAD_TOP, Math.round(props.canvasHeight - bgDisplayHeight.value - CANVAS_PAD_BOTTOM));
}

function alignTopLeftBgImage() {
  props.bgConfig.x = LEVEL_SIDEBAR_W + 16;
  props.bgConfig.y = CANVAS_PAD_TOP;
}

function fitBgToWidth() {
  if (props.bgConfig.naturalWidth) {
    const availableW = Math.max(400, props.canvasWidth - LEVEL_SIDEBAR_W - 40);
    props.bgConfig.scale = Math.max(10, Math.min(500, Math.round((availableW / props.bgConfig.naturalWidth) * 100)));
    centerBgImage();
  }
}

function fitBgToHeight() {
  if (props.bgConfig.naturalHeight) {
    const availableH = Math.max(300, props.canvasHeight - CANVAS_PAD_TOP - CANVAS_PAD_BOTTOM);
    props.bgConfig.scale = Math.max(10, Math.min(500, Math.round((availableH / props.bgConfig.naturalHeight) * 100)));
    centerBgImage();
  }
}

function resetBgScale() {
  props.bgConfig.scale = 100;
  centerBgImage();
}

function removeBgImage() {
  if (confirm(t('design_bg_image_delete_confirm') || 'Möchten Sie das Hintergrundbild wirklich entfernen?')) {
    emit('update:bgImageData', null);
    props.bgConfig.fileName = undefined;
    emit('delete-proband-bg');
  }
}

function onOverwriteSelectChange(e: Event) {
  const val = (e.target as HTMLSelectElement).value;
  emit('update:selectedOverwriteId', val);
  emit('select-overwrite-preset');
}

defineExpose({
  processBgFile,
  centerBgImage,
});
</script>

<template>
  <!-- 1. Falls noch kein Stammahn ausgewählt wurde: Auswahlmaske für Stammahnen -->
  <div v-if="!activeProbandId" class="design-proband-prompt" @mousedown.stop>
    <div class="design-prompt-card">
      <h2>📐 {{ t('design_select_proband_title') }}</h2>
      <p class="design-prompt-subtitle">{{ t('design_select_proband_subtitle') }}</p>

      <div v-if="rootAncestors.length > 0" class="design-proband-list">
        <div
          v-for="r in rootAncestors"
          :key="'dm-root-' + r.person_id"
          class="design-proband-item"
          @click="emit('select-proband', r.person_id)"
        >
          <div class="dp-info">
            <span class="dp-code">[{{ r.starting_code }}]</span>
            <strong>{{ r.surname || 'N.N.' }}, {{ r.given_name || 'N.N.' }}</strong>
            <small class="dp-id">({{ r.person_id }})</small>
          </div>
          <button class="btn-sm btn-select-proband" @click.stop="emit('select-proband', r.person_id)">
            {{ t('free_open_person') }}
          </button>
        </div>
      </div>

      <div v-else class="design-no-probands">
        <p>{{ t('no_probands') }}</p>
        <button class="btn-open-settings" @click="emit('open-settings')">
          {{ t('design_open_settings') }}
        </button>
      </div>
    </div>
  </div>

  <!-- 2. Toolbar, Popover & Modals bei aktivem Stammahn -->
  <template v-else>
    <!-- Auto-Load Notification Toast -->
    <transition name="fade">
      <div v-if="autoLoadToast" class="design-toast-notification">
        <span class="toast-icon">✨</span>
        <span>{{ autoLoadToast }}</span>
      </div>
    </transition>

    <div class="design-toolbar" @mousedown.stop>
      <div class="design-toolbar-left">
        <!-- Subtree-Modus Banner mit Rückkehr-Button -->
        <div v-if="currentLayoutType === 'subtree'" class="subtree-banner-badge">
          <span class="badge-icon">🌿</span>
          <span class="badge-title">{{ t('design_subtree_mode_title') }}: <strong>{{ currentLayoutName }}</strong></span>
          <button class="btn-design-tool btn-return-master" @click="emit('return-to-master')">
            ⬅️ {{ t('design_return_to_master_btn') }}
          </button>
        </div>

        <!-- Undo-Button zum Zurücksetzen der letzten Aktionen -->
        <button
          class="btn-design-tool btn-undo"
          :disabled="!canUndo"
          :title="t('design_undo_tooltip')"
          @click="emit('undo')"
        >
          ↩️ {{ t('design_undo_btn') }} <span v-if="historyLength > 0">({{ historyLength }})</span>
        </button>
        <button class="btn-design-tool" @click="emit('expand-all')">
          {{ t('design_expand_all') }}
        </button>
        <button class="btn-design-tool" @click="emit('collapse-all')">
          {{ t('design_collapse_all') }}
        </button>
        <button class="btn-design-tool btn-reset-design" @click="emit('reset-layout')">
          {{ t('design_reset_layout') }}
        </button>

        <!-- Button & Popover für Hintergrundbild -->
        <div class="bg-tool-wrapper">
          <button
            class="btn-design-tool btn-bg-image"
            :class="{ 'has-image': !!bgImageData, 'active': isBgPopoverOpen }"
            :title="t('design_bg_image_tooltip')"
            @click.stop="emit('update:isBgPopoverOpen', !isBgPopoverOpen)"
          >
            🖼️ {{ t('design_bg_image_btn') }}
            <span v-if="bgImageData" class="bg-indicator-dot" :class="{ 'is-hidden': !bgConfig.visible }"></span>
          </button>
        </div>

        <!-- Hierarchisches Zweig-Design verknüpfen / bearbeiten / lösen -->
        <template v-if="selectedDesignPerson && hasSelectedDescendants">
          <button
            v-if="isCurrentPersonSubtreeLinked && linkedSubtreeLayoutId"
            class="btn-design-tool btn-edit-subtree"
            :title="t('design_edit_subtree_tooltip')"
            @click="emit('open-subtree', linkedSubtreeLayoutId)"
          >
            🌱 {{ t('design_edit_subtree_btn') }} ({{ linkedSubtreeLayoutName || 'Zweig' }})
          </button>
          <button
            v-if="isCurrentPersonSubtreeLinked"
            class="btn-design-tool btn-unlink-subtree"
            :title="t('design_unlink_subtree_btn')"
            @click="emit('unlink-subtree', selectedDesignPerson.id)"
          >
            🔓 {{ t('design_unlink_subtree_btn') }}
          </button>
          <button
            v-else-if="currentLayoutType !== 'subtree'"
            class="btn-design-tool btn-link-subtree"
            :title="t('design_link_subtree_btn')"
            @click="emit('open-link-subtree-modal', selectedDesignPerson.id)"
          >
            🌿 {{ t('design_link_subtree_btn') }}
          </button>
        </template>

        <!-- Button zum Gruppieren aller Nachkommeneinträge des gewählten Eintrags je Ebene -->
        <button
          v-if="selectedDesignPerson && hasSelectedDescendants"
          class="btn-design-tool btn-group-descendants"
          :title="t('design_group_descendants_tooltip')"
          @click="emit('group-descendants', selectedDesignPerson.id)"
        >
          👥 {{ t('design_group_descendants_btn') }} ({{ selectedDesignPerson.given_name || 'N.N.' }} {{ selectedDesignPerson.surname || '' }})
        </button>

        <!-- Button zum Herauslösen des aktuell ausgewählten Eintrags aus der Gruppe / angedockten Gruppe -->
        <button
          v-if="canDetachSelectedPerson && selectedDesignPerson"
          class="btn-design-tool btn-detach-person"
          :title="t('design_detach_person_tooltip')"
          @click="emit('detach-selected')"
        >
          ⏏️ {{ t('design_detach_person_btn') }} ({{ selectedDesignPerson.given_name || 'N.N.' }} {{ selectedDesignPerson.surname || '' }})
        </button>
      </div>

      <div class="design-toolbar-right">
        <span
          class="bridges-badge"
          :class="{
            'has-bridges': bridgesCount > 0,
            'is-disabled': enableLineBridges === false
          }"
        >
          🌉 {{ t('design_bridges_count') }}:
          <strong v-if="enableLineBridges !== false">{{ bridgesCount }}</strong>
          <small v-else style="font-weight: normal; margin-left: 2px;">({{ t('design_bridges_disabled') || 'deaktiviert' }})</small>
        </span>
        <span class="design-hint-text">{{ t('design_hint') }}</span>
      </div>
    </div>

    <!-- Popover für Hintergrundbild-Einstellungen -->
    <div
      v-if="isBgPopoverOpen"
      class="bg-image-popover"
      @click.stop
      @mousedown.stop
      @wheel.stop
    >
      <div class="bg-popover-header">
        <span class="bg-popover-title">🖼️ {{ t('design_bg_image_title') }}</span>
        <button
          type="button"
          class="bg-popover-close"
          @click="emit('update:isBgPopoverOpen', false)"
        >✕</button>
      </div>

      <!-- Keine Datei geladen -->
      <div v-if="!bgImageData" class="bg-popover-empty">
        <p class="bg-drop-hint">{{ t('design_bg_image_drop_hint') }}</p>
        <button
          type="button"
          class="btn-bg-upload-big"
          @click="triggerBgUpload"
        >
          📁 {{ t('design_bg_image_upload_btn') }}
        </button>
      </div>

      <!-- Bild ist geladen -->
      <div v-else class="bg-popover-content">
        <!-- Status & Dateiinfo -->
        <div class="bg-file-info-row">
          <div class="bg-file-meta">
            <span class="bg-filename" :title="bgConfig.fileName || ''">
              {{ bgConfig.fileName || 'Bild' }}
            </span>
            <span v-if="bgConfig.naturalWidth" class="bg-dims">
              {{ bgConfig.naturalWidth }} × {{ bgConfig.naturalHeight }} px
            </span>
          </div>
          <div class="bg-file-actions">
            <button
              type="button"
              class="btn-icon-bg"
              :class="{ 'is-active': bgConfig.visible }"
              :title="bgConfig.visible ? t('design_bg_image_hidden') : t('design_bg_image_visible')"
              @click="bgConfig.visible = !bgConfig.visible"
            >
              {{ bgConfig.visible ? '👁️' : '🙈' }}
            </button>
            <button
              type="button"
              class="btn-icon-bg"
              :title="t('design_bg_image_replace_btn')"
              @click="triggerBgUpload"
            >
              🔄
            </button>
            <button
              type="button"
              class="btn-icon-bg danger"
              :title="t('design_bg_image_delete_btn')"
              @click="removeBgImage"
            >
              🗑️
            </button>
          </div>
        </div>

        <!-- Skalierung / Größe -->
        <div class="bg-control-section">
          <div class="bg-section-label-row">
            <label>🔍 {{ t('design_bg_image_scale_label') }}</label>
            <span class="bg-val-badge">{{ bgConfig.scale }}%</span>
          </div>
          <div class="bg-slider-row">
            <input
              type="range"
              min="10"
              max="400"
              step="1"
              v-model.number="bgConfig.scale"
              class="bg-slider"
            />
            <input
              type="number"
              min="10"
              max="1000"
              v-model.number="bgConfig.scale"
              class="bg-num-input"
            />
          </div>
          <div class="bg-quick-btn-row">
            <button type="button" class="btn-quick-bg" @click="resetBgScale">{{ t('design_bg_image_orig_btn') }}</button>
            <button type="button" class="btn-quick-bg" @click="fitBgToWidth">{{ t('design_bg_image_fit_w_btn') }}</button>
            <button type="button" class="btn-quick-bg" @click="fitBgToHeight">{{ t('design_bg_image_fit_h_btn') }}</button>
          </div>
        </div>

        <!-- Deckkraft / Transparenz -->
        <div class="bg-control-section">
          <div class="bg-section-label-row">
            <label>🌓 {{ t('design_bg_image_opacity_label') }}</label>
            <span class="bg-val-badge">{{ bgConfig.opacity }}%</span>
          </div>
          <div class="bg-slider-row">
            <input
              type="range"
              min="5"
              max="100"
              step="1"
              v-model.number="bgConfig.opacity"
              class="bg-slider"
            />
            <input
              type="number"
              min="5"
              max="100"
              v-model.number="bgConfig.opacity"
              class="bg-num-input"
            />
          </div>
        </div>

        <!-- Positionierung -->
        <div class="bg-control-section">
          <div class="bg-section-label-row">
            <label>📍 {{ t('design_bg_image_pos_label') }}</label>
            <button
              type="button"
              class="btn-toggle-drag-bg"
              :class="{ active: isBgDraggingOnCanvas }"
              @click="emit('update:isBgDraggingOnCanvas', !isBgDraggingOnCanvas)"
              :title="isBgDraggingOnCanvas ? 'Maus-Verschieben beenden' : 'Mit der Maus im Canvas verschieben'"
            >
              ✥ {{ isBgDraggingOnCanvas ? 'Aktiv (Ziehen)' : 'Per Maus' }}
            </button>
          </div>
          <div class="bg-coord-row">
            <label>
              <span>X:</span>
              <input type="number" v-model.number="bgConfig.x" class="bg-num-input coord" />
            </label>
            <label>
              <span>Y:</span>
              <input type="number" v-model.number="bgConfig.y" class="bg-num-input coord" />
            </label>
          </div>
          <div class="bg-quick-btn-row">
            <button type="button" class="btn-quick-bg" @click="centerBgImage">⌖ {{ t('design_bg_image_center_btn') }}</button>
            <button type="button" class="btn-quick-bg" @click="alignBottomCenterBgImage">⬇️ {{ t('design_bg_image_bottom_btn') }}</button>
            <button type="button" class="btn-quick-bg" @click="alignTopLeftBgImage">↖️ Oben links</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Speichern-Modal -->
    <div v-if="showSaveModal" class="design-modal-backdrop" @click="emit('close-save-modal')" @mousedown.stop>
      <div class="design-modal-window" @click.stop>
        <div class="design-modal-header">
          <div class="design-modal-title">
            <span class="design-modal-icon">💾</span>
            <h3>{{ isInitialOffer ? t('design_initial_offer_title') : t('design_save_modal_title') }}</h3>
          </div>
          <button class="design-modal-close-btn" @click="emit('close-save-modal')">✕</button>
        </div>

        <div class="design-modal-body">
          <!-- Hinweis-Banner beim ersten Öffnen / wenn noch kein Stand existiert -->
          <div v-if="isInitialOffer" class="design-initial-offer-banner">
            <span class="offer-icon">💡</span>
            <div class="offer-text">
              <strong>{{ t('design_initial_offer_badge') }}</strong>
              <p>{{ t('design_initial_offer_subtitle') }}</p>
            </div>
          </div>

          <div class="design-modal-proband-banner">
            <span class="proband-label">Stammahn:</span>
            <strong>{{ activeProbandName || '–' }}</strong>
          </div>

          <!-- Modus-Auswahl: Neuer Stand oder Bestehenden Stand überschreiben -->
          <div v-if="!isInitialOffer && existingPresets.length > 0" class="save-mode-selector">
            <label class="save-mode-radio">
              <input
                type="radio"
                name="save-mode"
                value="new"
                :checked="saveMode === 'new'"
                @change="emit('save-mode-change', 'new')"
              />
              <span>{{ t('design_save_mode_new') }}</span>
            </label>
            <label class="save-mode-radio">
              <input
                type="radio"
                name="save-mode"
                value="overwrite"
                :checked="saveMode === 'overwrite'"
                @change="emit('save-mode-change', 'overwrite')"
              />
              <span>{{ t('design_save_mode_overwrite') }} ({{ existingPresets.length }})</span>
            </label>
          </div>

          <!-- Wenn Modus "Überschreiben": Auswahlliste bestehender Stände -->
          <div v-if="saveMode === 'overwrite'" class="design-form-group">
            <label class="design-form-label">{{ t('design_select_overwrite_label') }}</label>
            <select
              :value="selectedOverwriteId"
              class="design-modal-select"
              @change="onOverwriteSelectChange"
            >
              <option v-for="preset in existingPresets" :key="preset.id" :value="preset.id">
                {{ preset.name }} ({{ formatDateStr(preset.created_at) }})
              </option>
            </select>
          </div>

          <div class="design-form-group">
            <label class="design-form-label">{{ t('design_save_filename_label') }}</label>
            <input
              :value="saveFileName"
              type="text"
              class="design-modal-input"
              :placeholder="t('design_save_filename_placeholder')"
              @input="emit('update:saveFileName', ($event.target as HTMLInputElement).value)"
              @keyup.enter="emit('save-to-db')"
              autofocus
            />
            <span v-if="saveMode === 'new' && isMatchingExistingName" class="design-input-hint warn-text">
              ⚠️ {{ t('design_overwrite_warning') }}
            </span>
            <span v-else class="design-input-hint">
              {{ saveMode === 'overwrite' ? t('design_overwrite_hint') : 'Mehrere Stände können gespeichert werden, um verschiedene Anordnungen auszuprobieren.' }}
            </span>
          </div>

          <div class="design-summary-box">
            <div class="summary-item">
              <span class="s-label">Ebenen:</span>
              <span class="s-val">{{ totalLevels }}</span>
            </div>
            <div class="summary-item">
              <span class="s-label">Gruppen:</span>
              <span class="s-val">{{ siblingGroupsCount }}</span>
            </div>
            <div class="summary-item">
              <span class="s-label">Zweig-Abgrenzungen:</span>
              <span class="s-val">{{ branchWidthsCount }}</span>
            </div>
          </div>

          <div v-if="saveFeedbackMessage" class="design-modal-feedback success">
            {{ saveFeedbackMessage }}
          </div>
        </div>

        <div class="design-modal-footer">
          <template v-if="isInitialOffer">
            <button
              class="d-modal-btn d-modal-btn-primary"
              :disabled="!saveFileName.trim() || isSaving"
              @click="emit('export-to-file')"
            >
              {{ t('design_initial_offer_create_file_btn') }}
            </button>
            <button
              class="d-modal-btn d-modal-btn-secondary"
              :disabled="!saveFileName.trim() || isSaving"
              @click="emit('save-to-db')"
            >
              {{ t('design_save_to_db_btn') }}
            </button>
            <button class="d-modal-btn d-modal-btn-cancel" @click="emit('close-save-modal')">
              {{ t('design_initial_offer_later_btn') }}
            </button>
          </template>
          <template v-else>
            <button
              class="d-modal-btn d-modal-btn-primary"
              :class="{ 'btn-overwrite': saveMode === 'overwrite' || isMatchingExistingName }"
              :disabled="!saveFileName.trim() || isSaving"
              @click="emit('save-to-db')"
            >
              {{ (saveMode === 'overwrite' || isMatchingExistingName) ? t('design_overwrite_btn') : t('design_save_to_db_btn') }}
            </button>
            <button
              class="d-modal-btn d-modal-btn-secondary"
              :disabled="!saveFileName.trim() || isSaving"
              @click="emit('export-to-file')"
            >
              {{ t('design_export_file_btn') }}
            </button>
            <button class="d-modal-btn d-modal-btn-cancel" @click="emit('close-save-modal')">
              {{ t('cancel') || 'Abbrechen' }}
            </button>
          </template>
        </div>
      </div>
    </div>

    <!-- Laden-Modal -->
    <div v-if="showLoadModal" class="design-modal-backdrop" @click="emit('close-load-modal')" @mousedown.stop>
      <div class="design-modal-window load-modal-window" @click.stop>
        <div class="design-modal-header">
          <div class="design-modal-title">
            <span class="design-modal-icon">📂</span>
            <h3>{{ t('design_load_modal_title') }}</h3>
          </div>
          <button class="design-modal-close-btn" @click="emit('close-load-modal')">✕</button>
        </div>

        <div class="design-modal-body">
          <div class="design-modal-proband-banner">
            <span class="proband-label">{{ t('design_saved_presets_title') }}</span>
            <strong>{{ activeProbandName || '–' }}</strong>
          </div>

          <div v-if="loadFeedbackMessage" class="design-modal-feedback success">
            {{ loadFeedbackMessage }}
          </div>

          <!-- Gespeicherte Stände Liste -->
          <div class="design-presets-container">
            <div v-if="isLoadingLayouts" class="design-presets-loading">
              Lade Stände...
            </div>
            <div v-else-if="savedLayoutsList.length === 0" class="design-empty-presets">
              {{ t('design_no_presets') }}
            </div>
            <div v-else class="design-presets-list">
              <div
                v-for="entry in savedLayoutsList"
                :key="entry.id"
                class="design-preset-row"
              >
                <div class="preset-info">
                  <div class="preset-name">
                    {{ entry.name }}
                    <span v-if="entry.layout_type === 'subtree'" class="preset-type-badge subtree">🌿 {{ t('design_preset_type_subtree') }}</span>
                    <span v-else class="preset-type-badge master">🌳 {{ t('design_preset_type_master') }}</span>
                  </div>
                  <div class="preset-meta">
                    <span>🕒 {{ formatDateStr(entry.created_at) }}</span>
                  </div>
                </div>
                <div class="preset-actions">
                  <button
                    class="d-preset-btn btn-apply"
                    @click="emit('load-entry', entry)"
                    :title="t('design_load_preset_btn')"
                  >
                    {{ t('design_load_preset_btn') }}
                  </button>
                  <button
                    class="d-preset-btn btn-export"
                    @click="emit('export-entry', entry)"
                    :title="t('design_export_file_btn')"
                  >
                    💾 Datei
                  </button>
                  <button
                    class="d-preset-btn btn-delete"
                    @click="emit('delete-entry', entry.id)"
                    :title="t('design_delete_preset_btn')"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Geteilte Datei öffnen -->
          <div class="design-external-file-box">
            <div class="ext-file-title">
              <strong>{{ t('design_open_file_section') }}</strong>
            </div>
            <p class="ext-file-desc">{{ t('design_open_file_hint') }}</p>
            <button class="d-modal-btn d-modal-btn-open-file" @click="emit('open-external-file')">
              {{ t('design_open_file_btn') }}
            </button>
            <input
              :ref="el => setDesignFileInputRef(el as HTMLInputElement | null)"
              type="file"
              accept=".json"
              style="display: none"
              @change="emit('file-input-change', $event)"
            />
          </div>
        </div>

        <div class="design-modal-footer">
          <button class="d-modal-btn d-modal-btn-cancel" @click="emit('close-load-modal')">
            {{ t('close') || 'Schließen' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Neues Design Modal (mit Stammahn-Auswahl) -->
    <div
      v-if="showNewDesignModal"
      class="design-modal-backdrop new-design-backdrop"
      @click="emit('close-new-design-modal')"
      @mousedown.stop
    >
      <div class="design-modal-window new-design-modal-window" @click.stop>
        <div class="design-modal-header">
          <div class="design-modal-title">
            <span class="design-modal-icon">📄</span>
            <h3>{{ t('design_new_modal_title') }}</h3>
          </div>
          <button class="design-modal-close-btn" @click="emit('close-new-design-modal')">✕</button>
        </div>

        <div class="design-modal-body">
          <p class="design-modal-intro">
            {{ t('design_new_modal_intro') }}
          </p>

          <!-- Auswahl: Master vs. Zweig-Design -->
          <div class="new-design-type-selector">
            <label class="new-design-radio">
              <input
                type="radio"
                name="new-design-type"
                value="master"
                :checked="newDesignLayoutType === 'master'"
                @change="emit('update:newDesignLayoutType', 'master')"
              />
              <span>🌳 {{ t('design_new_modal_type_master') }}</span>
            </label>
            <label class="new-design-radio">
              <input
                type="radio"
                name="new-design-type"
                value="subtree"
                :checked="newDesignLayoutType === 'subtree'"
                @change="emit('update:newDesignLayoutType', 'subtree')"
              />
              <span>🌿 {{ t('design_new_modal_type_subtree') }}</span>
            </label>
          </div>

          <!-- Stammahn Auswahl (wenn Master) -->
          <div v-if="newDesignLayoutType !== 'subtree'" class="design-form-group">
            <label class="design-form-label">{{ t('design_new_modal_proband_label') }}</label>
            <select
              :value="newDesignProbandId"
              class="design-modal-select"
              @change="emit('update:newDesignProbandId', ($event.target as HTMLSelectElement).value)"
            >
              <option
                v-for="r in rootAncestors"
                :key="'nd-root-' + r.person_id"
                :value="r.person_id"
              >
                [{{ r.starting_code }}] {{ r.surname || 'N.N.' }}, {{ r.given_name || 'N.N.' }} ({{ r.person_id }})
              </option>
            </select>
            <span class="design-input-hint">
              {{ t('design_new_modal_proband_hint') }}
            </span>
          </div>

          <!-- Wurzelperson des Zweigs (wenn Zweig-Design) -->
          <div v-else class="design-form-group">
            <label class="design-form-label">{{ t('design_new_modal_anchor_label') }}</label>
            <select
              :value="newDesignAnchorPersonId"
              class="design-modal-select"
              @change="emit('update:newDesignAnchorPersonId', ($event.target as HTMLSelectElement).value)"
            >
              <option value="" disabled>– {{ t('select') || 'Bitte wählen' }} –</option>
              <option
                v-for="p in allPersonsList"
                :key="'nd-anchor-' + p.id"
                :value="p.id"
              >
                {{ p.name }} ({{ p.id }})
              </option>
            </select>
            <span class="design-input-hint">
              {{ t('design_new_modal_anchor_hint') }}
            </span>
          </div>

          <!-- Name des Entwurfs -->
          <div class="design-form-group">
            <label class="design-form-label">{{ t('design_save_filename_label') }}</label>
            <input
              :value="newDesignFileName"
              type="text"
              class="design-modal-input"
              :placeholder="t('design_save_filename_placeholder')"
              @input="emit('update:newDesignFileName', ($event.target as HTMLInputElement).value)"
              @keyup.enter="emit('confirm-create-new-design')"
              autofocus
            />
          </div>

          <!-- Warnung bei ungespeicherten Änderungen -->
          <div v-if="hasUnsavedChanges" class="design-unsaved-warning">
            <span class="warn-icon">⚠️</span>
            <div class="warn-text">
              <strong>{{ t('attention') || 'Achtung' }}</strong>
              <p>{{ t('design_new_file_confirm') }}</p>
            </div>
          </div>
        </div>

        <div class="design-modal-footer">
          <button
            class="d-modal-btn d-modal-btn-primary"
            :disabled="!newDesignFileName?.trim() || (newDesignLayoutType === 'subtree' ? !newDesignAnchorPersonId : !newDesignProbandId)"
            @click="emit('confirm-create-new-design')"
          >
            {{ t('design_new_modal_submit_btn') }}
          </button>
          <button class="d-modal-btn d-modal-btn-cancel" @click="emit('close-new-design-modal')">
            {{ t('cancel') || 'Abbrechen' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Modal: Zweig-Design verknüpfen -->
    <div
      v-if="showLinkSubtreeModal"
      class="design-modal-backdrop link-subtree-backdrop"
      @click="emit('close-link-subtree-modal')"
      @mousedown.stop
    >
      <div class="design-modal-window" @click.stop>
        <div class="design-modal-header">
          <div class="design-modal-title">
            <span class="design-modal-icon">🌿</span>
            <h3>{{ t('design_link_modal_title') }}</h3>
          </div>
          <button class="design-modal-close-btn" @click="emit('close-link-subtree-modal')">✕</button>
        </div>

        <div class="design-modal-body">
          <p class="design-modal-intro">
            {{ t('design_link_modal_intro') }}
          </p>

          <div class="design-modal-proband-banner">
            <span class="proband-label">{{ t('person') || 'Person' }}:</span>
            <strong>{{ targetLinkAnchorPersonName || targetLinkAnchorPersonId }}</strong>
          </div>

          <!-- Verfügbare Zweig-Designs -->
          <div class="design-presets-container">
            <div v-if="isLoadingSubtreeLayouts" class="design-presets-loading">
              Lade Zweig-Designs...
            </div>
            <div v-else-if="!availableSubtreeLayouts || availableSubtreeLayouts.length === 0" class="design-empty-presets">
              <p>{{ t('design_no_subtree_layouts') }}</p>
              <button
                class="d-modal-btn d-modal-btn-primary"
                style="margin-top: 10px;"
                @click="emit('create-subtree-for-person', targetLinkAnchorPersonId || '')"
              >
                ➕ {{ t('design_create_subtree_btn') }}
              </button>
            </div>
            <div v-else class="design-presets-list">
              <div
                v-for="entry in availableSubtreeLayouts"
                :key="entry.id"
                class="design-preset-row"
              >
                <div class="preset-info">
                  <div class="preset-name">{{ entry.name }}</div>
                  <div class="preset-meta">
                    <span>🕒 {{ formatDateStr(entry.created_at) }}</span>
                  </div>
                </div>
                <div class="preset-actions">
                  <button
                    class="d-preset-btn btn-apply"
                    @click="emit('link-subtree', targetLinkAnchorPersonId || '', entry)"
                  >
                    🔗 Verknüpfen
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="design-modal-footer">
          <button
            v-if="availableSubtreeLayouts && availableSubtreeLayouts.length > 0"
            class="d-modal-btn d-modal-btn-secondary"
            @click="emit('create-subtree-for-person', targetLinkAnchorPersonId || '')"
          >
            ➕ {{ t('design_create_subtree_btn') }}
          </button>
          <button class="d-modal-btn d-modal-btn-cancel" @click="emit('close-link-subtree-modal')">
            {{ t('cancel') || 'Abbrechen' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Versteckter Datei-Input für Hintergrundbild-Upload (JPG, PNG, SVG, WEBP) -->
    <input
      ref="bgFileInputRef"
      type="file"
      accept=".jpg,.jpeg,.png,.svg,.webp,image/jpeg,image/png,image/svg+xml,image/webp"
      style="display: none;"
      @change="onBgFileSelected"
    />
  </template>
</template>

<style scoped>
/* Stammahnen-Auswahlmaske wenn noch kein Stammahn gewählt ist */
.design-proband-prompt {
  flex-grow: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  overflow-y: auto;
}
.design-prompt-card {
  background: white;
  border: 1px solid #dcdde1;
  border-radius: 8px;
  padding: 1.6rem 2rem;
  width: 100%;
  max-width: 640px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.06);
}
.design-prompt-card h2 {
  margin: 0 0 0.4rem 0;
  color: #2c3e50;
  font-size: 1.25rem;
}
.design-prompt-subtitle {
  margin: 0 0 1.2rem 0;
  color: #7f8c8d;
  font-size: 0.9rem;
  line-height: 1.45;
}
.design-proband-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: 320px;
  overflow-y: auto;
}
.design-proband-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.65rem 0.9rem;
  border: 1px solid #e1e8ed;
  border-radius: 6px;
  background: #fafbfc;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.design-proband-item:hover {
  background: #eaf4fc;
  border-color: #3498db;
}
.dp-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.92rem;
  color: #2c3e50;
}
.dp-code {
  background: #34495e;
  color: white;
  font-weight: bold;
  font-size: 0.78rem;
  padding: 2px 6px;
  border-radius: 4px;
}
.dp-id {
  color: #7f8c8d;
}
.btn-select-proband {
  background: #2980b9;
  color: white;
  border: none;
  padding: 0.35rem 0.75rem;
  border-radius: 4px;
  cursor: pointer;
  font-weight: bold;
  font-size: 0.8rem;
}
.btn-select-proband:hover {
  background: #1f618d;
}
.design-no-probands {
  text-align: center;
  padding: 1rem;
  background: #f8f9fa;
  border: 1px dashed #bdc3c7;
  border-radius: 6px;
}
.btn-open-settings {
  margin-top: 0.5rem;
  background: #3498db;
  color: white;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  cursor: pointer;
  font-weight: bold;
}

/* Design-Toolbar */
.design-toolbar {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 10px 15px;
  background: white;
  border-bottom: 1px solid #dcdde1;
  z-index: 20;
}
.design-toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.design-toolbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.btn-design-tool {
  background: #34495e;
  color: white;
  border: none;
  padding: 0.4rem 0.75rem;
  border-radius: 4px;
  font-size: 0.78rem;
  font-weight: bold;
  cursor: pointer;
}
.btn-design-tool:hover {
  background: #2c3e50;
}
.btn-undo {
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  color: #334155;
}
.btn-undo:hover:not(:disabled) {
  background: #e2e8f0;
  border-color: #94a3b8;
  color: #0f172a;
}
.btn-undo:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.btn-reset-design {
  background: #e67e22;
}
.btn-reset-design:hover {
  background: #d35400;
}
.btn-group-descendants {
  background: #2563eb;
  color: white;
}
.btn-group-descendants:hover {
  background: #1d4ed8;
}
.btn-detach-person {
  background: #ebf8ff;
  color: #2b6cb0;
  border-color: #bee3f8;
}
.btn-detach-person:hover {
  background: #3182ce;
  color: white;
}
.bridges-badge {
  font-size: 0.8rem;
  padding: 0.3rem 0.65rem;
  border-radius: 12px;
  background: #ecf0f1;
  color: #576574;
  border: 1px solid #dcdde1;
  white-space: nowrap;
}
.bridges-badge.has-bridges {
  background: #fff3cd;
  color: #856404;
  border-color: #ffeeba;
}
.bridges-badge.is-disabled {
  opacity: 0.65;
  background: #f1f5f9;
  color: #94a3b8;
}
.design-hint-text {
  font-size: 0.76rem;
  color: #7f8c8d;
}

/* Hintergrundbild-Button & Popover */
.bg-tool-wrapper {
  position: relative;
  display: inline-block;
}
.btn-bg-image {
  background: #475569;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  position: relative;
}
.btn-bg-image:hover {
  background: #334155;
}
.btn-bg-image.has-image {
  background: #0284c7;
}
.btn-bg-image.has-image:hover {
  background: #0369a1;
}
.btn-bg-image.active {
  box-shadow: 0 0 0 2px #38bdf8;
}
.bg-indicator-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #22c55e;
  display: inline-block;
}
.bg-indicator-dot.is-hidden {
  background: #f59e0b;
}
.bg-image-popover {
  position: absolute;
  top: 58px;
  right: 14px;
  left: auto;
  width: 340px;
  max-width: calc(100% - 28px);
  max-height: calc(100% - 68px);
  overflow-y: auto;
  overscroll-behavior: contain;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  box-shadow: 0 12px 32px -4px rgba(0, 0, 0, 0.22), 0 8px 12px -6px rgba(0, 0, 0, 0.12);
  z-index: 60;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  user-select: none;
  box-sizing: border-box;
}
.bg-image-popover::-webkit-scrollbar {
  width: 6px;
}
.bg-image-popover::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 3px;
}
.bg-image-popover::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}
.bg-popover-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #f1f5f9;
  padding-bottom: 8px;
}
.bg-popover-title {
  font-size: 0.88rem;
  font-weight: 700;
  color: #0f172a;
}
.bg-popover-close {
  background: none;
  border: none;
  font-size: 1rem;
  color: #64748b;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
}
.bg-popover-close:hover {
  background: #f1f5f9;
  color: #0f172a;
}
.bg-popover-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 10px;
  padding: 12px 6px;
}
.bg-drop-hint {
  font-size: 0.8rem;
  color: #64748b;
  margin: 0;
  line-height: 1.4;
}
.btn-bg-upload-big {
  width: 100%;
  background: #2563eb;
  color: white;
  border: none;
  padding: 8px 14px;
  border-radius: 6px;
  font-size: 0.84rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease;
}
.btn-bg-upload-big:hover {
  background: #1d4ed8;
}
.bg-popover-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.bg-file-info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #f8fafc;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
}
.bg-file-meta {
  display: flex;
  flex-direction: column;
  max-width: 180px;
}
.bg-filename {
  font-size: 0.78rem;
  font-weight: 600;
  color: #1e293b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bg-dims {
  font-size: 0.7rem;
  color: #64748b;
}
.bg-file-actions {
  display: flex;
  gap: 4px;
}
.btn-icon-bg {
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  padding: 4px 6px;
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn-icon-bg:hover {
  background: #f1f5f9;
  border-color: #94a3b8;
}
.btn-icon-bg.danger:hover {
  background: #fef2f2;
  border-color: #ef4444;
  color: #dc2626;
}
.btn-icon-bg.is-active {
  background: #eff6ff;
  border-color: #3b82f6;
}
.bg-control-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.bg-section-label-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.78rem;
  font-weight: 600;
  color: #334155;
}
.bg-val-badge {
  font-size: 0.74rem;
  font-weight: 700;
  color: #2563eb;
  background: #eff6ff;
  padding: 1px 6px;
  border-radius: 4px;
}
.bg-slider-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.bg-slider {
  flex: 1;
  height: 5px;
  accent-color: #2563eb;
  cursor: pointer;
}
.bg-num-input {
  width: 52px;
  padding: 3px 5px;
  font-size: 0.78rem;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  text-align: right;
  outline: none;
}
.bg-num-input:focus {
  border-color: #2563eb;
}
.bg-num-input.coord {
  width: 70px;
}
.bg-quick-btn-row {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
}
.btn-quick-bg {
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  color: #334155;
  font-size: 0.72rem;
  font-weight: 600;
  padding: 3px 7px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.12s ease;
}
.btn-quick-bg:hover {
  background: #e2e8f0;
  color: #0f172a;
}
.btn-toggle-drag-bg {
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  font-size: 0.7rem;
  font-weight: 600;
  color: #475569;
  padding: 2px 7px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.12s ease;
}
.btn-toggle-drag-bg:hover {
  background: #e2e8f0;
  color: #0f172a;
}
.btn-toggle-drag-bg.active {
  background: #2563eb;
  border-color: #1d4ed8;
  color: #ffffff;
}
.bg-coord-row {
  display: flex;
  gap: 12px;
  align-items: center;
}
.bg-coord-row label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.78rem;
  color: #475569;
  font-weight: 600;
}

/* Modals für Speichern und Laden & Toast */
.design-modal-backdrop {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(15, 23, 42, 0.6);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 20px;
  box-sizing: border-box;
}
.design-modal-backdrop.link-subtree-backdrop {
  z-index: 105;
}
.design-modal-backdrop.new-design-backdrop {
  z-index: 120;
}
.design-modal-window {
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.25);
  width: 100%;
  max-width: 480px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #cbd5e1;
  animation: modalPopIn 0.18s ease-out;
}
.design-modal-window.load-modal-window {
  max-width: 580px;
}
@keyframes modalPopIn {
  from {
    opacity: 0;
    transform: scale(0.95) translateY(8px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}
.design-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 18px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}
.design-modal-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.design-modal-title h3 {
  margin: 0;
  font-size: 1.05rem;
  color: #1e293b;
  font-weight: 700;
}
.design-modal-icon {
  font-size: 1.25rem;
}
.design-modal-close-btn {
  background: transparent;
  border: none;
  font-size: 1.1rem;
  color: #64748b;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
}
.design-modal-close-btn:hover {
  background: #e2e8f0;
  color: #0f172a;
}
.design-modal-body {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  max-height: 70vh;
}
.design-toast-notification {
  position: absolute;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(15, 23, 42, 0.92);
  color: #f8fafc;
  padding: 8px 18px;
  border-radius: 20px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  font-size: 0.85rem;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 8px;
  z-index: 1200;
  pointer-events: none;
  border: 1px solid rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(4px);
}
.design-initial-offer-banner {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  color: #1e3a8a;
  padding: 12px 14px;
  border-radius: 8px;
  font-size: 0.88rem;
}
.design-initial-offer-banner .offer-icon {
  font-size: 1.3rem;
  line-height: 1;
}
.design-initial-offer-banner .offer-text strong {
  display: block;
  font-size: 0.92rem;
  color: #1e40af;
  margin-bottom: 3px;
}
.design-initial-offer-banner .offer-text p {
  margin: 0;
  color: #1e3a8a;
  line-height: 1.35;
}
.design-modal-proband-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  color: #166534;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 0.85rem;
}
.proband-label {
  color: #15803d;
  font-size: 0.8rem;
}
.save-mode-selector {
  display: flex;
  gap: 16px;
  background: #f8fafc;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
}
.save-mode-radio {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85rem;
  font-weight: 600;
  color: #334155;
  cursor: pointer;
}
.save-mode-radio input[type="radio"] {
  cursor: pointer;
}
.design-modal-select {
  width: 100%;
  padding: 8px 12px;
  border: 1.5px solid #cbd5e1;
  border-radius: 6px;
  font-size: 0.88rem;
  background: #ffffff;
  color: #1e293b;
  outline: none;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.design-modal-select:focus {
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
}
.warn-text {
  color: #b45309 !important;
  font-weight: 600;
}
.btn-overwrite {
  background: #d97706 !important;
  border-color: #b45309 !important;
}
.btn-overwrite:hover:not(:disabled) {
  background: #b45309 !important;
}
.design-form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.design-form-label {
  font-size: 0.85rem;
  font-weight: 600;
  color: #334155;
}
.design-modal-input {
  width: 100%;
  padding: 8px 12px;
  border: 1.5px solid #cbd5e1;
  border-radius: 6px;
  font-size: 0.9rem;
  box-sizing: border-box;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.design-modal-input:focus {
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
}
.design-input-hint {
  font-size: 0.75rem;
  color: #64748b;
}
.design-summary-box {
  display: flex;
  align-items: center;
  justify-content: space-around;
  background: #f1f5f9;
  border-radius: 8px;
  padding: 10px;
  gap: 8px;
}
.summary-item {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.summary-item .s-label {
  font-size: 0.72rem;
  color: #64748b;
}
.summary-item .s-val {
  font-size: 1.05rem;
  font-weight: bold;
  color: #1e293b;
}
.design-modal-feedback {
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 0.82rem;
  font-weight: 600;
}
.design-modal-feedback.success {
  background: #dcfce7;
  color: #15803d;
  border: 1px solid #86efac;
}
.design-modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  background: #f8fafc;
  border-top: 1px solid #e2e8f0;
}
.d-modal-btn {
  padding: 7px 14px;
  border-radius: 6px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 0.15s, border-color 0.15s, transform 0.12s;
}
.d-modal-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.d-modal-btn-primary {
  background: #2563eb;
  color: white;
}
.d-modal-btn-primary:hover:not(:disabled) {
  background: #1d4ed8;
}
.d-modal-btn-secondary {
  background: #f1f5f9;
  color: #1e293b;
  border-color: #cbd5e1;
}
.d-modal-btn-secondary:hover:not(:disabled) {
  background: #e2e8f0;
  border-color: #94a3b8;
}
.d-modal-btn-cancel {
  background: #ffffff;
  color: #64748b;
  border-color: #cbd5e1;
}
.d-modal-btn-cancel:hover {
  background: #f1f5f9;
  color: #1e293b;
}
.design-presets-container {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #fafafa;
  padding: 4px;
}
.design-presets-loading,
.design-empty-presets {
  padding: 20px;
  text-align: center;
  color: #64748b;
  font-size: 0.85rem;
}
.design-presets-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.design-preset-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  transition: border-color 0.12s, box-shadow 0.12s;
}
.design-preset-row:hover {
  border-color: #3b82f6;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
}
.preset-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.preset-name {
  font-size: 0.88rem;
  font-weight: 700;
  color: #1e293b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.preset-meta {
  font-size: 0.72rem;
  color: #64748b;
}
.preset-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.d-preset-btn {
  padding: 4px 8px;
  font-size: 0.75rem;
  font-weight: 600;
  border-radius: 4px;
  cursor: pointer;
  border: 1px solid transparent;
}
.d-preset-btn.btn-apply {
  background: #2563eb;
  color: white;
}
.d-preset-btn.btn-apply:hover {
  background: #1d4ed8;
}
.d-preset-btn.btn-export {
  background: #f1f5f9;
  color: #334155;
  border-color: #cbd5e1;
}
.d-preset-btn.btn-export:hover {
  background: #e2e8f0;
}
.d-preset-btn.btn-delete {
  background: #fff1f2;
  color: #e11d48;
  border-color: #fecdd3;
}
.d-preset-btn.btn-delete:hover {
  background: #ffe4e6;
}
.design-external-file-box {
  background: #f8fafc;
  border: 1.5px dashed #cbd5e1;
  border-radius: 8px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
}
.ext-file-title {
  font-size: 0.85rem;
  color: #1e293b;
}
.ext-file-desc {
  margin: 0;
  font-size: 0.76rem;
  color: #64748b;
}
.d-modal-btn-open-file {
  background: #10b981;
  color: white;
  margin-top: 4px;
}
.d-modal-btn-open-file:hover {
  background: #059669;
}
.new-design-modal-window {
  max-width: 520px;
}
.design-modal-intro {
  margin: 0;
  font-size: 0.86rem;
  color: #475569;
  line-height: 1.45;
}
.design-unsaved-warning {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  background: #fffbeb;
  border: 1px solid #fef3c7;
  border-left: 4px solid #f59e0b;
  padding: 10px 14px;
  border-radius: 6px;
  margin-top: 4px;
}
.design-unsaved-warning .warn-icon {
  font-size: 1.25rem;
  line-height: 1;
}
.design-unsaved-warning .warn-text strong {
  color: #b45309;
  font-size: 0.85rem;
  display: block;
  margin-bottom: 2px;
}
.design-unsaved-warning .warn-text p {
  color: #92400e;
  font-size: 0.8rem;
  margin: 0;
  line-height: 1.4;
}

.subtree-banner-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
  padding: 3px 8px;
  border-radius: 6px;
}
.subtree-banner-badge .badge-icon {
  font-size: 0.95rem;
}
.subtree-banner-badge .badge-title {
  font-size: 0.8rem;
  color: #065f46;
}
.btn-return-master {
  background: #10b981 !important;
  color: #ffffff !important;
  font-weight: 700;
  border: 1px solid #059669 !important;
}
.btn-return-master:hover {
  background: #059669 !important;
}
.btn-link-subtree {
  background: #f0fdf4 !important;
  color: #166534 !important;
  border-color: #86efac !important;
}
.btn-link-subtree:hover {
  background: #16a34a !important;
  color: #ffffff !important;
}
.btn-edit-subtree {
  background: #ecfdf5 !important;
  color: #065f46 !important;
  border-color: #6ee7b7 !important;
}
.btn-edit-subtree:hover {
  background: #059669 !important;
  color: #ffffff !important;
}
.btn-unlink-subtree {
  background: #fff7ed !important;
  color: #9a3412 !important;
  border-color: #fed7aa !important;
}
.btn-unlink-subtree:hover {
  background: #ea580c !important;
  color: #ffffff !important;
}
.new-design-type-selector {
  display: flex;
  gap: 16px;
  padding: 8px 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  margin-bottom: 12px;
}
.new-design-radio {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.82rem;
  font-weight: 600;
  color: #334155;
  cursor: pointer;
}
.preset-type-badge {
  font-size: 0.65rem;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 4px;
  margin-left: 6px;
  display: inline-block;
  vertical-align: middle;
}
.preset-type-badge.subtree {
  background: #d1fae5;
  color: #065f46;
}
.preset-type-badge.master {
  background: #dbeafe;
  color: #1e40af;
}
</style>
