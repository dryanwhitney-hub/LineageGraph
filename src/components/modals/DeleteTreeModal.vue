<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  visible: boolean;
  treeName: string;
}>();

const emit = defineEmits<{
  cancel: [];
  confirm: [];
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
  emit('confirm');
}
</script>

<template>
  <div
    v-if="visible"
    class="modal-overlay delete-modal-overlay"
    @click.self="handleCancel"
    @keydown.esc="handleCancel"
  >
    <div class="modal-content delete-modal">
      <div v-if="deleteModalStep === 1">
        <h2>⚠️ {{ t('delete_tree_title') }}</h2>
        <p class="delete-msg">
          Soll der ausgewählte Stammbaum <strong>&laquo;{{ treeName }}&raquo;</strong> entfernt werden?
        </p>
        <div class="modal-actions-delete">
          <button class="btn-confirm-plain" @click="proceedDeleteStep2">
            {{ t('confirm') }}
          </button>
          <button
            ref="cancelDeleteBtn1"
            class="btn-cancel-highlight"
            @click="handleCancel"
            autofocus
          >
            {{ t('cancel') }}
          </button>
        </div>
      </div>

      <div v-else-if="deleteModalStep === 2">
        <h2>🚨 {{ t('delete_tree_final_title') }}</h2>
        <p class="delete-msg danger-text">
          Der ausgewählte Stammbaum <strong>&laquo;{{ treeName }}&raquo;</strong> wird endgültig entfernt.
        </p>
        <div class="modal-actions-delete">
          <button class="btn-confirm-danger" @click="handleConfirm">
            {{ t('confirm') }}
          </button>
          <button
            ref="cancelDeleteBtn2"
            class="btn-cancel-highlight"
            @click="handleCancel"
            autofocus
          >
            {{ t('cancel') }}
          </button>
        </div>
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
.delete-modal-overlay {
  z-index: 1200 !important;
  background: rgba(0, 0, 0, 0.65) !important;
}
.delete-modal {
  width: 480px;
  text-align: center;
}
.delete-msg {
  font-size: 1.05rem;
  line-height: 1.5;
  margin: 1.5rem 0;
  color: #2c3e50;
}
.danger-text {
  color: #c0392b;
  font-weight: bold;
  font-size: 1.1rem;
}
.modal-actions-delete {
  display: flex;
  justify-content: center;
  gap: 1.5rem;
  margin-top: 1.5rem;
  align-items: center;
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
.btn-confirm-plain {
  background-color: #f1f5f9;
  color: #475569;
  border: 1px solid #cbd5e1;
  font-weight: 600;
  padding: 0.55rem 1.2rem;
  border-radius: 6px;
  transition: all 0.15s ease;
}
.btn-confirm-plain:hover {
  background-color: #fee2e2;
  border-color: #fca5a5;
  color: #b91c1c;
}
.btn-confirm-danger {
  background-color: #dc2626;
  color: white;
  font-weight: 600;
  padding: 0.55rem 1.2rem;
  border: 1px solid #b91c1c;
  border-radius: 6px;
  transition: background 0.15s ease;
}
.btn-confirm-danger:hover {
  background-color: #b91c1c;
}
.btn-cancel-highlight {
  background-color: #2563eb !important;
  color: white !important;
  font-weight: 600;
  font-size: 0.92rem !important;
  padding: 0.55rem 1.4rem !important;
  border: 1px solid #1d4ed8 !important;
  border-radius: 6px;
  box-shadow: 0 1px 3px rgba(37, 99, 235, 0.25);
  cursor: pointer;
  transition: background 0.15s ease, box-shadow 0.15s ease;
}
.btn-cancel-highlight:hover {
  background-color: #1d4ed8 !important;
}
.btn-cancel-highlight:focus {
  outline: 2px solid #93c5fd !important;
  outline-offset: 2px;
}
</style>

