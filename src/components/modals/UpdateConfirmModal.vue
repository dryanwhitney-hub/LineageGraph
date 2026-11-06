<script setup lang="ts">
import { useI18n } from 'vue-i18n';

defineProps<{
  visible: boolean;
  currentVersion: string;
  newVersion: string;
  releaseNotes?: string;
  releaseDate?: string;
  isDownloading: boolean;
  downloadProgress: number;
  errorMessage?: string | null;
}>();

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();

const { t } = useI18n();
</script>

<template>
  <div
    v-if="visible"
    class="modal-overlay update-modal-overlay"
    @click.self="!isDownloading && emit('cancel')"
    @keydown.esc="!isDownloading && emit('cancel')"
  >
    <div class="modal-content update-modal">
      <div class="update-header">
        <div class="update-icon">🚀</div>
        <div class="update-title-wrap">
          <h2>{{ t('updater_modal_title') }}</h2>
          <p class="update-subtitle">
            <span class="version-badge old-version">v{{ currentVersion || '...' }}</span>
            <span class="version-arrow">➔</span>
            <span class="version-badge new-version">v{{ newVersion }}</span>
          </p>
        </div>
        <button
          v-if="!isDownloading"
          class="btn-close-icon"
          @click="emit('cancel')"
          :title="t('close')"
        >
          ✕
        </button>
      </div>

      <div class="update-body">
        <p class="update-prompt">
          {{ t('updater_modal_desc', { version: newVersion }) }}
        </p>

        <div v-if="releaseNotes" class="release-notes-box">
          <div class="release-notes-header">
            <strong>{{ t('updater_release_notes') }}</strong>
            <small v-if="releaseDate" class="release-date">{{ releaseDate }}</small>
          </div>
          <pre class="release-notes-content">{{ releaseNotes }}</pre>
        </div>

        <div v-if="isDownloading" class="download-section">
          <div class="download-label-row">
            <span>{{ t('updater_downloading') }}</span>
            <span class="download-percent">{{ downloadProgress }}%</span>
          </div>
          <div class="progress-bar-track">
            <div
              class="progress-bar-fill"
              :style="{ width: `${downloadProgress}%` }"
            ></div>
          </div>
          <small class="download-hint">
            {{ downloadProgress === 100 ? t('updater_installing') : t('updater_progress', { progress: downloadProgress }) }}
          </small>
        </div>

        <div v-if="errorMessage" class="update-error-box">
          {{ t('updater_error', { error: errorMessage }) }}
        </div>
      </div>

      <div class="update-footer">
        <button
          v-if="!isDownloading"
          class="btn-secondary"
          @click="emit('cancel')"
        >
          {{ t('updater_btn_later') }}
        </button>
        <button
          v-if="!isDownloading"
          class="btn-primary"
          @click="emit('confirm')"
        >
          ✨ {{ t('updater_btn_install') }}
        </button>
        <button
          v-else
          class="btn-primary"
          disabled
        >
          ⏳ {{ downloadProgress === 100 ? t('updater_installing') : t('updater_downloading') }}
        </button>
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
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  backdrop-filter: blur(2px);
}

.update-modal {
  background: #ffffff;
  border-radius: 12px;
  width: 90%;
  max-width: 520px;
  box-shadow: 0 12px 35px rgba(0, 0, 0, 0.25);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: modal-fade-in 0.2s ease-out;
}

@keyframes modal-fade-in {
  from {
    opacity: 0;
    transform: scale(0.96) translateY(-10px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.update-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.25rem 1.5rem;
  background: linear-gradient(135deg, #f8f9fa 0%, #eef2f7 100%);
  border-bottom: 1px solid #e2e8f0;
}

.update-icon {
  font-size: 2rem;
  line-height: 1;
}

.update-title-wrap {
  flex-grow: 1;
}

.update-title-wrap h2 {
  margin: 0;
  font-size: 1.2rem;
  color: #1e293b;
}

.update-subtitle {
  margin: 0.25rem 0 0 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.version-badge {
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  font-size: 0.8rem;
  font-weight: 600;
  font-family: monospace;
}

.old-version {
  background: #e2e8f0;
  color: #475569;
}

.new-version {
  background: #dbeafe;
  color: #1d4ed8;
}

.version-arrow {
  color: #94a3b8;
  font-size: 0.85rem;
}

.btn-close-icon {
  background: transparent;
  border: none;
  font-size: 1.25rem;
  color: #64748b;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  transition: background 0.15s;
}

.btn-close-icon:hover {
  background: #e2e8f0;
  color: #0f172a;
}

.update-body {
  padding: 1.25rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  color: #334155;
}

.update-prompt {
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.5;
}

.release-notes-box {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 0.75rem 1rem;
  max-height: 160px;
  overflow-y: auto;
}

.release-notes-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
  font-size: 0.85rem;
  color: #475569;
}

.release-date {
  color: #94a3b8;
}

.release-notes-content {
  margin: 0;
  font-family: inherit;
  font-size: 0.85rem;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
  color: #334155;
}

.download-section {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  border-radius: 6px;
  padding: 0.75rem 1rem;
}

.download-label-row {
  display: flex;
  justify-content: space-between;
  font-size: 0.9rem;
  font-weight: 600;
  color: #166534;
}

.download-percent {
  font-family: monospace;
}

.progress-bar-track {
  width: 100%;
  height: 8px;
  background: #dcfce7;
  border-radius: 4px;
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: #22c55e;
  border-radius: 4px;
  transition: width 0.2s ease-in-out;
}

.download-hint {
  font-size: 0.8rem;
  color: #15803d;
}

.update-error-box {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #b91c1c;
  border-radius: 6px;
  padding: 0.6rem 0.8rem;
  font-size: 0.85rem;
}

.update-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  background: #f8fafc;
  border-top: 1px solid #e2e8f0;
}

.btn-secondary {
  padding: 0.5rem 1rem;
  background: #e2e8f0;
  color: #334155;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}

.btn-secondary:hover {
  background: #cbd5e1;
}

.btn-primary {
  padding: 0.5rem 1.25rem;
  background: #2563eb;
  color: #ffffff;
  border: none;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  transition: background 0.15s;
}

.btn-primary:hover:not(:disabled) {
  background: #1d4ed8;
}

.btn-primary:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}
</style>
