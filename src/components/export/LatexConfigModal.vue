<script setup lang="ts">
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  generateSampleLatexPreview,
  LATEX_VARIABLE_DEFINITIONS,
  type LatexTemplateConfig,
  type LatexTemplateEntry,
} from '../../utils/latexExport';

const props = defineProps<{
  show: boolean;
  template: LatexTemplateConfig;
  selectedTemplateId: string;
  savedTemplates: LatexTemplateEntry[];
  builtinTemplates: LatexTemplateConfig[];
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'select-template', id: string): void;
  (e: 'save-template', asNew: boolean, name: string): void;
  (e: 'delete-template'): void;
}>();

const { t, locale } = useI18n();

const latexTemplateSaveName = ref<string>(props.template.name || '');
const modalPreviewMode = ref<'visual' | 'source'>('visual');
const activeFloatingBox = ref<
  'entry-vars' | 'entry-conds' | 'spouse-vars' | 'spouse-conds' | null
>(null);

const latexEntryMaskRef = ref<HTMLTextAreaElement | null>(null);
const latexSpouseMaskRef = ref<HTMLTextAreaElement | null>(null);

function formatLayoutDate(isoStr: string): string {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString(locale.value === 'en' ? 'en-US' : 'de-DE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoStr;
  }
}

function toggleFloatingBox(boxId: 'entry-vars' | 'entry-conds' | 'spouse-vars' | 'spouse-conds') {
  activeFloatingBox.value = activeFloatingBox.value === boxId ? null : boxId;
}

function closeFloatingBox() {
  activeFloatingBox.value = null;
}

const sampleLatexPreview = computed(() => {
  return generateSampleLatexPreview(
    props.template,
    locale.value === 'en' ? 'en' : 'de'
  );
});

// Categorized Variables for Entry Mask
const entryVariablesByCategory = computed(() => {
  const identity = LATEX_VARIABLE_DEFINITIONS.filter(v => v.category === 'identity');
  const vital = LATEX_VARIABLE_DEFINITIONS.filter(v => v.category === 'vital');
  const family = LATEX_VARIABLE_DEFINITIONS.filter(v => v.category === 'family');
  const extra = LATEX_VARIABLE_DEFINITIONS.filter(v => v.category === 'extra');
  return { identity, vital, family, extra };
});

// Categorized Spouse Variables
const spouseVariablesCategorized = [
  {
    category: 'marriage',
    titleKey: 'export_latex_sec_marriage',
    vars: [
      {
        token: '{heiratsinfo}',
        descDe: 'Heiratsangabe komplett (z. B. 1848 in Münster)',
        descEn: 'Complete marriage record (e.g. 1848 in Münster)',
      },
      {
        token: '{heiratsjahr}',
        descDe: 'Heiratsjahr',
        descEn: 'Marriage year',
      },
      {
        token: '{heiratsdatum}',
        descDe: 'Exaktes Heiratsdatum',
        descEn: 'Exact marriage date',
      },
      {
        token: '{heiratsort}',
        descDe: 'Heiratsort',
        descEn: 'Marriage place',
      },
      {
        token: '{ehe_nr}',
        descDe: 'Ehenummer (1, 2, ...)',
        descEn: 'Marriage number (1, 2, ...)',
      },
      {
        token: '{ehen_gesamt}',
        descDe: 'Gesamtzahl aller Ehen',
        descEn: 'Total marriages count',
      },
    ],
  },
  {
    category: 'partner',
    titleKey: 'export_latex_sec_partner',
    vars: [
      {
        token: '{partner_name}',
        descDe: 'Vollständiger Name des Partners',
        descEn: 'Full name of spouse',
      },
      {
        token: '{partner_henry_id}',
        descDe: 'Henry-ID des Partners',
        descEn: 'Henry Code of spouse',
      },
      {
        token: '{partner_lebensdaten}',
        descDe: 'Lebensdaten des Partners (*, †)',
        descEn: 'Vital dates of spouse (*, †)',
      },
      {
        token: '{partner_eltern}',
        descDe: 'Eltern des Partners',
        descEn: 'Parents of spouse',
      },
    ],
  },
  {
    category: 'divorce',
    titleKey: 'export_latex_sec_divorce',
    vars: [
      {
        token: '{scheidung}',
        descDe: 'Scheidungshinweis (⚮ Datum & Ort)',
        descEn: 'Divorce notice (⚮ date & place)',
      },
      {
        token: '{scheidungsdatum}',
        descDe: 'Scheidungsdatum',
        descEn: 'Divorce date',
      },
      {
        token: '{ist_geschieden}',
        descDe: 'Wahrheitswert (Ja/Nein)',
        descEn: 'Boolean value (Yes/No)',
      },
    ],
  },
];

// Entry Mask Conditions
const entryConditionsCategorized = [
  {
    titleKey: 'export_latex_sec_cond_status',
    conds: [
      {
        label: "{if sohn_tochter == 'Sohn'}",
        code: "{if sohn_tochter == 'Sohn'} (Sohn){else if sohn_tochter == 'Tochter'} (Tochter){endif}",
        descDe: 'Unterscheidung Sohn / Tochter',
        descEn: 'Distinction Son / Daughter',
      },
      {
        label: '{if sohn_tochter}',
        code: '{if sohn_tochter}, {sohn_tochter}{endif}',
        descDe: 'Sohn/Tochter nur bei Nachkommen anhängen (nicht bei Gen. 1)',
        descEn: 'Append Son/Daughter only for descendants (not Gen. 1)',
      },
      {
        label: '{if aus_ehe}',
        code: '{if aus_ehe}, {aus_ehe}{endif}',
        descDe: 'Ehe-Herkunft (aus 1. Ehe / aus 2. Ehe) nur bei Mehrfachehe',
        descEn: 'Marriage origin (from 1st marriage / from 2nd marriage)',
      },
      {
        label: '{if eltern_mehrfachehe}',
        code: '{if eltern_mehrfachehe} (aus {eltern_ehe_nr}. Ehe){endif}',
        descDe: 'Bedingung für Mehrfachehe der Eltern',
        descEn: 'Condition for parents multiple marriages',
      },
      {
        label: '{if eltern_genau}',
        code: '\\newline {eltern_genau}',
        descDe: 'Genaue Eltern inkl. Ehe-Ausweisung',
        descEn: 'Detailed parents with marriage origin',
      },
    ],
  },
  {
    titleKey: 'export_latex_sec_cond_marriage',
    conds: [
      {
        label: '{if ehen_gesamt > 1}',
        code: '{if ehen_gesamt > 1} ({ehen_gesamt} Ehen){endif}',
        descDe: 'Mehrere Ehen kennzeichnen',
        descEn: 'Indicate multiple marriages',
      },
      {
        label: '{if ist_geschieden}',
        code: '{if ist_geschieden} \\textbf{⚮} {scheidung}{endif}',
        descDe: 'Scheidungssymbol und -daten bei geschiedenen Personen',
        descEn: 'Divorce symbol and dates for divorced individuals',
      },
      {
        label: '{if scheidung}',
        code: '{if scheidung} {scheidung}{endif}',
        descDe: 'Scheidungsangabe falls vorhanden',
        descEn: 'Divorce details if present',
      },
      {
        label: '{if kinder_anzahl > 0}',
        code: '{if kinder_anzahl > 0} ({kinder_anzahl}){endif}',
        descDe: 'Kinderanzahl ausgeben',
        descEn: 'Show children count',
      },
      {
        label: '{if implex}',
        code: '{if implex} \\textbf{[Implex: {implex}]}{endif}',
        descDe: 'Ahnenschwund / Implex-Verweis',
        descEn: 'Pedigree collapse / implex reference',
      },
    ],
  },
  {
    titleKey: 'export_latex_sec_cond_details',
    conds: [
      {
        label: '{if lebensdaten}',
        code: '{if lebensdaten} — {lebensdaten}{endif}',
        descDe: 'Lebensdaten nur anhängen, wenn vorhanden',
        descEn: 'Append vital dates only if present',
      },
      {
        label: '{if beruf}',
        code: '{if beruf}, {beruf}{endif}',
        descDe: 'Beruf nur anhängen, wenn dokumentiert',
        descEn: 'Append occupation only if documented',
      },
      {
        label: '{if religion}',
        code: '{if religion}, {religion}{endif}',
        descDe: 'Religion nur anhängen, wenn dokumentiert',
        descEn: 'Append religion only if documented',
      },
      {
        label: '{if wohnort}',
        code: '{if wohnort}, {wohnort}{endif}',
        descDe: 'Wohnort nur anhängen, wenn dokumentiert',
        descEn: 'Append residence only if documented',
      },
      {
        label: '{if notizen}',
        code: '{if notizen}\\newline \\footnotesize{{notizen}}{endif}',
        descDe: 'Notizen als Fußnote ausgeben',
        descEn: 'Output notes as footnote',
      },
    ],
  },
  {
    titleKey: 'export_latex_sec_cond_generic',
    conds: [
      {
        label: '{if ...} ... {endif}',
        code: '{if bedingung} text {endif}',
        descDe: 'Einfache Wenn-Bedingung',
        descEn: 'Simple if-condition',
      },
      {
        label: '{if ...} ... {else} ... {endif}',
        code: '{if bedingung} fall_wahr {else} fall_falsch {endif}',
        descDe: 'Wenn-Dann-Sonst-Bedingung',
        descEn: 'If-then-else condition',
      },
    ],
  },
];

// Spouse Mask Conditions
const spouseConditionsCategorized = [
  {
    titleKey: 'export_latex_sec_marriage',
    conds: [
      {
        label: '{if heiratsort}',
        code: '{if heiratsort} in {heiratsort}{endif}',
        descDe: 'Heiratsort nur ausgeben, wenn vorhanden',
        descEn: 'Show marriage place only if present',
      },
      {
        label: '{if heiratsdatum}',
        code: '{if heiratsdatum} am {heiratsdatum}{endif}',
        descDe: 'Heiratsdatum nur ausgeben, wenn vorhanden',
        descEn: 'Show marriage date only if present',
      },
      {
        label: '{if heiratsjahr}',
        code: '{if heiratsjahr} ({heiratsjahr}){endif}',
        descDe: 'Heiratsjahr in Klammern',
        descEn: 'Marriage year in parentheses',
      },
    ],
  },
  {
    titleKey: 'export_latex_sec_partner',
    conds: [
      {
        label: '{if partner_lebensdaten}',
        code: '{if partner_lebensdaten} {partner_lebensdaten}{endif}',
        descDe: 'Lebensdaten des Partners',
        descEn: 'Vital dates of spouse',
      },
      {
        label: '{if partner_eltern}',
        code: '{if partner_eltern} {partner_eltern}{endif}',
        descDe: 'Eltern des Partners',
        descEn: 'Parents of spouse',
      },
      {
        label: '{if partner_henry_id}',
        code: '{if partner_henry_id} [{partner_henry_id}]{endif}',
        descDe: 'Henry-Code des Partners',
        descEn: 'Henry Code of spouse',
      },
    ],
  },
  {
    titleKey: 'export_latex_sec_divorce',
    conds: [
      {
        label: '{if ist_geschieden}',
        code: '{if ist_geschieden} \\textbf{⚮} {scheidung}{endif}',
        descDe: 'Scheidungssymbol & Daten',
        descEn: 'Divorce symbol & dates',
      },
      {
        label: '{if scheidungsdatum}',
        code: '{if scheidungsdatum} (⚮ {scheidungsdatum}){endif}',
        descDe: 'Scheidungsdatum in Klammern',
        descEn: 'Divorce date in parentheses',
      },
    ],
  },
];

function insertTokenIntoEntryMask(token: string) {
  const el = latexEntryMaskRef.value;
  if (!el) {
    props.template.entryMask += token;
    return;
  }
  const start = el.selectionStart ?? props.template.entryMask.length;
  const end = el.selectionEnd ?? start;
  const current = props.template.entryMask;
  props.template.entryMask = current.slice(0, start) + token + current.slice(end);
  setTimeout(() => {
    el.focus();
    el.setSelectionRange(start + token.length, start + token.length);
  }, 0);
}

function wrapEntryMaskSelection(prefix: string, suffix: string, fallbackInner = 'Text') {
  const el = latexEntryMaskRef.value;
  const current = props.template.entryMask;
  if (!el) {
    props.template.entryMask = `${current}${prefix}${fallbackInner}${suffix}`;
    return;
  }
  const start = el.selectionStart ?? current.length;
  const end = el.selectionEnd ?? start;
  const selected = current.slice(start, end) || fallbackInner;
  const replacement = `${prefix}${selected}${suffix}`;
  props.template.entryMask = current.slice(0, start) + replacement + current.slice(end);
  setTimeout(() => {
    el.focus();
    el.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
  }, 0);
}

function insertTokenIntoSpouseMask(token: string) {
  const el = latexSpouseMaskRef.value;
  if (!el) {
    props.template.spouseMask += token;
    return;
  }
  const start = el.selectionStart ?? props.template.spouseMask.length;
  const end = el.selectionEnd ?? start;
  const current = props.template.spouseMask;
  props.template.spouseMask = current.slice(0, start) + token + current.slice(end);
  setTimeout(() => {
    el.focus();
    el.setSelectionRange(start + token.length, start + token.length);
  }, 0);
}
</script>

<template>
  <div
    v-if="show"
    class="modal-overlay latex-config-overlay"
    @click.self="emit('close')"
  >
    <div class="modal-content latex-config-modal-window">
      <!-- Fenster-Kopfzeile -->
      <div class="latex-config-modal-header">
        <div class="modal-title-wrap">
          <h3 class="modal-title">🎨 {{ t('export_latex_template_title') }}</h3>
          <span class="modal-subtitle">{{ t('export_latex_config_window_hint') }}</span>
        </div>
        <button
          type="button"
          class="btn-modal-close"
          @click="emit('close')"
          title="Schließen"
        >
          ✕
        </button>
      </div>

      <!-- Fenster-Inhalt mit 2-Spalten-Layout (Konfiguration links, Live-Preview rechts) -->
      <div class="latex-config-modal-body">
        <!-- Linke Spalte: Konfiguration (Vorlagen, Layout, Textmasken) -->
        <div class="config-modal-left-col">
          <!-- Bereich 1: Speicherzustände / Vorlagen-Management -->
          <div class="config-modal-section">
            <h4 class="config-sec-title">💾 {{ t('export_latex_template_select') }}</h4>
            <div class="template-mgmt-row">
              <div class="mgmt-select-col">
                <select
                  class="export-dropdown"
                  :value="selectedTemplateId"
                  @change="emit('select-template', ($event.target as HTMLSelectElement).value)"
                >
                  <optgroup :label="t('export_latex_standard_templates')">
                    <option
                      v-for="bt in builtinTemplates"
                      :key="bt.id"
                      :value="bt.id"
                    >
                      📌 {{ bt.name }}
                    </option>
                  </optgroup>
                  <optgroup v-if="savedTemplates.length > 0" :label="t('export_latex_saved_templates')">
                    <option
                      v-for="st in savedTemplates"
                      :key="st.id"
                      :value="st.id"
                    >
                      💾 {{ st.name }} ({{ formatLayoutDate(st.created_at) }})
                    </option>
                  </optgroup>
                </select>
              </div>

              <div class="mgmt-input-col">
                <input
                  type="text"
                  v-model="latexTemplateSaveName"
                  :placeholder="t('export_latex_template_name_placeholder')"
                  class="export-input"
                />
              </div>

              <div class="mgmt-btns-col">
                <button
                  type="button"
                  class="btn-tpl-action primary"
                  @click="emit('save-template', false, latexTemplateSaveName)"
                  title="Aktuelle Konfiguration unter diesem Namen speichern / überschreiben"
                >
                  💾 {{ t('export_latex_template_save_btn') }}
                </button>
                <button
                  type="button"
                  class="btn-tpl-action"
                  @click="emit('save-template', true, latexTemplateSaveName)"
                  title="Als neuen Speicherzustand anlegen"
                >
                  ➕ {{ t('export_latex_new_btn') }}
                </button>
                <button
                  v-if="!builtinTemplates.some(b => b.id === selectedTemplateId)"
                  type="button"
                  class="btn-tpl-action danger"
                  @click="emit('delete-template')"
                  title="Speicherzustand löschen"
                >
                  🗑️
                </button>
              </div>
            </div>
          </div>

          <!-- Bereich 2: Typografie & Seiten-Layout -->
          <div class="config-modal-section">
            <h4 class="config-sec-title">📐 Typografie & Dokument-Layout</h4>
            <div class="doc-layout-grid-modal">
              <div class="layout-params-row">
                <div class="param-col">
                  <label class="mini-lbl">{{ t('export_latex_class_lbl') }}</label>
                  <select v-model="template.documentClass" class="export-dropdown compact">
                    <option value="scrbook">scrbook (KOMA-Script Buch)</option>
                    <option value="scrartcl">scrartcl (KOMA-Script Artikel)</option>
                    <option value="article">article (Standard-Artikel)</option>
                  </select>
                </div>
                <div class="param-col">
                  <label class="mini-lbl">{{ t('export_latex_format_lbl') }}</label>
                  <select v-model="template.paperSize" class="export-dropdown compact">
                    <option value="a4paper">A4 (210 × 297 mm)</option>
                    <option value="a5paper">A5 (148 × 210 mm)</option>
                    <option value="letterpaper">US-Letter</option>
                  </select>
                </div>
                <div class="param-col">
                  <label class="mini-lbl">{{ t('export_latex_font_lbl') }}</label>
                  <select v-model="template.fontSize" class="export-dropdown compact">
                    <option value="10pt">10 pt</option>
                    <option value="11pt">11 pt</option>
                    <option value="12pt">12 pt</option>
                  </select>
                </div>
              </div>

              <div class="layout-params-row">
                <div class="param-col">
                  <label class="mini-lbl">{{ t('export_latex_indent_step_lbl') }}</label>
                  <input
                    type="number"
                    step="0.05"
                    v-model.number="template.indentStepEm"
                    min="0.2"
                    max="5"
                    class="export-input compact"
                  />
                </div>
                <div class="param-col">
                  <label class="mini-lbl">{{ t('export_latex_margin_lbl') }}</label>
                  <input
                    type="number"
                    v-model.number="template.marginMm"
                    min="10"
                    max="50"
                    class="export-input compact"
                  />
                </div>
                <div class="param-col">
                  <label class="mini-lbl">{{ t('export_latex_spacing_lbl') }}</label>
                  <input
                    type="number"
                    step="0.05"
                    v-model.number="template.entrySpacingEm"
                    min="0"
                    max="3"
                    class="export-input compact"
                  />
                </div>
              </div>
            </div>
          </div>

          <!-- Bereich 3: Masken-Editor für Personeneintrag -->
          <div class="config-modal-section mask-editor-block relative-anchor">
            <div class="mask-section-header">
              <h4 class="config-sec-title">👤 {{ t('export_latex_entry_mask_label') }}</h4>
              <span class="mask-hint">{{ t('export_latex_entry_mask_hint') }}</span>
            </div>

            <!-- Toolbar & Floating Box Trigger -->
            <div class="latex-format-toolbar">
              <button type="button" class="fmt-btn" @click="wrapEntryMaskSelection('\\textbf{', '}', 'Fett')" :title="t('export_latex_fmt_bold')">
                <strong>B</strong>
              </button>
              <button type="button" class="fmt-btn" @click="wrapEntryMaskSelection('\\textit{', '}', 'Kursiv')" :title="t('export_latex_fmt_italic')">
                <em>I</em>
              </button>
              <button type="button" class="fmt-btn" @click="wrapEntryMaskSelection('\\textsc{', '}', 'Kapitälchen')" :title="t('export_latex_fmt_smallcaps')">
                ᴀʙᴄ
              </button>
              <button type="button" class="fmt-btn" @click="wrapEntryMaskSelection('\\underline{', '}', 'Unterstrichen')" :title="t('export_latex_fmt_underline')">
                <u>U</u>
              </button>
              <button type="button" class="fmt-btn" @click="insertTokenIntoEntryMask('\\newline ')" :title="t('export_latex_fmt_newline')">
                ↵
              </button>
              <button type="button" class="fmt-btn" @click="insertTokenIntoEntryMask('\\quad ')" :title="t('export_latex_fmt_quad')">
                ⇥
              </button>

              <div class="toolbar-divider"></div>

              <!-- Genealogiezeichen Bar -->
              <button type="button" class="fmt-btn symbol-btn" @click="insertTokenIntoEntryMask('* ')" :title="t('export_latex_sym_birth')">*</button>
              <button type="button" class="fmt-btn symbol-btn" @click="insertTokenIntoEntryMask('≈ ')" :title="t('export_latex_sym_baptism')">≈</button>
              <button type="button" class="fmt-btn symbol-btn" @click="insertTokenIntoEntryMask('⚭ ')" :title="t('export_latex_sym_marriage')">⚭</button>
              <button type="button" class="fmt-btn symbol-btn" @click="insertTokenIntoEntryMask('⚮ ')" :title="t('export_latex_sym_divorce')">⚮</button>
              <button type="button" class="fmt-btn symbol-btn" @click="insertTokenIntoEntryMask('† ')" :title="t('export_latex_sym_death')">†</button>

              <!-- Floating Boxes Triggers -->
              <div class="floating-triggers-group">
                <button
                  type="button"
                  class="trigger-floating-btn"
                  :class="{ active: activeFloatingBox === 'entry-vars' }"
                  @click="toggleFloatingBox('entry-vars')"
                >
                  <span>➕ {{ t('export_latex_btn_add_variable') }}</span>
                  <span class="trigger-caret">{{ activeFloatingBox === 'entry-vars' ? '▲' : '▼' }}</span>
                </button>
                <button
                  type="button"
                  class="trigger-floating-btn"
                  :class="{ active: activeFloatingBox === 'entry-conds' }"
                  @click="toggleFloatingBox('entry-conds')"
                >
                  <span>⚡ {{ t('export_latex_btn_add_condition') }}</span>
                  <span class="trigger-caret">{{ activeFloatingBox === 'entry-conds' ? '▲' : '▼' }}</span>
                </button>
              </div>
            </div>

            <!-- Floating Box: Variablen für Personeneintrag -->
            <div v-if="activeFloatingBox === 'entry-vars'" class="floating-box-popover">
              <div class="floating-box-header">
                <span class="floating-box-title">➕ {{ t('export_latex_btn_add_variable') }} (Personeneintrag)</span>
                <button type="button" class="floating-box-close" @click="closeFloatingBox" :title="t('export_latex_floating_close')">✕</button>
              </div>
              <div class="floating-box-content">
                <!-- Identität & Kennzeichnung -->
                <div class="floating-section">
                  <div class="floating-sec-header">
                    <span class="sec-dot cat-identity"></span>
                    <span>{{ t('export_latex_sec_identity') }}</span>
                  </div>
                  <div class="variable-chips-wrap">
                    <button
                      v-for="v in entryVariablesByCategory.identity"
                      :key="v.token"
                      type="button"
                      class="var-chip cat-identity"
                      :title="(locale === 'en' ? v.labelEn : v.labelDe) + ' — ' + (locale === 'en' ? 'Ex.: ' : 'Bsp.: ') + v.example"
                      @click="insertTokenIntoEntryMask(v.token)"
                    >
                      {{ v.token }}
                    </button>
                  </div>
                </div>

                <!-- Lebensdaten -->
                <div class="floating-section">
                  <div class="floating-sec-header">
                    <span class="sec-dot cat-vital"></span>
                    <span>{{ t('export_latex_sec_vital') }}</span>
                  </div>
                  <div class="variable-chips-wrap">
                    <button
                      v-for="v in entryVariablesByCategory.vital"
                      :key="v.token"
                      type="button"
                      class="var-chip cat-vital"
                      :title="(locale === 'en' ? v.labelEn : v.labelDe) + ' — ' + (locale === 'en' ? 'Ex.: ' : 'Bsp.: ') + v.example"
                      @click="insertTokenIntoEntryMask(v.token)"
                    >
                      {{ v.token }}
                    </button>
                  </div>
                </div>

                <!-- Familie, Eltern & Ehen -->
                <div class="floating-section">
                  <div class="floating-sec-header">
                    <span class="sec-dot cat-family"></span>
                    <span>{{ t('export_latex_sec_family') }}</span>
                  </div>
                  <div class="variable-chips-wrap">
                    <button
                      v-for="v in entryVariablesByCategory.family"
                      :key="v.token"
                      type="button"
                      class="var-chip cat-family"
                      :title="(locale === 'en' ? v.labelEn : v.labelDe) + ' — ' + (locale === 'en' ? 'Ex.: ' : 'Bsp.: ') + v.example"
                      @click="insertTokenIntoEntryMask(v.token)"
                    >
                      {{ v.token }}
                    </button>
                  </div>
                </div>

                <!-- Zusatzangaben & Sonderfälle -->
                <div class="floating-section">
                  <div class="floating-sec-header">
                    <span class="sec-dot cat-extra"></span>
                    <span>{{ t('export_latex_sec_extra') }}</span>
                  </div>
                  <div class="variable-chips-wrap">
                    <button
                      v-for="v in entryVariablesByCategory.extra"
                      :key="v.token"
                      type="button"
                      class="var-chip cat-extra"
                      :title="(locale === 'en' ? v.labelEn : v.labelDe) + ' — ' + (locale === 'en' ? 'Ex.: ' : 'Bsp.: ') + v.example"
                      @click="insertTokenIntoEntryMask(v.token)"
                    >
                      {{ v.token }}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Floating Box: Bedingungen für Personeneintrag -->
            <div v-if="activeFloatingBox === 'entry-conds'" class="floating-box-popover">
              <div class="floating-box-header">
                <span class="floating-box-title">⚡ {{ t('export_latex_btn_add_condition') }} (Personeneintrag)</span>
                <button type="button" class="floating-box-close" @click="closeFloatingBox" :title="t('export_latex_floating_close')">✕</button>
              </div>
              <div class="floating-box-content">
                <div v-for="sec in entryConditionsCategorized" :key="sec.titleKey" class="floating-section">
                  <div class="floating-sec-header">
                    <span>{{ t(sec.titleKey) }}</span>
                  </div>
                  <div class="variable-chips-wrap">
                    <button
                      v-for="c in sec.conds"
                      :key="c.label"
                      type="button"
                      class="cond-chip"
                      :title="(locale === 'en' ? c.descEn : c.descDe) + ' — Code: ' + c.code"
                      @click="insertTokenIntoEntryMask(c.code)"
                    >
                      {{ c.label }}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <textarea
              ref="latexEntryMaskRef"
              v-model="template.entryMask"
              rows="4"
              class="export-textarea mono-textarea modal-mask-textarea"
              placeholder="({generation}{if sohn_tochter}, {sohn_tochter}{endif}) — {lebensdaten}{ehepartner}"
            ></textarea>
          </div>

          <!-- Bereich 4: Masken-Editor für Ehepartner -->
          <div class="config-modal-section mask-editor-block relative-anchor">
            <div class="mask-section-header">
              <h4 class="config-sec-title">⚭ {{ t('export_latex_spouse_mask_label') }}</h4>
              <span class="mask-hint">{{ t('export_latex_spouse_mask_hint') }}</span>
            </div>

            <div class="latex-format-toolbar">
              <button type="button" class="fmt-btn symbol-btn" @click="insertTokenIntoSpouseMask('⚭ ')" :title="t('export_latex_sym_marriage')">⚭</button>
              <button type="button" class="fmt-btn symbol-btn" @click="insertTokenIntoSpouseMask('⚮ ')" :title="t('export_latex_sym_divorce')">⚮</button>
              <button type="button" class="fmt-btn symbol-btn" @click="insertTokenIntoSpouseMask('* ')" :title="t('export_latex_sym_birth')">*</button>
              <button type="button" class="fmt-btn symbol-btn" @click="insertTokenIntoSpouseMask('† ')" :title="t('export_latex_sym_death')">†</button>

              <div class="floating-triggers-group">
                <button
                  type="button"
                  class="trigger-floating-btn"
                  :class="{ active: activeFloatingBox === 'spouse-vars' }"
                  @click="toggleFloatingBox('spouse-vars')"
                >
                  <span>➕ {{ t('export_latex_btn_add_variable') }}</span>
                  <span class="trigger-caret">{{ activeFloatingBox === 'spouse-vars' ? '▲' : '▼' }}</span>
                </button>
                <button
                  type="button"
                  class="trigger-floating-btn"
                  :class="{ active: activeFloatingBox === 'spouse-conds' }"
                  @click="toggleFloatingBox('spouse-conds')"
                >
                  <span>⚡ {{ t('export_latex_btn_add_condition') }}</span>
                  <span class="trigger-caret">{{ activeFloatingBox === 'spouse-conds' ? '▲' : '▼' }}</span>
                </button>
              </div>
            </div>

            <!-- Floating Box: Variablen für Ehepartner -->
            <div v-if="activeFloatingBox === 'spouse-vars'" class="floating-box-popover">
              <div class="floating-box-header">
                <span class="floating-box-title">➕ {{ t('export_latex_btn_add_variable') }} (Ehepartner)</span>
                <button type="button" class="floating-box-close" @click="closeFloatingBox" :title="t('export_latex_floating_close')">✕</button>
              </div>
              <div class="floating-box-content">
                <div v-for="sec in spouseVariablesCategorized" :key="sec.category" class="floating-section">
                  <div class="floating-sec-header">
                    <span class="sec-dot cat-family"></span>
                    <span>{{ t(sec.titleKey) }}</span>
                  </div>
                  <div class="variable-chips-wrap">
                    <button
                      v-for="sv in sec.vars"
                      :key="sv.token"
                      type="button"
                      class="var-chip cat-family"
                      :title="locale === 'en' ? sv.descEn : sv.descDe"
                      @click="insertTokenIntoSpouseMask(sv.token)"
                    >
                      {{ sv.token }}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Floating Box: Bedingungen für Ehepartner -->
            <div v-if="activeFloatingBox === 'spouse-conds'" class="floating-box-popover">
              <div class="floating-box-header">
                <span class="floating-box-title">⚡ {{ t('export_latex_btn_add_condition') }} (Ehepartner)</span>
                <button type="button" class="floating-box-close" @click="closeFloatingBox" :title="t('export_latex_floating_close')">✕</button>
              </div>
              <div class="floating-box-content">
                <div v-for="sec in spouseConditionsCategorized" :key="sec.titleKey" class="floating-section">
                  <div class="floating-sec-header">
                    <span>{{ t(sec.titleKey) }}</span>
                  </div>
                  <div class="variable-chips-wrap">
                    <button
                      v-for="c in sec.conds"
                      :key="c.label"
                      type="button"
                      class="cond-chip"
                      :title="(locale === 'en' ? c.descEn : c.descDe) + ' — Code: ' + c.code"
                      @click="insertTokenIntoSpouseMask(c.code)"
                    >
                      {{ c.label }}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <textarea
              ref="latexSpouseMaskRef"
              v-model="template.spouseMask"
              rows="3"
              class="export-textarea mono-textarea modal-mask-textarea"
            ></textarea>
          </div>
        </div>

        <!-- Rechte Spalte: Direkte Live-Preview im Modal mit generischen Beispieldaten -->
        <div class="config-modal-right-col">
          <div class="modal-preview-header">
            <div class="modal-preview-title">
              <span>👁️ {{ t('export_latex_modal_preview_title') }}</span>
              <span class="modal-preview-meta">
                ({{ t('export_latex_modal_preview_sample_badge') }})
              </span>
            </div>
            <div class="viewport-btn-group compact">
              <button
                type="button"
                class="btn-viewport"
                :class="{ active: modalPreviewMode === 'visual' }"
                @click="modalPreviewMode = 'visual'"
              >
                🖨️ {{ t('export_latex_view_visual') }}
              </button>
              <button
                type="button"
                class="btn-viewport"
                :class="{ active: modalPreviewMode === 'source' }"
                @click="modalPreviewMode = 'source'"
              >
                📝 {{ t('export_latex_view_source') }}
              </button>
            </div>
          </div>

          <div class="modal-preview-container">
            <div
              v-if="modalPreviewMode === 'visual'"
              class="latex-visual-scroll latex-modal-visual-scroll"
              v-html="sampleLatexPreview.previewHtml"
            ></div>
            <div v-else class="latex-source-scroll latex-modal-source-scroll">
              <pre class="latex-source-pre"><code>{{ sampleLatexPreview.texContent }}</code></pre>
            </div>
          </div>
        </div>
      </div>

      <!-- Fenster-Fußzeile mit Status und Schließen-Button -->
      <div class="latex-config-modal-footer">
        <div class="modal-footer-hint">
          <span class="sync-dot"></span>
          <span>{{ t('export_latex_config_live_synced') }}</span>
        </div>
        <button
          type="button"
          class="btn-modal-apply"
          @click="emit('close')"
        >
          ✓ {{ t('export_latex_btn_apply_close') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.latex-config-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(15, 23, 42, 0.65);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.latex-config-modal-window {
  width: 1380px;
  max-width: 96vw;
  height: 92vh;
  max-height: 92vh;
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 20px 45px rgba(15, 23, 42, 0.3), 0 4px 12px rgba(15, 23, 42, 0.15);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: modalFadeIn 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes modalFadeIn {
  from {
    opacity: 0;
    transform: scale(0.96) translateY(8px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.latex-config-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}

.modal-title-wrap {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.modal-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  color: #0f172a;
}

.modal-subtitle {
  font-size: 0.78rem;
  color: #64748b;
}

.btn-modal-close {
  background: none;
  border: none;
  font-size: 1.2rem;
  color: #94a3b8;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  transition: all 0.15s ease;
}

.btn-modal-close:hover {
  background: #e2e8f0;
  color: #0f172a;
}

.latex-config-modal-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: row;
  overflow: hidden;
  padding: 0;
  gap: 0;
}

.config-modal-left-col {
  flex: 1.15;
  min-width: 0;
  overflow-y: auto;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: #ffffff;
}

.config-modal-right-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border-left: 1px solid #cbd5e1;
  background: #f1f5f9;
}

.config-modal-section {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.config-sec-title {
  margin: 0;
  font-size: 0.88rem;
  font-weight: 700;
  color: #1e293b;
}

.template-mgmt-row {
  display: flex;
  gap: 10px;
  align-items: center;
}

.mgmt-select-col {
  flex: 1.2;
}

.mgmt-input-col {
  flex: 1;
}

.mgmt-btns-col {
  display: flex;
  gap: 6px;
}

.export-dropdown {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #ffffff;
  color: #1e293b;
  font-size: 0.82rem;
  outline: none;
}

.export-dropdown.compact {
  padding: 4px 8px;
  font-size: 0.78rem;
}

.export-input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #ffffff;
  color: #1e293b;
  font-size: 0.82rem;
  box-sizing: border-box;
  outline: none;
}

.export-input.compact {
  padding: 4px 8px;
  font-size: 0.78rem;
}

.btn-tpl-action {
  padding: 6px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #f8fafc;
  color: #334155;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;
}

.btn-tpl-action:hover {
  background: #e2e8f0;
}

.btn-tpl-action.primary {
  background: #2563eb;
  color: #ffffff;
  border-color: #1d4ed8;
}

.btn-tpl-action.primary:hover {
  background: #1d4ed8;
}

.btn-tpl-action.danger {
  color: #dc2626;
  border-color: #fca5a5;
  background: #fef2f2;
}

.btn-tpl-action.danger:hover {
  background: #fee2e2;
}

.doc-layout-grid-modal {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.layout-params-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.param-col {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mini-lbl {
  font-size: 0.72rem;
  font-weight: 600;
  color: #64748b;
}

.relative-anchor {
  position: relative;
}

.mask-section-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.mask-hint {
  font-size: 0.75rem;
  color: #64748b;
}

.latex-format-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 4px 6px;
}

.fmt-btn {
  padding: 3px 7px;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  font-size: 0.78rem;
  color: #334155;
  cursor: pointer;
  transition: all 0.12s ease;
}

.fmt-btn:hover {
  background: #e2e8f0;
  border-color: #94a3b8;
}

.toolbar-divider {
  width: 1px;
  height: 18px;
  background: #cbd5e1;
  margin: 0 4px;
}

.symbol-btn {
  font-family: 'Latin Modern Roman', 'Times New Roman', serif;
  font-weight: 700;
}

.floating-triggers-group {
  display: flex;
  gap: 4px;
  margin-left: auto;
}

.trigger-floating-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  color: #1d4ed8;
  cursor: pointer;
  transition: all 0.12s ease;
}

.trigger-floating-btn:hover {
  background: #dbeafe;
  border-color: #93c5fd;
}

.trigger-floating-btn.active {
  background: #2563eb;
  color: #ffffff;
  border-color: #1d4ed8;
  box-shadow: 0 1px 3px rgba(37, 99, 235, 0.3);
}

.trigger-caret {
  font-size: 0.6rem;
  opacity: 0.8;
}

.floating-box-popover {
  position: absolute;
  top: 64px;
  left: 6px;
  right: 6px;
  z-index: 80;
  background: #ffffff;
  border: 1.5px solid #cbd5e1;
  border-radius: 8px;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.18), 0 4px 10px rgba(15, 23, 42, 0.08);
  display: flex;
  flex-direction: column;
  max-height: 290px;
  animation: fadeInSlide 0.15s ease-out;
}

@keyframes fadeInSlide {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.floating-box-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  border-radius: 7px 7px 0 0;
}

.floating-box-title {
  font-size: 0.75rem;
  font-weight: 700;
  color: #1e293b;
}

.floating-box-close {
  background: none;
  border: none;
  font-size: 0.85rem;
  color: #64748b;
  cursor: pointer;
  padding: 0 4px;
  border-radius: 3px;
}

.floating-box-close:hover {
  background: #e2e8f0;
  color: #0f172a;
}

.floating-box-content {
  overflow-y: auto;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.floating-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.floating-sec-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.72rem;
  font-weight: 700;
  color: #475569;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.sec-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.sec-dot.cat-identity { background: #3b82f6; }
.sec-dot.cat-vital { background: #10b981; }
.sec-dot.cat-family { background: #8b5cf6; }
.sec-dot.cat-extra { background: #f59e0b; }

.variable-chips-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.var-chip {
  padding: 2px 7px;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.72rem;
  font-weight: 600;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.12s ease;
}

.var-chip.cat-identity {
  background: #eff6ff;
  color: #1d4ed8;
  border-color: #bfdbfe;
}
.var-chip.cat-identity:hover {
  background: #dbeafe;
}

.var-chip.cat-vital {
  background: #ecfdf5;
  color: #047857;
  border-color: #a7f3d0;
}
.var-chip.cat-vital:hover {
  background: #d1fae5;
}

.var-chip.cat-family {
  background: #f5f3ff;
  color: #6d28d9;
  border-color: #ddd6fe;
}
.var-chip.cat-family:hover {
  background: #ede9fe;
}

.var-chip.cat-extra {
  background: #fffbeb;
  color: #b45309;
  border-color: #fde68a;
}
.var-chip.cat-extra:hover {
  background: #fef3c7;
}

.cond-chip {
  padding: 3px 8px;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.72rem;
  background: #f1f5f9;
  color: #334155;
  border: 1px solid #cbd5e1;
  cursor: pointer;
  transition: all 0.12s ease;
  white-space: nowrap;
}

.cond-chip:hover {
  background: #e2e8f0;
  border-color: #94a3b8;
  color: #0f172a;
}

.mono-textarea {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.8rem;
  line-height: 1.45;
}

.export-textarea {
  width: 100%;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 6px 10px;
  box-sizing: border-box;
  background: #ffffff;
  color: #0f172a;
  outline: none;
}

.modal-mask-textarea {
  min-height: 85px;
  resize: vertical;
}

.modal-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: #f8fafc;
  border-bottom: 1px solid #cbd5e1;
}

.modal-preview-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.86rem;
  font-weight: 700;
  color: #1e293b;
}

.modal-preview-meta {
  font-size: 0.74rem;
  font-weight: 500;
  color: #64748b;
}

.viewport-btn-group {
  display: flex;
  gap: 2px;
  background: #e2e8f0;
  padding: 2px;
  border-radius: 6px;
}

.btn-viewport {
  padding: 4px 10px;
  border: none;
  background: transparent;
  color: #475569;
  font-size: 0.75rem;
  font-weight: 600;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-viewport.active {
  background: #ffffff;
  color: #0f172a;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.1);
}

.modal-preview-container {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.latex-modal-visual-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 18px;
  display: flex;
  justify-content: center;
  background: #cbd5e1;
}

.latex-modal-visual-scroll :deep(.latex-sheet-page) {
  width: 100%;
  max-width: 100%;
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.15);
  padding: 32px 36px;
  background: #ffffff;
  box-sizing: border-box;
  font-family: 'Georgia', 'Times New Roman', serif;
  color: #0f172a;
  line-height: 1.5;
}

.latex-modal-visual-scroll :deep(.latex-sheet-header h1) {
  margin: 0 0 6px 0;
  font-size: 1.35rem;
  color: #0f172a;
}

.latex-modal-visual-scroll :deep(.latex-sheet-subtitle) {
  margin: 0 0 10px 0;
  font-size: 0.86rem;
  color: #475569;
  font-weight: 600;
}

.latex-modal-visual-scroll :deep(.latex-sheet-header hr) {
  border: none;
  border-top: 1.5px solid #334155;
  margin-bottom: 18px;
}

.latex-modal-visual-scroll :deep(.latex-preview-entry) {
  position: relative;
  margin-left: calc(var(--indent-step, 0) * 0.35cm);
  text-indent: -1.1cm;
  padding-left: 1.1cm;
  font-size: 0.92rem;
  line-height: 1.45;
}

.latex-modal-visual-scroll :deep(.latex-preview-entry.sep-deeper) {
  margin-top: 0.30em;
}

.latex-modal-visual-scroll :deep(.latex-preview-entry.sep-same) {
  margin-top: 0.20em;
}

.latex-modal-visual-scroll :deep(.latex-preview-entry.sep-shallower) {
  margin-top: 0.55em;
}

.latex-modal-visual-scroll :deep(.latex-preview-marriage) {
  position: relative;
  margin-left: calc(var(--indent-step, 0) * 0.35cm + 0.3cm);
  text-indent: -1.0cm;
  padding-left: 1.0cm;
  margin-top: 0.15em;
  font-size: 0.88rem;
  line-height: 1.4;
  color: #334155;
}

.latex-modal-visual-scroll :deep(.latex-preview-marriage .ehe-nr) {
  font-weight: 600;
  color: #475569;
  margin-right: 4px;
}

.latex-modal-visual-scroll :deep(.latex-preview-level-marker) {
  display: inline-block;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.65rem;
  color: #94a3b8;
  margin-right: 6px;
  vertical-align: middle;
}

.latex-modal-visual-scroll :deep(.latex-preview-entry-body) {
  display: inline;
}

.latex-modal-source-scroll {
  flex: 1;
  overflow: auto;
  padding: 16px;
  background: #0f172a;
}

.latex-source-pre {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.82rem;
  line-height: 1.55;
  color: #e2e8f0;
  white-space: pre-wrap;
  word-break: break-word;
}

.latex-config-modal-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: #f8fafc;
  border-top: 1px solid #e2e8f0;
}

.modal-footer-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
  color: #475569;
}

.sync-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #10b981;
  display: inline-block;
  box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.2);
}

.btn-modal-apply {
  padding: 8px 18px;
  background: #2563eb;
  border: 1px solid #1d4ed8;
  border-radius: 6px;
  color: #ffffff;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-modal-apply:hover {
  background: #1d4ed8;
}
</style>

