<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ExportPersonInput } from '../utils/htmlExport';
import HtmlExportPane from './export/HtmlExportPane.vue';
import DesignImageExportPane from './export/DesignImageExportPane.vue';
import LatexExportPane from './export/LatexExportPane.vue';
import GedcomExportPane from './export/GedcomExportPane.vue';
import CsvExportPane from './export/CsvExportPane.vue';

interface RootAncestorConfig {
  person_id: string;
  starting_code: string;
  given_name: string | null;
  surname: string | null;
}

const props = defineProps<{
  persons: ExportPersonInput[];
  rootAncestors: RootAncestorConfig[];
  activeProbandId: string | null;
}>();

const emit = defineEmits<{
  (e: 'select-proband', personId: string): void;
}>();

const { t } = useI18n();

// Export Modul Tabs (HTML, Stammbaum Design Bild, LaTeX/PDF, CSV, GEDCOM)
const activeExportModuleTab = ref<'html' | 'design_image' | 'pdf' | 'csv' | 'gedcom'>('html');

const selectedExportRootId = ref<string>('');
const exportStartCode = ref<string>('1');

function selectRootPerson(personId: string, startCode?: string) {
  selectedExportRootId.value = personId;
  const configured = props.rootAncestors.find(r => r.person_id === personId);
  if (startCode !== undefined) {
    exportStartCode.value = startCode;
  } else if (configured) {
    exportStartCode.value = configured.starting_code || '1';
  } else if (!exportStartCode.value.trim()) {
    exportStartCode.value = '1';
  }
}

onMounted(() => {
  if (props.activeProbandId && props.persons.some(p => p.id === props.activeProbandId)) {
    selectRootPerson(props.activeProbandId);
  } else if (props.rootAncestors.length > 0) {
    selectRootPerson(props.rootAncestors[0].person_id, props.rootAncestors[0].starting_code);
  } else if (props.persons.length > 0) {
    selectRootPerson(props.persons[0].id, '1');
  }
});

watch(
  () => props.activeProbandId,
  newId => {
    if (newId && newId !== selectedExportRootId.value && props.persons.some(p => p.id === newId)) {
      selectRootPerson(newId);
    }
  }
);

watch(
  () => props.persons,
  newPersons => {
    if (
      newPersons.length > 0 &&
      (!selectedExportRootId.value || !newPersons.some(p => p.id === selectedExportRootId.value))
    ) {
      if (props.activeProbandId && newPersons.some(p => p.id === props.activeProbandId)) {
        selectRootPerson(props.activeProbandId);
      } else if (props.rootAncestors.length > 0) {
        selectRootPerson(props.rootAncestors[0].person_id, props.rootAncestors[0].starting_code);
      } else {
        selectRootPerson(newPersons[0].id, '1');
      }
    }
  }
);
</script>

<template>
  <div class="export-module-container">
    <!-- Modul-Kopfzeile mit Format-Tabs -->
    <header class="export-module-header">
      <div class="header-left">
        <span class="module-badge">📦 {{ t('export_header_badge') }}</span>
      </div>

      <!-- Modul-Tabs zur Umschaltung des Export-Arbeitsbereichs -->
      <nav class="export-module-tabs">
        <button
          type="button"
          class="module-tab-btn"
          :class="{ active: activeExportModuleTab === 'html' }"
          @click="activeExportModuleTab = 'html'"
        >
          🌐 {{ t('export_tab_html') }}
        </button>
        <button
          type="button"
          class="module-tab-btn"
          :class="{ active: activeExportModuleTab === 'design_image' }"
          @click="activeExportModuleTab = 'design_image'"
        >
          🖼️ {{ t('export_tab_design_image') }}
        </button>
        <button
          type="button"
          class="module-tab-btn"
          :class="{ active: activeExportModuleTab === 'pdf' }"
          @click="activeExportModuleTab = 'pdf'"
        >
          📄 {{ t('export_tab_pdf') }}
        </button>
        <button
          type="button"
          class="module-tab-btn"
          :class="{ active: activeExportModuleTab === 'csv' }"
          @click="activeExportModuleTab = 'csv'"
        >
          📊 {{ t('export_tab_csv') }}
        </button>
        <button
          type="button"
          class="module-tab-btn"
          :class="{ active: activeExportModuleTab === 'gedcom' }"
          @click="activeExportModuleTab = 'gedcom'"
        >
          🧬 {{ t('export_tab_gedcom') }}
        </button>
      </nav>
    </header>

    <!-- Modul-Ansicht 1: Interaktiver HTML Stammbaum -->
    <HtmlExportPane
      v-if="activeExportModuleTab === 'html'"
      :persons="persons"
      :root-ancestors="rootAncestors"
      :active-proband-id="activeProbandId"
      v-model:selected-export-root-id="selectedExportRootId"
      v-model:export-start-code="exportStartCode"
      @select-proband="id => emit('select-proband', id)"
    />

    <!-- Modul-Ansicht 2: Stammbaum Design Mode Bild-Export -->
    <DesignImageExportPane
      v-else-if="activeExportModuleTab === 'design_image'"
      :persons="persons"
      :active-proband-id="activeProbandId"
    />

    <!-- Modul-Ansicht 3: Druckbares Format (LaTeX Export) -->
    <LatexExportPane
      v-else-if="activeExportModuleTab === 'pdf'"
      :persons="persons"
      :root-ancestors="rootAncestors"
      :active-proband-id="activeProbandId"
      v-model:selected-export-root-id="selectedExportRootId"
      v-model:export-start-code="exportStartCode"
      @select-proband="id => emit('select-proband', id)"
    />

    <!-- Modul-Ansicht 4: Standardkonformer GEDCOM 5.5.1 Export -->
    <GedcomExportPane
      v-else-if="activeExportModuleTab === 'gedcom'"
      :persons="persons"
      :active-proband-id="activeProbandId"
    />

    <!-- Modul-Ansicht 5: Tabellen-Export (CSV) -->
    <CsvExportPane
      v-else-if="activeExportModuleTab === 'csv'"
      :persons="persons"
      :active-proband-id="activeProbandId"
    />
  </div>
</template>

<style scoped>
.export-module-container {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  overflow: hidden;
}

/* Modul-Kopfzeile */
.export-module-header {
  height: 44px;
  min-height: 44px;
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  gap: 16px;
  z-index: 15;
}

.module-badge {
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #3b82f6;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  padding: 3px 8px;
  border-radius: 4px;
}

.export-module-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  background: #f1f5f9;
  padding: 3px;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
}

.module-tab-btn {
  border: none;
  background: transparent;
  padding: 5px 12px;
  border-radius: 4px;
  font-size: 0.8rem;
  font-weight: 600;
  color: #64748b;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.module-tab-btn:hover:not(.disabled-tab) {
  color: #1e293b;
  background: rgba(255, 255, 255, 0.6);
}

.module-tab-btn.active {
  background: #ffffff;
  color: #1e293b;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

/* Platzhalter für CSV / GEDCOM */
.export-module-placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
  background: #f8fafc;
}

.placeholder-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 36px 48px;
  text-align: center;
  max-width: 480px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04);
}

.placeholder-card h3 {
  font-size: 1.25rem;
  font-weight: 700;
  color: #0f172a;
  margin: 0 0 10px 0;
}

.placeholder-card p {
  font-size: 0.88rem;
  color: #64748b;
  line-height: 1.5;
  margin: 0 0 20px 0;
}

.btn-back-to-html {
  padding: 8px 16px;
  background: #3b82f6;
  border: none;
  border-radius: 6px;
  color: #ffffff;
  font-size: 0.84rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease;
}

.btn-back-to-html:hover {
  background: #2563eb;
}
</style>
