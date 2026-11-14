import { ref, shallowRef, toRaw } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { check, type Update, type DownloadEvent } from '@tauri-apps/plugin-updater';

const currentVersion = ref<string>('');
const isChecking = ref<boolean>(false);
const isDownloading = ref<boolean>(false);
const downloadProgress = ref<number>(0);
let rawUpdate: Update | null = null;
const availableUpdate = shallowRef<Update | null>(null);
const newVersion = ref<string>('');
const releaseNotes = ref<string>('');
const releaseDate = ref<string>('');
const statusMessage = ref<string | null>(null);
const statusType = ref<
  'idle' | 'checking' | 'up-to-date' | 'update-available' | 'offline' | 'error' | 'downloading'
>('idle');
const showConfirmModal = ref<boolean>(false);

const PENDING_WHATS_NEW_KEY = 'lineagegraph_pending_whats_new';
const LAST_SEEN_VERSION_KEY = 'lineagegraph_last_seen_version';

const showWhatsNewModal = ref<boolean>(false);
const whatsNewVersion = ref<string>('');
const whatsNewNotes = ref<string>('');
const whatsNewDate = ref<string>('');

export function useAppUpdater() {
  async function loadCurrentVersion(): Promise<string> {
    if (!currentVersion.value) {
      try {
        currentVersion.value = await getVersion();
      } catch {
        currentVersion.value = '0.3.0';
      }
    }
    return currentVersion.value;
  }

  async function isInternetAvailable(): Promise<boolean> {
    try {
      return await invoke<boolean>('check_internet_connection');
    } catch {
      return false;
    }
  }

  async function checkForUpdates(manual: boolean = false): Promise<boolean> {
    if (isChecking.value) return false;
    isChecking.value = true;
    statusType.value = 'checking';
    statusMessage.value = null;

    await loadCurrentVersion();

    try {
      const online = await isInternetAvailable();
      if (!online) {
        if (manual) {
          statusType.value = 'offline';
          statusMessage.value = 'offline';
        } else {
          statusType.value = 'idle';
          statusMessage.value = null;
        }
        isChecking.value = false;
        return false;
      }

      const update = await check();
      if (update) {
        rawUpdate = update;
        availableUpdate.value = update;
        newVersion.value = update.version;
        releaseNotes.value = update.body || '';
        releaseDate.value = update.date || '';
        statusType.value = 'update-available';
        statusMessage.value = `update_available:${update.version}`;
        showConfirmModal.value = true;
        isChecking.value = false;
        return true;
      } else {
        rawUpdate = null;
        availableUpdate.value = null;
        if (manual) {
          statusType.value = 'up-to-date';
          statusMessage.value = 'up_to_date';
        } else {
          statusType.value = 'idle';
          statusMessage.value = null;
        }
        isChecking.value = false;
        return false;
      }
    } catch (err: unknown) {
      if (manual) {
        statusType.value = 'error';
        const raw = err instanceof Error ? err.message : String(err);
        if (
          raw.includes('Could not fetch a valid release JSON') ||
          raw.includes('404') ||
          raw.includes('Not Found')
        ) {
          statusMessage.value = 'no_release_manifest';
        } else {
          statusMessage.value = raw;
        }
      } else {
        statusType.value = 'idle';
        statusMessage.value = null;
      }
      isChecking.value = false;
      return false;
    }
  }

  async function confirmInstall(): Promise<void> {
    const update = rawUpdate || toRaw(availableUpdate.value);
    if (!update) return;
    try {
      isDownloading.value = true;
      downloadProgress.value = 0;
      statusType.value = 'downloading';

      let downloaded = 0;
      let contentLength = 0;

      try {
        localStorage.setItem(
          PENDING_WHATS_NEW_KEY,
          JSON.stringify({
            version: update.version,
            notes: releaseNotes.value,
            date: releaseDate.value,
          })
        );
      } catch {}

      await update.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === 'Started') {
          contentLength = event.data.contentLength || 0;
          downloadProgress.value = 0;
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          if (contentLength > 0) {
            downloadProgress.value = Math.min(100, Math.round((downloaded / contentLength) * 100));
          }
        } else if (event.event === 'Finished') {
          downloadProgress.value = 100;
        }
      });
    } catch (err: unknown) {
      statusType.value = 'error';
      statusMessage.value = err instanceof Error ? err.message : String(err);
      isDownloading.value = false;
    }
  }

  function dismissConfirmModal() {
    showConfirmModal.value = false;
  }

  async function checkPostUpdateWhatsNew(): Promise<void> {
    const ver = await loadCurrentVersion();
    try {
      const rawPending = localStorage.getItem(PENDING_WHATS_NEW_KEY);
      if (rawPending) {
        const parsed = JSON.parse(rawPending);
        if (parsed && parsed.version === ver && typeof parsed.notes === 'string' && parsed.notes.trim()) {
          whatsNewVersion.value = ver;
          whatsNewNotes.value = parsed.notes;
          whatsNewDate.value = typeof parsed.date === 'string' ? parsed.date : '';
          showWhatsNewModal.value = true;
        }
        localStorage.removeItem(PENDING_WHATS_NEW_KEY);
      }
      localStorage.setItem(LAST_SEEN_VERSION_KEY, ver);
    } catch {}
  }

  function dismissWhatsNewModal() {
    showWhatsNewModal.value = false;
  }

  return {
    currentVersion,
    isChecking,
    isDownloading,
    downloadProgress,
    availableUpdate,
    newVersion,
    releaseNotes,
    releaseDate,
    statusMessage,
    statusType,
    showConfirmModal,
    showWhatsNewModal,
    whatsNewVersion,
    whatsNewNotes,
    whatsNewDate,
    loadCurrentVersion,
    isInternetAvailable,
    checkForUpdates,
    confirmInstall,
    dismissConfirmModal,
    checkPostUpdateWhatsNew,
    dismissWhatsNewModal,
  };
}

