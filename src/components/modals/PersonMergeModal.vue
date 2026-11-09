<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { invoke } from '@tauri-apps/api/core';
import type { Person, PersonMergeFieldsDto, PersonEventDto, SpouseResolution } from '../../composables/usePersons';

const props = defineProps<{
  visible: boolean;
  targetPerson: Person | null;
  sourcePerson: Person | null;
  allPersons: Person[];
  isMerging?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  confirm: [payload: { targetId: string; sourceId: string; fields: PersonMergeFieldsDto }];
}>();

const { t } = useI18n();

// Lokale Rollen: können getauscht werden
const currentTarget = ref<Person | null>(null);
const currentSource = ref<Person | null>(null);

// Feldauswahl
const selectedGivenName = ref<'target' | 'source'>('target');
const selectedSurname = ref<'target' | 'source'>('target');
const selectedSex = ref<'target' | 'source'>('target');
const selectedBirthDate = ref<'target' | 'source'>('target');
const selectedBirthPlace = ref<'target' | 'source'>('target');
const selectedDeathDate = ref<'target' | 'source'>('target');
const selectedDeathPlace = ref<'target' | 'source'>('target');
const selectedParents = ref<'target' | 'source' | 'none'>('target');

// Ehepartner-Auflösung
const spouseResolutions = ref<{ spouseId: string; spouseName: string; choice: 'merge' | 'keep_separate' }[]>([]);

// Ereignisse
const isLoadingEvents = ref<boolean>(false);
const targetEvents = ref<PersonEventDto[]>([]);
const sourceEvents = ref<PersonEventDto[]>([]);
const selectedEventIds = ref<Set<string>>(new Set());

// Notiz / Revisionsprotokoll
const auditNote = ref<string>('');
const isCustomNote = ref<boolean>(false);

function swapRoles() {
  const temp = currentTarget.value;
  currentTarget.value = currentSource.value;
  currentSource.value = temp;
  initFieldSelections();
  loadEvents();
}

function initFieldSelections() {
  if (!currentTarget.value || !currentSource.value) return;
  const t = currentTarget.value;
  const s = currentSource.value;

  selectedGivenName.value = !t.given_name && s.given_name ? 'source' : 'target';
  selectedSurname.value = !t.surname && s.surname ? 'source' : 'target';
  selectedSex.value = !t.sex && s.sex ? 'source' : 'target';
  selectedBirthDate.value = !t.birth_date && s.birth_date ? 'source' : 'target';
  selectedBirthPlace.value = !t.birth_place && s.birth_place ? 'source' : 'target';
  selectedDeathDate.value = !t.death_date && s.death_date ? 'source' : 'target';
  selectedDeathPlace.value = !t.death_place && s.death_place ? 'source' : 'target';

  if (t.parent_ids.length === 0 && s.parent_ids.length > 0) {
    selectedParents.value = 'source';
  } else {
    selectedParents.value = 'target';
  }

  // Doppelte Ehepartner prüfen
  const tSpouses = new Set(t.spouses.map(sp => sp.id));
  const resolutions: { spouseId: string; spouseName: string; choice: 'merge' | 'keep_separate' }[] = [];

  for (const sSpouse of s.spouses) {
    if (sSpouse.id === t.id) continue; // Selbst-Heirat ignorieren
    if (tSpouses.has(sSpouse.id)) {
      const spouseObj = props.allPersons.find(p => p.id === sSpouse.id);
      const sName = spouseObj ? `${spouseObj.given_name || ''} ${spouseObj.surname || ''} (${spouseObj.id})` : sSpouse.id;
      resolutions.push({
        spouseId: sSpouse.id,
        spouseName: sName,
        choice: 'merge',
      });
    }
  }
  spouseResolutions.value = resolutions;

  updateGeneratedAuditNote();
}

async function loadEvents() {
  if (!currentTarget.value || !currentSource.value) return;
  isLoadingEvents.value = true;
  try {
    const [tEvs, sEvs] = await Promise.all([
      invoke<PersonEventDto[]>('get_person_events', { personId: currentTarget.value.id }),
      invoke<PersonEventDto[]>('get_person_events', { personId: currentSource.value.id }),
    ]);
    targetEvents.value = tEvs;
    sourceEvents.value = sEvs;

    // Standardmäßig alle Ziel-Events beibehalten und alle nicht-redundanten Quell-Events vor-selektieren
    const set = new Set<string>();
    tEvs.forEach(e => set.add(e.id));
    sEvs.forEach(se => {
      const duplicate = tEvs.some(
        te => te.tag === se.tag && te.date_str === se.date_str && te.place === se.place
      );
      if (!duplicate) {
        set.add(se.id);
      }
    });
    selectedEventIds.value = set;
  } catch (err) {
    console.error('Fehler beim Laden der Ereignisse für Zusammenführung:', err);
  } finally {
    isLoadingEvents.value = false;
  }
}

function updateGeneratedAuditNote() {
  if (isCustomNote.value || !currentTarget.value || !currentSource.value) return;
  const tObj = currentTarget.value;
  const sObj = currentSource.value;
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  const discarded: string[] = [];
  if (selectedGivenName.value === 'target' && sObj.given_name && sObj.given_name !== tObj.given_name) {
    discarded.push(`Vorname Quelle: "${sObj.given_name}"`);
  }
  if (selectedSurname.value === 'target' && sObj.surname && sObj.surname !== tObj.surname) {
    discarded.push(`Nachname Quelle: "${sObj.surname}"`);
  }
  if (selectedBirthDate.value === 'target' && sObj.birth_date && sObj.birth_date !== tObj.birth_date) {
    discarded.push(`Geburtsdatum Quelle: "${sObj.birth_date}"`);
  }
  if (selectedBirthPlace.value === 'target' && sObj.birth_place && sObj.birth_place !== tObj.birth_place) {
    discarded.push(`Geburtsort Quelle: "${sObj.birth_place}"`);
  }
  if (selectedDeathDate.value === 'target' && sObj.death_date && sObj.death_date !== tObj.death_date) {
    discarded.push(`Sterbedatum Quelle: "${sObj.death_date}"`);
  }
  if (selectedDeathPlace.value === 'target' && sObj.death_place && sObj.death_place !== tObj.death_place) {
    discarded.push(`Sterbeort Quelle: "${sObj.death_place}"`);
  }

  let text = `Zusammengeführt mit ${sObj.given_name || ''} ${sObj.surname || ''} (${sObj.id}) am ${now}.`;
  if (discarded.length > 0) {
    text += ` Abweichende Quellwerte: ${discarded.join(', ')}.`;
  }
  auditNote.value = text;
}

watch(
  () => props.visible,
  newVal => {
    if (newVal) {
      currentTarget.value = props.targetPerson;
      currentSource.value = props.sourcePerson;
      isCustomNote.value = false;
      initFieldSelections();
      loadEvents();
    }
  },
  { immediate: true }
);

function toggleEvent(id: string) {
  if (selectedEventIds.value.has(id)) {
    selectedEventIds.value.delete(id);
  } else {
    selectedEventIds.value.add(id);
  }
}

function handleConfirm() {
  if (!currentTarget.value || !currentSource.value) return;

  const tObj = currentTarget.value;
  const sObj = currentSource.value;

  const given_name = selectedGivenName.value === 'source' ? sObj.given_name : tObj.given_name;
  const surname = selectedSurname.value === 'source' ? sObj.surname : tObj.surname;
  const sex = selectedSex.value === 'source' ? sObj.sex : tObj.sex;
  const birth_date = selectedBirthDate.value === 'source' ? sObj.birth_date : tObj.birth_date;
  const birth_place = selectedBirthPlace.value === 'source' ? sObj.birth_place : tObj.birth_place;
  const death_date = selectedDeathDate.value === 'source' ? sObj.death_date : tObj.death_date;
  const death_place = selectedDeathPlace.value === 'source' ? sObj.death_place : tObj.death_place;

  const spouse_resolutions: SpouseResolution[] = spouseResolutions.value.map(r => ({
    partner_id: r.spouseId,
    resolution: r.choice,
  }));

  const selected_event_ids = Array.from(selectedEventIds.value);

  const fields: PersonMergeFieldsDto = {
    given_name,
    surname,
    sex,
    birth_date,
    birth_place,
    death_date,
    death_place,
    parent_family_source: selectedParents.value,
    spouse_resolutions,
    selected_event_ids,
    audit_note: auditNote.value.trim() ? auditNote.value.trim() : undefined,
  };

  emit('confirm', {
    targetId: tObj.id,
    sourceId: sObj.id,
    fields,
  });
}

function getParentsSummary(person: Person | null): string {
  if (!person || !person.parent_ids.length) return t('no_parents', 'Keine');
  return person.parent_ids
    .map(pId => {
      const p = props.allPersons.find(item => item.id === pId);
      return p ? `${p.given_name || ''} ${p.surname || ''}`.trim() || pId : pId;
    })
    .join(', ');
}
</script>

<template>
  <div
    v-if="visible && currentTarget && currentSource"
    class="modal-overlay merge-overlay"
    @click.self="emit('close')"
    @keydown.esc="emit('close')"
  >
    <div class="modal-content merge-modal">
      <!-- Modal Header -->
      <header class="merge-header">
        <div class="title-wrap">
          <h2>🔀 {{ t('merge_modal_title', 'Einträge selektiv zusammenführen') }}</h2>
          <p class="subtitle">
            {{ t('merge_modal_subtitle', 'Übernehmen Sie gewünschte Attribute in den Ziel-Eintrag. Der Quell-Eintrag wird nach dem Merge sauber aufgelöst.') }}
          </p>
        </div>
        <button type="button" class="btn-close" @click="emit('close')" :title="t('close', 'Schließen')">✕</button>
      </header>

      <!-- Rollen-Gegenüberstellung & Swap -->
      <div class="roles-bar">
        <div class="role-box target-box">
          <span class="role-badge target-badge">🎯 {{ t('merge_target_role', 'Ziel (Bleibt erhalten)') }}</span>
          <strong class="role-person-name">{{ currentTarget.given_name || 'N.N.' }} {{ currentTarget.surname || 'N.N.' }}</strong>
          <span class="role-id">({{ currentTarget.id }})</span>
        </div>

        <button type="button" class="btn-swap-roles" @click="swapRoles" :title="t('merge_swap_roles_tooltip', 'Rollen tauschen: Quelle und Ziel umkehren')">
          ⇄ {{ t('merge_swap_roles', 'Rollen tauschen') }}
        </button>

        <div class="role-box source-box">
          <span class="role-badge source-badge">🗑️ {{ t('merge_source_role', 'Quelle (Wird aufgelöst)') }}</span>
          <strong class="role-person-name">{{ currentSource.given_name || 'N.N.' }} {{ currentSource.surname || 'N.N.' }}</strong>
          <span class="role-id">({{ currentSource.id }})</span>
        </div>
      </div>

      <!-- Scrollable Comparison Area -->
      <div class="merge-scroll-area">
        <!-- 1. Stammdaten -->
        <section class="merge-section">
          <h3 class="section-title">👤 {{ t('merge_attributes_title', 'Stammdaten & Lebensereignisse') }}</h3>
          
          <table class="merge-table">
            <thead>
              <tr>
                <th class="col-field">{{ t('field', 'Feld') }}</th>
                <th class="col-choice">{{ t('merge_target_val', 'Wert aus Ziel') }}</th>
                <th class="col-choice">{{ t('merge_source_val', 'Wert aus Quelle') }}</th>
              </tr>
            </thead>
            <tbody>
              <!-- Vorname -->
              <tr :class="{ 'row-diff': currentTarget.given_name !== currentSource.given_name }">
                <td class="field-label">{{ t('first_name', 'Vorname') }}</td>
                <td>
                  <label class="radio-label">
                    <input type="radio" value="target" v-model="selectedGivenName" @change="updateGeneratedAuditNote" />
                    <span class="val-text">{{ currentTarget.given_name || '—' }}</span>
                  </label>
                </td>
                <td>
                  <label class="radio-label">
                    <input type="radio" value="source" v-model="selectedGivenName" @change="updateGeneratedAuditNote" />
                    <span class="val-text">{{ currentSource.given_name || '—' }}</span>
                  </label>
                </td>
              </tr>

              <!-- Nachname -->
              <tr :class="{ 'row-diff': currentTarget.surname !== currentSource.surname }">
                <td class="field-label">{{ t('last_name', 'Nachname') }}</td>
                <td>
                  <label class="radio-label">
                    <input type="radio" value="target" v-model="selectedSurname" @change="updateGeneratedAuditNote" />
                    <span class="val-text">{{ currentTarget.surname || '—' }}</span>
                  </label>
                </td>
                <td>
                  <label class="radio-label">
                    <input type="radio" value="source" v-model="selectedSurname" @change="updateGeneratedAuditNote" />
                    <span class="val-text">{{ currentSource.surname || '—' }}</span>
                  </label>
                </td>
              </tr>

              <!-- Geschlecht -->
              <tr :class="{ 'row-diff': currentTarget.sex !== currentSource.sex }">
                <td class="field-label">{{ t('sex', 'Geschlecht') }}</td>
                <td>
                  <label class="radio-label">
                    <input type="radio" value="target" v-model="selectedSex" @change="updateGeneratedAuditNote" />
                    <span class="val-text">{{ currentTarget.sex || '—' }}</span>
                  </label>
                </td>
                <td>
                  <label class="radio-label">
                    <input type="radio" value="source" v-model="selectedSex" @change="updateGeneratedAuditNote" />
                    <span class="val-text">{{ currentSource.sex || '—' }}</span>
                  </label>
                </td>
              </tr>

              <!-- Geburtsdatum -->
              <tr :class="{ 'row-diff': currentTarget.birth_date !== currentSource.birth_date }">
                <td class="field-label">{{ t('birth_date', 'Geburtsdatum') }}</td>
                <td>
                  <label class="radio-label">
                    <input type="radio" value="target" v-model="selectedBirthDate" @change="updateGeneratedAuditNote" />
                    <span class="val-text">{{ currentTarget.birth_date || '—' }}</span>
                  </label>
                </td>
                <td>
                  <label class="radio-label">
                    <input type="radio" value="source" v-model="selectedBirthDate" @change="updateGeneratedAuditNote" />
                    <span class="val-text">{{ currentSource.birth_date || '—' }}</span>
                  </label>
                </td>
              </tr>

              <!-- Geburtsort -->
              <tr :class="{ 'row-diff': currentTarget.birth_place !== currentSource.birth_place }">
                <td class="field-label">{{ t('birth_place', 'Geburtsort') }}</td>
                <td>
                  <label class="radio-label">
                    <input type="radio" value="target" v-model="selectedBirthPlace" @change="updateGeneratedAuditNote" />
                    <span class="val-text">{{ currentTarget.birth_place || '—' }}</span>
                  </label>
                </td>
                <td>
                  <label class="radio-label">
                    <input type="radio" value="source" v-model="selectedBirthPlace" @change="updateGeneratedAuditNote" />
                    <span class="val-text">{{ currentSource.birth_place || '—' }}</span>
                  </label>
                </td>
              </tr>

              <!-- Sterbedatum -->
              <tr :class="{ 'row-diff': currentTarget.death_date !== currentSource.death_date }">
                <td class="field-label">{{ t('death_date', 'Sterbedatum') }}</td>
                <td>
                  <label class="radio-label">
                    <input type="radio" value="target" v-model="selectedDeathDate" @change="updateGeneratedAuditNote" />
                    <span class="val-text">{{ currentTarget.death_date || '—' }}</span>
                  </label>
                </td>
                <td>
                  <label class="radio-label">
                    <input type="radio" value="source" v-model="selectedDeathDate" @change="updateGeneratedAuditNote" />
                    <span class="val-text">{{ currentSource.death_date || '—' }}</span>
                  </label>
                </td>
              </tr>

              <!-- Sterbeort -->
              <tr :class="{ 'row-diff': currentTarget.death_place !== currentSource.death_place }">
                <td class="field-label">{{ t('death_place', 'Sterbeort') }}</td>
                <td>
                  <label class="radio-label">
                    <input type="radio" value="target" v-model="selectedDeathPlace" @change="updateGeneratedAuditNote" />
                    <span class="val-text">{{ currentTarget.death_place || '—' }}</span>
                  </label>
                </td>
                <td>
                  <label class="radio-label">
                    <input type="radio" value="source" v-model="selectedDeathPlace" @change="updateGeneratedAuditNote" />
                    <span class="val-text">{{ currentSource.death_place || '—' }}</span>
                  </label>
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <!-- 2. Elternverhältnisse -->
        <section class="merge-section">
          <h3 class="section-title">👨‍👩‍👦 {{ t('merge_parents_title', 'Elternverhältnis') }}</h3>
          <div class="parents-selector-grid">
            <label class="choice-card" :class="{ active: selectedParents === 'target' }">
              <input type="radio" value="target" v-model="selectedParents" />
              <div class="card-content">
                <strong>{{ t('merge_keep_target_parents', 'Eltern von Zielperson behalten') }}</strong>
                <span class="card-sub">{{ getParentsSummary(currentTarget) }}</span>
              </div>
            </label>

            <label class="choice-card" :class="{ active: selectedParents === 'source' }">
              <input type="radio" value="source" v-model="selectedParents" />
              <div class="card-content">
                <strong>{{ t('merge_adopt_source_parents', 'Eltern von Quellperson übernehmen') }}</strong>
                <span class="card-sub">{{ getParentsSummary(currentSource) }}</span>
              </div>
            </label>

            <label class="choice-card" :class="{ active: selectedParents === 'none' }">
              <input type="radio" value="none" v-model="selectedParents" />
              <div class="card-content">
                <strong>{{ t('merge_no_parents', 'Keine Eltern (Verknüpfung lösen)') }}</strong>
                <span class="card-sub">—</span>
              </div>
            </label>
          </div>
        </section>

        <!-- 3. Ehepartner-Konfliktlösung (falls übereinstimmende Partner existieren) -->
        <section v-if="spouseResolutions.length > 0" class="merge-section">
          <h3 class="section-title">⚭ {{ t('merge_spouses_title', 'Gemeinsame Ehepartner auflösen') }}</h3>
          <p class="section-hint">
            {{ t('merge_spouses_hint', 'Beide Personen sind mit denselben Partnern verknüpft. Bitte wählen Sie, wie diese aufgelöst werden:') }}
          </p>
          <div v-for="res in spouseResolutions" :key="res.spouseId" class="spouse-res-card">
            <div class="spouse-info">
              <strong>⚭ {{ res.spouseName }}</strong>
            </div>
            <div class="spouse-options">
              <label class="radio-label">
                <input type="radio" value="merge" v-model="res.choice" />
                <span>{{ t('merge_spouses_combine', 'Ehen zu einer gemeinsamen Ehe zusammenführen') }}</span>
              </label>
              <label class="radio-label">
                <input type="radio" value="keep_separate" v-model="res.choice" />
                <span>{{ t('merge_spouses_separate', 'Als separate Ehen beibehalten') }}</span>
              </label>
            </div>
          </div>
        </section>

        <!-- 4. Ereignisse & Findings -->
        <section class="merge-section">
          <h3 class="section-title">📅 {{ t('merge_events_title', 'Ereignisse & Findings übernehmen') }}</h3>
          <div v-if="isLoadingEvents" class="events-loading">
            <span>⏳ {{ t('loading_events', 'Ereignisse werden geladen...') }}</span>
          </div>
          <div v-else-if="targetEvents.length === 0 && sourceEvents.length === 0" class="events-empty">
            <em>{{ t('no_events', 'Keine zusätzlichen Ereignisse erfasst.') }}</em>
          </div>
          <div v-else class="events-checklist">
            <div
              v-for="ev in [...targetEvents, ...sourceEvents]"
              :key="ev.id"
              class="event-check-row"
              :class="{ selected: selectedEventIds.has(ev.id) }"
              @click="toggleEvent(ev.id)"
            >
              <input
                type="checkbox"
                :checked="selectedEventIds.has(ev.id)"
                @click.stop="toggleEvent(ev.id)"
              />
              <span class="event-badge" :class="targetEvents.some(te => te.id === ev.id) ? 'badge-t' : 'badge-s'">
                {{ targetEvents.some(te => te.id === ev.id) ? t('merge_target_short', 'Ziel') : t('merge_source_short', 'Quelle') }}
              </span>
              <span class="event-type"><strong>{{ ev.tag }}</strong></span>
              <span class="event-date-place">{{ ev.date_str || '' }} {{ ev.place ? `(${ev.place})` : '' }}</span>
              <span v-if="ev.description" class="event-desc">{{ ev.description }}</span>
            </div>
          </div>
        </section>

        <!-- 5. Revisionsprotokoll & Notiz -->
        <section class="merge-section">
          <h3 class="section-title">📝 {{ t('merge_audit_title', 'Revisionsprotokoll / Notiz im Ziel-Eintrag') }}</h3>
          <textarea
            v-model="auditNote"
            @input="isCustomNote = true"
            rows="3"
            class="audit-textarea"
            :placeholder="t('merge_audit_placeholder', 'Notiz zur Nachvollziehbarkeit des Merges...')"
          ></textarea>
        </section>
      </div>

      <!-- Modal Footer -->
      <footer class="merge-footer">
        <div class="footer-left">
          <span class="backup-badge">💾 {{ t('merge_backup_notice', 'Automatische .bak-Sicherung aktiv') }}</span>
        </div>
        <div class="footer-right">
          <button type="button" class="btn-cancel" @click="emit('close')" :disabled="isMerging">
            {{ t('cancel', 'Abbrechen') }}
          </button>
          <button
            type="button"
            class="btn-merge-confirm"
            @click="handleConfirm"
            :disabled="isMerging"
          >
            {{ isMerging ? t('merging', 'Wird zusammengeführt...') : t('merge_execute_btn', '🔀 Zusammenführen & Quelle löschen') }}
          </button>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.merge-overlay {
  position: fixed;
  inset: 0;
  background-color: rgba(15, 23, 42, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(2px);
}

.merge-modal {
  background: #ffffff;
  border-radius: 12px;
  width: 92%;
  max-width: 860px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
  border: 1px solid #cbd5e1;
  overflow: hidden;
}

.merge-header {
  padding: 16px 20px;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  background: #f8fafc;
}

.merge-header h2 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
  color: #0f172a;
}

.subtitle {
  margin: 4px 0 0 0;
  font-size: 0.85rem;
  color: #64748b;
}

.btn-close {
  background: none;
  border: none;
  font-size: 1.2rem;
  color: #94a3b8;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
}

.btn-close:hover {
  color: #0f172a;
  background: #e2e8f0;
}

.roles-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: #f1f5f9;
  border-bottom: 1px solid #e2e8f0;
  gap: 12px;
}

.role-box {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 12px;
  border-radius: 8px;
  background: #ffffff;
  border: 1px solid #cbd5e1;
}

.target-box {
  border-color: #93c5fd;
  background: #eff6ff;
}

.source-box {
  border-color: #fca5a5;
  background: #fff1f2;
}

.role-badge {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.target-badge {
  color: #1d4ed8;
}

.source-badge {
  color: #b91c1c;
}

.role-person-name {
  font-size: 0.95rem;
  color: #0f172a;
}

.role-id {
  font-size: 0.78rem;
  color: #64748b;
}

.btn-swap-roles {
  padding: 8px 14px;
  font-size: 0.85rem;
  font-weight: 600;
  color: #0369a1;
  background: #e0f2fe;
  border: 1px solid #bae6fd;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;
}

.btn-swap-roles:hover {
  background: #bae6fd;
}

.merge-scroll-area {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.merge-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
  color: #334155;
}

.section-hint {
  margin: 0;
  font-size: 0.82rem;
  color: #64748b;
}

.merge-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  overflow: hidden;
}

.merge-table th {
  background: #f8fafc;
  padding: 8px 12px;
  text-align: left;
  font-weight: 600;
  color: #475569;
  border-bottom: 1px solid #e2e8f0;
}

.merge-table td {
  padding: 8px 12px;
  border-bottom: 1px solid #f1f5f9;
  vertical-align: middle;
}

.col-field {
  width: 25%;
}

.col-choice {
  width: 37.5%;
}

.field-label {
  font-weight: 600;
  color: #334155;
}

.row-diff {
  background-color: #fffbeb;
}

.radio-label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
}

.val-text {
  color: #0f172a;
  word-break: break-word;
}

.parents-selector-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.choice-card {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  cursor: pointer;
  transition: all 0.15s ease;
}

.choice-card.active {
  border-color: #0284c7;
  background: #f0f9ff;
}

.card-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 0.85rem;
}

.card-sub {
  font-size: 0.78rem;
  color: #64748b;
}

.spouse-res-card {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.spouse-options {
  display: flex;
  gap: 16px;
  font-size: 0.85rem;
}

.events-checklist {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 180px;
  overflow-y: auto;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 8px;
  background: #ffffff;
}

.event-check-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.82rem;
  background: #f8fafc;
  transition: background 0.1s ease;
}

.event-check-row:hover {
  background: #f1f5f9;
}

.event-check-row.selected {
  background: #eff6ff;
}

.event-badge {
  font-size: 0.7rem;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
}

.badge-t {
  background: #dbeafe;
  color: #1e40af;
}

.badge-s {
  background: #fee2e2;
  color: #991b1b;
}

.event-type {
  color: #0f172a;
}

.event-date-place {
  color: #475569;
}

.event-desc {
  color: #64748b;
  font-style: italic;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.audit-textarea {
  width: 100%;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 0.85rem;
  color: #334155;
  font-family: inherit;
  resize: vertical;
}

.audit-textarea:focus {
  outline: none;
  border-color: #0284c7;
  box-shadow: 0 0 0 2px rgba(2, 132, 199, 0.15);
}

.merge-footer {
  padding: 12px 20px;
  border-top: 1px solid #e2e8f0;
  background: #f8fafc;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.backup-badge {
  font-size: 0.78rem;
  color: #64748b;
  display: flex;
  align-items: center;
  gap: 4px;
}

.footer-right {
  display: flex;
  gap: 10px;
}

.btn-cancel {
  padding: 8px 16px;
  font-size: 0.88rem;
  font-weight: 600;
  color: #475569;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-cancel:hover:not(:disabled) {
  background: #f1f5f9;
}

.btn-merge-confirm {
  padding: 8px 18px;
  font-size: 0.88rem;
  font-weight: 600;
  color: #ffffff;
  background: #0284c7;
  border: 1px solid #0369a1;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.btn-merge-confirm:hover:not(:disabled) {
  background: #0369a1;
}

.btn-cancel:disabled,
.btn-merge-confirm:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
