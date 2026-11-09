<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';

export interface DeletePersonTarget {
  type: 'person' | 'branch';
  id: string;
  name: string;
  personIds: string[];
}

const props = defineProps<{
  visible: boolean;
  target: DeletePersonTarget | null;
  isDeleting?: boolean;
}>();

const emit = defineEmits<{
  cancel: [];
  confirm: [personIds: string[]];
}>();

const { t } = useI18n();

const deleteModalStep = ref<1 | 2>(1);
const cancelDeleteBtn1 = ref<HTMLButtonElement | null>(null);
const cancelDeleteBtn2 = ref<HTMLButtonElement | null>(null);

function focusCancelButton() {
  nextTick(() => {
    setTimeout(() => {
      if (deleteModalStep.value === 1 && cancelDeleteBtn1.value) {
        cancelDeleteBtn1.value.focus();
      } else if (deleteModalStep.value === 2 && cancelDeleteBtn2.value) {
        cancelDeleteBtn2.value.focus();
      }
    }, 50);
  });
}

watch(
  () => props.visible,
  newVal => {
    if (newVal) {
      deleteModalStep.value = 1;
      focusCancelButton();
    }
  },
  { immediate: true }
);

function proceedDeleteStep2() {
  deleteModalStep.value = 2;
  focusCancelButton();
}

function handleCancel() {
  deleteModalStep.value = 1;
  emit('cancel');
}

function handleConfirm() {
  if (!props.target || !props.target.personIds.length) return;
  emit('confirm', props.target.personIds);
}
</script>

<template>
  <div
    v-if="visible && target"
    class="modal-overlay delete-modal-overlay"
    @click.self="handleCancel"
    @keydown.esc="handleCancel"
  >
    <div class="modal-content delete-modal">
      <!-- Schritt 1: Sicherheitsabfrage mit Details -->
      <div v-if="deleteModalStep === 1">
        <h2>
          ⚠️
          {{
            target.type === 'branch'
              ? t('delete_branch_title', 'Zweig aus Datenbank entfernen')
              : t('delete_person_title', 'Person aus Datenbank entfernen')
          }}
        </h2>

        <p class="delete-msg">
          <template v-if="target.type === 'branch'">
            Möchten Sie diesen isolierten Zweig mit <strong>{{ target.personIds.length }} Personen</strong> (Ausgangspunkt: <em>{{ target.name }}</em>) wirklich aus der Datenbank entfernen?
          </template>
          <template v-else>
            Soll der Eintrag <strong>&laquo;{{ target.name }}&raquo;</strong> wirklich aus der Datenbank entfernt werden?
          </template>
        </p>

        <div class="delete-info-box">
          <div class="info-row">
            <span class="info-icon">💾</span>
            <span>{{ t('delete_backup_notice', 'Vor dem Löschen wird automatisch eine Sicherungskopie (.bak) der Datenbank erstellt.') }}</span>
          </div>
          <div class="info-row">
            <span class="info-icon">🔗</span>
            <span>{{ t('delete_relations_notice', 'Bestehende Eltern- und Ehe-Verknüpfungen dieser Person(en) werden sauber aufgelöst.') }}</span>
          </div>
        </div>

        <div class="modal-actions-delete">
          <button
            class="btn-confirm-plain"
            @click="proceedDeleteStep2"
            :disabled="isDeleting"
          >
            {{ t('continue', 'Weiter') }}
          </button>
          <button
            ref="cancelDeleteBtn1"
            class="btn-cancel-highlight"
            @click="handleCancel"
            autofocus
          >
            {{ t('cancel', 'Abbrechen') }}
          </button>
        </div>
      </div>

      <!-- Schritt 2: Endgültige Bestätigung -->
      <div v-else-if="deleteModalStep === 2">
        <h2 class="danger-title">
          🚨
          {{
            target.type === 'branch'
              ? t('delete_branch_final_title', 'Zweig endgültig löschen')
              : t('delete_person_final_title', 'Person endgültig löschen')
          }}
        </h2>

        <p class="delete-msg danger-text">
          <template v-if="target.type === 'branch'">
            Achtung: Alle <strong>{{ target.personIds.length }} Personen</strong> dieses Zweigs werden unwiderruflich aus der Datenbank gelöscht!
          </template>
          <template v-else>
            Achtung: Der Eintrag <strong>&laquo;{{ target.name }}&raquo;</strong> wird unwiderruflich aus der Datenbank gelöscht!
          </template>
        </p>

        <div class="modal-actions-delete">
          <button
            class="btn-confirm-danger"
            @click="handleConfirm"
            :disabled="isDeleting"
          >
            {{ isDeleting ? t('deleting', 'Wird gelöscht...') : t('delete_confirm_btn', 'Endgültig löschen') }}
          </button>
          <button
            ref="cancelDeleteBtn2"
            class="btn-cancel-highlight"
            @click="handleCancel"
            autofocus
            :disabled="isDeleting"
          >
            {{ t('cancel', 'Abbrechen') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.delete-modal-overlay {
  position: fixed;
  inset: 0;
  background-color: rgba(15, 23, 42, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(2px);
}

.delete-modal {
  background: #ffffff;
  border-radius: 12px;
  width: 90%;
  max-width: 480px;
  padding: 24px 28px;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.08);
  border: 1px solid #fee2e2;
}

.delete-modal h2 {
  margin: 0 0 12px 0;
  font-size: 1.25rem;
  font-weight: 700;
  color: #b91c1c;
  display: flex;
  align-items: center;
  gap: 8px;
}

.delete-modal h2.danger-title {
  color: #991b1b;
}

.delete-msg {
  font-size: 0.95rem;
  line-height: 1.5;
  color: #334155;
  margin-bottom: 16px;
}

.danger-text {
  color: #b91c1c;
  font-weight: 500;
}

.delete-info-box {
  background-color: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 0.85rem;
  color: #475569;
}

.info-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  line-height: 1.4;
}

.info-icon {
  font-size: 1rem;
}

.modal-actions-delete {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.btn-confirm-plain {
  padding: 8px 16px;
  font-size: 0.9rem;
  font-weight: 600;
  color: #b91c1c;
  background-color: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease-in-out;
}

.btn-confirm-plain:hover:not(:disabled) {
  background-color: #fee2e2;
  border-color: #fca5a5;
}

.btn-confirm-danger {
  padding: 8px 16px;
  font-size: 0.9rem;
  font-weight: 600;
  color: #ffffff;
  background-color: #dc2626;
  border: 1px solid #b91c1c;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease-in-out;
}

.btn-confirm-danger:hover:not(:disabled) {
  background-color: #b91c1c;
}

.btn-cancel-highlight {
  padding: 8px 18px;
  font-size: 0.9rem;
  font-weight: 600;
  color: #ffffff;
  background-color: #0284c7;
  border: 1px solid #0369a1;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease-in-out;
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
}

.btn-cancel-highlight:hover:not(:disabled) {
  background-color: #0369a1;
}

.btn-confirm-plain:disabled,
.btn-confirm-danger:disabled,
.btn-cancel-highlight:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
