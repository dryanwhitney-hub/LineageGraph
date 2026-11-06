<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { computeCardHeight, formatLocalizedDate, type DesignCardConfig } from '../../types/design';
import { useAppUpdater } from '../../composables/useAppUpdater';
import type {
  Person,
  ColumnConfig,
  RootAncestorConfig,
} from '../../composables/usePersons';

export type SettingsTab = 'general' | 'table_view' | 'tree_view' | 'design_mode' | 'about';

export interface DesignConfigState {
  horizontalLaneGap: number;
  autoSubLanes: boolean;
  enableLineBridges: boolean;
  bridgeRadius: number;
  minimizeBridges: boolean;
  cardConfig: DesignCardConfig;
}

defineProps<{
  visible: boolean;
  activeTab: SettingsTab;
  trees: string[];
  activeTree: string;
  newTreeName: string;
  columns: ColumnConfig[];
  rootAncestors: RootAncestorConfig[];
  filteredPersons: Person[];
  selectedRootId: string;
  newRootCode: string;
  rootSearchQuery: string;
  designConfig: DesignConfigState;
  getColLabel: (col: ColumnConfig) => string;
  moveColumn: (index: number, direction: 'up' | 'down') => void;
}>();

const emit = defineEmits<{
  close: [];
  'update:activeTab': [tab: SettingsTab];
  'update:activeTree': [tree: string];
  'update:newTreeName': [name: string];
  'update:selectedRootId': [id: string];
  'update:newRootCode': [code: string];
  'update:rootSearchQuery': [query: string];
  'switch-tree': [];
  'start-delete-tree': [];
  'create-tree': [];
  'add-root-ancestor': [];
  'remove-root-ancestor': [personId: string];
  'calculate-codes': [];
}>();

const { t, locale } = useI18n();

const {
  currentVersion,
  isChecking,
  isDownloading,
  newVersion,
  statusMessage,
  statusType,
  checkForUpdates,
  loadCurrentVersion,
} = useAppUpdater();

onMounted(() => {
  loadCurrentVersion();
});

async function openExternalUrl(url: string) {
  try {
    await openUrl(url);
  } catch {
    if (url.startsWith('mailto:')) {
      window.location.href = url;
    } else {
      window.open(url, '_blank');
    }
  }
}

async function openUserGuide() {
  try {
    await invoke('open_user_guide');
  } catch {
    await openExternalUrl('https://github.com/dryanwhitney-hub/LineageGraph/blob/main/USER_GUIDE.md');
  }
}

const showColDropdown = ref<boolean>(false);
const showDetailAttrDropdown = ref<boolean>(false);
const isCardConfigExpanded = ref<boolean>(true);
const isDesignSectionExpanded = ref<boolean>(false);

function onTreeSelectChange(event: Event) {
  const val = (event.target as HTMLSelectElement).value;
  emit('update:activeTree', val);
  emit('switch-tree');
}
</script>

<template>
  <div v-if="visible" class="modal-overlay" @click.self="emit('close')">
    <div class="modal-content settings-modal-content settings-layout-split">
      <div class="settings-modal-header-row">
        <h2>⚙️ {{ t('settings') }}</h2>
        <button class="btn-close-icon" @click="emit('close')">✕</button>
      </div>

      <div class="settings-split-body">
        <!-- Linker Bereich: Navigation / Auswahl der Bereiche -->
        <div class="settings-nav-sidebar">
          <button
            class="settings-nav-item"
            :class="{ active: activeTab === 'general' || activeTab === 'tree_view' }"
            @click="emit('update:activeTab', 'general')"
          >
            🌐 {{ t('settings_tab_general') || 'Allgemein' }}
          </button>
          <button
            class="settings-nav-item"
            :class="{ active: activeTab === 'table_view' }"
            @click="emit('update:activeTab', 'table_view')"
          >
            📋 {{ t('settings_tab_table') || 'Tabellarische Ansicht' }}
          </button>
          <button
            class="settings-nav-item"
            :class="{ active: activeTab === 'design_mode' }"
            @click="emit('update:activeTab', 'design_mode')"
          >
            📐 {{ t('settings_tab_design') || 'Stammbaum Design Mode' }}
          </button>
          <button
            class="settings-nav-item settings-nav-item-bottom"
            :class="{ active: activeTab === 'about' }"
            @click="emit('update:activeTab', 'about')"
          >
            ℹ️ {{ t('settings_tab_about') || 'Über LineageGraph' }}
          </button>
        </div>

        <!-- Rechter Bereich: Inhalt des ausgewählten Bereichs -->
        <div class="settings-main-pane">
          <!-- 1. Allgemein (inkl. Auswahl & Konfiguration der Probanden) -->
          <div v-if="activeTab === 'general' || activeTab === 'tree_view'" class="settings-tab-pane">
            <div class="settings-section">
              <h3>{{ t('tree_management') }}</h3>
              <label>{{ t('active_tree') }}:</label>
              <div v-if="trees.length > 0 && activeTree" class="d-flex align-items-center mb-1">
                <select :value="activeTree" @change="onTreeSelectChange" class="flex-grow">
                  <option v-for="tree in trees" :key="tree" :value="tree">{{ tree }}</option>
                </select>
                <button
                  class="btn-danger btn-delete-tree"
                  @click="emit('start-delete-tree')"
                  :title="t('delete_tree')"
                >
                  🗑️ {{ t('delete_tree') }}
                </button>
              </div>
              <div v-else class="no-active-tree mb-1">
                {{ t('no_active_tree') }}
              </div>
              <label>{{ t('new_tree') }}:</label>
              <div class="d-flex">
                <input
                  :value="newTreeName"
                  @input="emit('update:newTreeName', ($event.target as HTMLInputElement).value)"
                  :placeholder="t('new_tree_placeholder')"
                  class="flex-grow"
                />
                <button @click="emit('create-tree')">{{ t('create_btn') }}</button>
              </div>
            </div>

            <div class="settings-section">
              <h3>{{ t('root_ancestor_config') }}</h3>
              <div class="proband-list-box mb-1">
                <label><strong>{{ t('proband_list') }}:</strong></label>
                <ul v-if="rootAncestors.length > 0" class="proband-list">
                  <li v-for="r in rootAncestors" :key="r.person_id">
                    <span class="proband-info">
                      [{{ r.starting_code }}] {{ r.surname || 'N.N.' }}, {{ r.given_name || 'N.N.' }}
                      <small>({{ r.person_id }})</small>
                    </span>
                    <button
                      class="btn-sm btn-danger"
                      @click="emit('remove-root-ancestor', r.person_id)"
                    >
                      {{ t('remove') }}
                    </button>
                  </li>
                </ul>
                <div v-else class="sub-empty mt-1">{{ t('no_probands') }}</div>
              </div>
              <label><strong>{{ t('add_proband') }}:</strong></label>
              <input
                :value="rootSearchQuery"
                @input="emit('update:rootSearchQuery', ($event.target as HTMLInputElement).value)"
                :placeholder="t('search_placeholder')"
                class="w-100 mt-1 mb-1"
              />
              <select
                :value="selectedRootId"
                @change="emit('update:selectedRootId', ($event.target as HTMLSelectElement).value)"
                class="w-100 mb-1"
                size="4"
              >
                <option v-for="p in filteredPersons" :key="p.id" :value="p.id">
                  {{ p.surname || 'N.N.' }}, {{ p.given_name || 'N.N.' }} ({{ p.id }})
                </option>
              </select>
              <div class="d-flex align-items-center mt-1">
                <input
                  :value="newRootCode"
                  @input="emit('update:newRootCode', ($event.target as HTMLInputElement).value)"
                  :placeholder="t('starting_code')"
                  class="flex-grow"
                />
                <button
                  @click="emit('add-root-ancestor')"
                  :disabled="!selectedRootId || !newRootCode"
                >
                  {{ t('add_btn') }}
                </button>
              </div>
              <button
                class="mt-1 btn-full btn-calculate"
                @click="emit('calculate-codes')"
                :disabled="rootAncestors.length === 0"
              >
                {{ t('calc_codes_btn') }}
              </button>
            </div>
          </div>

          <!-- 2. Tabellarische Ansicht -->
          <div v-if="activeTab === 'table_view'" class="settings-tab-pane">
            <div class="settings-section">
              <h3>{{ t('table_col_config') }}</h3>
              <div class="custom-multi-select">
                <div class="select-header" @click="showColDropdown = !showColDropdown">
                  {{ t('select_table_cols') }} ({{ columns.filter(c => c.visible).length }} /
                  {{ columns.length }}) <span style="float: right">▼</span>
                </div>
                <div class="select-dropdown" v-if="showColDropdown">
                  <div v-for="(col, index) in columns" :key="col.key" class="select-item">
                    <label>
                      <input type="checkbox" v-model="col.visible" />
                      {{ getColLabel(col) }}
                      <small v-if="!col.editable" class="readonly-hint">(schreibgeschützt)</small>
                    </label>
                    <div class="order-btns">
                      <button @click.stop="moveColumn(index, 'up')" :disabled="index === 0">
                        ▲
                      </button>
                      <button
                        @click.stop="moveColumn(index, 'down')"
                        :disabled="index === columns.length - 1"
                      >
                        ▼
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="settings-section">
              <h3>{{ t('detail_attr_config') }}</h3>
              <div class="custom-multi-select">
                <div class="select-header" @click="showDetailAttrDropdown = !showDetailAttrDropdown">
                  {{ t('select_detail_attrs') }} ({{ columns.filter(c => c.detailVisible).length }} /
                  {{ columns.length }}) <span style="float: right">▼</span>
                </div>
                <div class="select-dropdown" v-if="showDetailAttrDropdown">
                  <div v-for="(col, index) in columns" :key="'det-cfg-' + col.key" class="select-item">
                    <label>
                      <input type="checkbox" v-model="col.detailVisible" />
                      {{ getColLabel(col) }}
                      <small v-if="!col.editable" class="readonly-hint">(schreibgeschützt)</small>
                    </label>
                    <div class="order-btns">
                      <button @click.stop="moveColumn(index, 'up')" :disabled="index === 0">
                        ▲
                      </button>
                      <button
                        @click.stop="moveColumn(index, 'down')"
                        :disabled="index === columns.length - 1"
                      >
                        ▼
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 3. Stammbaum Design Mode -->
          <div v-if="activeTab === 'design_mode'" class="settings-tab-pane design-expandables-container">
            <!-- Expandable Section 1: Kachel-Informationen & Zeilenformatierung -->
            <div class="expandable-section" :class="{ 'is-expanded': isCardConfigExpanded }">
              <button
                type="button"
                class="expandable-header"
                @click="isCardConfigExpanded = !isCardConfigExpanded"
              >
                <div class="expandable-header-left">
                  <span class="expandable-icon">🗂️</span>
                  <div class="expandable-titles">
                    <span class="expandable-title">{{ t('design_card_config_title') || 'Kachel-Informationen & Zeilenformatierung' }}</span>
                    <span class="expandable-subtitle">{{ t('design_card_config_subtitle') || 'Definieren Sie, welche Angaben in den Kacheln der Einträge im Design Mode abgebildet werden, und formatieren Sie jede Zeile individuell.' }}</span>
                  </div>
                </div>
                <span class="expandable-chevron">{{ isCardConfigExpanded ? '▼' : '▶' }}</span>
              </button>

              <div v-if="isCardConfigExpanded" class="expandable-body">
                <div
                  class="card-config-wrapper"
                  style="display: flex; gap: 20px; align-items: flex-start; flex-wrap: wrap;"
                >
                <!-- Linke Spalte: Zeilen #1 bis #5 Konfiguration -->
                <div
                  class="card-config-lines"
                  style="flex: 1; min-width: 280px; display: flex; flex-direction: column; gap: 10px;"
                >
                  <!-- Zeile #1: Henry-Identifikation -->
                  <div class="line-config-card">
                    <div class="line-config-header">
                      <span class="line-title">#1 {{ t('design_line_1_title') }}</span>
                      <div class="format-toggles">
                        <button
                          type="button"
                          class="fmt-btn"
                          :class="{ active: designConfig.cardConfig.line1Bold }"
                          @click="designConfig.cardConfig.line1Bold = !designConfig.cardConfig.line1Bold"
                          :title="t('design_format_bold')"
                        >
                          <b>B</b>
                        </button>
                        <button
                          type="button"
                          class="fmt-btn"
                          :class="{ active: designConfig.cardConfig.line1Italic }"
                          @click="designConfig.cardConfig.line1Italic = !designConfig.cardConfig.line1Italic"
                          :title="t('design_format_italic')"
                        >
                          <i>I</i>
                        </button>
                      </div>
                    </div>
                    <div class="line-config-options line-grid-2col">
                      <label class="cfg-checkbox-label">
                        <input type="checkbox" v-model="designConfig.cardConfig.showHenryId" />
                        <span>{{ t('design_cfg_henry') }}</span>
                      </label>
                      <label class="cfg-checkbox-label">
                        <input type="checkbox" v-model="designConfig.cardConfig.showGeneration" />
                        <span>{{ t('design_cfg_generation') }}</span>
                      </label>
                    </div>
                  </div>

                  <!-- Zeile #2: Name (mandatory) -->
                  <div class="line-config-card">
                    <div class="line-config-header">
                      <span class="line-title">#2 {{ t('design_line_2_title') }}</span>
                      <div class="format-toggles">
                        <button
                          type="button"
                          class="fmt-btn"
                          :class="{ active: designConfig.cardConfig.line2Bold }"
                          @click="designConfig.cardConfig.line2Bold = !designConfig.cardConfig.line2Bold"
                          :title="t('design_format_bold')"
                        >
                          <b>B</b>
                        </button>
                        <button
                          type="button"
                          class="fmt-btn"
                          :class="{ active: designConfig.cardConfig.line2Italic }"
                          @click="designConfig.cardConfig.line2Italic = !designConfig.cardConfig.line2Italic"
                          :title="t('design_format_italic')"
                        >
                          <i>I</i>
                        </button>
                      </div>
                    </div>
                    <div class="line-config-options">
                      <label class="cfg-checkbox-label">
                        <input type="checkbox" checked disabled />
                        <span><strong>{{ t('design_cfg_given_name_only') }}</strong></span>
                      </label>
                    </div>
                  </div>

                  <!-- Zeile #3: Lebensdaten & Orte -->
                  <div class="line-config-card">
                    <div class="line-config-header">
                      <span class="line-title">#3 {{ t('design_line_3_title') }}</span>
                      <div class="format-toggles">
                        <button
                          type="button"
                          class="fmt-btn"
                          :class="{ active: designConfig.cardConfig.line3Bold }"
                          @click="designConfig.cardConfig.line3Bold = !designConfig.cardConfig.line3Bold"
                          :title="t('design_format_bold')"
                        >
                          <b>B</b>
                        </button>
                        <button
                          type="button"
                          class="fmt-btn"
                          :class="{ active: designConfig.cardConfig.line3Italic }"
                          @click="designConfig.cardConfig.line3Italic = !designConfig.cardConfig.line3Italic"
                          :title="t('design_format_italic')"
                        >
                          <i>I</i>
                        </button>
                      </div>
                    </div>
                    <!-- Layout-Wahl: In eine Zeile vs. einzelne Zeilen -->
                    <div
                      class="layout-mode-selector mb-1"
                      style="display: flex; align-items: center; gap: 14px; font-size: 0.78rem; background: #ffffff; padding: 5px 8px; border-radius: 4px; border: 1px solid #e2e8f0;"
                    >
                      <span style="font-weight: 600; color: #475569;">{{ t('design_cfg_life_layout') }}</span>
                      <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                        <input type="radio" value="single" v-model="designConfig.cardConfig.lifeDatesLayout" />
                        <span>{{ t('design_cfg_life_single') }}</span>
                      </label>
                      <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                        <input type="radio" value="multi" v-model="designConfig.cardConfig.lifeDatesLayout" />
                        <span>{{ t('design_cfg_life_multi') }}</span>
                      </label>
                    </div>
                    <div class="line-config-options line-grid-2col">
                      <label
                        class="cfg-checkbox-label"
                        style="grid-column: 1 / -1; margin-bottom: 4px; padding: 4px 6px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px;"
                      >
                        <input type="checkbox" v-model="designConfig.cardConfig.showOnlyYears" />
                        <span>
                          <strong>📅 {{ t('design_cfg_only_years') }}</strong> —
                          <small style="color: #64748b;">{{ t('design_cfg_only_years_desc') }}</small>
                        </span>
                      </label>
                      <label class="cfg-checkbox-label">
                        <input
                          type="checkbox"
                          v-model="designConfig.cardConfig.showBirthDate"
                          @change="!designConfig.cardConfig.showBirthDate && (designConfig.cardConfig.showBirthPlace = false)"
                        />
                        <span>{{ t('design_cfg_birth_date') }}</span>
                      </label>
                      <label
                        class="cfg-checkbox-label"
                        :style="{
                          opacity: designConfig.cardConfig.showBirthDate ? 1 : 0.45,
                          cursor: designConfig.cardConfig.showBirthDate ? 'pointer' : 'not-allowed',
                        }"
                      >
                        <input
                          type="checkbox"
                          v-model="designConfig.cardConfig.showBirthPlace"
                          :disabled="!designConfig.cardConfig.showBirthDate"
                        />
                        <span>{{ t('design_cfg_birth_place') }}</span>
                      </label>
                      <label class="cfg-checkbox-label">
                        <input
                          type="checkbox"
                          v-model="designConfig.cardConfig.showChrDate"
                          @change="!designConfig.cardConfig.showChrDate && (designConfig.cardConfig.showChrPlace = false)"
                        />
                        <span>{{ t('design_cfg_chr_date') }}</span>
                      </label>
                      <label
                        class="cfg-checkbox-label"
                        :style="{
                          opacity: designConfig.cardConfig.showChrDate ? 1 : 0.45,
                          cursor: designConfig.cardConfig.showChrDate ? 'pointer' : 'not-allowed',
                        }"
                      >
                        <input
                          type="checkbox"
                          v-model="designConfig.cardConfig.showChrPlace"
                          :disabled="!designConfig.cardConfig.showChrDate"
                        />
                        <span>{{ t('design_cfg_chr_place') }}</span>
                      </label>
                      <label class="cfg-checkbox-label">
                        <input
                          type="checkbox"
                          v-model="designConfig.cardConfig.showDeathDate"
                          @change="!designConfig.cardConfig.showDeathDate && (designConfig.cardConfig.showDeathPlace = false)"
                        />
                        <span>{{ t('design_cfg_death_date') }}</span>
                      </label>
                      <label
                        class="cfg-checkbox-label"
                        :style="{
                          opacity: designConfig.cardConfig.showDeathDate ? 1 : 0.45,
                          cursor: designConfig.cardConfig.showDeathDate ? 'pointer' : 'not-allowed',
                        }"
                      >
                        <input
                          type="checkbox"
                          v-model="designConfig.cardConfig.showDeathPlace"
                          :disabled="!designConfig.cardConfig.showDeathDate"
                        />
                        <span>{{ t('design_cfg_death_place') }}</span>
                      </label>
                    </div>
                  </div>

                  <!-- Zeile #4: Ehe & Partner -->
                  <div class="line-config-card">
                    <div class="line-config-header">
                      <span class="line-title">#4 {{ t('design_line_4_title') }}</span>
                      <div class="format-toggles">
                        <button
                          type="button"
                          class="fmt-btn"
                          :class="{ active: designConfig.cardConfig.line4Bold }"
                          @click="designConfig.cardConfig.line4Bold = !designConfig.cardConfig.line4Bold"
                          :title="t('design_format_bold')"
                        >
                          <b>B</b>
                        </button>
                        <button
                          type="button"
                          class="fmt-btn"
                          :class="{ active: designConfig.cardConfig.line4Italic }"
                          @click="designConfig.cardConfig.line4Italic = !designConfig.cardConfig.line4Italic"
                          :title="t('design_format_italic')"
                        >
                          <i>I</i>
                        </button>
                      </div>
                    </div>
                    <div class="line-config-options line-grid-2col">
                      <label class="cfg-checkbox-label">
                        <input type="checkbox" v-model="designConfig.cardConfig.showMarriageCounter" />
                        <span>{{ t('design_cfg_marriage_counter') }}</span>
                      </label>
                      <label class="cfg-checkbox-label">
                        <input type="checkbox" v-model="designConfig.cardConfig.showMarriageDate" />
                        <span>{{ t('design_cfg_marriage_date') }}</span>
                      </label>
                      <label class="cfg-checkbox-label" style="grid-column: span 2;">
                        <input type="checkbox" v-model="designConfig.cardConfig.showSpouseName" />
                        <span>{{ t('design_cfg_spouse_name') }}</span>
                      </label>
                    </div>
                  </div>

                  <!-- Zeile #5: Partner-Details & Scheidung -->
                  <div class="line-config-card">
                    <div class="line-config-header">
                      <span class="line-title">#5 {{ t('design_line_5_title') }}</span>
                      <div class="format-toggles">
                        <button
                          type="button"
                          class="fmt-btn"
                          :class="{ active: designConfig.cardConfig.line5Bold }"
                          @click="designConfig.cardConfig.line5Bold = !designConfig.cardConfig.line5Bold"
                          :title="t('design_format_bold')"
                        >
                          <b>B</b>
                        </button>
                        <button
                          type="button"
                          class="fmt-btn"
                          :class="{ active: designConfig.cardConfig.line5Italic }"
                          @click="designConfig.cardConfig.line5Italic = !designConfig.cardConfig.line5Italic"
                          :title="t('design_format_italic')"
                        >
                          <i>I</i>
                        </button>
                      </div>
                    </div>
                    <div class="line-config-options line-grid-2col">
                      <label class="cfg-checkbox-label">
                        <input
                          type="checkbox"
                          v-model="designConfig.cardConfig.showSpouseBirthDate"
                          @change="!designConfig.cardConfig.showSpouseBirthDate && (designConfig.cardConfig.showSpouseBirthPlace = false)"
                        />
                        <span>{{ t('design_cfg_spouse_birth_date') }}</span>
                      </label>
                      <label
                        class="cfg-checkbox-label"
                        :style="{
                          opacity: designConfig.cardConfig.showSpouseBirthDate ? 1 : 0.45,
                          cursor: designConfig.cardConfig.showSpouseBirthDate ? 'pointer' : 'not-allowed',
                        }"
                      >
                        <input
                          type="checkbox"
                          v-model="designConfig.cardConfig.showSpouseBirthPlace"
                          :disabled="!designConfig.cardConfig.showSpouseBirthDate"
                        />
                        <span>{{ t('design_cfg_spouse_birth_place') }}</span>
                      </label>
                      <label class="cfg-checkbox-label">
                        <input
                          type="checkbox"
                          v-model="designConfig.cardConfig.showSpouseDeathDate"
                          @change="!designConfig.cardConfig.showSpouseDeathDate && (designConfig.cardConfig.showSpouseDeathPlace = false)"
                        />
                        <span>{{ t('design_cfg_spouse_death_date') }}</span>
                      </label>
                      <label
                        class="cfg-checkbox-label"
                        :style="{
                          opacity: designConfig.cardConfig.showSpouseDeathDate ? 1 : 0.45,
                          cursor: designConfig.cardConfig.showSpouseDeathDate ? 'pointer' : 'not-allowed',
                        }"
                      >
                        <input
                          type="checkbox"
                          v-model="designConfig.cardConfig.showSpouseDeathPlace"
                          :disabled="!designConfig.cardConfig.showSpouseDeathDate"
                        />
                        <span>{{ t('design_cfg_spouse_death_place') }}</span>
                      </label>
                      <label class="cfg-checkbox-label" style="grid-column: span 2;">
                        <input type="checkbox" v-model="designConfig.cardConfig.showDivorce" />
                        <span>{{ t('design_cfg_divorce') }}</span>
                      </label>
                    </div>
                  </div>
                </div>

                <!-- Rechte Spalte: Live Preview Kachel -->
                <div
                  class="card-preview-pane"
                  style="width: 200px; display: flex; flex-direction: column; align-items: center; gap: 8px;"
                >
                  <div style="font-weight: bold; font-size: 0.85rem; color: #1e293b;">
                    {{ t('design_preview_title') }}
                  </div>
                  <div
                    class="preview-tile-container"
                    :style="{ width: '150px', minHeight: computeCardHeight(designConfig.cardConfig, 2) + 'px' }"
                  >
                    <!-- #1 -->
                    <div
                      v-if="designConfig.cardConfig.showHenryId || designConfig.cardConfig.showGeneration"
                      class="preview-line-1"
                      :style="{
                        fontWeight: designConfig.cardConfig.line1Bold ? 'bold' : 'normal',
                        fontStyle: designConfig.cardConfig.line1Italic ? 'italic' : 'normal',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }"
                    >
                      <span v-if="designConfig.cardConfig.showHenryId" class="d-henry-badge">[121]</span>
                      <span v-else></span>
                      <span v-if="designConfig.cardConfig.showGeneration" class="d-gen-badge">Gen. 3</span>
                    </div>
                    <!-- #2 Name -->
                    <div
                      class="preview-line-2 preview-card-name"
                      :style="{
                        fontWeight: designConfig.cardConfig.line2Bold ? 'bold' : 'normal',
                        fontStyle: designConfig.cardConfig.line2Italic ? 'italic' : 'normal',
                      }"
                    >
                      Maximilian Mustermann
                    </div>
                    <!-- #3 Life -->
                    <div
                      v-if="
                        designConfig.cardConfig.showBirthDate ||
                        designConfig.cardConfig.showChrDate ||
                        designConfig.cardConfig.showDeathDate
                      "
                      class="preview-line-3"
                      :class="{ 'is-single-line': designConfig.cardConfig.lifeDatesLayout === 'single' }"
                      :style="{
                        fontWeight: designConfig.cardConfig.line3Bold ? 'bold' : 'normal',
                        fontStyle: designConfig.cardConfig.line3Italic ? 'italic' : 'normal',
                      }"
                    >
                      <span v-if="designConfig.cardConfig.showBirthDate" class="preview-date-item">
                        * {{ formatLocalizedDate('1875-05-12', locale)
                        }}<span v-if="designConfig.cardConfig.showBirthPlace"> (Berlin)</span>
                      </span>
                      <span v-if="designConfig.cardConfig.showChrDate" class="preview-date-item">
                        ~ {{ formatLocalizedDate('1875-05-20', locale)
                        }}<span v-if="designConfig.cardConfig.showChrPlace"> (Berlin)</span>
                      </span>
                      <span v-if="designConfig.cardConfig.showDeathDate" class="preview-date-item">
                        † {{ formatLocalizedDate('1942-11-03', locale)
                        }}<span v-if="designConfig.cardConfig.showDeathPlace"> (Hamburg)</span>
                      </span>
                    </div>
                    <!-- #4 & #5 Marriage -->
                    <div
                      v-if="
                        designConfig.cardConfig.showMarriageCounter ||
                        designConfig.cardConfig.showMarriageDate ||
                        designConfig.cardConfig.showSpouseName ||
                        designConfig.cardConfig.showSpouseBirthDate ||
                        designConfig.cardConfig.showSpouseDeathDate ||
                        designConfig.cardConfig.showDivorce
                      "
                      class="preview-marriages-block"
                    >
                      <div class="preview-marriage-entry">
                        <div class="preview-spouse-status-col">
                          <span v-if="designConfig.cardConfig.showMarriageCounter" class="d-marriage-counter"
                            >(1)</span
                          >
                          <span
                            class="preview-spouse-status-icon"
                            :class="designConfig.cardConfig.showDivorce ? 'is-divorced' : 'is-married'"
                            :title="designConfig.cardConfig.showDivorce ? t('divorced') : t('married')"
                          >
                            {{ designConfig.cardConfig.showDivorce ? '⚮' : '⚭' }}
                          </span>
                        </div>

                        <div class="preview-spouse-details-col">
                          <div
                            v-if="designConfig.cardConfig.showSpouseName || designConfig.cardConfig.showHenryId"
                            class="preview-spouse-name-row"
                            :style="{
                              fontWeight: designConfig.cardConfig.line4Bold ? 'bold' : 'normal',
                              fontStyle: designConfig.cardConfig.line4Italic ? 'italic' : 'normal',
                            }"
                          >
                            <span v-if="designConfig.cardConfig.showSpouseName" class="d-spouse-name"
                              >Anna Schmidt</span
                            >
                            <span v-if="designConfig.cardConfig.showHenryId" class="d-spouse-henry">[214]</span>
                          </div>

                          <div
                            v-if="
                              designConfig.cardConfig.showMarriageDate ||
                              designConfig.cardConfig.showDivorce ||
                              designConfig.cardConfig.showSpouseBirthDate ||
                              designConfig.cardConfig.showSpouseDeathDate
                            "
                            class="preview-spouse-dates-row"
                            :class="{
                              'preview-spouse-dates-multi': designConfig.cardConfig.lifeDatesLayout === 'multi',
                            }"
                          >
                            <span
                              v-if="designConfig.cardConfig.showMarriageDate"
                              class="nowrap-date preview-marriage-date"
                              :style="{
                                fontWeight: designConfig.cardConfig.line4Bold ? 'bold' : 'normal',
                                fontStyle: designConfig.cardConfig.line4Italic ? 'italic' : 'normal',
                              }"
                            >
                              oo {{ formatLocalizedDate('1901-08-20', locale)
                              }}<span
                                v-if="
                                  designConfig.cardConfig.lifeDatesLayout === 'single' &&
                                  (designConfig.cardConfig.showDivorce ||
                                    designConfig.cardConfig.showSpouseBirthDate ||
                                    designConfig.cardConfig.showSpouseDeathDate)
                                "
                                >,
                              </span>
                            </span>
                            <span
                              v-if="designConfig.cardConfig.showDivorce"
                              class="d-divorce-badge nowrap-date"
                              :style="{
                                fontWeight: designConfig.cardConfig.line4Bold ? 'bold' : 'normal',
                                fontStyle: designConfig.cardConfig.line4Italic ? 'italic' : 'normal',
                              }"
                            >
                              o|o {{ formatLocalizedDate('1920', locale)
                              }}<span
                                v-if="
                                  designConfig.cardConfig.lifeDatesLayout === 'single' &&
                                  (designConfig.cardConfig.showSpouseBirthDate ||
                                    designConfig.cardConfig.showSpouseDeathDate)
                                "
                                >,
                              </span>
                            </span>
                            <span
                              v-if="designConfig.cardConfig.showSpouseBirthDate"
                              class="nowrap-date"
                              :style="{
                                fontWeight: designConfig.cardConfig.line5Bold ? 'bold' : 'normal',
                                fontStyle: designConfig.cardConfig.line5Italic ? 'italic' : 'normal',
                              }"
                            >
                              * {{ formatLocalizedDate('1878-03-15', locale)
                              }}<span v-if="designConfig.cardConfig.showSpouseBirthPlace"> (Potsdam)</span
                              ><span
                                v-if="
                                  designConfig.cardConfig.lifeDatesLayout === 'single' &&
                                  designConfig.cardConfig.showSpouseDeathDate
                                "
                                >,
                              </span>
                            </span>
                            <span
                              v-if="designConfig.cardConfig.showSpouseDeathDate"
                              class="nowrap-date"
                              :style="{
                                fontWeight: designConfig.cardConfig.line5Bold ? 'bold' : 'normal',
                                fontStyle: designConfig.cardConfig.line5Italic ? 'italic' : 'normal',
                              }"
                            >
                              † {{ formatLocalizedDate('1955-01-22', locale)
                              }}<span v-if="designConfig.cardConfig.showSpouseDeathPlace"> (Hamburg)</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Expandable Section 2: Design -->
            <div class="expandable-section" :class="{ 'is-expanded': isDesignSectionExpanded }">
              <button
                type="button"
                class="expandable-header"
                @click="isDesignSectionExpanded = !isDesignSectionExpanded"
              >
                <div class="expandable-header-left">
                  <span class="expandable-icon">🎨</span>
                  <div class="expandable-titles">
                    <span class="expandable-title">{{ t('design_section_design_title') || 'Design' }}</span>
                    <span class="expandable-subtitle">{{ t('design_section_design_subtitle') || 'Verbindungslinien, Querlinien-Abstände und Linienbrücken bei Kreuzungen konfigurieren.' }}</span>
                  </div>
                </div>
                <span class="expandable-chevron">{{ isDesignSectionExpanded ? '▼' : '▶' }}</span>
              </button>

              <div v-if="isDesignSectionExpanded" class="expandable-body">
                <h4
                  style="margin: 0 0 8px 0; font-size: 0.95rem; color: #1e293b; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px;"
                >
                  📏 {{ t('design_lines_config_title') || 'Verbindungslinien & Querlinien' }}
                </h4>
                <p class="section-desc" style="color: #64748b; font-size: 0.82rem; margin-bottom: 0.85rem;">
                  Konfiguration der Mindestabstände und automatischen Höhenstaffelung für die horizontale Querlinienführung im Design Mode.
                </p>

                <div
                  class="config-field mb-2"
                  style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px;"
                >
                  <label class="d-block mb-1" style="font-size: 0.88rem;">
                    <strong>{{ t('design_lane_gap_label') || 'Mindestabstand horizontaler Abschnitte (Querlinien):' }}</strong>
                    <span
                      class="badge-val"
                      style="background: #2563eb; color: white; padding: 2px 6px; border-radius: 4px; font-weight: bold; margin-left: 6px; font-size: 0.8rem;"
                      >{{ designConfig.horizontalLaneGap }} px</span
                    >
                  </label>
                  <div class="d-flex align-items-center" style="gap: 12px; margin-top: 6px;">
                    <input
                      type="range"
                      min="10"
                      max="36"
                      step="2"
                      v-model.number="designConfig.horizontalLaneGap"
                      class="flex-grow"
                    />
                    <input
                      type="number"
                      min="10"
                      max="50"
                      v-model.number="designConfig.horizontalLaneGap"
                      style="width: 65px; padding: 4px; border: 1px solid #cbd5e1; border-radius: 4px;"
                    />
                  </div>
                  <small style="color: #64748b; font-size: 0.76rem; display: block; margin-top: 6px;">
                    Definiert den vertikalen Abstand zwischen horizontalen Verbindungslinien verschiedener Geschwistergruppen.
                  </small>
                </div>

                <div
                  class="config-field"
                  style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px;"
                >
                  <label class="d-flex align-items-center" style="gap: 8px; cursor: pointer; font-size: 0.88rem;">
                    <input type="checkbox" v-model="designConfig.autoSubLanes" style="cursor: pointer;" />
                    <strong>{{ t('design_auto_sublanes_label') || 'Automatisch neue Ebenen für horizontale Querlinien hinzufügen' }}</strong>
                  </label>
                  <small style="color: #64748b; font-size: 0.76rem; display: block; margin-top: 6px; padding-left: 22px;">
                    Wenn ausreichend vertikaler Platz zwischen den Generationen vorhanden ist, werden dynamisch weitere Höhenebenen bereitgestellt, damit Querlinien verschiedener Geschwistergruppen sich nicht überdecken.
                  </small>
                </div>

                <!-- Bereich Linienbrücken & Kreuzungen -->
                <h4
                  style="margin: 18px 0 10px 0; font-size: 0.95rem; color: #1e293b; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px;"
                >
                  🌉 {{ t('design_bridges_config_title') || 'Linienbrücken & Kreuzungen' }}
                </h4>

                <div
                  class="config-field mb-2"
                  style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px;"
                >
                  <label class="d-flex align-items-center" style="gap: 8px; cursor: pointer; font-size: 0.88rem;">
                    <input type="checkbox" v-model="designConfig.enableLineBridges" style="cursor: pointer;" />
                    <strong>{{ t('design_enable_bridges_label') || 'Linienbrücken bei Kreuzungen anzeigen' }}</strong>
                  </label>
                  <small style="color: #64748b; font-size: 0.76rem; display: block; margin-top: 6px; padding-left: 22px;">
                    Zeigt an Kreuzungspunkten sichtbare Bogenbrücken, damit überkreuzende Verbindungslinien deutlich unterscheidbar bleiben.
                  </small>
                </div>

                <div
                  v-if="designConfig.enableLineBridges"
                  class="config-field mb-2"
                  style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px;"
                >
                  <label class="d-block mb-1" style="font-size: 0.88rem;">
                    <strong>{{ t('design_bridge_radius_label') || 'Linienbrücken-Bogenradius:' }}</strong>
                    <span
                      class="badge-val"
                      style="background: #8e44ad; color: white; padding: 2px 6px; border-radius: 4px; font-weight: bold; margin-left: 6px; font-size: 0.8rem;"
                      >{{ designConfig.bridgeRadius }} px</span
                    >
                  </label>
                  <div class="d-flex align-items-center" style="gap: 12px; margin-top: 6px;">
                    <input
                      type="range"
                      min="4"
                      max="20"
                      step="1"
                      v-model.number="designConfig.bridgeRadius"
                      class="flex-grow"
                    />
                    <input
                      type="number"
                      min="4"
                      max="24"
                      v-model.number="designConfig.bridgeRadius"
                      style="width: 65px; padding: 4px; border: 1px solid #cbd5e1; border-radius: 4px;"
                    />
                  </div>
                  <small style="color: #64748b; font-size: 0.76rem; display: block; margin-top: 6px;">
                    Bestimmt die Wölbungshöhe und Spannweite des Bogens an Linienkreuzungen.
                  </small>
                </div>

                <div
                  class="config-field"
                  style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px;"
                >
                  <label class="d-flex align-items-center" style="gap: 8px; cursor: pointer; font-size: 0.88rem;">
                    <input type="checkbox" v-model="designConfig.minimizeBridges" style="cursor: pointer;" />
                    <strong>{{ t('design_minimize_bridges_label') || 'Ebenen-Anordnung der Querlinien optimieren (Linienbrücken minimieren)' }}</strong>
                  </label>
                  <small style="color: #64748b; font-size: 0.76rem; display: block; margin-top: 6px; padding-left: 22px;">
                    {{ t('design_minimize_bridges_hint') || 'Ordnet die horizontalen Abschnitte der Verbindungslinien automatisch so an, dass möglichst wenige Schnittpunkte mit vertikalen Verbindungslinien entstehen.' }}
                  </small>
                </div>
              </div>
            </div>
          </div>

          <!-- 4. Über LineageGraph & App-Aktualisierung -->
          <div v-if="activeTab === 'about'" class="settings-tab-pane about-tab-pane">
            <div class="about-container">
              <div class="about-hero">
                <img src="/icon_dark.png" alt="LineageGraph Logo" class="about-logo" />
                <div class="about-hero-info">
                  <h3 class="about-app-title">LineageGraph</h3>
                  <p class="about-app-subtitle">{{ t('about_app_subtitle') }}</p>
                  <span class="about-version-badge">v{{ currentVersion || '0.2.2' }}</span>
                </div>
              </div>

              <div class="about-info-grid">
                <!-- 1. Entwickler & Kontakt (Zusammengeführte Kachel) -->
                <div class="about-info-card about-dev-card">
                  <span class="about-info-label">{{ t('about_developer_contact') }}</span>
                  <span class="about-info-value font-bold">{{ t('about_developer_name') }}</span>
                  <a
                    href="mailto:lineagegraph@gmail.com"
                    class="about-contact-link"
                    @click.prevent="openExternalUrl('mailto:lineagegraph@gmail.com')"
                    :title="t('about_contact_tooltip')"
                  >
                    ✉️ {{ t('about_contact_email') }}
                  </a>
                </div>

                <!-- 2. Technologie-Stack -->
                <div class="about-info-card">
                  <span class="about-info-label">{{ t('about_technology') }}</span>
                  <span class="about-info-value">{{ t('about_tech_stack') }}</span>
                </div>

                <!-- 3. Lizenz -->
                <div class="about-info-card">
                  <span class="about-info-label">{{ t('about_license') }}</span>
                  <span class="about-info-value">{{ t('about_license_name') }}</span>
                </div>

                <!-- 4. Speicherung & Privatsphäre (Offline-First) -->
                <div class="about-info-card">
                  <span class="about-info-label">{{ t('about_storage_privacy') }}</span>
                  <span class="about-info-value">{{ t('about_storage_privacy_desc') }}</span>
                </div>
              </div>

              <!-- Quick Links: Anwenderhandbuch, GitHub Repository & Issue Tracker -->
              <div class="about-links-row">
                <button
                  type="button"
                  class="btn-about-link btn-about-guide"
                  @click="openUserGuide"
                  :title="t('about_link_guide_tooltip')"
                >
                  📖 {{ t('about_link_guide') }}
                </button>
                <a
                  href="https://github.com/dryanwhitney-hub/LineageGraph"
                  class="btn-about-link"
                  @click.prevent="openExternalUrl('https://github.com/dryanwhitney-hub/LineageGraph')"
                  :title="t('about_link_repo_tooltip')"
                >
                  🐙 {{ t('about_link_repo') }}
                </a>
                <a
                  href="https://github.com/dryanwhitney-hub/LineageGraph/issues"
                  class="btn-about-link"
                  @click.prevent="openExternalUrl('https://github.com/dryanwhitney-hub/LineageGraph/issues')"
                  :title="t('about_link_issues_tooltip')"
                >
                  🐛 {{ t('about_link_issues') }}
                </a>
              </div>

              <div class="about-update-card">
                <div class="about-update-header">
                  <div class="about-update-text">
                    <h4>🔄 {{ t('about_updates_title') }}</h4>
                    <p class="about-update-hint">
                      {{ t('updater_current_version') }}: <strong>v{{ currentVersion || '0.2.2' }}</strong>
                    </p>
                  </div>
                  <button
                    class="btn-updater-check"
                    :disabled="isChecking || isDownloading"
                    @click="checkForUpdates(true)"
                  >
                    <span v-if="isChecking">⏳ {{ t('updater_checking') }}</span>
                    <span v-else>🔍 {{ t('updater_check_btn') }}</span>
                  </button>
                </div>

                <div v-if="statusType === 'up-to-date'" class="updater-feedback success">
                  ✅ {{ t('updater_up_to_date') }}
                </div>
                <div v-else-if="statusType === 'offline'" class="updater-feedback warning">
                  ⚠️ {{ t('updater_offline') }}
                </div>
                <div v-else-if="statusType === 'update-available'" class="updater-feedback info">
                  🚀 {{ t('updater_modal_desc', { version: newVersion }) }}
                </div>
                <div
                  v-else-if="statusType === 'error'"
                  class="updater-feedback"
                  :class="statusMessage === 'no_release_manifest' ? 'info' : 'error'"
                >
                  <span v-if="statusMessage === 'no_release_manifest'">
                    ℹ️ {{ t('updater_error_no_release') }}
                  </span>
                  <span v-else>
                    ❌ {{ t('updater_error', { error: statusMessage }) }}
                  </span>
                </div>
              </div>

              <!-- Copyright & Datenschutzhinweis -->
              <div class="about-footer-meta">
                <p class="about-copyright">{{ t('about_copyright') }}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="settings-footer-row">
        <button class="btn-close" @click="emit('close')">{{ t('close') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal-content {
  background: white;
  padding: 2rem;
  border-radius: 8px;
  width: 450px;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
}
.modal-content h2 {
  margin-top: 0;
  color: #2c3e50;
  border-bottom: 2px solid #ecf0f1;
  padding-bottom: 0.5rem;
  font-size: 1.1rem;
}
.w-100 {
  width: 100%;
  padding: 0.4rem;
  border: 1px solid #bdc3c7;
  border-radius: 3px;
  box-sizing: border-box;
}
.mt-1 {
  margin-top: 1rem;
  display: inline-block;
}
.mb-1 {
  margin-bottom: 0.5rem;
  display: inline-block;
}
.d-flex {
  display: flex;
  gap: 0.5rem;
}
.align-items-center {
  align-items: center;
}
.flex-grow {
  flex-grow: 1;
  padding: 0.4rem;
  border: 1px solid #bdc3c7;
  border-radius: 3px;
}
button {
  padding: 0.5rem 1rem;
  background-color: #3498db;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-weight: bold;
}
button:hover:not(:disabled) {
  background-color: #2980b9;
}
button:disabled {
  background-color: #95a5a6;
  cursor: not-allowed;
}
.settings-section {
  margin-top: 1.5rem;
  background: #f8f9fa;
  padding: 1rem;
  border-radius: 4px;
  border: 1px solid #e9ecef;
}
.settings-section:first-child {
  margin-top: 0;
}
.settings-section h3 {
  margin-top: 0;
  font-size: 1rem;
  color: #34495e;
}
.btn-full {
  width: 100%;
  margin-top: 1rem;
}
.btn-calculate {
  background-color: #e67e22;
}
.btn-close {
  width: 100%;
  background-color: #7f8c8d;
}
.proband-list-box {
  background: white;
  border: 1px solid #bdc3c7;
  border-radius: 4px;
  padding: 0.5rem;
  max-height: 150px;
  overflow-y: auto;
  width: 100%;
  box-sizing: border-box;
}
.proband-list {
  list-style: none;
  padding: 0;
  margin: 0.5rem 0 0 0;
}
.proband-list li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.4rem 0;
  border-bottom: 1px solid #ecf0f1;
  font-size: 0.85rem;
}
.proband-info {
  flex-grow: 1;
}
.btn-sm {
  padding: 0.2rem 0.5rem;
  font-size: 0.75rem;
}
.btn-danger {
  background-color: #e74c3c;
}
.btn-danger:hover:not(:disabled) {
  background-color: #c0392b;
}
.btn-delete-tree {
  white-space: nowrap;
  margin-left: 0.5rem;
}
.no-active-tree {
  padding: 0.5rem 0.75rem;
  background: #ecf0f1;
  color: #7f8c8d;
  border: 1px dashed #bdc3c7;
  border-radius: 4px;
  font-style: italic;
  font-size: 0.9rem;
}

/* Custom Multi-Select Dropdown */
.custom-multi-select {
  position: relative;
  width: 100%;
}
.select-header {
  padding: 0.5rem;
  text-align: left;
  background: white;
  border: 1px solid #bdc3c7;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
}
.select-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  width: 100%;
  background: white;
  border: 1px solid #bdc3c7;
  border-radius: 4px;
  margin-top: 4px;
  z-index: 100;
  max-height: 260px;
  overflow-y: auto;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}
.select-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.4rem 0.8rem;
  border-bottom: 1px solid #ecf0f1;
  font-size: 0.85rem;
}
.select-item:last-child {
  border-bottom: none;
}
.readonly-hint {
  color: #95a5a6;
  margin-left: 4px;
  font-style: italic;
}
.order-btns button {
  background: #7f8c8d;
  padding: 2px 6px;
  font-size: 0.6rem;
  margin-left: 4px;
  color: white;
  border: none;
  border-radius: 3px;
  cursor: pointer;
}

/* Settings Modal mit linker Navigationsleiste */
.settings-modal-content.settings-layout-split {
  width: 90vw;
  max-width: 860px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
}
.settings-modal-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 20px;
  background: #f8fafc;
  border-bottom: 1px solid #cbd5e1;
}
.settings-modal-header-row h2 {
  margin: 0;
  font-size: 1.15rem;
  border-bottom: none;
  padding-bottom: 0;
}
.btn-close-icon {
  background: none;
  border: none;
  font-size: 1.2rem;
  color: #64748b;
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 4px;
}
.btn-close-icon:hover {
  background: #e2e8f0;
  color: #0f172a;
}
.settings-split-body {
  display: flex;
  flex-grow: 1;
  min-height: 420px;
  overflow: hidden;
}
.settings-nav-sidebar {
  width: 220px;
  background: #f1f5f9;
  border-right: 1px solid #cbd5e1;
  display: flex;
  flex-direction: column;
  padding: 10px 8px;
  gap: 4px;
  flex-shrink: 0;
}
.settings-nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: #334155;
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
  transition: all 0.15s ease;
}
.settings-nav-item:hover {
  background: #e2e8f0;
  color: #0f172a;
}
.settings-nav-item.active {
  background: #ffffff;
  color: #2563eb;
  border-color: #cbd5e1;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.settings-main-pane {
  flex-grow: 1;
  padding: 20px;
  overflow-y: auto;
  background: #ffffff;
}
.settings-footer-row {
  display: flex;
  justify-content: flex-end;
  padding: 12px 20px;
  background: #f8fafc;
  border-top: 1px solid #cbd5e1;
}

/* Konfiguration Kachelinhalte im Design-Mode */
.line-config-card {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 8px 12px;
}
.line-config-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
  border-bottom: 1px solid #e2e8f0;
  padding-bottom: 4px;
}
.line-title {
  font-weight: 700;
  font-size: 0.84rem;
  color: #1e293b;
}
.format-toggles {
  display: flex;
  gap: 4px;
}
.fmt-btn {
  width: 24px;
  height: 22px;
  padding: 0;
  font-size: 0.75rem;
  border: 1px solid #cbd5e1;
  border-radius: 3px;
  background: #ffffff;
  color: #475569;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.12s ease;
}
.fmt-btn:hover {
  background: #f1f5f9;
  border-color: #94a3b8;
}
.fmt-btn.active {
  background: #2563eb;
  color: #ffffff;
  border-color: #1d4ed8;
}
.line-config-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
}
.line-grid-2col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px 12px;
}
.cfg-checkbox-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
  color: #334155;
  cursor: pointer;
}
.cfg-checkbox-label input {
  cursor: pointer;
}
.preview-tile-container {
  background: #ffffff;
  border: 2px solid #1e293b;
  border-bottom: 3px solid #2980b9;
  border-radius: 4px;
  padding: 5px 6px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: 2px;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.08);
}
.preview-line-1 {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.65rem;
  min-height: 16px;
}
.preview-card-name {
  font-size: 0.78rem;
  color: #1e293b;
  white-space: normal;
  word-break: break-word;
  overflow-wrap: break-word;
  text-align: center;
  line-height: 1.25;
  margin: 3px 0;
}
.preview-line-3 {
  font-size: 0.64rem;
  color: #475569;
  text-align: center;
  line-height: 1.2;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.preview-marriages-block {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 2px;
  border-top: 1px dashed #cbd5e1;
  padding-top: 2px;
}
.preview-marriage-entry {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 4px;
  line-height: 1.2;
}
.preview-spouse-status-col {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  padding-top: 1px;
}
.preview-spouse-status-icon {
  font-size: 0.78rem;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #475569;
  user-select: none;
}
.preview-spouse-status-icon.is-divorced {
  color: #c0392b;
}
.preview-spouse-details-col {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  flex-grow: 1;
  min-width: 0;
  text-align: left;
}
.preview-spouse-name-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px;
  font-size: 0.66rem;
  color: #1e293b;
  line-height: 1.2;
}
.preview-spouse-dates-row {
  font-size: 0.65rem;
  color: #475569;
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px;
  line-height: 1.2;
}
.preview-spouse-dates-row.preview-spouse-dates-multi {
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
}
.d-divorce-badge {
  color: #c0392b;
}

/* Expandable Sections im Stammbaum Design Mode */
.design-expandables-container {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.expandable-section {
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  overflow: hidden;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.expandable-section.is-expanded {
  border-color: #94a3b8;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06);
}
.expandable-header {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  background: #f8fafc;
  color: #1e293b;
  border: none;
  border-radius: 0;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease;
}
.expandable-header:hover {
  background: #f1f5f9 !important;
}
.expandable-section.is-expanded .expandable-header {
  background: #f1f5f9;
  border-bottom: 1px solid #e2e8f0;
}
.expandable-header-left {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}
.expandable-icon {
  font-size: 1.15rem;
  line-height: 1.3;
  flex-shrink: 0;
}
.expandable-titles {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.expandable-title {
  font-size: 0.96rem;
  font-weight: 700;
  color: #1e293b;
}
.expandable-subtitle {
  font-size: 0.78rem;
  font-weight: 400;
  color: #64748b;
  line-height: 1.35;
}
.expandable-chevron {
  font-size: 0.82rem;
  color: #475569;
  flex-shrink: 0;
  padding: 2px 6px;
}
.expandable-body {
  padding: 16px;
  background: #ffffff;
}

/* App Updater in Settings */
.settings-nav-item-bottom {
  margin-top: auto !important;
  border-top: 1px solid #cbd5e1 !important;
  padding-top: 12px !important;
}

/* About / Über LineageGraph Tab */
.about-tab-pane {
  display: flex;
  flex-direction: column;
}
.about-container {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  max-width: 600px;
  margin: 0 auto;
  width: 100%;
  padding: 10px 0;
}
.about-hero {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  background: linear-gradient(135deg, #f8fafc 0%, #edf2f7 100%);
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 1.5rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}
.about-logo {
  width: 80px;
  height: 80px;
  border-radius: 16px;
  object-fit: cover;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22);
  background: #1a1d22;
  border: 1px solid #334155;
  padding: 0;
}
.about-hero-info {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.about-app-title {
  margin: 0;
  font-size: 1.5rem;
  color: #1e293b;
  font-weight: 700;
}
.about-app-subtitle {
  margin: 0;
  font-size: 0.95rem;
  color: #64748b;
}
.about-version-badge {
  display: inline-block;
  align-self: flex-start;
  background: #dbeafe;
  color: #1d4ed8;
  font-family: monospace;
  font-weight: 700;
  font-size: 0.85rem;
  padding: 0.2rem 0.6rem;
  border-radius: 4px;
}
.about-info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 1rem;
}
.about-info-card {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.about-info-label {
  font-size: 0.75rem;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
}
.about-info-value {
  font-size: 0.95rem;
  color: #1e293b;
}
.about-contact-link {
  color: #2563eb;
  text-decoration: none;
  font-weight: 600;
  font-size: 0.88rem;
  word-break: break-all;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: color 0.15s ease;
  cursor: pointer;
}
.about-contact-link:hover {
  color: #1d4ed8;
  text-decoration: underline;
}
.font-bold {
  font-weight: 600;
}
.about-dev-card {
  border-left: 3px solid #2563eb;
}
.about-links-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.btn-about-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0.45rem 0.85rem;
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  color: #334155;
  font-size: 0.82rem;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn-about-link:hover {
  background: #e2e8f0;
  color: #0f172a;
  border-color: #94a3b8;
}
.btn-about-guide {
  background: #eff6ff;
  color: #1d4ed8;
  border-color: #bfdbfe;
}
.btn-about-guide:hover {
  background: #dbeafe;
  color: #1e40af;
  border-color: #93c5fd;
}
.about-footer-meta {
  text-align: center;
  padding-top: 0.5rem;
}
.about-copyright {
  margin: 0;
  font-size: 0.78rem;
  color: #94a3b8;
  line-height: 1.4;
}
.about-update-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 1.25rem;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.03);
}
.about-update-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.about-update-text h4 {
  margin: 0;
  font-size: 1.05rem;
  color: #1e293b;
}
.about-update-hint {
  margin: 0.25rem 0 0 0;
  font-size: 0.85rem;
  color: #64748b;
}
.updater-control-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  background: #f8fafc;
  padding: 0.75rem 1rem;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
}
.updater-version-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.95rem;
  color: #334155;
}
.version-tag {
  background: #e2e8f0;
  color: #1e293b;
  font-family: monospace;
  font-weight: 600;
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  font-size: 0.85rem;
}
.btn-updater-check {
  padding: 0.45rem 1rem;
  background: #2563eb;
  color: #ffffff;
  border: none;
  border-radius: 4px;
  font-weight: 600;
  font-size: 0.85rem;
  cursor: pointer;
  transition: background 0.15s;
}
.btn-updater-check:hover:not(:disabled) {
  background: #1d4ed8;
}
.btn-updater-check:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.updater-feedback {
  margin-top: 0.75rem;
  padding: 0.6rem 0.8rem;
  border-radius: 6px;
  font-size: 0.85rem;
  line-height: 1.4;
}
.updater-feedback.success {
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  color: #166534;
}
.updater-feedback.warning {
  background: #fffbeb;
  border: 1px solid #fde68a;
  color: #92400e;
}
.updater-feedback.info {
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  color: #1e40af;
}
.updater-feedback.error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
}
</style>

