<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { renderReleaseNotesHtml, formatReleaseDate } from '../../utils/releaseNotes';

const props = defineProps<{
  visible: boolean;
  version: string;
  releaseNotes?: string;
  releaseDate?: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { t, locale } = useI18n();

const formattedReleaseNotes = computed(() =>
  renderReleaseNotesHtml(props.releaseNotes || '')
);

const formattedReleaseDate = computed(() =>
  formatReleaseDate(props.releaseDate, locale.value)
);

function handleKeydown(event: KeyboardEvent) {
  if (props.visible && event.key === 'Escape') {
    emit('close');
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <div v-if="visible" class="modal-overlay" @click.self="emit('close')">
    <div
      class="modal-content whats-new-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="whats-new-title"
    >
      <div class="whats-new-header">
        <div class="whats-new-icon">🎉</div>
        <div class="whats-new-title-wrap">
          <h2 id="whats-new-title">
            {{ t('whats_new_title', { version }) }}
          </h2>
          <span v-if="formattedReleaseDate" class="whats-new-date">
            {{ formattedReleaseDate }}
          </span>
        </div>
        <button
          type="button"
          class="btn-close-icon"
          @click="emit('close')"
          :aria-label="t('close')"
          :title="t('close')"
        >
          ✕
        </button>
      </div>

      <div class="whats-new-body">
        <div class="release-notes-box">
          <div class="release-notes-markdown" v-html="formattedReleaseNotes"></div>
        </div>
      </div>

      <div class="whats-new-footer">
        <button type="button" class="btn-primary" @click="emit('close')">
          {{ t('whats_new_close_btn') }}
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
  background: rgba(15, 23, 42, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9998;
  backdrop-filter: blur(2px);
}

.whats-new-modal {
  background: #ffffff;
  border-radius: 12px;
  width: 90%;
  max-width: 540px;
  box-shadow: 0 12px 35px rgba(15, 23, 42, 0.25);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.whats-new-header {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  padding: 1.15rem 1.4rem;
  background: linear-gradient(135deg, #eff6ff 0%, #f8fafc 100%);
  border-bottom: 1px solid #cbd5e1;
}

.whats-new-icon {
  font-size: 1.8rem;
  line-height: 1;
}

.whats-new-title-wrap {
  flex-grow: 1;
}

.whats-new-title-wrap h2 {
  margin: 0;
  font-size: 1.15rem;
  color: #0f172a;
}

.whats-new-date {
  display: inline-block;
  margin-top: 2px;
  font-size: 0.78rem;
  color: #64748b;
}

.btn-close-icon {
  background: transparent;
  border: none;
  font-size: 1.2rem;
  color: #64748b;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}

.btn-close-icon:hover {
  background: #e2e8f0;
  color: #0f172a;
}

.whats-new-body {
  padding: 1.15rem 1.4rem;
}

.release-notes-box {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 0.9rem 1.1rem;
  max-height: 320px;
  overflow-y: auto;
}

.release-notes-markdown {
  font-size: 0.88rem;
  line-height: 1.5;
  color: #334155;
}

.release-notes-markdown :deep(h3) {
  margin: 0.75rem 0 0.35rem 0;
  font-size: 0.95rem;
  color: #0f172a;
}

.release-notes-markdown :deep(h3:first-child),
.release-notes-markdown :deep(h4:first-child),
.release-notes-markdown :deep(p:first-child),
.release-notes-markdown :deep(ul:first-child) {
  margin-top: 0;
}

.release-notes-markdown :deep(h4) {
  margin: 0.6rem 0 0.25rem 0;
  font-size: 0.88rem;
  color: #1e293b;
}

.release-notes-markdown :deep(ul) {
  margin: 0.25rem 0 0.6rem 0;
  padding-left: 1.25rem;
}

.release-notes-markdown :deep(li) {
  margin-bottom: 0.25rem;
}

.release-notes-markdown :deep(p) {
  margin: 0.35rem 0;
}

.release-notes-markdown :deep(code) {
  background: #e2e8f0;
  color: #0f172a;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 0.82em;
}

.release-notes-markdown :deep(a) {
  color: #2563eb;
  text-decoration: underline;
}

.whats-new-footer {
  display: flex;
  justify-content: flex-end;
  padding: 0.9rem 1.4rem;
  background: #f8fafc;
  border-top: 1px solid #e2e8f0;
}

.btn-primary {
  padding: 0.5rem 1.25rem;
  background: #2563eb;
  color: #ffffff;
  border: none;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
}

.btn-primary:hover {
  background: #1d4ed8;
}
</style>
