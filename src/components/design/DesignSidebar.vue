<script setup lang="ts">
import { computed, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { useI18n } from 'vue-i18n';
import { FALLBACK_LOCALE, resolveLocale } from '../../locales/registry';
import type { Person, RootAncestorConfig } from '../../composables/usePersons';
import type { DesignStudioStore } from '../../composables/useDesignStudioStore';
import type { DesignCardConfig } from '../../types/design';
import type {
  CardDensityProfile,
  GrowthDirection,
  LineagePolicy,
  RoutingStyle,
} from '../../domain/design/sceneTypes';
import {
  generateSceneGraphPdfBytes,
  generateSceneGraphSvg,
  renderSceneSvgToRaster,
} from '../../utils/designSceneExport';

const props = defineProps<{
  store: DesignStudioStore;
  rootAncestors: RootAncestorConfig[];
  persons: Person[];
  isBgPopoverOpen: boolean;
  fitToScreen: () => void;
  centerOnOrigin: () => void;
}>();

const emit = defineEmits<{
  (e: 'select-proband', personId: string): void;
  (e: 'open-settings'): void;
  (e: 'update:is-bg-popover-open', val: boolean): void;
  (e: 'tree-imported', treeName: string): void;
  (e: 'card-config-changed', cfg: DesignCardConfig): void;
}>();

const { locale, t } = useI18n();

const activeDoc = computed(() => props.store.activeDocument.value);
const hasExternalDesignConflict = computed(() => props.store.hasExternalDesignConflict.value);
const sceneGraph = computed(() => props.store.sceneGraph.value);
const breadcrumbs = computed(() => props.store.breadcrumbStack.value);
const isInSubtreeMode = computed(() => props.store.isInSubtreeMode.value);
const savedMasters = computed(() => props.store.savedMasterList.value);
const savedSubtrees = computed(() => props.store.savedSubtreeList.value);
const effectiveRootId = computed(() => props.store.effectiveRootId.value);
const isDirty = computed(() => props.store.isDirty.value);
const canUndo = computed(() => props.store.canUndo.value);
const canRedo = computed(() => props.store.canRedo.value);
const showLevelGrid = computed(() => props.store.showLevelGrid.value);
const isSplitToolActive = computed(() => props.store.isSplitToolActive.value);

const hiddenPersonsCount = computed(() => {
  const doc = activeDoc.value;
  if (!doc) return 0;
  return Object.values(doc.personRules).filter(r => r.isHidden).length;
});

const personLabelById = computed(() => {
  const map = new Map<string, string>();
  for (const p of props.persons) {
    const name = `${p.given_name || ''} ${p.surname || ''}`.trim();
    map.set(p.id, name || p.id);
  }
  return map;
});

// Popover & Modal States
const isCardPopoverOpen = ref(false);
const isExportPopoverOpen = ref(false);
const showSaveAsModal = ref(false);
const showLoadModal = ref(false);
const showCryptoModal = ref(false);
const bgFileInputRef = ref<HTMLInputElement | null>(null);

const saveAsName = ref('');
const exportFormat = ref<'svg' | 'pdf' | 'png' | 'jpg'>('pdf');
const exportScale = ref<number>(2);
const exportPdfPaper = ref<'auto' | 'a4' | 'a3' | 'a2' | 'a1' | 'a0'>('auto');
const exportIncludeGrid = ref(false);
const exportIncludeBg = ref(true);
const exportOnlyYears = ref(false);
const isExportingGraphic = ref(false);

// Verschlüsselter .lgproj Export / Import
const cryptoTab = ref<'export' | 'import'>('export');
const cryptoPassword = ref('');
const cryptoPasswordConfirm = ref('');
const cryptoImportPath = ref('');
const cryptoImportTreeName = ref('');
const isCryptoBusy = ref(false);
const cryptoLocalError = ref('');

function closeAllPopovers() {
  isCardPopoverOpen.value = false;
  isExportPopoverOpen.value = false;
  emit('update:is-bg-popover-open', false);
}

function toggleBgPopover() {
  const next = !props.isBgPopoverOpen;
  closeAllPopovers();
  emit('update:is-bg-popover-open', next);
}

function toggleCardPopover() {
  const next = !isCardPopoverOpen.value;
  closeAllPopovers();
  isCardPopoverOpen.value = next;
}

function toggleExportPopover() {
  const next = !isExportPopoverOpen.value;
  closeAllPopovers();
  isExportPopoverOpen.value = next;
}

function onProbandChange(ev: Event) {
  const val = (ev.target as HTMLSelectElement).value;
  if (val) emit('select-proband', val);
}

function updateCardField(partial: Partial<DesignCardConfig>) {
  props.store.updateCardConfig(partial);
  if (props.store.activeDocument.value) {
    emit('card-config-changed', { ...props.store.activeDocument.value.cardConfig });
  }
}

async function onQuickSave() {
  await props.store.saveActiveDocument();
}

function openSaveAsModal() {
  saveAsName.value = activeDoc.value?.name ? `${activeDoc.value.name} (Kopie)` : 'Mein Design';
  showSaveAsModal.value = true;
}

async function confirmSaveAs() {
  const trimmed = saveAsName.value.trim();
  if (!trimmed) return;
  const saved = await props.store.saveActiveDocument(trimmed);
  if (saved) {
    showSaveAsModal.value = false;
  }
}

async function openLoadModal() {
  await props.store.refreshDocumentCatalogs();
  showLoadModal.value = true;
}

function triggerBgFileSelect() {
  bgFileInputRef.value?.click();
}

async function onBgFileInputChange(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    await props.store.uploadBackgroundAsset(file);
  }
  input.value = '';
}

async function runGraphicExport() {
  const sg = sceneGraph.value;
  if (!sg || isExportingGraphic.value) return;
  isExportingGraphic.value = true;
  try {
    const lang = resolveLocale(locale.value) ?? FALLBACK_LOCALE;
    const svgRes = generateSceneGraphSvg(sg, {
      includeGrid: exportIncludeGrid.value,
      includeBackground: exportIncludeBg.value,
      onlyYears: exportOnlyYears.value,
      format: exportFormat.value,
      scale: exportScale.value,
      pdfPaperSize: exportPdfPaper.value,
      locale: lang,
    });

    const cleanName = (sg.documentName || 'stammbaum')
      .replace(/[^a-zA-Z0-9äöüÄÖÜß_-]+/g, '_')
      .slice(0, 64);

    const ext = exportFormat.value;
    const filterMap: Record<'svg' | 'pdf' | 'png' | 'jpg', { name: string; extensions: string[] }> = {
      svg: { name: 'Vektorgrafik (*.svg)', extensions: ['svg'] },
      pdf: { name: 'Druckbares PDF (*.pdf)', extensions: ['pdf'] },
      png: { name: 'PNG-Grafik (*.png)', extensions: ['png'] },
      jpg: { name: 'JPEG-Grafik (*.jpg)', extensions: ['jpg', 'jpeg'] },
    };

    const filePath = await save({
      title: `Stammbaum als ${ext.toUpperCase()} exportieren`,
      defaultPath: `${cleanName}.${ext}`,
      filters: [filterMap[ext]],
    });
    if (!filePath || typeof filePath !== 'string') return;

    if (ext === 'svg') {
      await invoke('save_design_file', { filePath, content: svgRes.svgString });
    } else if (ext === 'pdf') {
      const pdfBytes = await generateSceneGraphPdfBytes(
        svgRes.svgString,
        svgRes.width,
        svgRes.height,
        exportScale.value,
        exportPdfPaper.value
      );
      await invoke('save_binary_file', { filePath, data: Array.from(pdfBytes) });
    } else {
      const raster = await renderSceneSvgToRaster(
        svgRes.svgString,
        svgRes.width,
        svgRes.height,
        ext,
        exportScale.value
      );
      const buf = new Uint8Array(await raster.blob.arrayBuffer());
      await invoke('save_binary_file', { filePath, data: Array.from(buf) });
    }

    isExportPopoverOpen.value = false;
  } finally {
    isExportingGraphic.value = false;
  }
}

function openCryptoModal(tab: 'export' | 'import') {
  cryptoTab.value = tab;
  cryptoPassword.value = '';
  cryptoPasswordConfirm.value = '';
  cryptoImportPath.value = '';
  cryptoImportTreeName.value = '';
  cryptoLocalError.value = '';
  showCryptoModal.value = true;
}

async function pickLgprojFile() {
  const selected = await open({
    title: 'Verschlüsseltes Projektpaket auswählen (.lgproj)',
    multiple: false,
    filters: [{ name: 'Verschlüsseltes Projekt (*.lgproj)', extensions: ['lgproj'] }],
  });
  if (selected && typeof selected === 'string') {
    cryptoImportPath.value = selected;
    const base = selected.split(/[\\/]/).pop()?.replace(/\.lgproj$/i, '') || 'Import_Projekt';
    if (!cryptoImportTreeName.value) {
      cryptoImportTreeName.value = base;
    }
  }
}

async function executeCryptoAction() {
  cryptoLocalError.value = '';
  if (cryptoTab.value === 'export') {
    if (cryptoPassword.value.length < 4) {
      cryptoLocalError.value = 'Passwort muss mindestens 4 Zeichen lang sein.';
      return;
    }
    if (cryptoPassword.value !== cryptoPasswordConfirm.value) {
      cryptoLocalError.value = 'Passwörter stimmen nicht überein.';
      return;
    }
    isCryptoBusy.value = true;
    try {
      const ok = await props.store.exportEncryptedProjectPackage(cryptoPassword.value);
      if (ok) showCryptoModal.value = false;
    } finally {
      isCryptoBusy.value = false;
    }
  } else {
    if (!cryptoImportPath.value) {
      cryptoLocalError.value = 'Bitte zuerst eine .lgproj Datei auswählen.';
      return;
    }
    if (!cryptoImportTreeName.value.trim()) {
      cryptoLocalError.value = 'Bitte einen Ziel-Namen für den Stammbaum vergeben.';
      return;
    }
    if (!cryptoPassword.value) {
      cryptoLocalError.value = 'Bitte das Entschlüsselungs-Passwort eingeben.';
      return;
    }
    isCryptoBusy.value = true;
    try {
      const treeName = await props.store.importEncryptedProjectPackage(
        cryptoImportPath.value,
        cryptoImportTreeName.value.trim(),
        cryptoPassword.value
      );
      if (treeName) {
        showCryptoModal.value = false;
        emit('tree-imported', treeName);
      }
    } finally {
      isCryptoBusy.value = false;
    }
  }
}
</script>

<template>
  <div class="design-studio-header">
    <!-- Haupt-Werkzeugleiste -->
    <div class="design-toolbar" @click.stop>
      <!-- Spitzenahn -->
      <div class="tb-group">
        <label class="tb-label">Spitzenahn:</label>
        <select
          class="tb-select proband-select"
          :value="effectiveRootId"
          :disabled="isInSubtreeMode"
          :title="isInSubtreeMode ? 'Spitzenahn nur im Master-Stamm wechselbar' : 'Ausgangspunkt der Nachkommentafel'"
          @change="onProbandChange"
        >
          <option v-if="rootAncestors.length === 0" value="">– Bitte wählen –</option>
          <option
            v-for="ra in rootAncestors"
            :key="ra.person_id"
            :value="ra.person_id"
          >
            {{ personLabelById.get(ra.person_id) || ra.person_id }}
          </option>
        </select>
        <button
          type="button"
          class="tb-btn icon-only"
          title="Spitzenahn & Stammdaten verwalten"
          @click="emit('open-settings')"
        >
          ⚙️
        </button>
      </div>

      <div class="tb-divider"></div>

      <!-- Layout-Policies: Wuchsrichtung, Linie, Routing, Brücken, Raster -->
      <div v-if="activeDoc" class="tb-group">
        <div class="tb-segmented" title="Wuchsrichtung des Stammbaums">
          <button
            type="button"
            class="seg-btn"
            :class="{ active: activeDoc.growthDirection === 'bottom_up' }"
            @click="store.setGrowthDirection('bottom_up' as GrowthDirection)"
          >
            ↑ Unten→Oben
          </button>
          <button
            type="button"
            class="seg-btn"
            :class="{ active: activeDoc.growthDirection === 'top_down' }"
            @click="store.setGrowthDirection('top_down' as GrowthDirection)"
          >
            ↓ Oben→Unten
          </button>
        </div>

        <select
          class="tb-select"
          :value="activeDoc.lineagePolicy"
          title="Globale Implex-/Ahnenlinien-Priorität"
          @change="e => store.setLineagePolicy((e.target as HTMLSelectElement).value as LineagePolicy)"
        >
          <option value="patrilinear">Linie: Patrilinear</option>
          <option value="matrilinear">Linie: Matrilinear</option>
          <option value="oldest_branch">Linie: Ältester Zweig</option>
        </select>

        <select
          class="tb-select"
          :value="activeDoc.routingStyle"
          title="Routing-Strategie der Verbindungslinien"
          @change="e => store.setRoutingStyle((e.target as HTMLSelectElement).value as RoutingStyle)"
        >
          <option value="orthogonal_bus">Routing: Orthogonal</option>
          <option value="organic_bezier">Routing: Organisch (Kurven)</option>
        </select>

        <button
          v-if="activeDoc.routingStyle === 'orthogonal_bus'"
          type="button"
          class="tb-btn"
          :class="{ active: activeDoc.enableLineBridges }"
          title="Sprungbrücken an unvermeidbaren Kreuzungen zeichnen"
          @click="store.setEnableLineBridges(!activeDoc.enableLineBridges)"
        >
          ⌒ Brücken
        </button>

        <button
          type="button"
          class="tb-btn"
          :class="{ active: showLevelGrid }"
          title="Horizontales Generationen-Hilfsraster ein-/ausblenden"
          @click="store.showLevelGrid.value = !showLevelGrid"
        >
          ▤ Ebenen
        </button>

        <button
          type="button"
          class="tb-btn is-tool-split"
          :class="{ active: isSplitToolActive }"
          title="Gruppen-Trennwerkzeug: Zielstellen zwischen Kacheln und angedockten Gruppen zum Auftrennen einblenden"
          @click="store.toggleSplitTool()"
        >
          ✂️ Trennen
        </button>
      </div>

      <div class="tb-divider"></div>

      <!-- Kacheldichte & Felder Popover -->
      <div v-if="activeDoc" class="tb-group popover-anchor">
        <select
          class="tb-select"
          :value="activeDoc.cardDensityProfile"
          title="Kacheldichte & Platzbedarf"
          @change="e => store.setCardDensityProfile((e.target as HTMLSelectElement).value as CardDensityProfile)"
        >
          <option value="detail">Kachel: Detail (184px)</option>
          <option value="standard">Kachel: Standard (170px)</option>
          <option value="compact_years">Kachel: Nur Jahre (136px)</option>
          <option value="narrow">Kachel: Schmal (112px)</option>
        </select>

        <button
          type="button"
          class="tb-btn"
          :class="{ active: isCardPopoverOpen }"
          @click="toggleCardPopover"
        >
          🪪 Inhalte
        </button>

        <!-- Popover: Kachelfelder #1-#5 -->
        <div v-if="isCardPopoverOpen" class="tb-popover card-popover" @click.stop>
          <h4>Kachel-Inhalte & Typografie</h4>
          <div class="pop-grid">
            <label><input type="checkbox" :checked="activeDoc.cardConfig.showHenryId" @change="updateCardField({ showHenryId: !activeDoc.cardConfig.showHenryId })" /> #1 Henry-Code</label>
            <label><input type="checkbox" :checked="activeDoc.cardConfig.showGeneration" @change="updateCardField({ showGeneration: !activeDoc.cardConfig.showGeneration })" /> #1 Generation</label>
            <label><input type="checkbox" :checked="activeDoc.cardConfig.showBirthDate" @change="updateCardField({ showBirthDate: !activeDoc.cardConfig.showBirthDate })" /> * Geburtsdatum</label>
            <label><input type="checkbox" :checked="activeDoc.cardConfig.showBirthPlace" @change="updateCardField({ showBirthPlace: !activeDoc.cardConfig.showBirthPlace })" /> * Geburtsort</label>
            <label><input type="checkbox" :checked="activeDoc.cardConfig.showChrDate" @change="updateCardField({ showChrDate: !activeDoc.cardConfig.showChrDate })" /> ~ Taufdatum</label>
            <label><input type="checkbox" :checked="activeDoc.cardConfig.showChrPlace" @change="updateCardField({ showChrPlace: !activeDoc.cardConfig.showChrPlace })" /> ~ Taufort</label>
            <label><input type="checkbox" :checked="activeDoc.cardConfig.showDeathDate" @change="updateCardField({ showDeathDate: !activeDoc.cardConfig.showDeathDate })" /> † Sterbedatum</label>
            <label><input type="checkbox" :checked="activeDoc.cardConfig.showDeathPlace" @change="updateCardField({ showDeathPlace: !activeDoc.cardConfig.showDeathPlace })" /> † Sterbeort</label>
            <label><input type="checkbox" :checked="activeDoc.cardConfig.showOccupation" @change="updateCardField({ showOccupation: !activeDoc.cardConfig.showOccupation })" /> Beruf / Stand</label>
            <label><input type="checkbox" :checked="activeDoc.cardConfig.showOnlyYears" @change="updateCardField({ showOnlyYears: !activeDoc.cardConfig.showOnlyYears })" /> Nur Jahreszahlen</label>
            <label><input type="checkbox" :checked="activeDoc.cardConfig.dynamicCompactHeight !== false" @change="updateCardField({ dynamicCompactHeight: activeDoc.cardConfig.dynamicCompactHeight === false })" /> Kompakthöhe (Leere Zeilen sparen)</label>
          </div>
          <div class="pop-row-radio">
            <span>Lebensdaten:</span>
            <label><input type="radio" :checked="activeDoc.cardConfig.lifeDatesLayout === 'single'" @change="updateCardField({ lifeDatesLayout: 'single' })" /> Kompakt (1 Zeile)</label>
            <label><input type="radio" :checked="activeDoc.cardConfig.lifeDatesLayout === 'multi'" @change="updateCardField({ lifeDatesLayout: 'multi' })" /> Mehrzeilig</label>
          </div>
          <h5>Ehe & Partner (#4 & #5)</h5>
          <div class="pop-grid">
            <label><input type="checkbox" :checked="activeDoc.cardConfig.showSpouseName" @change="updateCardField({ showSpouseName: !activeDoc.cardConfig.showSpouseName })" /> Partner-Name</label>
            <label><input type="checkbox" :checked="activeDoc.cardConfig.showMarriageCounter" @change="updateCardField({ showMarriageCounter: !activeDoc.cardConfig.showMarriageCounter })" /> Ehenummer (1., 2.)</label>
            <label><input type="checkbox" :checked="activeDoc.cardConfig.showMarriageDate" @change="updateCardField({ showMarriageDate: !activeDoc.cardConfig.showMarriageDate })" /> Heiratsdatum</label>
            <label><input type="checkbox" :checked="activeDoc.cardConfig.showDivorce" @change="updateCardField({ showDivorce: !activeDoc.cardConfig.showDivorce })" /> Scheidung</label>
            <label><input type="checkbox" :checked="activeDoc.cardConfig.showSpouseBirthDate" @change="updateCardField({ showSpouseBirthDate: !activeDoc.cardConfig.showSpouseBirthDate })" /> Partner *</label>
            <label><input type="checkbox" :checked="activeDoc.cardConfig.showSpouseBirthPlace" @change="updateCardField({ showSpouseBirthPlace: !activeDoc.cardConfig.showSpouseBirthPlace })" /> Partner * Ort</label>
            <label><input type="checkbox" :checked="activeDoc.cardConfig.showSpouseDeathDate" @change="updateCardField({ showSpouseDeathDate: !activeDoc.cardConfig.showSpouseDeathDate })" /> Partner †</label>
            <label><input type="checkbox" :checked="activeDoc.cardConfig.showSpouseDeathPlace" @change="updateCardField({ showSpouseDeathPlace: !activeDoc.cardConfig.showSpouseDeathPlace })" /> Partner † Ort</label>
          </div>
          <h5>Zeilen-Stil (Fett / Kursiv)</h5>
          <div class="pop-typo-list">
            <div class="typo-row"><span>#1 Code</span><button type="button" :class="{ active: activeDoc.cardConfig.line1Bold }" @click="updateCardField({ line1Bold: !activeDoc.cardConfig.line1Bold })">B</button><button type="button" :class="{ active: activeDoc.cardConfig.line1Italic }" @click="updateCardField({ line1Italic: !activeDoc.cardConfig.line1Italic })">I</button></div>
            <div class="typo-row"><span>#2 Name</span><button type="button" :class="{ active: activeDoc.cardConfig.line2Bold }" @click="updateCardField({ line2Bold: !activeDoc.cardConfig.line2Bold })">B</button><button type="button" :class="{ active: activeDoc.cardConfig.line2Italic }" @click="updateCardField({ line2Italic: !activeDoc.cardConfig.line2Italic })">I</button></div>
            <div class="typo-row"><span>#3 Daten</span><button type="button" :class="{ active: activeDoc.cardConfig.line3Bold }" @click="updateCardField({ line3Bold: !activeDoc.cardConfig.line3Bold })">B</button><button type="button" :class="{ active: activeDoc.cardConfig.line3Italic }" @click="updateCardField({ line3Italic: !activeDoc.cardConfig.line3Italic })">I</button></div>
            <div class="typo-row"><span>#4 Partner</span><button type="button" :class="{ active: activeDoc.cardConfig.line4Bold }" @click="updateCardField({ line4Bold: !activeDoc.cardConfig.line4Bold })">B</button><button type="button" :class="{ active: activeDoc.cardConfig.line4Italic }" @click="updateCardField({ line4Italic: !activeDoc.cardConfig.line4Italic })">I</button></div>
            <div class="typo-row"><span>#5 P-Daten</span><button type="button" :class="{ active: activeDoc.cardConfig.line5Bold }" @click="updateCardField({ line5Bold: !activeDoc.cardConfig.line5Bold })">B</button><button type="button" :class="{ active: activeDoc.cardConfig.line5Italic }" @click="updateCardField({ line5Italic: !activeDoc.cardConfig.line5Italic })">I</button></div>
          </div>
        </div>
      </div>

      <!-- Hintergrundbild / Wappen (Aspect Ratio Geschützt) -->
      <div v-if="activeDoc" class="tb-group popover-anchor bg-tool-wrapper">
        <button
          type="button"
          class="tb-btn"
          :class="{ active: isBgPopoverOpen, 'has-dot': Boolean(activeDoc.bgAssetId) }"
          @click="toggleBgPopover"
        >
          🖼️ Wappen/Bild
        </button>

        <div v-if="isBgPopoverOpen" class="tb-popover bg-image-popover" @click.stop>
          <h4>Hintergrundbild (Seitenverhältnis gesperrt)</h4>
          <button type="button" class="file-upload-btn" @click.stop="triggerBgFileSelect">
            📁 Bild / Wappen in Projekt-DB laden…
          </button>
          <input
            ref="bgFileInputRef"
            type="file"
            accept="image/*"
            class="sr-hidden-file"
            @change="onBgFileInputChange"
          />
          <template v-if="activeDoc.bgAssetId">
            <label class="pop-check">
              <input
                type="checkbox"
                :checked="activeDoc.bgConfig.visible"
                @change="store.updateBackgroundConfig({ visible: !activeDoc.bgConfig.visible }, true)"
              />
              Sichtbar im Baum & Sub-Baum
            </label>
            <label class="pop-check">
              <input
                type="checkbox"
                :checked="activeDoc.bgConfig.locked === false"
                @change="store.updateBackgroundConfig({ locked: activeDoc.bgConfig.locked === false })"
              />
              {{ activeDoc.bgConfig.locked === false ? '🔓 Auf Canvas verschiebbar' : '🔒 Bild fixieren (entsperren zum Ziehen)' }}
            </label>
            <label class="pop-slider">
              <span>Größe: {{ activeDoc.bgConfig.scale }}%</span>
              <input
                type="range"
                min="20"
                max="300"
                :value="activeDoc.bgConfig.scale"
                @input="e => store.updateBackgroundConfig({ scale: Number((e.target as HTMLInputElement).value) })"
              />
            </label>
            <label class="pop-slider">
              <span>Deckkraft: {{ activeDoc.bgConfig.opacity }}%</span>
              <input
                type="range"
                min="5"
                max="100"
                :value="activeDoc.bgConfig.opacity"
                @input="e => store.updateBackgroundConfig({ opacity: Number((e.target as HTMLInputElement).value) })"
              />
            </label>
            <div class="pop-xy-row">
              <label>X: <input type="number" :value="activeDoc.bgConfig.x" @change="e => store.updateBackgroundConfig({ x: Number((e.target as HTMLInputElement).value) }, true)" /></label>
              <label>Y: <input type="number" :value="activeDoc.bgConfig.y" @change="e => store.updateBackgroundConfig({ y: Number((e.target as HTMLInputElement).value) }, true)" /></label>
            </div>
            <button type="button" class="pop-danger-btn" @click="store.removeBackgroundAsset()">
              🗑️ Bild entfernen
            </button>
          </template>
        </div>
      </div>

      <div class="tb-divider"></div>

      <!-- Undo / Redo / Reset / Ansicht -->
      <div class="tb-group">
        <button type="button" class="tb-btn icon-only" :disabled="!canUndo" title="Rückgängig (Strg+Z)" @click="store.undo()">↩</button>
        <button type="button" class="tb-btn icon-only" :disabled="!canRedo" title="Wiederholen (Strg+Y)" @click="store.redo()">↪</button>
        <button type="button" class="tb-btn" title="Layout auf Standardregeln zurücksetzen" @click="store.resetToDefaultLayout()">⟲ Reset</button>
        <button type="button" class="tb-btn" title="Auf Spitzenahn zentrieren" @click="centerOnOrigin">🎯</button>
        <button type="button" class="tb-btn" title="Kompletten Stammbaum einpassen" @click="fitToScreen">⛶ Fit</button>
      </div>

      <div class="tb-spacer"></div>

      <!-- Persistenz, Verschlüsselung & Druckbarer Export -->
      <div class="tb-group">
        <button
          type="button"
          class="tb-btn is-primary"
          :title="isDirty ? 'Änderungen in SQLite speichern' : 'Arbeitsstand speichern'"
          @click="onQuickSave"
        >
          💾 {{ isDirty ? 'Speichern*' : 'Speichern' }}
        </button>
        <button type="button" class="tb-btn" title="Unter neuem Namen speichern" @click="openSaveAsModal">
          Speichern als…
        </button>
        <button type="button" class="tb-btn" title="Arbeitsstände & Sub-Bäume laden / verwalten" @click="openLoadModal">
          📂 Laden
        </button>
        <button
          type="button"
          class="tb-btn is-secure"
          title="Vollständiges Projekt verschlüsselt teilen oder importieren (.lgproj AES-256)"
          @click="openCryptoModal('export')"
        >
          🔒 .lgproj
        </button>

        <div class="popover-anchor">
          <button
            type="button"
            class="tb-btn is-export"
            :class="{ active: isExportPopoverOpen }"
            @click="toggleExportPopover"
          >
            🖨️ Grafik-Export
          </button>

          <div v-if="isExportPopoverOpen" class="tb-popover export-popover">
            <h4>Druck- & Grafik-Export</h4>
            <div class="exp-format-row">
              <button
                v-for="fmt in (['svg', 'pdf', 'png', 'jpg'] as const)"
                :key="fmt"
                type="button"
                class="exp-fmt-btn"
                :class="{ active: exportFormat === fmt }"
                @click="exportFormat = fmt"
              >
                {{ fmt.toUpperCase() }}
              </button>
            </div>
            <label v-if="exportFormat === 'pdf'" class="pop-field">
              <span>Papierformat:</span>
              <select v-model="exportPdfPaper">
                <option value="auto">Auto (Szene exakt)</option>
                <option value="a4">DIN A4</option>
                <option value="a3">DIN A3</option>
                <option value="a2">DIN A2</option>
                <option value="a1">DIN A1</option>
                <option value="a0">DIN A0 (Poster)</option>
              </select>
            </label>
            <label v-if="exportFormat !== 'svg'" class="pop-field">
              <span>Auflösung:</span>
              <select v-model.number="exportScale">
                <option :value="1">1x (Standard)</option>
                <option :value="2">2x (Hochauflösend)</option>
                <option :value="3">3x (Druckqualität)</option>
                <option :value="4">4x (Archiv-Poster)</option>
              </select>
            </label>
            <label class="pop-check"><input type="checkbox" v-model="exportIncludeBg" /> Hintergrundbild einschließen</label>
            <label class="pop-check"><input type="checkbox" v-model="exportIncludeGrid" /> Ebenenraster drucken</label>
            <label class="pop-check"><input type="checkbox" v-model="exportOnlyYears" /> Nur Jahreszahlen (kompakt)</label>
            <button
              type="button"
              class="pop-primary-btn"
              :disabled="!sceneGraph || isExportingGraphic"
              @click="runGraphicExport"
            >
              {{ isExportingGraphic ? 'Erzeuge Datei…' : `Als ${exportFormat.toUpperCase()} speichern…` }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Konflikt-Banner bei parallelen Design-Änderungen -->
    <div v-if="hasExternalDesignConflict" class="design-conflict-banner" @click.stop>
      <span class="dcb-text">⚠️ {{ t('design_sync_conflict_banner') }}</span>
      <div class="dcb-actions">
        <button type="button" class="dcb-btn" @click="openSaveAsModal">
          {{ t('design_sync_save_copy') }}
        </button>
        <button
          type="button"
          class="dcb-btn"
          :disabled="props.store.isLoading.value"
          @click="props.store.reloadActiveFromDisk()"
        >
          {{ t('design_sync_reload_external') }}
        </button>
        <button
          type="button"
          class="dcb-btn danger"
          :disabled="props.store.isLoading.value"
          @click="props.store.forceOverwriteActiveDocument()"
        >
          {{ t('design_sync_overwrite_external') }}
        </button>
      </div>
    </div>

    <!-- Breadcrumbs (Schachtelung) & Hidden-Personen Bar -->
    <div v-if="isInSubtreeMode || hiddenPersonsCount > 0 || activeDoc" class="design-breadcrumbs" @click.stop>
      <div class="bc-trail">
        <span class="bc-prefix">Dokument:</span>
        <template v-for="(bc, idx) in breadcrumbs" :key="bc.documentId + '-' + idx">
          <span v-if="idx > 0" class="bc-sep">›</span>
          <button
            type="button"
            class="bc-item"
            :class="{ current: idx === breadcrumbs.length - 1 }"
            @click="store.navigateBreadcrumb(idx)"
          >
            {{ bc.documentKind === 'subtree' ? '🌿' : '🏛️' }} {{ bc.name }}
          </button>
        </template>
      </div>

      <div class="bc-meta">
        <button
          v-if="hiddenPersonsCount > 0"
          type="button"
          class="bc-unhide-btn"
          @click="store.unhideAllPersons()"
        >
          👁️ {{ hiddenPersonsCount }} ausgeblendete Kachel(n) wiederherstellen
        </button>
      </div>
    </div>

    <!-- Modal: Speichern unter -->
    <div v-if="showSaveAsModal" class="design-modal-backdrop" @click.self="showSaveAsModal = false">
      <div class="design-modal-card">
        <h3>Design-Arbeitsstand speichern unter</h3>
        <input
          v-model="saveAsName"
          type="text"
          class="modal-input"
          placeholder="Name des Arbeitsstands"
          @keyup.enter="confirmSaveAs"
        />
        <div class="modal-actions">
          <button type="button" class="m-btn" @click="showSaveAsModal = false">Abbrechen</button>
          <button type="button" class="m-btn primary" @click="confirmSaveAs">Speichern</button>
        </div>
      </div>
    </div>

    <!-- Modal: Arbeitsstände & Sub-Bäume Laden + JSON Austausch -->
    <div v-if="showLoadModal" class="design-modal-backdrop" @click.self="showLoadModal = false">
      <div class="design-modal-card wide">
        <div class="modal-header-row">
          <h3>Gespeicherte Arbeitsstände (SQLite & JSON)</h3>
          <div class="modal-file-btns">
            <button type="button" class="m-btn" @click="store.exportDesignToJsonFile()">📤 Als JSON</button>
            <button type="button" class="m-btn" @click="store.importDesignFromJsonFile(); showLoadModal = false">📥 JSON laden</button>
          </div>
        </div>

        <div class="catalog-columns">
          <div class="catalog-col">
            <h4>🏛️ Haupt-Stammbäume ({{ savedMasters.length }})</h4>
            <div v-if="savedMasters.length === 0" class="empty-cat">Noch keine gespeicherten Haupt-Designs für diesen Spitzenahn.</div>
            <div v-for="item in savedMasters" :key="item.id" class="catalog-row">
              <div class="cat-info">
                <strong>{{ item.name }}</strong>
                <small>{{ item.growth_direction === 'bottom_up' ? '↑ Bottom-Up' : '↓ Top-Down' }} · {{ item.lineage_policy }}</small>
              </div>
              <div class="cat-actions">
                <button type="button" class="m-btn primary" @click="store.loadDocumentById(item.id); showLoadModal = false">Laden</button>
                <button type="button" class="m-btn danger" @click="store.deleteSavedDocument(item.id)">✕</button>
              </div>
            </div>
          </div>

          <div class="catalog-col">
            <h4>🌿 Eigenständige Sub-Bäume ({{ savedSubtrees.length }})</h4>
            <div v-if="savedSubtrees.length === 0" class="empty-cat">Noch keine gespeicherten Sub-Bäume für diesen Stammahn.</div>
            <div v-for="sub in savedSubtrees" :key="sub.id" class="catalog-row">
              <div class="cat-info">
                <strong>
                  <span
                    v-if="store.getPersonHenryCode(sub.root_person_id)"
                    class="cat-henry-badge"
                  >[{{ store.getPersonHenryCode(sub.root_person_id) }}]</span>
                  {{ sub.name }}
                </strong>
                <small>
                  Stammahn-Henry: {{ store.getPersonHenryCode(sub.root_person_id) || '—' }} ·
                  Anker: {{ personLabelById.get(sub.root_person_id) || sub.root_person_id }}
                </small>
              </div>
              <div class="cat-actions">
                <button type="button" class="m-btn primary" @click="store.openSubtreeFromCatalog(sub.id); showLoadModal = false">Öffnen</button>
                <button type="button" class="m-btn danger" @click="store.deleteSavedDocument(sub.id)">✕</button>
              </div>
            </div>
          </div>
        </div>

        <div class="modal-actions">
          <button type="button" class="m-btn" @click="showLoadModal = false">Schließen</button>
        </div>
      </div>
    </div>

    <!-- Modal: Verschlüsseltes .lgproj Projekt (AES-256-GCM) -->
    <div v-if="showCryptoModal" class="design-modal-backdrop" @click.self="showCryptoModal = false">
      <div class="design-modal-card">
        <h3>🔒 Geschützter Projekt-Austausch (.lgproj)</h3>
        <p class="modal-desc">
          Enthält Personenstammdaten, Design-Regeln, Sub-Bäume und Wappen vollständig mit <strong>AES-256-GCM + PBKDF2</strong> verschlüsselt zur Weitergabe an Bearbeiter auf anderen Rechnern.
        </p>

        <div class="crypto-tabs">
          <button type="button" :class="{ active: cryptoTab === 'export' }" @click="cryptoTab = 'export'">📤 Projekt verschlüsselt exportieren</button>
          <button type="button" :class="{ active: cryptoTab === 'import' }" @click="cryptoTab = 'import'">📥 Projekt entschlüsseln & importieren</button>
        </div>

        <div v-if="cryptoTab === 'export'" class="crypto-form">
          <label>Passwort (mind. 4 Zeichen):</label>
          <input v-model="cryptoPassword" type="password" class="modal-input" placeholder="Passwort" />
          <label>Passwort wiederholen:</label>
          <input v-model="cryptoPasswordConfirm" type="password" class="modal-input" placeholder="Passwort bestätigen" />
        </div>

        <div v-else class="crypto-form">
          <label>.lgproj Datei:</label>
          <div class="file-row">
            <input :value="cryptoImportPath" type="text" readonly class="modal-input" placeholder="Datei auswählen…" />
            <button type="button" class="m-btn" @click="pickLgprojFile">Durchsuchen…</button>
          </div>
          <label>Neuer lokaler Stammbaum-Name:</label>
          <input v-model="cryptoImportTreeName" type="text" class="modal-input" placeholder="z. B. Chronik_Froning_Kopie" />
          <label>Entschlüsselungs-Passwort:</label>
          <input v-model="cryptoPassword" type="password" class="modal-input" placeholder="Passwort eingeben" />
        </div>

        <div v-if="cryptoLocalError" class="crypto-error">{{ cryptoLocalError }}</div>

        <div class="modal-actions">
          <button type="button" class="m-btn" @click="showCryptoModal = false">Abbrechen</button>
          <button type="button" class="m-btn primary" :disabled="isCryptoBusy" @click="executeCryptoAction">
            {{ isCryptoBusy ? 'Verarbeite…' : cryptoTab === 'export' ? 'Verschlüsselt speichern…' : 'Entschlüsseln & Importieren' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.design-studio-header {
  display: flex;
  flex-direction: column;
  z-index: 45;
  background: #ffffff;
  border-bottom: 1px solid #cbd5e1;
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.05);
}

.design-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
}

.tb-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.tb-label {
  font-size: 11px;
  font-weight: 700;
  color: #475569;
}

.tb-select {
  border: 1px solid #cbd5e1;
  background: #f8fafc;
  color: #0f172a;
  border-radius: 5px;
  padding: 4px 7px;
  font-size: 11.5px;
  font-weight: 600;
}

.proband-select {
  max-width: 175px;
}

.tb-divider {
  width: 1px;
  height: 22px;
  background: #e2e8f0;
  margin: 0 2px;
}

.tb-spacer {
  flex: 1;
}

.tb-segmented {
  display: inline-flex;
  border: 1px solid #cbd5e1;
  border-radius: 5px;
  overflow: hidden;
}

.seg-btn {
  border: none;
  background: #f8fafc;
  color: #334155;
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.seg-btn + .seg-btn {
  border-left: 1px solid #cbd5e1;
}
.seg-btn.active {
  background: #1e293b;
  color: #ffffff;
}

.tb-btn {
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #1e293b;
  border-radius: 5px;
  padding: 4px 9px;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.tb-btn:hover:not(:disabled) {
  background: #f1f5f9;
  border-color: #94a3b8;
}
.tb-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.tb-btn.icon-only {
  padding: 4px 7px;
}
.tb-btn.active {
  background: #eff6ff;
  border-color: #3b82f6;
  color: #1d4ed8;
}
.tb-btn.is-tool-split.active {
  background: #fef3c7;
  border-color: #d97706;
  color: #92400e;
}
.tb-btn.has-dot {
  border-color: #10b981;
}
.tb-btn.is-primary {
  background: #2563eb;
  border-color: #1d4ed8;
  color: #ffffff;
}
.tb-btn.is-primary:hover {
  background: #1d4ed8;
}
.tb-btn.is-secure {
  background: #fef3c7;
  border-color: #f59e0b;
  color: #92400e;
}
.tb-btn.is-export {
  background: #ecfdf5;
  border-color: #10b981;
  color: #065f46;
}

/* Popover */
.popover-anchor {
  position: relative;
}

.tb-popover {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 90;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 9px;
  padding: 12px;
  min-width: 280px;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.18);
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 12px;
}

.export-popover {
  left: auto;
  right: 0;
}

.card-popover {
  min-width: 340px;
}

.tb-popover h4 {
  margin: 0;
  font-size: 12.5px;
  color: #0f172a;
}

.tb-popover h5 {
  margin: 4px 0 0 0;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #64748b;
}

.pop-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px 10px;
}

.pop-grid label,
.pop-check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: #334155;
  cursor: pointer;
}

.pop-row-radio {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11.5px;
}

.pop-typo-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.typo-row {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
}
.typo-row span {
  flex: 1;
  color: #475569;
}
.typo-row button {
  width: 24px;
  height: 22px;
  border: 1px solid #cbd5e1;
  background: #f8fafc;
  border-radius: 4px;
  font-weight: 700;
  cursor: pointer;
}
.typo-row button.active {
  background: #1e293b;
  color: #ffffff;
}

.file-upload-btn {
  display: block;
  width: 100%;
  font-size: 11.5px;
  text-align: center;
  background: #eff6ff;
  border: 1px dashed #3b82f6;
  color: #1d4ed8;
  padding: 7px 10px;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
}

.sr-hidden-file {
  position: fixed;
  left: -9999px;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.pop-slider {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11.5px;
}

.pop-xy-row {
  display: flex;
  gap: 8px;
}
.pop-xy-row label {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 4px;
}
.pop-xy-row input {
  width: 70px;
  padding: 3px 5px;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
}

.pop-danger-btn {
  border: 1px solid #fecaca;
  background: #fef2f2;
  color: #b91c1c;
  padding: 5px 8px;
  border-radius: 5px;
  font-weight: 600;
  cursor: pointer;
}

.exp-format-row {
  display: flex;
  gap: 4px;
}

.exp-fmt-btn {
  flex: 1;
  border: 1px solid #cbd5e1;
  background: #f8fafc;
  padding: 5px 0;
  border-radius: 5px;
  font-size: 11.5px;
  font-weight: 700;
  cursor: pointer;
}
.exp-fmt-btn.active {
  background: #0f172a;
  border-color: #0f172a;
  color: #ffffff;
}

.pop-field {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
}
.pop-field select {
  border: 1px solid #cbd5e1;
  border-radius: 5px;
  padding: 3px 6px;
}

.pop-primary-btn {
  border: none;
  background: #059669;
  color: #ffffff;
  border-radius: 6px;
  padding: 7px 12px;
  font-weight: 700;
  cursor: pointer;
}
.pop-primary-btn:hover:not(:disabled) {
  background: #047857;
}
.pop-primary-btn:disabled {
  opacity: 0.5;
}

/* Breadcrumbs */
.design-breadcrumbs {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 12px;
  background: #f8fafc;
  border-top: 1px solid #e2e8f0;
  font-size: 11.5px;
}

.bc-trail {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
}

.bc-prefix {
  color: #64748b;
  font-weight: 600;
}

.bc-sep {
  color: #94a3b8;
  font-weight: 700;
}

.bc-item {
  border: 1px solid #e2e8f0;
  background: #ffffff;
  color: #334155;
  border-radius: 999px;
  padding: 1px 9px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.bc-item.current {
  background: #ede9fe;
  border-color: #c4b5fd;
  color: #5b21b6;
}

.bc-unhide-btn {
  border: 1px solid #fdba74;
  background: #fff7ed;
  color: #c2410c;
  border-radius: 999px;
  padding: 1px 9px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

/* Modals */
.design-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  z-index: 120;
  display: flex;
  align-items: center;
  justify-content: center;
}

.design-modal-card {
  background: #ffffff;
  border-radius: 10px;
  padding: 18px 20px;
  width: 440px;
  max-width: 92vw;
  max-height: 86vh;
  overflow-y: auto;
  box-shadow: 0 20px 44px rgba(15, 23, 42, 0.3);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.design-modal-card.wide {
  width: 760px;
}

.design-modal-card h3 {
  margin: 0;
  font-size: 15px;
  color: #0f172a;
}

.modal-desc {
  margin: 0;
  font-size: 12px;
  color: #475569;
  line-height: 1.45;
}

.modal-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.modal-file-btns {
  display: flex;
  gap: 6px;
}

.modal-input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 13px;
}

.catalog-columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.catalog-col {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.catalog-col h4 {
  margin: 0;
  font-size: 12.5px;
  color: #334155;
}

.empty-cat {
  font-size: 11.5px;
  color: #64748b;
  font-style: italic;
}

.catalog-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 7px 9px;
}

.cat-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.cat-info strong {
  font-size: 12px;
  color: #0f172a;
}
.cat-info small {
  font-size: 10.5px;
  color: #64748b;
}

.cat-henry-badge {
  display: inline-block;
  margin-right: 4px;
  padding: 0 5px;
  border-radius: 4px;
  background: #ede9fe;
  color: #5b21b6;
  font-family: monospace;
  font-size: 10.5px;
  font-weight: 700;
}

.cat-actions {
  display: flex;
  gap: 4px;
}

.crypto-tabs {
  display: flex;
  gap: 6px;
}
.crypto-tabs button {
  flex: 1;
  border: 1px solid #cbd5e1;
  background: #f8fafc;
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
}
.crypto-tabs button.active {
  background: #0f172a;
  color: #ffffff;
  border-color: #0f172a;
}

.crypto-form {
  display: flex;
  flex-direction: column;
  gap: 7px;
  font-size: 12px;
}

.file-row {
  display: flex;
  gap: 6px;
}

.crypto-error {
  background: #fef2f2;
  color: #b91c1c;
  border: 1px solid #fecaca;
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 11.5px;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

.m-btn {
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #1e293b;
  border-radius: 6px;
  padding: 5px 11px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.m-btn.primary {
  background: #2563eb;
  border-color: #1d4ed8;
  color: #ffffff;
}
.m-btn.danger {
  color: #dc2626;
  border-color: #fecaca;
}

.design-conflict-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 14px;
  background: #fffbeb;
  border-bottom: 1px solid #fde68a;
  font-size: 12px;
  color: #92400e;
  z-index: 25;
}

.dcb-text {
  font-weight: 600;
}

.dcb-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.dcb-btn {
  border: 1px solid #d97706;
  background: #ffffff;
  color: #92400e;
  border-radius: 5px;
  padding: 3px 9px;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
}

.dcb-btn:hover:not(:disabled) {
  background: #fef3c7;
}

.dcb-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.dcb-btn.danger {
  border-color: #dc2626;
  color: #b91c1c;
}

.dcb-btn.danger:hover:not(:disabled) {
  background: #fee2e2;
}
</style>
